import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Pause, Play, Square, Crop, Monitor } from "lucide-react";
import { getAppSettings, resetRecordingRegion, startRegionSelect } from "../lib/tauri";
import { useRecordingRemote } from "../hooks/useRecordingRemote";
import { I18nProvider, getMessages, useI18n, detectLocale, type Locale } from "../i18n";
import { EVT } from "../lib/events";
import type { AppSettings } from "../types/app";

/**
 * The floating recording control bar — a REMOTE CONTROL for the pipeline,
 * which runs in the main camera window (WebKit's one-capture-per-page policy
 * forces camera + screen capture into the same document; see
 * `useRecordingPipeline`). This component owns only UI concerns: window
 * dragging, button wiring, and derived display strings, all mirrored over
 * `app://recording-ui` / `app://recording-cmd`.
 */
function RecordingControlContent() {
  const {
    status,
    elapsed,
    countdown,
    info,
    region,
    toggle,
    togglePause,
    clearInfo,
  } = useRecordingRemote();
  const [dragging, setDragging] = useState(false);

  const t = useI18n();
  const recording = status === "recording" || status === "paused";
  const countingDown = status === "countdown";
  const regionLabel = region
    ? `${Math.round(region.width / (window.devicePixelRatio || 1))}×${Math.round(region.height / (window.devicePixelRatio || 1))}`
    : t.recording_region_full;

  const handleDrag = () => {
    setDragging(true);
    void getCurrentWindow().startDragging();
    setTimeout(() => setDragging(false), 300);
  };

  const onPickRegion = () => {
    void startRegionSelect();
  };

  const onFull = async () => {
    await resetRecordingRegion();
  };

  return (
    <div
      className={`recording-bar${dragging ? " dragging" : ""}`}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).dataset.role === "btn") return;
        handleDrag();
      }}
    >
      <span className={`rec-dot ${status}`} aria-hidden />
      <button
        type="button"
        data-role="btn"
        className={`rec-btn primary${!recording && !countingDown ? " rec-btn-start" : ""}`}
        onClick={() => void toggle()}
        title={recording || countingDown ? t.recording_stop : t.recording_record}
      >
        {recording || countingDown ? <Square size={15} /> : <Play size={15} />}
        {!recording && !countingDown && <span className="rec-label">{t.recording_rec}</span>}
      </button>
      {recording && (
        <button
          type="button"
          data-role="btn"
          className="rec-btn"
          onClick={togglePause}
          title={status === "paused" ? t.recording_resume : t.recording_pause}
        >
          {status === "paused" ? <Play size={15} /> : <Pause size={15} />}
        </button>
      )}
      <span className="rec-time">{formatTime(elapsed)}</span>
      <button
        type="button"
        data-role="btn"
        className="rec-btn"
        onClick={onPickRegion}
        title={t.recording_region_pick}
        disabled={recording || countingDown}
      >
        <Crop size={15} />
      </button>
      <button
        type="button"
        data-role="btn"
        className="rec-btn"
        onClick={() => void onFull()}
        title={t.recording_region_full}
        disabled={recording || countingDown}
      >
        <Monitor size={15} />
      </button>
      <span className="rec-region">{regionLabel}</span>
      {status === "saving" && <span className="rec-info">{t.recording_saving}</span>}
      {info && !recording && status !== "saving" && (
        <span className="rec-info" title={info} onClick={clearInfo} style={{ cursor: "pointer" }}>
          {info}
        </span>
      )}
      {countingDown && (
        <div className="rec-countdown" aria-live="assertive">
          <span key={countdown}>{countdown}</span>
        </div>
      )}
    </div>
  );
}

function formatTime(total: number) {
  const m = Math.floor(total / 60).toString().padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function RecordingControlWindow() {
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
      <RecordingControlContent />
    </I18nProvider>
  );
}
