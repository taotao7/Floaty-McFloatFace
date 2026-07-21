use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Emitter, Manager, PhysicalPosition, Size, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;

mod events;
mod recording;
use events::evt;

/// Application-wide state. Currently holds the single source of truth for
/// "is recording active", queryable from any window via `get_recording_state`.
/// Registered with `.manage()` — this is the only managed state in the app.
#[derive(Default)]
pub struct AppState {
    pub recording_active: AtomicBool,
}

/// Check whether a point (top-left of a window of the given size) lands on any
/// currently connected monitor. Prevents restoring a position that was saved
/// under a different display layout (e.g. an external monitor was unplugged)
/// from placing the window off-screen, where it would be invisible.
fn is_position_on_screen(app: &AppHandle, x: f64, y: f64, width: f64, height: f64) -> bool {
    let Ok(monitors) = app.available_monitors() else {
        return true; // be permissive if we can't enumerate
    };
    if monitors.is_empty() {
        return true;
    }
    monitors.iter().any(|monitor| {
        let pos = monitor.position();
        let size = monitor.size();
        let mon_min_x = pos.x as f64;
        let mon_min_y = pos.y as f64;
        let mon_max_x = mon_min_x + size.width as f64;
        let mon_max_y = mon_min_y + size.height as f64;
        // Require at least a small portion of the window to overlap the monitor.
        x < mon_max_x && (x + width) > mon_min_x && y < mon_max_y && (y + height) > mon_min_y
    })
}

mod keyboard;

const STORE_FILE: &str = "settings.json";
const SETTINGS_KEY: &str = "app_settings";
const POSITION_KEY: &str = "window_position";
const KEYBOARD_POSITION_KEY: &str = "keyboard_position";
const RECORDING_POSITION_KEY: &str = "recording_position";
const RECORDING_REGION_KEY: &str = "recording_region";
const MAIN_WINDOW_LABEL: &str = "main";
const SETTINGS_WINDOW_LABEL: &str = "settings";
const KEYBOARD_WINDOW_LABEL: &str = "keyboard";
const RECORDING_WINDOW_LABEL: &str = "recording";
const REGION_WINDOW_LABEL: &str = "region-select";
const CURSOR_WINDOW_LABEL: &str = "cursor-overlay";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraDevice {
    pub device_id: String,
    pub label: String,
    pub group_id: Option<String>,
}

/// Recording region in physical screen pixels. Same coordinate space as the
/// mouse coordinates emitted by the event tap. Stored separately from
/// AppSettings so it can be read/written without rewriting the whole settings
/// blob during region selection.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingRegion {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ShapePreset {
    Circle,
    RoundedSquare,
    Mickey,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub selected_camera_id: Option<String>,
    pub shape: ShapePreset,
    pub scale: f64,
    pub mirror: bool,
    pub always_on_top: bool,
    pub click_through: bool,
    pub locked: bool,
    pub quality_mode: String,
    #[serde(default)]
    pub beauty: bool,
    #[serde(default = "default_beauty_smoothness")]
    pub beauty_smoothness: f64,
    #[serde(default = "default_beauty_brightness")]
    pub beauty_brightness: f64,
    #[serde(default = "default_locale")]
    pub locale: String,
    #[serde(default)]
    pub keyboard_display_enabled: bool,
    #[serde(default = "default_keyboard_position")]
    pub keyboard_display_position: String,
    #[serde(default = "default_keyboard_scale")]
    pub keyboard_display_scale: f64,
    #[serde(default = "default_keyboard_fade_out")]
    pub keyboard_display_fade_out: u64,
    #[serde(default = "default_keyboard_width")]
    pub keyboard_display_width: f64,
    #[serde(default = "default_keyboard_style")]
    pub keyboard_display_style: String,
    // --- Screen recording ---
    #[serde(default = "default_recording_enabled")]
    pub recording_enabled: bool,
    #[serde(default = "default_recording_fps")]
    pub recording_fps: u32,
    #[serde(default = "default_recording_cursor_overlay")]
    pub recording_cursor_overlay: bool,
    #[serde(default)]
    pub recording_auto_zoom: bool,
    #[serde(default = "default_recording_zoom_factor")]
    pub recording_zoom_factor: f64,
    #[serde(default = "default_cursor_effect_style")]
    pub cursor_effect_style: String,
    #[serde(default = "default_cursor_trail_enabled")]
    pub cursor_trail_enabled: bool,
    #[serde(default)]
    pub recording_output_dir: Option<String>,
}

