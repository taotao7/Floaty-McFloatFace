import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { EVT } from "../lib/events";
import { gsap } from "gsap";
import { getAppSettings } from "../lib/tauri";
import { physicalToCss } from "../lib/coords";
import type { AppSettings, CursorEffectStyle } from "../types/app";

interface Ripple {
  id: number;
  x: number;
  y: number;
  button: string;
}

interface TrailPoint {
  x: number;
  y: number;
  ts: number;
}

const TRAIL_MAX = 18;
const TRAIL_LIFETIME_MS = 320;

/**
 * Click-through cursor effects overlay. Rendered on a transparent fullscreen
 * window anchored at the screen origin. The window is set click-through by the
 * Rust `set_cursor_overlay` command, so it never intercepts input — all cursor
 * data arrives via `app://mouse-*` events from the shared event tap.
 *
 * Coordinates from Rust are in physical screen pixels; the overlay window spans
 * the primary monitor, so we divide by devicePixelRatio to get CSS pixels.
 */
export default function CursorOverlayWindow() {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [style, setStyle] = useState<CursorEffectStyle>("ripple");
  const [trailOn, setTrailOn] = useState(true);
  const trailRef = useRef<TrailPoint[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const nextId = useRef(0);

  useEffect(() => {
    void getAppSettings().then((s: AppSettings) => {
      setStyle(s.cursorEffectStyle ?? "ripple");
      setTrailOn(s.cursorTrailEnabled ?? true);
    });
    const unlistenP = listen<AppSettings>(EVT.SETTINGS_UPDATED, (e) => {
      setStyle(e.payload.cursorEffectStyle ?? "ripple");
      setTrailOn(e.payload.cursorTrailEnabled ?? true);
    });
    return () => { void unlistenP.then((fn) => fn()); };
  }, []);

  // Mouse click ripples.
  useEffect(() => {
    if (style === "none") return;
    const unlisten = createMouseDownListener((payload) => {
      const id = nextId.current++;
      const dpr = window.devicePixelRatio || 1;
      const css = physicalToCss({ x: payload.x, y: payload.y }, dpr);
      const r: Ripple = {
        id,
        x: css.x,
        y: css.y,
        button: payload.button,
      };
      setRipples((prev) => [...prev, r]);
      // Remove after the animation completes.
      window.setTimeout(() => {
        setRipples((prev) => prev.filter((x) => x.id !== id));
      }, 900);
    });
    return () => { unlisten(); };
  }, [style]);

  // Mouse move trail (canvas-rendered for smoothness).
  useEffect(() => {
    if (!trailOn) {
      trailRef.current = [];
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const unlisten = createMouseMoveListener((payload) => {
      const css = physicalToCss({ x: payload.x, y: payload.y }, dpr);
      trailRef.current.push({ x: css.x, y: css.y, ts: performance.now() });
      if (trailRef.current.length > TRAIL_MAX) {
        trailRef.current.splice(0, trailRef.current.length - TRAIL_MAX);
      }
    });
    const loop = () => {
      drawTrail(canvasRef.current, trailRef.current, style);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      unlisten();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [trailOn, style]);

  return (
    <div className="cursor-overlay">
      <canvas ref={canvasRef} className="cursor-trail-canvas" />
      {ripples.map((r) => (
        <CursorRipple key={r.id} x={r.x} y={r.y} button={r.button} style={style} />
      ))}
    </div>
  );
}

function CursorRipple({ x, y, style, button }: { x: number; y: number; button: string; style: CursorEffectStyle }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    if (style === "ring") {
      gsap.fromTo(
        el,
        { scale: 0.2, opacity: 0.9, borderWidth: 6 },
        { scale: 2.4, opacity: 0, borderWidth: 1, duration: 0.7, ease: "power2.out" },
      );
    } else if (style === "spark") {
      gsap.fromTo(
        el,
        { scale: 0.1, opacity: 1 },
        { scale: 1.6, opacity: 0, duration: 0.5, ease: "power3.out" },
      );
    } else {
      // ripple
      gsap.fromTo(
        el,
        { scale: 0.2, opacity: 0.8 },
        { scale: 3, opacity: 0, duration: 0.8, ease: "power2.out" },
      );
    }
  }, [style]);
  const color = button === "right" ? "var(--cursor-right, #ff5d5d)" : "var(--cursor-left, #4f9bff)";
  return (
    <div
      ref={ref}
      className={`cursor-effect cursor-${style}`}
      style={{ left: x, top: y, borderColor: color, background: style === "spark" ? color : "transparent" }}
    />
  );
}

function drawTrail(canvas: HTMLCanvasElement | null, points: TrailPoint[], style: CursorEffectStyle) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  // Size the canvas to the window if needed.
  if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const now = performance.now();
  const live = points.filter((p) => now - p.ts < TRAIL_LIFETIME_MS);
  if (live.length < 2) return;

  for (let i = 1; i < live.length; i++) {
    const a = live[i - 1];
    const b = live[i];
    const age = (now - b.ts) / TRAIL_LIFETIME_MS;
    const alpha = Math.max(0, 1 - age);
    ctx.strokeStyle = `rgba(79,155,255,${alpha * 0.7})`;
    ctx.lineWidth = (1 - age) * (style === "spark" ? 5 : 3.5);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

// --- event listener helpers ---

function createMouseDownListener(cb: (p: { x: number; y: number; button: string }) => void) {
  const p = listen<{ x: number; y: number; button: string }>(EVT.MOUSE_DOWN, (e) => cb(e.payload));
  return () => { void p.then((fn) => fn()); };
}

function createMouseMoveListener(cb: (p: { x: number; y: number; button: string }) => void) {
  const p = listen<{ x: number; y: number; button: string }>(EVT.MOUSE_MOVE, (e) => cb(e.payload));
  return () => { void p.then((fn) => fn()); };
}
