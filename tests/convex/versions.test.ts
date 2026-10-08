// Version history: who edited what in each version, named versions, restore and undo, copies, automatic
// versions and who may see history.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { inWorkspace, join, para, person, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

afterEach(() => {
  vi.useRealTimers();
});

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

/** A workspace page written by its owner, with an editor and a viewer who can open it. */
async function page(t: T, prefix: string) {
  const owner = await person(t, `${prefix}-owner@example.com`);
  const editor = await person(t, `${prefix}-editor@example.com`);
  const viewer = await person(t, `${prefix}-viewer@example.com`);
  const { workspaceId } = await teamWorkspace(owner, `${prefix} team`);
  await join(t, owner, editor, `${prefix}-editor@example.com`, workspaceId, "editor");
  await join(t, owner, viewer, `${prefix}-viewer@example.com`, workspaceId, "viewer");
  const documentId = ulid();
  await push(owner, workspaceId, [{ opId: ulid(), kind: "document.create", document: { id: documentId, parentDocumentId: null, folderId: null, kind: "document", title: "Plan", icon: null } }]);
  const a = para(ulid(), "Owner's line", "V");
  const b = para(ulid(), "Second line", "W");
  const [ra, rb] = await push(owner, workspaceId, [upsert(documentId, a), upsert(documentId, b)]);
  return { owner, editor, viewer, workspaceId, documentId, a, b, revA: ra!.revision!, revB: rb!.revision! };
}

