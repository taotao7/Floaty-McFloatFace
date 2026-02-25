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

#[cfg(not(target_os = "macos"))]
pub fn start_keyboard_listener(_app: AppHandle) {
    eprintln!("Keyboard listener is not yet supported on this platform.");
}
