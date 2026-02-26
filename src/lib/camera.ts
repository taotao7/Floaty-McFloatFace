import type { CameraDevice } from "../types/app";

function getMediaDevices(): MediaDevices | null {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) {
    return null;
  }
  return navigator.mediaDevices;
}

export async function listBrowserCameras(): Promise<CameraDevice[]> {
  const mediaDevices = getMediaDevices();
  if (!mediaDevices) {
    return [];
  }

  const devices = await mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "videoinput")
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Camera ${index + 1}`,
      groupId: device.groupId || undefined,
    }));
}

const QUALITY_TIERS: MediaTrackConstraints[] = [
  { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } },
  { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
  { width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
];

export async function startAdaptiveStream(
  cameraId?: string,
  retries = 0,
): Promise<MediaStream> {
  const mediaDevices = getMediaDevices();
  if (!mediaDevices) {
    throw new Error("media_devices_unavailable");
  }

  let lastError: unknown;
  const deviceConstraint = cameraId ? { deviceId: { exact: cameraId } } : {};

  // 1) Try each quality tier with the requested device
  for (const tier of QUALITY_TIERS) {
    try {
      return await mediaDevices.getUserMedia({
        video: { ...tier, ...deviceConstraint },
        audio: false,
      });
    } catch (error) {
      lastError = error;
    }
  }

  // 2) Fallback: no resolution constraints, just the device
  if (cameraId) {
    try {
      return await mediaDevices.getUserMedia({
        video: { deviceId: { exact: cameraId } },
        audio: false,
      });
    } catch (error) {
      lastError = error;
    }
  }

  // 3) Last resort: { video: true } — any device, any resolution
  try {
    return await mediaDevices.getUserMedia({ video: true, audio: false });
  } catch (error) {
    lastError = error;
  }

  if (retries < 3) {
    const delayMs = 350 * 2 ** retries;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return startAdaptiveStream(cameraId, retries + 1);
  }

  throw lastError;
}

export function stopStream(stream?: MediaStream | null): void {
  if (!stream) {
    return;
  }

  for (const track of stream.getTracks()) {
    track.stop();
  }
}
