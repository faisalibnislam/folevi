"use client";

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/**
 * Floats a popup (menu, panel, suggestion list) in the browser's top layer (Popover API), fixed next to its
 * anchor. Nothing can clip or cover it then — not a panel with overflow hidden, not a stacking context, not a
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
      const left = Math.min(Math.max(margin, align === "end" ? a.right - w : a.left), window.innerWidth - w - margin);
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
