// Security audit 2026-11-26, what goes into a note's blocks: a block id is one block's for good (a version
// brought in can't claim another note's), a to-do names only people who may be given it, reminders go only to
// people who can open the note, and a synced block comes along only when its content is the person's to show.
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SCHEMA_VERSION, type WireBlock } from "@folevi/editor-schema";
import { join, para, person, PERSONAL, setup, teamWorkspace, textOf, ulid, type ScopeArg, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

const todo = (id: string, text: string, props: Record<string, unknown> = {}, rank = "V"): WireBlock => ({ id, type: "todo", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text }], props: { checked: false, ...props } });
const syncedBlock = (id: string, sourceId: string, rank = "V"): WireBlock => ({ id, type: "synced", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [], props: { sourceId } });

async function newPage(p: Person, scope: ScopeArg, title = "Page", parentDocumentId?: string) {
  const { id } = await p.as.mutation(api.documents.create, { scope, title, ...(parentDocumentId ? { parentDocumentId } : {}) });
  return id;
}

async function write(p: Person, documentId: string, blocks: WireBlock[]) {
  const results = await p.as.mutation(api.sync.push, {
    scope: PERSONAL,
    deviceId: "device-audit",
    ops: blocks.map((block) => ({ opId: ulid(), kind: "block.upsert" as const, documentId, block, baseRevision: null, fields: ["content" as const, "position" as const] })),
  });
  return results;
}

async function world(t: T, prefix: string) {
  const owner = await person(t, `${prefix}-owner@example.com`);
  const member = await person(t, `${prefix}-member@example.com`);
  const guest = await person(t, `${prefix}-guest@example.com`);
  const { workspaceId, scope } = await teamWorkspace(owner, `${prefix} team`);
  await join(t, owner, member, `${prefix}-member@example.com`, workspaceId, "editor");
  return { owner, member, guest, workspaceId, scope, guestEmail: `${prefix}-guest@example.com`, memberEmail: `${prefix}-member@example.com` };
}

const rowsWithBlockId = async (t: T, blockId: string) => await t.run(async (ctx) => await ctx.db.query("blocks").withIndex("by_block_id", (q) => q.eq("blockId", blockId)).collect());
const taskOf = async (t: T, blockId: string) => await t.run(async (ctx) => await ctx.db.query("tasks").withIndex("by_block", (q) => q.eq("blockId", blockId)).collect());
const docRow = async (t: T, publicId: string) => await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique())!);
const notesFor = async (t: T, p: Person) => await t.run(async (ctx) => await ctx.db.query("notifications").withIndex("by_profile_created", (q) => q.eq("profileId", p.profileId as Id<"profiles">)).collect());

/** Brings a version holding `blocks` into `note` and puts the note back to it. */
async function importAndRestore(p: Person, note: string, blocks: WireBlock[]) {
  const id = ulid();
  await p.as.mutation(api.documents.importSnapshot, { documentId: note, id, title: "Brought in", icon: null, blocks, createdAt: Date.now() - 1000 });
  await p.as.mutation(api.documents.restoreSnapshot, { snapshotId: id });
}

