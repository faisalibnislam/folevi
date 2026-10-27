"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { feel, prepareFeel } from "@/lib/native/ui";
import { pastFullSwipe, prefersReducedMotion, SPRINGS, springCss } from "@/lib/native/physics";

export interface SwipeAction {
  label: string;
  icon: ReactNode;
  /** The button's colour (a CSS colour); text and icon are white on it. */
  tone: string;
  onAction: () => void;
  /** Deleting: a warning tap when it runs. */
  danger?: boolean;
}

const ACTION_W = 76;
/** One row open at a time: opening one closes the others. */
const OPEN_EVENT = "folevi:swipe-open";
/** A row settling open or shut, or springing back (§2.4: response 0.3, damping 0.86). */
const SETTLE = springCss(SPRINGS.swipe);

/**
 * A list row with iOS swipe actions: swipe left to show `trailing` (Archive, Delete…), right for `leading`
 * (Star, Done…). A long swipe runs the first action straight away. An open row closes on the next tap
 * anywhere, and the row's own tap doesn't open it then. The actions are also in the row's long-press menu,
 * so nothing depends on swiping (VoiceOver users get them there).
 */
export function SwipeRow({ children, leading = [], trailing = [], className = "" }: { children: ReactNode; leading?: SwipeAction[]; trailing?: SwipeAction[]; className?: string }) {
  const content = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Past the full-swipe point: the first action stretches across the row, as iOS shows it.
  const [full, setFull] = useState(false);
  const openRef = useRef(0);
  const actions = useRef({ leading, trailing });
  actions.current = { leading, trailing };

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    let start: { x: number; y: number; base: number } | null = null;
    let mode: "x" | "y" | null = null;
    let x = 0;
    let crossed = false;
    const width = () => el.offsetWidth;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || e.touches.length > 1) return;
      start = { x: t.clientX, y: t.clientY, base: openRef.current };
      mode = null;
      crossed = false;
      prepareFeel("threshold");
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (!mode) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        mode = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (mode === "x") setDragging(true);
      }
      if (mode !== "x") return;
      if (e.cancelable) e.preventDefault();
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
    const onEnd = () => {
      if (!start || mode !== "x") {
        start = null;
        return;
      }
      start = null;
      setDragging(false);
      setFull(false);
      const { leading: l, trailing: r } = actions.current;
      const w = width();
      if (pastFullSwipe(x, w) && x > 0 && l[0]) return run(l[0]);
      if (pastFullSwipe(x, w) && x < 0 && r[0]) return run(r[0]);
      const open = x > 40 && l.length ? l.length * ACTION_W : x < -40 && r.length ? -r.length * ACTION_W : 0;
      openRef.current = open;
      setOffset(open);
      if (open) window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: el }));
    };
    const run = (a: SwipeAction) => {
      openRef.current = 0;
      setOffset(0);
      if (a.danger) feel("destructive");
      a.onAction();
    };
    const onOtherOpen = (e: Event) => {
      if ((e as CustomEvent).detail === el || !openRef.current) return;
      openRef.current = 0;
      setOffset(0);
    };
    window.addEventListener(OPEN_EVENT, onOtherOpen);
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOtherOpen);
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  // An open row closes on the next tap anywhere, and as in iOS a tap in its list (on it or another row) does
  // nothing else: it only puts the actions away.
  useEffect(() => {
    if (!offset || dragging) return;
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
  }, [offset, dragging]);

  const side = offset > 0 ? leading : offset < 0 ? trailing : [];
  return (
    <div ref={row} className={`relative overflow-hidden ${className}`}>
      {side.length ? (
        <div data-swipe-actions="" className={`absolute inset-y-0 flex ${offset > 0 ? "left-0" : "right-0"}`} style={{ width: Math.abs(offset) }}>
          {(offset > 0 ? side : [...side].reverse()).map((a, i, shownActions) => (
            // (The first action is the outermost one: first on the left, last on the right.)
            <button
              key={a.label}
              type="button"
              tabIndex={-1}
              onClick={() => {
                openRef.current = 0;
                setOffset(0);
                if (a.danger) feel("destructive");
                a.onAction();
              }}
              style={{ background: a.tone, flexGrow: full ? (i === (offset > 0 ? 0 : shownActions.length - 1) ? 1 : 0) : 1, flexBasis: full ? 0 : undefined, transition: dragging ? `flex-grow ${SETTLE.ms}ms ${SETTLE.easing}` : undefined }}
              className={`flex min-w-0 flex-col justify-center gap-1 overflow-hidden px-3 text-footnote font-medium text-white ${full ? (offset > 0 ? "items-end" : "items-start") : "items-center"}`}
            >
              <span aria-hidden className="[&_svg]:h-5 [&_svg]:w-5">{a.icon}</span>
              <span className="truncate">{a.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div ref={content} className="relative bg-canvas" style={{ transform: offset ? `translateX(${offset}px)` : undefined, transition: dragging ? "none" : prefersReducedMotion() ? "transform 150ms ease-out" : `transform ${SETTLE.ms}ms ${SETTLE.easing}` }}>
        {children}
      </div>
    </div>
  );
}
