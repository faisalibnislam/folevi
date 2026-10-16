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
