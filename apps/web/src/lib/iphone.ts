"use client";

import { useSyncExternalStore } from "react";
import { inIosApp } from "./nativeApp";

// The iPhone app's own interface (components/iphone): a navigation stack with large titles, a floating glass
// tab bar, bottom sheets. Only inside the iOS app (data-native="ios"), on an iPhone, or on an iPad in a
// window too narrow for the sidebar (Slide Over, a third of Split View, a small Stage Manager window): there
// the iPad app takes the same compact interface, as iPad apps do in a compact-width window, and goes back to
// the sidebar layout when the window widens. A phone's browser keeps the mobile web layout. Nothing else
// changes.
//
// An iPhone's web view says "iPhone" in its user agent in portrait and landscape; on an iPad the app asks for
// the desktop site (preferredContentMode "recommended"), so its web view reports a Mac with a touch screen.

/** An iPad window narrower than this is compact: the sidebar and a note don't both fit. */
const IPAD_COMPACT = "(max-width: 699px)";

/** Whether this page is the iPad app (its web view reports a Mac with a touch screen). */
export function isIpadApp(): boolean {
  if (typeof navigator === "undefined" || !inIosApp() || /\b(iPhone|iPod)\b/.test(navigator.userAgent)) return false;
  return /\biPad\b/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/** Whether this page shows the iPhone app's interface (the iPhone app, or the iPad app in a compact window). */
export function isIphoneApp(): boolean {
  if (typeof navigator === "undefined" || !inIosApp()) return false;
  if (/\b(iPhone|iPod)\b/.test(navigator.userAgent)) return true;
  return isIpadApp() && window.matchMedia(IPAD_COMPACT).matches;
}

const followWidth = (changed: () => void) => {
  if (typeof window === "undefined") return () => undefined;
  const mq = window.matchMedia(IPAD_COMPACT);
  mq.addEventListener("change", changed);
  return () => mq.removeEventListener("change", changed);
};

/** The same, for rendering: false on the server; on an iPad it follows the window's width. */
export function useIphoneApp(): boolean {
  return useSyncExternalStore(followWidth, isIphoneApp, () => false);
}

/**
 * How far the status bar and the home indicator reach into the page, in the iPhone app (0 elsewhere): menus
 * placed by script stay clear of them.
 */
export function safeInsets(): { top: number; bottom: number } {
  if (typeof document === "undefined" || !isIphoneApp()) return { top: 0, bottom: 0 };
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:0;top:env(safe-area-inset-top);bottom:env(safe-area-inset-bottom);width:0;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const r = probe.getBoundingClientRect();
  probe.remove();
  return { top: r.top, bottom: Math.max(0, window.innerHeight - r.bottom) };
}
