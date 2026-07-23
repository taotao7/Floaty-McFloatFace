import { emit, listen } from "@tauri-apps/api/event";
import { EVT } from "../lib/events";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { Lock, LockOpen, FlipHorizontal2, Settings, Keyboard } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultSettings, type AppSettings, type CameraDevice, type RuntimeState } from "../types/app";
import { listBrowserCameras, startAdaptiveStream, stopStream } from "../lib/camera";
import {
  getAppSettings,
  openSettingsWindow,
  openCameraPrivacySettings,
  saveAppSettings,
  startDragMainWindow,
  toggleKeyboardWindow,
  toggleMainWindowVisibility,
} from "../lib/tauri";
import { I18nProvider, getMessages, useI18n, detectLocale, type Locale } from "../i18n";
import { useRecordingPipeline } from "../hooks/useRecordingPipeline";

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
  // Generation counter for camera (re)connects: only the newest attempt may
  // bind its stream to the <video>. Stale/slow acquisitions are stopped on
  // arrival, so concurrent connects (bootstrap vs settings effect vs
  // devicechange) can never leave the element bound to a dead stream.
  const connectGenRef = useRef(0);
  // WebKit mute recovery state: reconnect attempts since the last healthy
  // (unmuted) stream, and the pending delayed-reconnect timer. Mutes from
  // our own screen recording no longer happen — the recording pipeline runs
  // in THIS window (see useRecordingPipeline), and same-page captures
  // coexist — but other apps / OS events can still mute the camera.
  const muteRetryRef = useRef(0);
  const muteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const devicesRef = useRef(devices);
  devicesRef.current = devices;

  const syncSettings = useCallback(async (next: AppSettings) => {
    setSettings(next);
    await saveAppSettings(next);
  }, []);

  const connectCamera = useCallback(async (cameraId?: string) => {
    if (!navigator.mediaDevices) {
      setRuntime((prev) => ({ ...prev, permission: "denied", streamReady: false }));
      setStatus(t.media_devices_unavailable);
      await emit(EVT.CAMERA_ERROR, { message: "media_devices_unavailable" });
      return;
    }

    const gen = ++connectGenRef.current;
    try {
      const targetId = cameraId
        || settingsRef.current.selectedCameraId
        || (devicesRef.current.length > 0 ? devicesRef.current[0].deviceId : undefined);
      // Acquire BEFORE touching the live stream: a failed or hung re-acquire
      // must leave the current picture on screen instead of going black.
      const stream = await startAdaptiveStream(targetId);
      if (gen !== connectGenRef.current) {
        // A newer connect superseded this one while we were acquiring.
        stopStream(stream);
        return;
      }
      stopStream(streamRef.current);
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      // If the OS kills the track (device yanked, capture session revoked),
      // re-acquire instead of sitting on a black frame.
      const track = stream.getVideoTracks()[0];
      track?.addEventListener("ended", () => {
        if (streamRef.current === stream) void connectCamera();
      });
      // A muted track outputs black frames without ever firing `ended` (e.g.
      // another app grabs the device, OS policy). Wait a beat in case WebKit
      // unmutes on its own, then re-acquire; the retry budget stops us
      // looping if every acquisition comes back muted.
      const scheduleMuteRecovery = () => {
        if (streamRef.current !== stream || muteTimerRef.current) return;
        muteTimerRef.current = setTimeout(() => {
          muteTimerRef.current = null;
          if (streamRef.current !== stream || !track || !track.muted) return;
          if (muteRetryRef.current >= 3) return;
          muteRetryRef.current += 1;
          void connectCamera();
        }, 1200);
      };
      track?.addEventListener("mute", scheduleMuteRecovery);
      track?.addEventListener("unmute", () => {
        if (streamRef.current !== stream) return;
        muteRetryRef.current = 0;
        if (muteTimerRef.current) {
          clearTimeout(muteTimerRef.current);
          muteTimerRef.current = null;
        }
      });
      if (track && !track.muted) {
        // A track acquired unmuted is healthy: reset the retry budget.
        muteRetryRef.current = 0;
      } else if (track) {
        // Born muted (no `mute` event will fire): go straight to recovery.
        scheduleMuteRecovery();
      }

      setRuntime((prev) => ({ ...prev, permission: "granted", streamReady: true }));
      setStatus(t.camera_connected);
      setTimeout(() => setStatusHidden(true), 1500);
    } catch (error) {
      if (gen !== connectGenRef.current) return;
      // Keep any live stream on screen; only surface the failure in the UI.
      const hasLiveStream = streamRef.current !== null;
      setRuntime((prev) => ({ ...prev, permission: "denied", streamReady: hasLiveStream }));
      setStatus(t.camera_access_denied);
      setStatusHidden(false);
      const isDenied = error instanceof DOMException && error.name === "NotAllowedError";
      if (isDenied) {
        await openCameraPrivacySettings();
      }
      await emit(EVT.CAMERA_ERROR, {
        message: error instanceof Error ? error.message : "camera_unavailable",
      });
    }
  }, [t]);

  // Bootstrap: load settings → enumerate → connect (only when the
  // selectedCameraId effect below won't, i.e. no persisted preference).
  useEffect(() => {
    let mounted = true;
    const bootstrap = async () => {
      if (!navigator.mediaDevices) return;

      const persisted = await getAppSettings();
      if (!mounted) return;
      setSettings(persisted);

      const cameraList = await listBrowserCameras();
      if (!mounted) return;
      setDevices(cameraList);

      // With a persisted camera, the selectedCameraId effect owns the
      // connect; acquiring here too would just double-open the device.
      if (!persisted.selectedCameraId) {
        await connectCamera(cameraList.length > 0 ? cameraList[0].deviceId : undefined);
        if (!mounted) return;
      }

      // Re-enumerate after permission granted (labels become available)
      const updatedList = await listBrowserCameras();
      if (mounted) setDevices(updatedList);
    };
    void bootstrap();
    return () => { mounted = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-connect when user changes camera in settings. The old stream is
  // swapped out inside connectCamera only after its replacement is live.
  useEffect(() => {
    if (!settings.selectedCameraId) return;
    void connectCamera(settings.selectedCameraId);
  }, [settings.selectedCameraId, connectCamera]);

  // Stop the stream only on unmount (and drop any pending mute-recovery timer).
  useEffect(() => () => {
    if (muteTimerRef.current) clearTimeout(muteTimerRef.current);
    stopStream(streamRef.current);
  }, []);

  // Handle hot-plug. Debounced and gated on the *video* device set actually
  // changing — audio-only changes (e.g. getDisplayMedia grabbing the mic when
  // a screen recording starts) must not bounce the camera.
  useEffect(() => {
    if (!navigator.mediaDevices) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onDeviceChanged = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const cameraList = await listBrowserCameras();
        const prevIds = devicesRef.current.map((d) => d.deviceId).sort().join("|");
        const nextIds = cameraList.map((d) => d.deviceId).sort().join("|");
        if (nextIds === prevIds) return;
        setDevices(cameraList);
        await connectCamera();
      }, 300);
    };
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChanged);
    return () => {
      if (timer) clearTimeout(timer);
      navigator.mediaDevices.removeEventListener("devicechange", onDeviceChanged);
    };
  }, [connectCamera]);

  useEffect(() => {
    const unlistenPromise = listen<AppSettings>(EVT.SETTINGS_UPDATED, (event) => {
      setSettings(event.payload);
    });
    return () => { void unlistenPromise.then((unlisten) => unlisten()); };
  }, []);

  // Re-acquire camera when settings window releases its temp stream
  useEffect(() => {
    const unlistenPromise = listen(EVT.CAMERA_REACQUIRE, () => {
      void connectCamera();
    });
    return () => { void unlistenPromise.then((unlisten) => unlisten()); };
  }, [connectCamera]);


  useEffect(() => {
    const hotkeys = async () => {
      try {
        await unregisterAll();
      } catch { /* ignore */ }
      try {
        await register("CommandOrControl+Shift+V", async () => {
          await toggleMainWindowVisibility();
        });
        await register("CommandOrControl+Shift+L", async () => {
          const next = { ...settings, locked: !settings.locked };
          await syncSettings(next);
          await emit(EVT.HOTKEY_TRIGGERED, { action: "toggle_lock" });
        });
        await register("CommandOrControl+Shift+,", async () => {
          await openSettingsWindow();
        });
        await register("CommandOrControl+Shift+R", async () => {
          // The recording control bar listens for this action and toggles
          // start/stop. If the bar isn't open yet, the action is inert.
          await emit(EVT.HOTKEY_TRIGGERED, { action: "toggle_recording" });
        });
      } catch { /* hotkey registration may fail if already taken */ }
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
    const menuWidth = 180;
    const menuHeight = 200;
    // Clamp menu inside the visible window area with padding
    const pad = 8;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - pad);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - pad);
    setCtxMenu({ x: Math.max(pad, x), y: Math.max(pad, y) });
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
        <button type="button" className="retry-button" onClick={() => { void connectCamera(); }}>
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
          <button type="button" onClick={async () => {
            const next = { ...settings, keyboardDisplayEnabled: !settings.keyboardDisplayEnabled };
            await toggleKeyboardWindow(next.keyboardDisplayEnabled);
            void syncSettings(next);
            setCtxMenu(null);
          }}>
            <Keyboard size={14} /> {settings.keyboardDisplayEnabled ? t.keyboard_hide : t.keyboard_show}
          </button>
        </div>
      )}
    </main>
  );
}

export function MainCameraWindow() {
  const [locale, setLocale] = useState<Locale>(detectLocale());

  // The screen-recording pipeline is HOSTED here, not in the recording bar:
  // WebKit allows one active capture per page ("latest wins" muting), so the
  // camera stream and the display capture must live in the same document to
  // coexist. The recording bar is a remote control (useRecordingRemote)
  // driving this instance over app://recording-cmd / app://recording-ui.
  // NOTE: keep this window alive (hide, never close) while recording.
  useRecordingPipeline();

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
    const unlistenPromise = listen<AppSettings>(EVT.SETTINGS_UPDATED, (event) => {
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
