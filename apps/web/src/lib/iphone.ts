"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { inAndroidApp, inIosApp, nativeChrome } from "./nativeApp";
import { formFactor, PHONE_QUERY, watchPlatform } from "./platform";

// The phone interface (components/iphone): a navigation stack with large titles, a floating glass tab bar, bottom
// sheets. Width decides, on every device (the owner, 2026-11-24; lib/platform.ts): any window under 700 px shows it
// (a phone's browser, the iPhone and Android app, a folded iPhone Duo, iPad Slide Over, a narrow window on a
// computer), and wider windows get the sidebar layout, switching in place as the window changes. Never the device
// model: an open iPhone Duo is an iPhone 951 pt wide, and takes the tablet layout.
//
// An iPhone's web view says "iPhone" in its user agent in portrait and landscape; on an iPad the app asks for
// the desktop site (preferredContentMode "recommended"), so its web view reports a Mac with a touch screen.

/** An iPad window narrower than this is compact: the sidebar and a note don't both fit. */
const IPAD_COMPACT = PHONE_QUERY;

/**
 * iPhone Duo: the iPhone app shows the iPad's wide layout while the phone is open (any iPhone window of regular width)
 * and the phone's when it's closed. The app says which on the marker (`wide`, RebuildPageLayout in the iOS app) and
 * fires this event when it changes; undefined everywhere else (the iPad's page measures its own width).
 */
const NATIVE_LAYOUT_EVENT = "folevi-native-layout";

function nativeWide(): boolean | undefined {
  const wide = (nativeChrome() as { wide?: unknown } | null)?.wide;
  return typeof wide === "boolean" ? wide : undefined;
}

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
    "466x678": 62, // iPhone Duo's outer screen (estimated: Apple doesn't give it, so the 17 Pro's)
  };
  return sizes[`${w}x${h}`] ?? null;
}

/**
 * Whether this page shows the phone interface: any window under 700 px (lib/platform.ts formFactor). The native
 * apps' native chrome mode (the native iPhone and Android apps of 1.5.x, still installed) keeps its own rule:
 * the note page of the native iPhone app is always the phone's. iOS-only touches (glass, Face ID copy) check
 * inIosApp() themselves.
 */
export function isIphoneApp(): boolean {
  if (typeof navigator === "undefined") return false;
  const marker = nativeChrome();
  // Native chrome mode on an iPhone (the app's word on an iPhone Duo, `wide`) or an Android phone.
  if (marker) {
    if (marker.platform === "ios") return nativeWide() !== true;
    return marker.platform === "android" && typeof window.matchMedia === "function" && window.matchMedia(IPAD_COMPACT).matches;
  }
  return formFactor() === "phone";
}

/** The same question by its platform-neutral name (the iPhone and Android apps share the phone interface). */
export const isNativePhone = (): boolean => isIphoneApp();

const followWidth = (changed: () => void) => {
  // (Width, pointer and fold can all change which interface shows: a resized window, an unfolded Duo; so can the
  // native iPhone Duo app's word in native chrome mode.)
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(NATIVE_LAYOUT_EVENT, changed);
  const stop = watchPlatform(changed);
  return () => {
    window.removeEventListener(NATIVE_LAYOUT_EVENT, changed);
    stop();
  };
};

/** The same, for rendering: false on the server; it follows the window's width. */
export function useIphoneApp(): boolean {
  return useSyncExternalStore(followWidth, isIphoneApp, () => false);
}

/**
 * Whether this page shows the tablet layout: a window wide enough for the sidebar on a device used by touch (the
 * iPad app, the Android app on a tablet or an open foldable, a tablet's browser). Shell marks <html data-tablet>
 * (and data-ipad on Apple's), and globals.css draws the touch look: 44 pt rows, the tab strip as touch tabs, no
 * keyboard hints until a keyboard is used. False on the server, and while the window is a phone's.
 */
export function isIpadLayout(): boolean {
  if (nativeChrome()) return isIpadApp() && !isIphoneApp();
  return formFactor() === "tablet";
}

/** The same, for rendering. */
export function useIpadLayout(): boolean {
  return useSyncExternalStore(followWidth, isIpadLayout, () => false);
}

/** The same by its platform-neutral name. */
export const useTabletLayout = useIpadLayout;
export const isTabletLayout = isIpadLayout;

/**
 * Whether this page is the note page of the native iPad app's wide layout (native chrome mode, `ipados`, a window
 * wide enough for the sidebar). Its native frame draws the window, sidebar and tabs but no note tools, so the page
 * keeps the web's floating dock (Insert, Format, Style, Comments, Share and the note's "…"), as Folevi for Mac does.
 * Under 700 pt the iPad shows the phone's layout, whose native bars carry those tools instead. iPhone Duo open is the
 * same layout, on the app's word (`nativeWide`).
 */
