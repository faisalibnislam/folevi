import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { rankBetween, SCHEMA_VERSION, taskViews, ulid, type WireBlock } from "@folevi/editor-schema";
import { accessAtLeast, assertWritable, documentAccess, getDocumentByPublicId, requireProfile, requireWorkspace } from "./lib/auth";
import { fail } from "./lib/errors";
import { liveBlocks, toWireBlock } from "./lib/documents";
import { SyncEngine } from "./lib/syncEngine";

const vView = v.union(v.literal("inbox"), v.literal("today"), v.literal("upcoming"), v.literal("all"), v.literal("completed"), v.literal("mine"));

async function present(ctx: QueryCtx, profile: Doc<"profiles">, tasks: Doc<"tasks">[]) {
  const docs = new Map<string, Doc<"documents"> | null>();
  const readable = new Map<string, boolean>();
  const out = [];
  for (const t of tasks) {
    if (!docs.has(t.documentId)) docs.set(t.documentId, await ctx.db.get(t.documentId));
    const d = docs.get(t.documentId);
    if (!d || d.inTrash) continue;
    if (!readable.has(d._id)) readable.set(d._id, accessAtLeast(await documentAccess(ctx, profile, d), "read"));
    if (!readable.get(d._id)) continue;
    const assignee = t.assigneeId ? await ctx.db.get(t.assigneeId) : null;
    out.push({
      blockId: t.blockId,
      documentId: d.publicId,
      documentTitle: d.title,
      documentIcon: d.icon ?? null,
      title: t.title,
      status: t.status,
      dueDate: t.dueDate ?? null,
      dueTime: t.dueTime ?? null,
      priority: t.priority,
      assigneeId: t.assigneeId ?? null,
      assigneeName: assignee?.displayName ?? null,
      reminderAt: t.reminderAt ?? null,
      completedAt: t.completedAt ?? null,
      updatedAt: t.updatedAt,
    });
  }
  return out;
}

/** Global task views. `today` is the viewer's local date (the client knows its time zone best). */
export const list = query({
  args: { workspaceId: v.string(), view: vView, today: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { workspace } = await requireWorkspace(ctx, profile, args.workspaceId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.today)) fail("invalid_argument", "Invalid date.");
    let rows: Doc<"tasks">[];
    if (args.view === "completed") {
      rows = await ctx.db
        .query("tasks")
        .withIndex("by_workspace_status_completed", (q) => q.eq("workspaceId", workspace._id).eq("status", "done"))
        .order("desc")
        .take(200);
    } else if (args.view === "mine") {
      rows = (
        await ctx.db
          .query("tasks")
          .withIndex("by_assignee_status", (q) => q.eq("assigneeId", profile._id).eq("status", "open"))
          .take(500)
      ).filter((t) => t.workspaceId === workspace._id);
    } else {
      rows = await ctx.db
        .query("tasks")
        .withIndex("by_workspace_status_due", (q) => q.eq("workspaceId", workspace._id).eq("status", "open"))
        .take(1000);
      rows = rows.filter((t) => taskViews({ status: t.status, dueDate: t.dueDate ?? null, assigneeId: t.assigneeId ?? null }, args.today, profile._id).includes(args.view));
    }
    rows = rows.filter((t) => !t.documentInTrash);
    const presented = await present(ctx, profile, rows);
    if (args.view !== "completed") {
      presented.sort(
        (a, b) =>
          (a.dueDate ?? "9999") < (b.dueDate ?? "9999") ? -1 : (a.dueDate ?? "9999") > (b.dueDate ?? "9999") ? 1 : (a.dueTime ?? "99") < (b.dueTime ?? "99") ? -1 : b.updatedAt - a.updatedAt,
      );
    }
    return presented;
  },
});

export const counts = query({
  args: { workspaceId: v.string(), today: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { workspace } = await requireWorkspace(ctx, profile, args.workspaceId);
    const open = (
      await ctx.db
        .query("tasks")
        .withIndex("by_workspace_status_due", (q) => q.eq("workspaceId", workspace._id).eq("status", "open"))
        .take(1000)
    ).filter((t) => !t.documentInTrash);
    const c = { inbox: 0, today: 0, upcoming: 0, all: 0, mine: 0 };
    for (const t of open) for (const view of taskViews({ status: "open", dueDate: t.dueDate ?? null, assigneeId: t.assigneeId ?? null }, args.today, profile._id)) {
      if (view in c) c[view as keyof typeof c]++;
    }
    return c;
  },
});

