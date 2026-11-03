"use client";

import { useEffect, type RefObject } from "react";

/**
 * A block wider than the note (a table, a long formula) scrolls sideways inside itself. This marks the
 * scroller while there's more to see on either side (`data-more-start`, `data-more-end`), so a soft fade
 * on that edge says so (editor.css, `.fb-hscroll`); the page itself never scrolls sideways.
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const mark = () => {
      frame = 0;
      const room = el.scrollWidth - el.clientWidth;
      const left = Math.abs(el.scrollLeft);
      el.toggleAttribute("data-more-start", room > 1 && left > 1);
      el.toggleAttribute("data-more-end", room > 1 && left < room - 1);
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(mark);
    };
    mark();
    el.addEventListener("scroll", later, { passive: true });
    const size = new ResizeObserver(later);
    size.observe(el);
    if (el.firstElementChild) size.observe(el.firstElementChild);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", later);
      size.disconnect();
    };
  }, [ref]);
}

/** ProseMirror's own margin around the caret when it scrolls it into view. */
const CARET_MARGIN = 5;
let dockClearance = 0;

/**
 * How far the floating page tools (PageDock) reach up into the note's scroller, gap included, while they're
 * shown (0 otherwise). PageDock keeps it up to date.
 */
export function setDockClearance(px: number) {
  dockClearance = Math.max(0, px);
}

/**
 * The editor's scrollMargin and scrollThreshold: a caret that would sit under the floating page tools counts
 * as out of view and is scrolled up to just above them. Getters, so ProseMirror reads where the bar is now.
 */
export const DOCK_SCROLL_MARGIN = {
  top: CARET_MARGIN,
  left: CARET_MARGIN,
  right: CARET_MARGIN,
  get bottom() {
    return CARET_MARGIN + dockClearance;
  },
};
export const DOCK_SCROLL_THRESHOLD = {
  top: 0,
  left: 0,
  right: 0,
  get bottom() {
    return dockClearance;
  },
};
