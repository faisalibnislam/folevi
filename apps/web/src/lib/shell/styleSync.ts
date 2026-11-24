// Note styles kept up to date in the apps (the owner, 2026-11-24: "keep inside the app and sync if server side
// changes the note styles"; docs/MOBILE.md "Note styles and covers"). The build's snapshot (snapshot.ts) ships in
// every app and stays the offline fallback; when online, the app asks Folevi once per launch for the current
// styles (GET <deployment>.convex.site/note-styles, convex/http.ts) and keeps any new or changed one, with its
// images, in Cache Storage. Whichever of the bundled and the kept copy is newer (each style's updatedAt) wins.
//
// The request is anonymous and read-only: no cookie, no referrer, nothing about the person or their notes. Local
// mode ("Keep notes on my devices") is allowed exactly this request and the images it links (the owner's choice).
// The kept images are handed to the page as blob: URLs, which work offline in every web view (an app's
// capacitor:// page has no service worker to answer the image's own address).
import type { ThemeRow } from "@/lib/themes";

const CACHE = "folevi-note-styles-v1";
/** Where the kept rows sit in the cache (a made-up address on the page's own origin, never fetched). */
const ROWS_KEY = "/__folevi/note-styles.json";
const SIZES = ["full", "half", "thumb"] as const;

/** The styles' address on this build's deployment (convex.site), or null when the build has none. */
export function noteStylesUrl(): string | null {
  const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL || (process.env.NEXT_PUBLIC_CONVEX_URL ?? "").replace(/\.convex\.cloud\b/, ".convex.site");
  return site ? `${site.replace(/\/$/, "")}/note-styles` : null;
}

/** Each key's newer row (by updatedAt) of the two lists, in the admins' order. */
export function mergeStyles(bundled: readonly ThemeRow[], kept: readonly ThemeRow[]): ThemeRow[] {
  const byKey = new Map<string, ThemeRow>();
  for (const row of bundled) byKey.set(row.key, row);
  for (const row of kept) {
    const had = byKey.get(row.key);
    if (!had || row.updatedAt > had.updatedAt) byKey.set(row.key, row);
  }
  return [...byKey.values()].sort((a, b) => a.order - b.order);
}

const imageUrls = (row: ThemeRow): string[] => (row.image ? SIZES.map((s) => row.image![s]).filter((u): u is string => Boolean(u)) : []);

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === "undefined" ? null : await caches.open(CACHE);
  } catch {
    return null;
  }
}

async function keptRows(cache: Cache): Promise<ThemeRow[]> {
  try {
    const res = await cache.match(ROWS_KEY);
    const rows = res ? ((await res.json()) as unknown) : [];
    return Array.isArray(rows) ? (rows as ThemeRow[]) : [];
  } catch {
    return [];
  }
}

/**
 * Asks Folevi for the current styles and keeps the new or changed ones (and their images) on this device. Answers
 * how many styles changed, or null when it couldn't ask (offline, no cache, no deployment). A style whose images
 * didn't all arrive keeps its older copy, so a half-downloaded style never shows.
 */
export async function syncNoteStyles(fetchImpl: typeof fetch = fetch): Promise<number | null> {
  const url = noteStylesUrl();
  const cache = await openCache();
  if (!url || !cache) return null;
  let rows: ThemeRow[];
  try {
    const res = await fetchImpl(url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: number; themes?: unknown };
    if (body.version !== 1 || !Array.isArray(body.themes)) return null;
    rows = body.themes as ThemeRow[];
  } catch {
    return null;
  }
  const before = new Map((await keptRows(cache)).map((r) => [r.key, r]));
  const next: ThemeRow[] = [];
  let changed = 0;
  for (const row of rows) {
    const had = before.get(row.key);
    if (had && had.updatedAt >= row.updatedAt) {
      next.push(had);
      continue;
    }
    try {
      for (const image of imageUrls(row)) {
        if (await cache.match(image)) continue;
        const res = await fetchImpl(image, { credentials: "omit", referrerPolicy: "no-referrer" });
        if (!res.ok) throw new Error(`${res.status}`);
        await cache.put(image, res);
      }
      next.push(row);
      changed++;
    } catch {
      if (had) next.push(had);
    }
  }
  await cache.put(ROWS_KEY, new Response(JSON.stringify(next), { headers: { "Content-Type": "application/json" } }));
  // Images no style uses any more go.
  const used = new Set(next.flatMap(imageUrls));
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path !== ROWS_KEY && !used.has(req.url)) await cache.delete(req);
  }
  return changed;
}

/**
 * The styles this device kept, their images as blob: URLs from the cache (an image missing from the cache keeps
 * its address, which works online). Empty where there's no cache or nothing kept yet.
 */
export async function keptStyles(): Promise<ThemeRow[]> {
  const cache = await openCache();
  if (!cache) return [];
  const rows = await keptRows(cache);
  const out: ThemeRow[] = [];
  for (const row of rows) {
    if (!row.image) {
      out.push(row);
      continue;
    }
    const image = { ...row.image };
    for (const size of SIZES) {
      const src = image[size];
      const res = src ? await cache.match(src).catch(() => undefined) : undefined;
      if (res) image[size] = URL.createObjectURL(await res.blob());
    }
    out.push({ ...row, image });
  }
  return out;
}
