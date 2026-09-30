// Entitlements: what a scope may do right now, resolved on the server from its own plan. A Personal plan
// never upgrades a workspace, and a workspace plan never upgrades anyone's Personal.
//
//   { kind: "personal", profileId }    a person's own notes, storage and AI (their Personal plan)
//   { kind: "workspace", workspaceId } a team workspace (its Workspace plan)
//
// Personal is not a workspace: its counters live on the profile (personalStorageUsedBytes) and its plan
// is the person's subscription (lib/scope.ts). AI credits are in lib/credits.ts.
//
// Storage rules (docs/BILLING.md):
//   Free pool: an owner's Personal (while it's on Free) and every free workspace they own share one 1 GB
//     limit; every upload in those workspaces, by anyone, counts against it.
//   Paid workspace (Core, Pro, Pro AI): each member has the plan's storage for themselves in that
//     workspace (20 or 50 GB). A guest's uploads count against the page owner's (or, if the page's creator
//     is no longer a member, the workspace owner's).
//   Admin override: a workspace with a storage override has that one total limit; a person's override
//     replaces their Personal limit (on Free, the pool's).
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { subscriptionOf, workspaceSubscriptionOf, type WorkspaceSubscription } from "./billing";
import { GB, PLAN_CATALOG, STORAGE_BYTES, TIER_NAMES, personalEntitlementsOf, planName, workspaceEntitlementsOf, type Entitlements, type PersonalEntitlements, type WorkspaceEntitlements, type WorkspaceSubscriptionLike } from "./plans";
import type { Scope } from "./scope";

type Ctx = QueryCtx | MutationCtx;

export type { Scope } from "./scope";

/** The storage quota every workspace row was created with (before per-workspace overrides had a field). */
export const DEFAULT_WORKSPACE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

export async function personalEntitlements(ctx: Ctx, profileId: Id<"profiles">, now = Date.now()): Promise<PersonalEntitlements> {
  return personalEntitlementsOf(await subscriptionOf(ctx, profileId), now);
}

/**
 * A storage limit an admin set on one workspace (it replaces the plan's). Workspaces created before the
 * override had its own field stored the 5 GB default in `storageQuotaBytes`; any other value there was
 * set by an admin.
 */
export function workspaceStorageOverride(workspace: Doc<"workspaces">): number | undefined {
  if (workspace.storageQuotaOverrideBytes !== undefined) return workspace.storageQuotaOverrideBytes;
  return workspace.storageQuotaBytes !== DEFAULT_WORKSPACE_QUOTA_BYTES ? workspace.storageQuotaBytes : undefined;
}

/** A workspace subscription row in the shape the entitlement rules read. */
export function workspaceSubscriptionLike(sub: WorkspaceSubscription | null): WorkspaceSubscriptionLike | null {
  if (!sub) return null;
  const plan = PLAN_CATALOG[sub.planId];
  return { tier: plan.tier, interval: plan.interval ?? undefined, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd };
}

/**
 * What a team workspace's plan gives: its own subscription (a paid plan while active, past due within
 * the provider's retry window, or canceled but paid through the period's end), else Workspace Free. An
 * admin's storage override replaces the plan's storage. Nobody's Personal plan is consulted.
 */
export async function workspaceEntitlements(ctx: Ctx, workspace: Id<"workspaces"> | Doc<"workspaces">, now = Date.now()): Promise<WorkspaceEntitlements> {
  const w = typeof workspace === "string" ? await ctx.db.get(workspace) : workspace;
  const subscription = w ? workspaceSubscriptionLike(await workspaceSubscriptionOf(ctx, w._id)) : null;
  return workspaceEntitlementsOf(subscription, { storageBytes: w ? workspaceStorageOverride(w) : undefined }, now);
}

export async function resolveEntitlements(ctx: Ctx, scope: Scope, now = Date.now()): Promise<Entitlements> {
  return scope.kind === "personal" ? await personalEntitlements(ctx, scope.profileId, now) : await workspaceEntitlements(ctx, scope.workspaceId, now);
}

const isMember = async (ctx: Ctx, profileId: Id<"profiles">, workspaceId: Id<"workspaces">) =>
  (await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace_profile", (q) => q.eq("workspaceId", workspaceId).eq("profileId", profileId))
    .unique()) !== null;

// ---------------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------------

