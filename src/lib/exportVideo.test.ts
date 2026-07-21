import { describe, it, expect, afterEach } from "vitest";
import { scaledDimensions, mimeForFormat, formatSupported, recordingStamp } from "./exportVideo";

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

  it("never upscales", () => {
    expect(scaledDimensions(1280, 720, 1080)).toEqual({ width: 1280, height: 720 });
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
