import { useCallback, useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { currentMonitor, primaryMonitor } from "@tauri-apps/api/window";
import { EVT } from "../lib/events";
import type { MousePayload, RecordingCmdPayload, RecordingUiPayload } from "../lib/events";
import { computeCropRect } from "../lib/coords";
import { getAppSettings, getRecordingRegion, openEditorWindow, saveRecordingDraft, saveRecordingMeta, setCursorOverlay, setMouseTrackingEnabled } from "../lib/tauri";
import type { AppSettings, CursorSample, RecordingMeta, RecordingRegion } from "../types/app";

export type RecordingStatus = "idle" | "countdown" | "recording" | "paused" | "saving";

/** Seconds counted down in the control bar before capture actually starts. */
const COUNTDOWN_SECONDS = 3;

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
 * HOSTED IN THE MAIN CAMERA WINDOW, not the recording control bar. WebKit
 * enforces one active capture per *page* ("latest wins"): when the pipeline
 * lived in the recording window, its `getDisplayMedia` muted the camera in
 * the main window (black float), and any camera re-acquire muted the screen
 * capture right back (black recordings). A single document may hold both
 * captures simultaneously, so the pipeline runs alongside the camera and the
 * control bar is a remote control speaking `app://recording-cmd` /
 * `app://recording-ui` (see `useRecordingRemote`).
 *
 * The pipeline is NOT yet pure enough to unit-test end-to-end (it touches
 * `navigator.mediaDevices`, `MediaRecorder`, and the Tauri backend), but the
 * extracted pure helpers (`pickMimeType`, plus `computeCropRect` from
 * coords) are independently tested.
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
  const cropIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
  // Cursor trajectory for post-capture zoom, recorded whenever a recording is
  // active. The canvas no longer bakes zoom in; the editor replays this trail.
  const cursorTrailRef = useRef<CursorSample[]>([]);
  const cursorUnlistenRef = useRef<Array<() => void> | null>(null);
  /** performance.now() captured when the MediaRecorder starts; trajectory `t`
   *  values are milliseconds relative to this anchor. */
  const recStartPerfRef = useRef<number>(0);
  /** Captured display-stream resolution + crop, recorded once on start so the
   *  metadata sidecar can be written on stop without re-reading the stream. */
  const captureSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const cropRef = useRef<{ sx: number; sy: number; sw: number; sh: number } | null>(null);
  /** Content scale (global physical px → frame px), computed arithmetically
   *  as videoWidth / monitor physical width; recorded in the sidecar so zoom
   *  replay maps the cursor trail the same way the crop mapped the region. */
  const contentScaleRef = useRef(1);
  /** Raw capture-time numbers for the sidecar's debug block. */
  const captureDebugRef = useRef<Record<string, unknown> | null>(null);
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
    if (cropIntervalRef.current !== null) {
      clearInterval(cropIntervalRef.current);
      cropIntervalRef.current = null;
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
    cursorUnlistenRef.current?.forEach((fn) => fn());
    cursorUnlistenRef.current = null;
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
    // The capture contract is "primary monitor at physical pixels" (mouse
    // coords are converted with the primary scale factor too). The control
    // bar may sit on a secondary monitor, so currentMonitor() would size the
    // request to the wrong panel and pad the frame with black.
    const monitor =
      (await primaryMonitor().catch(() => null)) ?? (await currentMonitor().catch(() => null));
    let displayStream: MediaStream;
    try {
      // Deliberately NO width/height constraints. Asking WKWebView for the
      // native 5K size made it allocate a physically-sized buffer, render
      // the content at 1x in the top-left, and fill the rest with padding
      // (black or stale pixels) — sometimes switching modes mid-recording.
      // Every "black bars / frozen strips" bug traced back to that. Left to
      // its own defaults the track is sized to the actual content and the
      // frame is always fully used, making the physical→frame scale pure
      // arithmetic (videoW / monitorW) with nothing to probe.
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
    // play() doesn't guarantee metadata has landed; videoWidth/Height read 0
    // until it does, which would produce a degenerate crop.
    if (video.readyState < 1) {
      await new Promise<void>((resolve) => {
        video.addEventListener("loadedmetadata", () => resolve(), { once: true });
        setTimeout(resolve, 1500);
      });
    }
    videoRef.current = video;

    const videoW = video.videoWidth;
    const videoH = video.videoHeight;

    // Physical px → frame px, by pure arithmetic. The unconstrained track is
    // sized to the real content (no padding), so the ratio of frame size to
    // the captured monitor's physical size IS the scale — nothing to probe.
    // Regions and the mouse trail are in physical px and get multiplied by
    // k to land in frame space; the same k goes into the sidecar so zoom
    // replay maps the trail identically.
    //
    // Self-check: derive k from BOTH axes. If they disagree, `monitor` is
    // not the captured screen (multi-monitor pick mismatch — its aspect
    // differs) and dividing by its width would mis-crop. Fall back to
    // 1/scaleFactor, the deterministic point→pixel ratio of an unconstrained
    // WKWebView capture, which needs no knowledge of WHICH panel was grabbed.
    const computeK = () => {
      const fallback = 1 / (monitor?.scaleFactor || window.devicePixelRatio || 1);
      if (!monitor || monitor.size.width <= 0 || monitor.size.height <= 0) return fallback;
      const kx = video.videoWidth / monitor.size.width;
      const ky = video.videoHeight / monitor.size.height;
      return Math.abs(kx - ky) < 0.02 ? kx : fallback;
    };
    const applyScale = () => {
      const k = computeK();
      contentScaleRef.current = k;
      const reg = regionRef.current;
      const scaledRegion = reg && k !== 1
        ? { x: reg.x * k, y: reg.y * k, width: reg.width * k, height: reg.height * k }
        : reg;
      cropRef.current = computeCropRect(scaledRegion, video.videoWidth, video.videoHeight);
    };
    applyScale();
    const crop = cropRef.current!;
    // Capture-time numbers for the sidecar; shown in the editor caption so
    // mapping bugs can be diagnosed from a screenshot.
    captureDebugRef.current = {
      videoW,
      videoH,
      monW: monitor?.size.width ?? null,
      monH: monitor?.size.height ?? null,
      scaleFactor: monitor?.scaleFactor ?? null,
      k: contentScaleRef.current,
      region: regionRef.current,
      crop: { ...crop },
    };
    // The output canvas keeps the INITIAL crop's size for the whole
    // recording (encoders can't switch dimensions mid-stream); if the crop
    // later shrinks (k drop), drawImage upscales that smaller source into
    // the same canvas, preserving geometry at some sharpness cost.
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
    captureSizeRef.current = { w: videoW, h: videoH };
    cropRef.current = { ...crop };

    // Record the cursor trajectory for post-capture zoom. The canvas no
    // longer bakes zoom in; the editor + export pipeline replay this trail
    // to apply a retunable zoom after the fact, so the draft stays clean.
    // Sampling runs whenever a recording is active, independent of the
    // cursor-overlay / auto-zoom settings (those only govern replay defaults).
    cursorTrailRef.current = [];
    const pushSample = (p: MousePayload, type: CursorSample["type"]) => {
      const anchor = recStartPerfRef.current;
      if (anchor === 0) return; // not yet recording (countdown phase)
      cursorTrailRef.current.push({
        t: performance.now() - anchor,
        x: p.x,
        y: p.y,
        type,
        ...(type === "move" ? {} : { button: p.button === "right" ? "right" : "left" }),
      });
    };
    cursorUnlistenRef.current = await Promise.all([
      listen<MousePayload>(EVT.MOUSE_MOVE, (e) => pushSample(e.payload, "move")),
      listen<MousePayload>(EVT.MOUSE_DOWN, (e) => pushSample(e.payload, "down")),
      listen<MousePayload>(EVT.MOUSE_UP, (e) => pushSample(e.payload, "up")),
    ]);
    // Always gate the event tap on ourselves so the trajectory is captured
    // regardless of the cursor-overlay setting. The overlay also calls
    // set_mouse_tracking(true) when it comes up, but that happens after the
    // countdown — relying on it would lose the opening seconds of cursor
    // movement. We turn it back off in stop().
    void setMouseTrackingEnabled(true);

    // Last seen track dimensions; a mid-recording change (the webview
    // resizing the capture track) invalidates the crop immediately.
    let lastVW = videoW;
    let lastVH = videoH;
    const drawFrame = () => {
      const v = videoRef.current;
      if (!ctx || !v || !canvasRef.current) return;
      if (v.readyState < 2) return;
      // Track resize → recompute k and the crop arithmetically, same frame.
      if (v.videoWidth !== lastVW || v.videoHeight !== lastVH) {
        lastVW = v.videoWidth;
        lastVH = v.videoHeight;
        applyScale();
      }
      const c = cropRef.current;
      if (!c) return;
      // Intersect the source rect with the actual frame. drawImage CLIPS an
      // out-of-bounds source and shrinks the destination proportionally —
      // without this, a stale crop leaves canvas edges unpainted forever
      // (frozen first-frame strips in the draft).
      const sx0 = Math.max(c.sx, 0);
      const sy0 = Math.max(c.sy, 0);
      const sx1 = Math.min(c.sx + c.sw, v.videoWidth);
      const sy1 = Math.min(c.sy + c.sh, v.videoHeight);
      const sw = sx1 - sx0;
      const sh = sy1 - sy0;
      if (sw <= 0 || sh <= 0) return;
      const clipped = sw < c.sw - 0.5 || sh < c.sh - 0.5;
      if (clipped) {
        // Some of the canvas won't be painted this frame; black-fill so no
        // region ever shows stale pixels. Skipped on the hot path (opaque
        // context + full-cover drawImage overwrite every pixel).
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      const scaleX = canvas.width / c.sw;
      const scaleY = canvas.height / c.sh;
      ctx.drawImage(
        v,
        sx0, sy0, sw, sh,
        (sx0 - c.sx) * scaleX, (sy0 - c.sy) * scaleY, sw * scaleX, sh * scaleY,
      );
    };
    // setInterval, not requestAnimationFrame: this pipeline runs in the main
    // camera window, and rAF is throttled/paused when the hosting window is
    // hidden or occluded — which would freeze the recording. Timers keep
    // firing regardless of window visibility.
    cropIntervalRef.current = setInterval(drawFrame, Math.max(1000 / fps, 16));

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
      // Anchor the trajectory timeline to the moment encoding actually
      // begins, so `cursor[i].t` lines up with `video.currentTime * 1000`
      // when the editor replays the trail.
      recStartPerfRef.current = performance.now();
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
      cursorTrailRef.current = [];
      cropRef.current = null;
      captureSizeRef.current = { w: 0, h: 0 };
      contentScaleRef.current = 1;
      recStartPerfRef.current = 0;
      if (!settingsRef.current?.recordingCursorOverlay) {
        void setMouseTrackingEnabled(false);
      }
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
      // Snapshot the trajectory + geometry before tearing down listeners, so
      // the metadata sidecar can be written after cleanupStream.
      const trail = cursorTrailRef.current;
      const cropSnap = cropRef.current;
      const captureSize = captureSizeRef.current;
      const regionSnap = regionRef.current;
      const contentScaleSnap = contentScaleRef.current;
      const dpr = window.devicePixelRatio || 1;
      cleanupStream();
      recorderRef.current = null;
      cursorTrailRef.current = [];
      cropRef.current = null;
      captureSizeRef.current = { w: 0, h: 0 };
      contentScaleRef.current = 1;
      recStartPerfRef.current = 0;

      setStatus("idle");
      setElapsed(0);
      void emit(EVT.RECORDING_STATUS, { active: false });
      if (settingsRef.current?.recordingCursorOverlay) {
        // Hiding the overlay also turns mouse tracking off internally.
        void setCursorOverlay(false);
      } else {
        // We enabled mouse tracking ourselves in start(); gate it back off.
        void setMouseTrackingEnabled(false);
      }

      try {
        // Hand the raw capture to the editor window (trim/export happens
        // there); the save dialog now lives in the editor's export flow.
        const buf = new Uint8Array(await blob.arrayBuffer());
        const draftPath = await saveRecordingDraft(buf, extensionForMime(mime));
        // Persist the metadata sidecar so the editor can replay zoom. A
        // failure here is non-fatal — the video is already saved; the editor
        // just falls back to a no-zoom preview.
        if (cropSnap) {
          const meta: RecordingMeta = {
            captureWidth: captureSize.w,
            captureHeight: captureSize.h,
            crop: cropSnap,
            dpr,
            region: regionSnap,
            cursor: trail,
            contentScale: contentScaleSnap,
            debug: captureDebugRef.current ?? undefined,
          };
          await saveRecordingMeta(draftPath, meta).catch(() => undefined);
        }
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

  // --- Remote-control wiring (control bar lives in another window) ---

  // Broadcast UI state on every change so the control bar mirrors it.
  useEffect(() => {
    const payload: RecordingUiPayload = { status, elapsed, countdown, info };
    void emit(EVT.RECORDING_UI, payload);
  }, [status, elapsed, countdown, info]);

  // Execute commands sent by the control bar. `sync` re-broadcasts current
  // state for a bar that (re)opened after the state last changed.
  useEffect(() => {
    const unlisten = listen<RecordingCmdPayload>(EVT.RECORDING_CMD, (e) => {
      switch (e.payload.action) {
        case "toggle":
          void toggle();
          break;
        case "toggle-pause":
          togglePause();
          break;
        case "clear-info":
          clearInfo();
          break;
        case "sync": {
          const payload: RecordingUiPayload = {
            status: statusRef.current,
            elapsed: elapsedRef.current,
            countdown: 0,
            info: "",
          };
          void emit(EVT.RECORDING_UI, payload);
          break;
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [toggle, togglePause, clearInfo]);

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
