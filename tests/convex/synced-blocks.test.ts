// Synced blocks (convex/lib/synced.ts, docs/SYNCED_BLOCKS.md): one piece of content shown in several notes.
// The content is a document of kind "synced", edited through sync like a note; notes show it through `synced`
// blocks. Covers who can see and edit it, several notes showing it, unsyncing, deleting (Trash semantics),
// lists and search, share pages and the readers Foli AI, MCP and exports use.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { rankSequence, SCHEMA_VERSION, type SyncOp, type WireBlock } from "@folevi/editor-schema";
import { withSyncedForReader, withSyncedShared } from "../../convex/lib/synced";
import { inWorkspace, join, para, person, PERSONAL, setup, teamWorkspace, ulid, type ScopeArg, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

afterEach(() => {
  vi.useRealTimers();
});

const syncedBlock = (id: string, sourceId: string, rank = "V"): WireBlock => ({ id, type: "synced", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [], props: { sourceId } });

async function push(p: Person, ops: SyncOp[], scope: ScopeArg = PERSONAL) {
  return await p.as.mutation(api.sync.push, { scope, deviceId: "device-synced", ops });
}

const upsertOp = (documentId: string, block: WireBlock, baseRevision: number | null = null): SyncOp => ({ opId: ulid(), kind: "block.upsert", documentId, block, baseRevision, fields: ["content", "position"] });

async function note(p: Person, scope: ScopeArg, title: string) {
  const { id } = await p.as.mutation(api.documents.create, { scope, title });
  return id;
}

/**
 * "Turn into synced block" as the editor does it: the content is created in the note's place with its blocks,
 * and the note gets a synced block showing it. Returns the content's id, its first block and the synced block.
 */
async function makeSynced(p: Person, noteId: string, scope: ScopeArg, text: string) {
  const sourceId = ulid();
  const first = para(ulid(), text);
  const ref = ulid();
  const results = await push(p, [
    { opId: ulid(), kind: "document.create", document: { id: sourceId, parentDocumentId: null, folderId: null, kind: "synced", title: "", icon: null, scope } },
    upsertOp(sourceId, first),
    upsertOp(noteId, syncedBlock(ref, sourceId)),
  ]);
  expect(results.map((r) => r.status)).toEqual(["applied", "applied", "applied"]);
  return { sourceId, first, ref };
}

/** Shows an existing synced content in another note ("Copy synced block", then paste). */
async function showIn(p: Person, noteId: string, sourceId: string) {
  const ref = ulid();
  const [r] = await push(p, [upsertOp(noteId, syncedBlock(ref, sourceId))]);
  return { ref, result: r! };
}

async function sourceRow(t: T, sourceId: string) {
  return await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", sourceId)).unique())!);
}

async function listed(p: Person, scope: ScopeArg, view: "all" | "trash" | "unsorted") {
  const r = await p.as.query(api.documents.list, { scope, view, paginationOpts: { numItems: 200, cursor: null } });
  return r.page.map((d) => d.id);
}

describe("synced blocks: content shown in several notes", () => {
  test("turning blocks into a synced block keeps the content out of lists and search, and in the note", async () => {
    const t = setup();
    const a = await person(t, "sync-a@example.com");
    const n1 = await note(a, PERSONAL, "Weekly plan");
    const { sourceId } = await makeSynced(a, n1, PERSONAL, "Quarterly kumquat goals");

    const info = await a.as.query(api.synced.info, { sourceId });
    expect(info).toMatchObject({ status: "ok", canEdit: true, inTrash: false, noteCount: 1 });
    expect(info.status === "ok" && info.notes.map((n) => n.id)).toEqual([n1]);
    expect((await a.as.query(api.blocks.list, { documentId: sourceId }))!.blocks.map((b) => b.text[0])).toEqual([{ type: "text", text: "Quarterly kumquat goals" }]);

    // Never a page of its own: not in All notes, Drafts or Trash, not found by search; the note is.
    expect(await listed(a, PERSONAL, "all")).not.toContain(sourceId);
    expect(await listed(a, PERSONAL, "unsorted")).not.toContain(sourceId);
    expect(await listed(a, PERSONAL, "trash")).not.toContain(sourceId);
    const hits = await a.as.query(api.search.documents, { scope: PERSONAL, query: "kumquat" });
    expect(hits.map((h) => h.id)).toEqual([n1]);
    // Its kind says what it is (a link to it opens a note showing it instead, synced.home).
    expect((await a.as.query(api.documents.get, { documentId: sourceId }))!.document.kind).toBe("synced");
    expect(await a.as.query(api.synced.home, { sourceId })).toMatchObject({ documentId: n1 });
  });

  test("several notes show the same content; an edit in one shows in all", async () => {
    vi.useFakeTimers();
    const t = setup();
    const a = await person(t, "multi-a@example.com");
    const n1 = await note(a, PERSONAL, "One");
    const n2 = await note(a, PERSONAL, "Two");
    const n3 = await note(a, PERSONAL, "Three");
    const { sourceId, first } = await makeSynced(a, n1, PERSONAL, "Shared plan");
    expect((await showIn(a, n2, sourceId)).result.status).toBe("applied");
    expect((await showIn(a, n3, sourceId)).result.status).toBe("applied");
    // The same content shown twice in one note counts the note once.
    await showIn(a, n3, sourceId);
    const info = await a.as.query(api.synced.info, { sourceId });
    expect(info.status === "ok" && [info.noteCount, info.notes.map((n) => n.id).sort()]).toEqual([3, [n1, n2, n3].sort()]);

    // Edited "in note two": it's the content that changes, so every note shows it.
    const current = (await a.as.query(api.blocks.list, { documentId: sourceId }))!.blocks[0]!;
    const [edit] = await push(a, [upsertOp(sourceId, { ...first, text: [{ type: "text", text: "Shared plan, revised with persimmons" }] }, current.revision!)]);
    expect(edit!.status).toBe("applied");
    expect((await a.as.query(api.blocks.list, { documentId: sourceId }))!.blocks[0]!.text).toEqual([{ type: "text", text: "Shared plan, revised with persimmons" }]);
    // Every note showing it is found by the new words (once the edit settles into the notes' search text).
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const hits = await a.as.query(api.search.documents, { scope: PERSONAL, query: "persimmons" });
    expect(hits.map((h) => h.id).sort()).toEqual([n1, n2, n3].sort());
  });

  test("members edit it through the notes showing it; view-only members and guests only read it", async () => {
    const t = setup();
    const owner = await person(t, "perm-owner@example.com");
    const editor = await person(t, "perm-editor@example.com");
    const viewer = await person(t, "perm-viewer@example.com");
    const guest = await person(t, "perm-guest@example.com");
    const { workspaceId } = await teamWorkspace(owner, "Synced team");
    const ws = inWorkspace(workspaceId);
    await join(t, owner, editor, "perm-editor@example.com", workspaceId, "editor");
    await join(t, owner, viewer, "perm-viewer@example.com", workspaceId, "viewer");
    const n1 = await note(owner, ws, "Team note");
    const { sourceId, first } = await makeSynced(owner, n1, ws, "Launch checklist");
    await owner.as.mutation(api.sharing.grant, { documentId: n1, email: "perm-guest@example.com", role: "viewer" });

    expect(await editor.as.query(api.synced.info, { sourceId })).toMatchObject({ status: "ok", canEdit: true });
    expect(await viewer.as.query(api.synced.info, { sourceId })).toMatchObject({ status: "ok", canEdit: false });
    // A guest who can view the note sees the content read-only.
    expect(await guest.as.query(api.synced.info, { sourceId })).toMatchObject({ status: "ok", canEdit: false });
    expect((await guest.as.query(api.blocks.list, { documentId: sourceId }))!.blocks).toHaveLength(1);

    const rev = (await owner.as.query(api.blocks.list, { documentId: sourceId }))!.blocks[0]!.revision!;
    const byEditor = await push(editor, [upsertOp(sourceId, { ...first, text: [{ type: "text", text: "Launch checklist (editor)" }] }, rev)], ws);
    expect(byEditor[0]!.status).toBe("applied");
    for (const reader of [viewer, guest]) {
      const [r] = await push(reader, [upsertOp(sourceId, { ...first, text: [{ type: "text", text: "Not allowed" }] }, rev + 1)]);
      expect(r!.status).toBe("rejected");
      expect(r!.error!.code).toBe("forbidden");
    }
  });

  test("content shown only in a restricted note stays with the people who can open that note", async () => {
    const t = setup();
    const owner = await person(t, "restr-owner@example.com");
    const member = await person(t, "restr-member@example.com");
    const { workspaceId } = await teamWorkspace(owner, "Restricted team");
    const ws = inWorkspace(workspaceId);
    await join(t, owner, member, "restr-member@example.com", workspaceId, "editor");
    const secret = await note(owner, ws, "Salaries");
    await owner.as.mutation(api.sharing.setAccessMode, { documentId: secret, mode: "restricted" });
    const { sourceId } = await makeSynced(owner, secret, ws, "Pay bands");
    // A member of the workspace who can't open the note can't open the content either.
    expect(await member.as.query(api.synced.info, { sourceId })).toEqual({ status: "forbidden" });
    expect(await member.as.query(api.blocks.list, { documentId: sourceId })).toBeNull();
    // Nor put it into a note of their own.
    const mine = await note(member, ws, "Mine");
    const { result } = await showIn(member, mine, sourceId);
    expect(result.status).toBe("rejected");
    expect(result.error!.code).toBe("not_found");
    // Once it's in a note they can open, it's part of that note for them.
    const open = await note(owner, ws, "Open note");
    await showIn(owner, open, sourceId);
    expect(await member.as.query(api.synced.info, { sourceId })).toMatchObject({ status: "ok", canEdit: true });
  });

  test("across places: a note in another place shows it only to people who can open it; nobody can show content they can't read", async () => {
    const t = setup();
    const owner = await person(t, "cross-owner@example.com");
    const guest = await person(t, "cross-guest@example.com");
    const stranger = await person(t, "cross-stranger@example.com");
    const { workspaceId } = await teamWorkspace(owner, "Cross team");
    const ws = inWorkspace(workspaceId);
    const teamNote = await note(owner, ws, "Team note");
    const { sourceId } = await makeSynced(owner, teamNote, ws, "Team roadmap");
    // The owner shows the team's content in a note of their own Personal and shares that note.
    const personal = await note(owner, PERSONAL, "My view");
    expect((await showIn(owner, personal, sourceId)).result.status).toBe("applied");
    await owner.as.mutation(api.sharing.grant, { documentId: personal, email: "cross-guest@example.com", role: "editor" });
    expect(await owner.as.query(api.synced.info, { sourceId })).toMatchObject({ status: "ok", noteCount: 2 });
    // The guest can edit the Personal note but not see the workspace's content in it.
    expect(await guest.as.query(api.synced.info, { sourceId })).toEqual({ status: "forbidden" });
    expect(await guest.as.query(api.blocks.list, { documentId: sourceId })).toBeNull();
    // Someone who can't read it can't show it anywhere (an id alone opens nothing).
    const theirs = await note(stranger, PERSONAL, "Stranger");
    const { result } = await showIn(stranger, theirs, sourceId);
    expect(result.status).toBe("rejected");
    expect(await stranger.as.query(api.synced.info, { sourceId })).toEqual({ status: "forbidden" });
    expect(await stranger.as.query(api.synced.info, { sourceId: ulid() })).toEqual({ status: "missing" });
  });

  test("a synced block never goes inside synced content, and synced content is never nested or filed", async () => {
    const t = setup();
    const a = await person(t, "nest-a@example.com");
    const n1 = await note(a, PERSONAL, "Note");
    const { sourceId } = await makeSynced(a, n1, PERSONAL, "Outer");
    const { sourceId: other } = await makeSynced(a, n1, PERSONAL, "Other");
    const [r] = await push(a, [upsertOp(sourceId, syncedBlock(ulid(), other))]);
    expect(r!.status).toBe("rejected");
    expect(r!.error!.code).toBe("invalid_block");
    const [nested] = await push(a, [{ opId: ulid(), kind: "document.create", document: { id: ulid(), parentDocumentId: n1, folderId: null, kind: "synced", title: "", icon: null } }]);
    expect(nested!.status).toBe("rejected");
  });

  test("unsync: the note keeps ordinary blocks; content no note shows goes to Trash with nothing removed, and comes back", async () => {
    const t = setup();
    const a = await person(t, "unsync-a@example.com");
    const n1 = await note(a, PERSONAL, "One");
    const n2 = await note(a, PERSONAL, "Two");
    const { sourceId, ref } = await makeSynced(a, n1, PERSONAL, "Agenda");
    const { ref: ref2 } = await showIn(a, n2, sourceId);

    // Unsync in note one (what the editor sends): copies of the content as ordinary blocks, the synced block deleted.
    const [r1, r2] = rankSequence(2);
    const copy = para(ulid(), "Agenda", r1!);
    const res = await push(a, [upsertOp(n1, copy), { opId: ulid(), kind: "block.delete", documentId: n1, blockId: ref, baseRevision: null }]);
    expect(res.map((r) => r.status)).toEqual(["applied", "applied"]);
    void r2;
    expect((await a.as.query(api.blocks.list, { documentId: n1 }))!.blocks.map((b) => b.type)).toEqual(["paragraph"]);
    // Still shown in note two.
    expect(await a.as.query(api.synced.info, { sourceId })).toMatchObject({ status: "ok", noteCount: 1, inTrash: false });

    // The last one goes: the content waits in Trash (not listed as a page), its blocks intact.
    await push(a, [{ opId: ulid(), kind: "block.delete", documentId: n2, blockId: ref2, baseRevision: null }]);
    expect((await sourceRow(t, sourceId)).inTrash).toBe(true);
    expect(await listed(a, PERSONAL, "trash")).not.toContain(sourceId);
    expect((await a.as.query(api.blocks.list, { documentId: sourceId }))!.blocks).toHaveLength(1);
    expect(await a.as.query(api.synced.info, { sourceId })).toMatchObject({ status: "ok", inTrash: true, canEdit: false, noteCount: 0 });

    // Undo in note two brings the synced block back, and with it the content.
    const [back] = await push(a, [{ opId: ulid(), kind: "block.restore", documentId: n2, blockId: ref2 }]);
    expect(back!.status).toBe("applied");
    expect((await sourceRow(t, sourceId)).inTrash).toBe(false);
    expect(await a.as.query(api.synced.info, { sourceId })).toMatchObject({ status: "ok", inTrash: false, canEdit: true, noteCount: 1 });
  });

  test("moving the notes showing it to Trash takes the content with them; restoring one brings it back", async () => {
    const t = setup();
    const a = await person(t, "trash-a@example.com");
    const n1 = await note(a, PERSONAL, "Only note");
    const { sourceId } = await makeSynced(a, n1, PERSONAL, "Recipe");
    await a.as.mutation(api.documents.moveToTrash, { documentId: n1 });
    expect((await sourceRow(t, sourceId)).inTrash).toBe(true);
    // The Trash lists the note, not the content.
    const trash = await listed(a, PERSONAL, "trash");
    expect(trash).toContain(n1);
    expect(trash).not.toContain(sourceId);
    const summary = await a.as.query(api.documents.trashSummary, { scope: PERSONAL });
    expect(summary.total).toBe(1);
    await a.as.mutation(api.documents.restoreFromTrash, { documentId: n1 });
    expect((await sourceRow(t, sourceId)).inTrash).toBe(false);
    // A duplicate of the note shows the same content (and counts as showing it).
    await a.as.mutation(api.documents.duplicate, { documentId: n1 });
    expect(await a.as.query(api.synced.info, { sourceId })).toMatchObject({ status: "ok", noteCount: 2 });
  });

  test("share pages show content from the note's own place, never from another place", async () => {
    const t = setup();
    const owner = await person(t, "share-owner@example.com");
    const { workspaceId } = await teamWorkspace(owner, "Share team");
    const ws = inWorkspace(workspaceId);
    const pub = await note(owner, PERSONAL, "Public note");
    await makeSynced(owner, pub, PERSONAL, "Personal shared paragraph");
    const teamNote = await note(owner, ws, "Team note");
    const { sourceId: teamSource } = await makeSynced(owner, teamNote, ws, "Confidential team paragraph");
    await showIn(owner, pub, teamSource);
    const { token } = await owner.as.mutation(api.sharing.createPublicLink, { documentId: pub });
    const opened = await t.mutation(api.sharing.openPublicLink, { token, serverSecret: "a".repeat(64), clientKey: "client" });
    expect(opened.status).toBe("ok");
    const texts = opened.status === "ok" ? opened.blocks.map((b) => (b.text[0] as { text?: string } | undefined)?.text) : [];
    expect(texts).toContain("Personal shared paragraph");
    expect(texts).not.toContain("Confidential team paragraph");
    expect(opened.status === "ok" && opened.blocks.some((b) => b.type === "synced")).toBe(false);
  });

  test("Foli AI, MCP and exports read the content as part of the note, as far as the reader may see it", async () => {
    const t = setup();
    const owner = await person(t, "read-owner@example.com");
    const guest = await person(t, "read-guest@example.com");
    const { workspaceId } = await teamWorkspace(owner, "Read team");
    const ws = inWorkspace(workspaceId);
    const teamNote = await note(owner, ws, "Team");
    const { sourceId } = await makeSynced(owner, teamNote, ws, "Team words");
    const mine = await note(owner, PERSONAL, "Mine");
    await showIn(owner, mine, sourceId);
    await owner.as.mutation(api.sharing.grant, { documentId: mine, email: "read-guest@example.com", role: "viewer" });
    const read = async (who: Person) =>
      await t.run(async (ctx) => {
        const profile = (await ctx.db.get(who.profileId as never))!;
        const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", mine)).unique())!;
        const rows = await ctx.db.query("blocks").withIndex("by_document_deleted", (q) => q.eq("documentId", doc._id).eq("deletedAt", undefined)).collect();
        const blocks = rows.map((r) => ({ id: r.blockId, type: r.type, parentId: r.parentId, rank: r.rank, schemaVersion: r.schemaVersion, text: r.text, props: r.props }) as WireBlock);
        return {
          reader: (await withSyncedForReader(ctx, profile, blocks)).map((b) => (b.text[0] as { text?: string } | undefined)?.text),
          shared: (await withSyncedShared(ctx, doc, blocks)).blocks.length,
        };
      });
    expect((await read(owner)).reader).toEqual(["Team words"]);
    // The guest on the Personal note can't see the workspace's content: it's left out for them.
    expect((await read(guest)).reader).toEqual([]);
    // Text everyone who can read the note sees (search, share pages) leaves out another place's content.
    expect((await read(owner)).shared).toBe(0);
  });
});
