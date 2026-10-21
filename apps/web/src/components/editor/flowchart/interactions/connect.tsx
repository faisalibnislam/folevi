"use client";

// Connecting shapes. The hovered shape (or the selected one) shows a connection point on each side: drag
// one out to draw a connector. While an end is dragged, the shape under it shows its connection points
// and the end snaps (connectors.ts, snapEnd): onto a connection point (that side, spread evenly with the
// side's other connectors), onto the outline (that exact spot), into the shape (the router picks the side),
// or nowhere (a free end). The chart re-routes live under the pointer, so what you see is what you get.
//
//   A new connector let go on a shape connects to it; let go on empty canvas it asks the shape picker
//   (ctrl.dropInEmptyRef, interactions/quickAdd.tsx), or adds a connected shape there; with ⌥ it is left
//   with a free end. A selected connector's ends can be dragged to another shape, side or point, or off
//   into empty space to float free (⌥ never snaps). Each finished drag is one undo step.
import { useMemo, useState } from "react";
import { OPPOSITE, flowId, newEdge, type FlowEdge, type FlowNode, type FlowShape, type FlowSide } from "../schema";
import { addNode, connect } from "../ops";
import { SIDES, connectionPoint, endNode, newConnector, patchEdges, setEnd, snapEnd, type End, type EndTarget } from "../connectors";
import { connectionHandles, containerGrabRects } from "../building";
import { haptic } from "@/lib/nativeApp";
import type { FlowController, Interaction } from "../controller/types";

/** Fingers get bigger targets (44 pt). */
export const isCoarse = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

/** A press must travel this far (screen pixels) before it counts as a drag rather than a click. */
const DRAG = 4;

/** A light tap on the iPhone and iPad as a dragged end snaps onto a shape, side or spot. */
function snapFeel(coarse: boolean) {
  let last = "";
  return (t: EndTarget) => {
    const key = t.kind === "node" ? `${t.node}:${t.side ?? ""}:${t.at ?? ""}` : "";
    if (coarse && key && key !== last) haptic("light");
    last = key;
  };
}

