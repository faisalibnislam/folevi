"use client";
// Folevi for Mac's page-side polish (docs/MAC_POLISH_PLAN.md §2.4, §2.5, §3.7): keyboard-only focus rings
// (data-input) and one tooltip everywhere. (The key window and full screen, data-window-active and
// data-fullscreen, come from the app: apps/mac/Folevi/Chrome/chrome-page.js.) The looks they drive are the "Mac polish" block in globals.css. Mounted at the product's root and the built-in
// interface's; does nothing outside the Mac app (the website keeps the browser's behaviour). Mounting it twice
// installs once.
import { useEffect } from "react";
import { inMacApp, installMacInputModality } from "@/lib/desktop/mac";
import { installMacTooltips } from "@/lib/desktop/tooltip";

let mounted = 0;
let stop: (() => void) | null = null;

export function MacPolish() {
  useEffect(() => {
    if (!inMacApp()) return;
    mounted += 1;
    if (mounted === 1) {
      const parts = [installMacInputModality(), installMacTooltips()];
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
