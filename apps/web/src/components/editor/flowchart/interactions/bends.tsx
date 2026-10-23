"use client";

// Bend points. Pressing a connector selects it (shift or ⌘ adds or removes it, as interactions/select.tsx
// does); dragging its line adds a bend point there and moves it. The selected connector shows its bend
// points (drag to move, double-click to remove) and a hollow point in the middle of each stretch between
// them (drag to add one). A dragged bend lines up with its neighbours when close, otherwise it sits on the
// grid (⌥ turns snapping off). The route passes through the bends in order and re-routes live.
import { FLOWCHART_LIMITS, nearestAlong, type FlowchartData, type FlowEdge, type Pt, type RoutedEdge } from "../schema";
import { bendAddHandles, bendInsertIndex, bendNeighbours, insertBend, moveBend, patchEdges, removeBend, snapBend } from "../connectors";
import { isCoarse } from "./connect";
import type { FlowController, Gesture, Interaction } from "../controller/types";

const DRAG = 4;

export function useBends(ctrl: FlowController, { hidden = false }: { hidden?: boolean } = {}) {
  const { docRef, setLive, commit, selRef, setSel, toWorld, viewRef, editing, view } = ctrl;

  /** Drags bend `index` of `orig` (already in `start`, the chart shown when the drag began). */
  const dragBend = (before: FlowchartData, orig: FlowEdge, index: number, points: readonly Pt[], e: React.PointerEvent, opts: { insertAt?: Pt; onClick?: () => void } = {}): Gesture => {
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    let base = orig;
    let at = index;
    return {
      move: (m) => {
        if (!moved && Math.hypot(m.clientX - sx, m.clientY - sy) < DRAG) return;
        if (!moved && opts.insertAt) {
          if (orig.bends.length >= FLOWCHART_LIMITS.maxBends) return;
          base = insertBend(orig, index, opts.insertAt);
          at = index;
        }
        moved = true;
        const p = toWorld(m.clientX, m.clientY);
        const snapped = snapBend(p, bendNeighbours(base, points, at), 8 / viewRef.current.k, m.altKey);
        setLive(patchEdges(before, [orig.id], () => moveBend(base, at, snapped)));
      },
      end: () => {
        if (moved && docRef.current !== before) commit(docRef.current, { before });
        else if (!moved) opts.onClick?.();
      },
      cancel: () => setLive(before),
    };
  };

  const routeOf = (id: string): RoutedEdge | undefined => ctrl.routed.find((r) => r.edge.id === id);

  const interaction: Interaction = {
    handles: "[data-fc-bend],[data-fc-bend-add]",
    press: ({ e, target, at }) => {
      const before = docRef.current;
      const bendEl = target.closest("[data-fc-bend],[data-fc-bend-add]");
      if (bendEl) {
        const id = bendEl.getAttribute("data-edge")!;
        const orig = before.edges.find((x) => x.id === id);
        const r = routeOf(id);
        if (!orig || !r) return "handled";
        const add = bendEl.hasAttribute("data-fc-bend-add");
        const index = Number(bendEl.getAttribute(add ? "data-fc-bend-add" : "data-fc-bend"));
        return dragBend(before, orig, index, r.points, e, add ? { insertAt: at } : {});
      }
      // The line itself (not a label: interactions/edgeLabels.tsx takes those first).
      const edgeEl = target.closest("[data-fc-edge]");
      if (!edgeEl || edgeEl.hasAttribute("data-fc-label")) return null;
      const id = edgeEl.getAttribute("data-fc-edge")!;
      const s = selRef.current;
      if (e.shiftKey || e.metaKey) {
        setSel({ nodes: s.nodes, edges: s.edges.includes(id) ? s.edges.filter((x) => x !== id) : [...s.edges, id] });
        return "handled";
      }
      const several = s.edges.includes(id) && s.edges.length + s.nodes.length > 1;
      if (!s.edges.includes(id)) setSel({ nodes: [], edges: [id] });
      // A click (no drag) on one of several selected connectors selects just that one.
      const onClick = several ? () => setSel({ nodes: [], edges: [id] }) : undefined;
      const orig = before.edges.find((x) => x.id === id);
      const r = routeOf(id);
      if (!orig || !r) return "handled";
      // Dragging the line adds a bend where it was pressed.
      const near = nearestAlong(r.points, at);
      if (near.distance > 20 / viewRef.current.k) {
        onClick?.();
        return "handled";
      }
      return dragBend(before, orig, bendInsertIndex(orig, r.points, at), r.points, e, { insertAt: at, onClick });
    },
    doubleClick: ({ target }) => {
      const el = target.closest("[data-fc-bend]");
      if (!el) return false;
      const id = el.getAttribute("data-edge")!;
      const index = Number(el.getAttribute("data-fc-bend"));
      const fc = docRef.current;
      commit(patchEdges(fc, [id], (x) => removeBend(x, index)));
      return true;
    },
  };

  // The selected connector's bend points and the points that add one.
  const k = view.k;
  const r = ctrl.selectedEdge;
  let overlay: React.ReactNode = null;
  if (r && !editing && !hidden) {
    const e = r.edge;
    const hitR = (isCoarse() ? 22 : 10) / k;
    // An add point sitting on a label would take the label's drag: leave it out there.
    const onLabel = (p: Pt) => r.labels.some((l) => Math.abs(l.cx - p.x) < l.w / 2 + 6 / k && Math.abs(l.cy - p.y) < l.h / 2 + 6 / k);
    // Bends the route leaves out (stale ones, removed with the next edit) show no handle.
    const dropped = new Set(r.dropped);
    const kept = e.bends.flatMap((_, i) => (dropped.has(i) ? [] : [i]));
    const shown = dropped.size ? { ...e, bends: kept.map((i) => e.bends[i]!) } : e;
    const adds = bendAddHandles(shown, r.points)
      .map((h) => (dropped.size ? { ...h, index: kept[h.index] ?? e.bends.length } : h))
      .filter((h) => !onLabel(h.at));
    overlay = (
      <>
        {adds.map((h) => (
          <g key={`add${h.index}`} data-fc-bend-add={h.index} data-edge={e.id}>
            <circle className="fc-handle-hit" cx={h.at.x} cy={h.at.y} r={hitR} />
            <circle className="fc-bend-add" cx={h.at.x} cy={h.at.y} r={3.5 / k} />
          </g>
        ))}
        {e.bends.map((b, i) => {
          if (dropped.has(i)) return null;
          // Every route passes through its bend points (curves included), so the handle sits on the bend.
          const p = b;
          return (
            <g key={`bend${i}`} data-fc-bend={i} data-edge={e.id}>
              <circle className="fc-handle-hit" cx={p.x} cy={p.y} r={hitR} />
              <circle className="fc-bend" cx={p.x} cy={p.y} r={5 / k} />
            </g>
          );
        })}
      </>
    );
  }

  return { interaction, overlay };
}
