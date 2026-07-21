import { useCallback, useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { currentMonitor } from "@tauri-apps/api/window";
import { EVT } from "../lib/events";
import type { MousePayload } from "../lib/events";
import { computeCropRect, computeZoomedCrop, smoothCrop, validateCaptureAssumption } from "../lib/coords";
import type { CropRect } from "../lib/coords";
import { getAppSettings, getRecordingRegion, openEditorWindow, saveRecordingDraft, setCursorOverlay, setMouseTrackingEnabled } from "../lib/tauri";
import type { AppSettings, RecordingRegion } from "../types/app";

export type RecordingStatus = "idle" | "countdown" | "recording" | "paused" | "saving";

/** How long after the last cursor activity the auto-zoom stays zoomed in. */
const ZOOM_HOLD_MS = 1600;
/** Fraction of the remaining crop distance closed per animation frame. */
const ZOOM_SMOOTHING = 0.12;
/** Seconds counted down in the control bar before capture actually starts. */
const COUNTDOWN_SECONDS = 3;

/** Mutable auto-zoom state for the rAF crop loop (never triggers renders). */
interface ZoomState {
  /** Latest cursor position in physical pixels (frame-local, origin 0,0). */
  cursor: { x: number; y: number } | null;
  /** Timestamp of the last cursor move/click, for the zoom-out dwell. */
  lastActivity: number;
  /** The animated crop currently being drawn. */
  current: CropRect;
}

/**
 * Pure helper — pick the best-supported recording mime type. Extracted from
 * the component so it can be unit-tested in isolation.
 *
 * MP4 (H.264) is preferred: WKWebView's MediaRecorder supports it natively
 * and the files play everywhere without conversion. WebM is the fallback
 * for platforms whose webview cannot mux MP4 (Chromium-based WebView2).
 */
export function pickMimeType(): string {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return "video/mp4";
}

/** File extension matching a recording mime type ("mp4" unless it's WebM). */
export function extensionForMime(mime: string): "mp4" | "webm" {
  return mime.includes("webm") ? "webm" : "mp4";
}

export interface PipelineApi {
  status: RecordingStatus;
  elapsed: number;
  info: string;
  region: RecordingRegion | null;
  settings: AppSettings | null;
  locale: string;
  /** Seconds left in the pre-capture countdown (0 = not counting). */
  countdown: number;
  /** Start a fresh recording. */
  start: () => Promise<void>;
  /** Stop the active recording and persist it via the native save dialog. */
  stop: () => void;
  /** Start if idle, stop if recording/paused. Stable identity (useCallback []). */
  toggle: () => Promise<void>;
  /** Pause a recording, or resume a paused one. */
  togglePause: () => void;
  /** Clear the info banner (e.g. the "saved to ..." message). */
  clearInfo: () => void;
}

/**
 * Owns the entire screen-recording pipeline state: the `getDisplayMedia`
 * stream, a hidden `<video>` + offscreen crop canvas, the
 * `requestAnimationFrame` crop loop, the `MediaRecorder` lifecycle, chunk
 * assembly, save, status broadcasting, and the cursor-overlay toggle.
 *
 * Extracted from `RecordingControlWindow` so the React component is just a
 * thin view over `{ status, elapsed, info, start, stop, togglePause }`. The
 * component previously held 11 refs and 11 concerns; now it holds none of
 * the pipeline internals.
 *
 * The pipeline is NOT yet pure enough to unit-test end-to-end (it touches
 * `navigator.mediaDevices`, `MediaRecorder`, and the Tauri backend), but the
 * extracted pure helpers (`pickMimeType`, plus `computeCropRect` /
 * `validateCaptureAssumption` from coords) are independently tested.
 */
export function useRecordingPipeline(): PipelineApi {
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [region, setRegion] = useState<RecordingRegion | null>(null);
  const [info, setInfo] = useState<string>("");
  const [locale, setLocale] = useState(() => (navigator.language.startsWith("zh") ? "zh" : "en"));
  const [settings, setSettings] = useState<AppSettings | null>(null);

  // Refs survive re-renders and are closed over by MediaRecorder callbacks.
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const regionRef = useRef<RecordingRegion | null>(null);
  const settingsRef = useRef<AppSettings | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  // Latest status for use inside long-lived listeners (hotkey/tray) whose
  // effect runs once on mount; otherwise they would capture a stale status.
  const statusRef = useRef<RecordingStatus>(status);
  // Latest elapsed seconds, read by togglePause() when resuming so it can
  // offset the start time correctly.
  const elapsedRef = useRef<number>(0);
  // Auto-zoom state + event unlisteners, torn down with the stream.
  const zoomStateRef = useRef<ZoomState | null>(null);
  const zoomUnlistenRef = useRef<Array<() => void> | null>(null);
  // Mime type the active MediaRecorder actually negotiated; drives the blob
  // type and file extension on save.
  const mimeRef = useRef<string>("video/mp4");

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  // Load settings + saved region on mount.
  useEffect(() => {
    void (async () => {
      const [s, r] = await Promise.all([getAppSettings(), getRecordingRegion()]);
      setSettings(s);
      settingsRef.current = s;
      setRegion(r);
      regionRef.current = r;
      if (s.locale) setLocale(s.locale.startsWith("zh") ? "zh" : "en");
    })();
  }, []);

  // Keep settings + region refs fresh.
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    regionRef.current = region;
  }, [region]);

  // React to settings / region / hotkey broadcasts. The hotkey & tray both
  // fan out via `app://hotkey-triggered { action: "toggle_recording" }`.
  useEffect(() => {
    const unlisten1 = listen<AppSettings>(EVT.SETTINGS_UPDATED, (e) => {
      setSettings(e.payload);
      if (e.payload.locale) setLocale(e.payload.locale.startsWith("zh") ? "zh" : "en");
    });
    const unlisten2 = listen<RecordingRegion | null>(EVT.REGION_SELECTED, (e) => {
      setRegion(e.payload);
    });
    return () => {
      unlisten1.then((fn) => fn());
      unlisten2.then((fn) => fn());
    };
  }, []);

  const stopCropLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const cancelCountdown = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdown(0);
  }, []);

  const cleanupStream = useCallback(() => {
    stopCropLoop();
    cancelCountdown();
    zoomUnlistenRef.current?.forEach((fn) => fn());
    zoomUnlistenRef.current = null;
    zoomStateRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, [stopCropLoop, cancelCountdown]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    const s = settingsRef.current;
    const fps = s?.recordingFps ?? 30;
    let displayStream: MediaStream;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: fps },
        audio: true,
      });
    } catch (err) {
      setInfo(locale === "zh" ? "已取消" : "Cancelled");
      void emit(EVT.CAMERA_ERROR, { message: (err as Error)?.message ?? "display_capture_failed" });
      return;
    }
    streamRef.current = displayStream;
    setInfo("");

    // Auto-stop if the user ends the share via the browser/OS chrome.
    displayStream.getVideoTracks()[0]?.addEventListener("ended", () => {
      stop();
    });

    const video = document.createElement("video");
    video.srcObject = displayStream;
    video.muted = true;
    video.playsInline = true;
    await video.play().catch(() => undefined);
    videoRef.current = video;

    // Crop math lives in coords.ts (unit-tested). Validate the capture
    // matches the primary monitor before relying on the region mapping.
    const r = regionRef.current;
    const videoW = video.videoWidth;
    const videoH = video.videoHeight;

    const monitor = await currentMonitor().catch(() => null);
    if (monitor) {
      const phys = monitor.size;
      const check = validateCaptureAssumption(videoW, videoH, phys.width, phys.height);
      if (!check.ok) {
        void emit(EVT.CAMERA_ERROR, { message: check.reason ?? "capture_assumption_failed" });
      }
    }

    const crop = computeCropRect(r, videoW, videoH);
    const canvas = document.createElement("canvas");
    canvas.width = crop.sw;
    canvas.height = crop.sh;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      cleanupStream();
      setInfo("canvas error");
      return;
    }
    canvasRef.current = canvas;

    // Auto-zoom: follow the cursor with a magnified crop that zooms in on
    // activity and settles back to the base crop after a dwell. Cursor
    // coordinates arrive via the shared event tap (physical pixels, same
    // space as the crop rect under the 1:1 capture assumption).
    if (s?.recordingAutoZoom) {
      zoomStateRef.current = { cursor: null, lastActivity: 0, current: { ...crop } };
      const onCursor = (p: MousePayload) => {
        const zs = zoomStateRef.current;
        if (zs) {
          zs.cursor = { x: p.x, y: p.y };
          zs.lastActivity = Date.now();
        }
      };
      zoomUnlistenRef.current = await Promise.all([
        listen<MousePayload>(EVT.MOUSE_MOVE, (e) => onCursor(e.payload)),
        listen<MousePayload>(EVT.MOUSE_DOWN, (e) => onCursor(e.payload)),
      ]);
      // The cursor overlay enables mouse tracking itself; without it we must
      // gate the event tap on explicitly (and off again in stop()).
      if (!s.recordingCursorOverlay) {
        void setMouseTrackingEnabled(true);
      }
    }

    const drawFrame = () => {
      if (!ctx || !videoRef.current || !canvasRef.current) return;
      if (videoRef.current.readyState >= 2) {
        let source = crop;
        const zs = zoomStateRef.current;
        if (zs) {
          const zooming = zs.cursor !== null && Date.now() - zs.lastActivity < ZOOM_HOLD_MS;
          const focus = zs.cursor ?? { x: crop.sx + crop.sw / 2, y: crop.sy + crop.sh / 2 };
          const factor = settingsRef.current?.recordingZoomFactor ?? 2;
          const target = computeZoomedCrop(focus, crop, zooming ? factor : 1);
          zs.current = smoothCrop(zs.current, target, ZOOM_SMOOTHING);
          source = zs.current;
        }
        ctx.drawImage(
          videoRef.current,
          source.sx, source.sy, source.sw, source.sh,
          0, 0, canvas.width, canvas.height,
        );
      }
      rafRef.current = requestAnimationFrame(drawFrame);
    };
    rafRef.current = requestAnimationFrame(drawFrame);

    const canvasStream = canvas.captureStream(fps);
    displayStream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(canvasStream, { mimeType: pickMimeType() });
    } catch {
      recorder = new MediaRecorder(canvasStream);
    }
    // What the recorder actually negotiated (mp4 preferred, webm fallback);
    // drives the blob type and file extension when saving.
    mimeRef.current = recorder.mimeType || "video/mp4";
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorderRef.current = recorder;

    // 3-2-1 countdown so the user can get ready. The crop loop is already
    // running (frames flow to the canvas); only the MediaRecorder waits.
    // stop() during the countdown cancels it without saving anything.
    setStatus("countdown");
    setCountdown(COUNTDOWN_SECONDS);
    let remaining = COUNTDOWN_SECONDS;
    countdownTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        setCountdown(remaining);
        return;
      }
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      setCountdown(0);
      recorder.start(1000);
      setStatus("recording");
      startTimeRef.current = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);

      // Bring up the cursor overlay if enabled (it self-gates mouse tracking).
      if (s?.recordingCursorOverlay) {
        void setCursorOverlay(true);
      }
      void emit(EVT.RECORDING_STATUS, { active: true });
    }, 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanupStream, locale]);

  const stop = useCallback(() => {
    // Cancelling mid-countdown: the recorder never started, so just tear
    // down the stream and go back to idle without entering "saving".
    if (statusRef.current === "countdown") {
      cleanupStream();
      recorderRef.current = null;
      setStatus("idle");
      return;
    }
    const recorder = recorderRef.current;
    if (!recorder) return;
    setStatus("saving");
    stopTimer();
    recorder.onstop = async () => {
      const mime = mimeRef.current;
      const blob = new Blob(chunksRef.current, { type: mime.split(";")[0] });
      chunksRef.current = [];
      cleanupStream();
      recorderRef.current = null;

      setStatus("idle");
      setElapsed(0);
      void emit(EVT.RECORDING_STATUS, { active: false });
      if (settingsRef.current?.recordingCursorOverlay) {
        void setCursorOverlay(false);
      } else if (settingsRef.current?.recordingAutoZoom) {
        // We enabled mouse tracking ourselves in start(); gate it back off.
        void setMouseTrackingEnabled(false);
      }

      try {
        // Hand the raw capture to the editor window (trim/export happens
        // there); the save dialog now lives in the editor's export flow.
        const buf = new Uint8Array(await blob.arrayBuffer());
        await saveRecordingDraft(buf, extensionForMime(mime));
        setInfo(locale === "zh" ? "正在打开编辑器…" : "Opening editor…");
        await openEditorWindow();
      } catch (err) {
        setInfo(`${locale === "zh" ? "保存失败" : "Save failed"}: ${(err as Error)?.message ?? ""}`);
      }
    };
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanupStream, locale, stopTimer]);

  const togglePause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.pause();
      setStatus("paused");
      stopTimer();
    } else if (recorder.state === "paused") {
      startTimeRef.current = Date.now() - elapsedRef.current * 1000;
      recorder.resume();
      setStatus("recording");
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);
    }
  }, [stopTimer]);

  const toggle = useCallback(async () => {
    const current = statusRef.current;
    if (current === "recording" || current === "paused" || current === "countdown") {
      stop();
      return;
    }
    await start();
  }, [start, stop]);

  // Hotkey & tray both fan out via this action. toggle is stable enough
  // (its deps start/stop change only when locale changes) that reconnecting
  // on locale change is fine.
  useEffect(() => {
    const unlisten = listen<{ action: string }>(EVT.HOTKEY_TRIGGERED, (e) => {
      if (e.payload.action === "toggle_recording") {
        void toggle();
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [toggle]);

  const clearInfo = useCallback(() => setInfo(""), []);

  return {
    status,
    elapsed,
    countdown,
    info,
    region,
    settings,
    locale,
    start,
    stop,
    toggle,
    togglePause,
    clearInfo,
  };
}
