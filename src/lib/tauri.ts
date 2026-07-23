import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, RecordingMeta, RecordingRegion, ShapePreset } from "../types/app";

export async function getAppSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_app_settings");
}

export async function saveAppSettings(payload: AppSettings): Promise<void> {
  await invoke("save_app_settings", { payload });
}

export async function applyWindowShape(payload: ShapePreset): Promise<void> {
  await invoke("apply_window_shape", { payload });
}

export async function setAlwaysOnTop(enabled: boolean): Promise<void> {
  await invoke("set_always_on_top", { enabled });
}

export async function setClickThrough(enabled: boolean): Promise<void> {
  await invoke("set_click_through", { enabled });
}

export async function toggleMainWindowVisibility(): Promise<void> {
  await invoke("toggle_main_window_visibility");
}

export async function openSettingsWindow(): Promise<void> {
  await invoke("open_settings_window");
}

export async function startDragMainWindow(): Promise<void> {
  await invoke("start_drag_main_window");
}

export async function toggleKeyboardWindow(enabled: boolean): Promise<void> {
  await invoke("toggle_keyboard_window", { enabled });
}

export async function openCameraPrivacySettings(): Promise<void> {
  await invoke("open_camera_privacy_settings");
}

// --- Screen recording commands ---

/** Show or hide the floating recording control bar window. */
export async function toggleRecordingWindow(enabled: boolean): Promise<void> {
  await invoke("toggle_recording_window", { enabled });
}

/** Open the full-screen region selection overlay. Emits `app://region-started`. */
export async function startRegionSelect(): Promise<void> {
  await invoke("start_region_select");
}

/** Persist a confirmed recording region. Emits `app://region-selected`. */
export async function confirmRegion(region: RecordingRegion): Promise<void> {
  await invoke("confirm_region", { region });
}

/** Cancel region selection without changing the saved region. */
export async function cancelRegionSelect(): Promise<void> {
  await invoke("cancel_region_select");
}

/** Clear the saved region so the next recording captures the full screen. */
export async function resetRecordingRegion(): Promise<void> {
  await invoke("reset_recording_region");
}

/** Show or hide the click-through cursor effects overlay window. */
export async function setCursorOverlay(enabled: boolean): Promise<void> {
  await invoke("set_cursor_overlay", { enabled });
}

/** Gate whether the Rust mouse event tap emits mouse coordinates. */
export async function setMouseTrackingEnabled(enabled: boolean): Promise<void> {
  await invoke("set_mouse_tracking_enabled", { enabled });
}

/** Read the saved recording region (null = full screen). */
export async function getRecordingRegion(): Promise<RecordingRegion | null> {
  return invoke<RecordingRegion | null>("get_recording_region");
}

/**
 * Persist a recorded video blob via the native save dialog.
 * Returns the chosen file path, or null if the user cancelled.
 *
 * Passes the `Uint8Array` directly — Tauri v2 (≥2.10) deserializes a
 * top-level `Uint8Array` arg into the Rust `Vec<u8>` as raw bytes, so we do
 * NOT `Array.from(...)` it (that would JSON-ify every byte into a ~3x larger
 * payload and balloon memory for large recordings).
 */
export async function saveRecording(bytes: Uint8Array, suggestedName: string): Promise<string | null> {
  return invoke<string | null>("save_recording", {
    bytes,
    suggestedName,
  });
}

/**
 * Open a native directory picker and return the chosen path, or null if the
 * user cancelled. Used by the settings window to configure
 * `recordingOutputDir`.
 */
export async function pickRecordingOutputDir(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false });
  if (typeof selected !== "string" || selected.length === 0) {
    return null;
  }
  return selected;
}

// --- Recording editor commands ---

/** Persist a fresh recording as a draft for the editor. Returns the draft path. */
export async function saveRecordingDraft(bytes: Uint8Array, ext: "mp4" | "webm"): Promise<string> {
  return invoke<string>("save_recording_draft", { bytes, ext });
}

/** The draft path the editor window should load. */
export async function getEditorDraftPath(): Promise<string | null> {
  return invoke<string | null>("get_editor_draft_path");
}

/**
 * Read a draft recording back as bytes. The Rust side returns a raw binary
 * response; normalize the handful of shapes the IPC layer may hand us.
 */
export async function readRecordingFile(path: string): Promise<Uint8Array> {
  const res = await invoke<ArrayBuffer | Uint8Array | number[]>("read_recording_file", { path });
  if (res instanceof Uint8Array) return res;
  if (res instanceof ArrayBuffer) return new Uint8Array(res);
  return new Uint8Array(res);
}

/** Delete a draft (after export, or when discarded). Also removes its sidecar. */
export async function deleteRecordingDraft(path: string): Promise<void> {
  await invoke("delete_recording_draft", { path });
}

/**
 * Persist the metadata sidecar (`draft-<id>.json`) for a draft recording.
 * The draft path comes from `saveRecordingDraft`; the sidecar is written
 * next to it with the `.json` extension.
 */
export async function saveRecordingMeta(draftPath: string, meta: RecordingMeta): Promise<void> {
  await invoke("save_recording_meta", { draftPath, meta });
}

/**
 * Read the metadata sidecar for a draft. Returns `null` when no sidecar
 * exists (e.g. recordings made before sidecars existed) so callers can
 * gracefully disable zoom preview.
 */
export async function readRecordingMeta(draftPath: string): Promise<RecordingMeta | null> {
  return invoke<RecordingMeta | null>("read_recording_meta", { draftPath });
}

/** Open (or replace) the post-capture editor window. */
export async function openEditorWindow(): Promise<void> {
  await invoke("open_editor_window");
}
