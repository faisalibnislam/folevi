"use client";

// The event router: turns the canvas's DOM events into calls on the interactions (controller/types.ts),
// in the order given. It owns what no single interaction should: the pointers that are down, two-finger
// pinch zoom (which interrupts whatever the first finger was doing), pointer capture, and running a
// gesture's `move` at most once a frame.
import { useRef, useState } from "react";
import type { Pt } from "../schema";
import { targetUnder } from "../../canvas/targetUnder";
import { MAX_K, MIN_K, clamp } from "./useViewport";
import type { CanvasHit, FlowController, Interaction } from "./types";

/** Keys pressed in these (the toolbars and panels) belong to them, not to the canvas. */
const CHROME = ".fc-bar, .fc-ai";

export function useInteractions(ctrl: FlowController, interactions: Interaction[]) {
  const { dragRef, toWorld, svgRef, viewRef, setView } = ctrl;
  const pointers = useRef(new Map<number, { x: number; y: number; type: string }>());
  const frame = useRef<number | null>(null);
  const lastMove = useRef<PointerEvent | null>(null);
  // Parts of the view (selection bars, handles) hide while a gesture runs: draw again when one ends.
  const [, setTick] = useState(0);
  const redraw = () => setTick((t) => t + 1);

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
    for (const i of interactions) i.beforePress?.(e);
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
    lastMove.current = e.nativeEvent;
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
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
      if (e.type !== "pointercancel") process(e.nativeEvent);
    }
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (e.type === "pointercancel") d.gesture.cancel?.();
    else d.gesture.end?.(e);
    redraw();
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
    if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement || t.closest(CHROME)) return;
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
      onDoubleClick,
      onContextMenu,
      onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
      onPointerLeave: () => {
        if (!dragRef.current) for (const i of interactions) i.leave?.();
      },
    },
    /** Spread on the focusable canvas element. */
    canvas: {
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
