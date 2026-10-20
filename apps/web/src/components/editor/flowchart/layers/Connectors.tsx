"use client";

// The editable canvas's connectors: lines (under the shapes) and labels (above them). Each connector is a
// memoised item keyed by its drawing (controller/useRouted.ts keeps unchanged drawings identical between
// frames), so moving one shape redraws only the connectors whose route changed. Hit-testing is the
// browser's own: a wide transparent stroke along each line, and each label's box, carry the data-fc-*
// attributes the interactions look for (data-fc-edge, data-fc-label).
import { memo, type CSSProperties } from "react";
import { FLOWCHART_LABEL_FONT_SIZE, type RoutedEdge } from "../schema";
import { edgeDash, edgeStroke } from "../connectors";
import type { Editing } from "../controller/types";

const lineVars = (r: RoutedEdge): CSSProperties => {
  const stroke = edgeStroke(r.edge.color);
  return { ...(stroke ? { "--fc-ec": stroke } : {}), "--fc-ew": `${r.edge.width}px` } as CSSProperties;
};

/** One connector's line and heads, with a wide invisible stroke to hit it. */
export const ConnectorLine = memo(function ConnectorLine({ routed, selected }: { routed: RoutedEdge; selected: boolean }) {
  const e = routed.edge;
  return (
    <g className="fc-edge" data-fc-edge={e.id} data-selected={selected || undefined} data-free={!e.from || !e.to || undefined} style={lineVars(routed)}>
      <path className="fc-edge-hit" d={routed.d} />
      {selected ? <path className="fc-edge-halo" d={routed.d} /> : null}
      <path className="fc-edge-line" d={routed.d} strokeDasharray={edgeDash(e.style, e.width)} />
      {routed.markers.map((m, i) => (
        // Open arrows and bars are lines, not filled shapes.
        <path key={i} className={m.filled ? "fc-edge-head" : "fc-edge-head fc-edge-head-open"} d={m.d} />
      ))}
    </g>
  );
});

/** One connector's labels; each is pressed to drag it along the line and double-clicked to write in it. */
export const ConnectorLabels = memo(function ConnectorLabels({ routed, selected, editingLabel }: { routed: RoutedEdge; selected: boolean; editingLabel: number | null }) {
  const e = routed.edge;
  return (
    <g className="fc-edge fc-edge-labels" data-selected={selected || undefined} style={lineVars(routed)}>
      {routed.labels.map((l) =>
        l.index === editingLabel || !l.text ? null : (
          <g key={l.index} className="fc-edge-label-item" data-fc-edge={e.id} data-fc-label={l.index}>
            <rect className="fc-edge-label-bg" x={l.x} y={l.y} width={l.w} height={l.h} rx={6} />
            <text className="fc-edge-label" x={l.cx} y={l.cy + FLOWCHART_LABEL_FONT_SIZE * 0.35} textAnchor="middle" fontSize={FLOWCHART_LABEL_FONT_SIZE}>
              {l.text}
            </text>
          </g>
        ),
      )}
    </g>
  );
});

const editingLabelOf = (editing: Editing | null, id: string): number | null => (editing?.kind === "edge" && editing.id === id ? (editing.label ?? 0) : null);

/** Every connector's line (drawn under the shapes). */
export function ConnectorLines({ routed, selEdges }: { routed: readonly RoutedEdge[]; selEdges: readonly string[] }) {
  return (
    <g aria-hidden className="fc-edges">
      {routed.map((r) => (
        <ConnectorLine key={r.edge.id} routed={r} selected={selEdges.includes(r.edge.id)} />
      ))}
    </g>
  );
}

/** Every connector's labels (drawn above the shapes). */
export function ConnectorLabelLayer({ routed, selEdges, editing }: { routed: readonly RoutedEdge[]; selEdges: readonly string[]; editing: Editing | null }) {
  return (
    <g aria-hidden className="fc-edge-label-layer">
      {routed.map((r) => (r.labels.length ? <ConnectorLabels key={r.edge.id} routed={r} selected={selEdges.includes(r.edge.id)} editingLabel={editingLabelOf(editing, r.edge.id)} /> : null))}
    </g>
  );
}