export function isIpadNativeWide(): boolean {
  if (typeof window === "undefined") return false;
  const told = nativeWide();
  if (told !== undefined) return told;
  if (nativeChrome()?.platform !== "ipados") return false;
  return !(typeof window.matchMedia === "function" && window.matchMedia(IPAD_COMPACT).matches);
}

const followIpadNativeWidth = (changed: () => void) => {
  if (typeof window === "undefined" || !nativeChrome()) return () => undefined;
  window.addEventListener(NATIVE_LAYOUT_EVENT, changed);
  const mq = typeof window.matchMedia === "function" && nativeChrome()?.platform === "ipados" ? window.matchMedia(IPAD_COMPACT) : null;
  mq?.addEventListener("change", changed);
  return () => {
    window.removeEventListener(NATIVE_LAYOUT_EVENT, changed);
    mq?.removeEventListener("change", changed);
  };
};

/** The same, for rendering: it follows the window's width. */
export function useIpadNativeWide(): boolean {
  return useSyncExternalStore(followIpadNativeWidth, isIpadNativeWide, () => false);
}

/**
 * iPhone Duo open across: iOS puts the toolbar in a column at the side of the screen, and the note's tools (Foli AI,
 * Insert, Format, Style, Share, the note's "…") are iOS's toolbar items in that column, as they are when the phone is
 * closed. The app says so on the marker (`sideTools`, RebuildPageLayout) and the page drops its floating dock.
 */
export function isNativeSideTools(): boolean {
  if (typeof window === "undefined") return false;
  return (nativeChrome() as { sideTools?: unknown } | null)?.sideTools === true;
}

/** The same, for rendering: it follows the app's word as the phone opens, folds and turns. */
export function useNativeSideTools(): boolean {
  return useSyncExternalStore(followIpadNativeWidth, isNativeSideTools, () => false);
}

/**
 * Settings on the iPad draws its sections as the iPhone's grouped lists (iOS polish WP5): inside it, this says so.
 * Only the settings sections read it (useIphoneLook), so dialogs, menus and the shell keep the iPad's own.
 */
export const IphoneLookContext = createContext(false);

/** Whether a settings section draws its iPhone look: the iPhone app, or Settings on the iPad. */
export function useIphoneLook(): boolean {
  const forced = useContext(IphoneLookContext);
  return useIphoneApp() || forced;
}

/**
 * How far the status bar and the home indicator reach into the page, in the iPhone app (0 elsewhere): menus
 * placed by script stay clear of them. Also the sides: a closed iPhone Duo's status bar runs down the outer
 * screen's right edge, and a phone turned on its side has the camera housing at one.
 */
/**
 * The screen's side insets in the apps, in any layout (safeInsets() answers only in the phone layout): what a
 * status bar standing on its side takes, as the iPhone Duo's does on the right, 84 pt open. Zero on the web.
 */
export function sideInsets(): { left: number; right: number } {
  if (typeof document === "undefined" || (!inIosApp() && !inAndroidApp())) return { left: 0, right: 0 };
  const probe = document.createElement("div");
  probe.style.cssText = inAndroidApp()
    ? "position:fixed;top:0;height:0;left:var(--android-inset-left,0px);right:var(--android-inset-right,0px);visibility:hidden;pointer-events:none"
    : "position:fixed;top:0;height:0;left:env(safe-area-inset-left);right:env(safe-area-inset-right);visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const r = probe.getBoundingClientRect();
  probe.remove();
  return { left: r.left, right: Math.max(0, window.innerWidth - r.right) };
}

export function safeInsets(): { top: number; bottom: number; left: number; right: number } {
  if (typeof document === "undefined" || !isIphoneApp()) return { top: 0, bottom: 0, left: 0, right: 0 };
  const probe = document.createElement("div");
  // (The Android app gives its insets as --android-inset-*: older WebViews leave env() at 0.)
  probe.style.cssText = inAndroidApp()
    ? "position:fixed;left:var(--android-inset-left,0px);right:var(--android-inset-right,0px);top:var(--android-inset-top,0px);bottom:var(--android-inset-bottom,0px);visibility:hidden;pointer-events:none"
    : "position:fixed;left:env(safe-area-inset-left);right:env(safe-area-inset-right);top:env(safe-area-inset-top);bottom:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const r = probe.getBoundingClientRect();
  probe.remove();
  return { top: r.top, bottom: Math.max(0, window.innerHeight - r.bottom), left: r.left, right: Math.max(0, window.innerWidth - r.right) };
}
