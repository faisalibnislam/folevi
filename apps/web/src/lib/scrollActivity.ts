"use client";
// Marks an area while it scrolls (`data-scrolling`, for 900 ms after its last scroll), so globals.css shows its thin
// scroll bar knob only then (and under the pointer). One listener for the whole page, capturing every scroll.
import { useEffect } from "react";

export function useScrollActivity() {
  useEffect(() => {
    const timers = new WeakMap<Element, number>();
    const onScroll = (e: Event) => {
      const el = e.target === document ? document.documentElement : e.target;
      if (!(el instanceof Element)) return;
      if (!el.hasAttribute("data-scrolling")) el.setAttribute("data-scrolling", "");
      window.clearTimeout(timers.get(el));
      timers.set(el, window.setTimeout(() => el.removeAttribute("data-scrolling"), 900));
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, []);
}