describe("a block id belongs to one block, in one note", () => {
  test("a version brought in with someone else's block ids can't take them", async () => {
    const t = setup();
    const w = await world(t, "ids");
    const plan = await newPage(w.owner, w.scope, "Plan");
    const taskId = ulid();
    const lineId = ulid();
    for (const r of await write(w.owner, plan, [todo(taskId, "Ship it"), para(lineId, "A line", "W")])) expect(r.status).toBe("applied");
    // Someone who can only read the page learns its block ids.
    await w.owner.as.mutation(api.sharing.grant, { documentId: plan, email: w.guestEmail, role: "viewer" });
    const seen = (await w.guest.as.query(api.blocks.list, { documentId: plan }))!.blocks.map((b) => b.id);
    expect(seen).toEqual(expect.arrayContaining([taskId, lineId]));
    const mine = await newPage(w.guest, PERSONAL, "Mine");
    await importAndRestore(w.guest, mine, [para(taskId, "not a to-do"), para(lineId, "mine now", "W")]);
    // Each id still names one block, the owner's; the lines brought in got ids of their own.
    for (const id of [taskId, lineId]) {
      const rows = await rowsWithBlockId(t, id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.documentId).toBe((await docRow(t, plan))._id);
    }
    const restored = (await w.guest.as.query(api.blocks.list, { documentId: mine }))!.blocks;
    expect(restored.map((b) => (b.text[0] as { text: string }).text).sort()).toEqual(["mine now", "not a to-do"]);
    // The owner's to-do is still theirs, and the page still takes edits and comments on those lines.
    const tasks = await taskOf(t, taskId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: "Ship it", documentId: (await docRow(t, plan))._id });
    const [edit] = await w.owner.as.mutation(api.sync.push, {
      scope: PERSONAL,
      deviceId: "device-audit",
      ops: [{ opId: ulid(), kind: "block.upsert", documentId: plan, block: para(lineId, "A line, edited", "W"), baseRevision: 1, fields: ["content"] }],
    });
    expect(edit!.status).toBe("applied");
    await w.owner.as.mutation(api.comments.create, { documentId: plan, blockId: lineId, body: [{ type: "text", text: "Still works" }] });
  });

  test("a version's blocks are checked like any block, and each id is used once", async () => {
    const t = setup();
    const p = await person(t, "ids-valid@example.com");
    const note = await newPage(p, PERSONAL, "Note");
    const base = { documentId: note, title: "V", icon: null, createdAt: Date.now() - 1000 };
    await expect(p.as.mutation(api.documents.importSnapshot, { ...base, id: ulid(), blocks: [{ ...para(ulid(), "x"), type: "not a type!" }] })).rejects.toThrow(/invalid block type/);
    await expect(p.as.mutation(api.documents.importSnapshot, { ...base, id: ulid(), blocks: [{ ...para(ulid(), "x"), id: "bad id" }] })).rejects.toThrow(/invalid id/);
    const twice = ulid();
    await expect(p.as.mutation(api.documents.importSnapshot, { ...base, id: ulid(), blocks: [para(twice, "a"), para(twice, "b", "W")] })).rejects.toThrow(/used twice/);
  });

  test("a row left under another note's block id (older data) never touches that note's to-do", async () => {
    const t = setup();
    const victim = await person(t, "ids-victim@example.com");
    const attacker = await person(t, "ids-attacker@example.com");
    const plan = await newPage(victim, PERSONAL, "Plan");
    const taskId = ulid();
    await write(victim, plan, [todo(taskId, "Pay rent")]);
    const mine = await newPage(attacker, PERSONAL, "Mine");
    // As the hole left it: a second row with the same block id, in the attacker's note.
    await t.run(async (ctx) => {
      const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", mine)).unique())!;
      await ctx.db.insert("blocks", { ownerProfileId: doc.ownerProfileId!, blockId: taskId, documentId: doc._id, parentId: null, rank: "V", type: "paragraph", schemaVersion: SCHEMA_VERSION, text: [], props: {}, revision: 1, contentRev: 1, positionRev: 1, seq: 1, createdAt: Date.now(), updatedAt: Date.now(), updatedBy: doc.createdBy });
    });
    await importAndRestore(attacker, mine, [para(ulid(), "anything")]);
    const tasks = await taskOf(t, taskId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: "Pay rent", documentId: (await docRow(t, plan))._id });
  });
});

describe("to-dos name, and remind, only people who can see the note", () => {
  test("a to-do can't be assigned to a stranger through its block, so they get no reminder", async () => {
    const t = setup();
    const attacker = await person(t, "remind-attacker@example.com");
    const victim = await person(t, "remind-victim@example.com");
    const note = await newPage(attacker, PERSONAL, "Your account is locked");
    const taskId = ulid();
    const [r] = await write(attacker, note, [todo(taskId, "Visit evil.example to unlock", { assigneeId: victim.profileId, reminderAt: Date.now() - 1000 })]);
    expect(r!.status).toBe("applied");
    expect((await taskOf(t, taskId))[0]!.assigneeId).toBeUndefined();
    await t.mutation(internal.tasks.processReminders, {});
    expect(await notesFor(t, victim)).toHaveLength(0);
  });

  test("a to-do row that names someone who can't open the note (older data) reminds nobody", async () => {
    const t = setup();
    const attacker = await person(t, "remind-old-attacker@example.com");
    const victim = await person(t, "remind-old-victim@example.com");
    const note = await newPage(attacker, PERSONAL, "Note");
    const taskId = ulid();
    await write(attacker, note, [todo(taskId, "Click here", { reminderAt: Date.now() - 1000 })]);
    await t.run(async (ctx) => {
      const task = (await ctx.db.query("tasks").withIndex("by_block", (q) => q.eq("blockId", taskId)).unique())!;
      await ctx.db.patch(task._id, { assigneeId: victim.profileId as Id<"profiles"> });
    });
    await t.mutation(internal.tasks.processReminders, {});
    expect(await notesFor(t, victim)).toHaveLength(0);
  });

  test("someone removed from a workspace gets no more reminders from it; a member still does", async () => {
    const t = setup();
    const w = await world(t, "remind");
    const page = await newPage(w.owner, w.scope, "Launch");
    const mineId = ulid();
    const theirsId = ulid();
    // The member's own to-do, and one the owner gives them: both due for a reminder.
    expect((await write(w.member, page, [todo(mineId, "Draft the post", { reminderAt: Date.now() - 1000 })]))[0]!.status).toBe("applied");
    expect((await write(w.owner, page, [todo(theirsId, "Book the room", { assigneeId: w.member.profileId, reminderAt: Date.now() - 1000 }, "W")]))[0]!.status).toBe("applied");
    expect((await taskOf(t, theirsId))[0]!.assigneeId).toBe(w.member.profileId);
    await w.owner.as.mutation(api.workspaces.removeMember, { workspaceId: w.workspaceId, profileId: w.member.profileId });
    await t.mutation(internal.tasks.processReminders, {});
    expect((await notesFor(t, w.member)).filter((n) => n.title.startsWith("Reminder"))).toHaveLength(0);

    // While they're a member, the same reminders arrive.
    const w2 = await world(t, "remind2");
    const page2 = await newPage(w2.owner, w2.scope, "Launch");
    await write(w2.owner, page2, [todo(ulid(), "Book the room", { assigneeId: w2.member.profileId, reminderAt: Date.now() - 1000 })]);
    await t.mutation(internal.tasks.processReminders, {});
    expect((await notesFor(t, w2.member)).filter((n) => n.title === "Reminder: Book the room")).toHaveLength(1);
  });
});

