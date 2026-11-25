"use client";

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";
import { safeInsets } from "@/lib/iphone";
import { fold } from "@/lib/platform";

/**
 * Where across the window a popup beside `anchor` may sit, and `clamp(left, width)` to keep it there: `margin`
 * in from the window's sides and clear of the iPhone app's side insets (a closed iPhone Duo's status bar runs
 * down the right edge). While the window is folded down the middle, on the anchor's side of the fold, as
 * nothing interactive may sit on it: its right edge before the fold for an anchor left of it, its left edge
 * past the fold otherwise.
 */
export function popupSpan(anchor: { left: number; right: number }, margin = 8): { min: number; max: number; clamp: (left: number, width: number) => number } {
  const safe = safeInsets();
  let min = margin + safe.left;
  let max = window.innerWidth - margin - safe.right;
  const f = fold();
  let pastFold = false;
  if (f?.orientation === "vertical") {
    if ((anchor.left + anchor.right) / 2 < f.start + f.size / 2) max = Math.min(max, f.start - margin);
    else {
      min = Math.max(min, f.start + f.size + margin);
      pastFold = true;
    }
  }
  // (Too wide for its side: the edge facing the fold wins, so the popup never crosses it.)
  const clamp = pastFold ? (left: number, width: number) => Math.max(min, Math.min(left, max - width)) : (left: number, width: number) => Math.min(Math.max(min, left), max - width);
  return { min, max, clamp };
}

/**
 * Floats a popup (menu, panel, suggestion list) in the browser's top layer (Popover API), fixed next to its
 * anchor. Nothing can clip or cover it then: not a panel with overflow hidden, not a stacking context, not a
 * sibling with a higher z-index. It flips above/below and shifts to stay in the window, and follows the
 * anchor on scroll and resize. The popup element needs `popover="manual"`, and spreads the returned style.
 */
export function useTopLayer(
  open: boolean,
  popup: RefObject<HTMLElement | null>,
  anchor: RefObject<HTMLElement | null>,
  { align = "start", side = "bottom", gap = 6, matchWidth = false }: { align?: "start" | "end"; side?: "bottom" | "top"; gap?: number; matchWidth?: boolean } = {},
): CSSProperties {
  const [pos, setPos] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const el = popup.current;
    try {
      if (el && !el.matches(":popover-open")) el.showPopover();
    } catch {
      /* Popover API missing: it still renders, positioned fixed. */
    }
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const p = popup.current;
      if (!a || !p) return;
      const margin = 8;
      const w = matchWidth ? a.width : p.offsetWidth;
      const h = p.offsetHeight;
      const below = window.innerHeight - a.bottom - gap - margin;
      const above = a.top - gap - margin;
      const up = side === "top" ? !(above < h && below > above) : below < h && above > below;
      const left = popupSpan(a, margin).clamp(align === "end" ? a.right - w : a.left, w);
      const top = Math.min(Math.max(margin, up ? a.top - gap - h : a.bottom + gap), window.innerHeight - h - margin);
      setPos({ left, top, width: matchWidth ? w : undefined });
    };
    place();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    if (popup.current) ro?.observe(popup.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, popup, anchor, align, side, gap, matchWidth]);
  return { position: "fixed", margin: 0, right: "auto", bottom: "auto", ...(pos ?? { left: 0, top: 0, visibility: "hidden" }) };
}

/** Shows an already-positioned fixed popup in the top layer while it's mounted (for self-positioning popups). */
export function useShowInTopLayer(open: boolean, popup: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = popup.current;
    if (!open || !el) return;
    try {
      if (!el.matches(":popover-open")) el.showPopover();
    } catch {
      /* Popover API missing: it still renders, positioned fixed. */
    }
  }, [open, popup]);
}