fn default_recording_fps() -> u32 {
    30
}

fn default_recording_enabled() -> bool {
    true
}

fn default_recording_cursor_overlay() -> bool {
    true
}

fn default_recording_zoom_factor() -> f64 {
    2.0
}

fn default_cursor_effect_style() -> String {
    "ripple".to_string()
}

fn default_cursor_trail_enabled() -> bool {
    true
}

fn default_keyboard_position() -> String {
    "bottom-center".to_string()
}

fn default_keyboard_scale() -> f64 {
    1.0
}

fn default_keyboard_fade_out() -> u64 {
    2000
}

fn default_keyboard_width() -> f64 {
    800.0
}

fn default_keyboard_style() -> String {
    "dark".to_string()
}

fn default_beauty_smoothness() -> f64 {
    30.0
}

fn default_beauty_brightness() -> f64 {
    50.0
}

fn default_locale() -> String {
    "en".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            selected_camera_id: None,
            shape: ShapePreset::Circle,
            scale: 1.0,
            mirror: true,
            always_on_top: true,
            click_through: false,
            locked: false,
            quality_mode: "auto".to_string(),
            beauty: false,
            beauty_smoothness: 30.0,
            beauty_brightness: 50.0,
            locale: "en".to_string(),
            keyboard_display_enabled: true,
            keyboard_display_position: "bottom-center".to_string(),
            keyboard_display_scale: 1.0,
            keyboard_display_fade_out: 2000,
            keyboard_display_width: 800.0,
            keyboard_display_style: "dark".to_string(),
            recording_enabled: true,
            recording_fps: 30,
            recording_cursor_overlay: true,
            recording_auto_zoom: false,
            recording_zoom_factor: 2.0,
            cursor_effect_style: "ripple".to_string(),
            cursor_trail_enabled: true,
            recording_output_dir: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HotkeyTriggeredPayload {
    action: String,
}

fn emit_hotkey(app: &AppHandle, action: &str) {
    let payload = HotkeyTriggeredPayload {
        action: action.to_string(),
    };
    let _ = app.emit(evt::HOTKEY_TRIGGERED, payload);
}

fn normalized_settings(mut settings: AppSettings) -> AppSettings {
    settings.scale = settings.scale.clamp(0.6, 1.8);
    settings.quality_mode = "auto".to_string();
    settings
}

fn shape_size(shape: &ShapePreset, scale: f64) -> (f64, f64) {
    let base = 320.0 * scale.clamp(0.6, 1.8);
    match shape {
        ShapePreset::Circle => (base, base),
        ShapePreset::RoundedSquare => (base, base),
        ShapePreset::Mickey => (base, base),
    }
}

fn apply_main_window_size(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Ok(());
    };

    let (width, height) = shape_size(&settings.shape, settings.scale);
    main.set_size(Size::Logical(tauri::LogicalSize::new(width, height)))
        .map_err(|err| err.to_string())?;

    Ok(())
}

fn read_settings_from_store(app: &AppHandle) -> Result<AppSettings, String> {
    let store = app.store(STORE_FILE).map_err(|err| err.to_string())?;

    if let Some(value) = store.get(SETTINGS_KEY) {
        return serde_json::from_value(value.clone()).map_err(|err| err.to_string());
    }

    Ok(AppSettings::default())
}

fn save_settings_to_store(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|err| err.to_string())?;
    let value = serde_json::to_value(settings).map_err(|err| err.to_string())?;

    store.set(SETTINGS_KEY, value);
    store.save().map_err(|err| err.to_string())?;

    Ok(())
}

fn apply_window_behavior(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Ok(());
    };

    main.set_always_on_top(settings.always_on_top)
        .map_err(|err| err.to_string())?;
    main.set_ignore_cursor_events(settings.click_through)
        .map_err(|err| err.to_string())?;

    Ok(())
}

#[tauri::command]
fn list_cameras() -> Vec<CameraDevice> {
    Vec::new()
}

#[tauri::command]
fn get_app_settings(app: AppHandle) -> Result<AppSettings, String> {
    read_settings_from_store(&app)
}

#[tauri::command]
fn save_app_settings(app: AppHandle, payload: AppSettings) -> Result<(), String> {
    let payload = normalized_settings(payload);
    save_settings_to_store(&app, &payload)?;
    apply_window_behavior(&app, &payload)?;
    apply_main_window_size(&app, &payload)?;
    update_tray_locale(&app, &payload.locale);

    app.emit(evt::SETTINGS_UPDATED, payload)
        .map_err(|err| err.to_string())?;

    Ok(())
}

