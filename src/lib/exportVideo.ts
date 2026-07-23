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
 * When a `RecordingMeta` cursor trajectory is provided and zoom is enabled,
 * each frame draws a magnified source window that follows the cursor,
 * replaying the same `computeZoomedCrop` + `smoothCrop` math the pre-bake
 * pipeline used to apply live — but now non-destructively.
 *
 * Pure helpers (`scaledDimensions`, `mimeForFormat`, `sampleCursor`,
 * `computeZoomWindow`) are unit-tested; the render function itself is thin
 * orchestration over browser APIs.
 */

import type { CursorSample, RecordingMeta } from "../types/app";
import { clamp, computeZoomedCrop, smoothCrop } from "./coords";
import type { CropRect } from "./coords";

/** How long after the last significant cursor activity the post-zoom stays
 *  zoomed in. Generous on purpose: zooming out and back in within a couple
 *  of seconds reads as flicker, staying zoomed a beat too long reads calm. */
const ZOOM_HOLD_MS = 2600;
/** Fraction of the remaining crop distance closed per animation frame. */
const ZOOM_SMOOTHING = 0.12;
/** Minimum travel (in trail px) for a move to count as zoom "activity".
 *  Hand tremor and sensor noise produce a stream of sub-pixel moves that
 *  would otherwise re-arm the zoom hold constantly, making the zoom pump
 *  in/out at every pause. Clicks always count. */
const ZOOM_JITTER_PX = 14;

export interface ExportZoomOptions {
  /** Whether to apply cursor-following zoom at all. */
  enabled: boolean;
  /** Magnification factor (>=1). 1 effectively disables zoom. */
  factor: number;
}

export interface ExportOptions {
  /** Blob URL of the source recording. */
  src: string;
  /** Trim range in seconds. `end` must be greater than `start`. */
  start: number;
  end: number;
  /** Target height in px (null = keep source resolution). Aspect preserved. */
  targetHeight: number | null;
  /** Output frame shape (null/absent = source shape). The source is drawn
   *  centered and undistorted; the rest of the canvas is black bars. */
  aspect?: number | null;
  /** Container/codec for the output, e.g. from `mimeForFormat`. */
  mimeType: string;
  /** Canvas capture frame rate. */
  fps: number;
  /** Called with export progress in [0,1] as the playhead advances. */
  onProgress?: (frac: number) => void;
  /** Recording metadata (cursor trail + base crop). When omitted, the export
   *  is a straight 1:1 rescale of the source frames. */
  meta?: RecordingMeta | null;
  /** Cursor-following zoom to replay against `meta.cursor`. Ignored when
   *  `meta` is missing or has an empty trail. */
  zoom?: ExportZoomOptions;
}

/**
 * Compute output dimensions for a target height, preserving aspect ratio and
 * rounding to even numbers (H.264 encoders reject odd dimensions). A null
 * target keeps the source size; an explicit target is honored in BOTH
 * directions — upscaling included, since the capture may be a 1x (CSS-point)
 * track that the user wants exported at 4K.
 */
export function scaledDimensions(
  srcW: number,
  srcH: number,
  targetHeight: number | null,
): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (!targetHeight || targetHeight === srcH) {
    return { width: even(srcW), height: even(srcH) };
  }
  const scale = targetHeight / srcH;
  return { width: even(srcW * scale), height: even(targetHeight) };
}

/** Output frame shapes for different destination screens. `null` aspect =
 *  keep the source's own shape. */
export type AspectPreset = "original" | "landscape" | "portrait" | "square";

export const ASPECT_RATIOS: Record<AspectPreset, number | null> = {
  original: null,
  /** PC / TV / YouTube. */
  landscape: 16 / 9,
  /** Phone vertical: Shorts / Reels / 抖音. */
  portrait: 9 / 16,
  /** Square social feeds. */
  square: 1,
};

/**
 * Output canvas size for an export. With `aspect` null the canvas hugs the
 * source shape (optionally downscaled to `targetHeight`). With a fixed
 * aspect the height anchor is `targetHeight` (or the largest cover-window
 * height) and the width follows the ratio. Even-rounded for H.264.
 *
 * A fixed aspect renders as a COVER CROP, not letterboxing: the source is
 * never squeezed into the frame with black bars — instead an aspect-shaped
 * viewport (see `coverWindow`) pans/zooms across the source and fills the
 * output completely.
 */
export function exportDimensions(
  srcW: number,
  srcH: number,
  targetHeight: number | null,
  aspect: number | null,
): { width: number; height: number } {
  if (!aspect) {
    return scaledDimensions(srcW, srcH, targetHeight);
  }
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  // Height anchor: explicit target wins (up or down — 4K from a 1x capture
  // is legitimate); otherwise the natural (unzoomed) viewport height.
  const natural = coverWindow(srcW, srcH, aspect).h;
  const height = even(targetHeight ?? natural);
  return { width: even(height * aspect), height };
}

/**
 * The largest `aspect`-shaped window (w/h ratio) that fits inside the
 * source frame — the "phone screen viewport" that pans across a landscape
 * recording. Pure.
 */
