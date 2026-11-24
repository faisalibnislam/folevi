"use client";

// What the pan-and-zoom canvases (flowchart, mind map, stickies, wireframe) share about the pointers that are
// down on them: which presses are fingers of a pinch, which are a palm resting beside a pen, forgetting a
// finger whose release was never heard, and when a canvas pressed with a finger takes the keyboard.
import { useRef } from "react";

export interface DownPointer {
  x: number;
  y: number;
  type: string;
}

interface Press {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  clientX: number;
  clientY: number;
}

/**
 * Notes a pointer that has just been pressed on the canvas, and says what it is:
 * - "palm": a touch while a pen is down (the hand resting beside an Apple Pencil). It is not listed, and
 *   takes no part in any gesture: the pen carries on with what it was doing.
 * - "pinch": the second of two fingers.
 * - "press": anything else.
 */
export function notePress(pts: Map<number, DownPointer>, e: Press): "palm" | "pinch" | "press" {
  // A new first finger (or the pen, or the mouse) means any earlier pointer of its kind is gone, heard or
  // not. (WebKit sends a touch's release to the element the touch began on, even after that element has left
  // the page; a finger still listed from then would turn every later touch into a pinch.)
  if (e.isPrimary) for (const [id, p] of pts) if (p.type === e.pointerType) pts.delete(id);
  if (e.pointerType === "touch" && [...pts.values()].some((p) => p.type === "pen")) return "palm";
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
  return e.pointerType === "touch" && pinchPair(pts) ? "pinch" : "press";
}

/** The two fingers of a pinch: both have to be touches (never the pen, or the mouse, and a finger). */
export function pinchPair(pts: Map<number, DownPointer>): [DownPointer, DownPointer] | null {
  const touches = [...pts.values()].filter((p) => p.type === "touch");
  return touches.length >= 2 ? [touches[0]!, touches[1]!] : null;
}

/**
 * Whether a press reaching a board's handler isn't the board's: it began in something the board drew on top of the
 * page (a phone sheet, a dialog), which React hands up its own tree, or outside the board altogether. A board
 * that captured such a press took the click from the sheet's buttons (they never worked with a mouse).
 */
export function pressIsElsewhere(board: Element, target: EventTarget | null): boolean {
  if (!(target instanceof Node) || !board.contains(target)) return true;
  const el = target instanceof Element ? target : target.parentElement;
  return (el?.closest("dialog") ?? null) !== board.closest("dialog");
}

/**
 * Captures a pointer for `el`, so its moves and its release come to `el` whatever the press began on (a
 * control that the press itself takes off the page, a handle hidden while a gesture runs).
 */
export function capturePointer(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // The pointer is already gone.
  }
}

/**
 * When a canvas pressed with a finger or a pen takes the keyboard. Having the keyboard is what switches a
 * canvas from letting the page scroll under a finger (touch-action: pan-y) to handling every touch itself,
 * and the browser decides which at the start of each touch. So a canvas that took the keyboard on a touch
 * that turned out to be a scroll of the note would swallow the next swipe over it. Instead it takes the
 * keyboard when the press ends as a tap, and gives it back if it somehow got it and the browser then took
 * the touch away (pointercancel: the page scrolled). The mouse, and a canvas that already has the keyboard,
 * get it at the press as before.
 */
export function useTapFocus({ isActive, focus, drop }: { isActive: () => boolean; focus: () => void; drop: () => void }) {
  const waiting = useRef<number | null>(null);
  return {
    /** At the press. */
    down(e: { pointerId: number; pointerType: string }) {
      if (e.pointerType === "mouse" || isActive()) {
        waiting.current = null;
        focus();
      } else waiting.current = e.pointerId;
    },
    /** At the release, or when the press was taken away. */
    up(e: { pointerId: number; type: string }) {
      if (waiting.current !== e.pointerId) return;
      waiting.current = null;
      if (e.type === "pointercancel") {
        if (isActive()) drop();
        // (A press that itself opened a field in the canvas, a new idea's text, has the keyboard there already.)
      } else if (!isActive()) focus();
    },
  };
}

/** Takes the keyboard away from whatever inside `el` has it (see useTapFocus). */
export function dropFocusIn(el: Element | null | undefined): void {
  const a = document.activeElement;
  // (A shape or a part that has the keyboard is an SVG element.)
  if (el && (a instanceof HTMLElement || a instanceof SVGElement) && el.contains(a)) a.blur();
}