export function useConnect(ctrl: FlowController, { hover }: { hover: string | null }) {
  const { docRef, setLive, commit, setSel, setEditing, toWorld, byId, editing, view, viewRef, isDragging } = ctrl;
  /** Where the end being dragged would attach (for the indicator). */
  const [target, setTarget] = useState<EndTarget | null>(null);
  const [drawing, setDrawing] = useState(false);

  /** Dropped on empty space: the shape picker, or a new shape there, connected. */
  const dropInSpace = (from: string, side: FlowSide, e: React.PointerEvent) => {
    const fc = docRef.current;
    const p = toWorld(e.clientX, e.clientY);
    const src = fc.nodes.find((n) => n.id === from);
    if (!src) return;
    // Extension point: the shape picker (interactions/quickAdd.tsx) chooses the new shape.
    if (ctrl.dropInEmptyRef.current?.({ from, side, at: p, client: { x: e.clientX, y: e.clientY } })) return;
    const shape: FlowShape = src.shape === "decision" || src.shape === "terminator" || src.shape === "text" ? "process" : src.shape;
    const inSide = OPPOSITE[side];
    const size = { w: src.shape === shape ? src.w : 160, h: src.shape === shape ? src.h : 64 };
    const offset = { top: { x: 0, y: size.h / 2 }, bottom: { x: 0, y: -size.h / 2 }, left: { x: size.w / 2, y: 0 }, right: { x: -size.w / 2, y: 0 } }[inSide];
    const added = addNode(fc, shape, { x: p.x + offset.x, y: p.y + offset.y }, { w: size.w, h: size.h, color: src.color });
    if (!added) return;
    const res = connect(added.doc, from, added.id, side, inSide);
    if (!res) return;
    commit(res.doc, { before: fc });
    setEditing({ kind: "node", id: added.id, before: res.doc });
    setSel({ nodes: [added.id], edges: [] });
  };

  /** Drawing a new connector out of `from`'s `side`. */
  const drawFrom = (from: string, side: FlowSide, e: React.PointerEvent) => {
    const before = docRef.current;
    const coarse = e.pointerType === "touch";
    const sx = e.clientX;
    const sy = e.clientY;
    const id = flowId("e");
    const feel = snapFeel(coarse);
    let moved = false;
    const aim = (m: { clientX: number; clientY: number; altKey: boolean }) => {
      const p = toWorld(m.clientX, m.clientY);
      return m.altKey ? ({ kind: "free", point: { x: Math.round(p.x), y: Math.round(p.y) } } as const) : snapEnd(before, p, viewRef.current.k, { exclude: from, coarse });
    };
    return {
      move: (m: PointerEvent) => {
        if (!moved && Math.hypot(m.clientX - sx, m.clientY - sy) < DRAG) return;
        if (!moved) setDrawing(true);
        moved = true;
        const t = aim(m);
        const edge = setEnd(newEdge(from, "", { id, fromSide: side }), "to", t);
        if (!edge) return;
        setLive({ ...before, edges: [...before.edges, edge] });
        setTarget(t);
        feel(t);
      },
      end: (up: React.PointerEvent) => {
        setTarget(null);
        setDrawing(false);
        setLive(before);
        // A click on a connection point draws nothing.
        if (!moved || Math.hypot(up.clientX - sx, up.clientY - sy) < 12) return;
        const t = aim(up);
        if (t.kind === "node" || up.altKey) {
          const res = newConnector(before, from, side, t);
          if (res && res.doc !== before) {
            commit(res.doc, { before });
            setSel({ nodes: [], edges: [res.id] });
          }
          return;
        }
        dropInSpace(from, side, up);
      },
      cancel: () => {
        setTarget(null);
        setDrawing(false);
        setLive(before);
      },
    };
  };

  /** Dragging an end of an existing connector: reconnect it, or let it float free. */
  const dragEnd = (edgeId: string, end: End, e: React.PointerEvent) => {
    const before = docRef.current;
    const orig = before.edges.find((x) => x.id === edgeId);
    if (!orig) return null;
    const coarse = e.pointerType === "touch";
    const sx = e.clientX;
    const sy = e.clientY;
    const fixed = endNode(orig, end === "from" ? "to" : "from") || undefined;
    const feel = snapFeel(coarse);
    let moved = false;
    const place = (m: { clientX: number; clientY: number; altKey: boolean }): FlowEdge | null => {
      const p = toWorld(m.clientX, m.clientY);
      const t: EndTarget = m.altKey ? { kind: "free", point: { x: Math.round(p.x), y: Math.round(p.y) } } : snapEnd(before, p, viewRef.current.k, { exclude: fixed, coarse });
      setTarget(t);
      feel(t);
      return setEnd(orig, end, t);
    };
    return {
      move: (m: PointerEvent) => {
        if (!moved && Math.hypot(m.clientX - sx, m.clientY - sy) < DRAG) return;
        if (!moved) setDrawing(true);
        moved = true;
        const next = place(m);
        if (next) setLive(patchEdges(before, [edgeId], () => next));
      },
      end: () => {
        setTarget(null);
        setDrawing(false);
        if (moved && docRef.current !== before) commit(docRef.current, { before });
      },
      cancel: () => {
        setTarget(null);
        setDrawing(false);
        setLive(before);
      },
    };
  };

  const interaction: Interaction = {
    handles: "[data-fc-handle],[data-fc-end]",
    press: ({ e, target: el }) => {
      const handle = el.closest("[data-fc-handle]");
      if (handle) return drawFrom(handle.getAttribute("data-node")!, handle.getAttribute("data-side") as FlowSide, e);
      const endEl = el.closest("[data-fc-end]");
      if (!endEl) return null;
      return dragEnd(endEl.getAttribute("data-edge")!, endEl.getAttribute("data-fc-end") as End, e) ?? "handled";
    },
  };

  const k = view.k;
  const coarse = isCoarse();
  const tnode = target?.kind === "node" ? byId.get(target.node) : undefined;
  /** The shape under a dragged end: its outline, its connection points and the spot the end takes. */
  const previewOverlay = (
    <>
      {tnode ? <rect className="fc-drop-target" x={tnode.x - 4 / k} y={tnode.y - 4 / k} width={tnode.w + 8 / k} height={tnode.h + 8 / k} rx={10} /> : null}
      {tnode
        ? SIDES.map((side) => {
            const p = connectionPoint(tnode, side);
            const on = target?.kind === "node" && target.side === side && target.at === undefined;
            return <circle key={side} className="fc-port-target" data-on={on || undefined} data-fc-target-side={side} cx={p.x} cy={p.y} r={(on ? 5.5 : 4) / k} />;
          })
        : null}
      {target?.kind === "node" && target.side && target.at !== undefined ? <circle className="fc-snap-point" cx={target.point.x} cy={target.point.y} r={4.5 / k} /> : null}
    </>
  );

  // The hovered shape's connection points, else the selected one's, so a connection can start from any shape.
  const { single, selEdges } = ctrl;
  const hovered = hover && !editing ? byId.get(hover) : undefined;
  const portNode: FlowNode | null = drawing ? null : (hovered ?? single);
  const dragging = isDragging();
  const hitR = (coarse ? 22 : 12) / k;
  // Frames' and lanes' title bands are pressed to move them: connection points keep off them.
  const grabs = useMemo(() => containerGrabRects(ctrl.doc), [ctrl.doc]);
  /** Connection points on a shape, and the selected connectors' end handles (drawn above the resize handles). */
  const handlesOverlay = (
    <>
      {portNode && !dragging
        ? connectionHandles(portNode, 14 / k, hitR, grabs).map(({ side, at: p }) => (
            <g key={side} className="fc-port" data-fc-handle="" data-node={portNode.id} data-side={side}>
              <circle cx={p.x} cy={p.y} r={hitR} className="fc-port-hit" />
              <circle cx={p.x} cy={p.y} r={4.5 / k} className="fc-port-dot" />
            </g>
          ))
        : null}
      {!editing && !drawing
        ? selEdges.slice(0, 24).flatMap((edge) => {
            const r = ctrl.routed.find((x) => x.edge.id === edge.id);
            if (!r || r.points.length < 2) return [];
            return (["from", "to"] as const).map((end) => {
              const p = end === "from" ? r.points[0]! : r.points[r.points.length - 1]!;
              const free = !endNode(edge, end);
              return (
                <g key={`${edge.id}:${end}`} data-fc-end={end} data-edge={edge.id} data-free={free || undefined}>
                  <circle className="fc-handle-hit" cx={p.x} cy={p.y} r={hitR} />
                  <circle className="fc-end" data-free={free || undefined} cx={p.x} cy={p.y} r={5 / k} />
                </g>
              );
            });
          })
        : null}
    </>
  );

  return { interaction, previewOverlay, handlesOverlay, /** An end is being dragged (a connector drawn or reconnected). */ drawing };
}
