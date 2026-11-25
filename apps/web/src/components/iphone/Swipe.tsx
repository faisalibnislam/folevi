"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { feel, prepareFeel } from "@/lib/native/ui";
import { pastFullSwipe, prefersReducedMotion, SPRINGS, springCss } from "@/lib/native/physics";
import { EXIT_EASE, ghostOut } from "./exit";

export interface SwipeAction {
  label: string;
  icon: ReactNode;
  /** The button's colour (a CSS colour); text and icon are white on it. */
  tone: string;
  onAction: () => void;
  /** Deleting: a warning tap when it runs. */
  danger?: boolean;
  /**
   * Running it takes the row out of the list: the row slides off in its swipe's direction instead of
   * springing back, then folds away. By default the trailing side's actions do (Trash, Archive, Remove).
   */
  removes?: boolean;
}

const ACTION_W = 76;
/** One row open at a time: opening one closes the others. */
const OPEN_EVENT = "folevi:swipe-open";
/** A row settling open or shut, or springing back (§2.4: response 0.3, damping 0.86). */
const SETTLE = springCss(SPRINGS.swipe);
/** A row slid off that its list kept after all (the action didn't remove it) springs back after this. */
const GONE_HOLD_MS = 1500;
/** A row unmounting this soon after one of its actions ran was taken out by it: it folds away. */
const ACTED_WINDOW_MS = 4000;

/**
 * A list row with iOS swipe actions: swipe left to show `trailing` (Archive, Delete…), right for `leading`
 * (Bookmark, Done…). A long swipe runs the first action straight away. An open row closes on the next tap
 * anywhere, and the row's own tap doesn't open it then. The actions are also in the row's long-press menu,
 * so nothing depends on swiping (VoiceOver users get them there).
 *
 * The drag runs on Pointer Events with `touch-action: pan-y`: the browser scrolls the list by itself and
 * never waits on a script before a scroll starts, and a sideways drag is ours (the list doesn't scroll).
 */
