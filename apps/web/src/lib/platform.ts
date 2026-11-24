"use client";

import { useSyncExternalStore } from "react";
import { inAndroidApp, inIosApp, nativeChrome } from "./nativeApp";
import { PHONE_QUERY, TOUCH_QUERY } from "./platformQueries";

export { PHONE_MAX_WIDTH, PHONE_QUERY, TOUCH_QUERY } from "./platformQueries";

// One web app everywhere (docs/claude-context/memory/one-web-app-everywhere-2026-11-24.md): the browser, Folevi
// for Mac, Windows and Linux, the iPhone, iPad, iPhone Duo and Android app, and Folevi Server all show this page.
// Three separate questions decide how it looks, and every layout choice asks this file instead of a user agent:
//
//   formFactor()  phone, tablet or desktop: what layout to draw. Width decides, on every device (the owner,
//                 2026-11-24): a window under 700 px is a phone (the bottom bar), wider ones get the sidebar.
//                 A wide window is a tablet when touch is how it's used, a desktop otherwise.
//   shell()       which app the page is in (the browser, mac, windows, linux, ios, android): only for that app's
//                 own touches (its fonts, wording and accents), never for the layout.
//   os()          the system underneath, also in a browser: how keyboard shortcuts are written (⌘K or Ctrl+K).
//
// The page carries the answers on <html> (data-form, data-shell, data-os, data-touch, data-fold) so CSS asks the
// same questions: lib/theme/bootScript.ts sets them before the first paint and installPlatformMarks keeps them
// current as the window changes.

export type FormFactor = "phone" | "tablet" | "desktop";
export type Shell = "browser" | "mac" | "windows" | "linux" | "ios" | "android";
export type Os = "mac" | "windows" | "linux" | "chromeos" | "ios" | "android" | "other";

const media = (query: string): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;

/** Which app the page is in. Each app marks the page before its first paint (bridge globals or <html> attributes). */
export function shell(): Shell {
  if (typeof document === "undefined") return "browser";
  const root = document.documentElement;
  const desktopApp = root.getAttribute("data-desktop") ?? window.foleviDesktop?.platform;
  if (desktopApp === "mac" || desktopApp === "windows" || desktopApp === "linux") return desktopApp;
  if (inIosApp()) return "ios";
  if (inAndroidApp()) return "android";
  const chrome = nativeChrome()?.platform;
  if (chrome === "macos") return "mac";
  if (chrome === "ios" || chrome === "ipados") return "ios";
  if (chrome === "android") return "android";
  return "browser";
}

/** The system underneath: the app's when the page is in one, else read from the browser. */
export function os(): Os {
  const app = shell();
  if (app !== "browser") return app;
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return "ios";
  // (An iPad's Safari asks for the desktop site and says Macintosh; only its touch screen gives it away.)
  if (/Macintosh/.test(ua)) return navigator.maxTouchPoints > 1 ? "ios" : "mac";
  if (/\bAndroid\b/.test(ua)) return "android";
  if (/\bCrOS\b/.test(ua)) return "chromeos";
  if (/\bWindows\b/.test(ua)) return "windows";
  if (/\bLinux\b/.test(ua)) return "linux";
  return "other";
}

/** Whether the system writes shortcuts with ⌘ (Apple's systems) rather than Ctrl. */
export const usesCommandKey = (): boolean => {
  const o = os();
  return o === "mac" || o === "ios";
};

/**
 * Whether touch is how this window is used: the iPhone, iPad and Android app (a keyboard and trackpad on an iPad
 * keep it a touch device, as iPadOS does), or a browser whose main pointer is a finger.
 */
export function touchPrimary(): boolean {
  const app = shell();
  if (app === "ios" || app === "android") return true;
  if (app !== "browser") return false;
  return media(TOUCH_QUERY);
}

/** Phone, tablet or desktop, from the window's width and how it's used. */
export function formFactor(): FormFactor {
  if (typeof window === "undefined") return "desktop";
  if (media(PHONE_QUERY)) return "phone";
  return touchPrimary() ? "tablet" : "desktop";
}

