import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, ShapePreset } from "../types/app";

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
