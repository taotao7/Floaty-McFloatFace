import { emit, listen } from "@tauri-apps/api/event";
import { EVT } from "../lib/events";
import { gsap } from "gsap";
import { Camera, Lock, Palette, Pin, Sparkles, Video } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Slider } from "../components/ui/slider";
import { Switch } from "../components/ui/switch";
import { listBrowserCameras } from "../lib/camera";
import {
  applyWindowShape,
  getAppSettings,
  getRecordingRegion,
  openSettingsWindow,
  pickRecordingOutputDir,
  resetRecordingRegion,
  saveAppSettings,
  setAlwaysOnTop,
  setClickThrough,
  startRegionSelect,
  toggleKeyboardWindow,
  toggleRecordingWindow,
} from "../lib/tauri";
import { defaultSettings, type AppSettings, type CameraDevice, type CursorEffectStyle, type KeyboardDisplayStyle, type RecordingRegion, type ShapePreset } from "../types/app";
import { I18nProvider, getMessages, useI18n, detectLocale, type Locale } from "../i18n";

function SettingsContent() {
  const t = useI18n();
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [saving, setSaving] = useState(false);
  const [region, setRegion] = useState<RecordingRegion | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const shapeOptions: Array<{ value: ShapePreset; label: string; desc: string }> = useMemo(() => [
    { value: "circle", label: "Circle", desc: t.shape_circle_desc },
    { value: "roundedSquare", label: "Rounded Square", desc: t.shape_rounded_desc },
    { value: "mickey", label: "Mickey", desc: t.shape_mickey_desc },
  ], [t]);

  useEffect(() => {
    const load = async () => {
      // Request temporary camera access so enumerateDevices returns labels.
      // Stopping the temp stream may interrupt the main window's camera on macOS,
      // so we emit an event afterwards to let it re-acquire.
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
        tempStream.getTracks().forEach((track) => track.stop());
        // Notify main window to re-acquire camera after we released the temp stream
        await emit(EVT.CAMERA_REACQUIRE);
      } catch {
        // Permission denied — still try to enumerate
      }
      const [nextSettings, cameraList, savedRegion] = await Promise.all([
        getAppSettings(),
        listBrowserCameras(),
        getRecordingRegion(),
      ]);
      setSettings(nextSettings);
      setDevices(cameraList);
      setRegion(savedRegion);

      // If no camera explicitly selected but devices are available,
      // default to the first device so the selector matches the main window
      if (!nextSettings.selectedCameraId && cameraList.length > 0) {
        const firstId = cameraList.find((d) => d.deviceId)?.deviceId;
        if (firstId) {
          setSettings((prev) => ({ ...prev, selectedCameraId: firstId }));
        }
      }
    };

    void load();
  }, []);

  useEffect(() => {
    const unlistenPromise = listen<AppSettings>(EVT.SETTINGS_UPDATED, (event) => {
      setSettings(event.payload);
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Live-update the displayed region when the region-select window confirms
  // or the user resets to full screen.
  useEffect(() => {
    const unlistenPromise = listen<RecordingRegion | null>(EVT.REGION_SELECTED, (event) => {
      setRegion(event.payload);
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const q = gsap.utils.selector(containerRef.current);
    gsap.fromTo(
      q(".settings-section"),
      { opacity: 0, y: 18 },
      { opacity: 1, y: 0, duration: 0.55, stagger: 0.09, ease: "power2.out" },
    );
  }, []);

  const previewClass = useMemo(() => `preview-shape preview-${settings.shape}`, [settings.shape]);

  const commit = async (next: AppSettings) => {
    setSettings(next);
    setSaving(true);
    await saveAppSettings(next);
    setSaving(false);
  };

  return (
    <main className="settings-page" ref={containerRef}>
      <header className="settings-header settings-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <p className="badge" style={{ margin: 0 }}>Floaty Control Deck</p>
          <Select
            value={settings.locale || detectLocale()}
            onValueChange={(value) => {
              void commit({ ...settings, locale: value });
            }}
          >
            <SelectTrigger style={{ width: 90, height: 26, fontSize: 12, padding: "0 8px" }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh-CN">中文</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <h1>Cam Window Styling</h1>
        <p>{t.settings_subtitle}</p>
      </header>

      <Card className="settings-section">
        <div className="section-title">
          <Camera size={16} />
          <h2>{t.camera}</h2>
        </div>
        <Label htmlFor="camera-select">{t.device_select}</Label>
        <Select
          value={settings.selectedCameraId ?? ""}
          onValueChange={(value) => {
            const selectedCameraId = value || undefined;
            void commit({ ...settings, selectedCameraId });
          }}
        >
          <SelectTrigger id="camera-select">
            <SelectValue placeholder={t.select_camera_placeholder} />
          </SelectTrigger>
          <SelectContent>
            {devices
              .filter((device) => device.deviceId)
              .map((device) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label || device.deviceId}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Card>

      <Card className="settings-section">
        <div className="section-title">
          <Palette size={16} />
          <h2>{t.appearance}</h2>
        </div>

        <div className="setting-row" style={{ marginBottom: 12 }}>
          <div>
            <Label>{t.theme}</Label>
            <p className="hint">{t.theme_hint}</p>
          </div>
          <Select
            value={settings.theme}
            onValueChange={(value) => {
              void commit({ ...settings, theme: value as AppSettings["theme"] });
            }}
          >
            <SelectTrigger style={{ width: 140, height: 28, fontSize: 12, padding: "0 8px" }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{t.theme_system}</SelectItem>
              <SelectItem value="light">{t.theme_light}</SelectItem>
              <SelectItem value="dark">{t.theme_dark}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="shape-grid">
          {shapeOptions.map((shape) => (
            <button
              key={shape.value}
              type="button"
              className={`shape-card ${settings.shape === shape.value ? "active" : ""}`}
              onClick={() => {
                const next = { ...settings, shape: shape.value };
                void applyWindowShape(shape.value);
                void commit(next);
                gsap.fromTo(
                  ".preview-shape",
                  { scale: 0.92, rotate: -4 },
                  { scale: 1, rotate: 0, duration: 0.35, ease: "back.out(1.6)" },
                );
              }}
            >
              <strong>{shape.label}</strong>
              <span>{shape.desc}</span>
            </button>
          ))}
        </div>

        <div className="preview-wrap">
          <div className={previewClass} />
        </div>

        <div className="space-y-2">
          <Label>{t.window_size}</Label>
          <Slider
            value={[settings.scale]}
            min={0.6}
            max={1.8}
            step={0.05}
            onValueChange={(value) => {
              const next = { ...settings, scale: Number(value[0].toFixed(2)) };
              void commit(next);
            }}
          />
          <p className="hint">{t.current_prefix} {settings.scale.toFixed(2)}x</p>
        </div>
      </Card>

      <Card className="settings-section">
        <div className="section-title">
          <Lock size={16} />
          <h2>{t.behavior}</h2>
        </div>

        <div className="setting-row">
          <div>
            <Label>{t.mirror}</Label>
            <p className="hint">{t.mirror_hint}</p>
          </div>
          <Switch
            checked={settings.mirror}
            onCheckedChange={(checked) => {
              void commit({ ...settings, mirror: checked });
            }}
          />
        </div>

        <div className="setting-row">
          <div>
            <Label>{t.always_on_top}</Label>
            <p className="hint">{t.always_on_top_hint}</p>
          </div>
          <Switch
            checked={settings.alwaysOnTop}
            onCheckedChange={(checked) => {
              void setAlwaysOnTop(checked);
              void commit({ ...settings, alwaysOnTop: checked });
            }}
          />
        </div>

        <div className="setting-row">
          <div>
            <Label>{t.click_through}</Label>
            <p className="hint">{t.click_through_hint}</p>
          </div>
          <Switch
            checked={settings.clickThrough}
            onCheckedChange={(checked) => {
              void setClickThrough(checked);
              void commit({ ...settings, clickThrough: checked });
            }}
          />
        </div>

        <div className="setting-row">
          <div>
            <Label>{t.lock_drag}</Label>
            <p className="hint">{t.lock_drag_hint}</p>
          </div>
          <Switch
            checked={settings.locked}
            onCheckedChange={(checked) => {
              void commit({ ...settings, locked: checked });
            }}
          />
        </div>
      </Card>

      <Card className="settings-section">
        <div className="section-title">
          <Sparkles size={16} />
          <h2>{t.beauty}</h2>
        </div>

        <div className="setting-row">
          <div>
            <Label>{t.enable_beauty}</Label>
            <p className="hint">{t.beauty_hint}</p>
          </div>
          <Switch
            checked={settings.beauty}
            onCheckedChange={(checked) => {
              void commit({ ...settings, beauty: checked });
            }}
          />
        </div>

        {settings.beauty && (
          <>
            <div className="space-y-2" style={{ padding: "10px 0" }}>
              <Label>{t.smoothness}</Label>
              <Slider
                value={[settings.beautySmoothness]}
                min={0}
                max={100}
                step={1}
                onValueChange={(value) => {
                  void commit({ ...settings, beautySmoothness: value[0] });
                }}
              />
              <p className="hint">{t.current_prefix} {settings.beautySmoothness}%</p>
            </div>

            <div className="space-y-2" style={{ padding: "10px 0" }}>
              <Label>{t.brightness}</Label>
              <Slider
                value={[settings.beautyBrightness]}
                min={0}
                max={100}
                step={1}
                onValueChange={(value) => {
                  void commit({ ...settings, beautyBrightness: value[0] });
                }}
              />
              <p className="hint">{t.current_prefix} {settings.beautyBrightness}%{t.brightness_original_hint}</p>
            </div>
          </>
        )}
      </Card>

      <Card className="settings-section">
        <div className="section-title">
          <Sparkles size={16} />
          <h2>{t.keyboard_display}</h2>
        </div>

        <div className="setting-row">
          <div>
            <Label>{t.keyboard_show}</Label>
            <p className="hint">{t.keyboard_show_hint}</p>
          </div>
          <Switch
            checked={settings.keyboardDisplayEnabled}
            onCheckedChange={async (checked) => {
              await toggleKeyboardWindow(checked);
              void commit({ ...settings, keyboardDisplayEnabled: checked });
            }}
          />
        </div>

        {settings.keyboardDisplayEnabled && (
          <>
            <div className="space-y-2" style={{ padding: "10px 0" }}>
              <Label>{t.keyboard_fade_out}</Label>
              <Slider
                value={[settings.keyboardDisplayFadeOut]}
                min={500}
                max={5000}
                step={100}
                onValueChange={(value) => {
                  void commit({ ...settings, keyboardDisplayFadeOut: value[0] });
                }}
              />
              <p className="hint">{t.current_prefix} {settings.keyboardDisplayFadeOut}ms</p>
            </div>

            <div className="space-y-2" style={{ padding: "10px 0" }}>
              <Label>{t.keyboard_width}</Label>
              <Slider
                value={[settings.keyboardDisplayWidth]}
                min={400}
                max={1400}
                step={50}
                onValueChange={(value) => {
                  void commit({ ...settings, keyboardDisplayWidth: value[0] });
                }}
              />
              <p className="hint">{t.current_prefix} {settings.keyboardDisplayWidth}px</p>
            </div>

            <div className="space-y-2" style={{ padding: "10px 0" }}>
              <Label>{t.keyboard_scale}</Label>
              <Slider
                value={[settings.keyboardDisplayScale]}
                min={0.5}
                max={2}
                step={0.1}
                onValueChange={(value) => {
                  void commit({ ...settings, keyboardDisplayScale: Number(value[0].toFixed(1)) });
                }}
              />
              <p className="hint">{t.current_prefix} {settings.keyboardDisplayScale.toFixed(1)}x</p>
            </div>

            <div className="space-y-2" style={{ padding: "10px 0" }}>
              <Label>{t.keyboard_style}</Label>
              <div className="shape-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
                {(["dark", "light", "glass", "outline"] as KeyboardDisplayStyle[]).map((style) => (
                  <button
                    key={style}
                    type="button"
                    className={`shape-card ${settings.keyboardDisplayStyle === style ? "active" : ""}`}
                    onClick={() => void commit({ ...settings, keyboardDisplayStyle: style })}
                  >
                    <strong>{t[`keyboard_style_${style}` as keyof typeof t]}</strong>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </Card>

      <Card className="settings-section">
        <div className="section-title">
          <Video size={16} />
          <h2>{t.recording}</h2>
        </div>

        <div className="setting-row">
          <div>
            <Label>{t.recording_show}</Label>
            <p className="hint">{t.recording_show_hint}</p>
          </div>
          <Switch
            checked={settings.recordingEnabled}
            onCheckedChange={async (checked) => {
              await toggleRecordingWindow(checked);
              void commit({ ...settings, recordingEnabled: checked });
            }}
          />
        </div>

        <div className="setting-row">
          <div>
            <Label>{t.recording_region}</Label>
            <p className="hint">
              {t.recording_region_current}:{" "}
              {region
                ? `${Math.round(region.width / (window.devicePixelRatio || 1))} × ${Math.round(region.height / (window.devicePixelRatio || 1))}`
                : t.recording_region_full}
            </p>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Button
              variant="secondary"
              onClick={() => void startRegionSelect()}
              style={{ height: 28, fontSize: 12, padding: "0 10px" }}
            >
              {t.recording_region_pick}
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                await resetRecordingRegion();
                setRegion(null);
              }}
              style={{ height: 28, fontSize: 12, padding: "0 10px" }}
            >
              {t.recording_region_reset}
            </Button>
          </div>
        </div>

        <div className="setting-row">
          <div>
            <Label>{t.recording_output_dir}</Label>
            <p className="hint" style={{ wordBreak: "break-all" }}>
              {settings.recordingOutputDir || t.recording_output_default}
            </p>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Button
              variant="secondary"
              onClick={async () => {
                const dir = await pickRecordingOutputDir();
                if (dir) {
                  void commit({ ...settings, recordingOutputDir: dir });
                }
              }}
              style={{ height: 28, fontSize: 12, padding: "0 10px" }}
            >
              {t.recording_output_dir_pick}
            </Button>
            <Button
              variant="secondary"
              disabled={!settings.recordingOutputDir}
              onClick={() => {
                void commit({ ...settings, recordingOutputDir: undefined });
              }}
              style={{ height: 28, fontSize: 12, padding: "0 10px" }}
            >
              {t.recording_output_dir_reset}
            </Button>
          </div>
        </div>

        <div className="space-y-2" style={{ padding: "10px 0" }}>
          <Label>{t.recording_fps}</Label>
          <Slider
            value={[settings.recordingFps]}
            min={15}
            max={60}
            step={5}
            onValueChange={(value) => {
              void commit({ ...settings, recordingFps: value[0] });
            }}
          />
          <p className="hint">{t.current_prefix} {settings.recordingFps} fps</p>
        </div>

        <div className="setting-row">
          <div>
            <Label>{t.recording_auto_zoom}</Label>
            <p className="hint">{t.recording_auto_zoom_hint}</p>
          </div>
          <Switch
            checked={settings.recordingAutoZoom}
            onCheckedChange={(checked) => {
              void commit({ ...settings, recordingAutoZoom: checked });
            }}
          />
        </div>

        {settings.recordingAutoZoom && (
          <div className="space-y-2" style={{ padding: "10px 0" }}>
            <Label>{t.recording_zoom_factor}</Label>
            <Slider
              value={[settings.recordingZoomFactor]}
              min={1.5}
              max={4}
              step={0.5}
              onValueChange={(value) => {
                void commit({ ...settings, recordingZoomFactor: value[0] });
              }}
            />
            <p className="hint">{t.current_prefix} {settings.recordingZoomFactor}×</p>
          </div>
        )}

        <div className="setting-row">
          <div>
            <Label>{t.cursor_overlay}</Label>
            <p className="hint">{t.cursor_overlay_hint}</p>
          </div>
          <Switch
            checked={settings.recordingCursorOverlay}
            onCheckedChange={(checked) => {
              void commit({ ...settings, recordingCursorOverlay: checked });
            }}
          />
        </div>

        {settings.recordingCursorOverlay && (
          <>
            <div className="setting-row">
              <div>
                <Label>{t.cursor_trail}</Label>
              </div>
              <Switch
                checked={settings.cursorTrailEnabled}
                onCheckedChange={(checked) => {
                  void commit({ ...settings, cursorTrailEnabled: checked });
                }}
              />
            </div>

            <div className="space-y-2" style={{ padding: "10px 0" }}>
              <Label>{t.cursor_style}</Label>
              <div className="shape-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
                {(["ripple", "ring", "spark", "none"] as CursorEffectStyle[]).map((style) => (
                  <button
                    key={style}
                    type="button"
                    className={`shape-card ${settings.cursorEffectStyle === style ? "active" : ""}`}
                    onClick={() => void commit({ ...settings, cursorEffectStyle: style })}
                  >
                    <strong>{t[`cursor_style_${style}` as keyof typeof t]}</strong>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </Card>

      <Card className="settings-section hotkey-card">
        <div className="section-title">
          <Sparkles size={16} />
          <h2>{t.hotkeys}</h2>
        </div>
        <p><kbd>Cmd/Ctrl + Shift + V</kbd> {t.hotkey_toggle_visibility}</p>
        <p><kbd>Cmd/Ctrl + Shift + L</kbd> {t.hotkey_toggle_lock}</p>
        <p><kbd>Cmd/Ctrl + Shift + ,</kbd> {t.hotkey_open_settings}</p>
        <p><kbd>Cmd/Ctrl + Shift + R</kbd> {t.hotkey_toggle_recording}</p>
      </Card>

      <footer className="settings-footer settings-section">
        <Button variant="secondary" onClick={() => void openSettingsWindow()}>
          <Pin size={16} />
          {t.focus_settings}
        </Button>
        <Button disabled={saving}>{saving ? t.saving : t.auto_saved}</Button>
      </footer>
    </main>
  );
}

export function SettingsWindow() {
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
      <SettingsContent />
    </I18nProvider>
  );
}
