// Background jobs: permanent deletion cascades, retention windows and housekeeping.
// All cascades are bounded per invocation and reschedule themselves until finished.
import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { bump } from "./lib/metrics";

const BUDGET = 400;
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SYNC_OP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

class Budget {
  constructor(public left: number) {}
  spend(n = 1) {
    this.left -= n;
  }
  get exhausted() {
    return this.left <= 0;
  }
}

/** Deletes one document's dependent rows. Returns true when the document row itself is gone. */
async function purgeDocument(ctx: MutationCtx, docId: Id<"documents">, budget: Budget): Promise<boolean> {
  const doc = await ctx.db.get(docId);
  if (!doc) return true;
  // Children first (nested pages and collection rows).
  const child = await ctx.db
    .query("documents")
    .withIndex("by_parent", (q) => q.eq("parentDocumentId", docId))
    .first();
  if (child) {
    await purgeDocument(ctx, child._id, budget);
    return false;
  }
  const batches: (() => Promise<{ _id: Id<never> }[]>)[] = [
    () => ctx.db.query("blocks").withIndex("by_document", (q) => q.eq("documentId", docId)).take(Math.max(1, budget.left)),
    () => ctx.db.query("tasks").withIndex("by_document", (q) => q.eq("documentId", docId)).take(Math.max(1, budget.left)),
    () => ctx.db.query("documentTags").withIndex("by_document", (q) => q.eq("documentId", docId)).take(Math.max(1, budget.left)),
    () => ctx.db.query("stars").withIndex("by_document", (q) => q.eq("documentId", docId)).take(Math.max(1, budget.left)),
    () => ctx.db.query("recents").withIndex("by_document", (q) => q.eq("documentId", docId)).take(Math.max(1, budget.left)),
    () => ctx.db.query("documentPermissions").withIndex("by_document", (q) => q.eq("documentId", docId)).take(Math.max(1, budget.left)),
    () => ctx.db.query("publicLinks").withIndex("by_document", (q) => q.eq("documentId", docId)).take(Math.max(1, budget.left)),
    () => ctx.db.query("documentLinks").withIndex("by_source", (q) => q.eq("sourceDocumentId", docId)).take(Math.max(1, budget.left)),
    () => ctx.db.query("noteSubscriptions").withIndex("by_document_mode", (q) => q.eq("documentId", docId)).take(Math.max(1, budget.left)),
  ] as never;
  for (const load of batches) {
    const rows = await load();
    for (const r of rows) {
      await ctx.db.delete(r._id);
      budget.spend();
    }
    if (budget.exhausted) return false;
  }
  const threads = await ctx.db
    .query("commentThreads")
    .withIndex("by_document", (q) => q.eq("documentId", docId))
    .take(20);
  for (const t of threads) {
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_thread", (q) => q.eq("threadId", t._id))
      .take(Math.max(1, budget.left));
    for (const c of comments) {
      await ctx.db.delete(c._id);
      budget.spend();
    }
    if (comments.length && budget.exhausted) return false;
    await ctx.db.delete(t._id);
    budget.spend();
  }
  if (threads.length) return false;
  const reads = await ctx.db
    .query("readStates")
    .filter((q) => q.eq(q.field("documentId"), docId))
    .take(Math.max(1, budget.left));
  for (const r of reads) await ctx.db.delete(r._id);
  const snaps = await ctx.db
    .query("documentSnapshots")
    .withIndex("by_document", (q) => q.eq("documentId", docId))
    .take(50);
  for (const s of snaps) {
    const chunks = await ctx.db
      .query("snapshotChunks")
      .withIndex("by_snapshot", (q) => q.eq("snapshotId", s._id))
      .collect();
    for (const c of chunks) await ctx.db.delete(c._id);
    await ctx.db.delete(s._id);
    budget.spend();
  }
  if (snaps.length === 50) return false;
  const files = await ctx.db
    .query("files")
    .withIndex("by_document", (q) => q.eq("documentId", docId))
    .take(50);
  for (const f of files) {
    await ctx.storage.delete(f.storageId);
    const ws = await ctx.db.get(f.workspaceId);
    if (ws) await ctx.db.patch(ws._id, { storageUsedBytes: Math.max(0, ws.storageUsedBytes - f.size) });
    await bump(ctx, "storage_bytes", -f.size);
    await ctx.db.delete(f._id);
    budget.spend();
  }
  if (files.length === 50) return false;
  const collections = await ctx.db
    .query("collections")
    .withIndex("by_document", (q) => q.eq("documentId", docId))
    .take(5);
  for (const c of collections) {
    for (const table of ["collectionRows", "collectionProperties", "collectionViews"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_collection", (q) => q.eq("collectionId", c._id))
        .take(200);
      for (const r of rows) {
        if (table === "collectionRows") {
          const values = await ctx.db
            .query("collectionValues")
            .withIndex("by_row", (q) => q.eq("rowId", r._id as Id<"collectionRows">))
            .collect();
          for (const val of values) await ctx.db.delete(val._id);
        }
        await ctx.db.delete(r._id);
        budget.spend();
      }
      if (rows.length === 200) return false;
    }
    await ctx.db.delete(c._id);
  }
  const presence = await ctx.db
    .query("presence")
    .withIndex("by_document", (q) => q.eq("documentId", docId))
    .collect();
  for (const p of presence) await ctx.db.delete(p._id);
  const ws = await ctx.db.get(doc.workspaceId);
  if (ws) await ctx.db.patch(ws._id, { documentCount: Math.max(0, ws.documentCount - 1), changeSeq: ws.changeSeq + 1 });
  await ctx.db.delete(docId);
  await bump(ctx, "documents_total", -1);
  budget.spend();
  return true;
}

async function purgeWorkspace(ctx: MutationCtx, workspaceId: Id<"workspaces">, budget: Budget): Promise<boolean> {
  const ws = await ctx.db.get(workspaceId);
  if (!ws) return true;
  if (ws.status !== "deleting") await ctx.db.patch(ws._id, { status: "deleting" });
  const doc = await ctx.db
    .query("documents")
    .withIndex("by_workspace_created", (q) => q.eq("workspaceId", workspaceId))
    .first();
  if (doc) {
    // Start from a root so parents never outlive (or block) their children's purge.
    let root: Doc<"documents"> = doc;
    for (let i = 0; root.parentDocumentId && i < 32; i++) {
      const parent = await ctx.db.get(root.parentDocumentId);
      if (!parent) break;
      root = parent;
    }
    await purgeDocument(ctx, root._id, budget);
    return false;
  }
  for (const table of ["folders", "tags"] as const) {
    const rows = await ctx.db
      .query(table)
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(200);
    for (const r of rows) await ctx.db.delete(r._id);
    if (rows.length) return false;
  }
  for (const table of ["workspaceMembers", "workspaceInvites"] as const) {
    const rows = await ctx.db
      .query(table)
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(200);
    for (const r of rows) await ctx.db.delete(r._id);
    if (rows.length === 200) return false;
  }
  const files = await ctx.db
    .query("files")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(100);
  for (const f of files) {
    await ctx.storage.delete(f.storageId);
    await ctx.db.delete(f._id);
  }
  if (files.length) return false;
  await ctx.db.delete(workspaceId);
  await bump(ctx, "workspaces_total", -1);
  return true;
}

async function purgeAccount(ctx: MutationCtx, profileId: Id<"profiles">, budget: Budget): Promise<boolean> {
  const profile = await ctx.db.get(profileId);
  if (!profile || profile.status === "deleted") return true;
  const memberships = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .collect();
  for (const m of memberships) {
    const ws = await ctx.db.get(m.workspaceId);
    if (!ws) {
      await ctx.db.delete(m._id);
      continue;
    }
    if (m.role === "owner") {
      const others = (
        await ctx.db
          .query("workspaceMembers")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", ws._id))
          .collect()
      ).filter((x) => x.profileId !== profileId);
      const heir = others.find((x) => x.role === "admin") ?? others.find((x) => x.role === "editor");
      if (ws.kind === "team" && heir) {
        await ctx.db.patch(heir._id, { role: "owner" });
        await ctx.db.patch(ws._id, { ownerId: heir.profileId });
        await ctx.db.delete(m._id);
      } else {
        await purgeWorkspace(ctx, ws._id, budget);
        return false;
      }
    } else {
      await ctx.db.delete(m._id);
    }
    if (budget.exhausted) return false;
  }
  const personalBatches: (() => Promise<{ _id: Id<never> }[]>)[] = [
    () => ctx.db.query("stars").withIndex("by_profile", (q) => q.eq("profileId", profileId)).take(200),
    () => ctx.db.query("recents").withIndex("by_profile_viewed", (q) => q.eq("profileId", profileId)).take(200),
    () => ctx.db.query("notifications").withIndex("by_profile_created", (q) => q.eq("profileId", profileId)).take(200),
    () => ctx.db.query("sessionsMirror").withIndex("by_profile", (q) => q.eq("profileId", profileId)).take(200),
    () => ctx.db.query("documentPermissions").withIndex("by_profile", (q) => q.eq("profileId", profileId)).take(200),
    () => ctx.db.query("noteSubscriptions").withIndex("by_profile", (q) => q.eq("profileId", profileId)).take(200),
  ] as never;
  for (const load of personalBatches) {
    const rows = await load();
    for (const r of rows) await ctx.db.delete(r._id);
    if (rows.length === 200) return false;
  }
  await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
    key: "account_deletion_completed",
    to: profile.email,
    idempotencyKey: `deletion-completed:${profile._id}`,
    dataVariables: { completedOn: new Date().toUTCString() },
  });
  await ctx.scheduler.runAfter(0, internal.identity.deleteProviderUser, { authSubject: profile.authSubject });
  // Keep an anonymized tombstone so comments elsewhere render as "Former member".
  await ctx.db.patch(profileId, {
    status: "deleted",
    email: `deleted-${profileId}@invalid`,
    displayName: "Former member",
    tokenIdentifier: `deleted:${profileId}`,
    authSubject: `deleted:${profileId}`,
    platformRole: undefined,
    defaultWorkspaceId: undefined,
    avatarFileId: undefined,
    deletionScheduledFor: undefined,
  });
  await bump(ctx, "users_total", -1);
  return true;
}

