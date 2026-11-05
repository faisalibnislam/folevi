"use client";

import { useEffect, useState } from "react";

/**
 * An element's width (its content box, in CSS pixels) as it changes; 0 until it's measured. Takes the element
 * itself (from a callback ref kept in state), so an element that mounts later is still measured.
 */
export function useElementWidth(el: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [el]);
  return width;
}
