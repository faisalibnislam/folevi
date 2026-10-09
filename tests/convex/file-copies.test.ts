// A copied note owns its files (convex/lib/fileCopies.ts): Duplicate, a copy of a version and a note from
// a template each get their own file rows and bytes, so purging the original never breaks the copy.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { para, person, setup, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

afterEach(() => {
  vi.useRealTimers();
});

const drain = async (t: T) => await t.finishAllScheduledFunctions(vi.runAllTimers);

async function push(p: Person, ops: unknown[]) {
  const results = await p.as.mutation(api.sync.push, { scope: p.scope, deviceId: "device-file-copies", ops: ops as never });
  for (const r of results) expect(r.status).toBe("applied");
  return results;
}

async function newDoc(p: Person, title: string, extra: Record<string, unknown> = {}) {
  const id = ulid();
  await push(p, [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null, ...extra } }]);
  return id;
}

/** Stores bytes as a ready file of the note (as a finished upload would), counted toward its Personal. */
async function uploadInto(t: T, documentId: string, content: string, kind: "image" | "cover" = "image") {
  const publicId = ulid();
  const storageId = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([content], { type: "image/png" }));
    const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", documentId)).unique())!;
    await ctx.db.insert("files", {
      publicId,
      storageId,
      ownerProfileId: doc.ownerProfileId,
      documentId: doc._id,
      uploadedBy: doc.createdBy,
      filename: `${kind}.png`,
      mimeType: "image/png",
      size: content.length,
      sha256: "x",
      kind,
      width: 4,
      height: 3,
      status: "ready",
      createdAt: Date.now(),
    });
    const owner = (await ctx.db.get(doc.ownerProfileId!))!;
    await ctx.db.patch(owner._id, { personalStorageUsedBytes: (owner.personalStorageUsedBytes ?? 0) + content.length });
    return storageId;
  });
  return { publicId, storageId };
}

async function addImage(p: Person, documentId: string, fileId: string) {
  const image = { id: ulid(), type: "image", parentId: null, rank: "a", schemaVersion: para("x", "").schemaVersion, text: [], props: { fileId, alt: "", caption: "" } };
  await push(p, [{ opId: ulid(), kind: "block.upsert", documentId, block: image, baseRevision: null, fields: ["content", "position"] }]);
}

async function imageFileIds(p: Person, documentId: string): Promise<string[]> {
  const blocks = (await p.as.query(api.blocks.list, { documentId }))!.blocks;
  return blocks.filter((b) => b.type === "image").map((b) => (b.props as { fileId: string }).fileId);
}

async function fileRow(t: T, publicId: string) {
  return await t.run(async (ctx) => {
    const f = await ctx.db.query("files").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique();
    if (!f) return null;
    const doc = f.documentId ? await ctx.db.get(f.documentId) : null;
    const blob = await ctx.storage.get(f.storageId);
    return { ...f, notePublicId: doc?.publicId ?? null, bytes: blob ? await blob.text() : null };
  });
}

const blobExists = async (t: T, storageId: Id<"_storage">) => await t.run(async (ctx) => (await ctx.db.system.get(storageId)) !== null);
const storageUsed = async (t: T, p: Person) => await t.run(async (ctx) => (await ctx.db.get(p.profileId as Id<"profiles">))!.personalStorageUsedBytes ?? 0);
const url = async (p: Person, fileId: string) => (await p.as.query(api.files.urls, { fileIds: [fileId], now: Date.now() }))[fileId]?.url;

