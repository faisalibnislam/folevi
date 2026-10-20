// tasks.* in local mode (convex/tasks.ts): the task views, the calendar's tasks, Quick Add, the Inbox page and
// moving a task, with repeating to-dos coming back at their next date. The to-do block stays the task's only
// record, as on the server: a task is projected from its block when it's read (projectTask, the server's own
// projection), and every change to one is a block edit through sync.push (functions/sync.ts), so it reaches
// the editor, version history and the other devices the way typing does.
import {
  SCHEMA_VERSION,
  inboxDocumentId,
  localDate,
  nextOccurrence,
  projectTask,
  rankBetween,
  repeatProps,
  repeatRule,
  scopeIdKey,
  taskViews,
  ulid,
  type SyncOp,
  type TaskProjection,
  type WireBlock,
} from "@folevi/editor-schema";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@/lib/convex/api";
import { fail } from "../errors";
import { LOCAL_FUNCTIONS, defineLocal, defineTrigger, type LocalMutationCtx, type LocalReader } from "../registry";
import type { LocalBlock, LocalDocument } from "../store";
import { checkScope, getProfile, liveBlocks, requireProfile, toWireBlock, type LocalProfile } from "./shared";

type PushResult = FunctionReturnType<typeof api.sync.push>[number];
type Presented = FunctionReturnType<typeof api.tasks.list>[number];

const PERSONAL = { kind: "personal" } as const;
const DEVICE = /^[A-Za-z0-9_-]{8,64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pushes ops through this library's sync.push, in this mutation (the server's SyncEngine.applyAll): the same
 * checks, revisions and derived text as an edit from the editor.
 */
export async function pushOps(ctx: LocalMutationCtx, ops: SyncOp[], deviceId?: string): Promise<PushResult[]> {
  const push = LOCAL_FUNCTIONS.get("sync:push");
  if (!push) throw new Error("sync.push has no local handler.");
  const device = deviceId && DEVICE.test(deviceId) ? deviceId : ctx.deviceId;
  const run = push.handler as unknown as (ctx: LocalMutationCtx, args: FunctionArgs<typeof api.sync.push>) => Promise<PushResult[]>;
  return await run(ctx, { scope: PERSONAL, deviceId: device, ops: ops as FunctionArgs<typeof api.sync.push>["ops"] });
}

/** A task as read: its projection, the block it comes from and its note. */
interface TaskRow {
  task: TaskProjection;
  block: LocalBlock;
  doc: LocalDocument;
  /** completedAt as the server's task row has it (a done block that doesn't say when: when it last changed). */
  completedAt: number | null;
}

/**
 * Every task in the library: each live to-do of each note that isn't a template (checklists in templates are
 * blueprints, not tasks), in the order the server's task rows were made (when the block was made, then its
 * place in its note).
 */
async function allTasks(db: LocalReader): Promise<TaskRow[]> {
  const out: TaskRow[] = [];
  for (const doc of await db.list("documents")) {
    if (doc.kind === "template") continue;
    for (const block of await db.list("blocks", doc.id)) {
      if (block.deletedAt !== null || block.type !== "todo") continue;
      const task = projectTask(toWireBlock(block), doc.id);
      if (!task) continue;
      out.push({ task, block, doc, completedAt: task.completedAt ?? (task.status === "done" ? block.updatedAt : null) });
    }
  }
  return out.sort(byCreation);
}

function byCreation(a: TaskRow, b: TaskRow): number {
  return a.block.createdAt - b.block.createdAt || (a.block.rank < b.block.rank ? -1 : a.block.rank > b.block.rank ? 1 : 0) || (a.block.id < b.block.id ? -1 : a.block.id > b.block.id ? 1 : 0);
}

/** By due date (no date first, as an index orders a missing value), then as made: the server's by-due index. */
function byDue(rows: TaskRow[]): TaskRow[] {
  const key = (r: TaskRow) => r.task.dueDate ?? "";
  return [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : byCreation(a, b)));
}

/** Most recently closed first (the server's by-completed index, read newest first). */
function byCompleted(rows: TaskRow[]): TaskRow[] {
  const at = (r: TaskRow) => r.completedAt ?? -1;
  return [...rows].sort((a, b) => at(b) - at(a) || byCreation(b, a));
}

