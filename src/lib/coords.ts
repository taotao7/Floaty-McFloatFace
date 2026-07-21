/**
 * Coordinate-space conversions for the screen recording feature.
 *
 * Three windows needed these conversions, each previously hand-rolling the
 * math with its own (unvalidated) assumption about how CSS pixels relate to
 * physical screen pixels and to the captured video frame. Centralizing them
 * here makes the assumptions explicit (function names document them) and lets
 * the trickiest math — crop rectangle computation — be unit tested.
 *
 * Convention in this codebase:
 *   - "physical" = global screen coordinates in physical pixels. Mouse events
 *     are emitted in this space — the Rust tap converts `CGEventGetLocation`'s
 *     display points via the primary monitor's scale factor before emitting.
 *   - "css"      = browser layout pixels inside an overlay window.
 *   - The captured `getDisplayMedia` video frame is *assumed* to cover the
 *     primary monitor at 1:1 physical pixels. `validateCaptureAssumption`
 *     checks this and callers must surface a warning when it fails rather
 *     than silently mis-cropping.
 */

import type { RecordingRegion } from "../types/app";

export interface PhysicalPoint {
  /** Physical screen pixels (global). */
  x: number;
  y: number;
}

export interface PhysicalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CssPoint {
  x: number;
  y: number;
}

export interface CssRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Source-frame crop rectangle handed to `CanvasRenderingContext2D.drawImage`. */
export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Convert a rectangle drawn in CSS pixels (e.g. from the region-select
 * overlay) into physical screen pixels. Used when persisting the recording
 * region so it shares the coordinate space of the mouse event tap.
 */
export function cssToPhysical(rect: CssRect, dpr: number): PhysicalRect {
  const d = dpr > 0 ? dpr : 1;
  return {
    x: Math.round(rect.x * d),
    y: Math.round(rect.y * d),
    width: Math.round(rect.width * d),
    height: Math.round(rect.height * d),
  };
}

/**
 * Convert a physical-pixel point (e.g. a global mouse coordinate from the
 * event tap) into CSS pixels relative to an overlay window whose CSS origin
 * coincides with the screen origin.
 */
export function physicalToCss(point: PhysicalPoint, dpr: number): CssPoint {
  const d = dpr > 0 ? dpr : 1;
  return { x: point.x / d, y: point.y / d };
}

/**
 * Compute the source-frame crop rectangle for a recording.
 *
 * `region` is in global physical pixels. `sourceOrigin` is the global
 * physical coordinate of the captured frame's top-left corner — for a
 * full primary-monitor capture this is `{x:0, y:0}`. The region is
 * translated into the frame's local space and clamped to the frame bounds.
 *
 * Passing `sourceOrigin` (rather than assuming `{0,0}`) leaves a clean seam
 * for multi-monitor capture and window-following in a future version.
 */
export function computeCropRect(
  region: RecordingRegion | null,
  videoW: number,
  videoH: number,
  sourceOrigin: PhysicalPoint = { x: 0, y: 0 },
): CropRect {
  // No region → capture the whole frame.
  if (!region) {
    return { sx: 0, sy: 0, sw: videoW, sh: videoH };
  }

  // Translate region into the frame's local coordinate space.
  const localX = region.x - sourceOrigin.x;
  const localY = region.y - sourceOrigin.y;

  // The visible top-left is the region's local origin clamped into the frame.
  // Anything that fell off the left/top edge is subtracted from the size so
  // the crop stays anchored correctly instead of sliding.
  const sx = clamp(localX, 0, videoW);
  const sy = clamp(localY, 0, videoH);
  const lostLeft = sx - localX; // how many px were clipped on the left (>= 0)
  const lostTop = sy - localY;
  const desiredW = region.width - lostLeft;
  const desiredH = region.height - lostTop;
  // Whatever remains can't exceed the space between sx and the frame's right
  // edge; clamp to >= 1 so drawImage never gets a zero-size source.
  const sw = clamp(desiredW, 1, videoW - sx);
  const sh = clamp(desiredH, 1, videoH - sy);

  return { sx, sy, sw, sh };
}

/**
 * Compute the auto-zoom crop: a `zoom`-magnified window into `base`, centered
 * on `focus` and clamped so it never leaves the base crop. `zoom <= 1`
 * returns the base crop unchanged (full view). The output canvas keeps the
 * base crop's dimensions, so `drawImage` performs the magnification.
 *
 * `focus` is in the same space as `base` (frame-local physical pixels; for
 * full primary-monitor capture that equals the global physical coordinates
 * reported by the mouse event tap).
 */
export function computeZoomedCrop(
  focus: PhysicalPoint,
  base: CropRect,
  zoom: number,
): CropRect {
  const z = Math.max(1, zoom);
  if (z === 1) return { ...base };
  const sw = Math.max(1, base.sw / z);
  const sh = Math.max(1, base.sh / z);
  const sx = clamp(focus.x - sw / 2, base.sx, base.sx + base.sw - sw);
  const sy = clamp(focus.y - sh / 2, base.sy, base.sy + base.sh - sh);
  return { sx, sy, sw, sh };
}

/**
 * Frame-of-animation interpolation between two crop rectangles. `t` is the
 * fraction of the distance to close this frame (0 = frozen, 1 = snap). Kept
 * pure so the smoothing curve is unit-testable; the rAF loop owns the state.
 */
export function smoothCrop(current: CropRect, target: CropRect, t: number): CropRect {
  const f = clamp(t, 0, 1);
  const lerp = (a: number, b: number) => a + (b - a) * f;
  return {
    sx: lerp(current.sx, target.sx),
    sy: lerp(current.sy, target.sy),
    sw: lerp(current.sw, target.sw),
    sh: lerp(current.sh, target.sh),
  };
}

/**
 * Validate the "captured frame == primary monitor at 1:1 physical pixels"
 * assumption. Returns `{ ok: false, reason }` when the captured dimensions
 * do not match the primary monitor's physical size — which happens for
 * window/tab capture, non-primary monitor capture, or HiDPI downscaled
 * capture. Callers should emit a user-visible warning in that case rather
 * than silently mis-cropping.
 *
 * Tolerates a small delta to avoid false positives from off-by-one rounding
 * between the OS-reported monitor size and the negotiated track dimensions.
 */
export function validateCaptureAssumption(
  videoW: number,
  videoH: number,
  primaryPhysW: number,
  primaryPhysH: number,
  tolerance = 2,
): { ok: boolean; reason?: string } {
  const widthDelta = Math.abs(videoW - primaryPhysW);
  const heightDelta = Math.abs(videoH - primaryPhysH);
  if (widthDelta <= tolerance && heightDelta <= tolerance) {
    return { ok: true };
  }
  return {
    ok: false,
    reason:
      `Captured frame (${videoW}×${videoH}) does not match the primary monitor ` +
      `(${primaryPhysW}×${primaryPhysH}); the region crop may be inaccurate. ` +
      `This happens with multi-monitor, window, or tab capture.`,
  };
}

function clamp(v: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, v));
}

export { clamp };
