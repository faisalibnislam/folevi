// The device copy's server side (docs/NATIVE_APP_PLAN.md §11, R1): sync.manifest lists a scope's notes a page
// at a time, sync.pullDocs hands over whole notes, sync.pullAll (pull v2) carries what changed since a cursor,
// notes deleted for good included. All permission-checked; sealed or locked notes never travel with content.
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { join, para, person, PERSONAL, setup, teamWorkspace, ulid } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;
type Scope = Person["scope"];

async function create(p: Person, title: string, scope: Scope = PERSONAL) {
  const id = ulid();
  const [r] = await p.as.mutation(api.sync.push, {
    scope,
    deviceId: "device-copy-test",
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } }],
  });
  expect(r!.status).toBe("applied");
  return id;
}

async function write(p: Person, documentId: string, text: string, blockId = ulid(), scope: Scope = PERSONAL) {
  const [r] = await p.as.mutation(api.sync.push, {
    scope,
    deviceId: "device-copy-test",
    ops: [{ opId: ulid(), kind: "block.upsert", documentId, block: para(blockId, text), baseRevision: null, fields: ["content", "position"] }],
  });
  expect(r!.status).toBe("applied");
  return blockId;
}

async function editBlock(p: Person, documentId: string, blockId: string, text: string, baseRevision: number | null) {
  const [r] = await p.as.mutation(api.sync.push, {
    scope: PERSONAL,
    deviceId: "device-copy-test",
    ops: [{ opId: ulid(), kind: "block.upsert", documentId, block: para(blockId, text), baseRevision, fields: ["content"] }],
  });
  expect(r!.status).toBe("applied");
}

/** Every page of the manifest, as a device's first fill reads it. */
async function wholeManifest(p: Person, scope: Scope, limit: number) {
  const notes = [];
  let after = 0;
  let pages = 0;
  for (;;) {
    const page = await p.as.query(api.sync.manifest, { scope, after, limit });
    pages++;
    notes.push(...page.notes);
    if (page.next === null) return { notes, pages };
    expect(page.next).toBeGreaterThan(after);
    after = page.next;
  }
}

/** Every page of pull v2 from a cursor, as a device keeping its copy fresh reads it. */
async function pullAllFrom(p: Person, scope: Scope, cursor: number, limit = 300) {
  const out = { documents: [] as { id: string }[], blocks: [] as { documentId: string; block: { id: string; text: unknown }; deleted: boolean; seq: number }[], removed: [] as { kind: string; id: string }[], folders: [] as { id: string }[], cursor };
  for (;;) {
    const page = await p.as.query(api.sync.pullAll, { scope, cursor: out.cursor, limit });
    out.documents.push(...page.documents);
    out.blocks.push(...(page.blocks as never[]));
    out.removed.push(...page.removed);
    out.folders.push(...page.folders);
    out.cursor = page.nextCursor;
    if (!page.hasMore) return out;
  }
}

describe("sync.manifest", () => {
  test("lists every note of the scope a page at a time, with summaries and content counters", async () => {
    const t = setup();
    const a = await person(t, "copy-manifest@example.com");
    const made: string[] = [];
    for (let i = 0; i < 7; i++) made.push(await create(a, `Note ${i}`));
    await write(a, made[0]!, "first words");
    const { notes, pages } = await wholeManifest(a, PERSONAL, 3);
    expect(pages).toBeGreaterThan(2);
    const ids = notes.map((n) => n.id);
    for (const id of made) expect(ids).toContain(id);
    // No note twice, even though pages end where a seq does.
    expect(new Set(ids).size).toBe(ids.length);
    const first = notes.find((n) => n.id === made[0])!;
    expect(first.sealed).toBe(false);
    expect(first.summary?.title).toBe("Note 0");
    expect(first.head).toBeGreaterThan(0);
  });

  test("never lists someone else's notes", async () => {
    const t = setup();
    const a = await person(t, "copy-iso-a@example.com");
    const b = await person(t, "copy-iso-b@example.com");
    const secret = await create(a, "Not for b");
    const { notes } = await wholeManifest(b, PERSONAL, 50);
    expect(notes.map((n) => n.id)).not.toContain(secret);
    const pulled = await b.as.query(api.sync.pullDocs, { ids: [secret] });
    expect(pulled.notes).toEqual([{ id: secret, status: "missing" }]);
  });

  test("a locked note comes as an id only, and pullDocs keeps its content back", async () => {
    const t = setup();
    const a = await person(t, "copy-locked@example.com");
    const locked = await create(a, "Diary");
    await write(a, locked, "very private");
    await t.run(async (ctx) => {
      const doc = await ctx.db
        .query("documents")
        .withIndex("by_public_id", (q) => q.eq("publicId", locked))
        .unique();
      await ctx.db.patch(doc!._id, { locked: true });
    });
    const { notes } = await wholeManifest(a, PERSONAL, 50);
    expect(notes.find((n) => n.id === locked)).toMatchObject({ sealed: true, summary: null });
    expect((await a.as.query(api.sync.pullDocs, { ids: [locked] })).notes).toEqual([{ id: locked, status: "sealed" }]);
    const delta = await pullAllFrom(a, PERSONAL, 0);
    expect(delta.blocks.some((b) => b.documentId === locked)).toBe(false);
    expect(JSON.stringify(delta)).not.toContain("very private");
  });
});

