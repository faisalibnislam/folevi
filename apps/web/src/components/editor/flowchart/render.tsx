// Drawing a flowchart: node shapes, connectors and the static (read-only) chart. No hooks and no browser
// APIs, so share pages can render it on the server. Colours come from CSS variables (flowchart.css), so a
// chart follows light/dark and the note's theme palette; the geometry is shared with exports.
import { memo } from "react";
import {
  FLOWCHART_FONT_SIZE,
  FLOWCHART_LABEL_FONT_SIZE,
  FLOWCHART_LINE_HEIGHT,
  LIMITS,
  FLOWCHART_DEFAULT_HEIGHT,
  FLOWCHART_SHAPE_LABEL,
  flowchartBounds,
  nodeTextLayout,
  parseFlowchart,
  routeEdges,
  shapePath,
  type FlowNode,
  type RoutedEdge,
} from "@folevi/editor-schema";

export function clampFlowHeight(h: unknown): number {
  const n = Number(h);
  return Math.round(Math.max(LIMITS.minFlowchartHeight, Math.min(LIMITS.maxFlowchartHeight, Number.isFinite(n) && n > 0 ? n : FLOWCHART_DEFAULT_HEIGHT)));
}

/** What a screen reader hears for a node. */
export function nodeAriaLabel(n: FlowNode): string {
  return `${FLOWCHART_SHAPE_LABEL[n.shape]}: ${n.text.trim() || "empty"}`;
}

/** A node: its outline and its wrapped label. */
export const FlowNodeShape = memo(function FlowNodeShape({ node, hideText = false }: { node: FlowNode; hideText?: boolean }) {
  const t = nodeTextLayout(node);
  return (
    <>
      {node.shape === "text" ? (
        <path className="fc-shape fc-shape-bare" d={shapePath(node)} />
      ) : (
        <path className="fc-shape" d={shapePath(node)} />
      )}
      {node.shape === "note" ? <path className="fc-note-fold" d={`M${node.x + node.w - 14} ${node.y + node.h}L${node.x + node.w} ${node.y + node.h - 14}`} /> : null}
      {!hideText && t.lines.length ? (
        <text className="fc-label" textAnchor="middle" fontSize={FLOWCHART_FONT_SIZE}>
          {t.lines.map((line, i) => (
            <tspan key={i} x={t.x} y={Math.round((t.y + i * FLOWCHART_LINE_HEIGHT) * 10) / 10}>
              {line}
            </tspan>
          ))}
        </text>
      ) : null}
    </>
  );
});

/** A connector's line and arrowheads (the label is drawn in a layer above the nodes). */
export const FlowEdgeLine = memo(function FlowEdgeLine({ routed }: { routed: RoutedEdge }) {
  return (
    <>
      <path className="fc-edge-line" d={routed.d} strokeDasharray={routed.edge.style === "dashed" ? "6 5" : undefined} />
      {routed.heads.map((h, i) => (
        <path key={i} className="fc-edge-head" d={h} />
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
        {routed.edge.label}
      </text>
    </>
  );
});

/** The whole chart as a static picture that fits its content (share pages, read-only notes). */
export function FlowchartStatic({ data, height }: { data: string; height: number }) {
  const fc = parseFlowchart(data);
  const routed = routeEdges(fc);
  const b = flowchartBounds(fc, routed);
  if (!b) {
    return (
      <div className="fc-static fc-static-empty" role="img" aria-label="Empty flowchart">
        Empty flowchart
      </div>
    );
  }
  const pad = 24;
  const vb = { x: Math.floor(b.x - pad), y: Math.floor(b.y - pad), w: Math.ceil(b.w + pad * 2), h: Math.ceil(b.h + pad * 2) };
  const summary = `Flowchart with ${fc.nodes.length} shape${fc.nodes.length === 1 ? "" : "s"}: ${fc.nodes
    .slice(0, 12)
    .map((n) => n.text.trim())
    .filter(Boolean)
    .join(", ")}${fc.nodes.length > 12 ? "…" : ""}`;
  return (
    <div className="fc-static">
      <svg
        className="fc-root"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        style={{ width: vb.w, maxWidth: "100%", maxHeight: clampFlowHeight(height) }}
        role="img"
        aria-label={summary}
      >
        {routed.map((r) => (
          <g key={r.edge.id} className="fc-edge">
            <FlowEdgeLine routed={r} />
          </g>
        ))}
        {fc.nodes.map((n) => (
          <g key={n.id} className="fc-node" data-shape={n.shape} data-color={n.color}>
            <FlowNodeShape node={n} />
          </g>
        ))}
        {routed.map((r) => (r.label ? <FlowEdgeLabel key={r.edge.id} routed={r} /> : null))}
      </svg>
    </div>
  );
}
