import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { keptStyles, mergeStyles, noteStylesUrl, syncNoteStyles } from "@/lib/shell/styleSync";
import type { ThemeRow } from "@/lib/themes";

// Note styles kept up to date in the apps (the owner, 2026-11-24): the bundled snapshot stays the fallback; when
// online the app asks once, anonymously, and keeps new or changed styles and their images; the newer copy wins.

const row = (key: string, updatedAt: number, image?: string, order = 0): ThemeRow => ({
  key,
  name: key,
  status: "published",
  order,
  plan: "free",
  image: image ? { full: `${image}-full`, half: `${image}-half`, thumb: `${image}-thumb`, width: 10, height: 10 } : null,
  palette: null,
  defaults: null,
  fonts: null,
  updatedAt,
});

/** A Cache Storage stand-in: one cache, keyed by URL. */
function fakeCaches() {
  const store = new Map<string, Response>();
  const key = (r: RequestInfo | URL) => new URL(typeof r === "string" ? r : r instanceof URL ? r.href : r.url, "https://app.test").href;
  const cache = {
    match: async (r: RequestInfo | URL) => store.get(key(r))?.clone(),
    put: async (r: RequestInfo | URL, res: Response) => void store.set(key(r), res.clone()),
    delete: async (r: RequestInfo | URL) => store.delete(key(r)),
    keys: async () => [...store.keys()].map((u) => new Request(u)),
  };
  vi.stubGlobal("caches", { open: async () => cache });
  return store;
}

/** The server: the style list, and each image as a tiny blob; records every request and its options. */
function fakeServer(themes: ThemeRow[], failing: string[] = []) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/note-styles")) return new Response(JSON.stringify({ version: 1, themes }), { status: 200 });
    if (failing.includes(url)) return new Response("", { status: 500 });
    return new Response(new Blob(["img"], { type: "image/webp" }), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://demo-123.convex.site");
  URL.createObjectURL = vi.fn(() => "blob:kept");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("note style sync", () => {
  test("asks the deployment's site address", () => {
    expect(noteStylesUrl()).toBe("https://demo-123.convex.site/note-styles");
  });

  test("the newer copy of each style wins, in the admins' order", () => {
    const merged = mergeStyles([row("dusk", 10, undefined, 1), row("paper", 20, undefined, 0)], [row("dusk", 30, undefined, 1), row("paper", 5, undefined, 0), row("new", 1, undefined, 2)]);
    expect(merged.map((r) => [r.key, r.updatedAt])).toEqual([
      ["paper", 20],
      ["dusk", 30],
      ["new", 1],
    ]);
  });

  test("keeps new and changed styles with their images; asks anonymously; unchanged ones fetch nothing", async () => {
    fakeCaches();
    const first = fakeServer([row("dusk", 10, "https://demo-123.convex.cloud/api/storage/a")]);
    expect(await syncNoteStyles(first.impl)).toBe(1);
    expect(first.calls.map((c) => c.url)).toEqual([
      "https://demo-123.convex.site/note-styles",
      "https://demo-123.convex.cloud/api/storage/a-full",
      "https://demo-123.convex.cloud/api/storage/a-half",
      "https://demo-123.convex.cloud/api/storage/a-thumb",
    ]);
    for (const c of first.calls) expect(c.init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
    // Again, nothing changed: only the list is asked for.
    const again = fakeServer([row("dusk", 10, "https://demo-123.convex.cloud/api/storage/a")]);
    expect(await syncNoteStyles(again.impl)).toBe(0);
    expect(again.calls).toHaveLength(1);
    // Kept rows come back with their images as blob: URLs, for offline.
    const kept = await keptStyles();
    expect(kept[0]!.image!.full).toBe("blob:kept");
  });

  test("a style whose images didn't all arrive keeps its older copy; images no style uses go", async () => {
    const store = fakeCaches();
    await syncNoteStyles(fakeServer([row("dusk", 10, "https://s/a")]).impl);
    const broken = fakeServer([row("dusk", 20, "https://s/b")], ["https://s/b-half"]);
    expect(await syncNoteStyles(broken.impl)).toBe(0);
    expect((await keptStyles())[0]!.updatedAt).toBe(10);
    // The one that arrived was taken out again, since no kept style uses it.
    expect([...store.keys()].some((k) => k.includes("/b-full"))).toBe(false);
    expect([...store.keys()].some((k) => k.includes("/a-full"))).toBe(true);
  });

  test("offline or no answer: nothing changes and it says it couldn't ask", async () => {
    fakeCaches();
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    expect(await syncNoteStyles(offline)).toBeNull();
    expect(await keptStyles()).toEqual([]);
  });
});
