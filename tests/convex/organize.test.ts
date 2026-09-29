// Organizing notes: bulk actions, "Remove from recent", and Empty Trash.
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { person, setup, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function newDocs(p: Person, titles: string[], workspaceId = p.workspaceId) {
  const ids = titles.map(() => ulid());
  for (let i = 0; i < titles.length; i += 100) {
    const results = await p.as.mutation(api.sync.push, {
      workspaceId,
      deviceId: "device-organize-1",
      ops: titles.slice(i, i + 100).map((title, k) => ({
        opId: ulid(),
        kind: "document.create" as const,
        document: { id: ids[i + k]!, parentDocumentId: null, folderId: null, kind: "document" as const, title, icon: null },
      })),
    });
    expect(results.every((r) => r.status === "applied")).toBe(true);
  }
  return ids;
}

const emails = new WeakMap<Person, string>();
async function personAs(t: T, email: string) {
  const p = await person(t, email);
  emails.set(p, email);
  return p;
}

async function team(owner: Person, member: Person, role: "editor" | "admin" | "viewer" = "editor") {
  const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Team" });
  await owner.as.mutation(api.workspaces.invite, { workspaceId: id, email: emails.get(member)!, role });
  const invite = (await member.as.query(api.notifications.list, {})).find((n) => n.kind === "invite")!;
  await member.as.mutation(api.workspaces.acceptInvite, { inviteId: invite.inviteId! });
  return id;
}

const titlesOf = async (p: Person, view: "all" | "starred" | "archive" | "trash" | "folder", folderId?: string, workspaceId = p.workspaceId) =>
  (await p.as.query(api.documents.list, { workspaceId, view, folderId, paginationOpts: { numItems: 200, cursor: null } })).page.map((d) => d.title).sort();

describe("bulk actions", () => {
  test("move, star, archive, trash and restore several notes at once", async () => {
    const t = setup();
    const a = await personAs(t, "bulk-a@example.com");
    const [n1, n2, n3] = await newDocs(a, ["One", "Two", "Three"]);
    const { id: folderId } = await a.as.mutation(api.organization.createFolder, { workspaceId: a.workspaceId, name: "Box" });

    const moved = await a.as.mutation(api.documents.bulkUpdate, { documentIds: [n1!, n2!], action: { kind: "move", folderId } });
    expect(moved.done.sort()).toEqual([n1, n2].sort());
    expect(moved.skipped).toBe(0);
    expect(moved.previousFolders).toEqual({ [n1!]: null, [n2!]: null });
    expect(await titlesOf(a, "folder", folderId)).toEqual(["One", "Two"]);
    // Undo: back where they were.
    await a.as.mutation(api.documents.bulkUpdate, { documentIds: [n1!, n2!], action: { kind: "move", folderId: null } });
    expect(await titlesOf(a, "folder", folderId)).toEqual([]);

    await a.as.mutation(api.documents.bulkUpdate, { documentIds: [n1!, n3!], action: { kind: "star", starred: true } });
    expect(await titlesOf(a, "starred")).toEqual(["One", "Three"]);

    await a.as.mutation(api.documents.bulkUpdate, { documentIds: [n2!, n3!], action: { kind: "archive", archived: true } });
    expect(await titlesOf(a, "archive")).toEqual(["Three", "Two"]);
    await a.as.mutation(api.documents.bulkUpdate, { documentIds: [n2!, n3!], action: { kind: "archive", archived: false } });

    await a.as.mutation(api.documents.bulkUpdate, { documentIds: [n1!, n2!, n3!], action: { kind: "trash" } });
    expect(await titlesOf(a, "trash")).toEqual(["One", "Three", "Two"]);
    // Trashed notes can't be moved or archived.
    const refused = await a.as.mutation(api.documents.bulkUpdate, { documentIds: [n1!], action: { kind: "move", folderId } });
    expect(refused).toMatchObject({ done: [], skipped: 1 });
    await a.as.mutation(api.documents.bulkUpdate, { documentIds: [n1!, n2!, n3!], action: { kind: "restore" } });
    expect(await titlesOf(a, "trash")).toEqual([]);
  });

  test("each note is authorized on its own; viewers and outsiders are skipped", async () => {
    const t = setup();
    const owner = await personAs(t, "bulk-owner@example.com");
    const viewer = await personAs(t, "bulk-viewer@example.com");
    const stranger = await personAs(t, "bulk-stranger@example.com");
    const teamId = await team(owner, viewer, "viewer");
    const [shared] = await newDocs(owner, ["Shared"], teamId);
    const [mine] = await newDocs(viewer, ["Viewer's own"]);

    const r = await viewer.as.mutation(api.documents.bulkUpdate, { documentIds: [shared!, mine!], action: { kind: "trash" } });
    expect(r.done).toEqual([mine]);
    expect(r.skipped).toBe(1);
    expect(await titlesOf(owner, "trash", undefined, teamId)).toEqual([]);
    // Starring only needs read access (it's personal).
    expect((await viewer.as.mutation(api.documents.bulkUpdate, { documentIds: [shared!], action: { kind: "star", starred: true } })).done).toEqual([shared]);
    // Someone outside the workspace can't touch (or learn about) the note.
    const s = await stranger.as.mutation(api.documents.bulkUpdate, { documentIds: [shared!, "missing-id"], action: { kind: "archive", archived: true } });
    expect(s).toMatchObject({ done: [], skipped: 2 });
    // A folder from another workspace isn't a valid target.
    const { id: foreignFolder } = await stranger.as.mutation(api.organization.createFolder, { workspaceId: stranger.workspaceId, name: "Elsewhere" });
    const [ownerNote] = await newDocs(owner, ["Owner note"]);
    expect(await owner.as.mutation(api.documents.bulkUpdate, { documentIds: [ownerNote!], action: { kind: "move", folderId: foreignFolder } })).toMatchObject({ done: [], skipped: 1 });
  });

  test("permanent deletion needs the note in Trash and the right to delete it", async () => {
    vi.useFakeTimers();
    const t = setup();
    const owner = await personAs(t, "bulk-del-owner@example.com");
    const editor = await personAs(t, "bulk-del-editor@example.com");
    const teamId = await team(owner, editor, "editor");
    const [ownerDoc] = await newDocs(owner, ["Owner's"], teamId);
    const [editorDoc, live] = await newDocs(editor, ["Editor's", "Still live"], teamId);
    await owner.as.mutation(api.documents.bulkUpdate, { documentIds: [ownerDoc!], action: { kind: "trash" } });
    await editor.as.mutation(api.documents.bulkUpdate, { documentIds: [editorDoc!], action: { kind: "trash" } });

    const r = await editor.as.mutation(api.documents.bulkUpdate, { documentIds: [ownerDoc!, editorDoc!, live!], action: { kind: "delete" } });
    expect(r.done).toEqual([editorDoc]);
    expect(r.skipped).toBe(2);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    for (let i = 0; i < 5; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
    expect(await titlesOf(owner, "trash", undefined, teamId)).toEqual(["Owner's"]);
    expect(await titlesOf(owner, "all", undefined, teamId)).toContain("Still live");
    vi.useRealTimers();
  });

  test("batches are bounded and rate-limited", async () => {
    const t = setup();
    const a = await personAs(t, "bulk-limit@example.com");
    const ids = Array.from({ length: 51 }, () => ulid());
    await expect(a.as.mutation(api.documents.bulkUpdate, { documentIds: ids, action: { kind: "trash" } })).rejects.toThrow(/At most 50/);
    const [n] = await newDocs(a, ["Spam"]);
    for (let i = 0; i < 60; i++) await a.as.mutation(api.documents.bulkUpdate, { documentIds: [n!], action: { kind: "star", starred: i % 2 === 0 } });
    await expect(a.as.mutation(api.documents.bulkUpdate, { documentIds: [n!], action: { kind: "star", starred: true } })).rejects.toThrow(/rate_limited|Too many/);
  });
});

describe("remove from recent", () => {
  test("hides a note from this person's Recent notes until it's edited or reopened", async () => {
    const t = setup();
    const owner = await personAs(t, "recent-owner@example.com");
    const editor = await personAs(t, "recent-editor@example.com");
    const teamId = await team(owner, editor, "editor");
    const [a1, a2] = await newDocs(owner, ["Alpha", "Beta"], teamId);
    const recent = async (p: Person) => (await p.as.query(api.documents.recentNotes, { workspaceId: teamId, limit: 10 })).map((d) => d.title);
    expect(await recent(owner)).toEqual(expect.arrayContaining(["Alpha", "Beta"]));

    expect(await owner.as.mutation(api.documents.hideFromRecent, { documentIds: [a1!] })).toEqual({ hidden: 1 });
    expect(await recent(owner)).not.toContain("Alpha");
    // Nobody else's list changes.
    expect(await recent(editor)).toContain("Alpha");

    // Undo.
    await owner.as.mutation(api.documents.showInRecent, { documentIds: [a1!] });
    expect(await recent(owner)).toContain("Alpha");

    // An edit after hiding brings it back.
    await owner.as.mutation(api.documents.hideFromRecent, { documentIds: [a1!, a2!] });
    expect(await recent(owner)).not.toContain("Beta");
    await new Promise((r) => setTimeout(r, 5));
    await editor.as.mutation(api.sync.push, {
      workspaceId: teamId,
      deviceId: "device-organize-2",
      ops: [{ opId: ulid(), kind: "document.update", documentId: a2!, patch: { title: "Beta 2" }, baseRevision: null }],
    });
    expect(await recent(owner)).toContain("Beta 2");
    // Opening it brings it back too.
    expect(await recent(owner)).not.toContain("Alpha");
    await owner.as.mutation(api.documents.recordView, { documentId: a1! });
    expect(await recent(owner)).toContain("Alpha");
  });

  test("only notes the caller can read can be hidden", async () => {
    const t = setup();
    const a = await personAs(t, "recent-a@example.com");
    const b = await personAs(t, "recent-b@example.com");
    const [secret] = await newDocs(a, ["Secret"]);
    expect(await b.as.mutation(api.documents.hideFromRecent, { documentIds: [secret!] })).toEqual({ hidden: 0 });
    const rows = await t.run(async (ctx) => await ctx.db.query("recentHidden").collect());
    expect(rows).toHaveLength(0);
    await expect(b.as.query(api.documents.recentNotes, { workspaceId: a.workspaceId })).rejects.toThrow(/not_found|Workspace not found/);
  });
});

describe("empty trash", () => {
  test("permanently deletes only the trashed notes the caller may delete, and counts them first", async () => {
    vi.useFakeTimers();
    const t = setup();
    const owner = await personAs(t, "empty-owner@example.com");
    const editor = await personAs(t, "empty-editor@example.com");
    const teamId = await team(owner, editor, "editor");
    const [ownerDoc] = await newDocs(owner, ["Owner's trash"], teamId);
    const [e1, e2, keep] = await newDocs(editor, ["Editor 1", "Editor 2", "Not trashed"], teamId);
    await owner.as.mutation(api.documents.bulkUpdate, { documentIds: [ownerDoc!], action: { kind: "trash" } });
    await editor.as.mutation(api.documents.bulkUpdate, { documentIds: [e1!, e2!], action: { kind: "trash" } });

    expect(await editor.as.query(api.documents.trashSummary, { workspaceId: teamId })).toEqual({ total: 3, deletable: 2, more: false });
    expect(await owner.as.query(api.documents.trashSummary, { workspaceId: teamId })).toEqual({ total: 3, deletable: 3, more: false });

    const r = await editor.as.mutation(api.documents.emptyTrash, { workspaceId: teamId });
    expect(r).toEqual({ scheduled: 2, continuing: false });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    for (let i = 0; i < 5; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
    expect(await titlesOf(owner, "trash", undefined, teamId)).toEqual(["Owner's trash"]);
    expect(await titlesOf(owner, "all", undefined, teamId)).toContain("Not trashed");
    void keep;
    vi.useRealTimers();
  });

  test("a large Trash is emptied in pages", async () => {
    vi.useFakeTimers();
    const t = setup();
    const a = await personAs(t, "empty-big@example.com");
    const ids = await newDocs(a, Array.from({ length: 130 }, (_, i) => `Old ${i}`));
    for (let i = 0; i < ids.length; i += 50) await a.as.mutation(api.documents.bulkUpdate, { documentIds: ids.slice(i, i + 50), action: { kind: "trash" } });
    const r = await a.as.mutation(api.documents.emptyTrash, { workspaceId: a.workspaceId });
    expect(r).toEqual({ scheduled: 100, continuing: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    for (let i = 0; i < 40; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
    const left = await t.run(async (ctx) => (await ctx.db.query("documents").collect()).filter((d) => d.title.startsWith("Old ")).length);
    expect(left).toBe(0);
    vi.useRealTimers();
  });

  test("viewers can't empty Trash", async () => {
    const t = setup();
    const owner = await personAs(t, "empty-v-owner@example.com");
    const viewer = await personAs(t, "empty-v-viewer@example.com");
    const teamId = await team(owner, viewer, "viewer");
    await expect(viewer.as.mutation(api.documents.emptyTrash, { workspaceId: teamId })).rejects.toThrow(/forbidden|permission/);
    expect((await viewer.as.query(api.documents.trashSummary, { workspaceId: teamId })).deletable).toBe(0);
  });
});