#[tauri::command]
fn apply_window_shape(app: AppHandle, payload: ShapePreset) -> Result<(), String> {
    let mut settings = read_settings_from_store(&app)?;
    settings.shape = payload;
    save_app_settings(app, settings)
}

#[tauri::command]
fn set_always_on_top(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = read_settings_from_store(&app)?;
    settings.always_on_top = enabled;
    save_app_settings(app, settings)
}

#[tauri::command]
fn set_click_through(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = read_settings_from_store(&app)?;
    settings.click_through = enabled;
    save_app_settings(app, settings)
}

#[tauri::command]
fn toggle_main_window_visibility(app: AppHandle) -> Result<(), String> {
    let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Ok(());
    };

    if main.is_visible().map_err(|err| err.to_string())? {
        main.hide().map_err(|err| err.to_string())?;
        emit_hotkey(&app, "toggle_visibility");
        return Ok(());
    }

    main.show().map_err(|err| err.to_string())?;
    let _ = main.set_focus();
    emit_hotkey(&app, "toggle_visibility");

    Ok(())
}

#[tauri::command]
fn open_settings_window(app: AppHandle) -> Result<(), String> {
    // If already open, just focus it
    if let Some(win) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        win.show().map_err(|e| e.to_string())?;
        let _ = win.set_focus();
        return Ok(());
    }

    // Create new settings window
    let win = WebviewWindowBuilder::new(
        &app,
        SETTINGS_WINDOW_LABEL,
        WebviewUrl::App("settings.html".into()),
    )
    .title("Floaty Settings")
    .inner_size(460.0, 760.0)
    .min_inner_size(420.0, 680.0)
    .resizable(true)
    .center()
    .build()
    .map_err(|e| e.to_string())?;

    #[cfg(debug_assertions)]
    win.open_devtools();

    emit_hotkey(&app, "open_settings");
    Ok(())
}

#[tauri::command]
fn start_drag_main_window(app: AppHandle) -> Result<(), String> {
    let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Ok(());
    };

    main.start_dragging().map_err(|err| err.to_string())
}

#[tauri::command]
fn open_camera_privacy_settings() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Camera")
            .spawn();
    }
}

