"use client";

import { useEffect } from "react";

/**
 * Keeps `--kb-inset` on the root element at how much of the window the on-screen keyboard covers (iOS
 * shrinks the visual viewport, not the window), so things docked at the bottom can sit above it.
 */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty("--kb-inset", `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`);
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.removeProperty("--kb-inset");
    };
  }, []);
}

/** The bottom edge of what's visible (above the on-screen keyboard), for clamping popovers. */
export function visibleBottom(): number {
  const vv = window.visualViewport;
  return vv ? vv.offsetTop + vv.height : window.innerHeight;
}