/** The shape tasks.list, tasks.range and the MCP server give a task (convex/tasks.ts present). */
function present(profile: LocalProfile, rows: TaskRow[]): Presented[] {
  const out: Presented[] = [];
  for (const { task, block, doc, completedAt } of rows) {
    if (doc.inTrash) continue;
    out.push({
      blockId: task.blockId,
      documentId: doc.id,
      documentTitle: doc.title,
      documentIcon: doc.icon ?? null,
      title: task.title,
      status: task.status,
      dueDate: task.dueDate,
      dueTime: task.dueTime,
      priority: task.priority,
      // One person per library: the only one a task can be assigned to is its owner.
      assigneeId: task.assigneeId,
      assigneeName: task.assigneeId && task.assigneeId === profile.id ? profile.displayName : null,
      reminderAt: task.reminderAt,
      repeat: task.repeat,
      completedAt,
      updatedAt: block.updatedAt,
    } as Presented);
  }
  return out;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

defineLocal(api.tasks.list, "query", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  checkScope(args.scope);
  if (!DATE.test(args.today)) fail("invalid_argument", "Invalid date.");
  const all = await allTasks(ctx.db);
  let rows: TaskRow[];
  if (args.view === "completed") {
    // Closed tasks: done and canceled, most recently closed first.
    const closed: TaskRow[] = [];
    for (const status of ["done", "canceled"] as const) closed.push(...byCompleted(all.filter((r) => r.task.status === status)).slice(0, 200));
    rows = closed.sort((a, b) => (b.completedAt ?? b.block.updatedAt) - (a.completedAt ?? a.block.updatedAt)).slice(0, 200);
  } else {
    // In your own Personal (the only place here) unassigned tasks are yours.
    rows = byDue(all.filter((r) => r.task.status === "open"))
      .slice(0, 1000)
      .filter((r) => taskViews(r.task, args.today, profile.id, { personal: true }).includes(args.view));
  }
  const presented = present(profile, rows.filter((r) => !r.doc.inTrash));
  if (args.view !== "completed") {
    // The server's order, comparator and all (an equal date and a later time fall through to the edit time).
    presented.sort(
      (a, b) =>
        (a.dueDate ?? "9999") < (b.dueDate ?? "9999") ? -1 : (a.dueDate ?? "9999") > (b.dueDate ?? "9999") ? 1 : (a.dueTime ?? "99") < (b.dueTime ?? "99") ? -1 : b.updatedAt - a.updatedAt,
    );
  }
  return presented;
});

defineLocal(api.tasks.counts, "query", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  checkScope(args.scope);
  const c = { inbox: 0, today: 0, upcoming: 0, all: 0, mine: 0 };
  const open = byDue((await allTasks(ctx.db)).filter((r) => r.task.status === "open")).slice(0, 1000);
  for (const r of open) {
    if (r.doc.inTrash) continue;
    for (const view of taskViews(r.task, args.today, profile.id, { personal: true })) if (view in c) c[view as keyof typeof c]++;
  }
  return c;
});

defineLocal(api.tasks.range, "query", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  checkScope(args.scope);
  const statuses: TaskProjection["status"][] = args.includeCompleted ? ["open", "done"] : ["open"];
  const all = await allTasks(ctx.db);
  const rows: TaskRow[] = [];
  for (const status of statuses) {
    rows.push(
      ...byDue(all.filter((r) => r.task.status === status && r.task.dueDate !== null && r.task.dueDate >= args.from && r.task.dueDate <= args.to)).slice(0, 1000),
    );
  }
  return present(profile, rows);
});

/** A task's block and its note (convex/tasks.ts taskBlock): a live to-do somewhere in the library. */
async function taskBlock(db: LocalReader, blockId: string): Promise<{ row: LocalBlock; doc: LocalDocument }> {
  for (const doc of await db.list("documents")) {
    const row = await db.get("blocks", blockId, doc.id);
    if (!row) continue;
    if (row.deletedAt !== null || row.type !== "todo") break;
    return { row, doc };
  }
  fail("not_found", "Task not found.");
}

defineLocal(api.tasks.update, "mutation", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  const { row, doc } = await taskBlock(ctx.db, args.blockId);
  const before = toWireBlock(row);
  const props = { ...(row.props as Record<string, unknown>) };
  const now = ctx.now();
  if (args.checked !== undefined) {
    props.checked = args.checked;
    if (args.checked) {
      props.completedAt = now;
      delete props.canceled;
    } else delete props.completedAt;
  }
  if (args.canceled !== undefined) {
    if (args.canceled) {
      props.canceled = true;
      props.checked = false;
      props.completedAt = now; // when it was closed (orders the Completed view)
    } else {
      delete props.canceled;
      if (!props.checked) delete props.completedAt;
    }
  }
  if (args.dueDate !== undefined && args.dueDate !== null && !DATE.test(args.dueDate)) fail("invalid_argument", "Invalid date.");
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
      // Someone who can see the note: in a library, only its owner.
      if (args.assigneeId !== profile.id) fail("invalid_argument", "Assignees must be able to see this note.");
      props.assigneeId = args.assigneeId;
    }
  }
  if (args.reminderAt !== undefined) {
    if (args.reminderAt === null) delete props.reminderAt;
    else props.reminderAt = args.reminderAt;
  }
  const [result] = await pushOps(
    ctx,
    [{ opId: ulid(), kind: "block.upsert", documentId: doc.id, block: { ...before, props }, baseRevision: row.contentRev, fields: ["content"] }],
    args.deviceId,
  );
  if (!result || result.status !== "applied") fail("conflict", result?.error?.message ?? "The task changed elsewhere. Try again.");
  return { before: before.props, revision: result.revision };
});

