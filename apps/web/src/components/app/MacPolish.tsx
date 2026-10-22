"use client";
// Folevi for Mac's page-side polish (docs/MAC_POLISH_PLAN.md §2.4, §2.5, §3.3, §3.7): keyboard-only focus rings
// (data-input), the key window (data-window-active), full screen (data-fullscreen) and one tooltip everywhere. The
// looks they drive are the "Mac polish" block in globals.css. Mounted at the product's root and the built-in
// interface's; does nothing outside the Mac app (the website keeps the browser's behaviour). Mounting it twice
// installs once.
import { useEffect } from "react";
import { inMacApp, inMacWebKit, installFullscreen, installMacInputModality, installWindowActive } from "@/lib/desktop/mac";
import { installMacTooltips } from "@/lib/desktop/tooltip";

let mounted = 0;
let stop: (() => void) | null = null;

export function MacPolish() {
  useEffect(() => {
    if (!inMacApp()) return;
    mounted += 1;
    if (mounted === 1) {
      // (The native app keeps the window's state itself, from AppKit; Electron leaves it to the page.)
      const parts = [installMacInputModality(), installMacTooltips(), ...(inMacWebKit() ? [] : [installWindowActive(), installFullscreen()])];
      stop = () => parts.forEach((p) => p());
    }
    return () => {
      mounted -= 1;
      if (mounted === 0) {
        stop?.();
        stop = null;
      }
    };
  }, []);
  return null;
}
