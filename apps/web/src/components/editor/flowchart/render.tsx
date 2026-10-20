// Drawing a flowchart: node shapes, connectors and the static (read-only) chart. No hooks and no browser
// APIs, so share pages can render it on the server. Colours come from CSS variables (flowchart.css), so a
// chart follows light/dark and the note's theme palette; the geometry is shared with exports.
import { memo } from "react";
import {
  FLOWCHART_LABEL_FONT_SIZE,
  LIMITS,
  FLOWCHART_DEFAULT_HEIGHT,
  FLOWCHART_SHAPE_LABEL,
  type FlowNode,
  type RoutedEdge,
} from "./schema";

export function clampFlowHeight(h: unknown): number {
  const n = Number(h);
  return Math.round(Math.max(LIMITS.minFlowchartHeight, Math.min(LIMITS.maxFlowchartHeight, Number.isFinite(n) && n > 0 ? n : FLOWCHART_DEFAULT_HEIGHT)));
}

/** What a screen reader hears for a node. */
export function nodeAriaLabel(n: FlowNode): string {
  const extra = [n.note ? "with a note" : "", n.link ? `links to ${n.link.title?.trim() || "a page"}` : ""].filter(Boolean);
  return `${FLOWCHART_SHAPE_LABEL[n.shape]}: ${n.text.trim() || "empty"}${extra.length ? `, ${extra.join(", ")}` : ""}`;
}

// A node (outline, image, icon, formatted label, badges): nodeShape.tsx.
export { FlowNodeShape } from "./nodeShape";

/** A connector's line and arrowheads (the label is drawn in a layer above the nodes). */
export const FlowEdgeLine = memo(function FlowEdgeLine({ routed }: { routed: RoutedEdge }) {
  return (
    <>
      <path className="fc-edge-line" d={routed.d} strokeDasharray={routed.edge.style === "dashed" ? "6 5" : routed.edge.style === "dotted" ? "0.1 4.9" : undefined} />
      {routed.markers.map((m, i) => (
        // Open arrows and bars are lines, not filled shapes.
        <path key={i} className="fc-edge-head" d={m.d} style={m.filled ? undefined : { fill: "none", strokeWidth: 1.5, strokeLinecap: "round" }} />
      ))}
    </>
  );
});

export const FlowEdgeLabel = memo(function FlowEdgeLabel({ routed, hidden = false }: { routed: RoutedEdge; hidden?: boolean }) {
  const l = routed.label;
  if (!l || hidden) return null;
  return (
    <>
      <rect className="fc-edge-label-bg" x={l.x} y={l.y} width={l.w} height={l.h} rx={6} />
      <text className="fc-edge-label" x={l.cx} y={l.cy + FLOWCHART_LABEL_FONT_SIZE * 0.35} textAnchor="middle" fontSize={FLOWCHART_LABEL_FONT_SIZE}>
        {l.text}
      </text>
    </>
  );
});

// The whole chart read-only (share pages, read-only notes, presenting): FlowchartStatic.tsx, the exports' picture.
export { FlowchartStatic } from "./FlowchartStatic";
