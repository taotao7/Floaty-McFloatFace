use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyEventPayload {
    pub key: String,
    pub modifiers: Vec<String>,
    pub timestamp: u64,
}

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub fn start_keyboard_listener(app: AppHandle) {
    macos::start_keyboard_listener(app);
}

#[cfg(target_os = "macos")]
pub fn set_mouse_tracking(enabled: bool) {
    macos::set_mouse_tracking(enabled);
}

#[cfg(not(target_os = "macos"))]
pub fn start_keyboard_listener(_app: AppHandle) {
    eprintln!("Keyboard listener is not yet supported on this platform.");
}

/// Gate mouse coordinate emission from the event tap. No-op on platforms
/// where the event tap is not yet implemented (Linux/Windows: planned).
#[cfg(not(target_os = "macos"))]
pub fn set_mouse_tracking(_enabled: bool) {}
