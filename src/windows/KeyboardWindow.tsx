import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import type { AppSettings, KeyEvent } from "../types/app";

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
  const maxKeysRef = useRef(getMaxKeys());
  const fadeOutMsRef = useRef(DEFAULT_FADE_OUT_MS);
  const timersRef = useRef<Map<string, {
    fadeTimer: ReturnType<typeof setTimeout>;
    removeTimer: ReturnType<typeof setTimeout>;
  }>>(new Map());

  useEffect(() => {
    const onResize = () => { maxKeysRef.current = getMaxKeys(); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const unlisten = listen<AppSettings>("app://settings-updated", (event) => {
      fadeOutMsRef.current = event.payload.keyboardDisplayFadeOut || DEFAULT_FADE_OUT_MS;
      const width = event.payload.keyboardDisplayWidth || 800;
      getCurrentWindow().setSize(new LogicalSize(width, 80));
      if (event.payload.locale) {
        setLocale(event.payload.locale.startsWith("zh") ? "zh" : "en");
      }
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
        timersRef.current.delete(key);
      }
      const id = nextId++;
      setDisplayKeys((prev) => {
        const next = [...prev.filter((dk) => dk.key !== key), { key, id, fadingOut: false }];
        const max = maxKeysRef.current;
        return next.length > max ? next.slice(next.length - max) : next;
      });
    });

    const unlisten2 = listen<KeyEvent>("app://key-released", (event) => {
      const key = event.payload.key;
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
      timersRef.current.set(key, { fadeTimer, removeTimer: 0 as unknown as ReturnType<typeof setTimeout> });
    });

    return () => {
      unlisten1.then((fn) => fn());
      unlisten2.then((fn) => fn());
      for (const { fadeTimer, removeTimer } of timersRef.current.values()) {
        clearTimeout(fadeTimer);
        clearTimeout(removeTimer);
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
    >
      {displayKeys.map((dk) => (
        <div
          key={dk.id}
          className={`key-badge${dk.fadingOut ? " fading" : ""}`}
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