async function deleteForGood(t: T, p: Person, documentId: string, title: string) {
  await p.as.mutation(api.documents.moveToTrash, { documentId });
  await p.as.mutation(api.documents.deletePermanently, { documentId, confirmTitle: title });
  await t.mutation(internal.maintenance.runDeletionJobs, {});
  expect(await t.run(async (ctx) => await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", documentId)).unique())).toBeNull();
}

describe("copied notes own their files", () => {
  test("Duplicate: the copy gets its own image and style image rows and bytes; purging the original keeps them", async () => {
    vi.useFakeTimers();
    const t = setup();
    const a = await person(t, "dup-files@example.com");
    const original = await newDoc(a, "Beach day");
    const image = await uploadInto(t, original, "png-bytes");
    const cover = await uploadInto(t, original, "cover-bytes", "cover");
    await addImage(a, original, image.publicId);
    await push(a, [{ opId: ulid(), kind: "document.update", documentId: original, baseRevision: null, patch: { cover: { kind: "image", value: cover.publicId } } }]);
    const before = await storageUsed(t, a);

    const copy = await a.as.mutation(api.documents.duplicate, { documentId: original });
    const [copyImage] = await imageFileIds(a, copy.id);
    const copyCover = (await a.as.query(api.documents.get, { documentId: copy.id }))!.document.cover;
    expect(copyImage).toBeTruthy();
    expect(copyImage).not.toBe(image.publicId);
    expect(copyCover.kind).toBe("image");
    expect(copyCover.value).not.toBe(cover.publicId);
    // The copy's files are its own and count toward storage like uploads.
    expect((await fileRow(t, copyImage!))!.notePublicId).toBe(copy.id);
    expect((await fileRow(t, copyCover.value!))!.notePublicId).toBe(copy.id);
    expect(await storageUsed(t, a)).toBe(before + "png-bytes".length + "cover-bytes".length);
    // The original still shows its own.
    expect(await imageFileIds(a, original)).toEqual([image.publicId]);

    // Their bytes are copied right after: separate blobs with the same content.
    await drain(t);
    const copied = (await fileRow(t, copyImage!))!;
    expect(copied.storageId).not.toBe(image.storageId);
    expect(copied.bytes).toBe("png-bytes");
    expect((await fileRow(t, copyCover.value!))!.storageId).not.toBe(cover.storageId);

    // The original is deleted for good: its files go, the copy's stay readable.
    await deleteForGood(t, a, original, "Beach day");
    await drain(t);
    expect(await fileRow(t, image.publicId)).toBeNull();
    expect(await blobExists(t, image.storageId)).toBe(false);
    for (const id of [copyImage!, copyCover.value!]) {
      const row = (await fileRow(t, id))!;
      expect(row.status).toBe("ready");
      expect(await blobExists(t, row.storageId)).toBe(true);
      expect(await url(a, id)).toBeTruthy();
    }
    expect((await fileRow(t, copyImage!))!.bytes).toBe("png-bytes");
    // Only the original's bytes were given back.
    expect(await storageUsed(t, a)).toBe(before);
  });

  test("purged before the copy's bytes are made: the shared blob stays until the copy has its own", async () => {
    vi.useFakeTimers();
    const t = setup();
    const a = await person(t, "dup-race@example.com");
    const original = await newDoc(a, "Sketches");
    const image = await uploadInto(t, original, "sketch");
    await addImage(a, original, image.publicId);
    const copy = await a.as.mutation(api.documents.duplicate, { documentId: original });
    const [copyImage] = await imageFileIds(a, copy.id);
    // Nothing scheduled has run: the copy still shares the original's blob when the original is purged.
    expect((await fileRow(t, copyImage!))!.storageId).toBe(image.storageId);
    await deleteForGood(t, a, original, "Sketches");
    expect(await blobExists(t, image.storageId)).toBe(true);
    expect(await url(a, copyImage!)).toBeTruthy();
    // The copy gets its own bytes, and the original's (now unused) are deleted.
    await drain(t);
    const row = (await fileRow(t, copyImage!))!;
    expect(row.storageId).not.toBe(image.storageId);
    expect(row.bytes).toBe("sketch");
    expect(await blobExists(t, image.storageId)).toBe(false);
  });

  test("a note from a template owns its images: purging the template keeps them", async () => {
    vi.useFakeTimers();
    const t = setup();
    const a = await person(t, "tpl-files@example.com");
    const template = await newDoc(a, "Mood board", { kind: "template" });
    const image = await uploadInto(t, template, "board");
    await addImage(a, template, image.publicId);
    const note = await newDoc(a, "October board", { templateId: template });
    const [noteImage] = await imageFileIds(a, note);
    expect(noteImage).toBeTruthy();
    expect(noteImage).not.toBe(image.publicId);
    expect((await fileRow(t, noteImage!))!.notePublicId).toBe(note);
    await drain(t);

    await deleteForGood(t, a, template, "Mood board");
    await drain(t);
    expect(await fileRow(t, image.publicId)).toBeNull();
    const row = (await fileRow(t, noteImage!))!;
    expect(await blobExists(t, row.storageId)).toBe(true);
    expect(row.bytes).toBe("board");
    expect(await url(a, noteImage!)).toBeTruthy();
  });

  test("a copy of a version owns its images", async () => {
    vi.useFakeTimers();
    const t = setup();
    const a = await person(t, "version-files@example.com");
    const original = await newDoc(a, "Plans");
    const image = await uploadInto(t, original, "plan");
    await addImage(a, original, image.publicId);
    const version = await a.as.mutation(api.documents.createSnapshot, { documentId: original, reason: "manual" });
    const copy = await a.as.mutation(api.documents.copyVersion, { snapshotId: version.id! });
    const [copyImage] = await imageFileIds(a, copy.id);
    expect(copyImage).not.toBe(image.publicId);
    expect((await fileRow(t, copyImage!))!.notePublicId).toBe(copy.id);
    await drain(t);
    await deleteForGood(t, a, original, "Plans");
    await drain(t);
    expect((await fileRow(t, copyImage!))!.bytes).toBe("plan");
    expect(await url(a, copyImage!)).toBeTruthy();
  });

  test("a copy is refused when its files don't fit in storage", async () => {
    const t = setup();
    const a = await person(t, "dup-full@example.com");
    const original = await newDoc(a, "Big");
    const image = await uploadInto(t, original, "huge");
    await addImage(a, original, image.publicId);
    await t.run(async (ctx) => {
      await ctx.db.patch(a.profileId as Id<"profiles">, { personalStorageUsedBytes: 1024 ** 4 });
    });
    await expect(a.as.mutation(api.documents.duplicate, { documentId: original })).rejects.toThrow(/storage/);
  });
});
