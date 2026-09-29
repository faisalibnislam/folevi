import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { inboxDocumentId, rankBetween, SCHEMA_VERSION, scopeIdKey, taskViews, ulid, type WireBlock } from "@folevi/editor-schema";
import { accessAtLeast, assertWritable, documentAccess, getDocumentByPublicId, PageReader, requireProfile, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { liveBlocks, toWireBlock } from "./lib/documents";
import { SyncEngine } from "./lib/syncEngine";
import { inScope, sameScopeRows, vScopeArg, type Scope, type ScopeArg } from "./lib/scope";
import { setTrashState } from "./documents";

/** A scope's tasks of one status (Personal: by owner; a workspace: by workspace), by due date. */
function tasksByDue(ctx: QueryCtx, scope: Scope, status: Doc<"tasks">["status"], range?: { from: string; to: string }) {
  const base = ctx.db.query("tasks");
  if (scope.kind === "personal") {
    return base.withIndex("by_owner_status_due", (q) => {
      const b = q.eq("ownerProfileId", scope.profileId).eq("status", status);
      return range ? b.gte("dueDate", range.from).lte("dueDate", range.to) : b;
    });
  }
  return base.withIndex("by_workspace_status_due", (q) => {
    const b = q.eq("workspaceId", scope.workspaceId).eq("status", status);
    return range ? b.gte("dueDate", range.from).lte("dueDate", range.to) : b;
  });
}

/** A scope's closed tasks of one status, most recently closed first. */
function tasksByCompleted(ctx: QueryCtx, scope: Scope, status: Doc<"tasks">["status"]) {
  const base = ctx.db.query("tasks");
  return (
    scope.kind === "personal"
      ? base.withIndex("by_owner_status_completed", (q) => q.eq("ownerProfileId", scope.profileId).eq("status", status))
      : base.withIndex("by_workspace_status_completed", (q) => q.eq("workspaceId", scope.workspaceId).eq("status", status))
  ).order("desc");
}

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

/** Task views of a scope. `today` is the viewer's local date (the client knows its time zone best). */
export const list = query({
  args: { scope: vScopeArg, view: vView, today: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.today)) fail("invalid_argument", "Invalid date.");
    // In your own Personal unassigned tasks are yours (a Personal scope is always the caller's own).
    const personal = scope.kind === "personal";
    let rows: Doc<"tasks">[];
    if (args.view === "completed") {
      // Closed tasks: done and canceled, most recently closed first.
      const closed: Doc<"tasks">[] = [];
      for (const status of ["done", "canceled"] as const) closed.push(...(await tasksByCompleted(ctx, scope, status).take(200)));
      rows = closed.sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt)).slice(0, 200);
    } else if (args.view === "mine" && !personal) {
      rows = (
        await ctx.db
          .query("tasks")
          .withIndex("by_assignee_status", (q) => q.eq("assigneeId", profile._id).eq("status", "open"))
          .take(500)
      ).filter((t) => inScope(t, scope));
    } else {
      rows = await tasksByDue(ctx, scope, "open").take(1000);
      rows = rows.filter((t) => taskViews({ status: t.status, dueDate: t.dueDate ?? null, assigneeId: t.assigneeId ?? null }, args.today, profile._id, { personal }).includes(args.view));
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
  args: { scope: vScopeArg, today: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const standing = await resolveScope(ctx, profile, args.scope);
    const { scope } = standing;
    // Only tasks on pages this person can open count (the same tasks the lists show them): a member's
    // numbers never include a restricted page they can't open.
    const reader = new PageReader(ctx, profile, standing);
    const open: Doc<"tasks">[] = [];
    for (const t of await tasksByDue(ctx, scope, "open").take(1000)) {
      if (!t.documentInTrash && (await reader.canOpenId(t.documentId))) open.push(t);
    }
    const c = { inbox: 0, today: 0, upcoming: 0, all: 0, mine: 0 };
    // In your own Personal unassigned tasks are yours.
    const personal = scope.kind === "personal";
    for (const t of open) for (const view of taskViews({ status: "open", dueDate: t.dueDate ?? null, assigneeId: t.assigneeId ?? null }, args.today, profile._id, { personal })) {
      if (view in c) c[view as keyof typeof c]++;
    }
    return c;
  },
});