describe("sync.pullDocs", () => {
  test("hands over whole notes as blocks.list has them", async () => {
    const t = setup();
    const a = await person(t, "copy-docs@example.com");
    const one = await create(a, "One");
    const two = await create(a, "Two");
    await write(a, one, "alpha");
    await write(a, one, "beta");
    await write(a, two, "gamma");
    const { notes } = await a.as.query(api.sync.pullDocs, { ids: [one, two, one] });
    expect(notes).toHaveLength(2);
    const listed = await a.as.query(api.blocks.list, { documentId: one });
    const got = notes.find((n) => n.id === one)!;
    expect(got.status).toBe("ok");
    if (got.status !== "ok") return;
    expect(got.blocks).toEqual(listed!.blocks);
    expect(got.contentSeq).toBe(listed!.contentSeq);
    expect(got.head).toBeGreaterThanOrEqual(listed!.head);
    expect(got.summary.title).toBe("One");
    await expect(a.as.query(api.sync.pullDocs, { ids: Array.from({ length: 51 }, () => ulid()) })).rejects.toThrow(/At most 50/);
  });

  test("a workspace member gets the workspace's notes; a non-member doesn't", async () => {
    const t = setup();
    const owner = await person(t, "copy-ws-owner@example.com");
    const member = await person(t, "copy-ws-member@example.com");
    const outsider = await person(t, "copy-ws-out@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, member, "copy-ws-member@example.com", workspaceId, "editor");
    const doc = await create(owner, "Team plan", scope);
    await write(owner, doc, "the plan", ulid(), scope);
    expect((await wholeManifest(member, scope, 50)).notes.map((n) => n.id)).toContain(doc);
    expect((await member.as.query(api.sync.pullDocs, { ids: [doc] })).notes[0]!.status).toBe("ok");
    await expect(outsider.as.query(api.sync.manifest, { scope, after: 0 })).rejects.toThrow();
    expect((await outsider.as.query(api.sync.pullDocs, { ids: [doc] })).notes[0]!.status).toBe("missing");
  });
});

describe("sync.pullAll", () => {
  test("carries edits, deletions of blocks, trash and notes deleted for good since a cursor", async () => {
    vi.useFakeTimers();
    const t = setup();
    const a = await person(t, "copy-delta@example.com");
    const doc = await create(a, "Changing");
    const kept = await write(a, doc, "stays");
    const gone = await write(a, doc, "goes");
    const start = (await a.as.query(api.sync.manifest, { scope: PERSONAL, after: 0, limit: 1 })).head;

    // Nothing changed: an empty page that keeps the cursor where it is.
    const quiet = await a.as.query(api.sync.pullAll, { scope: PERSONAL, cursor: start });
    expect(quiet).toMatchObject({ documents: [], blocks: [], removed: [], hasMore: false, nextCursor: start });

    const rev = (await a.as.query(api.blocks.list, { documentId: doc }))!.blocks.find((b) => b.id === kept)!.revision ?? null;
    await editBlock(a, doc, kept, "stays, edited", rev);
    await a.as.mutation(api.sync.push, { scope: PERSONAL, deviceId: "device-copy-test", ops: [{ opId: ulid(), kind: "block.delete", documentId: doc, blockId: gone, baseRevision: null }] });
    const { id: folderId } = await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Box" });
    const delta = await pullAllFrom(a, PERSONAL, start, 2);
    expect(delta.blocks.find((b) => b.block.id === kept)?.deleted).toBe(false);
    expect(delta.blocks.find((b) => b.block.id === gone)?.deleted).toBe(true);
    expect(JSON.stringify(delta.blocks.find((b) => b.block.id === kept)?.block.text)).toContain("stays, edited");
    // A copy that took these in is whole up to the note's content head, as the manifest says it.
    const taken = Math.max(...delta.blocks.filter((b) => b.documentId === doc).map((b) => b.seq));
    const listed = (await wholeManifest(a, PERSONAL, 50)).notes.find((n) => n.id === doc)!;
    expect(taken).toBe(listed.head);
    expect(listed.head).toBeLessThanOrEqual(delta.cursor);
    expect(delta.folders.map((f) => f.id)).toContain(folderId);

    // Trashed: the note's row says so. Deleted for good: a tombstone says it went.
    await a.as.mutation(api.documents.moveToTrash, { documentId: doc });
    const trashed = await pullAllFrom(a, PERSONAL, delta.cursor);
    expect((trashed.documents.find((d) => d.id === doc) as { summary: { deletedAt: number | null } } | undefined)?.summary.deletedAt).not.toBeNull();
    await a.as.mutation(api.documents.deletePermanently, { documentId: doc, confirmTitle: "Changing" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    for (let i = 0; i < 3; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
    const purged = await pullAllFrom(a, PERSONAL, trashed.cursor);
    expect(purged.removed).toContainEqual({ kind: "document", id: doc });
    // And the next device to fill never hears of it.
    expect((await wholeManifest(a, PERSONAL, 50)).notes.map((n) => n.id)).not.toContain(doc);
    vi.useRealTimers();
  });

  test("pages never split a change and reach the head", async () => {
    const t = setup();
    const a = await person(t, "copy-pages@example.com");
    const doc = await create(a, "Many lines");
    for (let i = 0; i < 12; i++) await write(a, doc, `line ${i}`);
    const all = await pullAllFrom(a, PERSONAL, 0, 3);
    const head = (await a.as.query(api.sync.head, { scope: PERSONAL })).seq;
    expect(all.cursor).toBe(head);
    const lines = all.blocks.filter((b) => b.documentId === doc).map((b) => b.block.id);
    expect(new Set(lines).size).toBe(12);
  });
});
