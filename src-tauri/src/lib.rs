use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Emitter, Manager, PhysicalPosition, Size, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;

fn win_or_primary_monitor(app: &AppHandle) -> Result<tauri::Monitor, String> {
    app.primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No primary monitor".to_string())
}

mod keyboard;

const STORE_FILE: &str = "settings.json";
const SETTINGS_KEY: &str = "app_settings";
const POSITION_KEY: &str = "window_position";
const KEYBOARD_POSITION_KEY: &str = "keyboard_position";
const MAIN_WINDOW_LABEL: &str = "main";
const SETTINGS_WINDOW_LABEL: &str = "settings";
const KEYBOARD_WINDOW_LABEL: &str = "keyboard";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraDevice {
    pub device_id: String,
    pub label: String,
    pub group_id: Option<String>,
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
    let _ = app.emit("app://hotkey-triggered", payload);
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

    app.emit("app://settings-updated", payload)
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
            let builder = WebviewWindowBuilder::new(
                &app,
                KEYBOARD_WINDOW_LABEL,
                WebviewUrl::App("keyboard.html".into()),
            )
            .title("Keyboard Display")
            .inner_size(width, height)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false);

            // Restore saved position or center (with screen bounds check)
            let has_saved_position = if let Ok(store) = app.store(STORE_FILE) {
                if let Some(pos) = store.get(KEYBOARD_POSITION_KEY) {
                    if let (Some(x), Some(y)) = (pos.get("x").and_then(|v| v.as_f64()), pos.get("y").and_then(|v| v.as_f64())) {
                        // Validate position is on screen
                        let on_screen = if let Ok(monitor) = win_or_primary_monitor(&app) {
                            let mon_pos = monitor.position();
                            let mon_size = monitor.size();
                            let max_x = mon_pos.x as f64 + mon_size.width as f64 - 100.0;
                            let max_y = mon_pos.y as f64 + mon_size.height as f64 - 40.0;
                            x >= mon_pos.x as f64 && x <= max_x && y >= mon_pos.y as f64 && y <= max_y
                        } else {
                            true
                        };
                        on_screen
                    } else {
                        false
                    }
                } else {
                    false
                }
            } else {
                false
            };

            let builder = if !has_saved_position {
                builder.center()
            } else {
                builder
            };

            let win = builder.build().map_err(|e| e.to_string())?;

            // Restore position using PhysicalPosition (same as main window)
            if has_saved_position {
                if let Ok(store) = app.store(STORE_FILE) {
                    if let Some(pos) = store.get(KEYBOARD_POSITION_KEY) {
                        if let (Some(x), Some(y)) = (pos.get("x").and_then(|v| v.as_f64()), pos.get("y").and_then(|v| v.as_f64())) {
                            let _ = win.set_position(PhysicalPosition::new(x as i32, y as i32));
                        }
                    }
                }
            }

            // Save position on move (PhysicalPosition, same as main window)
            let handle = app.clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::Moved(pos) = event {
                    if let Ok(store) = handle.store(STORE_FILE) {
                        let val = serde_json::json!({ "x": pos.x, "y": pos.y });
                        store.set(KEYBOARD_POSITION_KEY, val);
                        let _ = store.save();
                    }
                }
            });
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

fn toggle_lock_state(app: &AppHandle) -> Result<(), String> {
    let mut settings = read_settings_from_store(app)?;
    settings.locked = !settings.locked;
    save_app_settings(app.clone(), settings)
}

fn tray_text(locale: &str) -> (&'static str, &'static str, &'static str, &'static str, &'static str) {
    match locale {
        "zh-CN" => ("显示/隐藏摄像头窗", "打开设置", "锁定/解锁拖拽", "显示/隐藏按键", "退出"),
        _ => ("Show/Hide Camera", "Open Settings", "Lock/Unlock Drag", "Show/Hide Keys", "Quit"),
    }
}

fn build_tray_menu(app: &AppHandle, locale: &str) -> Result<Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let (show_text, settings_text, lock_text, keyboard_text, quit_text) = tray_text(locale);

    let show_toggle = MenuItem::new(app, show_text, true, None::<&str>)?;
    let open_settings = MenuItem::new(app, settings_text, true, None::<&str>)?;
    let toggle_lock = MenuItem::new(app, lock_text, true, None::<&str>)?;
    let toggle_keyboard = MenuItem::new(app, keyboard_text, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::new(app, quit_text, true, None::<&str>)?;

    let show_id = show_toggle.id().clone();
    let settings_id = open_settings.id().clone();
    let lock_id = toggle_lock.id().clone();
    let keyboard_id = toggle_keyboard.id().clone();
    let quit_id = quit.id().clone();

    let menu = Menu::with_items(
        app,
        &[&show_toggle, &open_settings, &toggle_lock, &toggle_keyboard, &separator, &quit],
    )?;

    // Store item IDs in app state for event matching
    if let Ok(store) = app.store(STORE_FILE) {
        let ids = serde_json::json!({
            "toggle_visibility": show_id.as_ref(),
            "open_settings": settings_id.as_ref(),
            "toggle_lock": lock_id.as_ref(),
            "toggle_keyboard": keyboard_id.as_ref(),
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

    // Restore main window position
    if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let store = app.handle().store(STORE_FILE).map_err(|e| e.to_string())?;
        if let Some(pos) = store.get(POSITION_KEY) {
            if let (Some(x), Some(y)) = (pos.get("x").and_then(|v| v.as_f64()), pos.get("y").and_then(|v| v.as_f64())) {
                let _ = main.set_position(PhysicalPosition::new(x as i32, y as i32));
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
        .setup(|app| {
            setup_windows(app).map_err(|err| -> Box<dyn std::error::Error> { err.into() })?;
            setup_tray(app)?;
            
            // Start keyboard listener
            keyboard::start_keyboard_listener(app.handle().clone());

            // Auto-open keyboard window on startup
            if let Err(e) = toggle_keyboard_window(app.handle().clone(), true) {
                eprintln!("Failed to open keyboard window: {}", e);
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
            open_camera_privacy_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
