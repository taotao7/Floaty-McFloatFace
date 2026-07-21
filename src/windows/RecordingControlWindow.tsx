import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Pause, Play, Square, Crop, Monitor } from "lucide-react";
import { resetRecordingRegion, startRegionSelect } from "../lib/tauri";
import { useRecordingPipeline } from "../hooks/useRecordingPipeline";

/**
 * The floating recording control bar — now a thin view over
 * `useRecordingPipeline`. This component owns only UI concerns: window
 * dragging, button wiring, and derived display strings. All pipeline state
 * (stream, recorder, canvas, chunks, timing) lives in the hook.
 */
export default function RecordingControlWindow() {
  const {
    status,
    elapsed,
    countdown,
    info,
    region,
    locale,
    toggle,
    togglePause,
    clearInfo,
  } = useRecordingPipeline();
  const [dragging, setDragging] = useState(false);

  const t = makeT(locale);
  const recording = status === "recording" || status === "paused";
  const countingDown = status === "countdown";
  const regionLabel = region
    ? `${Math.round(region.width / (window.devicePixelRatio || 1))}×${Math.round(region.height / (window.devicePixelRatio || 1))}`
    : t.full;

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
        title={recording || countingDown ? t.stop : t.record}
      >
        {recording || countingDown ? <Square size={15} /> : <Play size={15} />}
        {!recording && !countingDown && <span className="rec-label">{t.rec}</span>}
      </button>
      {recording && (
        <button
          type="button"
          data-role="btn"
          className="rec-btn"
          onClick={togglePause}
          title={status === "paused" ? t.resume : t.pause}
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
        title={t.region}
        disabled={recording || countingDown}
      >
        <Crop size={15} />
      </button>
      <button
        type="button"
        data-role="btn"
        className="rec-btn"
        onClick={() => void onFull()}
        title={t.full}
        disabled={recording || countingDown}
      >
        <Monitor size={15} />
      </button>
      <span className="rec-region">{regionLabel}</span>
      {status === "saving" && <span className="rec-info">{t.savingMsg}</span>}
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

function makeT(locale: string) {
  if (locale === "zh") {
    return {
      rec: "开始",
      record: "开始录制",
      stop: "停止录制",
      pause: "暂停",
      resume: "继续",
      region: "框选区域",
      full: "全屏",
      savingMsg: "正在保存…",
    };
  }
  return {
    rec: "REC",
    record: "Record",
    stop: "Stop",
    pause: "Pause",
    resume: "Resume",
    region: "Select Region",
    full: "Full Screen",
    savingMsg: "Saving…",
  };
}