#[tauri::command]
fn toggle_keyboard_window(app: AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        // Create keyboard window if not exists
        if app.get_webview_window(KEYBOARD_WINDOW_LABEL).is_none() {
            let settings = read_settings_from_store(&app).unwrap_or_default();
            let width = settings.keyboard_display_width.clamp(400.0, 1400.0);
            let scale = settings.keyboard_display_scale.clamp(0.5, 2.0);
            let height = (80.0 * scale).round();
            // Width/height are computed here from settings; the factory stays
            // generic and only knows about raw dimensions.
            build_overlay_window(
                &app,
                OverlayWindowSpec {
                    label: KEYBOARD_WINDOW_LABEL,
                    url: "keyboard.html",
                    title: "Keyboard Display",
                    width,
                    height,
                    resizable: false,
                    position_key: Some(KEYBOARD_POSITION_KEY),
                    anchor_origin: None,
                    click_through: false,
                },
            )?;
        } else if let Some(win) = app.get_webview_window(KEYBOARD_WINDOW_LABEL) {
            win.show().map_err(|e| e.to_string())?;
        }
    } else {
        // Hide keyboard window
        if let Some(win) = app.get_webview_window(KEYBOARD_WINDOW_LABEL) {
            win.hide().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Screen recording commands
// ---------------------------------------------------------------------------

/// Spec for [`build_overlay_window`]. Bundles every knob the four overlay
/// windows (recording / keyboard / region-select / cursor) need, so they
/// all share one code path instead of hand-rolling ~70 lines of builder
/// boilerplate each.
struct OverlayWindowSpec<'a> {
    label: &'a str,
    url: &'a str,
    title: &'a str,
    width: f64,
    height: f64,
    resizable: bool,
    /// Store key under which the window position is persisted.
    /// `None` for windows that are always re-anchored (region/cursor full-screen).
    position_key: Option<&'a str>,
    /// Pin the window to this screen origin instead of restoring a saved
    /// position. Used by the full-screen region-select and cursor overlays.
    anchor_origin: Option<(f64, f64)>,
    /// Make the window click-through (cursor overlay only).
    click_through: bool,
}

/// Build a transparent borderless always-on-top window from a spec. Shared by
/// the recording control bar, the keyboard window, the region-select
/// overlay, and the cursor overlay. Restores the saved position when no
/// anchor is requested and the position still lands on a connected screen.
fn build_overlay_window(
    app: &AppHandle,
    spec: OverlayWindowSpec,
) -> Result<tauri::WebviewWindow, String> {
    let mut builder = WebviewWindowBuilder::new(
        app,
        spec.label,
        WebviewUrl::App(spec.url.into()),
    )
    .title(spec.title)
    .inner_size(spec.width, spec.height)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(spec.resizable);

    // Full-screen-anchored windows (region-select, cursor overlay) skip the
    // saved-position restore and center fallback; they pin to (0,0).
    let pinned = spec.anchor_origin.is_some();
    if let Some((x, y)) = spec.anchor_origin {
        builder = builder.position(x, y);
    }

    // Restore saved position if it still overlaps a connected monitor.
    let has_saved_position = if !pinned {
        if let Some(key) = spec.position_key {
            if let Ok(store) = app.store(STORE_FILE) {
                if let Some(pos) = store.get(key) {
                    if let (Some(x), Some(y)) = (pos.get("x").and_then(|v| v.as_f64()), pos.get("y").and_then(|v| v.as_f64())) {
                        is_position_on_screen(app, x, y, spec.width, spec.height)
                    } else {
                        false
                    }
                } else {
                    false
                }
            } else {
                false
            }
        } else {
            false
        }
    } else {
        false
    };

    if !pinned && !has_saved_position {
        builder = builder.center();
    }

    let win = builder.build().map_err(|e| e.to_string())?;

    if !pinned && has_saved_position {
        if let Some(key) = spec.position_key {
            if let Ok(store) = app.store(STORE_FILE) {
                if let Some(pos) = store.get(key) {
                    if let (Some(x), Some(y)) = (pos.get("x").and_then(|v| v.as_f64()), pos.get("y").and_then(|v| v.as_f64())) {
                        let _ = win.set_position(PhysicalPosition::new(x as i32, y as i32));
                    }
                }
            }
        }
    }

    if spec.click_through {
        let _ = win.set_ignore_cursor_events(true);
    }

    // Persist position on move, but only for windows that opt into it.
    if let Some(key) = spec.position_key {
        if !pinned {
            let handle = app.clone();
            let key = key.to_string();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::Moved(pos) = event {
                    if let Ok(store) = handle.store(STORE_FILE) {
                        let val = serde_json::json!({ "x": pos.x, "y": pos.y });
                        store.set(&key, val);
                        let _ = store.save();
                    }
                }
            });
        }
    }

    Ok(win)
}

#[tauri::command]
fn toggle_recording_window(app: AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        if app.get_webview_window(RECORDING_WINDOW_LABEL).is_none() {
            // Small floating control bar; size matches the inner layout.
            build_overlay_window(
                &app,
                OverlayWindowSpec {
                    label: RECORDING_WINDOW_LABEL,
                    url: "recording.html",
                    title: "Floaty Recording",
                    width: 430.0,
                    height: 52.0,
                    resizable: false,
                    position_key: Some(RECORDING_POSITION_KEY),
                    anchor_origin: None,
                    click_through: false,
                },
            )?;
        } else if let Some(win) = app.get_webview_window(RECORDING_WINDOW_LABEL) {
            win.show().map_err(|e| e.to_string())?;
            let _ = win.set_focus();
        }
    } else if let Some(win) = app.get_webview_window(RECORDING_WINDOW_LABEL) {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn start_region_select(app: AppHandle) -> Result<(), String> {
    // Use the primary monitor dimensions to size the region-select overlay.
    let (w, h) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| (m.size().width as f64, m.size().height as f64))
        .unwrap_or((1920.0, 1080.0));

    // If the window exists already, reuse and reposition it.
    if let Some(win) = app.get_webview_window(REGION_WINDOW_LABEL) {
        win.set_size(Size::Physical(tauri::PhysicalSize::new(w as u32, h as u32)))
            .map_err(|e| e.to_string())?;
        win.set_position(PhysicalPosition::new(0, 0))
            .map_err(|e| e.to_string())?;
        win.show().map_err(|e| e.to_string())?;
        let _ = win.set_focus();
    } else {
        let win = build_overlay_window(
            &app,
            OverlayWindowSpec {
                label: REGION_WINDOW_LABEL,
                url: "region.html",
                title: "Select Recording Region",
                width: w,
                height: h,
                resizable: false,
                position_key: None,
                anchor_origin: Some((0.0, 0.0)),
                click_through: false,
            },
        )?;
        let _ = win.set_focus();
    }

    let _ = app.emit(evt::REGION_STARTED, ());
    Ok(())
}