/**
 * The Inbox page (convex/tasks.ts ensureInbox): made if needed, brought back if it was in Trash, as its id.
 * Its id is deterministic (inboxDocumentId), as on the server, so every device makes the same page.
 */
export async function ensureInbox(ctx: LocalMutationCtx, profile: LocalProfile, deviceId?: string): Promise<string> {
  const id = inboxDocumentId(profile.id, scopeIdKey(PERSONAL));
  const existing = await ctx.db.get("documents", id);
  if (existing?.inTrash) await untrash(ctx, existing);
  else if (!existing) {
    await pushOps(ctx, [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title: "Inbox", icon: "📥" } }], deviceId);
  }
  return id;
}

/** Brings a note back from Trash with the notes trashed together with it (convex/documents.ts setTrashState). */
async function untrash(ctx: LocalMutationCtx, doc: LocalDocument): Promise<void> {
  const seq = await ctx.nextSeq();
  const now = ctx.now();
  const all = await ctx.db.list("documents");
  const kids = new Map<string, LocalDocument[]>();
  for (const d of all) if (d.parentDocumentId) kids.set(d.parentDocumentId, [...(kids.get(d.parentDocumentId) ?? []), d]);
  const family: LocalDocument[] = [];
  const walk = (d: LocalDocument, depth: number) => {
    family.push(d);
    if (depth < 32) for (const c of kids.get(d.id) ?? []) walk(c, depth + 1);
  };
  walk(doc, 0);
  for (const d of family) {
    // Restoring only brings back pages trashed together with the root.
    if (d.id !== doc.id && d.deletedAt !== doc.deletedAt) continue;
    ctx.db.put("documents", d.id, { ...d, inTrash: false, deletedAt: null, seq, revision: d.revision + 1, updatedAt: now });
  }
}

/** The rank after a note's last top-level block. */
async function lastRootRank(db: LocalReader, documentId: string): Promise<string | null> {
  const roots = (await liveBlocks(db, documentId)).filter((b) => b.parentId === null).sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
  return roots[roots.length - 1]?.rank ?? null;
}

defineLocal(api.tasks.quickAdd, "mutation", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  checkScope(args.scope);
  const title = args.title.trim().slice(0, 500);
  if (!title) fail("invalid_argument", "Write the task first.");
  const docId = args.documentId ?? (await ensureInbox(ctx, profile, args.deviceId));
  const doc = await ctx.db.get("documents", docId);
  if (!doc) fail("not_found", "Document not found.");
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
    rank: rankBetween(await lastRootRank(ctx.db, doc.id), null),
    schemaVersion: SCHEMA_VERSION,
    text: [{ type: "text", text: title }],
    props,
  };
  const [result] = await pushOps(ctx, [{ opId: ulid(), kind: "block.upsert", documentId: doc.id, block, baseRevision: null, fields: ["content", "position"] }], args.deviceId);
  if (!result || result.status !== "applied") fail("invalid_argument", result?.error?.message ?? "Could not add the task.");
  return { blockId: block.id, documentId: doc.id };
});

defineLocal(api.tasks.inbox, "mutation", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  checkScope(args.scope);
  const documentId = await ensureInbox(ctx, profile, args.deviceId?.slice(0, 64));
  if (!(await ctx.db.get("documents", documentId))) fail("not_found", "Could not find your Inbox.");
  const roots = (await liveBlocks(ctx.db, documentId)).filter((b) => b.parentId === null);
  const lastRank = roots.reduce<string | null>((m, b) => (m === null || b.rank > m ? b.rank : m), null);
  return { documentId, lastRank };
});

