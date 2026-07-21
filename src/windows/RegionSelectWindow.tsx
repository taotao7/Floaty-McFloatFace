import { useEffect, useRef, useState } from "react";
import { confirmRegion, cancelRegionSelect } from "../lib/tauri";
import { cssToPhysical } from "../lib/coords";
import type { RecordingRegion } from "../types/app";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_SIZE = 40;

/**
 * Full-screen region selector overlay. Drawn by clicking + dragging anywhere,
 * then refined with 8 resize handles and a draggable center. All coordinates
 * here are in CSS pixels; they are converted to physical pixels on confirm so
 * they share the coordinate space with the Rust mouse-event tap.
 */
export default function RegionSelectWindow() {
  const [rect, setRect] = useState<Rect | null>(null);
  // Drag state lives in refs (never rendered) so the rAF-throttled move
  // handler always reads the latest values.
  const drawingRef = useRef(false);
  const movingRef = useRef<null | "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw">(null);
  const dragStart = useRef<{ px: number; py: number; rect: Rect } | null>(null);
  const drawStart = useRef<{ x: number; y: number } | null>(null);
  // High-polling mice fire pointermove far faster than the display refresh;
  // applying every event re-renders the full-screen overlay hundreds of
  // times a second. Coalesce to one update per animation frame.
  const pendingPos = useRef<{ x: number; y: number } | null>(null);
  const moveRaf = useRef<number | null>(null);

  const screenW = window.innerWidth;
  const screenH = window.innerHeight;

  useEffect(() => {
    return () => {
      if (moveRaf.current !== null) cancelAnimationFrame(moveRaf.current);
    };
  }, []);

  // Escape cancels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        void cancelRegionSelect();
      } else if (e.key === "Enter" && rect && rect.width >= MIN_SIZE && rect.height >= MIN_SIZE) {
        void commit(rect);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rect]);

  const onPointerDown = (e: React.PointerEvent) => {
    // Start a fresh selection when clicking the empty canvas (not on an
    // existing rect or handle).
    if ((e.target as HTMLElement).dataset.role === "ui") return;
    if (e.button !== 0) return;
    const x = e.clientX;
    const y = e.clientY;
    drawStart.current = { x, y };
    drawingRef.current = true;
    setRect({ x, y, width: 0, height: 0 });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    pendingPos.current = { x: e.clientX, y: e.clientY };
    if (moveRaf.current !== null) return;
    moveRaf.current = requestAnimationFrame(() => {
      moveRaf.current = null;
      const p = pendingPos.current;
      if (p) applyMove(p.x, p.y);
    });
  };

  const applyMove = (clientX: number, clientY: number) => {
    if (drawingRef.current && drawStart.current) {
      const sx = drawStart.current.x;
      const sy = drawStart.current.y;
      const x = Math.min(sx, clientX);
      const y = Math.min(sy, clientY);
      const width = Math.abs(clientX - sx);
      const height = Math.abs(clientY - sy);
      setRect({ x, y, width, height });
      return;
    }
    const moving = movingRef.current;
    if (moving && dragStart.current) {
      const dx = clientX - dragStart.current.px;
      const dy = clientY - dragStart.current.py;
      const base = dragStart.current.rect;
      let next = { ...base };
      switch (moving) {
        case "move":
          next.x = clamp(base.x + dx, 0, screenW - base.width);
          next.y = clamp(base.y + dy, 0, screenH - base.height);
          break;
        case "e": next.width = Math.max(MIN_SIZE, base.width + dx); break;
        case "w": {
          const nx = clamp(base.x + dx, 0, base.x + base.width - MIN_SIZE);
          next.x = nx; next.width = base.width + (base.x - nx); break;
        }
        case "s": next.height = Math.max(MIN_SIZE, base.height + dy); break;
        case "n": {
          const ny = clamp(base.y + dy, 0, base.y + base.height - MIN_SIZE);
          next.y = ny; next.height = base.height + (base.y - ny); break;
        }
        case "ne": {
          const ny = clamp(base.y + dy, 0, base.y + base.height - MIN_SIZE);
          next.y = ny; next.height = base.height + (base.y - ny);
          next.width = Math.max(MIN_SIZE, base.width + dx); break;
        }
        case "nw": {
          const ny = clamp(base.y + dy, 0, base.y + base.height - MIN_SIZE);
          next.y = ny; next.height = base.height + (base.y - ny);
          const nx = clamp(base.x + dx, 0, base.x + base.width - MIN_SIZE);
          next.x = nx; next.width = base.width + (base.x - nx); break;
        }
        case "se":
          next.width = Math.max(MIN_SIZE, base.width + dx);
          next.height = Math.max(MIN_SIZE, base.height + dy);
          break;
        case "sw": {
          const nx = clamp(base.x + dx, 0, base.x + base.width - MIN_SIZE);
          next.x = nx; next.width = base.width + (base.x - nx);
          next.height = Math.max(MIN_SIZE, base.height + dy); break;
        }
      }
      setRect(next);
    }
  };

  const onPointerUp = () => {
    drawingRef.current = false;
    movingRef.current = null;
    dragStart.current = null;
    drawStart.current = null;
  };

  const startHandle = (which: NonNullable<typeof movingRef.current>) => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!rect) return;
    movingRef.current = which;
    dragStart.current = { px: e.clientX, py: e.clientY, rect };
  };

  const commit = (r: Rect) => {
    if (r.width < MIN_SIZE || r.height < MIN_SIZE) return;
    const dpr = window.devicePixelRatio || 1;
    const region: RecordingRegion = cssToPhysical(
      { x: r.x, y: r.y, width: r.width, height: r.height },
      dpr,
    );
    void confirmRegion(region);
  };

  const handleFull = () => {
    const dpr = window.devicePixelRatio || 1;
    const region: RecordingRegion = {
      x: 0,
      y: 0,
      width: Math.round(screenW * dpr),
      height: Math.round(screenH * dpr),
    };
    void confirmRegion(region);
  };

  return (
    <div
      className="region-select"
      style={{ width: screenW, height: screenH }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Dim outside the selection via the rect's box-shadow (cheap to
          composite; a full-screen SVG mask repaints on every move). */}
      {!rect && <div className="region-hint">Click and drag to select the recording area</div>}

      {rect && rect.width > 0 && rect.height > 0 && (
        <>
          <div
            className="region-rect"
            style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
            onPointerDown={startHandle("move")}
            data-role="ui"
          >
            <span className="region-size-label">
              {Math.round(rect.width)} × {Math.round(rect.height)}
            </span>
          </div>
          {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const).map((h) => (
            <div
              key={h}
              className={`region-handle region-handle-${h}`}
              style={handlePos(rect, h)}
              onPointerDown={startHandle(h)}
              data-role="ui"
            />
          ))}
        </>
      )}

      {rect && rect.width >= MIN_SIZE && rect.height >= MIN_SIZE && (
        <div className="region-toolbar" data-role="ui">
          <button type="button" className="region-btn primary" onClick={() => commit(rect)}>
            Confirm
          </button>
          <button type="button" className="region-btn" onClick={() => void cancelRegionSelect()}>
            Cancel
          </button>
          <button type="button" className="region-btn" onClick={handleFull}>
            Full Screen
          </button>
        </div>
      )}
    </div>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function handlePos(rect: Rect, h: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"): React.CSSProperties {
  const size = 14;
  const cx = rect.x + rect.width / 2 - size / 2;
  const cy = rect.y + rect.height / 2 - size / 2;
  const map: Record<typeof h, React.CSSProperties> = {
    n: { left: cx, top: rect.y - size / 2, cursor: "ns-resize" },
    s: { left: cx, top: rect.y + rect.height - size / 2, cursor: "ns-resize" },
    e: { left: rect.x + rect.width - size / 2, top: cy, cursor: "ew-resize" },
    w: { left: rect.x - size / 2, top: cy, cursor: "ew-resize" },
    ne: { left: rect.x + rect.width - size / 2, top: rect.y - size / 2, cursor: "nesw-resize" },
    nw: { left: rect.x - size / 2, top: rect.y - size / 2, cursor: "nwse-resize" },
    se: { left: rect.x + rect.width - size / 2, top: rect.y + rect.height - size / 2, cursor: "nwse-resize" },
    sw: { left: rect.x - size / 2, top: rect.y + rect.height - size / 2, cursor: "nesw-resize" },
  };
  return map[h];
}
