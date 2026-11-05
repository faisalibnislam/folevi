// QA F06: an empty checkbox (a template's blank Follow-ups line) is no task. Typing a title into it makes exactly
// one task with its note as the source; rows left from before are hidden and removed by migrations.dropEmptyTasks.
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { para, person, setup, ulid, type T } from "./helpers";

type P = Awaited<ReturnType<typeof person>>;

async function newDoc(p: P, title: string) {
  const id = ulid();
  const [r] = await p.as.mutation(api.sync.push, {
    scope: p.scope,
    deviceId: "device-test-1",
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } }],
  });
  expect(r!.status).toBe("applied");
  return id;
}

/** Each block's last revision (an edit names the one it builds on). */
const revisions = new Map<string, number>();

async function upsert(p: P, documentId: string, block: ReturnType<typeof para>) {
  const [r] = await p.as.mutation(api.sync.push, { scope: p.scope, deviceId: "device-test-1", ops: [{ opId: ulid(), kind: "block.upsert", documentId, block, baseRevision: revisions.get(block.id) ?? null, fields: ["content", "position"] }] });
  expect(r!.status).toBe("applied");
  revisions.set(block.id, (r as { revision: number }).revision);
}

const todo = (id: string, text: string) => ({ ...para(id, text), type: "todo", props: { checked: false } });

/** The task rows of some to-dos (the welcome notes have tasks of their own). */
const rowsOf = (t: T, blockIds: string[]) => t.run(async (ctx) => (await ctx.db.query("tasks").collect()).filter((r) => blockIds.includes(r.blockId)));

describe("empty checkboxes are not tasks (QA F06)", () => {
  test("a blank to-do stays out of Tasks and Calendar; a title makes exactly one task from the note", async () => {
    const t = setup();
    const a = await person(t, "f06@example.com");
    const docId = await newDoc(a, "Meeting Notes");
    const id = ulid();
    const mine = async () => (await a.as.query(api.tasks.list, { scope: a.scope, view: "all", today: "2026-11-05" })).filter((x) => x.documentId === docId);
    const inbox = async () => (await a.as.query(api.tasks.counts, { scope: a.scope, today: "2026-11-05" })).inbox;
    const before = await inbox();
    await upsert(a, docId, todo(id, ""));
    expect(await mine()).toEqual([]);
    expect(await inbox()).toBe(before);
    expect(await rowsOf(t, [id])).toEqual([]);
    // Whitespace alone is still empty.
    await upsert(a, docId, todo(id, "   "));
    expect(await mine()).toEqual([]);

    await upsert(a, docId, todo(id, "Send the recap"));
    const tasks = await mine();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ blockId: id, documentId: docId, documentTitle: "Meeting Notes", title: "Send the recap" });
    expect(await rowsOf(t, [id])).toHaveLength(1);
    expect(await inbox()).toBe(before + 1);
    // Clearing it again takes it out.
    await upsert(a, docId, todo(id, ""));
    expect(await mine()).toEqual([]);
    expect(await rowsOf(t, [id])).toEqual([]);
  });

  test("rows left from before are hidden at once and dropEmptyTasks removes them", async () => {
    const t = setup();
    const a = await person(t, "f06-legacy@example.com");
    const docId = await newDoc(a, "Old meeting");
    const empty = ulid();
    const named = ulid();
    await upsert(a, docId, todo(empty, "placeholder"));
    await upsert(a, docId, todo(named, "Keep me"));
    const mine = async () => (await a.as.query(api.tasks.list, { scope: a.scope, view: "all", today: "2026-11-05" })).filter((x) => x.documentId === docId);
    // As an older server left them: the empty to-do's row with an empty title, and a stale empty title on a
    // to-do that has words by now.
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("tasks").collect()) if (row.blockId === empty || row.blockId === named) await ctx.db.patch(row._id, { title: "" });
      const block = (await ctx.db.query("blocks").withIndex("by_block_id", (q) => q.eq("blockId", empty)).unique())!;
      await ctx.db.patch(block._id, { text: [] });
    });
    expect(await mine()).toEqual([]);

    const r = await t.mutation(internal.migrations.dropEmptyTasks, {});
    expect(r).toEqual({ dropped: 1, refreshed: 1, done: true });
    expect((await rowsOf(t, [empty, named])).map((x) => [x.blockId, x.title])).toEqual([[named, "Keep me"]]);
    expect((await mine()).map((x) => x.title)).toEqual(["Keep me"]);
    // Running it again changes nothing.
    expect(await t.mutation(internal.migrations.dropEmptyTasks, {})).toEqual({ dropped: 0, refreshed: 0, done: true });
  });
});
