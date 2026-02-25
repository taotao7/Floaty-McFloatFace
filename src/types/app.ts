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
};
