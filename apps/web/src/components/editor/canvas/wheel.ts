"use client";

// What every canvas block shares about the wheel and the trackpad (flowchart, mind map, stickies, wireframe).
import { useEffect, useRef, type RefObject } from "react";

/**
 * Whether plain scrolling belongs to the canvas right now: the pointer was pressed inside it and has not left
 * it since. A canvas that merely has the keyboard does not hold the wheel: once the pointer leaves, scrolling
 * over it scrolls the note again, until the canvas is pressed again.
 */
export function useWheelArmed(inside: RefObject<Element | null>, /** The ancestor that counts as the canvas (its bars included); the element itself without one. */ root?: string): RefObject<boolean> {
  const armed = useRef(false);
  useEffect(() => {
    const el = (root ? inside.current?.closest<HTMLElement>(root) : null) ?? (inside.current as HTMLElement | null);
    if (!el) return;
    const arm = () => {
      armed.current = true;
    };
    const disarm = (e: PointerEvent) => {
      // Dragging out with the button held is still the same gesture.
      if (e.buttons === 0) armed.current = false;
    };
    el.addEventListener("pointerdown", arm, true);
    el.addEventListener("pointerleave", disarm);
    return () => {
      el.removeEventListener("pointerdown", arm, true);
      el.removeEventListener("pointerleave", disarm);
    };
  }, [inside, root]);
  return armed;
}

/**
 * How fast a ⌘/ctrl wheel event zooms, per pixel of deltaY (the zoom factor is exp(-deltaY * rate)). A
 * trackpad pinch arrives in Chrome and Firefox as a ctrl wheel with small deltas, and needs a much higher
 * rate than a mouse wheel's big steps to feel like a pinch.
 */
export function wheelZoomRate(e: WheelEvent): number {
  const pinch = e.ctrlKey && !e.metaKey && e.deltaMode === 0 && Math.abs(e.deltaY) < 40;
  return pinch ? 0.01 : 0.0022;
}

/**
 * A key that belongs to an input method (Japanese, Chinese, Korean...): the Enter that picks a candidate must
 * not also finish the edit. Safari and the Mac app send that Enter after the composition has ended, marked
 * only by key code 229, so both are checked.
 */
export function imeKey(e: { nativeEvent?: { isComposing?: boolean }; isComposing?: boolean; keyCode?: number }): boolean {
  return Boolean(e.nativeEvent?.isComposing ?? e.isComposing) || e.keyCode === 229;
}

interface GestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

/**
 * Trackpad pinch in Safari and the Mac app, which report it as gesturestart / gesturechange (with a scale
 * relative to the start) and never as a wheel. `zoomAt` gets the new scale and the point under the fingers,
 * relative to `el`. Returns the function that stops listening. (Other browsers never fire these events.)
 */
export function listenPinch(el: Element, { scale, zoomAt }: { scale: () => number; zoomAt: (k: number, x: number, y: number) => void }): () => void {
  let from = 1;
  const start = (e: Event) => {
    e.preventDefault();
    from = scale();
  };
  const change = (e: Event) => {
    e.preventDefault();
    const g = e as GestureEvent;
    const r = el.getBoundingClientRect();
    zoomAt(from * g.scale, g.clientX - r.left, g.clientY - r.top);
  };
  const end = (e: Event) => e.preventDefault();
  el.addEventListener("gesturestart", start);
  el.addEventListener("gesturechange", change);
  el.addEventListener("gestureend", end);
  return () => {
    el.removeEventListener("gesturestart", start);
    el.removeEventListener("gesturechange", change);
    el.removeEventListener("gestureend", end);
  };
}