#[tauri::command]
fn confirm_region(app: AppHandle, region: RecordingRegion) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let value = serde_json::to_value(region).map_err(|e| e.to_string())?;
    store.set(RECORDING_REGION_KEY, value);
    store.save().map_err(|e| e.to_string())?;

    if let Some(win) = app.get_webview_window(REGION_WINDOW_LABEL) {
        let _ = win.hide();
    }
    let _ = app.emit(evt::REGION_SELECTED, region);
    Ok(())
}

#[tauri::command]
fn cancel_region_select(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(REGION_WINDOW_LABEL) {
        let _ = win.hide();
    }
    let _ = app.emit(evt::REGION_CANCELED, ());
    Ok(())
}

#[tauri::command]
fn reset_recording_region(app: AppHandle) -> Result<(), String> {
    if let Ok(store) = app.store(STORE_FILE) {
        store.delete(RECORDING_REGION_KEY);
        let _ = store.save();
    }
    let _ = app.emit(evt::REGION_SELECTED, serde_json::json!(null));
    Ok(())
}

#[tauri::command]
fn set_cursor_overlay(app: AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        // Full-screen overlay anchored at the primary monitor origin.
        let (w, h) = app
            .primary_monitor()
            .ok()
            .flatten()
            .map(|m| (m.size().width as f64, m.size().height as f64))
            .unwrap_or((1920.0, 1080.0));

        if app.get_webview_window(CURSOR_WINDOW_LABEL).is_none() {
            // click_through is applied by the factory itself.
            let _ = build_overlay_window(
                &app,
                OverlayWindowSpec {
                    label: CURSOR_WINDOW_LABEL,
                    url: "cursor.html",
                    title: "Cursor Overlay",
                    width: w,
                    height: h,
                    resizable: false,
                    position_key: None,
                    anchor_origin: Some((0.0, 0.0)),
                    click_through: true,
                },
            )?;
        } else {
            let win = app.get_webview_window(CURSOR_WINDOW_LABEL).unwrap();
            let _ = win.set_size(Size::Physical(tauri::PhysicalSize::new(w as u32, h as u32)));
            let _ = win.set_position(PhysicalPosition::new(0, 0));
            win.show().map_err(|e| e.to_string())?;
        }
        // Enable mouse coordinate emission from the event tap.
        keyboard::set_mouse_tracking(true);
    } else {
        keyboard::set_mouse_tracking(false);
        if let Some(win) = app.get_webview_window(CURSOR_WINDOW_LABEL) {
            let _ = win.hide();
        }
    }
    Ok(())
}

#[tauri::command]
fn set_mouse_tracking_enabled(enabled: bool) {
    keyboard::set_mouse_tracking(enabled);
}

#[tauri::command]
fn get_recording_region(app: AppHandle) -> Option<RecordingRegion> {
    let store = app.store(STORE_FILE).ok()?;
    let value = store.get(RECORDING_REGION_KEY)?;
    serde_json::from_value(value).ok()
}

/// Single source of truth for "is recording active". Any window can query it
/// via `get_recording_state`; the recording pipeline flips it via
/// `set_recording_state`, which also broadcasts `app://recording-status` so
/// listeners (tray menu text, settings indicator) stay in sync without each
/// window tracking the state locally.
#[tauri::command]
fn get_recording_state(state: State<AppState>) -> bool {
    state.recording_active.load(Ordering::SeqCst)
}

/// Flip the recording-active flag and broadcast the change. Returns the
/// previous value so callers can detect transitions. Not a `#[tauri::command]`
/// — it is called from Rust commands that already hold the handle + state.
#[allow(dead_code)]
fn set_recording_state(app: &AppHandle, state: &AppState, active: bool) -> bool {
    let prev = state.recording_active.swap(active, Ordering::SeqCst);
    if prev != active {
        let _ = app.emit(evt::RECORDING_STATUS, serde_json::json!({ "active": active }));
    }
    prev
}

