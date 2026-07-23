import { Pause, Play } from "lucide-react";
import { Slider } from "../ui/slider";
import { useI18n } from "../../i18n";

interface PlaybackBarProps {
  /** Playhead position in seconds (absolute video time). */
  currentTime: number;
  /** Trim range [start, end] in seconds — the seek slider is bound to it. */
  range: [number, number];
  playing: boolean;
  disabled?: boolean;
  onTogglePlay: () => void;
  onSeek: (t: number) => void;
}

/**
 * Transport bar for the post-capture editor: play/pause + a draggable seek
 * slider clamped to the trim range + a segment-relative time readout. Pure
 * view — playback state and the video element stay owned by EditorWindow.
 */
export function PlaybackBar({
  currentTime,
  range,
  playing,
  disabled,
  onTogglePlay,
  onSeek,
}: PlaybackBarProps) {
  const t = useI18n();
  const [start, end] = range;
  const segLen = Math.max(0, end - start);
  const pos = Math.min(Math.max(currentTime - start, 0), segLen);

  return (
    <div className="editor-playback">
      <button
        type="button"
        className="editor-playback-btn"
        onClick={onTogglePlay}
        disabled={disabled}
        aria-label={playing ? t.editor_pause : t.editor_play}
      >
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <Slider
        value={[start + pos]}
        min={start}
        max={Math.max(end, start + 0.01)}
        step={0.01}
        disabled={disabled || segLen <= 0}
        onValueChange={(v) => onSeek(v[0] ?? start)}
      />
      <span className="editor-playback-time">
        {fmtTime(pos)} / {fmtTime(segLen)}
      </span>
    </div>
  );
}

export function fmtTime(sec: number): string {
  if (!isFinite(sec)) return "--:--";
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}
