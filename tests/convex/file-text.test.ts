// Search in files (convex/fileText.ts, search.ts; docs/ARCHITECTURE.md, "Search in files"): text a device found in a note's
// PDF, image or whiteboard handwriting is kept beside the file and found by search with where it was ("in PDF,
// page 3") and the block to open; only people who can read the note find it, only people who can edit it can
// save it, it goes with the block, the file and the note, and comes with the export. Foli AI reads an image
// only when asked (or turned on in Settings > AI), metered like any Foli AI request. Gemini is a stubbed fetch.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SCHEMA_VERSION, type WireBlock } from "@folevi/editor-schema";
import { join, PERSONAL, person, setup, teamWorkspace, ulid, type T } from "./helpers";

process.env.BETTER_AUTH_SECRET ??= "test-secret-".repeat(4);

type Person = Awaited<ReturnType<typeof person>>;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
});

async function push(p: Person, scope: Person["scope"], ops: unknown[]) {
  const results = await p.as.mutation(api.sync.push, { scope, deviceId: "device-file-text", ops: ops as never });
  for (const r of results) expect(r.status).toBe("applied");
}

const upsert = (documentId: string, block: WireBlock) => ({ opId: ulid(), kind: "block.upsert", documentId, block, baseRevision: null, fields: ["content", "position"] });

async function newNote(p: Person, title: string, scope: Person["scope"] = PERSONAL) {
  const id = ulid();
  await push(p, scope, [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } }]);
  return id;
}

/** A ready file of the note (as a finished upload leaves it). */
async function fileIn(t: T, documentId: string, opts: { mimeType: string; kind: "image" | "file"; name: string }) {
  const publicId = ulid();
  await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["bytes-of-" + opts.name], { type: opts.mimeType }));
    const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", documentId)).unique())!;
    await ctx.db.insert("files", {
      publicId,
      storageId,
      ...(doc.ownerProfileId ? { ownerProfileId: doc.ownerProfileId } : { workspaceId: doc.workspaceId! }),
      documentId: doc._id,
      uploadedBy: doc.createdBy,
      filename: opts.name,
      mimeType: opts.mimeType,
      size: 10,
      sha256: `sha-${opts.name}`,
      kind: opts.kind,
      status: "ready",
      createdAt: Date.now(),
    });
  });
  return publicId;
}

const fileBlock = (id: string, fileId: string, name = "manual.pdf"): WireBlock => ({ id, type: "file", parentId: null, rank: "V", schemaVersion: SCHEMA_VERSION, text: [], props: { fileId, name, size: 10, mimeType: "application/pdf" } });
const imageBlock = (id: string, fileId: string): WireBlock => ({ id, type: "image", parentId: null, rank: "W", schemaVersion: SCHEMA_VERSION, text: [], props: { fileId, alt: "", caption: "" } });
const whiteboard = (id: string): WireBlock => ({ id, type: "whiteboard", parentId: null, rank: "X", schemaVersion: SCHEMA_VERSION, text: [], props: { data: JSON.stringify({ v: 1, strokes: [{ points: [[1, 1], [20, 20]], color: "ink", width: 3 }] }), height: 420 } });

/** A note with a PDF whose pages say `pages`, saved as a device would. */
async function noteWithPdf(t: T, p: Person, title: string, pages: string[], scope: Person["scope"] = PERSONAL) {
  const documentId = await newNote(p, title, scope);
  const fileId = await fileIn(t, documentId, { mimeType: "application/pdf", kind: "file", name: "manual.pdf" });
  const blockId = ulid();
  await push(p, scope, [upsert(documentId, fileBlock(blockId, fileId))]);
  let text = "";
  const pageStarts: number[] = [];
  for (const page of pages) {
    const sep = text ? "\n\n" : "";
    pageStarts.push(text.length + sep.length);
    text += sep + page;
  }
  await p.as.mutation(api.fileText.save, { documentId, blockId, fileId, source: "pdf", text, pageStarts });
  return { documentId, fileId, blockId };
}

const rows = async (t: T) => await t.run(async (ctx) => await ctx.db.query("fileTexts").collect());