#[tauri::command]
async fn save_recording(app: AppHandle, bytes: Vec<u8>, suggested_name: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    // Resolve the default directory from the user's setting (or the platform
    // default). Naming policy lives in the store module; fall back to it when
    // the frontend did not provide a name.
    let settings = read_settings_from_store(&app).unwrap_or_default();
    let default_dir = recording::store::resolve_output_dir(settings.recording_output_dir.as_deref());

    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let name = {
        let trimmed = suggested_name.trim();
        if trimmed.is_empty() {
            recording::store::make_filename("floaty", &recording::store::timestamp_parts(secs))
        } else {
            trimmed.to_string()
        }
    };

    // blocking_save_file must run off the main thread; spawn_blocking ensures
    // that even though Tauri async commands may otherwise borrow main-thread
    // time. Returns the chosen path or None if the user cancelled.
    let chosen = tauri::async_runtime::spawn_blocking(move || -> Result<Option<std::path::PathBuf>, String> {
        let mut builder = app
            .dialog()
            .file()
            .add_filter("Video", &["mp4", "webm"])
            .set_file_name(&name);
        if let Some(dir) = default_dir.as_deref() {
            builder = builder.set_directory(dir);
        }
        let path = builder.blocking_save_file();
        // into_path() returns Result<PathBuf, _>; flatten.
        Ok(match path {
            Some(p) => Some(p.into_path().map_err(|e| e.to_string())?),
            None => None,
        })
    })
    .await
    .map_err(|e| e.to_string())??;

    let Some(path) = chosen else {
        return Ok(None);
    };

    recording::store::write_recording(&path, &bytes)?;
    Ok(path.to_str().map(|s| s.to_string()))
}

// --- Recording editor (post-capture trim/export) ---

const EDITOR_WINDOW_LABEL: &str = "editor";
const EDITOR_DRAFT_KEY: &str = "editor_draft_path";

/// Directory holding un-edited recordings between capture and export.
/// Lives in the OS temp dir; drafts older than 24h are pruned on write.
fn drafts_dir() -> std::path::PathBuf {
    std::env::temp_dir().join("floaty-drafts")
}

/// Persist a freshly-recorded clip as a draft and remember it as the editor's
/// current source. Returns the draft path.
#[tauri::command]
async fn save_recording_draft(app: AppHandle, bytes: Vec<u8>, ext: String) -> Result<String, String> {
    let dir = drafts_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Prune stale drafts so abandoned edits don't pile up (recordings are big).
    if let Ok(entries) = std::fs::read_dir(&dir) {
        let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(24 * 3600);
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.modified().map(|m| m < cutoff).unwrap_or(false) {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
    let ext = if ext == "webm" { "webm" } else { "mp4" };
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = dir.join(format!("draft-{}.{}", millis, ext));
    recording::store::write_recording(&path, &bytes)?;

    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(EDITOR_DRAFT_KEY, serde_json::json!(path.to_str().unwrap_or_default()));
    let _ = store.save();
    Ok(path.to_str().unwrap_or_default().to_string())
}

/// The draft path the editor window should load (set by save_recording_draft).
#[tauri::command]
async fn get_editor_draft_path(app: AppHandle) -> Option<String> {
    let store = app.store(STORE_FILE).ok()?;
    store.get(EDITOR_DRAFT_KEY)?.as_str().map(|s| s.to_string())
}

/// Read a draft back for the editor preview. Restricted to the drafts dir so
/// the editor can't exfiltrate arbitrary files. Returned as raw bytes (Tauri
/// v2 binary response — avoids JSON-encoding megabytes of video).
#[tauri::command]
async fn read_recording_file(path: String) -> Result<tauri::ipc::Response, String> {
    let p = std::path::PathBuf::from(&path);
    if !p.starts_with(drafts_dir()) {
        return Err("path is outside the drafts directory".to_string());
    }
    let data = std::fs::read(&p).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(data))
}

/// Delete a draft after a successful export or when the user discards it.
#[tauri::command]
async fn delete_recording_draft(path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if p.starts_with(drafts_dir()) {
        let _ = std::fs::remove_file(&p);
    }
    Ok(())
}

/// Open (or replace) the editor window for post-capture trim/export.
#[tauri::command]
async fn open_editor_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(EDITOR_WINDOW_LABEL) {
        // Rebuild so a freshly-saved draft is always loaded from scratch.
        let _ = win.destroy();
    }
    let win = WebviewWindowBuilder::new(
        &app,
        EDITOR_WINDOW_LABEL,
        WebviewUrl::App("editor.html".into()),
    )
    .title("Floaty Editor")
    .inner_size(980.0, 700.0)
    .min_inner_size(760.0, 560.0)
    .resizable(true)
    .center()
    .build()
    .map_err(|e| e.to_string())?;
    win.show().map_err(|e| e.to_string())?;
    let _ = win.set_focus();
    Ok(())
}