export const runDeletionJobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const jobs = await ctx.db
      .query("deletionJobs")
      .withIndex("by_status_scheduled", (q) => q.eq("status", "scheduled").lte("scheduledFor", now))
      .take(5);
    const running = await ctx.db
      .query("deletionJobs")
      .withIndex("by_status_scheduled", (q) => q.eq("status", "running"))
      .take(5);
    const budget = new Budget(BUDGET);
    for (const job of [...running, ...jobs]) {
      if (budget.exhausted) break;
      if (job.status === "scheduled") await ctx.db.patch(job._id, { status: "running" });
      let done: boolean;
      try {
        if (job.kind === "document") done = await purgeDocument(ctx, job.targetId as Id<"documents">, budget);
        else if (job.kind === "workspace") done = await purgeWorkspace(ctx, job.targetId as Id<"workspaces">, budget);
        else {
          const profile = await ctx.db.get(job.targetId as Id<"profiles">);
          // Canceled by the person before the grace period ended.
          if (profile && profile.status === "active") {
            await ctx.db.patch(job._id, { status: "canceled" });
            continue;
          }
          done = await purgeAccount(ctx, job.targetId as Id<"profiles">, budget);
        }
      } catch (e) {
        await ctx.db.patch(job._id, { status: "failed", error: (e as Error).message.slice(0, 200) });
        continue;
      }
      await ctx.db.patch(job._id, done ? { status: "completed", completedAt: Date.now(), progress: 1 } : { progress: Math.min(0.99, job.progress + 0.05) });
    }
    const more = await ctx.db
      .query("deletionJobs")
      .withIndex("by_status_scheduled", (q) => q.eq("status", "running"))
      .first();
    if (more || budget.exhausted) await ctx.scheduler.runAfter(1000, internal.maintenance.runDeletionJobs, {});
  },
});