/** Tasks due within a date range, for the calendar. */
export const range = query({
  args: { workspaceId: v.string(), from: v.string(), to: v.string(), includeCompleted: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { workspace } = await requireWorkspace(ctx, profile, args.workspaceId);
    const statuses: Doc<"tasks">["status"][] = args.includeCompleted ? ["open", "done"] : ["open"];
    const rows: Doc<"tasks">[] = [];
    for (const status of statuses) {
      rows.push(
        ...(await ctx.db
          .query("tasks")
          .withIndex("by_workspace_status_due", (q) => q.eq("workspaceId", workspace._id).eq("status", status).gte("dueDate", args.from).lte("dueDate", args.to))
          .take(1000)),
      );
    }
    return await present(ctx, profile, rows.filter((t) => !t.documentInTrash));
  },
});

async function taskBlock(ctx: MutationCtx, profile: Doc<"profiles">, blockId: string) {
  const row = await ctx.db
    .query("blocks")
    .withIndex("by_block_id", (q) => q.eq("blockId", blockId))
    .unique();
  if (!row || row.deletedAt !== undefined || row.type !== "todo") fail("not_found", "Task not found.");
  const doc = (await ctx.db.get(row.documentId))!;
  const access = await documentAccess(ctx, profile, doc);
  if (access === "none") fail("not_found", "Task not found.");
  if (!accessAtLeast(access, "write")) fail("forbidden", "You can't edit this task.");
  const workspace = (await ctx.db.get(doc.workspaceId))!;
  return { row, doc, workspace };
}

/** Edits a task's canonical block (server-side convenience for list/calendar views). Returns undo info. */
export const update = mutation({
  args: {
    blockId: v.string(),
    checked: v.optional(v.boolean()),
    dueDate: v.optional(v.union(v.string(), v.null())),
    dueTime: v.optional(v.union(v.string(), v.null())),
    priority: v.optional(v.union(v.literal("none"), v.literal("low"), v.literal("medium"), v.literal("high"))),
    assigneeId: v.optional(v.union(v.string(), v.null())),
    reminderAt: v.optional(v.union(v.number(), v.null())),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { row, doc, workspace } = await taskBlock(ctx, profile, args.blockId);
    const before = toWireBlock(row);
    const props = { ...(row.props as Record<string, unknown>) };
    if (args.checked !== undefined) {
      props.checked = args.checked;
      if (args.checked) props.completedAt = Date.now();
      else delete props.completedAt;
    }
    if (args.dueDate !== undefined) {
      if (args.dueDate === null) {
        delete props.dueDate;
        delete props.dueTime;
      } else props.dueDate = args.dueDate;
    }
    if (args.dueTime !== undefined) {
      if (args.dueTime === null) delete props.dueTime;
      else props.dueTime = args.dueTime;
    }
    if (args.priority !== undefined) {
      if (args.priority === "none") delete props.priority;
      else props.priority = args.priority;
    }
    if (args.assigneeId !== undefined) {
      if (args.assigneeId === null) delete props.assigneeId;
      else {
        const id = ctx.db.normalizeId("profiles", args.assigneeId);
        const member = id ? await ctx.db.query("workspaceMembers").withIndex("by_workspace_profile", (q) => q.eq("workspaceId", doc.workspaceId).eq("profileId", id)).unique() : null;
        if (!member) fail("invalid_argument", "Assignees must be workspace members.");
        props.assigneeId = args.assigneeId;
      }
    }
    if (args.reminderAt !== undefined) {
      if (args.reminderAt === null) delete props.reminderAt;
      else props.reminderAt = args.reminderAt;
    }
    const engine = new SyncEngine(ctx, profile, args.deviceId ?? "server");
    const [result] = await engine.applyAll(workspace.publicId, [
      {
        opId: ulid(),
        kind: "block.upsert",
        documentId: doc.publicId,
        block: { ...before, props },
        baseRevision: row.contentRev,
        fields: ["content"],
      },
    ]);
    if (!result || result.status !== "applied") fail("conflict", result?.error?.message ?? "The task changed elsewhere. Try again.");
    return { before: before.props, revision: result.revision };
  },
});

/**
 * Quick Add: creates a todo block. With a document it is appended there; otherwise it goes into the
 * person's Daily Note for `today` (created if needed), so every task always lives in a document.
 */