fn toggle_lock_state(app: &AppHandle) -> Result<(), String> {
    let mut settings = read_settings_from_store(app)?;
    settings.locked = !settings.locked;
    save_app_settings(app.clone(), settings)
}

fn tray_text(locale: &str) -> (&'static str, &'static str, &'static str, &'static str, &'static str, &'static str) {
    match locale {
        "zh-CN" => ("显示/隐藏摄像头窗", "打开设置", "锁定/解锁拖拽", "显示/隐藏按键", "开始/停止录制", "退出"),
        _ => ("Show/Hide Camera", "Open Settings", "Lock/Unlock Drag", "Show/Hide Keys", "Start/Stop Recording", "Quit"),
    }
}

fn build_tray_menu(app: &AppHandle, locale: &str) -> Result<Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let (show_text, settings_text, lock_text, keyboard_text, recording_text, quit_text) = tray_text(locale);

    let show_toggle = MenuItem::new(app, show_text, true, None::<&str>)?;
    let open_settings = MenuItem::new(app, settings_text, true, None::<&str>)?;
    let toggle_lock = MenuItem::new(app, lock_text, true, None::<&str>)?;
    let toggle_keyboard = MenuItem::new(app, keyboard_text, true, None::<&str>)?;
    let toggle_recording = MenuItem::new(app, recording_text, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::new(app, quit_text, true, None::<&str>)?;

    let show_id = show_toggle.id().clone();
    let settings_id = open_settings.id().clone();
    let lock_id = toggle_lock.id().clone();
    let keyboard_id = toggle_keyboard.id().clone();
    let recording_id = toggle_recording.id().clone();
    let quit_id = quit.id().clone();

    let menu = Menu::with_items(
        app,
        &[&show_toggle, &open_settings, &toggle_lock, &toggle_keyboard, &toggle_recording, &separator, &quit],
    )?;

    // Store item IDs in app state for event matching
    if let Ok(store) = app.store(STORE_FILE) {
        let ids = serde_json::json!({
            "toggle_visibility": show_id.as_ref(),
            "open_settings": settings_id.as_ref(),
            "toggle_lock": lock_id.as_ref(),
            "toggle_keyboard": keyboard_id.as_ref(),
            "toggle_recording": recording_id.as_ref(),
            "quit": quit_id.as_ref(),
        });
        store.set("_tray_menu_ids", ids);
    }

    Ok(menu)
}

fn resolve_tray_action(app: &AppHandle, event_id: &str) -> Option<&'static str> {
    let store = app.store(STORE_FILE).ok()?;
    let ids = store.get("_tray_menu_ids")?;
    let map = ids.as_object()?;
    for (action, id_val) in map {
        if id_val.as_str() == Some(event_id) {
            return match action.as_str() {
                "toggle_visibility" => Some("toggle_visibility"),
                "open_settings" => Some("open_settings"),
                "toggle_lock" => Some("toggle_lock"),
                "toggle_keyboard" => Some("toggle_keyboard"),
                "toggle_recording" => Some("toggle_recording"),
                "quit" => Some("quit"),
                _ => None,
            };
        }
    }
    None
}

