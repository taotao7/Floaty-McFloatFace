/**
 * Post-capture export rendering for the recording editor.
 *
 * The editor plays the recorded draft through a hidden `<video>`, draws each
 * frame into a canvas (optionally downscaled), and re-encodes with
 * `MediaRecorder` — honoring the user's trim range. Export runs at 1×
 * playback speed; the editor reports progress from the playhead.
 *
 * Audio is routed through a `MediaElementSourceNode` → `MediaStreamDestination`
 * so it lands in the exported file without playing out loud.
 *
 * Pure helpers (`scaledDimensions`, `mimeForFormat`) are unit-tested; the
 * render function itself is thin orchestration over browser APIs.
 */

export interface ExportOptions {
  /** Blob URL of the source recording. */
  src: string;
  /** Trim range in seconds. `end` must be greater than `start`. */
  start: number;
  end: number;
  /** Target height in px (null = keep source resolution). Aspect preserved. */
  targetHeight: number | null;
  /** Container/codec for the output, e.g. from `mimeForFormat`. */
  mimeType: string;
  /** Canvas capture frame rate. */
  fps: number;
  /** Called with export progress in [0,1] as the playhead advances. */
  onProgress?: (frac: number) => void;
}

/**
 * Compute output dimensions for a target height, preserving aspect ratio and
 * rounding to even numbers (H.264 encoders reject odd dimensions). A null or
 * larger-than-source target keeps the source size.
 */
export function scaledDimensions(
  srcW: number,
  srcH: number,
  targetHeight: number | null,
): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (!targetHeight || targetHeight >= srcH) {
    return { width: even(srcW), height: even(srcH) };
  }
  const scale = targetHeight / srcH;
  return { width: even(srcW * scale), height: even(targetHeight) };
}

/** Best-supported mime for a user-chosen export container. */
export function mimeForFormat(format: "mp4" | "webm"): string {
  const candidates =
    format === "mp4"
      ? ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1", "video/mp4"]
      : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return format === "mp4" ? "video/mp4" : "video/webm";
}

/** Whether the current webview can encode the given container. */
export function formatSupported(format: "mp4" | "webm"): boolean {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) {
    return false;
  }
  return MediaRecorder.isTypeSupported(mimeForFormat(format));
}

/** `YYYYMMDD-HHMMSS` for export filenames (matches the pipeline's naming). */
export function recordingStamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Re-encode `src` restricted to [start, end] at the requested size.
 * Resolves with the encoded bytes once the recorder flushes.
 */
export async function renderExport(opts: ExportOptions): Promise<Uint8Array> {
  const { src, start, end, targetHeight, mimeType, fps, onProgress } = opts;
  if (!(end > start)) throw new Error("empty trim range");

  const video = document.createElement("video");
  video.src = src;
  video.playsInline = true;
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("video load failed"));
  });

  const { width, height } = scaledDimensions(video.videoWidth, video.videoHeight, targetHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("canvas unavailable");

  const stream = canvas.captureStream(fps);

  // Route the element's audio into the export silently (no speaker output).
  // If the clip has no audio or the webview refuses, continue video-only.
  let audioCtx: AudioContext | null = null;
  try {
    audioCtx = new AudioContext();
    const source = audioCtx.createMediaElementSource(video);
    const dest = audioCtx.createMediaStreamDestination();
    source.connect(dest);
    dest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
  } catch {
    audioCtx = null;
  }

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType });
  } catch {
    recorder = new MediaRecorder(stream);
  }
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const flushed = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType.split(";")[0] }));
  });

  await seekTo(video, start);
  recorder.start(500);
  await video.play();

  await new Promise<void>((resolve) => {
    video.addEventListener("ended", () => resolve(), { once: true });
    const tick = () => {
      if (video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, width, height);
      }
      onProgress?.(Math.min(1, Math.max(0, (video.currentTime - start) / (end - start))));
      if (video.currentTime >= end || video.ended) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  video.pause();
  if (recorder.state !== "inactive") recorder.stop();
  const blob = await flushed;
  void audioCtx?.close().catch(() => undefined);
  return new Uint8Array(await blob.arrayBuffer());
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = t;
  });
}
