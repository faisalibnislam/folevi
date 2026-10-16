"use client";

import { useSyncExternalStore } from "react";
import { inIosApp } from "./nativeApp";

// The iPhone app's own interface (components/iphone): a navigation stack with large titles, a floating glass
// tab bar, bottom sheets. Only inside the iOS app (data-native="ios") and only on an iPhone: the app on an
// iPad keeps the sidebar layout, and a phone's browser keeps the mobile web layout. Nothing else changes.
//
// An iPhone's web view says "iPhone" in its user agent in portrait and landscape; on an iPad the app asks for
// the desktop site (preferredContentMode "recommended"), so its web view reports a Mac.

/** Whether this page is the iPhone app (not the iPad app, not a browser). */
export function isIphoneApp(): boolean {
  if (typeof navigator === "undefined") return false;
  return inIosApp() && /\b(iPhone|iPod)\b/.test(navigator.userAgent);
}

const noop = () => () => undefined;

/** The same, for rendering: false on the server, then fixed for the life of the page. */
export function useIphoneApp(): boolean {
  return useSyncExternalStore(noop, isIphoneApp, () => false);
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
