//! Single source of truth for `app://` event names on the Rust side.
//!
//! Mirrors `src/lib/events.ts`. Importing these constants instead of inline
//! `&str` literals lets the compiler catch a renamed event at every emit
//! site, and keeps Rust and TypeScript names from drifting.

#[allow(dead_code)]
pub mod evt {
    // Settings
    pub const SETTINGS_UPDATED: &str = "app://settings-updated";
    // Hotkey / tray action fan-out
    pub const HOTKEY_TRIGGERED: &str = "app://hotkey-triggered";
    // Camera
    pub const CAMERA_ERROR: &str = "app://camera-error";
    pub const CAMERA_REACQUIRE: &str = "app://camera-reacquire";
    // Keyboard display (macOS event tap)
    pub const KEY_PRESSED: &str = "app://key-pressed";
    pub const KEY_RELEASED: &str = "app://key-released";
    pub const ACCESSIBILITY_STATUS: &str = "app://accessibility-status";
    pub const EVENT_TAP_STATUS: &str = "app://event-tap-status";
    // Screen recording — mouse
    pub const MOUSE_DOWN: &str = "app://mouse-down";
    pub const MOUSE_UP: &str = "app://mouse-up";
    pub const MOUSE_MOVE: &str = "app://mouse-move";
    // Screen recording — orchestration
    pub const RECORDING_STATUS: &str = "app://recording-status";
    pub const REGION_STARTED: &str = "app://region-started";
    pub const REGION_SELECTED: &str = "app://region-selected";
    pub const REGION_CANCELED: &str = "app://region-canceled";
}