/** Trash retention: documents in Trash longer than 30 days are scheduled for permanent deletion. */
export const purgeExpiredTrash = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - TRASH_RETENTION_MS;
    const expired = await ctx.db
      .query("documents")
      .filter((q) => q.and(q.eq(q.field("inTrash"), true), q.lt(q.field("deletedAt"), cutoff)))
      .take(100);
    let n = 0;
    for (const d of expired) {
      if (d.parentDocumentId) {
        const parent = await ctx.db.get(d.parentDocumentId);
        if (parent?.inTrash) continue;
      }
      const existing = await ctx.db
        .query("deletionJobs")
        .withIndex("by_target", (q) => q.eq("kind", "document").eq("targetId", d._id))
        .first();
      if (existing && existing.status !== "failed") continue;
      await ctx.db.insert("deletionJobs", {
        kind: "document",
        targetId: d._id,
        requestedBy: d.deletedBy ?? d.createdBy,
        requestedByAdmin: false,
        reason: "trash_retention",
        scheduledFor: Date.now(),
        status: "scheduled",
        progress: 0,
        createdAt: Date.now(),
      });
      n++;
    }
    if (n) await ctx.scheduler.runAfter(0, internal.maintenance.runDeletionJobs, {});
    return n;
  },
});

/** Removes block tombstones older than the retention window (after Trash/version recovery is moot). */
export const purgeTombstones = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - TOMBSTONE_RETENTION_MS;
    const rows = await ctx.db
      .query("blocks")
      .filter((q) => q.and(q.neq(q.field("deletedAt"), undefined), q.lt(q.field("deletedAt"), cutoff)))
      .take(300);
    for (const r of rows) await ctx.db.delete(r._id);
    return rows.length;
  },
});