export function SwipeRow({ children, leading = [], trailing = [], className = "" }: { children: ReactNode; leading?: SwipeAction[]; trailing?: SwipeAction[]; className?: string }) {
  const content = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Past the full-swipe point: the first action stretches across the row, as iOS shows it.
  const [full, setFull] = useState(false);
  // Slid off the row's edge by an action that removes it (1 right, -1 left).
  const [gone, setGone] = useState(0);
  const openRef = useRef(0);
  const actions = useRef({ leading, trailing });
  actions.current = { leading, trailing };
  const life = useRef({ actedAt: -Infinity, goneTimer: 0 });

  const runAction = useCallback((a: SwipeAction, dir: 1 | -1) => {
    const el = row.current;
    const l = life.current;
    l.actedAt = performance.now();
    openRef.current = 0;
    window.clearTimeout(l.goneTimer);
    if (a.removes ?? dir < 0) {
      setGone(dir);
      setFull(true);
      setOffset(dir * (el?.offsetWidth || window.innerWidth));
      l.goneTimer = window.setTimeout(() => {
        setGone(0);
        setFull(false);
        setOffset(0);
      }, GONE_HOLD_MS);
    } else {
      setFull(false);
      setOffset(0);
    }
    if (a.danger) feel("destructive");
    a.onAction();
  }, []);

  // Taken out of its list soon after an action: a stand-in folds away where it was.
  useLayoutEffect(() => {
    const el = row.current;
    const l = life.current;
    return () => {
      window.clearTimeout(l.goneTimer);
      if (el && performance.now() - l.actedAt < ACTED_WINDOW_MS) ghostOut(el);
    };
  }, []);

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    let start: { x: number; y: number; base: number; id: number } | null = null;
    let mode: "x" | "y" | null = null;
    let x = 0;
    let crossed = false;
    const width = () => el.offsetWidth;
    const onCancel = () => {
      if (start) {
        try {
          if (el.hasPointerCapture?.(start.id)) el.releasePointerCapture(start.id);
        } catch {
          // (The pointer is already gone: nothing to release.)
        }
      }
      start = null;
      mode = null;
      crossed = false;
      setDragging(false);
      setFull(false);
      setOffset(openRef.current);
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      // A second finger cancels intent, even beyond the full-swipe threshold.
      if (start) return onCancel();
      start = { x: e.clientX, y: e.clientY, base: openRef.current, id: e.pointerId };
      mode = null;
      crossed = false;
      prepareFeel("threshold");
    };
    const onMove = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!mode) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        mode = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (mode === "y") {
          // The list scrolls (the browser's own pan): this touch is no swipe.
          start = null;
          return;
        }
        setDragging(true);
        try {
          el.setPointerCapture?.(e.pointerId);
        } catch {
          // (A touch the browser has already let go of: the drag still follows it while it lasts.)
        }
      }
      const { leading: l, trailing: r } = actions.current;
      let next = start.base + dx;
      if (next > 0 && !l.length) next = next / 6;
      if (next < 0 && !r.length) next = next / 6;
      x = next;
      setOffset(next);
      // Past the point where a long swipe runs the first action (60 %): felt each time it's crossed.
      const past = pastFullSwipe(next, width()) && (next > 0 ? l.length > 0 : r.length > 0);
      if (past !== crossed) {
        crossed = past;
        setFull(past);
        if (past) feel("threshold");
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      if (mode !== "x") {
        start = null;
        return;
      }
      start = null;
      mode = null;
      setDragging(false);
      // A sideways drag is never a tap on what's under the finger.
      const swallow = (c: Event) => {
        c.preventDefault();
        c.stopPropagation();
      };
      el.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 400);
      const { leading: l, trailing: r } = actions.current;
      const w = width();
      if (pastFullSwipe(x, w) && x > 0 && l[0]) return runAction(l[0], 1);
      if (pastFullSwipe(x, w) && x < 0 && r[0]) return runAction(r[0], -1);
      setFull(false);
      const open = x > 40 && l.length ? l.length * ACTION_W : x < -40 && r.length ? -r.length * ACTION_W : 0;
      openRef.current = open;
      setOffset(open);
      if (open) window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: el }));
    };
    // The browser took the touch (a scroll, a system interruption): the swipe is off.
    const onPointerCancel = (e: PointerEvent) => {
      if (start && e.pointerId === start.id) onCancel();
    };
    const onOtherOpen = (e: Event) => {
      if ((e as CustomEvent).detail === el || !openRef.current) return;
      openRef.current = 0;
      setOffset(0);
    };
    window.addEventListener(OPEN_EVENT, onOtherOpen);
    // All passive: nothing here ever holds up a scroll.
    el.addEventListener("pointerdown", onDown, { passive: true });
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerup", onUp, { passive: true });
    el.addEventListener("pointercancel", onPointerCancel, { passive: true });
    return () => {
      window.removeEventListener(OPEN_EVENT, onOtherOpen);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [runAction]);

  // An open row closes on the next tap anywhere, and as in iOS a tap in its list (on it or another row) does
  // nothing else: it only puts the actions away.
  useEffect(() => {
    if (!offset || dragging || gone) return;
    const close = (e: Event) => {
      if (row.current?.querySelector("[data-swipe-actions]")?.contains(e.target as Node)) return;
      const list = row.current?.closest("ul, ol") ?? row.current;
      if (list?.contains(e.target as Node)) {
        e.preventDefault();
        e.stopPropagation();
      }
      openRef.current = 0;
      setOffset(0);
    };
    document.addEventListener("click", close, true);
    return () => document.removeEventListener("click", close, true);
  }, [offset, dragging, gone]);

  const side = offset > 0 ? leading : offset < 0 ? trailing : [];
  return (
    <div ref={row} className={`relative overflow-hidden ${className}`} style={{ touchAction: "pan-y pinch-zoom" }}>
      {side.length ? (
        <div data-swipe-actions="" className={`absolute inset-y-0 flex ${offset > 0 ? "left-0" : "right-0"}`} style={{ width: Math.abs(offset) }}>
          {(offset > 0 ? side : [...side].reverse()).map((a, i, shownActions) => (
            // (The first action is the outermost one: first on the left, last on the right.)
            <button
              key={a.label}
              type="button"
              tabIndex={-1}
              onClick={() => runAction(a, offset > 0 ? 1 : -1)}
              style={{ background: a.tone, flexGrow: full ? (i === (offset > 0 ? 0 : shownActions.length - 1) ? 1 : 0) : 1, flexBasis: full ? 0 : undefined, transition: dragging ? `flex-grow ${SETTLE.ms}ms ${SETTLE.easing}` : undefined }}
              className={`flex min-w-0 flex-col justify-center gap-1 overflow-hidden px-3 text-footnote font-medium text-white ${full ? (offset > 0 ? "items-end" : "items-start") : "items-center"}`}
            >
              <span aria-hidden className="[&_svg]:h-5 [&_svg]:w-5">{a.icon}</span>
              <span className="truncate">{a.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div ref={content} className="relative bg-canvas" style={{ transform: offset ? `translateX(${offset}px)` : undefined, transition: dragging ? "none" : prefersReducedMotion() ? "transform 150ms ease-out" : gone ? `transform 260ms ${EXIT_EASE}` : `transform ${SETTLE.ms}ms ${SETTLE.easing}` }}>
        {children}
      </div>
    </div>
  );
}
