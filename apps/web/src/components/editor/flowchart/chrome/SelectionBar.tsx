"use client";

// The floating bar for the current selection: NodeBar for shapes, EdgeBar for connectors (FlowchartChrome.tsx),
// placed above the selection (or below it near the top), hidden while dragging or writing.
import { setColor, setShape, updateEdges, boxOf } from "../ops";
import { EdgeBar, NodeBar } from "../FlowchartChrome";
import { clamp } from "../controller/useViewport";
import type { FlowController } from "../controller/types";
import type { FlowActions } from "../controller/useFlowActions";
import type { TextEditing } from "../interactions/textEditing";

const same = <T,>(list: T[]): T | null => (list.length && list.every((x) => x === list[0]) ? list[0]! : null);

export function SelectionBar({ ctrl, actions, startEdit }: { ctrl: FlowController; actions: FlowActions; startEdit: TextEditing["startEdit"] }) {
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
  const cx = clamp((sBox.x + sBox.w / 2) * k + view.x, 150, Math.max(150, width - 150));
  const above = top - 52 > 56;
  const style: React.CSSProperties = { left: cx, top: above ? top - 52 : Math.min(height - 48, bottom + 12) };

  if (selNodes.length && !selEdges.length) {
    return (
      <NodeBar
        style={style}
        color={same(selNodes.map((n) => n.color))}
        shape={same(selNodes.map((n) => n.shape))}
        onColor={(c) => commit(setColor(docRef.current, sel.nodes, c))}
        onShape={(s) => commit(setShape(docRef.current, sel.nodes, s))}
        onDuplicate={actions.duplicateSelection}
        onDelete={actions.removeSelection}
      />
    );
  }
  if (selEdges.length && !selNodes.length) {
    return (
      <EdgeBar
        style={style}
        lineStyle={same(selEdges.map((x) => x.style))}
        arrow={same(selEdges.map((x) => x.arrow))}
        onStyle={(s) => commit(updateEdges(docRef.current, sel.edges, (x) => ({ ...x, style: s })))}
        onArrow={(a) => commit(updateEdges(docRef.current, sel.edges, (x) => ({ ...x, arrow: a })))}
        onLabel={selEdges.length === 1 ? () => startEdit("edge", selEdges[0]!.id) : null}
        onDelete={actions.removeSelection}
      />
    );
  }
  return null;
}
