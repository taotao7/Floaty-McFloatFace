use std::ffi::c_void;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use super::KeyEventPayload;

/// Map macOS virtual keycode to display string.
fn keycode_to_string(keycode: i64) -> Option<&'static str> {
    match keycode {
        0x00 => Some("A"),
        0x01 => Some("S"),
        0x02 => Some("D"),
        0x03 => Some("F"),
        0x04 => Some("H"),
        0x05 => Some("G"),
        0x06 => Some("Z"),
        0x07 => Some("X"),
        0x08 => Some("C"),
        0x09 => Some("V"),
        0x0B => Some("B"),
        0x0C => Some("Q"),
        0x0D => Some("W"),
        0x0E => Some("E"),
        0x0F => Some("R"),
        0x10 => Some("Y"),
        0x11 => Some("T"),
        0x12 => Some("1"),
        0x13 => Some("2"),
        0x14 => Some("3"),
        0x15 => Some("4"),
        0x16 => Some("6"),
        0x17 => Some("5"),
        0x19 => Some("9"),
        0x1A => Some("7"),
        0x1C => Some("8"),
        0x1D => Some("0"),
        0x1F => Some("O"),
        0x20 => Some("U"),
        0x22 => Some("I"),
        0x23 => Some("P"),
        0x24 => Some("↵"),
        0x25 => Some("L"),
        0x26 => Some("J"),
        0x28 => Some("K"),
        0x2D => Some("N"),
        0x2E => Some("M"),
        0x30 => Some("Tab"),
        0x31 => Some("Space"),
        0x33 => Some("⌫"),
        0x35 => Some("Esc"),
        0x36 | 0x37 => Some("⌘"),
        0x38 | 0x3C => Some("Shift"),
        0x39 => Some("Caps"),
        0x3A | 0x3D => Some("Alt"),
        0x3B | 0x3E => Some("Ctrl"),
        0x60 => Some("F5"),
        0x61 => Some("F6"),
        0x62 => Some("F7"),
        0x63 => Some("F3"),
        0x64 => Some("F8"),
        0x65 => Some("F9"),
        0x67 => Some("F11"),
        0x6D => Some("F10"),
        0x6F => Some("F12"),
        0x73 => Some("Home"),
        0x74 => Some("PgUp"),
        0x75 => Some("Del"),
        0x76 => Some("F4"),
        0x77 => Some("End"),
        0x78 => Some("F2"),
        0x79 => Some("PgDn"),
        0x7A => Some("F1"),
        0x7B => Some("←"),
        0x7C => Some("→"),
        0x7D => Some("↓"),
        0x7E => Some("↑"),
        _ => None,
    }
}

type CGEventRef = *mut c_void;
type CGEventTapProxy = *mut c_void;
type CFMachPortRef = *mut c_void;
type CFRunLoopSourceRef = *mut c_void;
type CFRunLoopRef = *mut c_void;
type CFAllocatorRef = *const c_void;

const K_CG_SESSION_EVENT_TAP: u32 = 1;
const K_CG_HEAD_INSERT_EVENT_TAP: u32 = 0;
const K_CG_EVENT_TAP_OPTION_LISTEN_ONLY: u32 = 1;
const K_CG_EVENT_KEY_DOWN: u32 = 10;
const K_CG_EVENT_KEY_UP: u32 = 11;
const K_CG_KEYBOARD_EVENT_KEYCODE: u32 = 9;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventTapCreate(
        tap: u32, place: u32, options: u32, events_of_interest: u64,
        callback: extern "C" fn(CGEventTapProxy, u32, CGEventRef, *mut c_void) -> CGEventRef,
        user_info: *mut c_void,
    ) -> CFMachPortRef;
    fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
    fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFMachPortCreateRunLoopSource(
        allocator: CFAllocatorRef, port: CFMachPortRef, order: i64,
    ) -> CFRunLoopSourceRef;
    fn CFRunLoopGetCurrent() -> CFRunLoopRef;
    fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: *const c_void);
    fn CFRunLoopRun();
    static kCFRunLoopCommonModes: *const c_void;
    static kCFAllocatorDefault: CFAllocatorRef;
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

extern "C" fn tap_callback(
    _proxy: CGEventTapProxy,
    event_type: u32,
    event: CGEventRef,
    user_info: *mut c_void,
) -> CGEventRef {
    let app = unsafe { &*(user_info as *const AppHandle) };
    let keycode = unsafe { CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_KEYCODE) };

    if let Some(key_str) = keycode_to_string(keycode) {
        let event_name = match event_type {
            K_CG_EVENT_KEY_DOWN => "app://key-pressed",
            K_CG_EVENT_KEY_UP => "app://key-released",
            _ => return event,
        };
        let payload = KeyEventPayload {
            key: key_str.to_string(),
            modifiers: vec![],
            timestamp: now_millis(),
        };
        let _ = app.emit(event_name, payload);
    }

    event
}

pub fn start_keyboard_listener(app: AppHandle) {
    let app = Arc::new(app);

    std::thread::spawn(move || {
        let event_mask: u64 = (1 << K_CG_EVENT_KEY_DOWN) | (1 << K_CG_EVENT_KEY_UP);
        let user_info = Arc::into_raw(app) as *mut c_void;

        unsafe {
            let tap = CGEventTapCreate(
                K_CG_SESSION_EVENT_TAP,
                K_CG_HEAD_INSERT_EVENT_TAP,
                K_CG_EVENT_TAP_OPTION_LISTEN_ONLY,
                event_mask,
                tap_callback,
                user_info,
            );

            if tap.is_null() {
                eprintln!("Failed to create event tap — check Accessibility permissions.");
                let _ = Arc::from_raw(user_info as *const AppHandle);
                return;
            }

            let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0);
            let run_loop = CFRunLoopGetCurrent();
            CFRunLoopAddSource(run_loop, source, kCFRunLoopCommonModes);
            CGEventTapEnable(tap, true);
            CFRunLoopRun();
        }
    });
}
