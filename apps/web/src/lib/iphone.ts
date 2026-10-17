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

/**
 * How round this iPhone's screen corners are, in points (Apple doesn't expose it to web pages, but every
 * iPhone screen size has one radius), or null where it isn't known (an iPad, or a size not listed yet).
 * What floats near the screen's edge (a sheet's bottom corners) follows it, so the curves run parallel.
 */
export function displayCornerRadius(): number | null {
  if (typeof screen === "undefined" || isIpadApp()) return null;
  const w = Math.min(screen.width, screen.height);
  const h = Math.max(screen.width, screen.height);
  const sizes: Record<string, number> = {
    "375x812": 39, // X, XS, 11 Pro (12 and 13 mini: 44)
    "414x896": 40, // XR, XS Max, 11, 11 Pro Max
    "390x844": 47.33, // 12, 13, 14, 16e
    "428x926": 53.33, // 12 Pro Max, 13 Pro Max, 14 Plus
    "393x852": 55, // 14 Pro, 15, 15 Pro, 16
    "430x932": 55, // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
    "420x912": 62, // Air
    "402x874": 62, // 16 Pro, 17, 17 Pro and later
    "440x956": 62, // 16 Pro Max, 17 Pro Max and later
  };
  return sizes[`${w}x${h}`] ?? null;
}

/** Whether this page shows the iPhone app's interface (the iPhone app, or the iPad app in a compact window). */
export function isIphoneApp(): boolean {
  if (typeof navigator === "undefined" || !inIosApp()) return false;
  if (/\b(iPhone|iPod)\b/.test(navigator.userAgent)) return true;
  return isIpadApp() && typeof window.matchMedia === "function" && window.matchMedia(IPAD_COMPACT).matches;
}

const followWidth = (changed: () => void) => {
  // (Only the iPad app's width can change which interface shows.)
  if (typeof window === "undefined" || typeof window.matchMedia !== "function" || !isIpadApp()) return () => undefined;
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
