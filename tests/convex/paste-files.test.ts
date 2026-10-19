// Blocks pasted into another note bring their images, files and recordings (files.shareForPaste): in the same
// place the new note's row shares the stored bytes and adds nothing to storage, deleting either note keeps
// what the other shows, and the bytes are always counted once; into another place they're copied and counted
// there.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { para, person, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

afterEach(() => {
  vi.useRealTimers();
});

async function push(p: Person, ops: unknown[]) {
  const results = await p.as.mutation(api.sync.push, { scope: p.scope, deviceId: "device-paste-files", ops: ops as never });
  for (const r of results) expect(r.status).toBe("applied");
}

async function newDoc(p: Person, title: string, scope?: unknown) {
  const id = ulid();
  await push(p, [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null, ...(scope ? { scope } : {}) } }]);
  return id;
}

/** A ready image of the note, counted toward its place's storage like a finished upload. */
async function uploadInto(t: T, documentId: string, content: string) {
  const publicId = ulid();
  await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([content], { type: "image/png" }));
    const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", documentId)).unique())!;
    await ctx.db.insert("files", {
      publicId,
      storageId,
      ...(doc.ownerProfileId ? { ownerProfileId: doc.ownerProfileId } : { workspaceId: doc.workspaceId! }),
      documentId: doc._id,
      uploadedBy: doc.createdBy,
      filename: "image.png",
      mimeType: "image/png",
      size: content.length,
      sha256: "x",
      kind: "image",
      status: "ready",
      createdAt: Date.now(),
    });
    if (doc.ownerProfileId) {
      const owner = (await ctx.db.get(doc.ownerProfileId))!;
      await ctx.db.patch(owner._id, { personalStorageUsedBytes: (owner.personalStorageUsedBytes ?? 0) + content.length });
    }
  });
  return publicId;
}

async function fileRow(t: T, publicId: string) {
  return await t.run(async (ctx) => {
    const f = await ctx.db.query("files").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique();
    if (!f) return null;
    const doc = f.documentId ? await ctx.db.get(f.documentId) : null;
    return { ...f, notePublicId: doc?.publicId ?? null, blob: (await ctx.db.system.get(f.storageId)) !== null };
  });
}

const storageUsed = async (t: T, p: Person) => await t.run(async (ctx) => (await ctx.db.get(p.profileId as Id<"profiles">))!.personalStorageUsedBytes ?? 0);
const url = async (p: Person, fileId: string) => (await p.as.query(api.files.urls, { fileIds: [fileId], now: Date.now() }))[fileId]?.url;

async function deleteForGood(t: T, p: Person, documentId: string, title: string) {
  await p.as.mutation(api.documents.moveToTrash, { documentId });
  await p.as.mutation(api.documents.deletePermanently, { documentId, confirmTitle: title });
  await t.mutation(internal.maintenance.runDeletionJobs, {});
}

