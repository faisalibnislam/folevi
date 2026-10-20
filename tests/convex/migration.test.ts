// Moving between a library on the person's devices and their account (docs/LOCAL_MODE_PLAN.md §6, WP12): the
// server pieces. migration.preflight says whether a library fits (bytes and counts, never a price);
// migration.documents lists every note of a place (Trash, Archive, nested pages, rows, synced content), only
// for people who manage it; migration.fileTexts gives the text found in a note's files to people who can edit
// it; documents.importSnapshot keeps a version brought along (owner only, size and rate limited, idempotent);
// collections.create takes the client's id.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_IMPORTED_SNAPSHOT_BYTES, MAX_IMPORTED_SNAPSHOTS_PER_NOTE } from "../../convex/documents";
import { join, para, PERSONAL, person, setup, teamWorkspace, ulid } from "./helpers";

process.env.BETTER_AUTH_SECRET ??= "test-secret-".repeat(4);

type Person = Awaited<ReturnType<typeof person>>;

async function push(p: Person, ops: unknown[], scope: Person["scope"] = PERSONAL) {
  const results = await p.as.mutation(api.sync.push, { scope, deviceId: "device-migration", ops: ops as never });
  for (const r of results) expect(r.status, JSON.stringify(r)).toBe("applied");
  return results;
}

async function newNote(p: Person, title: string, o: { parent?: string; kind?: "document" | "synced" | "template"; scope?: Person["scope"] } = {}) {
  const id = ulid();
  await push(p, [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: o.parent ?? null, folderId: null, kind: o.kind ?? "document", title, icon: null } }], o.scope);
  return id;
}

const counts = { notes: 3, folders: 1, tags: 1, files: 2, fileBytes: 10, largestFileBytes: 6 };

async function allDocuments(p: Person, scope: Person["scope"] = PERSONAL) {
  const out = [];
  let cursor: string | null = null;
  for (;;) {
    const r = await p.as.query(api.migration.documents, { scope, paginationOpts: { numItems: 4, cursor } });
    out.push(...r.page);
    if (r.isDone) return out;
    cursor = r.continueCursor;
  }
}

describe("migration.preflight", () => {
  test("says the files fit, and how many notes the account has already", async () => {
    const t = setup();
    const p = await person(t, "pre-fits@example.com");
    const r = await p.as.query(api.migration.preflight, counts);
    expect(r.fits).toBe(true);
    expect(r.shortByBytes).toBe(0);
    expect(r.neededBytes).toBe(10);
    expect(r.limitBytes).toBeGreaterThan(0);
    expect(r.availableBytes).toBe(r.limitBytes - r.usedBytes);
    expect(r.tooLarge).toBe(false);
    expect(r.writable).toBe(true);
    // The seeded welcome notes are there.
    expect(r.existingNotes).toBeGreaterThan(0);
    expect(r.existingMore).toBe(false);
    // Facts only: nothing about a plan's price or an upgrade.
    expect(JSON.stringify(r)).not.toMatch(/price|\$|upgrade|plan/i);
  });

  test("reports a shortfall in bytes, and a file over the limit for one file", async () => {
    const t = setup();
    const p = await person(t, "pre-short@example.com");
    const before = await p.as.query(api.migration.preflight, counts);
    await t.run(async (ctx) => {
      await ctx.db.patch(p.profileId as Id<"profiles">, { personalStorageUsedBytes: before.limitBytes - 4 });
    });
    const r = await p.as.query(api.migration.preflight, { ...counts, largestFileBytes: before.maxFileBytes + 1 });
    expect(r.fits).toBe(false);
    expect(r.availableBytes).toBe(4);
    expect(r.shortByBytes).toBe(6);
    expect(r.tooLarge).toBe(true);
  });

  test("refuses negative counts and needs someone signed in", async () => {
    const t = setup();
    const p = await person(t, "pre-bad@example.com");
    await expect(p.as.query(api.migration.preflight, { ...counts, files: -1 })).rejects.toThrow(/negative/);
    await expect(t.query(api.migration.preflight, counts)).rejects.toThrow();
  });
});

