import { listen } from "@tauri-apps/api/event";
import { EVT } from "./events";
import { getAppSettings } from "./tauri";

export type ThemeMode = "system" | "light" | "dark";

const MEDIA_QUERY = "(prefers-color-scheme: dark)";

let systemMedia: MediaQueryList | null = null;
let systemListener: ((event: MediaQueryListEvent) => void) | null = null;

function detachSystemListener(): void {
  if (systemMedia && systemListener) {
    systemMedia.removeEventListener("change", systemListener);
  }
  systemMedia = null;
  systemListener = null;
}

function setResolvedTheme(resolved: "light" | "dark"): void {
  // Dark is the default (:root tokens); light flips via [data-theme="light"].
  if (resolved === "light") {
    document.documentElement.dataset.theme = "light";
  } else {
    delete document.documentElement.dataset.theme;
  }
}

export function applyTheme(mode: ThemeMode): void {
  // Repeated calls must not stack system listeners.
  detachSystemListener();

  if (mode === "system") {
    const mql = window.matchMedia(MEDIA_QUERY);
    setResolvedTheme(mql.matches ? "dark" : "light");
    const listener = (event: MediaQueryListEvent) => {
      setResolvedTheme(event.matches ? "dark" : "light");
    };
    mql.addEventListener("change", listener);
    systemMedia = mql;
    systemListener = listener;
    return;
  }

  setResolvedTheme(mode);
}

async function syncFromSettings(): Promise<void> {
  try {
    const settings = await getAppSettings();
    applyTheme(settings.theme ?? "system");
  } catch {
    applyTheme("system");
  }
}

/**
 * Apply the persisted theme and keep it in sync with settings changes.
 * Fire-and-forget: safe to call from every window entry before render.
 */
export function initTheme(): void {
  void syncFromSettings();
  listen(EVT.SETTINGS_UPDATED, () => {
    void syncFromSettings();
  }).catch(() => {
    // Event bridge unavailable (e.g. plain browser dev) — theme stays static.
  });
}
