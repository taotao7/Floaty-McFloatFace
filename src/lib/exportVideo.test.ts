import { describe, it, expect, afterEach } from "vitest";
import { scaledDimensions, exportDimensions, coverWindow, computeFrameWindow, filterSignificantActivity, mimeForFormat, formatSupported, recordingStamp, sampleCursor, isZoomActive, computeZoomWindow, localizeTrail } from "./exportVideo";
import type { CursorSample } from "../types/app";

type MR = typeof MediaRecorder;

function stubMediaRecorder(supported: Set<string> | null) {
  const g = globalThis as unknown as { MediaRecorder?: MR };
  if (supported === null) {
    delete g.MediaRecorder;
  } else {
    g.MediaRecorder = { isTypeSupported: (m: string) => supported.has(m) } as MR;
  }
}

describe("scaledDimensions", () => {
  it("keeps source size when target is null", () => {
    expect(scaledDimensions(1920, 1080, null)).toEqual({ width: 1920, height: 1080 });
  });

  it("downscales preserving aspect ratio", () => {
    expect(scaledDimensions(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
  });

  it("upscales when the target is above the source (4K from a 1x capture)", () => {
    expect(scaledDimensions(1280, 720, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(scaledDimensions(1920, 1080, 2160)).toEqual({ width: 3840, height: 2160 });
  });

  it("rounds to even dimensions (h264 requirement)", () => {
    const r = scaledDimensions(3021, 1965, 720);
    expect(r.width % 2).toBe(0);
    expect(r.height % 2).toBe(0);
  });

  it("rounds odd source dimensions to even", () => {
    const r = scaledDimensions(3021, 1965, null);
    expect(r).toEqual({ width: 3022, height: 1966 });
  });
});

describe("coverWindow", () => {
  it("fits a portrait viewport inside a landscape source (full height)", () => {
    const w = coverWindow(1920, 1080, 9 / 16);
    expect(w.h).toBe(1080);
    expect(w.w).toBeCloseTo(1080 * (9 / 16), 5);
  });

  it("fits a landscape viewport inside a tall source (full width)", () => {
    const w = coverWindow(1080, 1920, 16 / 9);
    expect(w.w).toBe(1080);
    expect(w.h).toBeCloseTo(1080 / (16 / 9), 5);
  });

  it("square viewport in a landscape source uses full height", () => {
    expect(coverWindow(1920, 1080, 1)).toEqual({ w: 1080, h: 1080 });
  });
});

describe("exportDimensions", () => {
  it("matches scaledDimensions when aspect is null", () => {
    expect(exportDimensions(1920, 1080, 720, null)).toEqual({ width: 1280, height: 720 });
  });

  it("sizes a portrait export to the cover viewport (no minted pixels)", () => {
    const r = exportDimensions(1920, 1080, null, 9 / 16);
    // Viewport is 607.5×1080 → even-rounded canvas.
    expect(r.height).toBe(1080);
    expect(r.width).toBe(608);
  });

  it("respects a smaller target height with a fixed aspect", () => {
    const r = exportDimensions(1920, 1080, 720, 9 / 16);
    expect(r.height).toBe(720);
    expect(r.width).toBe(Math.round((720 * 9) / 16 / 2) * 2);
  });

  it("keeps even dimensions with a fixed aspect", () => {
    const r = exportDimensions(3021, 1965, 720, 1);
    expect(r.width % 2).toBe(0);
    expect(r.height % 2).toBe(0);
  });
});

describe("computeFrameWindow", () => {
  const base = { sx: 0, sy: 0, sw: 1920, sh: 1080 };

  it("with aspect, follows the cursor with an aspect-shaped viewport (no zoom)", () => {
    const trail: CursorSample[] = [{ t: 0, x: 1600, y: 540, type: "move" }];
    let state = { ...base };
    for (let i = 0; i < 300; i++) {
      state = computeFrameWindow({
        trail, base, aspect: 9 / 16, zoomFactor: 1, tMs: 10_000, smoothState: state,
      });
    }
    // Viewport: 607.5×1080 centered on x=1600 (inside the frame, no clamp).
    expect(state.sh).toBeCloseTo(1080, 1);
    expect(state.sw).toBeCloseTo(607.5, 1);
    expect(state.sx).toBeCloseTo(1600 - 607.5 / 2, 1);
    expect(state.sy).toBeCloseTo(0, 1);
  });

  it("with aspect, stays centered without a trail", () => {
    let state = { ...base };
    for (let i = 0; i < 300; i++) {
      state = computeFrameWindow({
        trail: null, base, aspect: 1, zoomFactor: 2, tMs: 0, smoothState: state,
      });
    }
    // No trail: no zoom (zoom needs activity), square viewport centered.
    expect(state.sw).toBeCloseTo(1080, 1);
    expect(state.sh).toBeCloseTo(1080, 1);
    expect(state.sx).toBeCloseTo((1920 - 1080) / 2, 1);
  });

  it("zoom shrinks the aspect viewport further while active", () => {
    const trail: CursorSample[] = [{ t: 0, x: 960, y: 540, type: "move" }];
    let state = { ...base };
    for (let i = 0; i < 300; i++) {
      state = computeFrameWindow({
        trail, base, aspect: 9 / 16, zoomFactor: 2, tMs: 100, smoothState: state,
      });
    }
    expect(state.sw).toBeCloseTo(607.5 / 2, 1);
    expect(state.sh).toBeCloseTo(540, 1);
  });

  it("matches computeZoomWindow semantics when aspect is null", () => {
    const trail: CursorSample[] = [{ t: 0, x: 500, y: 300, type: "move" }];
    let a = { ...base };
    let b = { ...base };
    for (let i = 0; i < 50; i++) {
      a = computeFrameWindow({
        trail, base, aspect: null, zoomFactor: 2, tMs: 100, smoothState: a,
      });
      b = computeZoomWindow(trail, base, b, 2, 100);
    }
    expect(a.sx).toBeCloseTo(b.sx, 6);
    expect(a.sy).toBeCloseTo(b.sy, 6);
    expect(a.sw).toBeCloseTo(b.sw, 6);
    expect(a.sh).toBeCloseTo(b.sh, 6);
  });

  it("smoothing=1 snaps straight to the target", () => {
    const state = computeFrameWindow({
      trail: null, base, aspect: 1, zoomFactor: 1, tMs: 0,
      smoothState: { ...base }, smoothing: 1,
    });
    expect(state).toEqual({ sx: 420, sy: 0, sw: 1080, sh: 1080 });
  });
});

describe("filterSignificantActivity", () => {
  it("keeps clicks and drops sub-jitter moves", () => {
    const trail: CursorSample[] = [
      { t: 0, x: 100, y: 100, type: "move" },
      { t: 10, x: 102, y: 101, type: "move" }, // jitter
      { t: 20, x: 99, y: 100, type: "move" }, // jitter
      { t: 30, x: 100, y: 100, type: "down", button: "left" }, // click: kept
      { t: 40, x: 300, y: 100, type: "move" }, // real travel: kept
    ];
    const out = filterSignificantActivity(trail, 14);
    expect(out.map((s) => s.t)).toEqual([0, 30, 40]);
  });

  it("accumulates slow drift against the last significant sample", () => {
    // Each step is 6px (< jitter) but drift accumulates; a sample registers
    // once total displacement from the last kept sample exceeds the gate.
    const trail: CursorSample[] = Array.from({ length: 10 }, (_, i) => ({
      t: i * 10,
      x: 100 + i * 6,
      y: 100,
      type: "move" as const,
    }));
    const out = filterSignificantActivity(trail, 14);
    expect(out.length).toBeGreaterThan(1); // drift eventually registers
    expect(out.length).toBeLessThan(10); // but jitter-sized steps are folded
  });

  it("returns empty for an empty trail", () => {
    expect(filterSignificantActivity([], 14)).toEqual([]);
  });
});

describe("mimeForFormat / formatSupported", () => {
  afterEach(() => stubMediaRecorder(null));

  it("picks h264 mp4 when supported", () => {
    stubMediaRecorder(new Set(["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4"]));
    expect(mimeForFormat("mp4")).toBe("video/mp4;codecs=avc1.42E01E,mp4a.40.2");
  });

  it("picks vp9 webm when supported", () => {
    stubMediaRecorder(new Set(["video/webm;codecs=vp9", "video/webm"]));
    expect(mimeForFormat("webm")).toBe("video/webm;codecs=vp9");
  });

  it("falls back to the bare container when nothing matches", () => {
    stubMediaRecorder(new Set());
    expect(mimeForFormat("mp4")).toBe("video/mp4");
    expect(mimeForFormat("webm")).toBe("video/webm");
  });

  it("formatSupported reflects isTypeSupported", () => {
    stubMediaRecorder(new Set(["video/mp4"]));
    expect(formatSupported("mp4")).toBe(true);
    expect(formatSupported("webm")).toBe(false);
  });

  it("formatSupported is false without MediaRecorder", () => {
    stubMediaRecorder(null);
    expect(formatSupported("mp4")).toBe(false);
  });
});

describe("recordingStamp", () => {
  it("formats as YYYYMMDD-HHMMSS", () => {
    expect(recordingStamp()).toMatch(/^\d{8}-\d{6}$/);
  });
});

describe("sampleCursor", () => {
  const trail: CursorSample[] = [
    { t: 0, x: 100, y: 100, type: "move" },
    { t: 100, x: 200, y: 200, type: "move" },
    { t: 200, x: 300, y: 300, type: "down", button: "left" },
  ];

  it("returns the fallback before the first sample", () => {
    expect(sampleCursor(trail, -5, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("returns the fallback at t=0 when the trail is empty", () => {
    expect(sampleCursor([], 50, { x: 7, y: 9 })).toEqual({ x: 7, y: 9 });
  });

  it("returns the most recent sample at or before t", () => {
    expect(sampleCursor(trail, 100, { x: 0, y: 0 })).toEqual({ x: 200, y: 200 });
    expect(sampleCursor(trail, 150, { x: 0, y: 0 })).toEqual({ x: 200, y: 200 });
    expect(sampleCursor(trail, 999, { x: 0, y: 0 })).toEqual({ x: 300, y: 300 });
  });
});

describe("isZoomActive", () => {
  const trail: CursorSample[] = [
    { t: 0, x: 0, y: 0, type: "move" },
    { t: 1000, x: 0, y: 0, type: "move" },
  ];

  it("is false before any activity", () => {
    expect(isZoomActive(trail, -1)).toBe(false);
  });

  it("is true within the hold window after activity", () => {
    expect(isZoomActive(trail, 1000)).toBe(true);
    expect(isZoomActive(trail, 2500)).toBe(true);
  });

  it("is false after the hold window elapses", () => {
    expect(isZoomActive(trail, 1000 + 2600)).toBe(false);
    expect(isZoomActive(trail, 4000)).toBe(false);
  });
});

describe("localizeTrail", () => {
  it("subtracts the crop origin from every sample, leaving other fields intact", () => {
    const trail: CursorSample[] = [
      { t: 0, x: 500, y: 300, type: "move" },
      { t: 50, x: 520, y: 310, type: "down", button: "left" },
    ];
    const out = localizeTrail(trail, { sx: 400, sy: 200 });
    expect(out[0]).toEqual({ t: 0, x: 100, y: 100, type: "move" });
    expect(out[1]).toEqual({ t: 50, x: 120, y: 110, type: "down", button: "left" });
    // Original trail must not be mutated (the replay path is shared).
    expect(trail[0].x).toBe(500);
  });

  it("applies the content scale before subtracting the crop origin", () => {
    // 1x-content capture (contentScale 0.5): global physical coords are
    // halved into frame content space, then shifted by the crop origin.
    const trail: CursorSample[] = [{ t: 0, x: 1000, y: 800, type: "move" }];
    const out = localizeTrail(trail, { sx: 100, sy: 50 }, 0.5);
    expect(out[0]).toEqual({ t: 0, x: 400, y: 350, type: "move" });
  });
});

describe("computeZoomWindow", () => {
  const base = { sx: 0, sy: 0, sw: 1000, sh: 600 };

  it("returns the base crop when zoomed out and snaps over a few frames", () => {
    const trail: CursorSample[] = [{ t: 0, x: 500, y: 300, type: "move" }];
    let state = { ...base };
    // No recent activity at a large t → target is the base crop; after enough
    // smoothing frames the state converges back to base.
    for (let i = 0; i < 50; i++) {
      state = computeZoomWindow(trail, base, state, 2, 10_000);
    }
    expect(state).toEqual(base);
  });

  it("shrinks the source window toward the cursor when zoom is active", () => {
    const trail: CursorSample[] = [{ t: 0, x: 500, y: 300, type: "move" }];
    let state = { ...base };
    // smoothCrop closes 12% of the gap per frame, so it takes a while to
    // converge; 200 frames leaves < 1e-10 of the original distance.
    for (let i = 0; i < 200; i++) {
      state = computeZoomWindow(trail, base, state, 2, 0);
    }
    // factor 2 → window is half the base, centered on (500, 300).
    expect(state.sw).toBeCloseTo(500, 3);
    expect(state.sh).toBeCloseTo(300, 3);
    expect(state.sx).toBeCloseTo(250, 3);
    expect(state.sy).toBeCloseTo(150, 3);
  });
});