describe("a synced block comes along only when its content is yours to show", () => {
  async function secretSource(w: Awaited<ReturnType<typeof world>>) {
    const restricted = await newPage(w.owner, w.scope, "Board only");
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: restricted, mode: "restricted" });
    const sourceId = ulid();
    const results = await w.owner.as.mutation(api.sync.push, {
      scope: w.scope,
      deviceId: "device-audit",
      ops: [
        { opId: ulid(), kind: "document.create", document: { id: sourceId, parentDocumentId: null, folderId: null, kind: "synced", title: "", icon: null, scope: w.scope } },
        { opId: ulid(), kind: "block.upsert", documentId: sourceId, block: para(ulid(), "Secret numbers"), baseRevision: null, fields: ["content", "position"] },
        { opId: ulid(), kind: "block.upsert", documentId: restricted, block: syncedBlock(ulid(), sourceId), baseRevision: null, fields: ["content", "position"] },
      ],
    });
    expect(results.map((r) => r.status)).toEqual(["applied", "applied", "applied"]);
    return sourceId;
  }

  test("not through a version brought in and then copied into the content's workspace", async () => {
    const t = setup();
    const w = await world(t, "syn");
    const sourceId = await secretSource(w);
    expect(await w.member.as.query(api.blocks.list, { documentId: sourceId })).toBeNull();
    // The member knows the content's id (they were on the page once). A version with a synced block naming it:
    const mine = await newPage(w.member, PERSONAL, "Mine");
    await importAndRestore(w.member, mine, [syncedBlock(ulid(), sourceId), para(ulid(), "A line of mine", "W")]);
    expect((await w.member.as.query(api.blocks.list, { documentId: mine }))!.blocks.map((b) => b.type)).toEqual(["paragraph"]);
    const copy = await w.member.as.mutation(api.copies.copyTo, { documentId: mine, destination: w.scope });
    expect(await w.member.as.query(api.blocks.list, { documentId: sourceId })).toBeNull();
    expect(await w.member.as.query(api.documents.get, { documentId: sourceId })).toBeNull();
    expect(await textOf(t, copy.id)).not.toContain("Secret numbers");
  });

  test("not through a copy of a note that already holds the block (older data)", async () => {
    const t = setup();
    const w = await world(t, "syn-old");
    const sourceId = await secretSource(w);
    const mine = await newPage(w.member, PERSONAL, "Mine");
    await t.run(async (ctx) => {
      const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", mine)).unique())!;
      await ctx.db.insert("blocks", { ownerProfileId: doc.ownerProfileId!, blockId: ulid(), documentId: doc._id, parentId: null, rank: "V", type: "synced", schemaVersion: SCHEMA_VERSION, text: [], props: { sourceId }, revision: 1, contentRev: 1, positionRev: 1, seq: 1, createdAt: Date.now(), updatedAt: Date.now(), updatedBy: doc.createdBy });
    });
    const copy = await w.member.as.mutation(api.copies.copyTo, { documentId: mine, destination: w.scope });
    expect((await w.member.as.query(api.blocks.list, { documentId: copy.id }))!.blocks.filter((b) => b.type === "synced")).toHaveLength(0);
    expect(await w.member.as.query(api.blocks.list, { documentId: sourceId })).toBeNull();
    // Duplicating a note whose synced content you can read keeps the block.
    const open = await newPage(w.owner, w.scope, "Open page");
    const ownSource = ulid();
    await w.owner.as.mutation(api.sync.push, {
      scope: w.scope,
      deviceId: "device-audit",
      ops: [
        { opId: ulid(), kind: "document.create", document: { id: ownSource, parentDocumentId: null, folderId: null, kind: "synced", title: "", icon: null, scope: w.scope } },
        { opId: ulid(), kind: "block.upsert", documentId: ownSource, block: para(ulid(), "Shared line"), baseRevision: null, fields: ["content", "position"] },
        { opId: ulid(), kind: "block.upsert", documentId: open, block: syncedBlock(ulid(), ownSource), baseRevision: null, fields: ["content", "position"] },
      ],
    });
    const dup = await w.member.as.mutation(api.documents.duplicate, { documentId: open });
    expect((await w.member.as.query(api.blocks.list, { documentId: dup.id }))!.blocks.map((b) => b.type)).toEqual(["synced"]);
  });
});
