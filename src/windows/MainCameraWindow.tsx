import { emit, listen } from "@tauri-apps/api/event";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { Lock, LockOpen, FlipHorizontal2, Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultSettings, type AppSettings, type CameraDevice, type RuntimeState } from "../types/app";
import { listBrowserCameras, startAdaptiveStream, stopStream } from "../lib/camera";
import {
  getAppSettings,
  openSettingsWindow,
  saveAppSettings,
  startDragMainWindow,
  toggleMainWindowVisibility,
} from "../lib/tauri";
import { I18nProvider, getMessages, useI18n, detectLocale, type Locale } from "../i18n";

const defaultRuntime: RuntimeState = {
  visible: true,
  dragging: false,
  streamReady: false,
  permission: "unknown",
};

interface CtxMenu {
  x: number;
  y: number;
}

function MainCameraContent() {
  const t = useI18n();
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [runtime, setRuntime] = useState<RuntimeState>(defaultRuntime);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [status, setStatus] = useState(t.init_camera);
  const [statusHidden, setStatusHidden] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const syncSettings = useCallback(async (next: AppSettings) => {
    setSettings(next);
    await saveAppSettings(next);
  }, []);

  const refreshDevices = useCallback(async () => {
    const cameraList = await listBrowserCameras();
    setDevices(cameraList);
    if (!cameraList.length) {
      setStatus(t.no_camera_detected);
    }
  }, [t]);

  const attachStream = useCallback(async () => {
    if (!navigator.mediaDevices) {
      setRuntime((prev) => ({ ...prev, permission: "denied", streamReady: false }));
      setStatus(t.media_devices_unavailable);
      await emit("app://camera-error", { message: "media_devices_unavailable" });
      return;
    }

    try {
      stopStream(streamRef.current);
      const stream = await startAdaptiveStream(settings.selectedCameraId);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setRuntime((prev) => ({ ...prev, permission: "granted", streamReady: true }));
      setStatus(t.camera_connected);
      setTimeout(() => setStatusHidden(true), 1500);
    } catch (error) {
      setRuntime((prev) => ({ ...prev, permission: "denied", streamReady: false }));
      setStatus(t.camera_access_denied);
      setStatusHidden(false);
      await emit("app://camera-error", {
        message: error instanceof Error ? error.message : "camera_unavailable",
      });
    }
  }, [settings.selectedCameraId, t]);

  useEffect(() => {
    let mounted = true;
    const bootstrap = async () => {
      const persisted = await getAppSettings();
      if (!mounted) return;
      setSettings(persisted);
      await refreshDevices();
    };
    void bootstrap();
    return () => { mounted = false; };
  }, [refreshDevices]);

  useEffect(() => {
    if (!devices.length && !settings.selectedCameraId) return;
    void attachStream();
    return () => { stopStream(streamRef.current); };
  }, [devices.length, settings.selectedCameraId, attachStream]);

  useEffect(() => {
    if (!navigator.mediaDevices) return;
    const onDeviceChanged = async () => {
      await refreshDevices();
      await attachStream();
    };
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChanged);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onDeviceChanged);
  }, [attachStream, refreshDevices]);

  useEffect(() => {
    const unlistenPromise = listen<AppSettings>("app://settings-updated", (event) => {
      setSettings(event.payload);
    });
    return () => { void unlistenPromise.then((unlisten) => unlisten()); };
  }, []);

  useEffect(() => {
    const hotkeys = async () => {
      await register("CommandOrControl+Shift+V", async () => {
        await toggleMainWindowVisibility();
      });
      await register("CommandOrControl+Shift+L", async () => {
        const next = { ...settings, locked: !settings.locked };
        await syncSettings(next);
        await emit("app://hotkey-triggered", { action: "toggle_lock" });
      });
      await register("CommandOrControl+Shift+,", async () => {
        await openSettingsWindow();
      });
    };
    void hotkeys();
    return () => { void unregisterAll(); };
  }, [settings, syncSettings]);

  // Close context menu on click anywhere, blur, or Escape
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

  const onDragStart = async () => {
    if (settings.locked || settings.clickThrough) return;
    setRuntime((prev) => ({ ...prev, dragging: true }));
    await startDragMainWindow();
    setRuntime((prev) => ({ ...prev, dragging: false }));
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const shapeClass = useMemo(() => `shape-${settings.shape}`, [settings.shape]);

  const videoStyle = useMemo(() => {
    const transform = settings.mirror ? "scaleX(-1)" : "scaleX(1)";
    if (!settings.beauty) return { transform };
    const smoothness = settings.beautySmoothness / 100;
    const brightness = 1 + (settings.beautyBrightness - 50) / 200;
    const blur = smoothness * 1.2;
    const contrast = 1 - smoothness * 0.06;
    const saturate = 1 + smoothness * 0.12;
    return {
      transform,
      filter: `blur(${blur}px) brightness(${brightness}) contrast(${contrast}) saturate(${saturate})`,
    };
  }, [settings.mirror, settings.beauty, settings.beautySmoothness, settings.beautyBrightness]);

  return (
    <main className="camera-app" onContextMenu={onContextMenu}>
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          <clipPath id="mickeyMask" clipPathUnits="objectBoundingBox">
            <circle cx="0.5" cy="0.58" r="0.38" />
            <circle cx="0.24" cy="0.19" r="0.18" />
            <circle cx="0.76" cy="0.19" r="0.18" />
          </clipPath>
        </defs>
      </svg>

      <section
        className={`camera-shell ${shapeClass} ${runtime.dragging ? "dragging" : ""}`}
        onPointerDown={() => { void onDragStart(); }}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="camera-video"
          style={videoStyle}
        />
      </section>

      <div className={`camera-status ${statusHidden ? "hidden" : ""}`}>{status}</div>

      {runtime.permission === "denied" && (
        <button type="button" className="retry-button" onClick={() => { void attachStream(); }}>
          {t.retry_camera}
        </button>
      )}

      {ctxMenu && (
        <div
          className="ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => {
            const next = { ...settings, locked: !settings.locked };
            void syncSettings(next);
            setCtxMenu(null);
          }}>
            {settings.locked ? <><LockOpen size={14} /> {t.unlock_drag}</> : <><Lock size={14} /> {t.lock_drag}</>}
          </button>
          <button type="button" onClick={() => {
            const next = { ...settings, mirror: !settings.mirror };
            void syncSettings(next);
            setCtxMenu(null);
          }}>
            <FlipHorizontal2 size={14} /> {settings.mirror ? t.mirror_off : t.mirror_on}
          </button>
          <button type="button" onClick={() => {
            void openSettingsWindow();
            setCtxMenu(null);
          }}>
            <Settings size={14} /> {t.open_settings}
          </button>
        </div>
      )}
    </main>
  );
}

export function MainCameraWindow() {
  const [locale, setLocale] = useState<Locale>(detectLocale());

  useEffect(() => {
    const load = async () => {
      const persisted = await getAppSettings();
      if (persisted.locale) {
        setLocale(persisted.locale as Locale);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    const unlistenPromise = listen<AppSettings>("app://settings-updated", (event) => {
      if (event.payload.locale) {
        setLocale(event.payload.locale as Locale);
      }
    });
    return () => { void unlistenPromise.then((unlisten) => unlisten()); };
  }, []);

  const messages = getMessages(locale);

  return (
    <I18nProvider value={messages}>
      <MainCameraContent />
    </I18nProvider>
  );
}
