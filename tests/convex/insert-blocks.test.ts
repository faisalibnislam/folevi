import { afterEach, describe, expect, test, vi } from "vitest";
import { SCHEMA_VERSION, type WireBlock } from "@folevi/editor-schema";
import { api } from "../../convex/_generated/api";
import { person, setup, ulid } from "./helpers";

type P = Awaited<ReturnType<typeof person>>;

async function newDoc(p: P, title = "Doc") {
  const id = ulid();
  const [r] = await p.as.mutation(api.sync.push, {
    workspaceId: p.workspaceId,
    deviceId: "device-test-1",
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } }],
  });
  expect(r!.status).toBe("applied");
  return id;
}

async function upsert(p: P, documentId: string, block: WireBlock) {
  const [r] = await p.as.mutation(api.sync.push, {
    workspaceId: p.workspaceId,
    deviceId: "device-test-1",
    ops: [{ opId: ulid(), kind: "block.upsert", documentId, block, baseRevision: null, fields: ["content", "position"] }],
  });
  return r!;
}

const block = (type: string, props: Record<string, unknown>, rank = "V"): WireBlock => ({ id: ulid(), type, parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [], props });

describe("Insert panel blocks on the server", () => {
  test("divider styles, page breaks, formulas and whiteboards sync; invalid drawings are rejected", async () => {
    const t = setup();
    const a = await person(t, "inserts@example.com");
    const doc = await newDoc(a);
    const strokes = JSON.stringify({ v: 1, strokes: [{ points: [[10, 10], [40, 30]], color: "blue", width: 3 }] });
    for (const [i, b] of [
      block("divider", { style: "strong" }, "A"),
      block("pageBreak", {}, "B"),
      block("formula", { latex: "e^{i\\pi} + 1 = 0" }, "C"),
      block("whiteboard", { data: strokes, height: 360 }, "D"),
    ].entries()) {
      expect((await upsert(a, doc, b)).status, `block ${i}`).toBe("applied");
    }
    const bad = await upsert(a, doc, block("whiteboard", { data: JSON.stringify({ strokes: [{ points: "nope", color: "ink", width: 2 }] }), height: 360 }, "E"));
    expect(bad.status).toBe("rejected");
    const tooTall = await upsert(a, doc, block("whiteboard", { data: "", height: 99_999 }, "F"));
    expect(tooTall.status).toBe("rejected");
    const longFormula = await upsert(a, doc, block("formula", { latex: "x".repeat(10_001) }, "G"));
    expect(longFormula.status).toBe("rejected");
  });

  test("collections can start as a gallery or a kanban board", async () => {
    const t = setup();
    const a = await person(t, "views@example.com");
    const doc = await newDoc(a);
    const gallery = await a.as.mutation(api.collections.create, { documentId: doc, name: "Gallery", view: "gallery" });
    const board = await a.as.mutation(api.collections.create, { documentId: doc, name: "Kanban", view: "board" });
    const table = await a.as.mutation(api.collections.create, { documentId: doc });
    const g = await a.as.query(api.collections.get, { collectionId: gallery.collectionId });
    const k = await a.as.query(api.collections.get, { collectionId: board.collectionId });
    const tb = await a.as.query(api.collections.get, { collectionId: table.collectionId });
    expect(g.views.map((v) => [v.id === gallery.viewId, v.type])).toEqual([[true, "gallery"]]);
    expect(g.views[0]!.config.cardPreview).toBe("cover");
    expect(k.views.map((v) => [v.id === board.viewId, v.type])).toEqual([[true, "board"]]);
    // Boards group by the Status select property.
    expect(k.views[0]!.config.groupBy).toBe(k.properties.find((p) => p.name === "Status")!.id);
    expect(tb.views.map((v) => v.type)).toEqual(["table"]);
  });
});

describe("Unsplash search", () => {
  afterEach(() => {
    delete process.env.UNSPLASH_ACCESS_KEY;
    vi.unstubAllGlobals();
  });

  test("requires sign-in and says so when no access key is configured", async () => {
    const t = setup();
    await expect(t.action(api.unsplash.search, { query: "sea" })).rejects.toThrow(/unauthenticated|Sign in/);
    const a = await person(t, "unsplash-off@example.com");
    expect(await a.as.action(api.unsplash.search, { query: "sea" })).toEqual({ configured: false });
  });

  test("searches server-side with the key, keeps only trusted fields and tracks downloads", async () => {
    const t = setup();
    const a = await person(t, "unsplash-on@example.com");
    process.env.UNSPLASH_ACCESS_KEY = "test-key";
    const calls: { url: string; auth: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, auth: new Headers(init?.headers).get("Authorization") });
        if (url.includes("/download")) return new Response(JSON.stringify({ url: "https://images.unsplash.com/x" }), { status: 200 });
        return new Response(
          JSON.stringify({
            total_pages: 3,
            results: [
              {
                id: "abc_123",
                width: 4000,
                height: 3000,
                color: "#aabbcc",
                alt_description: "a calm sea",
                urls: { regular: "https://images.unsplash.com/photo-1?w=1080", small: "https://images.unsplash.com/photo-1?w=400" },
                links: { html: "https://unsplash.com/photos/abc_123", download_location: "https://api.unsplash.com/photos/abc_123/download" },
                user: { name: "Ada Lovelace", links: { html: "https://unsplash.com/@ada" } },
              },
              // Untrusted image host: dropped.
              { id: "evil", urls: { regular: "https://evil.example/x.jpg" }, user: { name: "X" } },
            ],
          }),
          { status: 200 },
        );
      }),
    );
    const r = await a.as.action(api.unsplash.search, { query: "calm sea" });
    expect(r).toMatchObject({ configured: true, totalPages: 3 });
    if (!r.configured) throw new Error("expected configured");
    expect(r.photos).toHaveLength(1);
    expect(r.photos[0]).toMatchObject({
      id: "abc_123",
      url: "https://images.unsplash.com/photo-1?w=1080",
      thumbUrl: "https://images.unsplash.com/photo-1?w=400",
      photographer: "Ada Lovelace",
      photographerUrl: "https://unsplash.com/@ada?utm_source=folevi&utm_medium=referral",
      alt: "a calm sea",
    });
    expect(calls[0]!.url).toBe("https://api.unsplash.com/search/photos?per_page=24&page=1&content_filter=high&query=calm%20sea");
    expect(calls[0]!.auth).toBe("Client-ID test-key");
    await a.as.action(api.unsplash.trackDownload, { photoId: "abc_123" });
    expect(calls[1]!.url).toBe("https://api.unsplash.com/photos/abc_123/download");
    // Ids are validated before anything is fetched.
    await a.as.action(api.unsplash.trackDownload, { photoId: "../../me" });
    expect(calls).toHaveLength(2);
  });
});