/**
 * The fold of an iPhone Duo or an Android foldable while it's partly open: where it crosses the window, in CSS
 * pixels, or null when the screen is flat or has no fold. Nothing interactive may sit on it. Chromium reports it
 * (the Viewport Segments API); the iPhone and Android app report it as --folevi-fold-* on <html>.
 */
export interface Fold {
  /** "vertical": the fold runs top to bottom (a book), splitting left from right; "horizontal": a laptop. */
  orientation: "vertical" | "horizontal";
  /** Its start from the window's left (vertical) or top (horizontal) edge, and its width. */
  start: number;
  size: number;
}

export function fold(): Fold | null {
  if (typeof window === "undefined") return null;
  const segments = (window as unknown as { viewport?: { segments?: { x: number; y: number; width: number; height: number }[] | null } }).viewport?.segments;
  const [a, b] = segments ?? [];
  if (segments?.length === 2 && a && b) {
    if (Math.abs(a.y - b.y) < 1) return { orientation: "vertical", start: a.x + a.width, size: Math.max(0, b.x - (a.x + a.width)) };
    return { orientation: "horizontal", start: a.y + a.height, size: Math.max(0, b.y - (a.y + a.height)) };
  }
  const style = getComputedStyle(document.documentElement);
  const orientation = style.getPropertyValue("--folevi-fold-orientation").trim();
  const start = parseFloat(style.getPropertyValue("--folevi-fold-start"));
  const size = parseFloat(style.getPropertyValue("--folevi-fold-size"));
  if ((orientation === "vertical" || orientation === "horizontal") && Number.isFinite(start)) return { orientation, start, size: Number.isFinite(size) ? size : 0 };
  return null;
}

/** Calls `changed` whenever any answer here may have changed (width, pointer, a fold, an app's late mark). */
export function watchPlatform(changed: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const queries = [PHONE_QUERY, TOUCH_QUERY].map((q) => window.matchMedia(q));
  for (const q of queries) q.addEventListener("change", changed);
  // (A fold opening or closing resizes the window; so does an app turning the device.)
  window.addEventListener("resize", changed);
  const attrs = new MutationObserver(changed);
  attrs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-desktop", "data-native", "style"] });
  return () => {
    for (const q of queries) q.removeEventListener("change", changed);
    window.removeEventListener("resize", changed);
    attrs.disconnect();
  };
}

/** The form factor, for rendering: "desktop" on the server, then the window's own, following it as it changes. */
export function useFormFactor(): FormFactor {
  return useSyncExternalStore(watchPlatform, formFactor, () => "desktop");
}

/** The fold, for rendering (compared by value, so a resize that leaves it in place doesn't redraw). */
let lastFold: Fold | null = null;
function foldSnapshot(): Fold | null {
  const next = fold();
  if (next?.orientation === lastFold?.orientation && next?.start === lastFold?.start && next?.size === lastFold?.size) return lastFold;
  lastFold = next;
  return next;
}
export function useFold(): Fold | null {
  return useSyncExternalStore(watchPlatform, foldSnapshot, () => null);
}

/** Writes the answers onto <html> (the boot script wrote the first ones before the first paint). */
export function markPlatform(root: HTMLElement = document.documentElement): void {
  const set = (name: string, value: string | null) => {
    if (value === null) root.removeAttribute(name);
    else if (root.getAttribute(name) !== value) root.setAttribute(name, value);
  };
  set("data-form", formFactor());
  set("data-shell", shell());
  set("data-os", os());
  set("data-touch", touchPrimary() ? "" : null);
  const f = fold();
  set("data-fold", f ? f.orientation : null);
  if (f) {
    root.style.setProperty("--fold-start", `${f.start}px`);
    root.style.setProperty("--fold-size", `${f.size}px`);
  } else {
    root.style.removeProperty("--fold-start");
    root.style.removeProperty("--fold-size");
  }
}

/** Keeps <html>'s marks current for the page's life (Shell installs it once). */
export function installPlatformMarks(): () => void {
  if (typeof document === "undefined") return () => undefined;
  markPlatform();
  let queued = false;
  return watchPlatform(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      markPlatform();
    });
  });
}
