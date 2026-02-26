import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import type { AppSettings, KeyEvent, KeyboardDisplayStyle } from "../types/app";
import { getAppSettings } from "../lib/tauri";

interface DisplayKey {
  key: string;
  id: number;
  fadingOut: boolean;
}

interface CtxMenu {
  x: number;
  y: number;
}

const FADE_ANIM_MS = 300;
const BADGE_WIDTH = 70;
const CONTAINER_PADDING = 40;
const DEFAULT_FADE_OUT_MS = 2000;
const MAX_DISPLAY_MS = 10000; // Safety: auto-remove keys after 10s even without key-released

let nextId = 0;

function getMaxKeys(): number {
  const width = window.innerWidth || 800;
  return Math.max(2, Math.floor((width - CONTAINER_PADDING) / BADGE_WIDTH));
}

export default function KeyboardWindow() {
  const [displayKeys, setDisplayKeys] = useState<DisplayKey[]>([]);
  const [dragging, setDragging] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [locale, setLocale] = useState(() => navigator.language.startsWith("zh") ? "zh" : "en");
  const [accessibilityGranted, setAccessibilityGranted] = useState<boolean | null>(null);
  const [eventTapActive, setEventTapActive] = useState<boolean | null>(null);
  const [keyScale, setKeyScale] = useState(1.0);
  const [keyStyle, setKeyStyle] = useState<KeyboardDisplayStyle>("dark");
  const maxKeysRef = useRef(getMaxKeys());
  const fadeOutMsRef = useRef(DEFAULT_FADE_OUT_MS);
  const timersRef = useRef<Map<string, {
    fadeTimer: ReturnType<typeof setTimeout>;
    removeTimer: ReturnType<typeof setTimeout>;
    safetyTimer: ReturnType<typeof setTimeout>;
  }>>(new Map());

  useEffect(() => {
    const onResize = () => { maxKeysRef.current = getMaxKeys(); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Load initial settings on mount
  useEffect(() => {
    getAppSettings().then((s) => {
      fadeOutMsRef.current = s.keyboardDisplayFadeOut || DEFAULT_FADE_OUT_MS;
      setKeyScale(s.keyboardDisplayScale ?? 1.0);
      setKeyStyle(s.keyboardDisplayStyle ?? "dark");
      if (s.locale) setLocale(s.locale.startsWith("zh") ? "zh" : "en");
      const scale = s.keyboardDisplayScale ?? 1.0;
      const width = s.keyboardDisplayWidth || 800;
      const height = Math.round(80 * scale);
      getCurrentWindow().setSize(new LogicalSize(width, height));
    });
  }, []);

  useEffect(() => {
    const unlisten = listen<{ granted: boolean }>("app://accessibility-status", (event) => {
      setAccessibilityGranted(event.payload.granted);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    const unlisten = listen<{ active: boolean }>("app://event-tap-status", (event) => {
      setEventTapActive(event.payload.active);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    const unlisten = listen<AppSettings>("app://settings-updated", (event) => {
      fadeOutMsRef.current = event.payload.keyboardDisplayFadeOut || DEFAULT_FADE_OUT_MS;
      const width = event.payload.keyboardDisplayWidth || 800;
      const scale = event.payload.keyboardDisplayScale ?? 1.0;
      const height = Math.round(80 * scale);
      getCurrentWindow().setSize(new LogicalSize(width, height));
      if (event.payload.locale) {
        setLocale(event.payload.locale.startsWith("zh") ? "zh" : "en");
      }
      setKeyScale(event.payload.keyboardDisplayScale ?? 1.0);
      setKeyStyle(event.payload.keyboardDisplayStyle ?? "dark");
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    const unlisten1 = listen<KeyEvent>("app://key-pressed", (event) => {
      const key = event.payload.key;
      const existing = timersRef.current.get(key);
      if (existing) {
        clearTimeout(existing.fadeTimer);
        clearTimeout(existing.removeTimer);
        clearTimeout(existing.safetyTimer);
        timersRef.current.delete(key);
      }
      const id = nextId++;
      setDisplayKeys((prev) => {
        const next = [...prev.filter((dk) => dk.key !== key), { key, id, fadingOut: false }];
        const max = maxKeysRef.current;
        return next.length > max ? next.slice(next.length - max) : next;
      });
      // Safety: auto-remove if key-released is never received
      const safetyTimer = setTimeout(() => {
        setDisplayKeys((prev) =>
          prev.map((dk) => (dk.key === key ? { ...dk, fadingOut: true } : dk))
        );
        const removeTimer = setTimeout(() => {
          setDisplayKeys((prev) => prev.filter((dk) => dk.key !== key));
          timersRef.current.delete(key);
        }, FADE_ANIM_MS);
        const entry = timersRef.current.get(key);
        if (entry) entry.removeTimer = removeTimer;
      }, MAX_DISPLAY_MS);
      timersRef.current.set(key, {
        fadeTimer: 0 as unknown as ReturnType<typeof setTimeout>,
        removeTimer: 0 as unknown as ReturnType<typeof setTimeout>,
        safetyTimer,
      });
    });

    const unlisten2 = listen<KeyEvent>("app://key-released", (event) => {
      const key = event.payload.key;
      const existing = timersRef.current.get(key);
      if (existing) {
        clearTimeout(existing.safetyTimer);
      }
      const delay = Math.max(0, fadeOutMsRef.current - FADE_ANIM_MS);
      const fadeTimer = setTimeout(() => {
        setDisplayKeys((prev) =>
          prev.map((dk) => (dk.key === key ? { ...dk, fadingOut: true } : dk))
        );
        const removeTimer = setTimeout(() => {
          setDisplayKeys((prev) => prev.filter((dk) => dk.key !== key));
          timersRef.current.delete(key);
        }, FADE_ANIM_MS);
        const entry = timersRef.current.get(key);
        if (entry) entry.removeTimer = removeTimer;
      }, delay);
      if (existing) {
        existing.fadeTimer = fadeTimer;
      } else {
        timersRef.current.set(key, {
          fadeTimer,
          removeTimer: 0 as unknown as ReturnType<typeof setTimeout>,
          safetyTimer: 0 as unknown as ReturnType<typeof setTimeout>,
        });
      }
    });

    return () => {
      unlisten1.then((fn) => fn());
      unlisten2.then((fn) => fn());
      for (const { fadeTimer, removeTimer, safetyTimer } of timersRef.current.values()) {
        clearTimeout(fadeTimer);
        clearTimeout(removeTimer);
        clearTimeout(safetyTimer);
      }
      timersRef.current.clear();
    };
  }, []);

  // Close context menu
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  const handleDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // Only left click drags
    setDragging(true);
    getCurrentWindow().startDragging();
    setTimeout(() => setDragging(false), 300);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const menuWidth = 180;
    const menuHeight = 80;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 4);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 4);
    setCtxMenu({ x: Math.max(4, x), y: Math.max(4, y) });
  };

  return (
    <div
      className={`keyboard-display${dragging ? " dragging" : ""}`}
      onPointerDown={handleDrag}
      onContextMenu={onContextMenu}
      style={{ "--key-scale": keyScale } as React.CSSProperties}
    >
      {accessibilityGranted === false && displayKeys.length === 0 && (
        <div className={`key-badge style-${keyStyle}`} style={{ opacity: 0.7, fontSize: 13, padding: "6px 14px" }}>
          {locale === "zh"
            ? "⚠️ 请在 系统设置 → 隐私与安全 → 辅助功能 中授权本应用"
            : "⚠️ Grant access in System Settings → Privacy → Accessibility"}
        </div>
      )}
      {accessibilityGranted !== false && eventTapActive === false && displayKeys.length === 0 && (
        <div className={`key-badge style-${keyStyle}`} style={{ opacity: 0.7, fontSize: 13, padding: "6px 14px" }}>
          {locale === "zh"
            ? "⚠️ 请在 系统设置 → 隐私与安全 → 输入监控 中授权本应用"
            : "⚠️ Grant access in System Settings → Privacy → Input Monitoring"}
        </div>
      )}
      {displayKeys.map((dk) => (
        <div
          key={dk.id}
          className={`key-badge style-${keyStyle}${dk.fadingOut ? " fading" : ""}`}
        >
          {dk.key}
        </div>
      ))}

      {ctxMenu && (
        <div
          className="ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => {
            void invoke("toggle_keyboard_window", { enabled: false });
            setCtxMenu(null);
          }}>
            {locale === "zh" ? "隐藏按键" : "Hide Keys"}
          </button>
          <button type="button" onClick={() => {
            void invoke("open_settings_window");
            setCtxMenu(null);
          }}>
            {locale === "zh" ? "打开设置" : "Settings"}
          </button>
        </div>
      )}
    </div>
  );
}