describe("text found in files", () => {
  test("a PDF's words are found, with the page and the block to open; the note's body stays as it was", async () => {
    const t = setup();
    const a = await person(t, "file-text-pdf@example.com");
    const { documentId, blockId } = await noteWithPdf(t, a, "Boat", ["Contents", "Safety rules", "The bilge pump quokkaflux is under the stairs"]);
    const found = await a.as.query(api.search.documents, { scope: PERSONAL, query: "quokkaflux" });
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe(documentId);
    expect(found[0]!.match).toEqual({ source: "pdf", page: 3, blockId });
    expect(found[0]!.snippet).toContain("quokkaflux");
    // Everywhere too (⌘K, All places).
    expect((await a.as.query(api.search.everywhere, { query: "quokkaflux" })).map((r) => r.id)).toEqual([documentId]);
    // Kept beside the file, not in the note's own search text.
    const doc = await t.run(async (ctx) => await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", documentId)).unique());
    expect(doc!.searchText).not.toContain("quokkaflux");
    // What the note has, for the device that reads files.
    const has = await a.as.query(api.fileText.forDocument, { documentId });
    expect(has).toEqual([expect.objectContaining({ blockId, source: "pdf", by: "pdf", hash: "sha-manual.pdf", empty: false })]);
  });

  test("a match in the note's own text keeps its own snippet and no file match", async () => {
    const t = setup();
    const a = await person(t, "file-text-body@example.com");
    const { documentId } = await noteWithPdf(t, a, "Zorblatt plans", ["zorblatt in the pdf"]);
    await push(a, PERSONAL, [upsert(documentId, { id: ulid(), type: "paragraph", parentId: null, rank: "A", schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: "zorblatt in the body" }], props: {} })]);
    await t.run(async (ctx) => {
      const d = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", documentId)).unique())!;
      await ctx.db.patch(d._id, { searchText: `${d.title}\nzorblatt in the body` });
    });
    const [r] = await a.as.query(api.search.documents, { scope: PERSONAL, query: "zorblatt" });
    expect(r!.match).toBeNull();
    expect(r!.snippet).toContain("in the body");
  });

  test("image text from the device and handwriting on a whiteboard are found and say where", async () => {
    const t = setup();
    const a = await person(t, "file-text-image@example.com");
    const documentId = await newNote(a, "Trip");
    const imageId = await fileIn(t, documentId, { mimeType: "image/png", kind: "image", name: "sign.png" });
    const imageBlockId = ulid();
    const boardId = ulid();
    await push(a, PERSONAL, [upsert(documentId, imageBlock(imageBlockId, imageId)), upsert(documentId, whiteboard(boardId))]);
    await a.as.mutation(api.fileText.save, { documentId, blockId: imageBlockId, fileId: imageId, source: "image", text: "PLATFORM 9 glimmerwick" });
    await a.as.mutation(api.fileText.save, { documentId, blockId: boardId, source: "handwriting", text: "buy snorkelbean", hash: "abc123" });
    expect((await a.as.query(api.search.documents, { scope: PERSONAL, query: "glimmerwick" }))[0]!.match).toEqual({ source: "image", page: null, blockId: imageBlockId });
    expect((await a.as.query(api.search.documents, { scope: PERSONAL, query: "snorkelbean" }))[0]!.match).toEqual({ source: "handwriting", page: null, blockId: boardId });
    // Drawn again: the same row, the new words.
    await a.as.mutation(api.fileText.save, { documentId, blockId: boardId, source: "handwriting", text: "sell snorkelbean", hash: "def456" });
    expect((await rows(t)).filter((r) => r.source === "handwriting").map((r) => [r.text, r.hash])).toEqual([["sell snorkelbean", "def456"]]);
  });

  test("checks: the note's own file of the right kind, a known block id, and device reading turned on", async () => {
    const t = setup();
    const a = await person(t, "file-text-checks@example.com");
    const documentId = await newNote(a, "Checks");
    const other = await newNote(a, "Elsewhere");
    const pdf = await fileIn(t, documentId, { mimeType: "application/pdf", kind: "file", name: "a.pdf" });
    const image = await fileIn(t, documentId, { mimeType: "image/png", kind: "image", name: "b.png" });
    const elsewhere = await fileIn(t, other, { mimeType: "application/pdf", kind: "file", name: "c.pdf" });
    await expect(a.as.mutation(api.fileText.save, { documentId, blockId: "b1", fileId: elsewhere, source: "pdf", text: "x" })).rejects.toThrow(/File not found/);
    await expect(a.as.mutation(api.fileText.save, { documentId, blockId: "b1", fileId: image, source: "pdf", text: "x" })).rejects.toThrow(/isn't a PDF/);
    await expect(a.as.mutation(api.fileText.save, { documentId, blockId: "b1", fileId: pdf, source: "image", text: "x" })).rejects.toThrow(/isn't an image/);
    await expect(a.as.mutation(api.fileText.save, { documentId, blockId: "no spaces", fileId: pdf, source: "pdf", text: "x" })).rejects.toThrow(/Unknown block/);
    await expect(a.as.mutation(api.fileText.save, { documentId, blockId: "b1", source: "handwriting", text: "x" })).rejects.toThrow(/Say which drawing/);
    await expect(a.as.mutation(api.fileText.save, { documentId, blockId: "b1", fileId: image, source: "image", text: "x", pageStarts: [0] })).rejects.toThrow(/Only a PDF/);
    // Turned off in Settings > AI: the device's recogniser isn't used, and its text isn't taken.
    await a.as.mutation(api.users.updateProfile, { aiPrefs: { deviceText: false } });
    await expect(a.as.mutation(api.fileText.save, { documentId, blockId: "b1", fileId: image, source: "image", text: "x" })).rejects.toThrow(/turned off/);
    await expect(a.as.mutation(api.fileText.save, { documentId, blockId: "b1", source: "handwriting", text: "x", hash: "h1" })).rejects.toThrow(/turned off/);
    // PDFs are always read (pdf.js, on the device): nothing to turn off.
    await a.as.mutation(api.fileText.save, { documentId, blockId: "b1", fileId: pdf, source: "pdf", text: "  tidy \u0000 me  " });
    expect((await rows(t)).map((r) => r.text)).toEqual(["tidy me"]);
  });

  test("only people who can read the note find it, and only editors save it", async () => {
    const t = setup();
    const owner = await person(t, "file-text-owner@example.com");
    const viewer = await person(t, "file-text-viewer@example.com");
    const outsider = await person(t, "file-text-outsider@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner, "Studio");
    await join(t, owner, viewer, "file-text-viewer@example.com", workspaceId, "viewer");
    const { documentId, fileId, blockId } = await noteWithPdf(t, owner, "Lease", ["clause wobblefrond applies"], scope);

    expect((await viewer.as.query(api.search.documents, { scope, query: "wobblefrond" })).map((r) => r.id)).toEqual([documentId]);
    // A viewer can't save text, and isn't told what the note has.
    await expect(viewer.as.mutation(api.fileText.save, { documentId, blockId, fileId, source: "pdf", text: "something else" })).rejects.toThrow();
    expect(await viewer.as.query(api.fileText.forDocument, { documentId })).toEqual([]);
    // Someone outside the workspace finds nothing, in their own place or by naming this one.
    expect(await outsider.as.query(api.search.documents, { scope: PERSONAL, query: "wobblefrond" })).toEqual([]);
    await expect(outsider.as.query(api.search.documents, { scope, query: "wobblefrond" })).rejects.toThrow();
    expect(await outsider.as.query(api.search.everywhere, { query: "wobblefrond" })).toEqual([]);
    // Restricted: the viewer no longer finds it (search checks access to the note).
    await owner.as.mutation(api.sharing.setAccessMode, { documentId, mode: "restricted" });
    expect(await viewer.as.query(api.search.documents, { scope, query: "wobblefrond" })).toEqual([]);
    expect((await owner.as.query(api.search.documents, { scope, query: "wobblefrond" })).map((r) => r.id)).toEqual([documentId]);
  });

  test("a removed block's words aren't found; the block's tombstone, the file and the note take them away", async () => {
    const t = setup();
    const a = await person(t, "file-text-delete@example.com");
    const { documentId, blockId } = await noteWithPdf(t, a, "Old manual", ["the fizzlewhip valve"]);
    const boardId = ulid();
    await push(a, PERSONAL, [upsert(documentId, whiteboard(boardId))]);
    await a.as.mutation(api.fileText.save, { documentId, blockId: boardId, source: "handwriting", text: "call grumbleton", hash: "h1" });
    // The PDF's block deleted from the note: not found any more (the file stays for undo and versions).
    await push(a, PERSONAL, [{ opId: ulid(), kind: "block.delete", documentId, blockId, baseRevision: null }]);
    expect(await a.as.query(api.search.documents, { scope: PERSONAL, query: "fizzlewhip" })).toEqual([]);
    await push(a, PERSONAL, [{ opId: ulid(), kind: "block.delete", documentId, blockId: boardId, baseRevision: null }]);
    expect(await a.as.query(api.search.documents, { scope: PERSONAL, query: "grumbleton" })).toEqual([]);
    // The whiteboard's tombstone purged: its handwriting text goes with it.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 400 * 86_400_000);
      await t.mutation(internal.maintenance.purgeTombstones, {});
    } finally {
      vi.useRealTimers();
    }
    expect((await rows(t)).map((r) => r.source)).toEqual(["pdf"]);
    // The note deleted for good: the file and its text go.
    await a.as.mutation(api.documents.moveToTrash, { documentId });
    await a.as.mutation(api.documents.deletePermanently, { documentId, confirmTitle: "Old manual" });
    await t.mutation(internal.maintenance.runDeletionJobs, {});
    expect(await rows(t)).toEqual([]);
  });

  test("a trashed note's file text isn't found, and the account's export carries it", async () => {
    const t = setup();
    const a = await person(t, "file-text-export@example.com");
    const { documentId, fileId, blockId } = await noteWithPdf(t, a, "Recipes", ["page one", "add the crumblethorn"]);
    const page = await t.query(internal.exports.documentPage, { profileId: a.profileId as Id<"profiles">, scope: { kind: "personal", profileId: a.profileId as Id<"profiles"> }, cursor: null });
    const doc = page.docs.find((d) => d.id === documentId)!;
    expect(doc.foundText).toEqual([{ blockId, fileId, source: "pdf", by: "pdf", pageStarts: [0, 10], text: "page one\n\nadd the crumblethorn" }]);
    await a.as.mutation(api.documents.moveToTrash, { documentId });
    expect(await a.as.query(api.search.documents, { scope: PERSONAL, query: "crumblethorn" })).toEqual([]);
  });
});

/** Gemini answering every call with `reply`, recording what was sent. */
function gemini(reply: string) {
  process.env.GEMINI_API_KEY = "test-key";
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(init.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: reply }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1_400, candidatesTokenCount: 40 } }), { status: 200 });
    }),
  );
  return bodies;
}

