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

/// Refresh the cached display scale used to convert mouse points → physical
/// pixels. Call when enabling tracking (cheap; avoids querying the display
/// list inside the event-tap callback).
#[cfg(target_os = "macos")]
pub fn refresh_mouse_scale(app: &AppHandle) {
    macos::refresh_cached_scale(app);
}

#[cfg(not(target_os = "macos"))]
pub fn start_keyboard_listener(_app: AppHandle) {
    eprintln!("Keyboard listener is not yet supported on this platform.");
}

/// Gate mouse coordinate emission from the event tap. No-op on platforms
/// where the event tap is not yet implemented (Linux/Windows: planned).
#[cfg(not(target_os = "macos"))]
pub fn set_mouse_tracking(_enabled: bool) {}

#[cfg(not(target_os = "macos"))]
pub fn refresh_mouse_scale(_app: &AppHandle) {}
