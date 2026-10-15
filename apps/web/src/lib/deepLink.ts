// folevi:// links (Shortcuts, Raycast, a link in a document) as what they open. The Mac app reads them in its
// main process (apps/desktop/src/urls.ts, parseDeepLink); the iPhone and iPad app hands them to the page,
// which reads them here. Both accept exactly the same links (deepLink.test.ts checks the two agree).

export type DeepLink = { type: "open"; path: string } | { type: "new-note" } | { type: "quick-add" };

const SCHEME = "folevi";
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
  let parts: string[];
  try {
    parts = [url.hostname, ...url.pathname.split("/")].filter(Boolean).map((p) => decodeURIComponent(p));
  } catch {
    return null;
  }
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
