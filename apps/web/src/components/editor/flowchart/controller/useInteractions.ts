"use client";

// The event router: turns the canvas's DOM events into calls on the interactions (controller/types.ts),
// in the order given. It owns what no single interaction should: the pointers that are down, two-finger
// pinch zoom (which interrupts whatever the first finger was doing), pointer capture, and running a
// gesture's `move` at most once a frame, panning the view when a drag reaches the canvas's edge, and ending a
// gesture whose pointer was lost.
import { useRef, useState } from "react";
import type { Pt } from "../schema";
import { targetUnder } from "../../canvas/targetUnder";
import { MAX_K, MIN_K, clamp } from "./useViewport";
import type { CanvasHit, FlowController, Interaction } from "./types";

/** Keys pressed in these (the toolbars and panels) belong to them, not to the canvas. */
const CHROME = ".fc-bar, .fc-ai, .fc-panel";

export function useInteractions(ctrl: FlowController, interactions: Interaction[]) {
  const { dragRef, toWorld, svgRef, viewRef, setView } = ctrl;
  const pointers = useRef(new Map<number, { x: number; y: number; type: string }>());
  const frame = useRef<number | null>(null);
  const lastMove = useRef<PointerEvent | null>(null);
  // Parts of the view (selection bars, handles) hide while a gesture runs: draw again when one ends.
  const [, setTick] = useState(0);
  const redraw = () => setTick((t) => t + 1);
  /** The toolbar or bar button that has the keyboard got it from a click (not from Tab): see onKeyDown. */
  const chromeByPointer = useRef(false);
  const edgePan = useRef<number | null>(null);

  /** Ends the running gesture: as a release at its last position, or cancelled (things go back as they were). */
  const stopGesture = (how: "end" | "cancel", e?: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (d?.kind !== "gesture") return;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
      if (how === "end" && lastMove.current) d.gesture.move?.(lastMove.current);
    }
    if (edgePan.current !== null) cancelAnimationFrame(edgePan.current);
    edgePan.current = null;
    lastMove.current = null;
    dragRef.current = null;
    const svg = svgRef.current;
    if (svg?.hasPointerCapture(d.pointer)) svg.releasePointerCapture(d.pointer);
    if (how === "cancel" || !e) d.gesture.cancel?.();
    else d.gesture.end?.(e);
    redraw();
  };

  // A drag held near the canvas's edge pans the view under it (so a shape can be taken, or a connector
  // drawn, to somewhere that isn't on screen), faster the closer to the edge.
  const EDGE = 28;
  const panAtEdge = () => {
    edgePan.current = null;
    const d = dragRef.current;
    const m = lastMove.current;
    const svg = svgRef.current;
    if (d?.kind !== "gesture" || d.gesture.ownsView || !m || !svg || m.pointerType === "touch") return;
    const r = svg.getBoundingClientRect();
    const push = (near: number, far: number) => (near < EDGE ? Math.min(1, (EDGE - near) / EDGE) : far < EDGE ? -Math.min(1, (EDGE - far) / EDGE) : 0);
    const dx = push(m.clientX - r.left, r.right - m.clientX) * 14;
    const dy = push(m.clientY - r.top, r.bottom - m.clientY) * 14;
    if (!dx && !dy) return;
    const next = { ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy };
    // The gesture reads the view through its ref: it has to hold the new one before the move runs.
    viewRef.current = next;
    setView(next);
    d.gesture.move?.(m);
    edgePan.current = requestAnimationFrame(panAtEdge);
  };

  const items = interactions
    .map((i) => i.handles)
    .filter(Boolean)
    .join(",");
  const hit = <E extends React.MouseEvent<SVGSVGElement>>(e: E, target: Element): CanvasHit<E> => ({
    e,
    target,
    at: toWorld(e.clientX, e.clientY),
    onBackground: !items || !target.closest(items),
  });

  const process = (e: PointerEvent) => {
    const d = dragRef.current;
    if (d?.kind === "gesture") d.gesture.move?.(e);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    let keep = false;
    for (const i of interactions) if (i.beforePress?.(e) === "keep") keep = true;
    if (keep) return;
    ctrl.focusCanvas();
    const pts = pointers.current;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    // Two fingers: pinch to zoom (and pan), whatever the first finger was doing.
    if (pts.size === 2 && e.pointerType === "touch") {
      const cur = dragRef.current;
      if (cur?.kind === "gesture") cur.gesture.cancel?.();
      const [a, b] = [...pts.values()].slice(0, 2) as [Pt, Pt] | [];
      if (!a || !b) return;
      const r = svgRef.current!.getBoundingClientRect();
      dragRef.current = { kind: "pinch", dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), view: viewRef.current, mid: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top } };
      redraw();
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    // A gesture whose release never arrived (the window lost the pointer mid-drag): put back, not carried on.
    if (dragRef.current?.kind === "gesture") stopGesture("cancel");
    const press = hit(e, e.target as Element);
    e.currentTarget.setPointerCapture(e.pointerId);
    for (const i of interactions) {
      const res = i.press?.(press);
      if (res === "handled") return;
      if (res) {
        dragRef.current = { kind: "gesture", pointer: e.pointerId, gesture: res };
        return;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const pts = pointers.current;
    if (!dragRef.current) for (const i of interactions) i.hover?.(e);
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    const d = dragRef.current;
    if (d?.kind === "pinch" && pts.size >= 2) {
      const [a, b] = [...pts.values()].slice(0, 2) as [Pt, Pt] | [];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const r = svgRef.current!.getBoundingClientRect();
      const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
      const k = clamp(d.view.k * (dist / d.dist), MIN_K, MAX_K);
      const wx = (d.mid.x - d.view.x) / d.view.k;
      const wy = (d.mid.y - d.view.y) / d.view.k;
      setView({ k, x: mid.x - wx * k, y: mid.y - wy * k });
      return;
    }
    if (d?.kind !== "gesture" || d.pointer !== e.pointerId) return;
    // The button came up somewhere this canvas never heard of: the drag ends here.
    if (e.pointerType === "mouse" && e.buttons === 0) return stopGesture("end", e);
    lastMove.current = e.nativeEvent;
    if (edgePan.current === null) edgePan.current = requestAnimationFrame(panAtEdge);
    if (frame.current === null) {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (lastMove.current) process(lastMove.current);
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    const d = dragRef.current;
    if (d?.kind === "pinch") {
      if (pointers.current.size < 2) dragRef.current = null;
      return;
    }
    if (!d || d.pointer !== e.pointerId) return;
    if (e.type !== "pointercancel" && frame.current !== null) lastMove.current = e.nativeEvent;
    stopGesture(e.type === "pointercancel" ? "cancel" : "end", e);
  };

  /** The browser took the pointer away without a release (another window came forward mid-drag). */
  const onLostPointerCapture = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (d?.kind === "gesture" && d.pointer === e.pointerId) stopGesture("end", e);
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const h = hit(e, targetUnder(e));
    for (const i of interactions) if (i.doubleClick?.(h)) return;
  };

  const onContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    // Never the note's block menu here (indent, move, insert below mean nothing inside a canvas).
    e.preventDefault();
    const h = hit(e, targetUnder(e));
    for (const i of interactions) if (i.contextMenu?.(h)) return;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    // Keys in a menu opened from the canvas's bars reach here through React's tree (menus render in the
    // top layer, outside the canvas): they belong to the menu.
    if (!e.currentTarget.contains(t)) return;
    if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement || t.isContentEditable) return;
    if (e.key === "Tab") chromeByPointer.current = false;
    if (t.closest(CHROME)) {
      // A bar's button that was clicked keeps the keyboard in some browsers (not in Safari or the Mac app).
      // The person is still working on the canvas: its keys go on working (Delete, ⌘Z, arrows, typing), all
      // but the ones that are the button's own. A button reached with Tab keeps every key.
      if (!chromeByPointer.current || !(t instanceof HTMLButtonElement) || e.key === "Enter" || e.key === " " || e.key === "Tab" || e.key === "Escape") return;
      ctrl.wrapRef.current?.focus({ preventScroll: true });
    }
    // While something is being dragged, Escape puts it back; no other key acts on a half-made change.
    if (dragRef.current?.kind === "gesture") {
      if (e.key === "Escape") stopGesture("cancel");
      // (Shift, Option and the like are the gesture's own: they change how it snaps.)
      else if (["Shift", "Alt", "Meta", "Control"].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    for (const i of interactions) {
      if (i.keyDown?.(e)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
  };

  const onKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    for (const i of interactions) i.keyUp?.(e);
  };

  return {
    /** Spread on the canvas's <svg>. */
    svg: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onLostPointerCapture,
      onDoubleClick,
      onContextMenu,
      onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
      onPointerLeave: () => {
        if (!dragRef.current) for (const i of interactions) i.leave?.();
      },
    },
    /** Spread on the focusable canvas element. */
    canvas: {
      onPointerDownCapture: (e: React.PointerEvent<HTMLDivElement>) => {
        chromeByPointer.current = Boolean((e.target as Element).closest?.(CHROME));
      },
      onKeyDown,
      onKeyUp,
      onFocus: () => ctrl.setActive(true),
      onBlur: (e: React.FocusEvent<HTMLDivElement>) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        ctrl.setActive(false);
        for (const i of interactions) i.blur?.();
      },
    },
  };
}
