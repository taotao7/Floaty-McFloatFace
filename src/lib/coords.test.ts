import { describe, it, expect } from "vitest";
import {
  cssToPhysical,
  physicalToCss,
  computeCropRect,
  computeZoomedCrop,
  smoothCrop,
  validateCaptureAssumption,
  clamp,
} from "./coords";

describe("clamp", () => {
  it("clamps within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
  it("returns min when max < min (degenerate)", () => {
    expect(clamp(5, 10, 0)).toBe(10);
  });
});

describe("cssToPhysical", () => {
  it("scales by dpr and rounds", () => {
    expect(cssToPhysical({ x: 100, y: 50, width: 80, height: 40 }, 2)).toEqual({
      x: 200,
      y: 100,
      width: 160,
      height: 80,
    });
  });
  it("treats dpr<=0 as 1", () => {
    expect(cssToPhysical({ x: 100, y: 50, width: 80, height: 40 }, 0)).toEqual({
      x: 100,
      y: 50,
      width: 80,
      height: 40,
    });
  });
  it("rounds fractional results", () => {
    expect(cssToPhysical({ x: 1.4, y: 1.6, width: 10.5, height: 10.4 }, 2)).toEqual({
      x: 3,
      y: 3,
      width: 21,
      height: 21,
    });
  });
});

describe("physicalToCss", () => {
  it("divides by dpr", () => {
    expect(physicalToCss({ x: 200, y: 100 }, 2)).toEqual({ x: 100, y: 50 });
  });
  it("treats dpr<=0 as 1", () => {
    expect(physicalToCss({ x: 200, y: 100 }, 0)).toEqual({ x: 200, y: 100 });
  });
  it("is the inverse of cssToPhysical for points", () => {
    const p = { x: 1234, y: 567 };
    expect(physicalToCss(p, 2)).toEqual({ x: 617, y: 283.5 });
  });
});

describe("computeCropRect", () => {
  it("returns full frame when region is null", () => {
    expect(computeCropRect(null, 1920, 1080)).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080 });
  });
  it("places region at origin when sourceOrigin is 0,0", () => {
    const region = { x: 100, y: 50, width: 800, height: 600 };
    expect(computeCropRect(region, 1920, 1080)).toEqual({ sx: 100, sy: 50, sw: 800, sh: 600 });
  });
  it("translates by sourceOrigin for multi-monitor offset", () => {
    const region = { x: 2000, y: 100, width: 800, height: 600 };
    // The captured frame is the right-hand monitor, whose top-left global
    // coordinate is (1920, 0). Region at global x=2000 → local x=80 in the frame.
    expect(computeCropRect(region, 1920, 1080, { x: 1920, y: 0 })).toEqual({
      sx: 80,
      sy: 100,
      sw: 800,
      sh: 600,
    });
  });
  it("clamps region that extends past the frame", () => {
    const region = { x: 1500, y: 900, width: 800, height: 600 };
    const r = computeCropRect(region, 1920, 1080);
    expect(r).toEqual({ sx: 1500, sy: 900, sw: 420, sh: 180 });
  });
  it("clamps region that starts before the frame (negative local)", () => {
    const region = { x: -100, y: -50, width: 800, height: 600 };
    const r = computeCropRect(region, 1920, 1080);
    expect(r.sx).toBe(0);
    expect(r.sy).toBe(0);
    // width shrinks by the 100/50 that fell off the left/top
    expect(r.sw).toBe(700);
    expect(r.sh).toBe(550);
  });
});

describe("computeZoomedCrop", () => {
  const base = { sx: 0, sy: 0, sw: 1920, sh: 1080 };

  it("returns the base crop when zoom <= 1", () => {
    expect(computeZoomedCrop({ x: 500, y: 500 }, base, 1)).toEqual(base);
    expect(computeZoomedCrop({ x: 500, y: 500 }, base, 0.5)).toEqual(base);
  });

  it("centers the zoomed window on the focus point", () => {
    const r = computeZoomedCrop({ x: 960, y: 540 }, base, 2);
    expect(r).toEqual({ sx: 480, sy: 270, sw: 960, sh: 540 });
  });

  it("clamps to the base crop edges instead of overflowing", () => {
    const r = computeZoomedCrop({ x: 10, y: 5 }, base, 2);
    expect(r).toEqual({ sx: 0, sy: 0, sw: 960, sh: 540 });
    const r2 = computeZoomedCrop({ x: 1919, y: 1079 }, base, 2);
    expect(r2).toEqual({ sx: 960, sy: 540, sw: 960, sh: 540 });
  });

  it("stays inside a sub-region base crop", () => {
    const regionBase = { sx: 100, sy: 100, sw: 800, sh: 600 };
    const r = computeZoomedCrop({ x: 120, y: 120 }, regionBase, 2);
    expect(r.sx).toBeGreaterThanOrEqual(100);
    expect(r.sy).toBeGreaterThanOrEqual(100);
    expect(r.sx + r.sw).toBeLessThanOrEqual(900);
    expect(r.sy + r.sh).toBeLessThanOrEqual(700);
  });

  it("never produces a zero-size source", () => {
    const tiny = { sx: 0, sy: 0, sw: 3, sh: 2 };
    const r = computeZoomedCrop({ x: 1, y: 1 }, tiny, 10);
    expect(r.sw).toBeGreaterThanOrEqual(1);
    expect(r.sh).toBeGreaterThanOrEqual(1);
  });
});

describe("smoothCrop", () => {
  const a = { sx: 0, sy: 0, sw: 100, sh: 100 };
  const b = { sx: 40, sy: 20, sw: 200, sh: 60 };

  it("snaps to target at t=1 and stays at t=0", () => {
    expect(smoothCrop(a, b, 1)).toEqual(b);
    expect(smoothCrop(a, b, 0)).toEqual(a);
  });

  it("interpolates each field linearly", () => {
    expect(smoothCrop(a, b, 0.5)).toEqual({ sx: 20, sy: 10, sw: 150, sh: 80 });
  });

  it("clamps t outside [0,1]", () => {
    expect(smoothCrop(a, b, 2)).toEqual(b);
    expect(smoothCrop(a, b, -1)).toEqual(a);
  });
});

describe("validateCaptureAssumption", () => {
  it("ok when dimensions match", () => {
    expect(validateCaptureAssumption(1920, 1080, 1920, 1080)).toEqual({ ok: true });
  });
  it("ok within tolerance (off-by-one rounding)", () => {
    expect(validateCaptureAssumption(1920, 1080, 1921, 1081)).toEqual({ ok: true });
  });
  it("fails when captured is smaller (downscaled HiDPI)", () => {
    const r = validateCaptureAssumption(1280, 720, 2560, 1440);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/does not match/);
  });
  it("fails for window/tab capture (tiny frame)", () => {
    const r = validateCaptureAssumption(800, 600, 1920, 1080);
    expect(r.ok).toBe(false);
  });
  it("respects custom tolerance", () => {
    expect(validateCaptureAssumption(1920, 1080, 1925, 1080, 10).ok).toBe(true);
    expect(validateCaptureAssumption(1920, 1080, 1925, 1080, 2).ok).toBe(false);
  });
});
