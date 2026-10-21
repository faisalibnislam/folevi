"use client";

// The editable canvas's drawing, bottom to top: the dot grid, connectors, shapes, connector labels, then
// the overlay (selection boxes, then whatever the interactions draw: guides, handles, previews). Shapes and
// connectors are drawn by render.tsx, shared with the read-only view and exports. Presentational only: no
// state, and the data-fc-* attributes are what the interactions look for under the pointer.
import { memo, useMemo } from "react";
import type { FlowNode, RoutedEdge } from "../schema";
import { FlowNodeShape, nodeAriaLabel } from "../render";
import { connectorName } from "../connectors";
import { ConnectorLabelLayer, ConnectorLines } from "./Connectors";
import type { Editing, View } from "../controller/types";

// Tab reaches each shape and focusing one selects it; its name says where it is ("Start: Begin, shape 2 of 7").
const NodeItem = memo(function NodeItem({ node, selected, hideText, onFocusNode, position, imageHref, uid }: { node: FlowNode; selected: boolean; hideText: boolean; onFocusNode: (id: string) => void; position: string; imageHref?: string; uid?: string }) {
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
      <FlowNodeShape node={node} hideText={hideText} imageHref={imageHref} uid={uid} />
      <rect className="fc-focus" x={node.x - 4} y={node.y - 4} width={node.w + 8} height={node.h + 8} rx={12} />
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
  imageUrls,
  uid,
}: {
  nodes: FlowNode[];
  routed: RoutedEdge[];
  selNodes: readonly string[];
  selEdges: readonly string[];
  editing: Editing | null;
  onFocusNode: (id: string) => void;
  /** Addresses of the shapes' images by file id (interactions/content.tsx). */
  imageUrls?: Readonly<Record<string, string>>;
  /** Keeps this canvas's clip ids apart from other charts on the page. */
  uid?: string;
}) {
  const count = nodes.length;
  // Each connector's spoken name; the same strings while nothing it names changes, so lines stay memoised.
  const names = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return new Map(routed.map((r) => [r.edge.id, connectorName(r.edge, byId)]));
  }, [nodes, routed]);
  return (
    <>
      <ConnectorLines routed={routed} selEdges={selEdges} names={names} />
      <g>
        {nodes.map((n, i) => (
          <NodeItem key={n.id} node={n} selected={selNodes.includes(n.id)} hideText={editing?.kind === "node" && editing.id === n.id} onFocusNode={onFocusNode} position={`shape ${i + 1} of ${count}`} imageHref={n.image ? imageUrls?.[n.image.fileId] : undefined} uid={uid} />
        ))}
      </g>
      <ConnectorLabelLayer routed={routed} selEdges={selEdges} editing={editing} />
    </>
  );
}

/** A box around each selected shape (the first thing in the overlay). */
export function SelectionBoxes({ nodes, k }: { nodes: FlowNode[]; k: number }) {
  return nodes.map((n) => <rect key={n.id} className="fc-sel-box" x={n.x - 3 / k} y={n.y - 3 / k} width={n.w + 6 / k} height={n.h + 6 / k} rx={8} />);
}
