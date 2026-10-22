import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { inboxDocumentId, localDate, nextOccurrence, rankBetween, repeatProps, repeatRule, SCHEMA_VERSION, scopeIdKey, taskViews, ulid, type WireBlock } from "@folevi/editor-schema";
import { accessAtLeast, assertWritable, documentAccess, getDocumentByPublicId, PageReader, requireProfile, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { liveBlocks, toWireBlock } from "./lib/documents";
import { SyncEngine } from "./lib/syncEngine";
import { inScope, sameScopeRows, scopeOfRow, vScopeArg, type Scope, type ScopeArg } from "./lib/scope";
import { setTrashState } from "./documents";
import { appUrl } from "./lib/notify";
import { schedulePush } from "./lib/push";
import { failE2ee, isSealed, isSealedBlock, spaceE2ee } from "./lib/e2ee/state";
import { requireServerWritable } from "./lib/e2ee/coreGuards";

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
    // A sealed note's to-dos are projected on the device (docs/E2EE_DESIGN.md §5.7).
    if (!d || d.inTrash || isSealed(d)) continue;
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
      repeat: t.repeat ?? null,
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
    return await listTasks(ctx, profile, scope, args.view, args.today);
  },
});

export type TaskView = "inbox" | "today" | "upcoming" | "all" | "completed" | "mine";

/** A task view of a scope for a person in it (also used by the MCP server, convex/mcp.ts). */
export async function listTasks(ctx: QueryCtx, profile: Doc<"profiles">, scope: Scope, view: TaskView, today: string) {
  const args = { view, today };
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
}

