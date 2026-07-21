import { describe, it, expect, afterEach } from "vitest";
import { pickMimeType, extensionForMime } from "./useRecordingPipeline";

type MR = typeof MediaRecorder;

/** Stub MediaRecorder.isTypeSupported for the duration of a test. */
function stubMediaRecorder(supported: Set<string> | null) {
  const g = globalThis as unknown as { MediaRecorder?: MR };
  if (supported === null) {
    delete g.MediaRecorder;
  } else {
    g.MediaRecorder = { isTypeSupported: (m: string) => supported.has(m) } as MR;
  }
}

describe("pickMimeType", () => {
  afterEach(() => {
    // Restore to "undefined" so other test files aren't affected.
    stubMediaRecorder(null);
  });

  it("prefers mp4 with h264+aac when supported", () => {
    stubMediaRecorder(new Set(["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/webm;codecs=vp9"]));
    expect(pickMimeType()).toBe("video/mp4;codecs=avc1.42E01E,mp4a.40.2");
  });

  it("prefers plain mp4 over webm", () => {
    stubMediaRecorder(new Set(["video/mp4", "video/webm;codecs=vp9"]));
    expect(pickMimeType()).toBe("video/mp4");
  });

  it("falls back to webm when mp4 is unsupported (Chromium webview)", () => {
    stubMediaRecorder(new Set(["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]));
    expect(pickMimeType()).toBe("video/webm;codecs=vp9");
  });

  it("falls back to vp8 when vp9 unsupported", () => {
    stubMediaRecorder(new Set(["video/webm;codecs=vp8", "video/webm"]));
    expect(pickMimeType()).toBe("video/webm;codecs=vp8");
  });

  it("falls back to plain webm when no codec specified", () => {
    stubMediaRecorder(new Set(["video/webm"]));
    expect(pickMimeType()).toBe("video/webm");
  });

  it("returns mp4 when MediaRecorder is undefined", () => {
    stubMediaRecorder(null);
    expect(pickMimeType()).toBe("video/mp4");
  });

  it("returns mp4 when nothing is supported", () => {
    stubMediaRecorder(new Set());
    expect(pickMimeType()).toBe("video/mp4");
  });
});

describe("extensionForMime", () => {
  it("maps mp4 types to mp4", () => {
    expect(extensionForMime("video/mp4")).toBe("mp4");
    expect(extensionForMime("video/mp4;codecs=avc1")).toBe("mp4");
  });

  it("maps webm types to webm", () => {
    expect(extensionForMime("video/webm")).toBe("webm");
    expect(extensionForMime("video/webm;codecs=vp9")).toBe("webm");
  });
});