export const quickAdd = mutation({
  args: {
    workspaceId: v.string(),
    title: v.string(),
    today: v.string(),
    dueDate: v.optional(v.string()),
    dueTime: v.optional(v.string()),
    documentId: v.optional(v.string()),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace } = await requireWorkspace(ctx, profile, args.workspaceId, "editor");
    const title = args.title.trim().slice(0, 500);
    if (!title) fail("invalid_argument", "Write the task first.");
    const engine = new SyncEngine(ctx, profile, args.deviceId ?? "server");
    let docPublicId = args.documentId;
    if (!docPublicId) {
      const daily = await ctx.db
        .query("documents")
        .withIndex("by_daily", (q) => q.eq("workspaceId", workspace._id).eq("dailyOwnerId", profile._id).eq("dailyDate", args.today))
        .first();
      if (daily && !daily.inTrash) docPublicId = daily.publicId;
      else {
        docPublicId = ulid();
        const [r] = await engine.applyAll(workspace.publicId, [
          {
            opId: ulid(),
            kind: "document.create",
            document: { id: docPublicId, parentDocumentId: null, folderId: null, kind: "daily", title: dailyTitle(args.today), icon: null, dailyDate: args.today },
          },
        ]);
        if (r?.status === "conflict" && r.document) docPublicId = r.document.id;
      }
    }
    const doc = await getDocumentByPublicId(ctx, docPublicId);
    if (!doc) fail("not_found", "Document not found.");
    const roots = (await liveBlocks(ctx, doc._id)).filter((b) => b.parentId === null).sort((a, b) => (a.rank < b.rank ? -1 : 1));
    const last = roots[roots.length - 1]?.rank ?? null;
    const props: Record<string, unknown> = { checked: false };
    if (args.dueDate) props.dueDate = args.dueDate;
    if (args.dueDate && args.dueTime) props.dueTime = args.dueTime;
    const block: WireBlock = {
      id: ulid(),
      type: "todo",
      parentId: null,
      rank: rankBetween(last, null),
      schemaVersion: SCHEMA_VERSION,
      text: [{ type: "text", text: title }],
      props,
    };
    const engine2 = new SyncEngine(ctx, profile, args.deviceId ?? "server");
    const [result] = await engine2.applyAll(workspace.publicId, [
      { opId: ulid(), kind: "block.upsert", documentId: doc.publicId, block, baseRevision: null, fields: ["content", "position"] },
    ]);
    if (!result || result.status !== "applied") fail("invalid_argument", result?.error?.message ?? "Could not add the task.");
    return { blockId: block.id, documentId: doc.publicId };
  },
});

export function dailyTitle(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Moves a task (and nothing else) into another document: new block there, tombstone here. */
export const moveToDocument = mutation({
  args: { blockId: v.string(), documentId: v.string(), deviceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { row, doc, workspace } = await taskBlock(ctx, profile, args.blockId);
    const target = await getDocumentByPublicId(ctx, args.documentId);
    if (!target || target.workspaceId !== doc.workspaceId) fail("not_found", "Document not found.");
    const roots = (await liveBlocks(ctx, target._id)).filter((b) => b.parentId === null).sort((a, b) => (a.rank < b.rank ? -1 : 1));
    const moved: WireBlock = { ...toWireBlock(row), id: ulid(), parentId: null, rank: rankBetween(roots[roots.length - 1]?.rank ?? null, null) };
    delete moved.revision;
    const engine = new SyncEngine(ctx, profile, args.deviceId ?? "server");
    const results = await engine.applyAll(workspace.publicId, [
      { opId: ulid(), kind: "block.upsert", documentId: target.publicId, block: moved, baseRevision: null, fields: ["content", "position"] },
      { opId: ulid(), kind: "block.delete", documentId: doc.publicId, blockId: row.blockId, baseRevision: row.revision },
    ]);
    if (results.some((r) => r.status !== "applied")) fail("conflict", "Could not move the task.");
    return { blockId: moved.id };
  },
});

/** Creates in-app notifications for due reminders (the Mac app also schedules local notifications). */
export const processReminders = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("tasks")
      .withIndex("by_reminder", (q) => q.gte("reminderAt", now - 24 * 60 * 60 * 1000).lte("reminderAt", now))
      .take(200);
    let sent = 0;
    for (const t of due) {
      if (t.reminderSentAt || t.status !== "open" || t.documentInTrash) continue;
      const recipient = t.assigneeId ?? t.createdBy;
      await ctx.db.insert("notifications", {
        profileId: recipient,
        workspaceId: t.workspaceId,
        kind: "system",
        documentId: t.documentId,
        title: `Reminder: ${t.title.slice(0, 120) || "Task"}`,
        createdAt: now,
      });
      await ctx.db.patch(t._id, { reminderSentAt: now });
      sent++;
    }
    return sent;
  },
});