describe("migration.documents", () => {
  test("lists every note of Personal: Trash, Archive, nested pages, templates, synced content and rows", async () => {
    const t = setup();
    const p = await person(t, "docs-all@example.com");
    const top = await newNote(p, "Top");
    const child = await newNote(p, "Child", { parent: top });
    const synced = await newNote(p, "Shared words", { kind: "synced" });
    const template = await newNote(p, "Weekly", { kind: "template" });
    const trashed = await newNote(p, "Old");
    const archived = await newNote(p, "Done");
    await p.as.mutation(api.documents.moveToTrash, { documentId: trashed });
    await p.as.mutation(api.documents.setArchived, { documentId: archived, archived: true });
    await p.as.mutation(api.documents.setStarred, { documentId: top, starred: true });
    const { id: tagId } = await p.as.mutation(api.organization.createTag, { scope: PERSONAL, name: "travel" });
    await p.as.mutation(api.organization.setDocumentTags, { documentId: top, tagIds: [tagId] });
    const { collectionId } = await p.as.mutation(api.collections.create, { documentId: top });
    const row = await p.as.mutation(api.collections.addRow, { collectionId, title: "A row" });

    const docs = await allDocuments(p);
    const byId = new Map(docs.map((d) => [d.id, d]));
    expect(new Set(docs.map((d) => d.id)).size).toBe(docs.length);
    expect(byId.get(child)).toMatchObject({ parentDocumentId: top, kind: "document", inTrash: false });
    expect(byId.get(synced)).toMatchObject({ kind: "synced" });
    expect(byId.get(template)).toMatchObject({ kind: "template" });
    expect(byId.get(trashed)).toMatchObject({ inTrash: true });
    expect(byId.get(archived)?.archivedAt).toEqual(expect.any(Number));
    expect(byId.get(top)).toMatchObject({ starred: true, tagIds: [tagId], hasComments: false, shared: false });
    expect(byId.get(row.documentId)).toMatchObject({ kind: "collectionRow", collectionId, parentDocumentId: top });
    // The seeded notes too.
    expect(docs.length).toBeGreaterThan(8);
  });

  test("a workspace only for its owners and admins; never someone else's Personal", async () => {
    const t = setup();
    const owner = await person(t, "docs-owner@example.com");
    const editor = await person(t, "docs-editor@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner, "Studio");
    await join(t, owner, editor, "docs-editor@example.com", workspaceId, "editor");
    const note = await newNote(owner, "Team note", { scope });
    expect((await allDocuments(owner, scope)).map((d) => d.id)).toContain(note);
    await expect(editor.as.query(api.migration.documents, { scope, paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow();
    // Their own Personal holds only their own notes.
    const mine = await allDocuments(editor);
    expect(mine.map((d) => d.id)).not.toContain(note);
  });

  test("says which notes have comments or are shared", async () => {
    const t = setup();
    const p = await person(t, "docs-shared@example.com");
    const note = await newNote(p, "Shared");
    await t.run(async (ctx) => {
      const doc = (await ctx.db
        .query("documents")
        .withIndex("by_public_id", (q) => q.eq("publicId", note))
        .unique())!;
      await ctx.db.patch(doc._id, { accessMode: "restricted" });
    });
    expect((await allDocuments(p)).find((d) => d.id === note)).toMatchObject({ shared: true });
  });
});

describe("migration.fileTexts", () => {
  test("gives the found text itself to someone who can edit the note", async () => {
    const t = setup();
    const p = await person(t, "texts@example.com");
    const note = await newNote(p, "Drawing");
    const blockId = ulid();
    await push(p, [{ opId: ulid(), kind: "block.upsert", documentId: note, block: { ...para(blockId, ""), type: "whiteboard", props: { data: JSON.stringify({ strokes: [] }), height: 300 } }, baseRevision: null, fields: ["content", "position"] }]);
    await p.as.mutation(api.fileText.save, { documentId: note, blockId, source: "handwriting", text: "buy milk", hash: "a".repeat(64) });
    const rows = await p.as.query(api.migration.fileTexts, { documentId: note });
    expect(rows).toEqual([{ fileId: null, blockId, source: "handwriting", by: "device", text: "buy milk", pageStarts: null, hash: "a".repeat(64) }]);
    const other = await person(t, "texts-other@example.com");
    await expect(other.as.query(api.migration.fileTexts, { documentId: note })).rejects.toThrow();
  });
});

describe("documents.importSnapshot", () => {
  const version = (id = ulid()) => ({ id, title: "Trip, before", icon: "⛴", blocks: [para(ulid(), "An old line")], createdAt: Date.UTC(2026, 0, 2) });

  test("keeps a version as it was, with its own time, once", async () => {
    const t = setup();
    const p = await person(t, "import-ok@example.com");
    const note = await newNote(p, "Trip");
    const v = version();
    expect(await p.as.mutation(api.documents.importSnapshot, { documentId: note, ...v, name: "Before the trip" })).toEqual({ id: v.id, created: true });
    // Sent again (its answer was lost): the same version, not a second one.
    expect(await p.as.mutation(api.documents.importSnapshot, { documentId: note, ...v })).toEqual({ id: v.id, created: false });
    const list = await p.as.query(api.documents.versions, { documentId: note });
    const imported = list.versions.filter((x) => x.reason === "import");
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({ id: v.id, name: "Before the trip", title: "Trip, before", createdAt: Date.UTC(2026, 0, 2), blockCount: 1 });
    const content = await p.as.query(api.documents.snapshotContent, { snapshotId: v.id });
    const parsed = JSON.parse(content!.content!) as { title: string; icon: string; blocks: { text: { text: string }[] }[] };
    expect(parsed.title).toBe("Trip, before");
    expect(parsed.icon).toBe("⛴");
    expect(parsed.blocks[0]!.text[0]!.text).toBe("An old line");
    // A version saved later still sees the note as changed (an imported one never stands for "now").
    await push(p, [{ opId: ulid(), kind: "block.upsert", documentId: note, block: para(ulid(), "New"), baseRevision: null, fields: ["content", "position"] }]);
    expect(await p.as.mutation(api.documents.createSnapshot, { documentId: note, reason: "manual" })).toMatchObject({ created: true });
  });

  test("never in the future", async () => {
    const t = setup();
    const p = await person(t, "import-future@example.com");
    const note = await newNote(p, "Later");
    const v = { ...version(), createdAt: Date.now() + 10 * 86_400_000 };
    await p.as.mutation(api.documents.importSnapshot, { documentId: note, ...v });
    const list = await p.as.query(api.documents.versions, { documentId: note });
    expect(list.versions.find((x) => x.id === v.id)!.createdAt).toBeLessThanOrEqual(Date.now());
  });

  test("only the note's owner, only into their own Personal", async () => {
    const t = setup();
    const owner = await person(t, "import-owner@example.com");
    const editor = await person(t, "import-editor@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner, "Team");
    await join(t, owner, editor, "import-editor@example.com", workspaceId, "editor");
    const teamNote = await newNote(owner, "Team note", { scope });
    // A workspace note has no single owner: refused, even for the workspace's owner.
    await expect(owner.as.mutation(api.documents.importSnapshot, { documentId: teamNote, ...version() })).rejects.toThrow(/owner/);
    await expect(editor.as.mutation(api.documents.importSnapshot, { documentId: teamNote, ...version() })).rejects.toThrow(/owner/);
    const mine = await newNote(owner, "Mine");
    await expect(editor.as.mutation(api.documents.importSnapshot, { documentId: mine, ...version() })).rejects.toThrow();
    // A version id is the one note's.
    const v = version();
    await owner.as.mutation(api.documents.importSnapshot, { documentId: mine, ...v });
    const other = await newNote(owner, "Other");
    await expect(owner.as.mutation(api.documents.importSnapshot, { documentId: other, ...v })).rejects.toThrow(/taken/);
    await expect(owner.as.mutation(api.documents.importSnapshot, { documentId: other, ...version("not an id!") })).rejects.toThrow(/Invalid/);
  });

  test("size limits: the content, and how many a note keeps", async () => {
    const t = setup();
    const p = await person(t, "import-size@example.com");
    const note = await newNote(p, "Big");
    const huge = [para(ulid(), "x".repeat(Math.ceil(MAX_IMPORTED_SNAPSHOT_BYTES / 2))), para(ulid(), "y".repeat(Math.ceil(MAX_IMPORTED_SNAPSHOT_BYTES / 2)))];
    await expect(p.as.mutation(api.documents.importSnapshot, { documentId: note, ...version(), blocks: huge })).rejects.toThrow(/too big/);
    await t.run(async (ctx) => {
      const doc = (await ctx.db
        .query("documents")
        .withIndex("by_public_id", (q) => q.eq("publicId", note))
        .unique())!;
      for (let i = 0; i < MAX_IMPORTED_SNAPSHOTS_PER_NOTE; i++) {
        await ctx.db.insert("documentSnapshots", {
          documentId: doc._id,
          ownerProfileId: doc.ownerProfileId,
          publicId: ulid(),
          reason: "import",
          title: "v",
          chunkCount: 0,
          blockCount: 0,
          sizeBytes: 0,
          contentSeq: -1,
          createdBy: doc.createdBy,
          createdAt: i,
        });
      }
    });
    await expect(p.as.mutation(api.documents.importSnapshot, { documentId: note, ...version() })).rejects.toThrow(/as much imported history/);
  });

  test("rate limited per person", async () => {
    const t = setup();
    const p = await person(t, "import-rate@example.com");
    await t.run(async (ctx) => {
      await ctx.db.insert("systemSettings", { key: "rate_limits", value: { snapshotImport: { limit: 2, windowMs: 60 * 60_000 } }, updatedAt: Date.now() } as never);
    });
    const note = await newNote(p, "Many");
    await p.as.mutation(api.documents.importSnapshot, { documentId: note, ...version() });
    await p.as.mutation(api.documents.importSnapshot, { documentId: note, ...version() });
    await expect(p.as.mutation(api.documents.importSnapshot, { documentId: note, ...version() })).rejects.toThrow(/Too many/);
  });
});

describe("collections.create with the client's id", () => {
  test("makes the collection under that id, and a resend returns it", async () => {
    const t = setup();
    const p = await person(t, "coll-id@example.com");
    const host = await newNote(p, "Shelf");
    const id = ulid();
    const first = await p.as.mutation(api.collections.create, { documentId: host, id, name: "Books" });
    expect(first.collectionId).toBe(id);
    const again = await p.as.mutation(api.collections.create, { documentId: host, id, name: "Books" });
    expect(again).toEqual(first);
    const got = await p.as.query(api.collections.get, { collectionId: id });
    expect(got).toMatchObject({ id, name: "Books" });
    expect(got!.views).toHaveLength(1);
    // Taken by another note's collection, or not an id: refused.
    const other = await newNote(p, "Other");
    await expect(p.as.mutation(api.collections.create, { documentId: other, id })).rejects.toThrow(/taken/);
    await expect(p.as.mutation(api.collections.create, { documentId: other, id: "no such id!" })).rejects.toThrow(/Invalid/);
  });
});
