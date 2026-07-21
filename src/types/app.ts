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