/** Tasks due within a date range, for the calendar. */
export const range = query({
  args: { scope: vScopeArg, from: v.string(), to: v.string(), includeCompleted: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    const statuses: Doc<"tasks">["status"][] = args.includeCompleted ? ["open", "done"] : ["open"];
    const rows: Doc<"tasks">[] = [];
    for (const status of statuses) rows.push(...(await tasksByDue(ctx, scope, status, { from: args.from, to: args.to }).take(1000)));
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
  return { row, doc };
}

/** Edits a task's canonical block (server-side convenience for list/calendar views). Returns undo info. */
export const update = mutation({
  args: {
    blockId: v.string(),
    checked: v.optional(v.boolean()),
    canceled: v.optional(v.boolean()),
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
    const { row, doc } = await taskBlock(ctx, profile, args.blockId);
    const before = toWireBlock(row);
    const props = { ...(row.props as Record<string, unknown>) };
    if (args.checked !== undefined) {
      props.checked = args.checked;
      if (args.checked) {
        props.completedAt = Date.now();
        delete props.canceled;
      } else delete props.completedAt;
    }
    if (args.canceled !== undefined) {
      if (args.canceled) {
        props.canceled = true;
        props.checked = false;
        props.completedAt = Date.now(); // when it was closed (orders the Completed view)
      } else {
        delete props.canceled;
        if (!props.checked) delete props.completedAt;
      }
    }
    if (args.dueDate !== undefined && args.dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(args.dueDate)) fail("invalid_argument", "Invalid date.");
    if (args.dueTime !== undefined && args.dueTime !== null && !/^\d{2}:\d{2}$/.test(args.dueTime)) fail("invalid_argument", "Invalid time.");
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
        const assignee = id ? await ctx.db.get(id) : null;
        // Someone who can see the note: a member of its workspace or, in Personal, its owner or a guest on it.
        const workspaceId = doc.workspaceId;
        const member = assignee && workspaceId ? await ctx.db.query("workspaceMembers").withIndex("by_workspace_profile", (q) => q.eq("workspaceId", workspaceId).eq("profileId", assignee._id)).unique() : null;
        const canSee = workspaceId ? Boolean(member) : Boolean(assignee && assignee.status === "active" && accessAtLeast(await documentAccess(ctx, assignee, doc), "read"));
        if (!canSee) fail("invalid_argument", workspaceId ? "Assignees must be workspace members." : "Assignees must be able to see this note.");
        props.assigneeId = args.assigneeId;
      }
    }
    if (args.reminderAt !== undefined) {
      if (args.reminderAt === null) delete props.reminderAt;
      else props.reminderAt = args.reminderAt;
    }
    const engine = new SyncEngine(ctx, profile, args.deviceId ?? "server");
    const [result] = await engine.applyAll(null, [
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
 * person's Inbox page (created if needed, brought back if it was in Trash), so every task always lives
 * in a document. The Inbox id is deterministic so offline clients create the same page.
 */
export const quickAdd = mutation({
  args: {
    scope: vScopeArg,
    title: v.string(),
    today: v.string(),
    dueDate: v.optional(v.string()),
    dueTime: v.optional(v.string()),
    priority: v.optional(v.union(v.literal("none"), v.literal("low"), v.literal("medium"), v.literal("high"))),
    documentId: v.optional(v.string()),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { scope, workspace } = await resolveScope(ctx, profile, args.scope, "edit");
    const scopeArg: ScopeArg = workspace ? { kind: "workspace", workspaceId: workspace.publicId } : { kind: "personal" };
    const title = args.title.trim().slice(0, 500);
    if (!title) fail("invalid_argument", "Write the task first.");
    const engine = new SyncEngine(ctx, profile, args.deviceId ?? "server");
    let docPublicId = args.documentId;
    if (!docPublicId) {
      docPublicId = inboxDocumentId(profile._id, scopeIdKey(scopeArg));
      let existing = await getDocumentByPublicId(ctx, docPublicId);
      // Someone else's page can't have this id, but never write into one that isn't in this scope.
      if (existing && !inScope(existing, scope)) fail("conflict", "Could not find your Inbox.");
      if (!existing && scope.kind === "personal") {
        // Inboxes made before Personal stopped being a workspace have an id keyed by that workspace.
        const legacy = await legacyPersonalInbox(ctx, scope.profileId);
        if (legacy) {
          existing = legacy;
          docPublicId = legacy.publicId;
        }
      }
      if (existing?.inTrash) await setTrashState(ctx, existing, profile._id, false, undefined);
      else if (!existing) {
        const [r] = await engine.applyAll(scopeArg, [
          {
            opId: ulid(),
            kind: "document.create",
            document: { id: docPublicId, parentDocumentId: null, folderId: null, kind: "document", title: "Inbox", icon: "📥" },
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
    if (args.priority && args.priority !== "none") props.priority = args.priority;
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
    const [result] = await engine2.applyAll(scopeArg, [
      { opId: ulid(), kind: "block.upsert", documentId: doc.publicId, block, baseRevision: null, fields: ["content", "position"] },
    ]);
    if (!result || result.status !== "applied") fail("invalid_argument", result?.error?.message ?? "Could not add the task.");
    return { blockId: block.id, documentId: doc.publicId };
  },
});

/**
 * The Inbox page someone made in their Personal back when it was a workspace (its deterministic id was
 * keyed by that workspace, which no longer exists): their own page titled Inbox with an "inbox-" id.
 */
async function legacyPersonalInbox(ctx: MutationCtx, owner: Doc<"profiles">["_id"]): Promise<Doc<"documents"> | null> {
  const hits = await ctx.db
    .query("documents")
    .withSearchIndex("search_title", (q) => q.search("title", "Inbox").eq("ownerProfileId", owner))
    .take(20);
  return hits.find((d) => d.publicId.startsWith("inbox-") && d.createdBy === owner && d.title === "Inbox") ?? null;
}

/** Moves a task (and nothing else) into another document: new block there, tombstone here. */
export const moveToDocument = mutation({
  args: { blockId: v.string(), documentId: v.string(), deviceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { row, doc } = await taskBlock(ctx, profile, args.blockId);
    const target = await getDocumentByPublicId(ctx, args.documentId);
    // Tasks never move between Personal and a workspace.
    if (!target || !sameScopeRows(target, doc)) fail("not_found", "Document not found.");
    const roots = (await liveBlocks(ctx, target._id)).filter((b) => b.parentId === null).sort((a, b) => (a.rank < b.rank ? -1 : 1));
    const moved: WireBlock = { ...toWireBlock(row), id: ulid(), parentId: null, rank: rankBetween(roots[roots.length - 1]?.rank ?? null, null) };
    delete moved.revision;
    const engine = new SyncEngine(ctx, profile, args.deviceId ?? "server");
    const results = await engine.applyAll(null, [
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

