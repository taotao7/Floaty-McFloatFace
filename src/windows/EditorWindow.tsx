import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Slider } from "../components/ui/slider";
import { PlaybackBar, fmtTime } from "../components/editor/PlaybackBar";
import { I18nProvider, getMessages, useI18n, detectLocale, type Locale } from "../i18n";
import { EVT } from "../lib/events";
import {
  deleteRecordingDraft,
  getAppSettings,
  getEditorDraftPath,
  readRecordingFile,
  readRecordingMeta,
  saveRecording,
} from "../lib/tauri";
import type { AppSettings, RecordingMeta } from "../types/app";
import {
  ASPECT_RATIOS,
  computeFrameWindow,
  exportDimensions,
  filterSignificantActivity,
  formatSupported,
  localizeTrail,
  mimeForFormat,
  recordingStamp,
  renderExport,
  type AspectPreset,
} from "../lib/exportVideo";
import type { CursorSample } from "../types/app";
import type { CropRect } from "../lib/coords";

type Format = "mp4" | "webm";

/**
 * Post-capture editor: preview the draft recording, trim the ends, optionally
 * replay a cursor-following zoom (recorded as a trajectory sidecar rather
 * than baked into the video), pick an export resolution/container, and
 * re-encode via `renderExport`. Deliberately small in scope (Screen-Studio-
 * style fine-tune, not a full NLE): trim + zoom + resolution + format.
 *
 * The draft file lives in the OS temp dir (written by `save_recording_draft`
 * when the pipeline stops), alongside a `draft-<id>.json` sidecar holding the
 * recording metadata + cursor trail. Both are deleted after a successful
 * export or when the user discards.
 */