export const counts = query({
  args: { scope: vScopeArg, today: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const standing = await resolveScope(ctx, profile, args.scope);
    const { scope } = standing;
    // Only tasks on pages this person can open count (the same tasks the lists show them): a member's
    // numbers never include a restricted page they can't open. Someone who opens every page here needs
    // no page reads at all (the task row knows whether its page is in Trash).
    const reader = new PageReader(ctx, profile, standing);
    const all = await reader.opensAllInScope();
    const open: Doc<"tasks">[] = [];
    for (const t of await tasksByDue(ctx, scope, "open").take(1000)) {
      if (!t.documentInTrash && (all || (await reader.canOpenId(t.documentId)))) open.push(t);
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

export async function taskBlock(ctx: MutationCtx, profile: Doc<"profiles">, blockId: string) {
  const row = await ctx.db
    .query("blocks")
    .withIndex("by_block_id", (q) => q.eq("blockId", blockId))
    .unique();
  if (!row || row.deletedAt !== undefined) fail("not_found", "Task not found.");
  const doc = (await ctx.db.get(row.documentId))!;
  const access = await documentAccess(ctx, profile, doc);
  if (access === "none") fail("not_found", "Task not found.");
  // A sealed to-do is edited on the device, which seals the change (docs/E2EE_DESIGN.md §5.7).
  if (isSealedBlock(row) || isSealed(doc)) failE2ee("e2ee_device_only");
  if (row.type !== "todo") fail("not_found", "Task not found.");
  if (!accessAtLeast(access, "write")) fail("forbidden", "You can't edit this task.");
  await requireServerWritable(ctx, doc);
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
    /** A repeat (props repeat, repeatEvery, repeatDays; see editor-schema recurrence.ts). */
    repeat: v.optional(v.object({ repeat: v.union(v.string(), v.null()), repeatEvery: v.union(v.number(), v.null()), repeatDays: v.union(v.string(), v.null()) })),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { scope, workspace } = await resolveScope(ctx, profile, args.scope, "edit");
    const scopeArg: ScopeArg = workspace ? { kind: "workspace", workspaceId: workspace.publicId } : { kind: "personal" };
    const title = args.title.trim().slice(0, 500);
    if (!title) fail("invalid_argument", "Write the task first.");
    // In an encrypted space the device writes the sealed to-do itself (docs/E2EE_DESIGN.md §5.7).
    const space = await spaceE2ee(ctx, scope);
    if (space && space.level !== "standard") failE2ee("e2ee_device_only");
    const docPublicId = args.documentId ?? (await ensureInbox(ctx, profile, scope, scopeArg, args.deviceId ?? "server"));
    const doc = await getDocumentByPublicId(ctx, docPublicId);
    if (!doc) fail("not_found", "Document not found.");
    await requireServerWritable(ctx, doc);
    const roots = (await liveBlocks(ctx, doc._id)).filter((b) => b.parentId === null).sort((a, b) => (a.rank < b.rank ? -1 : 1));
    const last = roots[roots.length - 1]?.rank ?? null;
    const props: Record<string, unknown> = { checked: false };
    if (args.dueDate) props.dueDate = args.dueDate;
    if (args.dueDate && args.dueTime) props.dueTime = args.dueTime;
    if (args.priority && args.priority !== "none") props.priority = args.priority;
    const rule = args.repeat ? repeatRule(args.repeat) : null;
    if (rule) for (const [k, val] of Object.entries(repeatProps(rule))) if (val !== null) props[k] = val;
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
 * The person's Inbox page in a scope (created if needed, brought back if it was in Trash), as its public
 * id. Quick Add puts tasks there; AI digests (convex/aiDigest.ts) put their notes under it.
 */
export async function ensureInbox(ctx: MutationCtx, profile: Doc<"profiles">, scope: Scope, scopeArg: ScopeArg, deviceId = "server"): Promise<string> {
  let docPublicId = inboxDocumentId(profile._id, scopeIdKey(scopeArg));
  // An encrypted space's Inbox is sealed: in a Personal it's the page the space row names (set when the space
  // was encrypted, or by the device that made it, e2ee.content.setInbox), else the one at the deterministic
  // id; in a workspace (one Inbox per person) always the deterministic id. Never found by its title. Only a
  // device can make a sealed one (docs/E2EE_DESIGN.md §5.7).
  const space = await spaceE2ee(ctx, scope);
  if (space && space.level !== "standard") {
    const named = scope.kind === "personal" && space.inboxDocumentId ? await ctx.db.get(space.inboxDocumentId) : null;
    const sealedInbox = named && inScope(named, scope) ? named : await getDocumentByPublicId(ctx, docPublicId);
    if (!sealedInbox || !inScope(sealedInbox, scope) || sealedInbox.deletedAt !== undefined) failE2ee("e2ee_device_only");
    if (sealedInbox.inTrash) await setTrashState(ctx, sealedInbox, profile._id, false, undefined);
    return sealedInbox.publicId;
  }
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
    const [r] = await new SyncEngine(ctx, profile, deviceId).applyAll(scopeArg, [
      {
        opId: ulid(),
        kind: "document.create",
        document: { id: docPublicId, parentDocumentId: null, folderId: null, kind: "document", title: "Inbox", icon: "📥" },
      },
    ]);
    if (r?.status === "conflict" && r.document) docPublicId = r.document.id;
  }
  return docPublicId;
}

/**
 * The person's Inbox page in a place (made, or brought back from Trash, when needed) and the rank after its
 * last line. Save to Folevi (the share page) files a shared note under it through the sync engine, with
 * its card at the end of the Inbox; offline it uses the deterministic id instead.
 */
export const inbox = mutation({
  args: { scope: vScopeArg, deviceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { scope, workspace } = await resolveScope(ctx, profile, args.scope, "edit");
    const scopeArg: ScopeArg = workspace ? { kind: "workspace", workspaceId: workspace.publicId } : { kind: "personal" };
    const documentId = await ensureInbox(ctx, profile, scope, scopeArg, args.deviceId?.slice(0, 64) ?? "server");
    const doc = await getDocumentByPublicId(ctx, documentId);
    if (!doc) fail("not_found", "Could not find your Inbox.");
    const roots = (await liveBlocks(ctx, doc._id)).filter((b) => b.parentId === null);
    const lastRank = roots.reduce<string | null>((m, b) => (m === null || b.rank > m ? b.rank : m), null);
    return { documentId, lastRank };
  },
});

/**
 * The Inbox page someone made in their Personal back when it was a workspace (its deterministic id was
 * keyed by that workspace, which no longer exists): their own page titled Inbox with an "inbox-" id.
 */
export async function legacyPersonalInbox(ctx: MutationCtx, owner: Doc<"profiles">["_id"]): Promise<Doc<"documents"> | null> {
  const hits = await ctx.db
    .query("documents")
    .withSearchIndex("search_title", (q) => q.search("title", "Inbox").eq("ownerProfileId", owner))
    .take(20);
  return hits.find((d) => d.publicId.startsWith("inbox-") && d.createdBy === owner && d.title === "Inbox") ?? null;
}

/** Moves a task (and nothing else) into another document: new block there, tombstone here. */
export const moveToDocument = mutation({
  /** `documentId` unset: the person's Inbox page in the task's scope. */
  args: { blockId: v.string(), documentId: v.optional(v.string()), deviceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { row, doc } = await taskBlock(ctx, profile, args.blockId);
    let targetId = args.documentId;
    if (!targetId) {
      // Someone else's Personal page has no Inbox of yours: there it must be a chosen page.
      const scope = scopeOfRow(doc);
      if (scope.kind === "personal" && scope.profileId !== profile._id) fail("invalid_argument", "Choose a page to move it to.");
      const workspace = doc.workspaceId ? await ctx.db.get(doc.workspaceId) : null;
      const scopeArg: ScopeArg = workspace ? { kind: "workspace", workspaceId: workspace.publicId } : { kind: "personal" };
      targetId = await ensureInbox(ctx, profile, scope, scopeArg, args.deviceId ?? "server");
    }
    if (targetId === doc.publicId) return { blockId: row.blockId };
    const target = await getDocumentByPublicId(ctx, targetId);
    // Tasks never move between Personal and a workspace.
    if (!target || !sameScopeRows(target, doc)) fail("not_found", "Document not found.");
    await requireServerWritable(ctx, target);
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

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / DAY_MS);

/**
 * A repeating to-do was checked off (lib/documents.ts syncTaskProjection): it comes back unchecked at its
 * next date, with its reminder moved by as many days, as one edit by the person who checked it. Nothing
 * happens if it was unchecked again meanwhile, stopped repeating, or its page went to Trash.
 */
export const repeatTask = internalMutation({
  args: { blockId: v.string(), actorId: v.id("profiles") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("blocks")
      .withIndex("by_block_id", (q) => q.eq("blockId", args.blockId))
      .unique();
    // A sealed to-do repeats on the device (docs/E2EE_DESIGN.md §5.7).
    if (!row || row.deletedAt !== undefined || row.type !== "todo" || isSealedBlock(row)) return null;
    const props = row.props as Record<string, unknown>;
    const rule = repeatRule(props);
    if (!rule || props.checked !== true || props.canceled === true) return null;
    const doc = await ctx.db.get(row.documentId);
    const actor = await ctx.db.get(args.actorId);
    if (!doc || doc.inTrash || doc.deletedAt !== undefined || isSealed(doc) || !actor || actor.status !== "active") return null;
    const today = localDate(Date.now(), actor.timeZone);
    const due = typeof props.dueDate === "string" ? props.dueDate : null;
    const next = nextOccurrence(rule, due, today);
    const shift = daysBetween(due ?? today, next);
    const nextProps: Record<string, unknown> = { ...props, checked: false, dueDate: next };
    delete nextProps.completedAt;
    if (typeof props.reminderAt === "number") nextProps.reminderAt = props.reminderAt + shift * DAY_MS;
    const block = { ...toWireBlock(row), props: nextProps };
    delete block.revision;
    const engine = new SyncEngine(ctx, actor, "server");
    await engine.applyAll(null, [{ opId: ulid(), kind: "block.upsert", documentId: doc.publicId, block, baseRevision: row.revision, fields: ["content"] }]);
    return null;
  },
});

/** Reminders sent per run; a full batch schedules the next one right away. */
const REMINDER_BATCH = 200;

/** "Fri 17 Oct, 15:00" for a task's due date and time (calendar dates, no time zone shift). */
export function reminderDueText(dueDate?: string, dueTime?: string): string {
  if (!dueDate) return "No due date";
  const [y, m, d] = dueDate.split("-").map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return dueTime ? `${day}, ${dueTime}` : day;
}

/**
 * Sends due reminders: a bell notification (the Mac app also shows it as a Mac notification) and an email
 * with the to-do line and a link to it. Each follows the person's choice (Settings → Notifications,
 * "Task reminders"; both on unless turned off).
 */
export const processReminders = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Only reminders still to send: sent ones (which keep their reminderAt, shown on the task) and closed
    // or trashed tasks fall outside the range, so they can never crowd out new ones.
    const due = await ctx.db
      .query("tasks")
      .withIndex("by_reminder_pending", (q) =>
        q
          .eq("status", "open")
          .eq("documentInTrash", false)
          .eq("reminderSentAt", undefined)
          .gte("reminderAt", now - 24 * 60 * 60 * 1000)
          .lte("reminderAt", now),
      )
      .take(REMINDER_BATCH);
    for (const t of due) {
      const recipient = t.assigneeId ?? t.createdBy;
      const profile = await ctx.db.get(recipient);
      await ctx.db.patch(t._id, { reminderSentAt: now });
      if (!profile || profile.status === "deleted") continue;
      const title = t.title.slice(0, 200) || "Task";
      const doc = await ctx.db.get(t.documentId);
      // Sealed to-dos' reminders come from e2eeReminders (e2ee.reminders.process, docs/E2EE_DESIGN.md §7.6).
      if (doc && isSealed(doc)) continue;
      if (profile.notificationPrefs.inApp?.reminders !== false) {
        await ctx.db.insert("notifications", {
          profileId: recipient,
          workspaceId: t.workspaceId,
          kind: "system",
          documentId: t.documentId,
          blockId: t.blockId,
          title: `Reminder: ${title.slice(0, 120)}`,
          createdAt: now,
        });
        // And to the browsers and iPhones and iPads that asked for push: the to-do line and its note.
        if (doc) {
          await schedulePush(ctx, {
            profileId: recipient,
            kind: "reminder",
            title: `Reminder: ${title.slice(0, 110)}`,
            body: doc.title ? `In ${doc.title}` : undefined,
            path: `/d/${doc.publicId}#block-${t.blockId}`,
            tag: `reminder:${t._id}`,
            noteId: doc.publicId,
            taskId: t.blockId,
          });
        }
      }
      if (doc && profile.notificationPrefs.reminders !== false) {
        await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
          key: "task_reminder",
          profileId: recipient,
          idempotencyKey: `reminder:${t._id}:${t.reminderAt}`,
          dataVariables: {
            taskTitle: title,
            documentTitle: (doc.title || "Untitled").slice(0, 120),
            due: reminderDueText(t.dueDate, t.dueTime),
            taskUrl: `${appUrl()}/d/${doc.publicId}#block-${t.blockId}`,
            preferencesUrl: `${appUrl()}/settings/notifications`,
          },
        });
      }
    }
    if (due.length === REMINDER_BATCH) await ctx.scheduler.runAfter(0, internal.tasks.processReminders, {});
    return due.length;
  },
});
