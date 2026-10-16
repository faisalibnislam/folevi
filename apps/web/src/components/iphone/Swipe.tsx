"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { haptic } from "@/lib/nativeApp";

export interface SwipeAction {
  label: string;
  icon: ReactNode;
  /** The button's colour (a CSS colour); text and icon are white on it. */
  tone: string;
  onAction: () => void;
}

const ACTION_W = 76;
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

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
      // Past the point where a long swipe runs the first action: a tap in the hand, once.
      const full = Math.abs(next) > width() * 0.55;
      if (full !== crossed) {
        crossed = full;
        if (full) haptic("light");
      }
    };
    const onEnd = () => {
      if (!start || mode !== "x") {
        start = null;
        return;
      }
      start = null;
      setDragging(false);
      const { leading: l, trailing: r } = actions.current;
      const w = width();
      if (x > w * 0.55 && l[0]) return run(l[0]);
      if (x < -w * 0.55 && r[0]) return run(r[0]);
      const open = x > 40 && l.length ? l.length * ACTION_W : x < -40 && r.length ? -r.length * ACTION_W : 0;
      openRef.current = open;
      setOffset(open);
    };
    const run = (a: SwipeAction) => {
      openRef.current = 0;
      setOffset(0);
      a.onAction();
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  // An open row closes on the next tap anywhere (and that tap does nothing else on the row).
  useEffect(() => {
    if (!offset || dragging) return;
    const close = (e: Event) => {
      if (row.current?.querySelector("[data-swipe-actions]")?.contains(e.target as Node)) return;
      if (row.current?.contains(e.target as Node)) {
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
          {(offset > 0 ? side : [...side].reverse()).map((a) => (
            <button
              key={a.label}
              type="button"
              tabIndex={-1}
              onClick={() => {
                openRef.current = 0;
                setOffset(0);
                a.onAction();
              }}
              style={{ background: a.tone, flexGrow: 1 }}
              className="flex min-w-0 flex-col items-center justify-center gap-1 overflow-hidden text-[12px] font-medium text-white"
            >
              <span aria-hidden className="[&_svg]:h-5 [&_svg]:w-5">{a.icon}</span>
              <span className="truncate">{a.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div ref={content} className="relative bg-canvas" style={{ transform: offset ? `translateX(${offset}px)` : undefined, transition: dragging ? "none" : `transform 360ms ${EASE}` }}>
        {children}
      </div>
    </div>
  );
}
