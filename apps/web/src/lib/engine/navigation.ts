// Navigation in native chrome mode (docs/NATIVE_APP_PLAN.md sections 4.2 and 8, "Links"): native owns the
// screens and their history, so the page never moves by itself. A link inside a note, or anything else that would
// navigate (a menu's "Open", window.open), becomes a `navigate.request` for native to act on; only the engine moves
// the page (always replacing the history entry, so the web history stays one entry).
import { bridgeListening, emitNoteEvent } from "./noteHost";
import type { NavigateRequestEvent } from "./protocol";

/** The request for `href` (an app path or a URL), as native receives it. */
export function navigationRequest(href: string, o: { newTab?: boolean } = {}): NavigateRequestEvent {
  const base = typeof window !== "undefined" ? window.location.href : "https://app.folevi.com/";
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return { route: href, noteId: null, external: true, newTab: Boolean(o.newTab) };
  }
  const external = url.origin !== new URL(base).origin;
  const route = external ? url.href : `${url.pathname}${url.search}${url.hash}`;
  const m = external ? null : /^\/d\/([^/?#]+)/.exec(url.pathname);
  return { route, noteId: m ? decodeURIComponent(m[1]!) : null, external, newTab: Boolean(o.newTab) };
}

/** Asks native to open `href`; false when no native host listens (the caller navigates as usual then). */
export function requestNavigation(href: string, o: { newTab?: boolean } = {}): boolean {
  if (!bridgeListening()) return false;
  emitNoteEvent("navigate.request", navigationRequest(href, o));
  return true;
}

/** In native chrome mode, window.open asks native instead of opening a window the web view can't show. */
export function routeWindowOpen(): void {
  if (typeof window === "undefined") return;
  const original = window.open.bind(window);
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    if (url !== undefined && requestNavigation(String(url), { newTab: true })) return null;
    return original(url, target, features);
  }) as typeof window.open;
}