export function coverWindow(
  srcW: number,
  srcH: number,
  aspect: number,
): { w: number; h: number } {
  if (srcW / srcH > aspect) {
    return { w: srcH * aspect, h: srcH };
  }
  return { w: srcW, h: srcW / aspect };
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

/**
 * Find the most recent cursor position at time `tMs` (ms since recording start).
 *
 * The trajectory is sampled at full system event rate (60–125 Hz), far above
 * video fps, so a simple "last sample at or before t" lookup is visually
 * smooth without interpolation. Returns the base-crop center when the cursor
 * hasn't been seen yet (e.g. the recording starts before any mouse movement),
 * matching the pipeline's pre-bake behavior.
 *
 * Pure + unit-tested; callers (editor preview, export) share this so the
 * zoom focus point is identical in both paths.
 */
export function sampleCursor(
  trail: CursorSample[],
  tMs: number,
  fallback: { x: number; y: number },
): { x: number; y: number } {
  // Binary search for the rightmost sample with sample.t <= tMs.
  let lo = 0;
  let hi = trail.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (trail[mid].t <= tMs) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return fallback;
  const s = trail[lo - 1];
  return { x: s.x, y: s.y };
}

/**
 * Reduce a raw trail to "significant activity" samples: clicks always, and
 * moves only once they've travelled more than `jitterPx` from the previous
 * significant sample. Feeding THIS (not the raw trail) to `isZoomActive`
 * stops micro-jitter from re-arming the zoom hold, which is what made the
 * zoom pump in and out at every brief pause. Slow deliberate drift still
 * accumulates distance and registers. Pure; call once on load.
 */
export function filterSignificantActivity(
  trail: CursorSample[],
  jitterPx = ZOOM_JITTER_PX,
): CursorSample[] {
  const out: CursorSample[] = [];
  let ax: number | null = null;
  let ay = 0;
  for (const s of trail) {
    if (s.type !== "move" || ax === null || Math.hypot(s.x - ax, s.y - ay) > jitterPx) {
      out.push(s);
      ax = s.x;
      ay = s.y;
    }
  }
  return out;
}

/**
 * Decide whether the zoom should be "active" (magnified) at time `tMs`.
 *
 * Mirrors the pre-bake rule: zoomed in while the cursor moved/clicked within
 * the last `ZOOM_HOLD_MS`, otherwise zoomed out. Pure so the editor preview
 * and export agree on the transition points. Callers should pass the
 * `filterSignificantActivity` trail, not the raw one.
 */
export function isZoomActive(
  trail: CursorSample[],
  tMs: number,
  holdMs = ZOOM_HOLD_MS,
): boolean {
  // The last sample at/before tMs gives us the most recent activity time.
  let lo = 0;
  let hi = trail.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (trail[mid].t <= tMs) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return false;
  return tMs - trail[lo - 1].t < holdMs;
}

/**
 * Compute the source crop window to draw for the frame at time `tMs`.
 *
 * Combines `sampleCursor`, `isZoomActive`, `computeZoomedCrop`, and the
 * per-frame smoothing state into one call so the editor preview and the
 * export encoder can't drift apart. The caller owns the persistent
 * `smoothState` across frames (start it at `{...base}`).
 *
 * `trail` here is the **draft-local** trail (already shifted by the recorded
 * crop origin); `base` spans the whole draft frame (`0,0,videoW,videoH`).
 * `activity`, when given, is the `filterSignificantActivity` reduction of the
 * trail and drives only the zoom-in/out decision (focus still follows the
 * raw trail so the window tracks fine movements while zoomed).
 */
export function computeZoomWindow(
  trail: CursorSample[],
  base: CropRect,
  smoothState: CropRect,
  factor: number,
  tMs: number,
  activity: CursorSample[] = trail,
): CropRect {
  const zooming = factor > 1 && isZoomActive(activity, tMs);
  const focus = sampleCursor(trail, tMs, {
    x: base.sx + base.sw / 2,
    y: base.sy + base.sh / 2,
  });
  const target = computeZoomedCrop(focus, base, zooming ? factor : 1);
  return smoothCrop(smoothState, target, ZOOM_SMOOTHING);
}

/**
 * The per-frame source window for BOTH the editor preview and the export —
 * generalizes `computeZoomWindow` with an output aspect.
 *
 * With `aspect` null the window is the whole frame, shrinking toward the
 * cursor only while zoom is active (the classic behavior). With a fixed
 * aspect the window is the `coverWindow` viewport — a phone/square screen
 * panning across the recording, ALWAYS following the cursor (no black
 * bars, content fills the output); zoom shrinks that viewport further.
 * Without a trail the viewport stays centered. The caller owns
 * `smoothState` across frames (start at the first computed target or the
 * full frame).
 */
export function computeFrameWindow(opts: {
  trail: CursorSample[] | null;
  /** Jitter-filtered trail for the zoom in/out decision; defaults to trail. */
  activity?: CursorSample[] | null;
  /** Full draft frame: `{0, 0, videoW, videoH}`. */
  base: CropRect;
  /** Output shape (w/h); null = source shape. */
  aspect: number | null;
  /** Magnification while zoom is active; <=1 disables zoom. */
  zoomFactor: number;
  tMs: number;
  smoothState: CropRect;
  /** Fraction of the gap closed this frame; 1 snaps (used to seed state). */
  smoothing?: number;
}): CropRect {
  const { trail, activity, base, aspect, zoomFactor, tMs, smoothState } = opts;
  const vp = aspect
    ? coverWindow(base.sw, base.sh, aspect)
    : { w: base.sw, h: base.sh };
  const zooming =
    !!trail && zoomFactor > 1 && isZoomActive(activity ?? trail, tMs);
  const z = zooming ? zoomFactor : 1;
  const sw = Math.max(1, vp.w / z);
  const sh = Math.max(1, vp.h / z);
  const center = { x: base.sx + base.sw / 2, y: base.sy + base.sh / 2 };
  const focus = trail ? sampleCursor(trail, tMs, center) : center;
  const target: CropRect = {
    sx: clamp(focus.x - sw / 2, base.sx, base.sx + base.sw - sw),
    sy: clamp(focus.y - sh / 2, base.sy, base.sy + base.sh - sh),
    sw,
    sh,
  };
  return smoothCrop(smoothState, target, opts.smoothing ?? ZOOM_SMOOTHING);
}

/**
 * Shift a global-physical cursor trail into draft-local space so the draft
 * video (which already contains only the recorded region) can be zoomed with
 * a base crop of `{0,0,videoW,videoH}`. `scale` is the meta's `contentScale`
 * (physical px → frame content px, 1 for normal captures). Pure; cheap to
 * call once on load.
 */
export function localizeTrail(
  trail: CursorSample[],
  cropOrigin: { sx: number; sy: number },
  scale = 1,
): CursorSample[] {
  return trail.map((s) => ({ ...s, x: s.x * scale - cropOrigin.sx, y: s.y * scale - cropOrigin.sy }));
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
  const { src, start, end, targetHeight, aspect, mimeType, fps, onProgress, meta, zoom } = opts;
  if (!(end > start)) throw new Error("empty trim range");

  const video = document.createElement("video");
  video.src = src;
  video.playsInline = true;
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("video load failed"));
  });

  const { width, height } = exportDimensions(
    video.videoWidth,
    video.videoHeight,
    targetHeight,
    aspect ?? null,
  );
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

  // Post-capture viewport replay setup. The draft video is already the
  // cropped region, so we replay the trail in draft-local space: shift the
  // global physical cursor coords by the recorded crop origin, and use a
  // base crop that spans the whole draft frame. A cursor trail powers zoom
  // AND the aspect cover-viewport panning; a fixed aspect without a trail
  // still cover-crops (centered).
  const baseCrop: CropRect = { sx: 0, sy: 0, sw: video.videoWidth, sh: video.videoHeight };
  const wantZoom = !!zoom?.enabled && (zoom?.factor ?? 1) > 1 && !!meta?.cursor?.length && !!meta.crop;
  const hasTrail = !!meta?.cursor?.length && !!meta.crop;
  const localTrail = hasTrail && meta ? localizeTrail(meta.cursor, meta.crop, meta.contentScale ?? 1) : null;
  // Jitter-filtered activity drives zoom in/out; raw trail drives focus.
  const activityTrail = localTrail ? filterSignificantActivity(localTrail) : null;
  const zoomFactor = wantZoom ? (zoom?.factor ?? 1) : 1;
  const outAspect = aspect ?? null;
  // Seed the smoothing state with the frame-0 target (smoothCrop t=1) so the
  // first frames aren't a distorted lerp from the full-frame shape into the
  // aspect viewport.
  let smoothState: CropRect = computeFrameWindow({
    trail: localTrail,
    activity: activityTrail,
    base: baseCrop,
    aspect: outAspect,
    zoomFactor: 1, // start un-zoomed; the loop zooms in smoothly if active
    tMs: start * 1000,
    smoothState: { ...baseCrop },
    smoothing: 1, // snap: seed with the frame-0 viewport, no lerp-in
  });
  // The trail's `t` is anchored at `recorder.start()`, which is also where the
  // draft video's currentTime=0 lands — so `video.currentTime * 1000` maps
  // directly onto the trail even after trimming (seek doesn't shift the
  // trail, it just repositions playback within the same timeline).

  await seekTo(video, start);
  recorder.start(500);
  await video.play();

  await new Promise<void>((resolve) => {
    video.addEventListener("ended", () => resolve(), { once: true });
    const tick = () => {
      if (video.readyState >= 2) {
        smoothState = computeFrameWindow({
          trail: localTrail,
          activity: activityTrail,
          base: baseCrop,
          aspect: outAspect,
          zoomFactor,
          tMs: video.currentTime * 1000,
          smoothState,
        });
        // The window matches the output aspect by construction, so it
        // always fills the whole canvas — no bars.
        ctx.drawImage(
          video,
          smoothState.sx, smoothState.sy, smoothState.sw, smoothState.sh,
          0, 0, width, height,
        );
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