defineLocal(api.tasks.moveToDocument, "mutation", async (ctx, args) => {
  const profile = await requireProfile(ctx);
  const { row, doc } = await taskBlock(ctx.db, args.blockId);
  const targetId = args.documentId || (await ensureInbox(ctx, profile, args.deviceId));
  if (targetId === doc.id) return { blockId: row.id };
  const target = await ctx.db.get("documents", targetId);
  if (!target) fail("not_found", "Document not found.");
  // Only the to-do moves. The server's delete of it, based on its revision, refuses while lines are nested
  // under it that the move doesn't delete (lib/syncEngine.ts deleteBlock), so a task with lines inside it
  // stays where it is; local sync.push would take them with it, so it's refused here the same way.
  if ((await liveBlocks(ctx.db, doc.id)).some((b) => b.parentId === row.id)) fail("conflict", "Could not move the task.");
  const moved: WireBlock = { ...toWireBlock(row), id: ulid(), parentId: null, rank: rankBetween(await lastRootRank(ctx.db, target.id), null) };
  delete moved.revision;
  const results = await pushOps(
    ctx,
    [
      { opId: ulid(), kind: "block.upsert", documentId: target.id, block: moved, baseRevision: null, fields: ["content", "position"] },
      { opId: ulid(), kind: "block.delete", documentId: doc.id, blockId: row.id, baseRevision: row.revision },
    ],
    args.deviceId,
  );
  if (results.some((r) => r.status !== "applied")) fail("conflict", "Could not move the task.");
  return { blockId: moved.id };
});

// ---- repeating to-dos -----------------------------------------------------------------------------------

const daysBetween = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / DAY_MS);

function statusOf(block: Pick<LocalBlock, "props">): TaskProjection["status"] {
  const p = block.props as { canceled?: unknown; checked?: unknown };
  return p.canceled ? "canceled" : p.checked ? "done" : "open";
}

/**
 * A repeating to-do was checked off (the server's syncTaskProjection, open to done with a repeat): right after
 * the edit is saved it comes back unchecked at its next date (convex/tasks.ts repeatTask), whatever wrote it
 * (the editor, a task list, another call). Checklists in templates aren't tasks.
 */
defineTrigger("tasks:repeat", async (ctx, writes, before, origin) => {
  // Another device's check-off, read from the library: that device brings it back (its edit arrives too).
  if (origin === "disk") return;
  for (const w of writes) {
    if (w.table !== "blocks" || !w.value || w.partition === undefined) continue;
    const row = w.value as LocalBlock;
    if (row.type !== "todo" || row.deletedAt !== null || statusOf(row) !== "done" || !repeatRule(row.props as Record<string, unknown>)) continue;
    const prior = (await before("blocks", w.id, w.partition)) as LocalBlock | undefined;
    if (!prior || prior.deletedAt !== null || prior.type !== "todo" || statusOf(prior) !== "open") continue;
    const doc = await ctx.db.get("documents", w.partition);
    if (!doc || doc.kind === "template") continue;
    const documentId = w.partition;
    ctx.runAfter((job) => job.mutate((m) => repeatTask(m, row.id, documentId)));
  }
});

/**
 * Brings a checked-off repeating to-do back unchecked at its next date, with its reminder moved by as many
 * days. Nothing happens if it was unchecked again meanwhile, stopped repeating, or its note went to Trash.
 */
async function repeatTask(ctx: LocalMutationCtx, blockId: string, documentId: string): Promise<void> {
  const row = await ctx.db.get("blocks", blockId, documentId);
  if (!row || row.deletedAt !== null || row.type !== "todo") return;
  const props = row.props as Record<string, unknown>;
  const rule = repeatRule(props);
  if (!rule || props.checked !== true || props.canceled === true) return;
  const doc = await ctx.db.get("documents", documentId);
  const profile = await getProfile(ctx.db);
  if (!doc || doc.inTrash || !profile) return;
  const today = localDate(ctx.now(), profile.timeZone);
  const due = typeof props.dueDate === "string" ? props.dueDate : null;
  const next = nextOccurrence(rule, due, today);
  const shift = daysBetween(due ?? today, next);
  const nextProps: Record<string, unknown> = { ...props, checked: false, dueDate: next };
  delete nextProps.completedAt;
  if (typeof props.reminderAt === "number") nextProps.reminderAt = props.reminderAt + shift * DAY_MS;
  const block: WireBlock = { ...toWireBlock(row), props: nextProps };
  delete block.revision;
  await pushOps(ctx, [{ opId: ulid(), kind: "block.upsert", documentId, block, baseRevision: row.revision, fields: ["content"] }]);
}

/** Every open task with a reminder, for local reminders (lib/local/reminders.ts). */
export async function pendingReminders(db: LocalReader): Promise<{ blockId: string; documentId: string; documentTitle: string; title: string; reminderAt: number }[]> {
  const out = [];
  for (const r of await allTasks(db)) {
    if (r.task.status !== "open" || r.doc.inTrash || r.task.reminderAt === null) continue;
    out.push({ blockId: r.task.blockId, documentId: r.doc.id, documentTitle: r.doc.title, title: r.task.title, reminderAt: r.task.reminderAt });
  }
  return out;
}
