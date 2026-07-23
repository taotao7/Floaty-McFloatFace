export type ShapePreset = "circle" | "roundedSquare" | "mickey";
export type KeyboardDisplayStyle = "dark" | "light" | "glass" | "outline";
export type CursorEffectStyle = "ripple" | "ring" | "spark" | "none";

/**
 * Recording region in physical screen pixels, sharing the same coordinate
 * space as the global mouse coordinates emitted by the Rust event tap.
 * `undefined` means full screen.
 */
export interface RecordingRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Source-frame crop rectangle handed to `CanvasRenderingContext2D.drawImage`.
 * Mirrors `CropRect` from `lib/coords.ts`; duplicated here so the recording
 * metadata type can be self-contained without a runtime import cycle.
 */
export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** One sample of the recorded cursor trajectory, for post-capture zoom. */
export interface CursorSample {
  /** Milliseconds since recording start (`performance.now()` based). */
  t: number;
  /** Global physical screen pixels (same space as `MousePayload.x/y`). */
  x: number;
  y: number;
  /** Event kind. `down`/`up` always sampled; `move` is every system event. */
  type: "move" | "down" | "up";
  /** Mouse button, for click styling. Omitted for `move`. */
  button?: "left" | "right";
}

/**
 * Metadata persisted alongside a draft recording (`draft-<id>.json` sidecar).
 *
 * The recording canvas no longer bakes auto-zoom into the video; instead it
 * captures the raw region crop and records the cursor trajectory. The editor
 * and the export pipeline replay the trajectory to apply zoom after the fact,
 * which keeps the source clean (no smearing artifacts) and lets the user
 * toggle/retune zoom without re-recording.
 */
export interface RecordingMeta {
  /** Captured display-stream native resolution (`video.videoWidth/Height`). */
  captureWidth: number;
  captureHeight: number;
  /** Base crop rect (frame-local physical px) the draft video contains. */
  crop: CropRect;
  /** Device pixel ratio at capture time. */
  dpr: number;
  /** Recording region (null = full frame). */
  region: RecordingRegion | null;
  /** Cursor trajectory in global physical px, ordered by `t` ascending. */
  cursor: CursorSample[];
  /**
   * Scale from global physical px (trail/region space) to captured frame
   * px, computed at record time as videoWidth / monitor physical width.
   * `1` = frame is 1:1 physical; `<1` (e.g. 0.5 on a 2x display) means the
   * webview captured at 1x. Zoom replay must multiply trail coords by this
   * before localizing. Absent in old sidecars — treat as 1.
   */
  contentScale?: number;
  /** Raw capture-time numbers, for diagnosing mapping bugs from the editor
   *  caption without reproducing locally. Free-form; not read by replay. */
  debug?: Record<string, unknown>;
}

export interface CameraDevice {
  deviceId: string;
  label: string;
  groupId?: string;
}

export interface AppSettings {
  selectedCameraId?: string;
  shape: ShapePreset;
  scale: number;
  mirror: boolean;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  locked: boolean;
  qualityMode: "auto";
  beauty: boolean;
  beautySmoothness: number;
  beautyBrightness: number;
  locale: string;
  theme: "system" | "light" | "dark";
  keyboardDisplayEnabled: boolean;
  keyboardDisplayPosition: "bottom-center" | "top-center" | "bottom-left" | "bottom-right";
  keyboardDisplayScale: number;
  keyboardDisplayFadeOut: number;
  keyboardDisplayWidth: number;
  keyboardDisplayStyle: KeyboardDisplayStyle;
  recordingEnabled: boolean;
  recordingFps: number;
  recordingCursorOverlay: boolean;
  recordingAutoZoom: boolean;
  recordingZoomFactor: number;
  cursorEffectStyle: CursorEffectStyle;
  cursorTrailEnabled: boolean;
  recordingOutputDir?: string;

  // NOTE: `recordingRegion` deliberately does NOT live here. The recording
  // region is stored under its own store key (RECORDING_REGION_KEY) and
  // accessed via get_recording_region / confirm_region / reset_recording_region.
  // Keeping it out of AppSettings avoids rewriting the entire settings blob
  // mid-recording when the region changes. See CLAUDE.md / AGENTS.md.
}

export interface RuntimeState {
  visible: boolean;
  dragging: boolean;
  streamReady: boolean;
  permission: "unknown" | "granted" | "denied";
}

export const defaultSettings: AppSettings = {
  selectedCameraId: undefined,
  shape: "circle",
  scale: 1,
  mirror: true,
  alwaysOnTop: true,
  clickThrough: false,
  locked: false,
  qualityMode: "auto",
  beauty: false,
  beautySmoothness: 30,
  beautyBrightness: 50,
  locale: "",
  theme: "system",
  keyboardDisplayEnabled: true,
  keyboardDisplayPosition: "bottom-center",
  keyboardDisplayScale: 1,
  keyboardDisplayFadeOut: 2000,
  keyboardDisplayWidth: 800,
  keyboardDisplayStyle: "dark",
  recordingEnabled: true,
  recordingFps: 30,
  recordingCursorOverlay: true,
  recordingAutoZoom: false,
  recordingZoomFactor: 2,
  cursorEffectStyle: "ripple",
  cursorTrailEnabled: true,
  recordingOutputDir: undefined,
};

export interface KeyEvent {
  key: string;
  modifiers: string[];
  timestamp: number;
}
