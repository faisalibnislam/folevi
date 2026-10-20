// Which addresses are Folevi's own (they open in the app's windows and may use the bridge) and which open in
// the browser instead.
//
// Two ways to show the app (docs/LOCAL_MODE_PLAN.md §1, WP2):
// - today's default: the website (SERVICE_URL) loaded in the windows;
// - the bundled interface (FOLEVI_SHELL=1 or "bundledShell" in settings.json, see main.ts): the static export
//   built into the app, served from app://folevi (protocol.ts), or from `next dev` with FOLEVI_BUILD=shell at
//   FOLEVI_SHELL_DEV_URL during development. The website stays SERVICE_URL, for sign-in and links.

/** Folevi's website: sign-in in the browser, share links, and the app the windows show by default. */
export const SERVICE_URL = new URL(process.env.FOLEVI_URL ?? "https://app.folevi.com");

/** The bundled interface's own origin (a privileged scheme registered in protocol.ts). */
export const BUNDLED_URL = new URL("app://folevi");

/**
 * The app the windows show: SERVICE_URL until useBundledApp() switches to the bundled interface. A live
 * binding: read it where it's used, never copy it at startup.
 */
export let APP_URL: URL = SERVICE_URL;

/** Whether the windows show the bundled interface (app://folevi or the shell dev server). */
export let bundledApp = false;

/**
 * Switches the windows to the bundled interface: app://folevi, or `devUrl` (next dev with FOLEVI_BUILD=shell)
 * when given. Called once at startup, before any window opens.
 */
export function useBundledApp(devUrl?: string | null): void {
  let dev: URL | null = null;
  try {
    dev = devUrl ? new URL(devUrl) : null;
  } catch {
    dev = null;
  }
  APP_URL = dev && (dev.protocol === "http:" || dev.protocol === "https:") ? new URL(dev.origin) : BUNDLED_URL;
  bundledApp = true;
}

/** Back to the website (tests). */
export function useRemoteApp(): void {
  APP_URL = SERVICE_URL;
  bundledApp = false;
}

/**
 * "scheme://host[:port]" of a URL, or null. Node's URL gives `origin` "null" for schemes it doesn't know
 * (app:), so two different custom-scheme URLs would compare equal by `origin`: this is used instead.
 */
export function originOf(raw: string | URL): string | null {
  try {
    const url = typeof raw === "string" ? new URL(raw) : raw;
    if (!url.host) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** Whether a URL belongs to the app the windows show (same origin as APP_URL). */
export function isAppUrl(raw: string | URL): boolean {
  const origin = originOf(raw);
  return origin !== null && origin === originOf(APP_URL);
}

/** Whether a URL is on Folevi's website (SERVICE_URL). */
export function isServiceUrl(raw: string | URL): boolean {
  const origin = originOf(raw);
  return origin !== null && origin === originOf(SERVICE_URL);
}

/**
 * The product's pages (the first part of the path), as in apps/web/src/lib/app/routes.ts APP_ROUTE_HEADS.
 * A link to one of these on the website opens inside the bundled app; any other website page (sign-in,
 * share links /s/…, pricing, admin) opens in the browser.
 */
const APP_ROUTE_HEADS = new Set([
  "documents", "notes", "d", "ai", "graph", "tasks", "inbox", "calendar", "review", "changes", "daily", "shared", "templates",
  "starred", "archive", "trash", "drafts", "unsorted", "folders", "tags", "settings", "help", "onboarding", "quick-add",
]);

/**
 * Where a link the page follows (or opens in a new window) goes:
 * - "app": one of the app's own pages, shown in the window (`path` is its path, search and hash);
 * - "browser": handed to the default browser (or mail app);
 * - "ignore": nowhere (file:, javascript:, custom schemes).
 * With the bundled interface, a link to a product page on the website (a note link someone pasted) opens in
 * the app; the website's other pages, sign-in among them, open in the browser.
 */
export function linkTarget(raw: string): { kind: "app"; path: string } | { kind: "browser" } | { kind: "ignore" } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "ignore" };
  }
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (isAppUrl(raw)) return { kind: "app", path };
  if (bundledApp && isServiceUrl(raw)) {
    const head = url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (APP_ROUTE_HEADS.has(head)) return { kind: "app", path };
  }
  return isExternalSafe(raw) ? { kind: "browser" } : { kind: "ignore" };
}

/** Whether a link is the end of a Google sign-in in the browser (folevi://auth/google?code=…&state=…). */
export function isSignInReturn(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === `${SCHEME}:` && url.hostname === "auth" && url.pathname === "/google" && raw.length <= 1000;
  } catch {
    return false;
  }
}

/** Where a Google sign-in for the app starts in the browser: Folevi's own /app-google page. */
export function isSignInStart(raw: string): boolean {
  try {
    const url = new URL(raw);
    // Always on the website, whichever app the windows show: the bundled interface signs in there too.
    return isServiceUrl(url) && url.pathname === "/app-google";
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
/** A place's Inbox page: "inbox-" and a hash (packages/editor-schema inboxDocumentId), not a note id. */
const INBOX_ID = /^inbox-[0-9a-z]{1,40}$/;
/** App pages a link may open besides a note (and their sub-pages, like /tasks/today). */
const PAGES = new Set(["documents", "tasks", "calendar", "inbox", "settings", "foli-ai", "trash", "templates", "help"]);

/**
 * A folevi:// link as what it opens, or null when it isn't one Folevi knows: folevi://d/<id> (a note,
 * #block kept, or an Inbox page), folevi://tasks/today, folevi://new (a new note) and folevi://quick-add.
 * Only these shapes pass, so a link can't send the app anywhere else.
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
    const id = rest[0] && INBOX_ID.test(rest[0]) ? rest[0] : rest[0]?.toUpperCase();
    if (!id || !(NOTE_ID.test(id) || INBOX_ID.test(id)) || rest.length > 1) return null;
    // A block ("#block-<id>", where notifications point), a comment thread ("#comment-<id>"), or a bare id.
    const block = /^#((block|comment)-)?[0-9A-Za-z]{1,40}$/.test(url.hash) ? url.hash : "";
    return { type: "open", path: `/d/${id}${block}` };
  }
  if (PAGES.has(first) && rest.length <= 2) return { type: "open", path: `/${[first, ...rest].join("/")}` };
  return null;
}

/** System Settings at Privacy & Security > Screen & System Audio Recording (recording a call needs it). */
export const SCREEN_RECORDING_SETTINGS = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

/**
 * The System Settings address for a pane the page asks to open, or null. Only this exact address is ever
 * opened: the page names a pane, never a URL.
 */
export function systemSettingsUrl(pane: unknown): string | null {
  return pane === "screen-recording" ? SCREEN_RECORDING_SETTINGS : null;
}

/** A file name for a note dragged out of the app: the title without characters Finder refuses. */
export function dragFileName(title: string, ext: "md"): string {
  const base = title.replace(/[\u0000-\u001F\u007F/\\:*?"<>|]+/g, "-").replace(/^\.+/, "").trim().slice(0, 120) || "Untitled";
  return `${base}.${ext}`;
}
