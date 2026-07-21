import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Slider } from "../components/ui/slider";
import {
  deleteRecordingDraft,
  getAppSettings,
  getEditorDraftPath,
  readRecordingFile,
  saveRecording,
} from "../lib/tauri";
import { formatSupported, mimeForFormat, recordingStamp, renderExport } from "../lib/exportVideo";

type Format = "mp4" | "webm";

/**
 * Post-capture editor: preview the draft recording, trim the ends, pick an
 * export resolution/container, and re-encode via `renderExport`. Deliberately
 * small in scope (Screen-Studio-style fine-tune, not a full NLE): trim +
 * resolution + format.
 *
 * The draft file lives in the OS temp dir (written by `save_recording_draft`
 * when the pipeline stops); it is deleted after a successful export or when
 * the user discards it.
 */
export default function EditorWindow() {
  const [locale, setLocale] = useState(() => (navigator.language.startsWith("zh") ? "zh" : "en"));
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [draftPath, setDraftPath] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [targetHeight, setTargetHeight] = useState<number | null>(null);
  const [format, setFormat] = useState<Format>("mp4");
  const [fps, setFps] = useState(30);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [info, setInfo] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const t = makeT(locale);

  // Load settings + the draft the pipeline just saved.
  useEffect(() => {
    void (async () => {
      const [s, path] = await Promise.all([getAppSettings(), getEditorDraftPath()]);
      if (s.locale) setLocale(s.locale.startsWith("zh") ? "zh" : "en");
      setFps(s.recordingFps ?? 30);
      if (!path) {
        setInfo(navigator.language.startsWith("zh") ? "没有可编辑的草稿" : "No draft to edit");
        return;
      }
      setDraftPath(path);
      try {
        const bytes = await readRecordingFile(path);
        const type = path.endsWith(".webm") ? "video/webm" : "video/mp4";
        setVideoUrl(URL.createObjectURL(new Blob([bytes], { type })));
      } catch (err) {
        setInfo(`${(err as Error)?.message ?? err}`);
      }
    })();
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
  };

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
        mimeType: mimeForFormat(format),
        fps,
        onProgress: setProgress,
      });
      const saved = await saveRecording(bytes, `floaty-${recordingStamp()}.${format}`);
      if (saved) {
        if (draftPath) void deleteRecordingDraft(draftPath);
        setInfo(`${t.saved}: ${saved}`);
      } else {
        setInfo(t.cancelled);
      }
    } catch (err) {
      setInfo(`${t.failed}: ${(err as Error)?.message ?? ""}`);
    } finally {
      setExporting(false);
    }
  };

  const onDiscard = async () => {
    if (draftPath) await deleteRecordingDraft(draftPath).catch(() => undefined);
    void getCurrentWindow().close();
  };

  return (
    <div className="editor-root">
      <div className="editor-preview">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            onLoadedMetadata={() => void onLoadedMetadata()}
          />
        ) : (
          <div className="editor-loading">{t.loading}</div>
        )}
      </div>

      <div className="editor-panel">
        <div className="editor-row">
          <label>{t.trim}</label>
          <Slider
            value={range}
            min={0}
            max={Math.max(duration, 0.1)}
            step={0.1}
            disabled={!duration || exporting}
            onValueChange={(v) => {
              const r: [number, number] = [v[0], v[1] ?? v[0]];
              setRange(r);
              if (videoRef.current) videoRef.current.currentTime = r[0];
            }}
          />
          <span className="editor-time">
            {fmtTime(range[0])} – {fmtTime(range[1])} / {fmtTime(duration)}
          </span>
        </div>

        <div className="editor-row">
          <label>{t.resolution}</label>
          <div className="editor-options">
            {([null, 1080, 720] as const).map((h) => (
              <button
                key={String(h)}
                type="button"
                className={`editor-opt${targetHeight === h ? " active" : ""}`}
                disabled={exporting}
                onClick={() => setTargetHeight(h)}
              >
                {h === null ? t.original : `${h}p`}
              </button>
            ))}
          </div>
        </div>

        <div className="editor-row">
          <label>{t.format}</label>
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
            {t.discard}
          </button>
          <button
            type="button"
            className="editor-btn primary"
            onClick={() => void onExport()}
            disabled={!videoUrl || !duration || exporting}
          >
            {exporting ? `${t.exporting} ${Math.round(progress * 100)}%` : t.export}
          </button>
        </div>

        {info && <p className="editor-info">{info}</p>}
      </div>
    </div>
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

function fmtTime(sec: number): string {
  if (!isFinite(sec)) return "--:--";
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

function makeT(locale: string) {
  if (locale === "zh") {
    return {
      loading: "加载中…",
      trim: "裁剪",
      resolution: "分辨率",
      original: "原始",
      format: "格式",
      export: "导出",
      exporting: "导出中",
      discard: "丢弃",
      saved: "已保存到",
      cancelled: "已取消",
      failed: "导出失败",
    };
  }
  return {
    loading: "Loading…",
    trim: "Trim",
    resolution: "Resolution",
    original: "Original",
    format: "Format",
    export: "Export",
    exporting: "Exporting",
    discard: "Discard",
    saved: "Saved to",
    cancelled: "Cancelled",
    failed: "Export failed",
  };
}