export interface StorageUsage {
  usedBytes: number;
  limitBytes: number;
  /**
   * Which rule the limit comes from: the owner's free pool, a person's own quota (paid Personal, or a
   * member in a paid workspace), or an admin override (a workspace's own total).
   */
  rule: "shared_free" | "per_person" | "override";
  /** shared_free: whose pool it is. per_person in a workspace: whose quota. */
  profileId?: Id<"profiles">;
}

/** The free workspaces someone owns (their usage shares the owner's free pool). */
async function freeWorkspacesOwnedBy(ctx: Ctx, ownerId: Id<"profiles">, now: number): Promise<Doc<"workspaces">[]> {
  const owned = await ctx.db
    .query("workspaces")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  const out: Doc<"workspaces">[] = [];
  for (const w of owned) {
    if (w.status === "deleting" || workspaceStorageOverride(w) !== undefined) continue;
    if (!(await workspaceEntitlements(ctx, w, now)).paid) out.push(w);
  }
  return out;
}

/**
 * The free pool of an owner: their Personal (while it's on Free, not trialing or paid) plus every free
 * workspace they own. Limit: 1 GB, or the person's storage override while their Personal is in the pool.
 */
export async function freePool(ctx: Ctx, ownerId: Id<"profiles">, now = Date.now()): Promise<StorageUsage & { includesPersonal: boolean; workspaces: number }> {
  const owner = await ctx.db.get(ownerId);
  const e = await personalEntitlements(ctx, ownerId, now);
  const includesPersonal = e.storageRule === "shared_free";
  const workspaces = await freeWorkspacesOwnedBy(ctx, ownerId, now);
  const usedBytes = (includesPersonal ? (owner?.personalStorageUsedBytes ?? 0) : 0) + workspaces.reduce((n, w) => n + w.storageUsedBytes, 0);
  return { usedBytes, limitBytes: includesPersonal ? e.storageBytes : STORAGE_BYTES.free, rule: "shared_free", profileId: ownerId, includesPersonal, workspaces: workspaces.length };
}

/** A member's own storage used in a workspace. */
export async function memberStorageUsed(ctx: Ctx, workspaceId: Id<"workspaces">, profileId: Id<"profiles">): Promise<number> {
  const row = await ctx.db
    .query("workspaceStorage")
    .withIndex("by_workspace_profile", (q) => q.eq("workspaceId", workspaceId).eq("profileId", profileId))
    .unique();
  return row?.usedBytes ?? 0;
}

/**
 * Whose per-person quota an upload in a workspace counts against: the uploader if they're a member, else
 * (a guest) the page's creator if they're still a member, else the workspace's owner.
 */
export async function storageChargeFor(ctx: Ctx, workspaceId: Id<"workspaces">, uploaderId: Id<"profiles">, documentId?: Id<"documents">): Promise<Id<"profiles">> {
  if (await isMember(ctx, uploaderId, workspaceId)) return uploaderId;
  const doc = documentId ? await ctx.db.get(documentId) : null;
  if (doc && (await isMember(ctx, doc.createdBy, workspaceId))) return doc.createdBy;
  const w = await ctx.db.get(workspaceId);
  return w?.ownerId ?? uploaderId;
}

/**
 * The storage that applies to a new upload (or to a person's view of a scope): used and limit under that
 * scope's rule. `profileId` is who is asking or uploading (for per-person quotas in paid workspaces);
 * without it a paid workspace reports its total against members × the per-person quota.
 */
export async function storageUsage(ctx: Ctx, scope: Scope, profileId?: Id<"profiles">, documentId?: Id<"documents">): Promise<StorageUsage> {
  const now = Date.now();
  if (scope.kind === "personal") {
    const e = await personalEntitlements(ctx, scope.profileId, now);
    if (e.storageRule === "shared_free") return await freePool(ctx, scope.profileId, now);
    const owner = await ctx.db.get(scope.profileId);
    return { usedBytes: owner?.personalStorageUsedBytes ?? 0, limitBytes: e.storageBytes, rule: "per_person", profileId: scope.profileId };
  }
  const workspace = await ctx.db.get(scope.workspaceId);
  if (!workspace) return { usedBytes: 0, limitBytes: 0, rule: "override" };
  const e = await workspaceEntitlements(ctx, workspace, now);
  if (e.storageRule === "override") return { usedBytes: workspace.storageUsedBytes, limitBytes: e.storageBytes, rule: "override" };
  if (e.storageRule === "shared_free") return await freePool(ctx, workspace.ownerId, now);
  if (profileId) {
    const charged = await storageChargeFor(ctx, workspace._id, profileId, documentId);
    return { usedBytes: await memberStorageUsed(ctx, workspace._id, charged), limitBytes: e.storageBytes, rule: "per_person", profileId: charged };
  }
  // The whole workspace: everyone's uploads against every member's quota together.
  const members = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
    .collect();
  return { usedBytes: workspace.storageUsedBytes, limitBytes: e.storageBytes * Math.max(1, members.length), rule: "per_person" };
}