describe("pasted blocks' files", () => {
  test("in the same Personal: shared bytes, no extra storage, each copy survives the other's deletion", async () => {
    const t = setup();
    const a = await person(t, "paste-share@example.com");
    const from = await newDoc(a, "Trip");
    const to = await newDoc(a, "Plans");
    const image = await uploadInto(t, from, "png-bytes");
    const before = await storageUsed(t, a);

    const map = await a.as.mutation(api.files.shareForPaste, { documentId: to, fileIds: [image] });
    const shared = map[image]!;
    expect(shared).toBeTruthy();
    expect(shared).not.toBe(image);
    const row = (await fileRow(t, shared))!;
    const original = (await fileRow(t, image))!;
    expect(row.notePublicId).toBe(to);
    expect(row.sharesBlob).toBe(true);
    expect(row.storageId).toBe(original.storageId);
    expect(await storageUsed(t, a)).toBe(before);
    expect(await url(a, shared)).toBeTruthy();
    // Pasted again: the same row. Pasted into its own note: its own id.
    expect((await a.as.mutation(api.files.shareForPaste, { documentId: to, fileIds: [image] }))[image]).toBe(shared);
    expect((await a.as.mutation(api.files.shareForPaste, { documentId: from, fileIds: [image] }))[image]).toBe(image);

    // The original note goes for good: the pasted copy keeps the bytes and now counts them.
    await deleteForGood(t, a, from, "Trip");
    expect(await fileRow(t, image)).toBeNull();
    const kept = (await fileRow(t, shared))!;
    expect(kept.blob).toBe(true);
    expect(kept.sharesBlob).toBeUndefined();
    expect(await storageUsed(t, a)).toBe(before);
    expect(await url(a, shared)).toBeTruthy();

    // And when that note goes too, the bytes and their storage go with it.
    await deleteForGood(t, a, to, "Plans");
    expect(await fileRow(t, shared)).toBeNull();
    expect(await storageUsed(t, a)).toBe(before - "png-bytes".length);
  });

  test("the pasted copy deleted first: the original keeps its bytes and its count", async () => {
    const t = setup();
    const a = await person(t, "paste-share-2@example.com");
    const from = await newDoc(a, "Source");
    const to = await newDoc(a, "Copy");
    const image = await uploadInto(t, from, "abc");
    const before = await storageUsed(t, a);
    const shared = (await a.as.mutation(api.files.shareForPaste, { documentId: to, fileIds: [image] }))[image]!;
    await deleteForGood(t, a, to, "Copy");
    expect(await fileRow(t, shared)).toBeNull();
    expect((await fileRow(t, image))!.blob).toBe(true);
    expect(await storageUsed(t, a)).toBe(before);
  });

  test("into a workspace: copied and counted there; someone else's file isn't shared", async () => {
    vi.useFakeTimers();
    const t = setup();
    const a = await person(t, "paste-ws@example.com");
    const b = await person(t, "paste-other@example.com");
    const from = await newDoc(a, "Personal note");
    const image = await uploadInto(t, from, "ws-bytes");
    const { workspaceId, scope } = await teamWorkspace(a, "Studio");
    const to = await newDoc({ ...a, scope }, "Team note", scope);
    const wsBefore = await t.run(async (ctx) => (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", workspaceId)).unique())!.storageUsedBytes);

    const copy = (await a.as.mutation(api.files.shareForPaste, { documentId: to, fileIds: [image] }))[image]!;
    const row = (await fileRow(t, copy))!;
    expect(row.notePublicId).toBe(to);
    expect(row.sharesBlob).toBeUndefined();
    expect(row.workspaceId).toBeTruthy();
    expect(await t.run(async (ctx) => (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", workspaceId)).unique())!.storageUsedBytes)).toBe(wsBefore + "ws-bytes".length);

    // Someone who can't open the original note gets nothing for it (and can't paste into a note they can't edit).
    const bNote = await newDoc(b, "B's note");
    expect(await b.as.mutation(api.files.shareForPaste, { documentId: bNote, fileIds: [image] })).toEqual({});
    await expect(b.as.mutation(api.files.shareForPaste, { documentId: from, fileIds: [image] })).rejects.toThrow();
  });

  test("blocks pasted with files keep their ids in the note they're pasted into", async () => {
    const t = setup();
    const a = await person(t, "paste-blocks@example.com");
    const from = await newDoc(a, "One");
    const to = await newDoc(a, "Two");
    const image = await uploadInto(t, from, "img");
    const shared = (await a.as.mutation(api.files.shareForPaste, { documentId: to, fileIds: [image, "01NOTAREALFILE000000000000"] }))[image]!;
    const block = { id: ulid(), type: "image", parentId: null, rank: "a", schemaVersion: para("x", "").schemaVersion, text: [], props: { fileId: shared, alt: "", caption: "" } };
    await push(a, [{ opId: ulid(), kind: "block.upsert", documentId: to, block, baseRevision: null, fields: ["content", "position"] }]);
    const blocks = (await a.as.query(api.blocks.list, { documentId: to }))!.blocks;
    expect(blocks.map((b) => (b.props as { fileId?: string }).fileId)).toContain(shared);
  });
});
