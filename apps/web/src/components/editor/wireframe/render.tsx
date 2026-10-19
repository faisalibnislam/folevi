"use client";

// The wireframe without editing: read-only notes, share pages, version history. Every screen drawn (in the
// wireframe's own look, Clean or Sketch) with the arrows between them, fitted to the space, with zoom and
// pan: the buttons, ⌘ or ctrl and the wheel (or a pinch) to zoom, a drag to pan. Screen readers get each
// screen's parts as a list.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { WIREFRAME_COMPONENT_LABEL, WIREFRAME_DEFAULT_HEIGHT, WIREFRAME_FRAME_LABEL, parseWireframe, wireframeScreenItems, type WireframeData } from "@folevi/editor-schema";
import { drawLink, drawScreen, linkPaths, wireframeBounds } from "./draw";

const MIN_K = 0.05;
const MAX_K = 4;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The drawing's markup: screens (each clipped by an id unique in the page) then the arrows. */
export function wireframeMarkup(wf: WireframeData, uid: string): string {
  return wf.screens.map((s, i) => drawScreen(wf, s, { name: true, clipId: `${uid}-c${i}` })).join("") + linkPaths(wf).map(drawLink).join("");
}

/** Each screen with its parts, for screen readers. */
function Outline({ wf }: { wf: WireframeData }) {
  const items = wireframeScreenItems(wf);
  return (
    <div className="sr-only">
      {wf.screens.map((s) => (
        <section key={s.id} aria-label={s.name || "Untitled screen"}>
          <h4>
            {s.name || "Untitled screen"} ({WIREFRAME_FRAME_LABEL[s.frame]})
          </h4>
          <ul>
            {(items.get(s.id) ?? []).map((it) => (
              <li key={it.id}>
                {WIREFRAME_COMPONENT_LABEL[it.kind]}
                {it.text.trim() ? `: ${it.text.trim().replace(/\s*\n\s*/g, ", ")}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * A pannable, zoomable picture of the wireframe. `fill` makes it fill its container (a card's body, with
 * `top` kept clear for the card's toolbar); otherwise it's as tall as the drawing needs, up to `height`.
 */
export function WireframeViewer({ wf, height, fill = false, top = 0 }: { wf: WireframeData; height?: number; fill?: boolean; top?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<{ x: number; y: number; k: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const bounds = useMemo(() => wireframeBounds(wf), [wf]);
  const markup = useMemo(() => wireframeMarkup(wf, uid), [wf, uid]);
  const drag = useRef<{ id: number; sx: number; sy: number; view: { x: number; y: number; k: number } } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; view: { x: number; y: number; k: number }; mid: { x: number; y: number } } | null>(null);

  const fit = useCallback(() => {
    if (!bounds || !size.w || !size.h) return;
    const pad = 24;
    const k = clamp(Math.min((size.w - pad * 2) / bounds.w, (size.h - top - pad * 2) / bounds.h, 1), MIN_K, MAX_K);
    setView({ k, x: size.w / 2 - (bounds.x + bounds.w / 2) * k, y: top + (size.h - top) / 2 - (bounds.y + bounds.h / 2) * k });
  }, [bounds, size.w, size.h, top]);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Fitted when it first has a size, and again when the drawing or the space changes.
  useEffect(() => fit(), [fit]);

  const zoomAt = (k: number, sx: number, sy: number) => {
    const v = viewRef.current;
    if (!v) return;
    const nk = clamp(k, MIN_K, MAX_K);
    setView({ k: nk, x: sx - ((sx - v.x) / v.k) * nk, y: sy - ((sy - v.y) / v.k) * nk });
  };

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = viewRef.current;
      if (v) zoomAt(v.k * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  if (!bounds) return <p className="fb-vc-static-empty">Empty wireframe</p>;
  // Sized to the drawing when it isn't filling a card.
  const natural = Math.min(height ?? WIREFRAME_DEFAULT_HEIGHT, Math.max(200, ((size.w || 640) * (bounds.h + 48)) / (bounds.w + 48)));
  const v = view ?? { x: 0, y: 0, k: 0.0001 };
  const titles = wf.screens.map((s) => s.name || "Untitled screen").join(", ");
  return (
    <div
      ref={wrap}
      className="wf-viewer wf-scope"
      data-fill={fill || undefined}
      style={fill ? undefined : { height: natural }}
      onPointerDown={(e) => {
        if ((e.target as Element).closest("button")) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        e.currentTarget.setPointerCapture(e.pointerId);
        if (pointers.current.size === 2 && viewRef.current) {
          const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
          const r = e.currentTarget.getBoundingClientRect();
          pinch.current = { dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), view: viewRef.current, mid: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top } };
          drag.current = null;
          return;
        }
        if (viewRef.current) drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, view: viewRef.current };
      }}
      onPointerMove={(e) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const p = pinch.current;
        if (p && pointers.current.size >= 2) {
          const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
          const r = e.currentTarget.getBoundingClientRect();
          const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
          const k = clamp(p.view.k * (Math.hypot(a.x - b.x, a.y - b.y) / p.dist), MIN_K, MAX_K);
          const wx = (p.mid.x - p.view.x) / p.view.k;
          const wy = (p.mid.y - p.view.y) / p.view.k;
          setView({ k, x: mid.x - wx * k, y: mid.y - wy * k });
          return;
        }
        const d = drag.current;
        if (d && d.id === e.pointerId) setView({ ...d.view, x: d.view.x + e.clientX - d.sx, y: d.view.y + e.clientY - d.sy });
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
      <svg className="wfd" data-style={wf.style} width="100%" height="100%" role="img" aria-label={`Wireframe: ${titles}`}>
        <g transform={`translate(${v.x} ${v.y}) scale(${v.k})`} dangerouslySetInnerHTML={{ __html: markup }} />
      </svg>
      <Outline wf={wf} />
      <div className="wf-bar wf-bar-zoom" role="toolbar" aria-label="Zoom">
        <button type="button" className="fb-vc-btn" aria-label="Zoom out" onClick={() => zoomAt(v.k / 1.25, size.w / 2, size.h / 2)}>
          <Minus size={15} aria-hidden />
        </button>
        <span className="wf-zoom" aria-live="polite">
          {Math.round(v.k * 100)}%
        </span>
        <button type="button" className="fb-vc-btn" aria-label="Zoom in" onClick={() => zoomAt(v.k * 1.25, size.w / 2, size.h / 2)}>
          <Plus size={15} aria-hidden />
        </button>
        <button type="button" className="fb-vc-btn" aria-label="Fit to screens" onClick={fit}>
          <Maximize size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function WireframeStatic({ data, height }: { data: string; height?: number }) {
  const wf = useMemo(() => parseWireframe(data), [data]);
  if (!wf.screens.length) return <p className="fb-vc-static-empty">Empty wireframe</p>;
  return <WireframeViewer wf={wf} height={height} />;
}
