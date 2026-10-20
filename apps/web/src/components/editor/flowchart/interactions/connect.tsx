"use client";

// Connecting shapes: drag from a side handle (shown on the hovered or selected shape) onto another shape,
// or onto empty space for a new connected shape; drag a selected connector's end to reconnect it.
import { useState } from "react";
import { OPPOSITE, autoSides, nearestSide, orthogonalRoute, portPoint, roundedPolyline, type FlowNode, type FlowShape, type FlowSide, type Pt } from "../schema";
import { addNode, connect, nodeAt, updateEdges } from "../ops";
import type { FlowController, Interaction } from "../controller/types";

const SIDES: FlowSide[] = ["top", "right", "bottom", "left"];

export function useConnect(ctrl: FlowController, { hover }: { hover: string | null }) {
  const { docRef, commit, setSel, setEditing, toWorld, routed, byId, editing, view, isDragging } = ctrl;
  /** The connector being drawn, and the shape it would connect to. */
  const [link, setLink] = useState<{ points: Pt[]; target: string | null } | null>(null);

  /** Follows the pointer from `from`'s `side`, snapping to the shape under it. */
  const preview = (fromId: string, fromSide: FlowSide, p: Pt) => {
    const fc = docRef.current;
    const src = fc.nodes.find((n) => n.id === fromId);
    if (!src) return;
    const target = nodeAt(fc, p, 8);
    const tgt = target && target.id !== fromId ? target : null;
    const from = portPoint(src, fromSide);
    if (tgt) {
      const side = nearestSide(tgt, p);
      setLink({ points: orthogonalRoute(from, fromSide, portPoint(tgt, side), side, src, tgt), target: tgt.id });
    } else {
      const probe = { x: p.x, y: p.y, w: 0, h: 0 };
      const side = autoSides(src, probe)[1];
      setLink({ points: orthogonalRoute(from, fromSide, p, side, src, probe), target: null });
    }
  };

  /** Where the drag ended: connect, reconnect, or add a connected shape. */
  const drop = (d: { from: string; side: FlowSide; sx: number; sy: number; reconnect?: { edge: string; end: "from" | "to" } }, e: React.PointerEvent) => {
    const fc = docRef.current;
    const p = toWorld(e.clientX, e.clientY);
    const src = fc.nodes.find((n) => n.id === d.from);
    if (!src) return;
    const hit = nodeAt(fc, p, 8);
    // Dropped back on the shape it started from: nothing to connect.
    if (hit && hit.id === d.from && !d.reconnect) return;
    const target = hit && hit.id !== d.from ? hit : null;
    if (d.reconnect) {
      if (!target) return;
      const side = nearestSide(target, p);
      const edges = updateEdges(fc, [d.reconnect.edge], (x) => (d.reconnect!.end === "to" ? { ...x, to: target.id, toSide: side } : { ...x, from: target.id, fromSide: side }));
      commit(edges);
      return;
    }
    if (target) {
      const res = connect(fc, d.from, target.id, d.side, nearestSide(target, p));
      if (res && res.doc !== fc) {
        commit(res.doc);
        setSel({ nodes: [], edges: [res.id] });
      }
      return;
    }
    // Dropped on empty space: a new shape there, connected (unless it was just a click on the handle).
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 12) return;
    // Extension point: the shape picker (interactions/quickAdd.tsx) chooses the new shape.
    if (ctrl.dropInEmptyRef.current?.({ from: d.from, side: d.side, at: p, client: { x: e.clientX, y: e.clientY } })) return;
    const shape: FlowShape = src.shape === "decision" || src.shape === "terminator" || src.shape === "text" ? "process" : src.shape;
    const inSide = OPPOSITE[d.side];
    const size = { w: src.shape === shape ? src.w : 160, h: src.shape === shape ? src.h : 64 };
    const offset = { top: { x: 0, y: size.h / 2 }, bottom: { x: 0, y: -size.h / 2 }, left: { x: size.w / 2, y: 0 }, right: { x: -size.w / 2, y: 0 } }[inSide];
    const added = addNode(fc, shape, { x: p.x + offset.x, y: p.y + offset.y }, { w: size.w, h: size.h, color: src.color });
    if (!added) return;
    const res = connect(added.doc, d.from, added.id, d.side, inSide);
    if (!res) return;
    commit(res.doc, { before: fc });
    setEditing({ kind: "node", id: added.id, before: res.doc });
    setSel({ nodes: [added.id], edges: [] });
  };

  const interaction: Interaction = {
    handles: "[data-fc-handle],[data-fc-end]",
    press: ({ e, target }) => {
      let d: Parameters<typeof drop>[0];
      const handle = target.closest("[data-fc-handle]");
      if (handle) {
        d = { from: handle.getAttribute("data-node")!, side: handle.getAttribute("data-side") as FlowSide, sx: e.clientX, sy: e.clientY };
      } else {
        const end = target.closest("[data-fc-end]");
        if (!end) return null;
        const edge = docRef.current.edges.find((x) => x.id === end.getAttribute("data-edge"));
        if (!edge) return "handled";
        const which = end.getAttribute("data-fc-end") as "from" | "to";
        const fixed = which === "to" ? edge.from : edge.to;
        const r = routed.find((x) => x.edge.id === edge.id);
        d = { from: fixed, side: (which === "to" ? r?.fromSide : r?.toSide) ?? "bottom", sx: e.clientX, sy: e.clientY, reconnect: { edge: edge.id, end: which } };
      }
      const drag = d;
      return {
        move: (m) => preview(drag.from, drag.side, toWorld(m.clientX, m.clientY)),
        end: (up) => {
          setLink(null);
          drop(drag, up);
        },
        cancel: () => setLink(null),
      };
    },
  };

  const k = view.k;
  /** The connector being drawn and its drop target (drawn under the resize handles). */
  const previewOverlay = (
    <>
      {link ? <path className="fc-link-preview" d={roundedPolyline(link.points)} /> : null}
      {link?.target && byId.get(link.target)
        ? (() => {
            const t = byId.get(link.target)!;
            return <rect className="fc-drop-target" x={t.x - 4 / k} y={t.y - 4 / k} width={t.w + 8 / k} height={t.h + 8 / k} rx={10} />;
          })()
        : null}
    </>
  );

  // The hovered shape's handles, else the selected one's, so a connection can start from any shape.
  const { single, selectedEdge } = ctrl;
  const hovered = hover && !editing ? byId.get(hover) : undefined;
  const portNode: FlowNode | null = link ? null : (hovered ?? single);
  const dragging = isDragging();
  /** Side handles on a shape and the selected connector's end handles (drawn above the resize handles). */
  const handlesOverlay = (
    <>
      {portNode && !dragging
        ? SIDES.map((side) => {
            const p = portPoint(portNode, side);
            const off = 14 / k;
            const o = { top: [0, -off], right: [off, 0], bottom: [0, off], left: [-off, 0] }[side];
            return (
              <g key={side} className="fc-port" data-fc-handle="" data-node={portNode.id} data-side={side}>
                <circle cx={p.x + o[0]!} cy={p.y + o[1]!} r={12 / k} className="fc-port-hit" />
                <circle cx={p.x + o[0]!} cy={p.y + o[1]!} r={4.5 / k} className="fc-port-dot" />
              </g>
            );
          })
        : null}
      {selectedEdge && !editing
        ? (["from", "to"] as const).map((end) => {
            const p = end === "from" ? selectedEdge.points[0]! : selectedEdge.points[selectedEdge.points.length - 1]!;
            return <circle key={end} className="fc-end" data-fc-end={end} data-edge={selectedEdge.edge.id} cx={p.x} cy={p.y} r={5 / k} />;
          })
        : null}
    </>
  );

  return { interaction, previewOverlay, handlesOverlay };
}
