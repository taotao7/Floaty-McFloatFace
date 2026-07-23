/**
 * Single source of truth for `app://` event names and their payload shapes.
 *
 * Before this module existed, every emit/listen site used an inline string
 * literal (`"app://settings-updated"`), which made event names impossible to
 * refactor safely and gave no compile-time check on payloads. Keep all event
 * identifiers here; import `EVT` for the name and the matching `*Payload`
 * type when emitting/listening.
 *
 * The Rust side mirrors these names in `src-tauri/src/events.rs`.
 */

export const EVT = {
  // Settings
  SETTINGS_UPDATED: "app://settings-updated",
  // Hotkey / tray action fan-out
  HOTKEY_TRIGGERED: "app://hotkey-triggered",
  // Camera
  CAMERA_ERROR: "app://camera-error",
  CAMERA_REACQUIRE: "app://camera-reacquire",
  // Keyboard display (macOS event tap)
  KEY_PRESSED: "app://key-pressed",
  KEY_RELEASED: "app://key-released",
  ACCESSIBILITY_STATUS: "app://accessibility-status",
  EVENT_TAP_STATUS: "app://event-tap-status",
  // Screen recording — mouse
  MOUSE_DOWN: "app://mouse-down",
  MOUSE_UP: "app://mouse-up",
  MOUSE_MOVE: "app://mouse-move",
  // Screen recording — orchestration
  RECORDING_STATUS: "app://recording-status",
  /** Control-bar → pipeline commands. The pipeline lives in the MAIN camera
   *  window (so camera + screen capture share one document and WebKit's
   *  one-capture-per-page mute policy never fires); the recording bar is a
   *  remote control that sends actions here. */
  RECORDING_CMD: "app://recording-cmd",
  /** Pipeline → control-bar UI state broadcast (status/elapsed/countdown/
   *  info). Emitted on every change and in response to a `sync` command. */
  RECORDING_UI: "app://recording-ui",
  REGION_STARTED: "app://region-started",
  REGION_SELECTED: "app://region-selected",
  REGION_CANCELED: "app://region-canceled",
} as const;

export type EventName = (typeof EVT)[keyof typeof EVT];

// --- Payload shapes (kept loose where payloads are simple) ---

export interface HotkeyPayload {
  action: string;
}

export interface CameraErrorPayload {
  message: string;
}

export interface KeyPayload {
  key: string;
  modifiers: string[];
  timestamp: number;
}

export interface MousePayload {
  /** Physical screen pixels (global). */
  x: number;
  /** Physical screen pixels (global). */
  y: number;
  /** "left" | "right" | "" (move). */
  button: string;
  timestamp: number;
}

export interface RecordingStatusPayload {
  active: boolean;
}

export interface RecordingCmdPayload {
  /** `sync` asks the pipeline to re-broadcast its current UI state (used by
   *  the control bar on mount, since it may open after state was set). */
  action: "toggle" | "toggle-pause" | "clear-info" | "sync";
}

export interface RecordingUiPayload {
  status: "idle" | "countdown" | "recording" | "paused" | "saving";
  elapsed: number;
  countdown: number;
  info: string;
}

export interface PermissionStatusPayload {
  granted: boolean;
}

export interface EventTapStatusPayload {
  active: boolean;
}