function EditorContent() {
  const t = useI18n();
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<RecordingMeta | null>(null);
  const [draftPath, setDraftPath] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [currentTime, setCurrentTime] = useState(0);
  const [targetHeight, setTargetHeight] = useState<number | null>(null);
  const [aspect, setAspect] = useState<AspectPreset>("original");
  const [format, setFormat] = useState<Format>("mp4");
  const [fps, setFps] = useState(30);
  const [zoomEnabled, setZoomEnabled] = useState(false);
  const [zoomFactor, setZoomFactor] = useState(2);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [info, setInfo] = useState("");
  const [videoSize, setVideoSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const hasTrail = !!(meta?.cursor?.length && meta.crop);

  // Load settings + the draft (and its metadata sidecar) the pipeline saved.
  useEffect(() => {
    void (async () => {
      const [s, path] = await Promise.all([getAppSettings(), getEditorDraftPath()]);
      setFps(s.recordingFps ?? 30);
      if (!path) {
        setInfo(t.editor_no_draft);
        return;
      }
      setDraftPath(path);
      try {
        const [bytes, m] = await Promise.all([
          readRecordingFile(path),
          readRecordingMeta(path),
        ]);
        const type = path.endsWith(".webm") ? "video/webm" : "video/mp4";
        setVideoUrl(URL.createObjectURL(new Blob([bytes], { type })));
        setMeta(m);
        // Default the zoom toggle to whatever the user had set at capture time;
        // only meaningful when there's actually a trail to replay.
        const wantZoom = !!m?.cursor?.length && (s.recordingAutoZoom ?? false);
        setZoomEnabled(wantZoom);
        setZoomFactor(s.recordingZoomFactor ?? 2);
      } catch (err) {
        setInfo(`${(err as Error)?.message ?? err}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onLoadedMetadata = async () => {
    const video = videoRef.current;
    if (!video) return;
    let d = video.duration;
    if (!isFinite(d)) {
      // MediaRecorder WebM often omits duration metadata; force it by seeking.
      d = await probeDuration(video);
    }
    if (isFinite(d) && d > 0) {
      setDuration(d);
      setRange([0, d]);
    }
    setVideoSize({ w: video.videoWidth, h: video.videoHeight });
  };

  const seekTo = (v: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = v;
    setCurrentTime(v);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video || !duration) return;
    if (video.paused) {
      // Clamp the playhead inside the trim range so playback reflects the
      // selected segment.
      if (video.currentTime < range[0] || video.currentTime >= range[1]) {
        video.currentTime = range[0];
      }
      void video.play();
    } else {
      video.pause();
    }
  };

  // Mirror the video's play/pause state so the button stays in sync (covers
  // the ended event and any external pause triggers), and clamp playback to
  // the trim range: crossing range[1] pauses and rewinds to range[0], matching
  // the existing ended behaviour even after the tail is trimmed away.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      if (range[1] > range[0] && video.currentTime >= range[1]) {
        video.pause();
        video.currentTime = range[0];
        setCurrentTime(range[0]);
      }
    };
    const onEnded = () => {
      // Loop back into the trim range so the preview can replay.
      video.currentTime = range[0];
      setCurrentTime(range[0]);
      setPlaying(false);
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("ended", onEnded);
    };
  }, [videoUrl, range]);

  // Viewport preview overlay — the same computeFrameWindow the export runs,
  // so the preview IS the export. Active when zoom is on OR a fixed aspect
  // is chosen (the cover viewport pans across the source, filling the
  // aspect-shaped stage with no bars). When neither is active the canvas
  // stays empty and the bare video shows through untouched.
  const aspectRatio = ASPECT_RATIOS[aspect];
  const overlayActive = zoomEnabled || aspectRatio !== null;
  useEffect(() => {
    if (!videoUrl || !overlayActive) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    // Need the video's native size before we can size the canvas or compute
    // a base crop. Defer until metadata has landed.
    if (!videoSize.w) return;

    // Canvas takes the OUTPUT shape (aspect viewport), not the source's.
    const dims = exportDimensions(videoSize.w, videoSize.h, null, aspectRatio);
    canvas.width = dims.width;
    canvas.height = dims.height;
    // Transparent context: when paused/idle the cleared canvas reveals the
    // video underneath instead of painting black over it.
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const localTrail: CursorSample[] | null =
      meta?.cursor?.length && meta.crop ? localizeTrail(meta.cursor, meta.crop, meta.contentScale ?? 1) : null;
    // Jitter-filtered activity drives zoom in/out (same as export, so the
    // preview matches); the raw trail still drives the focus point.
    const activityTrail = localTrail ? filterSignificantActivity(localTrail) : null;
    const base: CropRect = { sx: 0, sy: 0, sw: videoSize.w, sh: videoSize.h };
    const effectiveZoom = zoomEnabled && localTrail ? zoomFactor : 1;
    // Seed with the current-time viewport (snap) so toggling settings
    // doesn't lerp in from the full frame.
    let smoothState: CropRect = computeFrameWindow({
      trail: localTrail,
      activity: activityTrail,
      base,
      aspect: aspectRatio,
      zoomFactor: 1,
      tMs: video.currentTime * 1000,
      smoothState: { ...base },
      smoothing: 1,
    });

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (video.readyState >= 2) {
        smoothState = computeFrameWindow({
          trail: localTrail,
          activity: activityTrail,
          base,
          aspect: aspectRatio,
          zoomFactor: effectiveZoom,
          tMs: video.currentTime * 1000,
          smoothState,
        });
        ctx.drawImage(
          video,
          smoothState.sx, smoothState.sy, smoothState.sw, smoothState.sh,
          0, 0, canvas.width, canvas.height,
        );
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [videoUrl, videoSize, zoomEnabled, zoomFactor, meta, aspectRatio, overlayActive]);

  const onExport = async () => {
    if (!videoUrl || exporting || !(range[1] > range[0])) return;
    setExporting(true);
    setProgress(0);
    setInfo("");
    try {
      const bytes = await renderExport({
        src: videoUrl,
        start: range[0],
        end: range[1],
        targetHeight,
        aspect: ASPECT_RATIOS[aspect],
        mimeType: mimeForFormat(format),
        fps,
        onProgress: setProgress,
        meta,
        zoom: { enabled: zoomEnabled, factor: zoomFactor },
      });
      const saved = await saveRecording(bytes, `floaty-${recordingStamp()}.${format}`);
      if (saved) {
        if (draftPath) void deleteRecordingDraft(draftPath);
        setInfo(`${t.editor_saved}: ${saved}`);
      } else {
        setInfo(t.editor_cancelled);
      }
    } catch (err) {
      setInfo(`${t.editor_failed}: ${(err as Error)?.message ?? ""}`);
    } finally {
      setExporting(false);
    }
  };

  const onDiscard = async () => {
    if (draftPath) await deleteRecordingDraft(draftPath).catch(() => undefined);
    void getCurrentWindow().close();
  };

  // Caption doubles as a diagnostic readout: k + monitor + crop expose the
  // full physical→frame mapping so mis-crop reports are debuggable from a
  // screenshot alone.
  const dbg = meta?.debug as
    | { monW?: number; monH?: number; k?: number; crop?: { sx: number; sy: number; sw: number; sh: number } }
    | undefined;
  const captureLabel = meta
    ? `${meta.captureWidth}×${meta.captureHeight}` +
      (dbg?.monW ? ` · mon ${dbg.monW}×${dbg.monH}` : "") +
      (meta.region ? ` · region ${meta.region.width}×${meta.region.height}` : "") +
      (dbg?.crop ? ` · crop ${Math.round(dbg.crop.sw)}×${Math.round(dbg.crop.sh)}@${Math.round(dbg.crop.sx)},${Math.round(dbg.crop.sy)}` : "") +
      (dbg?.k ? ` · k=${dbg.k.toFixed(3)}` : ` · @${meta.dpr.toFixed(1)}x`)
    : null;

  return (
    <div className="editor-root">
      <div className="editor-preview">
        {videoUrl ? (
          /* The stage mirrors the EXPORT frame: with a fixed aspect preset it
             takes that shape and the overlay canvas cover-crops the source
             into it (viewport pans with the cursor — no bars), so what you
             see is what exports. */
          <div
            className="editor-stage"
            // Anchor on height and let aspect-ratio derive the width
            // (max-width transfers back through the ratio when it clamps).
            style={
              aspectRatio ? { aspectRatio: `${aspectRatio}`, height: "100%" } : undefined
            }
          >
            {/* The video owns playback and is the frame source. While the
                overlay canvas is active it is made invisible (opacity, NOT
                display:none — hidden/zero-size videos stop producing frames
                on WebKit, which would freeze the canvas too): any sub-pixel
                mismatch between the two boxes would otherwise show the raw
                video peeking out at the edges, which reads as "extra content
                that ignores zoom". */}
            <video
              ref={videoRef}
              src={videoUrl}
              playsInline
              className={overlayActive ? "covered" : undefined}
              onLoadedMetadata={() => void onLoadedMetadata()}
            />
            <canvas
              ref={canvasRef}
              className={`editor-canvas${overlayActive ? " zoom-on" : ""}`}
              onClick={togglePlay}
            />
          </div>
        ) : (
          <div className="editor-loading">{t.editor_loading}</div>
        )}
      </div>

      <PlaybackBar
        currentTime={currentTime}
        range={range}
        playing={playing}
        disabled={!videoUrl || !duration || exporting}
        onTogglePlay={togglePlay}
        onSeek={seekTo}
      />

      <div className="editor-panel">
        <div className="editor-row">
          <label>{t.editor_trim}</label>
          <Slider
            value={range}
            min={0}
            max={Math.max(duration, 0.1)}
            step={0.1}
            disabled={!duration || exporting}
            onValueChange={(v) => {
              const r: [number, number] = [v[0], v[1] ?? v[0]];
              setRange(r);
              const video = videoRef.current;
              if (video) {
                // Pausing while scrubbing keeps the playhead where the user
                // drops it and stops the rAF loop from running away.
                video.pause();
                video.currentTime = r[0];
                setCurrentTime(r[0]);
              }
            }}
          />
          <span className="editor-time">
            {fmtTime(range[0])} – {fmtTime(range[1])} / {fmtTime(duration)}
          </span>
        </div>

        <div className="editor-row">
          <label>{t.editor_zoom}</label>
          <div className="editor-options">
            <button
              type="button"
              className={`editor-opt${zoomEnabled ? " active" : ""}`}
              disabled={!hasTrail || exporting}
              onClick={() => setZoomEnabled((v) => !v)}
            >
              {hasTrail ? (zoomEnabled ? t.editor_on : t.editor_off) : t.editor_no_trail}
            </button>
            <div className="editor-factor">
              <Slider
                value={[zoomFactor]}
                min={1}
                max={3}
                step={0.1}
                disabled={!hasTrail || !zoomEnabled || exporting}
                onValueChange={(v) => setZoomFactor(v[0] ?? 2)}
              />
              <span className="editor-factor-val">{zoomFactor.toFixed(1)}×</span>
            </div>
          </div>
        </div>

        <div className="editor-row">
          <label>{t.editor_resolution}</label>
          <div className="editor-options">
            {([null, 2160, 1440, 1080, 720] as const).map((h) => (
              <button
                key={String(h)}
                type="button"
                className={`editor-opt${targetHeight === h ? " active" : ""}`}
                disabled={exporting}
                onClick={() => setTargetHeight(h)}
              >
                {h === null
                  ? `${t.editor_original}${videoSize.h ? ` (${videoSize.h}p)` : ""}`
                  : h === 2160
                    ? "4K"
                    : `${h}p`}
              </button>
            ))}
          </div>
          {captureLabel && <span className="editor-capture">{captureLabel}</span>}
        </div>

        <div className="editor-row">
          <label>{t.editor_aspect}</label>
          <div className="editor-options">
            {(Object.keys(ASPECT_RATIOS) as AspectPreset[]).map((a) => (
              <button
                key={a}
                type="button"
                className={`editor-opt${aspect === a ? " active" : ""}`}
                disabled={exporting}
                onClick={() => setAspect(a)}
              >
                {t[`editor_aspect_${a}`]}
              </button>
            ))}
          </div>
        </div>

        <div className="editor-row">
          <label>{t.editor_format}</label>
          <div className="editor-options">
            {(["mp4", "webm"] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`editor-opt${format === f ? " active" : ""}`}
                disabled={exporting || !formatSupported(f)}
                onClick={() => setFormat(f)}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {exporting && (
          <div className="editor-progress">
            <div className="editor-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}

        <div className="editor-actions">
          <button type="button" className="editor-btn" onClick={() => void onDiscard()} disabled={exporting}>
            {t.editor_discard}
          </button>
          <button
            type="button"
            className="editor-btn primary"
            onClick={() => void onExport()}
            disabled={!videoUrl || !duration || exporting}
          >
            {exporting ? `${t.editor_exporting} ${Math.round(progress * 100)}%` : t.editor_export}
          </button>
        </div>

        {info && <p className="editor-info">{info}</p>}
      </div>
    </div>
  );
}

export default function EditorWindow() {
  const [locale, setLocale] = useState<Locale>(detectLocale());

  useEffect(() => {
    const load = async () => {
      const persisted = await getAppSettings();
      if (persisted.locale) {
        setLocale(persisted.locale as Locale);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    const unlistenPromise = listen<AppSettings>(EVT.SETTINGS_UPDATED, (event) => {
      if (event.payload.locale) {
        setLocale(event.payload.locale as Locale);
      }
    });
    return () => { void unlistenPromise.then((unlisten) => unlisten()); };
  }, []);

  const messages = getMessages(locale);

  return (
    <I18nProvider value={messages}>
      <EditorContent />
    </I18nProvider>
  );
}

/** Read a usable duration out of a clip whose metadata lacks one (WebM). */
function probeDuration(video: HTMLVideoElement): Promise<number> {
  return new Promise((resolve) => {
    const finish = (d: number) => {
      video.currentTime = 0;
      resolve(d);
    };
    const timer = setTimeout(() => {
      finish(isFinite(video.duration) ? video.duration : 0);
    }, 1500);
    video.addEventListener("durationchange", () => {
      if (isFinite(video.duration)) {
        clearTimeout(timer);
        finish(video.duration);
      }
    });
    video.currentTime = Number.MAX_SAFE_INTEGER;
  });
}