describe("versions", () => {
  test("each version names who edited since the one before, and who changed or deleted each block", async () => {
    const t = setup();
    const { owner, editor, workspaceId, documentId, a, b, revB } = await page(t, "ver-who");
    const first = await owner.as.mutation(api.documents.createSnapshot, { documentId, reason: "manual" });
    expect(first.created).toBe(true);

    // The editor rewrites the second line and adds a third; the owner deletes the first.
    const c = para(ulid(), "Editor's new line", "X");
    await push(editor, workspaceId, [upsert(documentId, { ...b, text: [{ type: "text", text: "Second line, edited" }] }, revB), upsert(documentId, c)]);
    await push(owner, workspaceId, [{ opId: ulid(), kind: "block.delete", documentId, blockId: a.id, baseRevision: null }]);
    const second = await editor.as.mutation(api.documents.createSnapshot, { documentId, reason: "manual" });
    expect(second.created).toBe(true);

    const { versions, people } = await owner.as.query(api.documents.versions, { documentId });
    expect(versions.map((v) => v.id)).toEqual([second.id, first.id]);
    const names = (keys: string[]) => keys.map((k) => people[k]!.name);
    // The editor made two changes, the owner one: most changes first.
    expect(names(versions[0]!.editors)).toEqual(["ver-who-editor", "ver-who-owner"]);
    expect(names(versions[1]!.editors)).toEqual(["ver-who-owner"]);
    for (const p of Object.values(people)) expect(p.key).not.toMatch(/profiles/);

    const content = await owner.as.query(api.documents.snapshotContent, { snapshotId: second.id! });
    expect(content!.authors![b.id]![0]).toBe(versions[0]!.editors[0]);
    expect(content!.authors![c.id]![0]).toBe(versions[0]!.editors[0]);
    expect(content!.removed![a.id]![0]).toBe(versions[0]!.editors[1]);
    // The stored attribution (internal ids) never reaches the client inside the content.
    expect(content!.content).not.toContain("authors");
    expect(JSON.parse(content!.content!).blocks.map((x: { id: string }) => x.id)).toEqual([b.id, c.id]);
  });

  test("history is for people who can edit the page", async () => {
    const t = setup();
    const { owner, viewer, documentId } = await page(t, "ver-access");
    const v = await owner.as.mutation(api.documents.createSnapshot, { documentId, reason: "manual" });
    await expect(viewer.as.query(api.documents.versions, { documentId })).rejects.toThrow();
    await expect(viewer.as.query(api.documents.blockAuthors, { documentId })).rejects.toThrow();
    expect(await viewer.as.query(api.documents.snapshotContent, { snapshotId: v.id! })).toBeNull();
    await expect(viewer.as.mutation(api.documents.restoreSnapshot, { snapshotId: v.id! })).rejects.toThrow();
  });

  test("named versions: name, rename, clear, filter, and naming the current version when nothing changed", async () => {
    const t = setup();
    const { owner, editor, workspaceId, documentId, b, revB } = await page(t, "ver-name");
    const first = await owner.as.mutation(api.documents.createSnapshot, { documentId, reason: "manual" });
    await push(editor, workspaceId, [upsert(documentId, { ...b, text: [{ type: "text", text: "Changed" }] }, revB)]);
    // Naming the current version saves it with the name.
    const named = await owner.as.mutation(api.documents.createSnapshot, { documentId, reason: "manual", name: "  Sent   to the client " });
    expect(named.created).toBe(true);
    // With nothing new since, naming the current version names that one again (no new version).
    const again = await owner.as.mutation(api.documents.createSnapshot, { documentId, reason: "manual", name: "Final draft" });
    expect(again).toEqual({ created: false, id: named.id });
    let list = (await owner.as.query(api.documents.versions, { documentId })).versions;
    expect(list.find((v) => v.id === named.id)!.name).toBe("Final draft");
    await editor.as.mutation(api.documents.nameVersion, { snapshotId: first.id!, name: "Kick-off" });
    const namedOnly = (await owner.as.query(api.documents.versions, { documentId, namedOnly: true })).versions;
    expect(namedOnly.map((v) => v.name)).toEqual(["Final draft", "Kick-off"]);
    await owner.as.mutation(api.documents.nameVersion, { snapshotId: first.id!, name: "   " });
    list = (await owner.as.query(api.documents.versions, { documentId, namedOnly: true })).versions;
    expect(list.map((v) => v.name)).toEqual(["Final draft"]);
  });

  test("restoring keeps the page as it was first, so the restore can be undone; a copy is a new page", async () => {
    const t = setup();
    const { owner, workspaceId, documentId, b, revB } = await page(t, "ver-restore");
    const original = await owner.as.mutation(api.documents.createSnapshot, { documentId, reason: "manual" });
    await push(owner, workspaceId, [upsert(documentId, { ...b, text: [{ type: "text", text: "Rewritten" }] }, revB)]);
    const lines = async () => (await owner.as.query(api.blocks.list, { documentId })).blocks.map((x) => (x.text[0] as { text?: string } | undefined)?.text);

    const added = para(ulid(), "Added after", "X");
    await push(owner, workspaceId, [upsert(documentId, added)]);
    const { undoVersionId } = await owner.as.mutation(api.documents.restoreSnapshot, { snapshotId: original.id! });
    expect(await lines()).toEqual(["Owner's line", "Second line"]);
    expect(undoVersionId).toBeTruthy();
    // The current version knows who removed the line the restore took out.
    const now = await owner.as.query(api.documents.blockAuthors, { documentId });
    expect(now.people[now.removed[added.id]![0]]!.name).toBe("ver-restore-owner");
    await owner.as.mutation(api.documents.restoreSnapshot, { snapshotId: undoVersionId! });
    expect(await lines()).toEqual(["Owner's line", "Rewritten", "Added after"]);

    const copy = await owner.as.mutation(api.documents.copyVersion, { snapshotId: original.id! });
    expect(copy.title).toBe("Plan (copy)");
    expect(copy.id).not.toBe(documentId);
    const copied = (await owner.as.query(api.blocks.list, { documentId: copy.id })).blocks;
    expect(copied.map((x) => (x.text[0] as { text: string }).text)).toEqual(["Owner's line", "Second line"]);
    // New blocks, not the page's own.
    expect(copied.map((x) => x.id)).not.toContain(b.id);
  });

  test("editing schedules an automatic version, whether or not any app stays open", async () => {
    vi.useFakeTimers();
    const t = setup();
    const { owner, workspaceId, documentId, b, revB } = await page(t, "ver-auto");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const before = (await owner.as.query(api.documents.versions, { documentId })).versions.length;
    await push(owner, workspaceId, [upsert(documentId, { ...b, text: [{ type: "text", text: "Kept typing" }] }, revB)]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const after = (await owner.as.query(api.documents.versions, { documentId })).versions;
    expect(after.length).toBe(before + 1);
    expect(after[0]!.reason).toBe("idle");
    // The next edit schedules the next one (the due time was cleared).
    const due = await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", documentId)).unique())!.versionDueAt ?? null);
    expect(due).toBeNull();
  });

  test("retention keeps named versions however old", async () => {
    const t = setup();
    const { owner, documentId } = await page(t, "ver-keep");
    const named = await owner.as.mutation(api.documents.createSnapshot, { documentId, reason: "manual", name: "Launch" });
    // 60 newer versions, all older than the 30-day window, and the named one older still.
    await t.run(async (ctx) => {
      const old = Date.now() - 90 * 24 * 60 * 60 * 1000;
      const snap = (await ctx.db.query("documentSnapshots").withIndex("by_public_id", (q) => q.eq("publicId", named.id!)).unique())!;
      await ctx.db.patch(snap._id, { createdAt: old - 1000 });
      const { _id, _creationTime, ...rest } = snap;
      void _id;
      void _creationTime;
      for (let i = 0; i < 60; i++) await ctx.db.insert("documentSnapshots", { ...rest, publicId: ulid(), name: undefined, createdAt: old + i });
    });
    await t.mutation(internal.documents.purgeSnapshots, {});
    const left = (await owner.as.query(api.documents.versions, { documentId })).versions;
    expect(left.length).toBe(51);
    expect(left.some((v) => v.id === named.id && v.name === "Launch")).toBe(true);
  });
});
