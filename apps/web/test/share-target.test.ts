// @vitest-environment node
// Save to Folevi: tidying what other apps share (links in text, repeats), the note it becomes, the
// bookmarklet, the service worker's share target and the server's fallback for it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";
import { validateWireBlock } from "@folevi/editor-schema";
import { bookmarkletHref, normaliseShare, shareBlocks, shareFileKind, webLink } from "@/lib/share/payload";
import { POST as shareTargetFallback } from "@/app/share-target/route";

describe("normaliseShare", () => {
  test("a link in the text (how most Android apps share) becomes the link, shown once", () => {
    expect(normaliseShare({ title: "", text: "https://example.com/article?id=4", url: "" })).toEqual({ title: "example.com/article", text: "", url: "https://example.com/article?id=4" });
    expect(normaliseShare({ title: "Great read", text: "Look at this https://example.com/a", url: null })).toEqual({ title: "Great read", text: "Look at this", url: "https://example.com/a" });
  });

  test("the same link in url and text, and a title repeated as text, aren't doubled", () => {
    expect(normaliseShare({ title: "Docs", text: "Docs\nhttps://example.com/docs/", url: "https://example.com/docs/" })).toEqual({ title: "Docs", text: "", url: "https://example.com/docs/" });
    expect(normaliseShare({ title: "Same", text: "Same", url: "" })).toEqual({ title: "Same", text: "", url: null });
    expect(normaliseShare({ title: "https://x.org/p", text: "", url: "https://x.org/p" }).title).toBe("x.org/p");
  });

  test("only web links count; anything else stays text or is dropped", () => {
    expect(webLink("javascript:alert(1)")).toBeNull();
    expect(webLink("data:text/html,hi")).toBeNull();
    expect(webLink("https://example.com/a).")).toBe("https://example.com/a");
    expect(normaliseShare({ url: "javascript:alert(1)", text: "hello" })).toEqual({ title: "hello", text: "hello", url: null });
  });

  test("everything is trimmed and capped", () => {
    const out = normaliseShare({ title: `  ${"t".repeat(500)}  `, text: "x".repeat(30_000), url: "" });
    expect(out.title).toHaveLength(200);
    expect(out.text).toHaveLength(20_000);
  });
});

describe("shareBlocks", () => {
  test("a bookmark for the link, a paragraph per line, then files; every block valid and in order", () => {
    const blocks = shareBlocks(normaliseShare({ title: "Trip", text: "Line one\n\nLine two", url: "https://maps.example.com/x" }), [
      { id: "01IMAGE0000000000000000000", type: "image", parentId: null, rank: "", schemaVersion: 1, text: [], props: { alt: "photo", caption: "", fileId: "f1" } },
    ]);
    expect(blocks.map((b) => b.type)).toEqual(["bookmark", "paragraph", "paragraph", "image"]);
    expect(blocks[0]!.props).toEqual({ url: "https://maps.example.com/x", title: "Trip" });
    const ranks = blocks.map((b) => b.rank);
    expect([...ranks].sort()).toEqual(ranks);
    for (const b of blocks) expect(validateWireBlock(b)).toEqual([]);
  });

  test("images and PDFs are taken, other files and oversized ones aren't", () => {
    expect(shareFileKind({ type: "image/jpeg", size: 10 })).toBe("image");
    expect(shareFileKind({ type: "application/pdf", size: 10 })).toBe("file");
    expect(shareFileKind({ type: "video/mp4", size: 10 })).toBeNull();
    expect(shareFileKind({ type: "image/png", size: 30 * 1024 * 1024 })).toBeNull();
  });
});