fn update_tray_locale(app: &AppHandle, locale: &str) {
    if let Ok(menu) = build_tray_menu(app, locale) {
        if let Some(tray) = app.tray_by_id("floaty-tray") {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

fn setup_tray(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let settings = read_settings_from_store(&app.handle()).unwrap_or_default();
    let menu = build_tray_menu(&app.handle(), &settings.locale)?;

    TrayIconBuilder::with_id("floaty-tray")
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?)
        .tooltip("Floaty McFloatFace")
        .menu(&menu)
        .on_menu_event(|app, event| {
            let action = resolve_tray_action(app, event.id().as_ref());
            match action {
                Some("toggle_visibility") => {
                    let _ = toggle_main_window_visibility(app.clone());
                }
                Some("open_settings") => {
                    let _ = open_settings_window(app.clone());
                }
                Some("toggle_lock") => {
                    let _ = toggle_lock_state(app);
                    emit_hotkey(app, "toggle_lock");
                }
                Some("toggle_keyboard") => {
                    let mut settings = read_settings_from_store(app).unwrap_or_default();
                    settings.keyboard_display_enabled = !settings.keyboard_display_enabled;
                    let enabled = settings.keyboard_display_enabled;
                    let _ = toggle_keyboard_window(app.clone(), enabled);
                    let _ = save_app_settings(app.clone(), settings);
                }
                Some("toggle_recording") => {
                    // The recording control bar must be visible to act on the
                    // hotkey action; ensure it's open, then fire the toggle.
                    let mut settings = read_settings_from_store(app).unwrap_or_default();
                    if !settings.recording_enabled {
                        settings.recording_enabled = true;
                        let _ = toggle_recording_window(app.clone(), true);
                        let _ = save_app_settings(app.clone(), settings);
                    }
                    // State query is informational here; the frontend owns the
                    // start/stop decision via the hotkey-triggered event.
                    if let Some(state) = app.try_state::<AppState>() {
                        let _was = state.recording_active.load(Ordering::SeqCst);
                    }
                    emit_hotkey(app, "toggle_recording");
                }
                Some("quit") => app.exit(0),
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}

fn setup_windows(app: &App) -> Result<(), String> {
    let settings = read_settings_from_store(&app.handle())?;

    apply_window_behavior(&app.handle(), &settings)?;
    apply_main_window_size(&app.handle(), &settings)?;

    // Restore main window position (only if it still lands on a connected screen)
    if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let handle = app.handle();
        let store = handle.store(STORE_FILE).map_err(|e| e.to_string())?;
        if let Some(pos) = store.get(POSITION_KEY) {
            if let (Some(x), Some(y)) = (pos.get("x").and_then(|v| v.as_f64()), pos.get("y").and_then(|v| v.as_f64())) {
                // Use current window size to test overlap; fall back to a small
                // size if it can't be read so we still validate the origin point.
                let (w, h) = main
                    .outer_size()
                    .map(|s| (s.width as f64, s.height as f64))
                    .unwrap_or((100.0, 100.0));
                if is_position_on_screen(handle, x, y, w, h) {
                    let _ = main.set_position(PhysicalPosition::new(x as i32, y as i32));
                }
                // If off-screen, skip restore so the window keeps its declared
                // default position from tauri.conf.json.
            }
        }

        // Save position on move
        let handle = app.handle().clone();
        main.on_window_event(move |event| {
            if let tauri::WindowEvent::Moved(pos) = event {
                if let Ok(store) = handle.store(STORE_FILE) {
                    let val = serde_json::json!({ "x": pos.x, "y": pos.y });
                    store.set(POSITION_KEY, val);
                    let _ = store.save();
                }
            }
        });
    }

    #[cfg(debug_assertions)]
    {
        if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            main.open_devtools();
        }
        if let Some(settings) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
            settings.open_devtools();
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            setup_windows(app).map_err(|err| -> Box<dyn std::error::Error> { err.into() })?;
            setup_tray(app)?;
            
            // Start keyboard listener
            keyboard::start_keyboard_listener(app.handle().clone());

            // Auto-open keyboard window on startup
            if let Err(e) = toggle_keyboard_window(app.handle().clone(), true) {
                eprintln!("Failed to open keyboard window: {}", e);
            }

            // Restore the recording control bar on startup when enabled —
            // otherwise it only ever appears after a tray/hotkey toggle.
            let recording_enabled = read_settings_from_store(&app.handle())
                .map(|s| s.recording_enabled)
                .unwrap_or(false);
            if recording_enabled {
                if let Err(e) = toggle_recording_window(app.handle().clone(), true) {
                    eprintln!("Failed to open recording window: {}", e);
                }
            }

            #[cfg(debug_assertions)]
            {
                if let Some(kb) = app.get_webview_window(KEYBOARD_WINDOW_LABEL) {
                    kb.open_devtools();
                }
            }

            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_cameras,
            get_app_settings,
            save_app_settings,
            apply_window_shape,
            set_always_on_top,
            set_click_through,
            toggle_main_window_visibility,
            open_settings_window,
            start_drag_main_window,
            toggle_keyboard_window,
            open_camera_privacy_settings,
            // Screen recording
            toggle_recording_window,
            start_region_select,
            confirm_region,
            cancel_region_select,
            reset_recording_region,
            set_cursor_overlay,
            set_mouse_tracking_enabled,
            get_recording_region,
            get_recording_state,
            save_recording,
            // Recording editor
            save_recording_draft,
            get_editor_draft_path,
            read_recording_file,
            delete_recording_draft,
            open_editor_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
