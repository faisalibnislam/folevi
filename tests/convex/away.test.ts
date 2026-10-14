// "Since you were away": opening a note that others changed since your last visit says who and which lines.
// Visits are tracked per person and note (recents): a first visit says nothing, your own changes never count.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { inWorkspace, join, para, person, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function push(p: Person, workspaceId: string, ops: unknown[]) {
  return await p.as.mutation(api.sync.push, { scope: inWorkspace(workspaceId), deviceId: `device-${ulid()}`, ops: ops as never });
}
const upsert = (documentId: string, block: ReturnType<typeof para>, baseRevision: number | null = null) => ({ opId: ulid(), kind: "block.upsert", documentId, block, baseRevision, fields: ["content", "position"] });
const edit = (b: ReturnType<typeof para>, text: string) => ({ ...b, text: [{ type: "text" as const, text }] });

async function note(t: T, prefix: string) {
  const owner = await person(t, `${prefix}-owner@example.com`);
  const editor = await person(t, `${prefix}-editor@example.com`);
  const viewer = await person(t, `${prefix}-viewer@example.com`);
  const outsider = await person(t, `${prefix}-outsider@example.com`);
  const { workspaceId } = await teamWorkspace(owner, `${prefix} team`);
  await join(t, owner, editor, `${prefix}-editor@example.com`, workspaceId, "editor");
  await join(t, owner, viewer, `${prefix}-viewer@example.com`, workspaceId, "viewer");
  const documentId = ulid();
  await push(owner, workspaceId, [{ opId: ulid(), kind: "document.create", document: { id: documentId, parentDocumentId: null, folderId: null, kind: "document", title: "Weekly notes", icon: null } }]);
  const a = para(ulid(), "Agenda", "V");
  const b = para(ulid(), "Budget", "W");
  const d = para(ulid(), "Old item", "X");
  await push(owner, workspaceId, [upsert(documentId, a), upsert(documentId, b), upsert(documentId, d)]);
  return { owner, editor, viewer, outsider, workspaceId, documentId, a, b, d };
}

const open = (p: Person, documentId: string) => p.as.mutation(api.documents.recordView, { documentId });
const leave = (p: Person, documentId: string) => p.as.mutation(api.changes.markSeen, { documentIds: [documentId], leaving: true });

describe("since you were away", () => {
  test("first visit: nothing; back after others changed it: who, which lines, and how many were removed", async () => {
    const t = setup();
    const { owner, editor, workspaceId, documentId, a, b, d } = await note(t, "away-who");
    await open(owner, documentId);
    expect(await owner.as.query(api.changes.away, { documentId })).toBeNull();
    await leave(owner, documentId);
    const leftAt = Date.now();

    const c = para(ulid(), "New point", "Y");
    await push(editor, workspaceId, [upsert(documentId, edit(b, "Budget, revised"), 1), upsert(documentId, c), { opId: ulid(), kind: "block.delete", documentId, blockId: d.id, baseRevision: null }]);
    // The owner's own change from another device while "away" isn't news to them.
    await push(owner, workspaceId, [upsert(documentId, edit(a, "Agenda, mine"), 1)]);

    await open(owner, documentId);
    const away = (await owner.as.query(api.changes.away, { documentId }))!;
    expect(away.people.map((p) => p.name)).toEqual(["away-who-editor"]);
    expect(away.since).toBeLessThanOrEqual(leftAt);
    expect(away.lines.map(([id, , , kind]) => [id, kind]).sort()).toEqual([[b.id, "edited"], [c.id, "added"]].sort());
    expect(away.removed).toBe(1);
    // Only ids and who: no text of the lines.
    expect(JSON.stringify(away)).not.toContain("Budget");
    // A reload straight away is the same visit: still there.
    await open(owner, documentId);
    expect((await owner.as.query(api.changes.away, { documentId }))!.lines).toHaveLength(2);
  });

  test("dismissing it, or coming back with nothing new, shows nothing; changes made while you're in the note don't pop it up", async () => {
    const t = setup();
    const { owner, editor, workspaceId, documentId, b } = await note(t, "away-dismiss");
    await open(owner, documentId);
    await leave(owner, documentId);
    const r = await push(editor, workspaceId, [upsert(documentId, edit(b, "Budget v2"), 1)]);
    await open(owner, documentId);
    expect(await owner.as.query(api.changes.away, { documentId })).not.toBeNull();
    await owner.as.mutation(api.changes.dismissAway, { documentId });
    expect(await owner.as.query(api.changes.away, { documentId })).toBeNull();
    await open(owner, documentId);
    expect(await owner.as.query(api.changes.away, { documentId })).toBeNull();

    // While they're in it, someone else edits: it's in front of them, not "since you were away".
    await push(editor, workspaceId, [upsert(documentId, edit(b, "Budget v3"), r[0]!.revision!)]);
    expect(await owner.as.query(api.changes.away, { documentId })).toBeNull();

    // Leaving and coming back with nothing new since: nothing.
    await leave(owner, documentId);
    await open(owner, documentId);
    expect(await owner.as.query(api.changes.away, { documentId })).toBeNull();
  });

  test("people who can only read the note get it too; people who can't open it get nothing", async () => {
    const t = setup();
    const { editor, viewer, outsider, workspaceId, documentId, b } = await note(t, "away-access");
    await open(viewer, documentId);
    await leave(viewer, documentId);
    await open(outsider, documentId);
    await push(editor, workspaceId, [upsert(documentId, edit(b, "Budget changed"), 1)]);
    await open(viewer, documentId);
    expect((await viewer.as.query(api.changes.away, { documentId }))!.people.map((p) => p.name)).toEqual(["away-access-editor"]);
    expect(await outsider.as.query(api.changes.away, { documentId })).toBeNull();
    // Dismissing someone else's note you can't open changes nothing (there's no visit to change).
    await outsider.as.mutation(api.changes.dismissAway, { documentId });
    expect(await viewer.as.query(api.changes.away, { documentId })).not.toBeNull();
  });
});
