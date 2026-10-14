// Task reminders: the bell notification and the reminder email, each following the person's choice.
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { reminderDueText } from "../../convex/tasks";
import { localDate } from "@folevi/editor-schema";
import { para, person, PERSONAL, setup, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function push(p: Person, ops: unknown[]) {
  return await p.as.mutation(api.sync.push, { scope: PERSONAL, deviceId: "device-reminders", ops: ops as never });
}

/** A page with one to-do whose reminder is already due. */
async function dueTodo(p: Person, text = "Call the plumber", props: Record<string, unknown> = {}) {
  const docId = ulid();
  await push(p, [{ opId: ulid(), kind: "document.create", document: { id: docId, parentDocumentId: null, folderId: null, kind: "document", title: "House jobs", icon: null } }]);
  const todo = { ...para(ulid(), text), type: "todo", props: { checked: false, reminderAt: Date.now() - 1000, ...props } };
  await push(p, [{ opId: ulid(), kind: "block.upsert", documentId: docId, block: todo, baseRevision: null, fields: ["content", "position"] }]);
  return { docId, blockId: todo.id };
}

async function reminderEmails(t: T) {
  const jobs = await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());
  return jobs.filter((j) => (j.args[0] as { key?: string })?.key === "task_reminder").map((j) => j.args[0] as { dataVariables: Record<string, string>; idempotencyKey: string });
}

async function bell(t: T, p: Person) {
  return await t.run(async (ctx) => await ctx.db.query("notifications").withIndex("by_profile_created", (q) => q.eq("profileId", p.profileId)).collect());
}

describe("task reminders", () => {
  test("a due reminder rings the bell and emails the to-do line with a link to it, once", async () => {
    const t = setup();
    const a = await person(t, "reminders@example.com");
    const { docId, blockId } = await dueTodo(a, "Call the plumber", { dueDate: "2026-10-16", dueTime: "15:00" });
    await t.mutation(internal.tasks.processReminders, {});
    const notes = await bell(t, a);
    expect(notes.filter((n) => n.title === "Reminder: Call the plumber")).toHaveLength(1);
    const [email] = await reminderEmails(t);
    expect(email!.dataVariables).toMatchObject({ taskTitle: "Call the plumber", documentTitle: "House jobs", due: "Fri 16 Oct, 15:00" });
    expect(email!.dataVariables.taskUrl).toMatch(new RegExp(`/d/${docId}#block-${blockId}$`));
    // A second run sends nothing more.
    await t.mutation(internal.tasks.processReminders, {});
    expect(await reminderEmails(t)).toHaveLength(1);
  });

  test("email and bell each follow Settings → Notifications", async () => {
    const t = setup();
    const a = await person(t, "quiet-reminders@example.com");
    const prefs = await t.run(async (ctx) => (await ctx.db.get(a.profileId))!.notificationPrefs);
    await a.as.mutation(api.users.updateProfile, { notificationPrefs: { ...prefs, reminders: false, inApp: { comments: true, replies: true, mentions: true, shares: true, access: true, reminders: false } } });
    await dueTodo(a);
    await t.mutation(internal.tasks.processReminders, {});
    expect((await bell(t, a)).filter((n) => n.title.startsWith("Reminder:"))).toHaveLength(0);
    expect(await reminderEmails(t)).toHaveLength(0);
  });

  test("due text reads plainly", () => {
    expect(reminderDueText(undefined)).toBe("No due date");
    expect(reminderDueText("2026-10-16")).toBe("Fri 16 Oct");
    expect(reminderDueText("2026-10-16", "09:30")).toBe("Fri 16 Oct, 09:30");
  });
});

describe("repeating tasks", () => {
  test("checking one off brings it back unchecked at its next date, reminder moved with it", async () => {
    const t = setup();
    const a = await person(t, "repeat@example.com");
    const today = localDate(Date.now(), "UTC");
    const docId = ulid();
    await push(a, [{ opId: ulid(), kind: "document.create", document: { id: docId, parentDocumentId: null, folderId: null, kind: "document", title: "Plants", icon: null } }]);
    const reminderAt = Date.parse(`${today}T08:00:00Z`);
    const todo = { ...para(ulid(), "Water the plants"), type: "todo", props: { checked: false, dueDate: today, repeat: "weekly", reminderAt } };
    const [made] = await push(a, [{ opId: ulid(), kind: "block.upsert", documentId: docId, block: todo, baseRevision: null, fields: ["content", "position"] }]);
    const task = () => t.run(async (ctx) => (await ctx.db.query("tasks").withIndex("by_block", (q) => q.eq("blockId", todo.id)).unique())!);
    expect((await task()).repeat).toBe("Every week");

    await push(a, [{ opId: ulid(), kind: "block.upsert", documentId: docId, block: { ...todo, props: { ...todo.props, checked: true, completedAt: Date.now() } }, baseRevision: made!.revision, fields: ["content"] }]);
    vi.useFakeTimers();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();

    const next = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    const row = await t.run(async (ctx) => (await ctx.db.query("blocks").withIndex("by_block_id", (q) => q.eq("blockId", todo.id)).unique())!);
    expect(row.props).toMatchObject({ checked: false, dueDate: next, repeat: "weekly", reminderAt: reminderAt + 7 * 86_400_000 });
    expect((row.props as Record<string, unknown>).completedAt).toBeUndefined();
    expect(await task()).toMatchObject({ status: "open", dueDate: next });
  });

  test("a to-do that doesn't repeat stays done", async () => {
    const t = setup();
    const a = await person(t, "norepeat@example.com");
    const { docId, blockId } = await dueTodo(a, "Once only", { reminderAt: undefined });
    const row = await t.run(async (ctx) => (await ctx.db.query("blocks").withIndex("by_block_id", (q) => q.eq("blockId", blockId)).unique())!);
    await push(a, [{ opId: ulid(), kind: "block.upsert", documentId: docId, block: { id: blockId, type: "todo", parentId: null, rank: row.rank, schemaVersion: 1, text: row.text, props: { checked: true } }, baseRevision: row.revision, fields: ["content"] }]);
    vi.useFakeTimers();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
    const after = await t.run(async (ctx) => (await ctx.db.query("tasks").withIndex("by_block", (q) => q.eq("blockId", blockId)).unique())!);
    expect(after.status).toBe("done");
  });
});
