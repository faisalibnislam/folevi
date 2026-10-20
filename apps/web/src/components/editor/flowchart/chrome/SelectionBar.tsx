"use client";

// The floating bar for the current selection: NodeBar for shapes (FlowchartChrome.tsx), ConnectorBar for connectors,
// placed above the selection (or below it near the top), hidden while dragging or writing.
import { setColor, setShape, boxOf } from "../ops";
import { NodeBar } from "../FlowchartChrome";
import { ConnectorBar, connectorBarSpot } from "./ConnectorBar";
import { AlignMenu } from "./AlignMenu";
import { ContentTools } from "./ContentTools";
import type { ShapeContent } from "../interactions/content";
import { clamp } from "../controller/useViewport";
import type { FlowController } from "../controller/types";
import type { FlowActions } from "../controller/useFlowActions";
import type { TextEditing } from "../interactions/textEditing";

const same = <T,>(list: T[]): T | null => (list.length && list.every((x) => x === list[0]) ? list[0]! : null);

/** `clearance`: extra room below a single selected shape when the bar sits under it, for its quick add arrows. */
export function SelectionBar({ ctrl, actions, clearance = 0, content }: { ctrl: FlowController; actions: FlowActions; startEdit?: TextEditing["startEdit"]; clearance?: number; content?: ShapeContent }) {
  const { selNodes, selEdges, routed, view, width, height, editing, sel, docRef, commit } = ctrl;
  const k = view.k;
  const sBox = boxOf([
    ...selNodes,
    ...selEdges.flatMap((x) => {
      const r = routed.find((rr) => rr.edge.id === x.id);
      return r ? [boxOf(r.points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))!] : [];
    }),
  ]);
  const showBar = sBox && !ctrl.isDragging() && !editing && (selNodes.length || selEdges.length);
  if (!showBar || !sBox) return null;
  const top = sBox.y * k + view.y;
  const bottom = (sBox.y + sBox.h) * k + view.y;
  // A narrow canvas gets the compact shape bar; the bar stays clear of the edges either way.
  const compact = width < 760;
  const margin = content && !compact ? 260 : 150;
  const cx = clamp((sBox.x + sBox.w / 2) * k + view.x, margin, Math.max(margin, width - margin));
  const above = top - 52 > 56;
  const style: React.CSSProperties = { left: cx, top: above ? top - 52 : Math.min(height - 48, bottom + 12 + clearance) };

  if (selNodes.length && !selEdges.length) {
    return (
      <NodeBar
        style={style}
        color={same(selNodes.map((n) => n.color))}
        shape={same(selNodes.map((n) => n.shape))}
        onColor={(c) => commit(setColor(docRef.current, sel.nodes, c))}
        onShape={(s) => commit(setShape(docRef.current, sel.nodes, s))}
        onShapeLibrary={content?.bar.onShapeLibrary}
        libraryOpen={content?.bar.libraryOpen}
        compact={content ? compact : undefined}
        content={content ? <ContentTools bar={content.bar} compact={compact} /> : undefined}
        onDuplicate={actions.duplicateSelection}
        onDelete={actions.removeSelection}
        align={selNodes.length > 1 ? <AlignMenu ctrl={ctrl} /> : undefined}
      />
    );
  }
  if (selEdges.length && !selNodes.length) return <ConnectorBar ctrl={ctrl} actions={actions} style={connectorBarSpot(ctrl, sBox, style)} />;
  return null;
}
