// Which addresses are Folevi's own (they open in the app's windows and may use the bridge) and which open in
// the browser instead.

/** The web app the windows show: production, unless FOLEVI_URL points somewhere else (the local dev server). */
export const APP_URL = new URL(process.env.FOLEVI_URL ?? "https://app.folevi.com");

/** Whether a URL belongs to the app the windows show (same origin as APP_URL). */
export function isAppUrl(raw: string): boolean {
  try {
    return new URL(raw).origin === APP_URL.origin;
  } catch {
    return false;
  }
}

/** A path inside the app ("/d/01…") as a full URL; anything that isn't a plain path falls back to the start page. */
export function appUrl(path = "/"): string {
  const safe = typeof path === "string" && path.startsWith("/") && !path.startsWith("//") ? path : "/";
  return new URL(safe, APP_URL).toString();
}

/** Links that are fine to hand to the browser or mail app (never file:, javascript: or custom schemes). */
export function isExternalSafe(raw: string): boolean {
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(raw).protocol);
  } catch {
    return false;
  }
}

/** The scheme other apps (Shortcuts, Raycast, a link in a document) use to open Folevi: folevi://d/<id>. */
export const SCHEME = "folevi";

/** What a folevi:// link asks for. */
export type DeepLink = { type: "open"; path: string } | { type: "new-note" } | { type: "quick-add" };

const NOTE_ID = /^[0-9A-Z]{26}$/;
/** App pages a link may open besides a note (and their sub-pages, like /tasks/today). */
const PAGES = new Set(["documents", "tasks", "calendar", "inbox", "settings", "foli-ai", "trash", "templates", "help"]);

/**
 * A folevi:// link as what it opens, or null when it isn't one Folevi knows: folevi://d/<id> (a note,
 * #block kept), folevi://tasks/today, folevi://new (a new note) and folevi://quick-add. Only these shapes
 * pass, so a link can't send the app anywhere else.
 */
export function parseDeepLink(raw: string): DeepLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${SCHEME}:` || raw.length > 600) return null;
  // folevi://d/ID puts "d" in the host; folevi:/d/ID and folevi:///d/ID put it in the path.
  const parts = [url.hostname, ...url.pathname.split("/")].filter(Boolean).map((p) => decodeURIComponent(p));
  if (parts.some((p) => !/^[A-Za-z0-9_-]{1,64}$/.test(p))) return null;
  const [first, ...rest] = parts;
  if (!first) return { type: "open", path: "/documents" };
  if (first === "new" && !rest.length) return { type: "new-note" };
  if (first === "quick-add" && !rest.length) return { type: "quick-add" };
  if (first === "d") {
    const id = rest[0]?.toUpperCase();
    if (!id || !NOTE_ID.test(id) || rest.length > 1) return null;
    const block = /^#[0-9A-Za-z]{1,40}$/.test(url.hash) ? url.hash : "";
    return { type: "open", path: `/d/${id}${block}` };
  }
  if (PAGES.has(first) && rest.length <= 2) return { type: "open", path: `/${[first, ...rest].join("/")}` };
  return null;
}

/** A file name for a note dragged out of the app: the title without characters Finder refuses. */
export function dragFileName(title: string, ext: "md"): string {
  const base = title.replace(/[\u0000-\u001F\u007F/\\:*?"<>|]+/g, "-").replace(/^\.+/, "").trim().slice(0, 120) || "Untitled";
  return `${base}.${ext}`;
}
