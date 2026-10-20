"use client";

// The editable canvas's drawing, bottom to top: the dot grid, connectors, shapes, connector labels, then
// the overlay (selection boxes, then whatever the interactions draw: guides, handles, previews). Shapes and
// connectors are drawn by render.tsx, shared with the read-only view and exports. Presentational only: no
// state, and the data-fc-* attributes are what the interactions look for under the pointer.
import { memo } from "react";
import { roundedPolyline, type FlowNode, type RoutedEdge } from "../schema";
import { FlowEdgeLabel, FlowEdgeLine, FlowNodeShape, nodeAriaLabel } from "../render";
import type { Editing, View } from "../controller/types";

// Tab reaches each shape and focusing one selects it; its name says where it is ("Start: Begin, shape 2 of 7").
const NodeItem = memo(function NodeItem({ node, selected, hideText, onFocusNode, position }: { node: FlowNode; selected: boolean; hideText: boolean; onFocusNode: (id: string) => void; position: string }) {
  return (
    <g
      className="fc-node"
      data-fc-node={node.id}
      data-shape={node.shape}
      data-color={node.color}
      data-selected={selected || undefined}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`${nodeAriaLabel(node)}, ${position}`}
      onFocus={() => onFocusNode(node.id)}
    >
      <FlowNodeShape node={node} hideText={hideText} />
      <rect className="fc-focus" x={node.x - 4} y={node.y - 4} width={node.w + 8} height={node.h + 8} rx={12} />
    </g>
  );
});

const EdgeItem = memo(function EdgeItem({ routed, selected }: { routed: RoutedEdge; selected: boolean }) {
  return (
    <g className="fc-edge" data-fc-edge={routed.edge.id} data-selected={selected || undefined}>
      <path className="fc-edge-hit" d={roundedPolyline(routed.points)} />
      <FlowEdgeLine routed={routed} />
    </g>
  );
});

/** The dotted background; dots spread out when zoomed far out. */
export function DotGrid({ id, view }: { id: string; view: View }) {
  const k = view.k;
  const dot = 24 * k < 10 ? 48 * k : 24 * k;
  return (
    <>
      <defs>
        <pattern id={id} width={dot} height={dot} patternUnits="userSpaceOnUse" x={view.x % dot} y={view.y % dot}>
          <circle cx={dot / 2} cy={dot / 2} r={1} className="fc-dot" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </>
  );
}

/** Connectors, shapes and connector labels, in world coordinates. */
export function SceneLayers({
  nodes,
  routed,
  selNodes,
  selEdges,
  editing,
  onFocusNode,
}: {
  nodes: FlowNode[];
  routed: RoutedEdge[];
  selNodes: readonly string[];
  selEdges: readonly string[];
  editing: Editing | null;
  onFocusNode: (id: string) => void;
}) {
  const count = nodes.length;
  return (
    <>
      <g aria-hidden>
        {routed.map((r) => (
          <EdgeItem key={r.edge.id} routed={r} selected={selEdges.includes(r.edge.id)} />
        ))}
      </g>
      <g>
        {nodes.map((n, i) => (
          <NodeItem key={n.id} node={n} selected={selNodes.includes(n.id)} hideText={editing?.kind === "node" && editing.id === n.id} onFocusNode={onFocusNode} position={`shape ${i + 1} of ${count}`} />
        ))}
      </g>
      <g aria-hidden>
        {routed.map((r) =>
          r.label ? (
            <g key={r.edge.id} className="fc-edge" data-fc-edge={r.edge.id} data-selected={selEdges.includes(r.edge.id) || undefined}>
              <FlowEdgeLabel routed={r} hidden={editing?.kind === "edge" && editing.id === r.edge.id} />
            </g>
          ) : null,
        )}
      </g>
    </>
  );
}

/** A box around each selected shape (the first thing in the overlay). */
export function SelectionBoxes({ nodes, k }: { nodes: FlowNode[]; k: number }) {
  return nodes.map((n) => <rect key={n.id} className="fc-sel-box" x={n.x - 3 / k} y={n.y - 3 / k} width={n.w + 6 / k} height={n.h + 6 / k} rx={8} />);
}