/**
 * Adds (or, negative, gives back) stored bytes: the scope's own counter, and in a workspace the per-person
 * counter of whoever the file counts against. Never below zero.
 */
export async function adjustStorageUsed(ctx: MutationCtx, scope: Scope, delta: number, chargedTo?: Id<"profiles">): Promise<void> {
  if (scope.kind === "personal") {
    const owner = await ctx.db.get(scope.profileId);
    if (owner) await ctx.db.patch(owner._id, { personalStorageUsedBytes: Math.max(0, (owner.personalStorageUsedBytes ?? 0) + delta) });
    return;
  }
  const ws = await ctx.db.get(scope.workspaceId);
  if (ws) await ctx.db.patch(ws._id, { storageUsedBytes: Math.max(0, ws.storageUsedBytes + delta) });
  if (!chargedTo) return;
  const row = await ctx.db
    .query("workspaceStorage")
    .withIndex("by_workspace_profile", (q) => q.eq("workspaceId", scope.workspaceId).eq("profileId", chargedTo))
    .unique();
  if (row) await ctx.db.patch(row._id, { usedBytes: Math.max(0, row.usedBytes + delta) });
  else if (delta > 0) await ctx.db.insert("workspaceStorage", { workspaceId: scope.workspaceId, profileId: chargedTo, usedBytes: delta });
}

/** Gives a stored file's bytes back to whatever it counted against. */
export async function releaseFileStorage(ctx: MutationCtx, file: Doc<"files">, scope: Scope): Promise<void> {
  await adjustStorageUsed(ctx, scope, -file.size, scope.kind === "workspace" ? (file.chargedTo ?? file.uploadedBy) : undefined);
}

const gb = (bytes: number) => {
  const n = bytes / GB;
  if (bytes < GB) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return n >= 1024 ? `${Math.round((n / 1024) * 10) / 10} TB` : `${Math.round(n * 10) / 10} GB`;
};

/**
 * Whether `bytes` more may be added to a scope, under that scope's rule. Returns the reason when not. Over
 * the limit only growth is refused: everything already stored stays readable, and deleting frees room.
 */
export async function assertStorageFor(ctx: Ctx, scope: Scope, bytes: number, actorId?: Id<"profiles">, documentId?: Id<"documents">): Promise<string | null> {
  const usage = await storageUsage(ctx, scope, actorId, documentId);
  if (usage.usedBytes + bytes <= usage.limitBytes) return null;
  const over = usage.usedBytes > usage.limitBytes;
  const amounts = `${gb(usage.usedBytes)} of ${gb(usage.limitBytes)}`;
  const keep = "Everything already stored stays available";
  if (scope.kind === "personal") {
    // Someone adding to a page shared with them: it's the owner's storage that's full.
    if (actorId && actorId !== scope.profileId) return "The owner of this note is out of storage.";
    if (usage.rule === "shared_free") return `You've used your free storage (${amounts}, shared by your Personal and the free workspaces you own). Upgrade for more room, or free some up.`;
    const e = await personalEntitlements(ctx, scope.profileId);
    return `You've used all the storage on your ${e.trialing ? "Pro AI trial" : `${TIER_NAMES[e.plan]} plan`} (${amounts}). Upgrade for more room, or free some up.`;
  }
  if (usage.rule === "shared_free") {
    return `This workspace ${over ? "is over" : "has used"} its owner's free storage (${amounts}, shared by the owner's Personal and the free workspaces they own). ${keep}; free some up or upgrade the workspace to add more.`;
  }
  if (usage.rule === "per_person") {
    const e = await workspaceEntitlements(ctx, scope.workspaceId);
    if (actorId && usage.profileId !== actorId) return `The page owner's storage in this workspace is full (${amounts} on ${planName(e.planId)}). ${keep}.`;
    return `You've used your storage in this workspace (${amounts} on ${planName(e.planId)}). ${keep}; free some up to add more.`;
  }
  return `This workspace ${over ? "is over its storage limit" : "has used all of its storage"} (${amounts}). ${keep}; free some up to add more.`;
}