describe("bookmarklet", () => {
  test("opens Folevi's share page with the page's title, address and selection, and nothing else", () => {
    const href = bookmarkletHref("https://app.folevi.com/");
    expect(href.startsWith("javascript:")).toBe(true);
    const code = decodeURIComponent(href.slice("javascript:".length));
    expect(code).toContain('"https://app.folevi.com/share"');
    expect(code).toContain("d.title");
    expect(code).toContain("location.href");
    expect(code).toContain("getSelection");
    expect(code).not.toMatch(/createElement|appendChild|<script|cookie|localStorage|innerHTML|fetch\(/);
    // Run it against a fake page: it opens one window at the share address.
    const opened: string[] = [];
    const page = { title: "A page", getSelection: () => "chosen words" };
    runInNewContext(code, {
      document: page,
      window: { getSelection: page.getSelection, open: (u: string) => (opened.push(u), {}) },
      location: { href: "https://news.example.com/story" },
      encodeURIComponent,
      String,
    });
    expect(opened).toHaveLength(1);
    const u = new URL(opened[0]!);
    expect(u.origin + u.pathname).toBe("https://app.folevi.com/share");
    expect(Object.fromEntries(u.searchParams)).toEqual({ title: "A page", url: "https://news.example.com/story", text: "chosen words" });
  });
});

/** The service worker in a sandbox: its fetch handler, with an in-memory Cache Storage. */
function serviceWorker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const store = new Map<string, Map<string, Response>>();
  const origin = "https://app.folevi.com";
  const abs = (key: string | Request) => new URL(typeof key === "string" ? key : key.url, origin).href;
  const caches = {
    async open(name: string) {
      if (!store.has(name)) store.set(name, new Map());
      const c = store.get(name)!;
      return {
        put: async (key: string, res: Response) => void c.set(abs(key), res),
        match: async (key: string) => c.get(abs(key))?.clone(),
        keys: async () => [...c.keys()].map((url) => new Request(url)),
        delete: async (key: string | Request) => c.delete(abs(key)),
      };
    },
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
  };
  const self = { location: { origin }, addEventListener: (type: string, fn: (event: unknown) => void) => (handlers[type] = fn), skipWaiting() {}, clients: {} };
  const source = readFileSync(join(__dirname, "..", "public", "sw.js"), "utf8");
  runInNewContext(source, { self, caches, URL, Request, Response, fetch: async () => new Response("network"), console, Date, Math, String, parseInt, JSON });
  return { handlers, store };
}

describe("service worker share target", () => {
  test("keeps a share's fields and files on the device and opens /share?received=<id>", async () => {
    const sw = serviceWorker();
    const form = new FormData();
    form.set("title", "Shared page");
    form.set("text", "Have a look https://example.com/x");
    form.set("url", "");
    form.append("files", new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" }));
    form.append("files", new File([], "empty.png", { type: "image/png" }));
    let response: Promise<Response> | null = null;
    sw.handlers.fetch!({ request: new Request("https://app.folevi.com/share-target", { method: "POST", body: form }), respondWith: (p: Promise<Response>) => (response = p) });
    const res = await response!;
    expect(res.status).toBe(303);
    const id = new URL(res.headers.get("location")!).searchParams.get("received")!;
    expect(id).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
    const cache = sw.store.get("folevi-share-v1")!;
    const meta = await cache.get(`https://app.folevi.com/__share/${id}/meta`)!.json();
    expect(meta).toEqual({ title: "Shared page", text: "Have a look https://example.com/x", url: "", files: [{ name: "photo.png", type: "image/png" }], skipped: ["empty.png"] });
    expect(new Uint8Array(await cache.get(`https://app.folevi.com/__share/${id}/file/0`)!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("other POSTs and other origins are left alone", () => {
    const sw = serviceWorker();
    let responded = false;
    sw.handlers.fetch!({ request: new Request("https://app.folevi.com/api/v1/notes", { method: "POST", body: "{}" }), respondWith: () => (responded = true) });
    sw.handlers.fetch!({ request: new Request("https://evil.example/share-target", { method: "POST", body: "x" }), respondWith: () => (responded = true) });
    expect(responded).toBe(false);
  });
});

describe("server share target (no service worker yet)", () => {
  test("passes title, text and link on to /share and says how many files didn't come along", async () => {
    const form = new FormData();
    form.set("title", "T");
    form.set("text", "words");
    form.set("url", "https://example.com/");
    form.append("files", new File([new Uint8Array([1])], "a.png", { type: "image/png" }));
    const res = await shareTargetFallback(new Request("https://app.folevi.com/share-target", { method: "POST", body: form }));
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get("location")!, "https://app.folevi.com");
    expect(loc.pathname).toBe("/share");
    expect(Object.fromEntries(loc.searchParams)).toEqual({ title: "T", text: "words", url: "https://example.com/", skipped: "1" });
  });
});