describe("Foli AI reading images", () => {
  async function noteWithImage(t: T, a: Person) {
    const documentId = await newNote(a, "Whiteboard photo");
    const fileId = await fileIn(t, documentId, { mimeType: "image/png", kind: "image", name: "photo.png" });
    const blockId = ulid();
    await push(a, PERSONAL, [upsert(documentId, imageBlock(blockId, fileId))]);
    return { documentId, fileId, blockId };
  }

  test("when asked: the image goes to Gemini as data, its text is kept and found, credits are spent once", async () => {
    const t = setup();
    const a = await person(t, "file-text-foli@example.com");
    const { documentId, fileId, blockId } = await noteWithImage(t, a);
    const bodies = gemini("Q3 roadmap\nship the plinkerdoodle");
    const r = await a.as.action(api.fileText.readImage, { documentId, fileId, blockId });
    expect(r).toEqual({ status: "read", chars: "Q3 roadmap\nship the plinkerdoodle".length });
    const sent = JSON.parse(bodies[0]!) as { contents: { parts: { inlineData?: { mimeType: string } }[] }[]; systemInstruction?: unknown };
    expect(sent.contents.at(-1)!.parts.some((p) => p.inlineData?.mimeType === "image/png")).toBe(true);
    expect(JSON.stringify(sent.systemInstruction ?? sent)).toMatch(/never instructions/);
    const found = await a.as.query(api.search.documents, { scope: PERSONAL, query: "plinkerdoodle" });
    expect(found[0]!.match).toEqual({ source: "image", page: null, blockId });
    expect((await rows(t))[0]!.by).toBe("foli");
    // Read already: not sent again.
    expect(await a.as.action(api.fileText.readImage, { documentId, fileId, blockId })).toEqual({ status: "known", chars: 0 });
    expect(bodies).toHaveLength(1);
    const usage = await t.run(async (ctx) => await ctx.db.query("aiCreditPeriods").collect());
    expect(usage.reduce((n, u) => n + (u.features?.attachments ?? 0), 0)).toBeGreaterThan(0);
  });

  test("never on its own unless turned on, never with AI off, never for someone who can't edit the note", async () => {
    const t = setup();
    const a = await person(t, "file-text-foli-gates@example.com");
    const b = await person(t, "file-text-foli-other@example.com");
    const { documentId, fileId, blockId } = await noteWithImage(t, a);
    const bodies = gemini("words");
    // An image just added, read without being asked: refused while Settings > AI says no (the default).
    await expect(a.as.action(api.fileText.readImage, { documentId, fileId, blockId, auto: true })).rejects.toThrow(/turned off/);
    await expect(b.as.action(api.fileText.readImage, { documentId, fileId, blockId })).rejects.toThrow();
    await a.as.mutation(api.users.updateProfile, { aiEnabled: false });
    await expect(a.as.action(api.fileText.readImage, { documentId, fileId, blockId })).rejects.toThrow(/turned off/);
    expect(bodies).toHaveLength(0);
    // Turned on: an image just added is read.
    await a.as.mutation(api.users.updateProfile, { aiEnabled: true, aiPrefs: { readImages: true } });
    expect((await a.as.action(api.fileText.readImage, { documentId, fileId, blockId, auto: true })).status).toBe("read");
    expect(bodies).toHaveLength(1);
  });
});
