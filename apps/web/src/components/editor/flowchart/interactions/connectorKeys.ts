"use client";

// Reaching connectors from the keyboard. Connector lines are keyboard stops outside the Tab order
// (layers/Connectors.tsx: tabIndex -1, named "Connector from Start to Check, Yes"), so Tab on a shape still
// adds the next step (interactions/keyboardFlow.ts). Listed before interactions/edgeLabels.tsx (where typing
// on a selected connector writes its label) and the keyboard shortcuts, so it takes these keys first:
//
//   ] / [        on a shape: its next / previous connector (leaving it first, then arriving); on a connector,
//                the next / previous one at the same shape
//   Tab          on a connector: into its bar (route, ends, line, colour, label, delete); Esc comes back
//   Home / End   on a connector: the shape it starts from / leads to
//   Esc          on a connector reached from a shape: back to that shape
//   ⌫            on a connector: removes it, and the keyboard goes back to the shape
//   Enter edits its label (interactions/keyboard.ts), typing writes it (interactions/edgeLabels.tsx).
//
// Focus follows the selection here too: a selected connector (clicked, or one whose label was just
// written) takes the keyboard when the canvas or another canvas item had it.
import { useEffect, useRef } from "react";
import { connectorsOf, stepConnector } from "../connectors";
import { NO_SELECTION, deleteSelection } from "../ops";
import { reveal } from "./quickAdd";
import type { FlowController, Interaction } from "../controller/types";

/** The element drawing connector `id`'s line in this canvas (the keyboard stop). */
export const connectorEl = (wrap: HTMLElement | null, id: string) => wrap?.querySelector<SVGGElement>(`[data-fc-edge-line][data-fc-edge="${CSS.escape(id)}"]`) ?? null;
const shapeEl = (wrap: HTMLElement | null, id: string) => wrap?.querySelector<SVGGElement>(`[data-fc-node="${CSS.escape(id)}"]`) ?? null;

/** Gives connector `id` the keyboard (from its bar's Esc, for one). */
export function focusConnector(wrap: HTMLElement | null, id: string) {
  connectorEl(wrap, id)?.focus({ preventScroll: true });
}

export function useConnectorKeys(ctrl: FlowController) {
  const { docRef, selRef, setSel, wrapRef, say, isDragging, commit, byId } = ctrl;
  /** The shape the keyboard came from to reach connector `edge` (] steps through that shape's). */
  const anchorRef = useRef<{ shape: string; edge: string } | null>(null);
  const anchorOf = (edge: string) => (anchorRef.current?.edge === edge ? anchorRef.current.shape : null);

  const shapeName = (id: string) => {
    const n = docRef.current.nodes.find((x) => x.id === id);
    return n ? n.text.trim() || "this shape" : "this shape";
  };

  /** Selects and focuses connector `id`, reached from shape `anchor`, and says where it is in that shape's. */
  const goTo = (id: string, anchor: string) => {
    anchorRef.current = { shape: anchor, edge: id };
    setSel({ nodes: [], edges: [id] });
    const r = ctrl.routed.find((x) => x.edge.id === id);
    if (r?.points.length) {
      const xs = r.points.map((p) => p.x);
      const ys = r.points.map((p) => p.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      reveal(ctrl, { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
    }
    // The element is there already (only its selected look changes), so the name is read straight away.
    focusConnector(wrapRef.current, id);
    const list = connectorsOf(docRef.current, anchor);
    say(`${list.indexOf(id) + 1} of ${list.length} connector${list.length === 1 ? "" : "s"} at ${shapeName(anchor)}.`);
  };

  /** Back to shape `id` (selected, with the keyboard). */
  const toShape = (id: string) => {
    anchorRef.current = null;
    if (!docRef.current.nodes.some((n) => n.id === id)) return false;
    setSel({ nodes: [id], edges: [] });
    const n = docRef.current.nodes.find((x) => x.id === id);
    if (n) reveal(ctrl, n);
    shapeEl(wrapRef.current, id)?.focus({ preventScroll: true });
    return true;
  };

  // Focusing a connector (the keyboard, a screen reader's own navigation) selects it.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onFocusIn = (e: FocusEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-fc-edge-line]");
      if (!el || isDragging()) return;
      const id = el.getAttribute("data-fc-edge")!;
      const s = selRef.current;
      if (!(s.edges.length === 1 && s.edges[0] === id && !s.nodes.length)) setSel({ nodes: [], edges: [id] });
    };
    wrap.addEventListener("focusin", onFocusIn);
    return () => wrap.removeEventListener("focusin", onFocusIn);
  }, [wrapRef, selRef, setSel, isDragging]);

  // Focus follows the selection: one selected connector takes the keyboard from the canvas or another item.
  const oneEdge = ctrl.selEdges.length === 1 && !ctrl.selNodes.length ? ctrl.selEdges[0]!.id : null;
  const writing = ctrl.editing !== null;
  useEffect(() => {
    if (!oneEdge || writing || isDragging()) return;
    const wrap = wrapRef.current;
    const a = document.activeElement;
    if (!wrap || !(a === wrap || (a instanceof SVGElement && a.closest("[data-fc-node],[data-fc-edge-line]") && wrap.contains(a)))) return;
    const el = connectorEl(wrap, oneEdge);
    if (el && el !== a) el.focus({ preventScroll: true });
  }, [oneEdge, writing, wrapRef, isDragging]);

  const interaction: Interaction = {
    keyDown: (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      const s = selRef.current;
      const fc = docRef.current;
      const shape = s.nodes.length === 1 && !s.edges.length ? s.nodes[0]! : null;
      const edgeId = s.edges.length === 1 && !s.nodes.length ? s.edges[0]! : null;
      const edge = edgeId ? fc.edges.find((x) => x.id === edgeId) : undefined;
      if (e.key === "]" || e.key === "[") {
        const step = e.key === "]" ? 1 : -1;
        if (shape) {
          const next = stepConnector(connectorsOf(fc, shape), null, step);
          if (!next) say(`${shapeName(shape)} has no connectors.`);
          else goTo(next, shape);
          return true;
        }
        if (edge) {
          const anchor = anchorOf(edge.id) ?? (edge.from || edge.to);
          if (!anchor) return true;
          const next = stepConnector(connectorsOf(fc, anchor), edge.id, step);
          if (next) goTo(next, anchor);
          return true;
        }
        return false;
      }
      if (!edge) return false;
      const line = connectorEl(wrapRef.current, edge.id);
      if (e.key === "Tab" && !e.shiftKey && document.activeElement === line) {
        const first = wrapRef.current?.querySelector<HTMLElement>(".fc-bar-edge button:not(:disabled)");
        if (!first) return false;
        first.focus();
        return true;
      }
      if (e.key === "Home" || e.key === "End") {
        const id = e.key === "Home" ? edge.from : edge.to;
        if (!id || !byId.has(id)) say(e.key === "Home" ? "It starts at a point, not a shape." : "It ends at a point, not a shape.");
        else toShape(id);
        return true;
      }
      const anchor = anchorOf(edge.id);
      if (e.key === "Escape" && anchor) return toShape(anchor);
      if (e.key === "Delete" || e.key === "Backspace") {
        const back = anchor ?? (edge.from || edge.to);
        commit(deleteSelection(fc, { nodes: [], edges: [edge.id] }));
        setSel(NO_SELECTION);
        say("Connector deleted.");
        if (back) toShape(back);
        return true;
      }
      return false;
    },
  };

  return { interaction };
}
