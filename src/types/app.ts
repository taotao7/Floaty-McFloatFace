export type ShapePreset = "circle" | "roundedSquare" | "mickey";

export interface CameraDevice {
  deviceId: string;
  label: string;
  groupId?: string;
}

export interface AppSettings {
  selectedCameraId?: string;
  shape: ShapePreset;
  scale: number;
  mirror: boolean;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  locked: boolean;
  qualityMode: "auto";
  beauty: boolean;
  beautySmoothness: number;
  beautyBrightness: number;
  locale: string;
  keyboardDisplayEnabled: boolean;
  keyboardDisplayPosition: "bottom-center" | "top-center" | "bottom-left" | "bottom-right";
  keyboardDisplayScale: number;
  keyboardDisplayFadeOut: number;
  keyboardDisplayWidth: number;
}

export interface RuntimeState {
  visible: boolean;
  dragging: boolean;
  streamReady: boolean;
  permission: "unknown" | "granted" | "denied";
}

export const defaultSettings: AppSettings = {
  selectedCameraId: undefined,
  shape: "circle",
  scale: 1,
  mirror: true,
  alwaysOnTop: true,
  clickThrough: false,
  locked: false,
  qualityMode: "auto",
  beauty: false,
  beautySmoothness: 30,
  beautyBrightness: 50,
  locale: "",
  keyboardDisplayEnabled: true,
  keyboardDisplayPosition: "bottom-center",
  keyboardDisplayScale: 1,
  keyboardDisplayFadeOut: 2000,
  keyboardDisplayWidth: 800,
};

export interface KeyEvent {
  key: string;
  modifiers: string[];
  timestamp: number;
}
