"use client";

// Connector labels: a connector holds several, each anywhere along the line. Drag a label to slide it
// along (it clicks into the middle); double-click a label to write in it, or the line to add a label
// there; typing on a selected connector writes its first label. Writing happens in EdgeLabelInput, which
// interactions/textEditing.tsx shows for the label being edited (ctrl.editing.label); labels left empty are
// removed when writing ends, and the whole edit is one undo step.
import { FLOWCHART_LABEL_FONT_SIZE, FLOWCHART_LIMITS, nearestAlong, pointAlong, type FlowEdge, type RoutedEdge } from "../schema";
import { addLabel, moveLabel, patchEdges, setLabelText } from "../connectors";
import type { FlowController, Interaction, View } from "../controller/types";

const DRAG = 3;

/** A spot along the connector clear of its other labels (for "Add label"). */
export function freeLabelSpot(e: Pick<FlowEdge, "labels">): number {
  const spots = [0.5, 0.25, 0.75, 0.15, 0.85, 0.35, 0.65];
  return spots.find((t) => e.labels.every((l) => Math.abs(l.at - t) > 0.08)) ?? 0.5;
}

/** Adds an empty label to connector `id` at `at` (or a free spot) and starts writing in it. */
export function startNewLabel(ctrl: FlowController, id: string, at?: number) {
  const before = ctrl.docRef.current;
  const edge = before.edges.find((x) => x.id === id);
  if (!edge) return;
  const added = addLabel(edge, at ?? freeLabelSpot(edge));
  if (!added) {
    // Full: write in the last label instead.
    ctrl.setEditing({ kind: "edge", id, before, label: Math.max(0, edge.labels.length - 1) });
    ctrl.setSel({ nodes: [], edges: [id] });
    return;
  }
  ctrl.setLive(patchEdges(before, [id], () => added.edge));
  ctrl.setEditing({ kind: "edge", id, before, label: added.index });
  ctrl.setSel({ nodes: [], edges: [id] });
}

export function useEdgeLabels(ctrl: FlowController) {
  const { docRef, setLive, commit, selRef, setSel, setEditing, toWorld, viewRef } = ctrl;
  const routeOf = (id: string): RoutedEdge | undefined => ctrl.routed.find((r) => r.edge.id === id);

  const interaction: Interaction = {
    handles: "[data-fc-label]",
    press: ({ e, target }) => {
      const el = target.closest("[data-fc-label]");
      if (!el) return null;
      const id = el.getAttribute("data-fc-edge")!;
      const index = Number(el.getAttribute("data-fc-label"));
      const s = selRef.current;
      if (e.shiftKey || e.metaKey) {
        setSel({ nodes: s.nodes, edges: s.edges.includes(id) ? s.edges.filter((x) => x !== id) : [...s.edges, id] });
        return "handled";
      }
      if (!s.edges.includes(id) || s.nodes.length || s.edges.length > 1) setSel({ nodes: [], edges: [id] });
      const before = docRef.current;
      const orig = before.edges.find((x) => x.id === id);
      const r = routeOf(id);
      if (!orig || !r) return "handled";
      const sx = e.clientX;
      const sy = e.clientY;
      let moved = false;
      return {
        move: (m) => {
          if (!moved && Math.hypot(m.clientX - sx, m.clientY - sy) < DRAG) return;
          moved = true;
          const t = nearestAlong(r.points, toWorld(m.clientX, m.clientY)).t;
          setLive(patchEdges(before, [id], () => moveLabel(orig, index, t)));
        },
        end: () => {
          if (moved && docRef.current !== before) commit(docRef.current, { before });
        },
        cancel: () => setLive(before),
      };
    },
    doubleClick: ({ target, at }) => {
      const label = target.closest("[data-fc-label]");
      if (label) {
        const id = label.getAttribute("data-fc-edge")!;
        setEditing({ kind: "edge", id, before: docRef.current, label: Number(label.getAttribute("data-fc-label")) });
        setSel({ nodes: [], edges: [id] });
        return true;
      }
      const line = target.closest("[data-fc-edge]");
      if (!line) return false;
      const id = line.getAttribute("data-fc-edge")!;
      const r = routeOf(id);
      const near = r ? nearestAlong(r.points, at) : null;
      startNewLabel(ctrl, id, near && near.distance < 24 / viewRef.current.k ? near.t : undefined);
      return true;
    },
    keyDown: (e) => {
      // Typing on one selected connector writes its first label.
      const s = selRef.current;
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1 || e.key === " " || s.nodes.length || s.edges.length !== 1) return false;
      const id = s.edges[0]!;
      const before = docRef.current;
      setLive(patchEdges(before, [id], (x) => setLabelText(x, 0, e.key)));
      setEditing({ kind: "edge", id, before, typed: true, label: 0 });
      return true;
    },
  };

  return { interaction };
}

/** The text box over the connector label being written (shown by interactions/textEditing.tsx). */
export function EdgeLabelInput({
  routed,
  index,
  typed,
  view,
  onChange,
  onFinish,
  onHistoryKey,
}: {
  routed: RoutedEdge;
  index: number;
  typed?: boolean;
  view: View;
  onChange: (value: string) => void;
  onFinish: (refocus?: boolean) => void;
  onHistoryKey: (e: React.KeyboardEvent) => boolean;
}) {
  const k = view.k;
  const box = routed.labels[index];
  const mid = box ? { x: box.cx, y: box.cy } : pointAlong(routed.points, 0.5);
  const value = routed.edge.labels[index]?.text ?? "";
  const w = Math.max(80, (box && box.text ? box.w : 60) + 24) * k;
  return (
    <input
      className="fc-label-input"
      autoFocus
      value={value}
      maxLength={FLOWCHART_LIMITS.maxLabel}
      placeholder="Label"
      aria-label={routed.edge.labels.length > 1 ? `Connector label ${index + 1} of ${routed.edge.labels.length}` : "Connector label"}
      style={{ left: mid.x * k + view.x - w / 2, top: mid.y * k + view.y - 12 * k, width: w, height: 24 * k, fontSize: FLOWCHART_LABEL_FONT_SIZE * k }}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => {
        const el = e.currentTarget;
        if (typed) el.setSelectionRange(el.value.length, el.value.length);
        else el.select();
      }}
      onBlur={() => onFinish(false)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (onHistoryKey(e)) return;
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          onFinish();
        }
      }}
    />
  );
}
