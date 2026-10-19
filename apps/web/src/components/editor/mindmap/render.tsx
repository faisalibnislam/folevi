"use client";

// Drawing a mind map: ideas, the branches between them, collapse badges, and the read-only map (share
// pages, read-only notes, version history, Foli AI's previews) with zoom and pan. The layout comes from
// the shared schema (layoutMindmap), so the editor, this and the exports (./svg.ts) agree; colours are CSS
// variables (mindmap.css), so a map follows light and dark and the note's accent.
import { memo, useEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { badgeOf, linkWidth, mindRadius, rootSide } from "./geometry";
import { layoutMindmap, mindOuterPoint, mindTextLayout, mindmapOutline, parseMindmap, type MindBox, type MindLayoutResult, type MindLink } from "@folevi/editor-schema";

/** What a screen reader hears for an idea. */
export function ideaLabel(b: Pick<MindBox, "lines" | "depth" | "hidden" | "hasChildren" | "empty" | "children">): string {
  const text = b.empty ? "Empty idea" : b.lines.join(" ");
  const level = b.depth === 0 ? "central idea" : `level ${b.depth}`;
  const inside = b.hidden ? `, collapsed, ${b.hidden} idea${b.hidden === 1 ? "" : "s"} inside` : b.children.length ? `, ${b.children.length} idea${b.children.length === 1 ? "" : "s"}` : "";
  return `${text}, ${level}${inside}`;
}

/** One idea: its box and its wrapped text. */
export const MindIdea = memo(function MindIdea({ box, hideText = false }: { box: MindBox; hideText?: boolean }) {
  const t = mindTextLayout(box);
  return (
    <>
      <rect className="mm-shape" x={box.x} y={box.y} width={box.w} height={box.h} rx={mindRadius(box.depth)} />
      {hideText ? null : (
        <text className="mm-label" textAnchor="middle" fontSize={box.font} fontWeight={box.weight}>
          {box.lines.map((line, i) => (
            <tspan key={i} x={t.x} y={Math.round((t.y + i * t.dy) * 10) / 10}>
              {line}
            </tspan>
          ))}
        </text>
      )}
    </>
  );
});

/** A branch between two ideas. */
export const MindLinkPath = memo(function MindLinkPath({ link }: { link: MindLink }) {
  return <path className="mm-link" data-color={link.color} d={link.d} strokeWidth={linkWidth(link.depth)} />;
});

/** A collapsed idea's count of what's inside, beside it where its branch would grow. */
export function MindBadge({ box, side, interactive = false }: { box: MindBox; side: "left" | "right"; interactive?: boolean }) {
  if (!box.hidden) return null;
  const { label, w } = badgeOf(box.hidden);
  const p = mindOuterPoint(box, 6 + (box.side === "down" ? 10 : w / 2), side);
  return (
    <g className="mm-badge" data-color={box.color} data-mm-toggle={interactive ? box.id : undefined} aria-hidden>
      {interactive ? <circle className="mm-hit" cx={p.x} cy={p.y} r={22} /> : null}
      <rect x={p.x - w / 2} y={p.y - 10} width={w} height={20} rx={6} />
      <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={11.5}>
        {label}
      </text>
    </g>
  );
}

/** The whole map drawn into an SVG group (links under ideas). */
export function MindmapDrawing({ layout }: { layout: MindLayoutResult }) {
  const side = rootSide(layout);
  return (
    <>
      <g>
        {layout.links.map((l) => (
          <MindLinkPath key={l.to} link={l} />
        ))}
      </g>
      <g>
        {layout.boxes.map((b) => (
          <g key={b.id} className="mm-node" data-color={b.color} data-depth={Math.min(b.depth, 2)} data-empty={b.empty || undefined}>
            <MindIdea box={b} />
          </g>
        ))}
      </g>
      <g>
        {layout.boxes.map((b) => (b.hidden ? <MindBadge key={b.id} box={b} side={side} /> : null))}
      </g>
    </>
  );
}

const PAD = 28;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

/**
 * The map read-only (share pages, read-only notes, version history, previews): fitted to its space, with
 * zoom (the buttons, ⌘/ctrl-scroll or a pinch) and pan (drag) once zoomed. Renders on the server too.
 */
export function MindmapStatic({ data, height }: { data: string; height?: number }) {
  const map = parseMindmap(data);
  const layout = layoutMindmap(map);
  const b = layout.bounds;
  if (!b) return <p className="fb-vc-static-empty">Empty mind map</p>;
  const outline = mindmapOutline(map);
  const summary = `Mind map: ${outline
    .slice(0, 16)
    .map(({ node }) => node.text.trim())
    .filter(Boolean)
    .join(", ")}${outline.length > 16 ? "…" : ""}`;
  return <MindmapViewer layout={layout} height={height} summary={summary} outline={outline.map(({ node, depth }) => ({ id: node.id, text: node.text.trim() || "Idea", depth }))} />;
}

function MindmapViewer({ layout, height, summary, outline }: { layout: MindLayoutResult; height?: number; summary: string; outline: { id: string; text: string; depth: number }[] }) {
  const b = layout.bounds!;
  const box = { x: b.x - PAD, y: b.y - PAD, w: b.w + PAD * 2, h: b.h + PAD * 2 };
  // The view is a window onto the map: its centre and zoom (1 = fitted).
  const [view, setView] = useState({ cx: box.x + box.w / 2, cy: box.y + box.h / 2, k: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; cx: number; cy: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; k: number } | null>(null);
  const vw = box.w / view.k;
  const vh = box.h / view.k;
  const maxH = Math.max(160, Math.min(height && height > 0 ? height : 560, 900));
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
  return (
    <div className="mm-static" style={{ maxHeight: maxH }}>
      <svg
        ref={svgRef}
        className="mm-root mm-static-svg"
        viewBox={`${view.cx - vw / 2} ${view.cy - vh / 2} ${vw} ${vh}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ height: Math.min(maxH, box.h + 8), aspectRatio: `${box.w} / ${box.h}` }}
        role="img"
        aria-label={summary}
        data-zoomed={view.k !== 1 || undefined}
        onPointerDown={(e) => {
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
        <MindmapDrawing layout={layout} />
      </svg>
      <div className="mm-static-zoom" role="toolbar" aria-label="Zoom">
        <button type="button" className="fb-vc-btn" aria-label="Zoom out" onClick={() => zoomTo(view.k / 1.25)}>
          <Minus size={14} aria-hidden />
        </button>
        <button type="button" className="fb-vc-btn" aria-label="Zoom in" onClick={() => zoomTo(view.k * 1.25)}>
          <Plus size={14} aria-hidden />
        </button>
        <button type="button" className="fb-vc-btn" aria-label="Fit the whole map" disabled={view.k === 1 && view.cx === box.x + box.w / 2 && view.cy === box.y + box.h / 2} onClick={() => setView({ cx: box.x + box.w / 2, cy: box.y + box.h / 2, k: 1 })}>
          <Maximize size={13} aria-hidden />
        </button>
      </div>
      {/* The same ideas as a list, for screen readers and for copying the text. */}
      <ul className="sr-only">
        {outline.map((o) => (
          <li key={o.id} style={{ marginLeft: `${o.depth}em` }}>
            {o.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
