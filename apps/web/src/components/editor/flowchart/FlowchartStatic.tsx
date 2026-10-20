"use client";

// The flowchart read-only (share pages, read-only notes, version history, presenting, Foli AI's previews):
// the very picture the exports draw (flowchartDataToSvg: frames, swimlanes, every shape with its rich text,
// icon, image and badges, connectors with their ends, dashes, hops and labels), in its light and its dark
// palette, the page's theme showing one (flowchart.css). Fitted to its space, with zoom (the buttons,
// ⌘/ctrl-scroll or a pinch) and pan (drag) once zoomed, like the mind map's. Renders on the server too.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { LIMITS, FLOWCHART_DEFAULT_HEIGHT, flowchartDataToSvg, parseFlowchart, type FlowchartData } from "./schema";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const PAD = 24;

function clampHeight(h: unknown): number {
  const n = Number(h);
  return Math.round(Math.max(LIMITS.minFlowchartHeight, Math.min(LIMITS.maxFlowchartHeight, Number.isFinite(n) && n > 0 ? n : FLOWCHART_DEFAULT_HEIGHT)));
}

/** What a screen reader hears for the whole chart. */
export function flowchartSummary(fc: FlowchartData): string {
  const names = fc.nodes
    .slice(0, 12)
    .map((n) => n.text.trim())
    .filter(Boolean)
    .join(", ");
  return `Flowchart with ${fc.nodes.length} shape${fc.nodes.length === 1 ? "" : "s"}: ${names}${fc.nodes.length > 12 ? "…" : ""}`;
}

/** The drawing inside an exported SVG (without its outer <svg>), and the view box it was made for. */
export function svgParts(svg: string): { inner: string; box: { x: number; y: number; w: number; h: number } } | null {
  const open = /<svg\b[^>]*>/.exec(svg);
  const vb = open ? /viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/.exec(open[0]) : null;
  if (!open || !vb) return null;
  const end = svg.lastIndexOf("</svg>");
  return { inner: svg.slice(open.index + open[0].length, end < 0 ? undefined : end), box: { x: Number(vb[1]), y: Number(vb[2]), w: Number(vb[3]), h: Number(vb[4]) } };
}

/**
 * The chart as a static picture. `fileUrls` gives the addresses of its shapes' images (file id to URL);
 * images without one show as soft placeholders, as in exports.
 */
export function FlowchartStatic({ data, height, fileUrls }: { data: string; height?: number; fileUrls?: Readonly<Record<string, string>> }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const fc = useMemo(() => parseFlowchart(data), [data]);
  const pictures = useMemo(() => {
    if (!fc.nodes.length && !fc.frames.length && !fc.pools.length) return null;
    const imageUrl = (fileId: string) => fileUrls?.[fileId] ?? null;
    const light = svgParts(flowchartDataToSvg(fc, { theme: "light", background: false, padding: PAD, imageUrl, idPrefix: `${id}l` }));
    const dark = svgParts(flowchartDataToSvg(fc, { theme: "dark", background: false, padding: PAD, imageUrl, idPrefix: `${id}d` }));
    return light && dark ? { light: light.inner, dark: dark.inner, box: light.box } : null;
  }, [fc, fileUrls, id]);
  if (!pictures) {
    return (
      <div className="fc-static fc-static-empty" role="img" aria-label="Empty flowchart">
        Empty flowchart
      </div>
    );
  }
  return <FlowchartViewer key={`${pictures.box.x} ${pictures.box.y} ${pictures.box.w} ${pictures.box.h}`} pictures={pictures} height={clampHeight(height)} summary={flowchartSummary(fc)} />;
}

function FlowchartViewer({ pictures, height, summary }: { pictures: { light: string; dark: string; box: { x: number; y: number; w: number; h: number } }; height: number; summary: string }) {
  const box = pictures.box;
  const home = { cx: box.x + box.w / 2, cy: box.y + box.h / 2, k: 1 };
  // The view is a window onto the chart: its centre and zoom (1 = fitted).
  const [view, setView] = useState(home);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; cx: number; cy: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; k: number } | null>(null);
  const vw = box.w / view.k;
  const vh = box.h / view.k;
  const zoomTo = (k: number) => setView((v) => ({ ...v, k: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k)) }));
  // ⌘/ctrl-scroll (and a trackpad pinch) zooms; plain scrolling scrolls the page. Not passive, to keep the page still.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setView((v) => ({ ...v, k: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * Math.exp(-e.deltaY * 0.0022))) }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const unitsPerPx = () => {
    const r = svgRef.current?.getBoundingClientRect();
    return r && r.width ? Math.max(vw / r.width, vh / r.height) : 1;
  };
  const atHome = view.k === 1 && view.cx === home.cx && view.cy === home.cy;
  return (
    <div className="fc-static" style={{ maxHeight: height }}>
      <svg
        ref={svgRef}
        className="fc-static-svg"
        viewBox={`${view.cx - vw / 2} ${view.cy - vh / 2} ${vw} ${vh}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: box.w, maxHeight: height, aspectRatio: `${box.w} / ${box.h}` }}
        role="img"
        aria-label={summary}
        data-zoomed={view.k !== 1 || undefined}
        onPointerDown={(e) => {
          if ((e.target as Element).closest?.("a")) return;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            const [p, q] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
            pinch.current = { dist: Math.max(10, Math.hypot(p.x - q.x, p.y - q.y)), k: view.k };
            drag.current = null;
            return;
          }
          if (view.k === 1 && e.pointerType !== "mouse") return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy };
        }}
        onPointerMove={(e) => {
          if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pinch.current && pointers.current.size >= 2) {
            const [p, q] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
            zoomTo(pinch.current.k * (Math.hypot(p.x - q.x, p.y - q.y) / pinch.current.dist));
            return;
          }
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const u = unitsPerPx();
          setView((v) => ({ ...v, cx: d.cx - (e.clientX - d.x) * u, cy: d.cy - (e.clientY - d.y) * u }));
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
        {/* Exported markup: every text in it is escaped and its links are the chart's sanitised ones. */}
        <g className="fc-static-light" dangerouslySetInnerHTML={{ __html: pictures.light }} />
        <g className="fc-static-dark" dangerouslySetInnerHTML={{ __html: pictures.dark }} />
      </svg>
      <div className="fc-static-zoom" role="toolbar" aria-label="Zoom">
        <button type="button" className="fb-vc-btn" aria-label="Zoom out" onClick={() => zoomTo(view.k / 1.25)}>
          <Minus size={14} aria-hidden />
        </button>
        <button type="button" className="fb-vc-btn" aria-label="Zoom in" onClick={() => zoomTo(view.k * 1.25)}>
          <Plus size={14} aria-hidden />
        </button>
        <button type="button" className="fb-vc-btn" aria-label="Fit the whole flowchart" disabled={atHome} onClick={() => setView(home)}>
          <Maximize size={13} aria-hidden />
        </button>
      </div>
    </div>
  );
}
