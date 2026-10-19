"use client";

// The read-only chart's picture with zoom and pan (share pages, read-only notes): the buttons, ⌘ or ctrl
// and the wheel, or a pinch to zoom; a drag (or a finger, once zoomed in) to pan. At its usual size it
// fits the page's width.
import { useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { ChartSvg } from "./ChartSvg";
import type { Scene } from "./scene";

const MIN_K = 1;
const MAX_K = 4;
const clamp = (n: number) => Math.min(MAX_K, Math.max(MIN_K, n));

export function ZoomPlot({ scene }: { scene: Scene }) {
  const [k, setK] = useState(1);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; k: number } | null>(null);

  /** Zooms to `next`, keeping the point under (cx, cy) (or the middle) where it is. */
  const zoomTo = (next: number, cx?: number, cy?: number) => {
    const el = box.current;
    const to = clamp(next);
    if (!el || to === k) return;
    const r = el.getBoundingClientRect();
    const px = (cx ?? r.left + r.width / 2) - r.left;
    const py = (cy ?? r.top + r.height / 2) - r.top;
    const fx = (el.scrollLeft + px) / Math.max(1, el.scrollWidth);
    const fy = (el.scrollTop + py) / Math.max(1, el.scrollHeight);
    setK(to);
    requestAnimationFrame(() => {
      el.scrollLeft = fx * el.scrollWidth - px;
      el.scrollTop = fy * el.scrollHeight - py;
    });
  };

  return (
    <div className="fb-chart-zoom">
      <div
        ref={box}
        className="fb-chart-static-plot"
        data-zoomed={k > 1 || undefined}
        onWheel={(e) => {
          if (!(e.metaKey || e.ctrlKey)) return;
          e.preventDefault();
          zoomTo(k * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
        }}
        onPointerDown={(e) => {
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            const [p, q] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
            pinch.current = { dist: Math.max(10, Math.hypot(p.x - q.x, p.y - q.y)), k };
            drag.current = null;
            return;
          }
          if (k === 1) return;
          const el = box.current!;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
        }}
        onPointerMove={(e) => {
          if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pinch.current && pointers.current.size >= 2) {
            const [p, q] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
            zoomTo(pinch.current.k * (Math.hypot(p.x - q.x, p.y - q.y) / pinch.current.dist), (p.x + q.x) / 2, (p.y + q.y) / 2);
            return;
          }
          const d = drag.current;
          const el = box.current;
          if (!d || d.id !== e.pointerId || !el) return;
          el.scrollLeft = d.left - (e.clientX - d.x);
          el.scrollTop = d.top - (e.clientY - d.y);
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          if (drag.current?.id === e.pointerId) drag.current = null;
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          pinch.current = null;
          drag.current = null;
        }}
      >
        <div style={{ width: `${k * 100}%` }}>
          <ChartSvg scene={scene} fit zoomed={k > 1} />
        </div>
      </div>
      <div className="fb-chart-zoom-bar" role="toolbar" aria-label="Zoom">
        <button type="button" className="fb-vc-btn" aria-label="Zoom out" disabled={k <= MIN_K} onClick={() => zoomTo(k / 1.25)}>
          <Minus size={14} aria-hidden />
        </button>
        <button type="button" className="fb-vc-btn" aria-label="Zoom in" disabled={k >= MAX_K} onClick={() => zoomTo(k * 1.25)}>
          <Plus size={14} aria-hidden />
        </button>
        <button type="button" className="fb-vc-btn" aria-label="Fit the chart" disabled={k === 1} onClick={() => setK(1)}>
          <Maximize size={13} aria-hidden />
        </button>
      </div>
    </div>
  );
}
