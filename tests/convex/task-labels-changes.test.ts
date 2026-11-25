// Task rows carry their note's id, title and icon (lib/documents.ts syncTaskLabels), so task lists read no
// notes; and Changes reads a note only once it has unseen changes (backend performance pass, 2026-11-25).
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { SCHEMA_VERSION, type WireBlock } from "@folevi/editor-schema";
import { inWorkspace, join, para, person, PERSONAL, setup, teamWorkspace, ulid } from "./helpers";
import { measure } from "./perf/measure";

type Person = Awaited<ReturnType<typeof person>>;
type Scope = Person["scope"];

const TODAY = "2026-11-25";
const todo = (text: string, rank = "V"): WireBlock => ({ id: ulid(), type: "todo", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text }], props: { checked: false } });

async function push(p: Person, scope: Scope, ops: unknown[]) {
  const results = await p.as.mutation(api.sync.push, { scope, deviceId: `device-${ulid()}`, ops: ops as never });
  for (const r of results) expect(r.status).toBe("applied");
  return results;
}

async function noteWithTasks(p: Person, scope: Scope, title: string, tasks: string[]) {
  const id = ulid();
  await push(p, scope, [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } }]);
  await push(
    p,
    scope,
    tasks.map((t, i) => ({ opId: ulid(), kind: "block.upsert", documentId: id, block: todo(t, String.fromCharCode(80 + i)), baseRevision: null, fields: ["content", "position"] })),
  );
  return id;
}

describe("task rows carry their note's title", () => {
  test("lists show the note's title and icon without reading the note, and follow a rename", async () => {
    const t = setup();
    const a = await person(t, "labels-a@example.com");
    const notes: string[] = [];
    for (let i = 0; i < 10; i++) notes.push(await noteWithTasks(a, PERSONAL, `Plan ${i}`, ["One", "Two"]));
    const cost = await measure("tasks.list", () => a.as.query(api.tasks.list, { scope: PERSONAL, view: "all", today: TODAY }));
    const list = cost.result as { documentId: string; documentTitle: string }[];
    const mine = list.filter((x) => notes.includes(x.documentId));
    expect(mine).toHaveLength(20);
    expect(new Set(mine.map((x) => x.documentTitle))).toEqual(new Set(notes.map((_, i) => `Plan ${i}`)));
    // Task rows and the person's own rows only: no note per task (there are 10 notes here).
    const taskRows = await t.run(async (ctx) => (await ctx.db.query("tasks").collect()).length);
    expect(cost.documentsRead).toBeLessThan(taskRows + 8);

    // Renamed and given an icon: its tasks follow.
    await push(a, PERSONAL, [{ opId: ulid(), kind: "document.update", documentId: notes[0]!, patch: { title: "Renamed", icon: "🚀" }, baseRevision: null }]);
    const after = (await a.as.query(api.tasks.list, { scope: PERSONAL, view: "all", today: TODAY })).filter((x) => x.documentId === notes[0]);
    expect(after.map((x) => [x.documentTitle, x.documentIcon])).toEqual([
      ["Renamed", "🚀"],
      ["Renamed", "🚀"],
    ]);
  });

  test("a row saved before titles were kept reads its note", async () => {
    const t = setup();
    const a = await person(t, "labels-old@example.com");
    const id = await noteWithTasks(a, PERSONAL, "Old note", ["Legacy task"]);
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("tasks").collect()) await ctx.db.patch(row._id, { documentPublicId: undefined, documentTitle: undefined, documentIcon: undefined });
    });
    const list = await a.as.query(api.tasks.list, { scope: PERSONAL, view: "all", today: TODAY });
    expect(list.find((x) => x.title === "Legacy task")).toMatchObject({ documentId: id, documentTitle: "Old note" });
  });

  test("a member never sees tasks on a restricted page they can't open, until it's shared with them", async () => {
    const t = setup();
    const owner = await person(t, "labels-owner@example.com");
    const member = await person(t, "labels-member@example.com");
    const { workspaceId } = await teamWorkspace(owner, "Labels team");
    await join(t, owner, member, "labels-member@example.com", workspaceId, "editor");
    const scope = inWorkspace(workspaceId);
    await noteWithTasks(owner, scope, "Open", ["Open task"]);
    const secret = await noteWithTasks(owner, scope, "Secret", ["Secret task"]);
    await owner.as.mutation(api.sharing.setAccessMode, { documentId: secret, mode: "restricted" });
    const titles = async (p: Person) => (await p.as.query(api.tasks.list, { scope, view: "all", today: TODAY })).map((x) => x.title).sort();
    expect(await titles(member)).toEqual(["Open task"]);
    expect(await titles(owner)).toEqual(["Open task", "Secret task"]);
    await owner.as.mutation(api.sharing.grant, { documentId: secret, email: "labels-member@example.com", role: "viewer" });
    expect(await titles(member)).toEqual(["Open task", "Secret task"]);
    // In Trash: nobody's lists.
    await owner.as.mutation(api.documents.moveToTrash, { documentId: secret });
    expect(await titles(owner)).toEqual(["Open task"]);
  });
});

describe("Changes reads only notes that changed", () => {
  test("opened notes without unseen changes cost no note read; a change by someone else is listed", async () => {
    const t = setup();
    const owner = await person(t, "chg-reads-owner@example.com");
    const editor = await person(t, "chg-reads-editor@example.com");
    const { workspaceId } = await teamWorkspace(owner, "Reads team");
    await join(t, owner, editor, "chg-reads-editor@example.com", workspaceId, "editor");
    const scope = inWorkspace(workspaceId);
    const notes: string[] = [];
    for (let i = 0; i < 12; i++) notes.push(await noteWithTasks(owner, scope, `Shared ${i}`, []));
    for (const id of notes) await owner.as.mutation(api.documents.recordView, { documentId: id });

    const quiet = await measure("changes.list", () => owner.as.query(api.changes.list, {}));
    expect((quiet.result as { notes: unknown[] }).notes).toEqual([]);
    const noteReads = await t.run(async (ctx) => (await ctx.db.query("documents").collect()).length);
    // Recents and the person's own rows, not the 12 notes.
    expect(quiet.documentsRead).toBeLessThan(12 + 12);
    expect(noteReads).toBeGreaterThanOrEqual(12);

    await push(editor, scope, [{ opId: ulid(), kind: "block.upsert", documentId: notes[3]!, block: para(ulid(), "From the editor"), baseRevision: null, fields: ["content", "position"] }]);
    const { notes: changed } = await owner.as.query(api.changes.list, {});
    expect(changed.map((n) => n.title)).toEqual(["Shared 3"]);
    // The note in front of them is left out.
    expect((await owner.as.query(api.changes.list, { exclude: notes[3]! })).notes).toEqual([]);
  });
});
