// Changes: what other people, connected apps and Foli AI changed in the notes someone has opened, since they
// last looked; marking it seen; undoing it; and who may see what.
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { inWorkspace, join, para, person, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function push(p: Person, workspaceId: string, ops: unknown[]) {
  return await p.as.mutation(api.sync.push, { scope: inWorkspace(workspaceId), deviceId: `device-${ulid()}`, ops: ops as never });
}

const upsert = (documentId: string, block: ReturnType<typeof para>, baseRevision: number | null = null) => ({
  opId: ulid(),
  kind: "block.upsert",
  documentId,
  block,
  baseRevision,
  fields: ["content", "position"],
});
const remove = (documentId: string, blockId: string) => ({ opId: ulid(), kind: "block.delete", documentId, blockId, baseRevision: null });
const text = (b: { text: unknown }) => (b.text as { text: string }[]).map((n) => n.text).join("");

/** A workspace note by its owner, three lines long, that an editor and a viewer can open. */
async function note(t: T, prefix: string) {
  const owner = await person(t, `${prefix}-owner@example.com`);
  const editor = await person(t, `${prefix}-editor@example.com`);
  const viewer = await person(t, `${prefix}-viewer@example.com`);
  const outsider = await person(t, `${prefix}-outsider@example.com`);
  const { workspaceId } = await teamWorkspace(owner, `${prefix} team`);
  await join(t, owner, editor, `${prefix}-editor@example.com`, workspaceId, "editor");
  await join(t, owner, viewer, `${prefix}-viewer@example.com`, workspaceId, "viewer");
  const documentId = ulid();
  await push(owner, workspaceId, [{ opId: ulid(), kind: "document.create", document: { id: documentId, parentDocumentId: null, folderId: null, kind: "document", title: "Launch plan", icon: null } }]);
  const a = para(ulid(), "Owner's opening line", "V");
  const b = para(ulid(), "The budget is small", "W");
  const d = para(ulid(), "A line to lose", "X");
  const [, rb] = await push(owner, workspaceId, [upsert(documentId, a), upsert(documentId, b), upsert(documentId, d)]);
  return { owner, editor, viewer, outsider, workspaceId, documentId, a, b, d, revB: rb!.revision! };
}

describe("changes", () => {
  test("changes by others since you last looked are listed by note, your own aren't", async () => {
    const t = setup();
    const { owner, editor, workspaceId, documentId, a, b, d, revB } = await note(t, "chg-list");
    await owner.as.mutation(api.documents.recordView, { documentId });
    expect((await owner.as.query(api.changes.list, {})).notes).toEqual([]);

    // The editor rewrites a line, adds one and removes one; the owner edits their own.
    const c = para(ulid(), "A new idea from the editor", "Y");
    await push(editor, workspaceId, [upsert(documentId, { ...b, text: [{ type: "text", text: "The budget is generous" }] }, revB), upsert(documentId, c), remove(documentId, d.id)]);
    await push(owner, workspaceId, [upsert(documentId, { ...a, text: [{ type: "text", text: "Owner's opening line, edited" }] }, 1)]);

    const { notes, people } = await owner.as.query(api.changes.list, {});
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id: documentId, title: "Launch plan", added: 1, edited: 1, removed: 1, more: false });
    expect(notes[0]!.actors.map((k) => people[k]!.name)).toEqual(["chg-list-editor"]);
    // People are keys, never internal ids.
    for (const k of notes[0]!.actors) expect(k).not.toMatch(/profiles/);
    // The note open in front of them is left out.
    expect((await owner.as.query(api.changes.list, { exclude: documentId })).notes).toEqual([]);
    // The editor never opened it: nothing for them (their own changes would never count anyway).
    expect((await editor.as.query(api.changes.list, {})).notes).toEqual([]);
    await editor.as.mutation(api.documents.recordView, { documentId });
    expect((await editor.as.query(api.changes.list, {})).notes).toEqual([]);
  });

  test("a note's details: the lines as they are and as they were, with who changed them", async () => {
    const t = setup();
    const { owner, editor, workspaceId, documentId, b, d, revB } = await note(t, "chg-note");
    // Opening a note never writes to it: with no version of it as it is, nothing can be compared or undone yet.
    await owner.as.mutation(api.documents.recordView, { documentId });
    expect((await owner.as.query(api.documents.versions, { documentId })).versions).toEqual([]);
    await push(editor, workspaceId, [upsert(documentId, para(ulid(), "Early idea", "Z"))]);
    const early = (await owner.as.query(api.changes.note, { documentId }))!;
    expect(early.canUndo).toBe(false);
    expect(early.previous).toBeNull();
    expect(early.kinds.map(([, kind]) => kind)).toEqual(["added"]);
    // Leaving it (or marking it seen) saves the version it's compared with from then on.
    await owner.as.mutation(api.changes.markSeen, { documentIds: [documentId] });
    expect((await owner.as.query(api.documents.versions, { documentId })).versions).toHaveLength(1);
    const c = para(ulid(), "A new idea", "Y");
    await push(editor, workspaceId, [upsert(documentId, { ...b, text: [{ type: "text", text: "The budget is generous" }] }, revB), upsert(documentId, c), remove(documentId, d.id)]);

    const detail = (await owner.as.query(api.changes.note, { documentId }))!;
    expect(detail.canUndo).toBe(true);
    expect(detail.blocks.map(text).sort()).toEqual(["A new idea", "The budget is generous"]);
    expect(detail.previous!.map(text).sort()).toEqual(["A line to lose", "The budget is small"]);
    expect(Object.fromEntries(detail.kinds)).toEqual({ [b.id]: "edited", [c.id]: "added", [d.id]: "removed" });
    const editorKey = detail.authors.find(([id]) => id === b.id)![1];
    expect(detail.people[editorKey]!.name).toBe("chg-note-editor");
    expect(detail.removed.map(([id, key]) => [id, key])).toEqual([[d.id, editorKey]]);
  });

  test("marking as seen clears a note until the next change; opening it does too", async () => {
    const t = setup();
    const { owner, editor, workspaceId, documentId, b, revB } = await note(t, "chg-seen");
    await owner.as.mutation(api.documents.recordView, { documentId });
    const first = await push(editor, workspaceId, [upsert(documentId, { ...b, text: [{ type: "text", text: "First change" }] }, revB)]);
    expect((await owner.as.query(api.changes.list, {})).notes).toHaveLength(1);
    expect(await owner.as.mutation(api.changes.markSeen, { documentIds: [documentId] })).toEqual({ marked: 1 });
    expect((await owner.as.query(api.changes.list, {})).notes).toEqual([]);

    await push(editor, workspaceId, [upsert(documentId, { ...b, text: [{ type: "text", text: "Second change" }] }, first[0]!.revision!)]);
    const again = (await owner.as.query(api.changes.list, {})).notes;
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ edited: 1, added: 0 });
    // Compared with the note as it was when marked seen: only the second change.
    const detail = (await owner.as.query(api.changes.note, { documentId }))!;
    expect(detail.previous!.map(text)).toEqual(["First change"]);
    // Opening the note is looking at it.
    await owner.as.mutation(api.documents.recordView, { documentId });
    expect((await owner.as.query(api.changes.list, {})).notes).toEqual([]);
    // Too many at once is refused.
    await expect(owner.as.mutation(api.changes.markSeen, { documentIds: Array.from({ length: 51 }, () => ulid()) })).rejects.toThrow();
  });

  test("who may see what: readers get the lines as they are but no removed text and no undo; outsiders nothing", async () => {
    const t = setup();
    const { owner, editor, viewer, outsider, workspaceId, documentId, b, d, revB } = await note(t, "chg-access");
    await viewer.as.mutation(api.documents.recordView, { documentId });
    await outsider.as.mutation(api.documents.recordView, { documentId });
    await push(editor, workspaceId, [upsert(documentId, { ...b, text: [{ type: "text", text: "Rewritten by the editor" }] }, revB), remove(documentId, d.id)]);

    expect((await viewer.as.query(api.changes.list, {})).notes).toHaveLength(1);
    const seen = (await viewer.as.query(api.changes.note, { documentId }))!;
    expect(seen.blocks.map(text)).toEqual(["Rewritten by the editor"]);
    expect(seen.previous).toBeNull();
    expect(seen.removed).toEqual([]);
    expect(seen.canUndo).toBe(false);
    expect(JSON.stringify(seen)).not.toContain("A line to lose");
    await expect(viewer.as.mutation(api.changes.undo, { documentId })).rejects.toThrow(/permission/);

    // Someone who can't open the note: nothing listed, nothing to read, nothing to mark or undo.
    expect((await outsider.as.query(api.changes.list, {})).notes).toEqual([]);
    expect(await outsider.as.query(api.changes.note, { documentId })).toBeNull();
    expect(await outsider.as.mutation(api.changes.markSeen, { documentIds: [documentId] })).toEqual({ marked: 0 });
    await expect(outsider.as.mutation(api.changes.undo, { documentId })).rejects.toThrow(/not found/i);
    void owner;
  });

  test("changes made through a connected app count, even when they're in your name", async () => {
    const t = setup();
    const { owner, documentId, workspaceId } = await note(t, "chg-app");
    await owner.as.mutation(api.documents.recordView, { documentId });
    const grantId = await t.run(async (ctx) => {
      const ws = (await ctx.db
        .query("workspaces")
        .collect())[0]!;
      const profileId = (await ctx.db.query("profiles").collect()).find((p) => p.displayName === "chg-app-owner")!._id;
      return await ctx.db.insert("mcpGrants", { profileId, clientId: "client-1", clientName: "Notes Bot", redirectHost: "example.com", personal: true, workspaceIds: [ws._id], includeShared: false, createOnly: false, scopes: ["notes:read", "notes:write"], createdAt: Date.now(), updatedAt: Date.now() });
    });
    void workspaceId;
    await t.mutation(internal.mcp.write, { grantId: grantId as Id<"mcpGrants">, tool: "append_to_note", args: { noteId: documentId, markdown: "Added by the app." }, requestKey: ulid() });
    const { notes, people } = await owner.as.query(api.changes.list, {});
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ added: 1 });
    expect(notes[0]!.actors.map((k) => people[k]!.name)).toEqual(["A connected app"]);
    // Their own hand afterwards is theirs again.
    await owner.as.mutation(api.changes.markSeen, { documentIds: [documentId] });
    expect((await owner.as.query(api.changes.list, {})).notes).toEqual([]);
  });

  test("undo puts back only the lines others changed, and can itself be undone", async () => {
    const t = setup();
    const { owner, editor, workspaceId, documentId, a, b, d, revB } = await note(t, "chg-undo");
    await owner.as.mutation(api.documents.recordView, { documentId });
    await owner.as.mutation(api.changes.markSeen, { documentIds: [documentId] });
    const c = para(ulid(), "Editor's extra line", "Y");
    await push(editor, workspaceId, [upsert(documentId, { ...b, text: [{ type: "text", text: "The budget is huge" }] }, revB), upsert(documentId, c), remove(documentId, d.id)]);
    // The owner's own edit since stays as it is.
    await push(owner, workspaceId, [upsert(documentId, { ...a, text: [{ type: "text", text: "Owner kept writing" }] }, 1)]);

    const lines = async () =>
      (await owner.as.query(api.blocks.list, { documentId })).blocks
        .slice()
        .sort((x, y) => (x.rank < y.rank ? -1 : 1))
        .map((x) => text(x));
    const { undoVersionId, reverted } = await owner.as.mutation(api.changes.undo, { documentId });
    expect(reverted).toBe(3);
    expect(undoVersionId).toBeTruthy();
    expect(await lines()).toEqual(["Owner kept writing", "The budget is small", "A line to lose"]);
    // Nothing left to see.
    expect((await owner.as.query(api.changes.list, {})).notes).toEqual([]);
    // The page as it was before the undo is a version: restoring it brings the editor's changes back.
    await owner.as.mutation(api.documents.restoreSnapshot, { snapshotId: undoVersionId! });
    expect(await lines()).toEqual(["Owner kept writing", "The budget is huge", "Editor's extra line"]);
  });
});