export const housekeeping = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const ops = await ctx.db
      .query("syncOperations")
      .withIndex("by_created", (q) => q.lt("createdAt", now - SYNC_OP_RETENTION_MS))
      .take(500);
    for (const o of ops) await ctx.db.delete(o._id);
    const limits = await ctx.db
      .query("rateLimits")
      .filter((q) => q.lt(q.field("windowStart"), now - 24 * 60 * 60 * 1000))
      .take(500);
    for (const l of limits) await ctx.db.delete(l._id);
    const events = await ctx.db
      .query("rateLimitEvents")
      .withIndex("by_created", (q) => q.lt("createdAt", now - 90 * 24 * 60 * 60 * 1000))
      .take(500);
    for (const e of events) await ctx.db.delete(e._id);
    const intents = await ctx.db
      .query("uploadIntents")
      .filter((q) => q.lt(q.field("expiresAt"), now - 60 * 60_000))
      .take(500);
    for (const i of intents) await ctx.db.delete(i._id);
    const invites = await ctx.db
      .query("workspaceInvites")
      .filter((q) => q.and(q.eq(q.field("status"), "pending"), q.lt(q.field("expiresAt"), now)))
      .take(200);
    for (const i of invites) await ctx.db.patch(i._id, { status: "expired" });
    const notes = await ctx.db
      .query("notifications")
      .withIndex("by_created", (q) => q.lt("createdAt", now - 180 * 24 * 60 * 60 * 1000))
      .take(500);
    for (const n of notes) await ctx.db.delete(n._id);
  },
});

/** Daily aggregate snapshot (active users, retention cohorts) — counts only, no content or identities. */
export const dailyMetrics = internalMutation({
  args: {},
  handler: async (ctx) => {
    const date = new Date().toISOString().slice(0, 10);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let dau = 0;
    let wau = 0;
    let cursor: string | null = null;
    const cohorts = new Map<string, { total: number; activeThisWeek: number }>();
    for (let page = 0; page < 50; page++) {
      const result: { page: Doc<"profiles">[]; isDone: boolean; continueCursor: string } = await ctx.db
        .query("profiles")
        .withIndex("by_created")
        .paginate({ cursor, numItems: 500 });
      for (const p of result.page) {
        if (p.status === "deleted") continue;
        if (p.lastActiveAt >= dayAgo) dau++;
        if (p.lastActiveAt >= weekAgo) wau++;
        const d = new Date(p.createdAt);
        const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
        const key = monday.toISOString().slice(0, 10);
        const c = cohorts.get(key) ?? { total: 0, activeThisWeek: 0 };
        c.total++;
        if (p.lastActiveAt >= weekAgo) c.activeThisWeek++;
        cohorts.set(key, c);
      }
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    const upsert = async (key: string, value: number) => {
      const row = await ctx.db
        .query("metricsDaily")
        .withIndex("by_key_date", (q) => q.eq("key", key).eq("date", date))
        .unique();
      if (row) await ctx.db.patch(row._id, { value });
      else await ctx.db.insert("metricsDaily", { key, date, value });
    };
    await upsert("dau", dau);
    await upsert("wau", wau);
    const recent = [...cohorts.entries()].sort().slice(-12);
    for (const [week, c] of recent) {
      await upsert(`cohort:${week}:total`, c.total);
      await upsert(`cohort:${week}:active`, c.activeThisWeek);
    }
  },
});

export const kick = internalAction({
  args: { reason: v.optional(v.string()) },
  handler: async (ctx) => {
    await ctx.runMutation(internal.maintenance.runDeletionJobs, {});
  },
});
