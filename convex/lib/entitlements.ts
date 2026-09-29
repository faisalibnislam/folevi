// Entitlements: what a scope may do right now, resolved on the server from its own plan. Nothing here
// merges the two scopes — a Personal plan never upgrades a workspace, and a workspace plan never upgrades
// anyone's Personal.
//
//   { kind: "personal", profileId }    a person's own notes, storage and AI (their Personal plan)
//   { kind: "workspace", workspaceId } a team workspace (its Workspace plan)
//
// Personal is not a workspace: its counters live on the profile (personalStorageUsedBytes) and its plan
// is the person's subscription (lib/scope.ts).
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { subscriptionOf, workspaceSubscriptionOf, type WorkspaceSubscription } from "./billing";
import { PLANS, PLAN_CATALOG, personalEntitlementsOf, planName, workspaceEntitlementsOf, type Entitlements, type PersonalEntitlements, type WorkspaceEntitlements, type WorkspaceSubscriptionLike, type WorkspaceTier } from "./plans";
import type { RateRuleName } from "./rateLimit";
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
  return { tier: plan.tier as WorkspaceTier, interval: plan.interval ?? undefined, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd };
}

/**
 * What a team workspace's plan gives: its own subscription (Team or Business while active, past due within
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

// ---------------------------------------------------------------------------------------------------
// Storage: each scope against its own limit, never summed
// ---------------------------------------------------------------------------------------------------

export interface StorageUsage {
  usedBytes: number;
  limitBytes: number;
}

/** Bytes used in a scope and its limit. Personal counts only the person's own Personal. */
export async function storageUsage(ctx: Ctx, scope: Scope): Promise<StorageUsage> {
  if (scope.kind === "personal") {
    const owner = await ctx.db.get(scope.profileId);
    // An admin's storage override is on the person's subscription (personalEntitlementsOf applies it).
    return { usedBytes: owner?.personalStorageUsedBytes ?? 0, limitBytes: (await personalEntitlements(ctx, scope.profileId)).storageBytes };
  }
  const workspace = await ctx.db.get(scope.workspaceId);
  return { usedBytes: workspace?.storageUsedBytes ?? 0, limitBytes: (await workspaceEntitlements(ctx, scope.workspaceId)).storageBytes };
}

/** Adds (or, negative, gives back) stored bytes to a scope's own counter. Never below zero. */
export async function adjustStorageUsed(ctx: MutationCtx, scope: Scope, delta: number): Promise<void> {
  if (scope.kind === "personal") {
    const owner = await ctx.db.get(scope.profileId);
    if (owner) await ctx.db.patch(owner._id, { personalStorageUsedBytes: Math.max(0, (owner.personalStorageUsedBytes ?? 0) + delta) });
    return;
  }
  const ws = await ctx.db.get(scope.workspaceId);
  if (ws) await ctx.db.patch(ws._id, { storageUsedBytes: Math.max(0, ws.storageUsedBytes + delta) });
}

const gb = (bytes: number) => {
  const n = bytes / 1024 ** 3;
  return n >= 1024 ? `${Math.round((n / 1024) * 10) / 10} TB` : `${Math.round(n * 10) / 10} GB`;
};

/**
 * Whether `bytes` more may be added to a scope, against that scope's own limit. Returns the reason when
 * not. Over the limit only growth is refused: everything already stored stays readable, and deleting
 * frees room.
 */
export async function assertStorageFor(ctx: Ctx, scope: Scope, bytes: number, actorId?: Id<"profiles">): Promise<string | null> {
  const { usedBytes, limitBytes } = await storageUsage(ctx, scope);
  if (usedBytes + bytes <= limitBytes) return null;
  if (scope.kind === "personal") {
    // Someone adding to a page shared with them: it's the owner's Personal that's full.
    if (actorId && actorId !== scope.profileId) return "The owner of this note is out of storage.";
    const e = await personalEntitlements(ctx, scope.profileId);
    return `You've used all the personal storage on your ${e.trialing ? "Pro trial" : `${PLANS[e.plan].name} plan`}. Upgrade for more room, or free some up.`;
  }
  const e = await workspaceEntitlements(ctx, scope.workspaceId);
  const over = usedBytes > limitBytes;
  return `This workspace ${over ? "is over its storage limit" : "has used all of its storage"} (${gb(usedBytes)} of ${gb(limitBytes)}${e.storageOverridden ? "" : ` on ${planName(e.planId)}`}). Everything already stored stays available; free some up${e.storageOverridden ? "" : " or upgrade the workspace plan"} to add more.`;
}

// ---------------------------------------------------------------------------------------------------
// AI: the scope the request is made in decides
// ---------------------------------------------------------------------------------------------------

export interface AiAccess {
  allowed: boolean;
  scope: Scope;
  /** Why not, in words for the person. */
  message: string | null;
  /** The hourly budget that applies (convex/lib/rateLimit.ts) and whose budget it is. */
  rateRule: RateRuleName;
  rateSubject: string;
}

export const AI_PERSONAL_UPSELL = "The AI Assistant is part of Pro. Upgrade in Settings → Plan & billing.";
export const AI_WORKSPACE_UPSELL = "AI Assistant comes with the Team and Business workspace plans.";

/**
 * Whether `profile` may use the AI Assistant in `scope`. Personal: their own Personal plan (Pro, the
 * trial or an admin grant) — and only in their own Personal. A team workspace: that workspace's plan.
 */
export async function aiAccessIn(ctx: Ctx, profile: Doc<"profiles">, scope: Scope, now = Date.now()): Promise<AiAccess> {
  if (scope.kind === "personal") {
    const rateSubject = profile._id as string;
    // Someone else's Personal (a page shared with you): neither your plan nor the owner's covers it.
    if (scope.profileId !== profile._id) return { allowed: false, scope, message: "The AI Assistant isn't available in someone else's Personal.", rateRule: "ai", rateSubject };
    const e = await personalEntitlements(ctx, profile._id, now);
    return { allowed: e.ai, scope, message: e.ai ? null : AI_PERSONAL_UPSELL, rateRule: e.aiFairUse === "high" ? "aiHigh" : "ai", rateSubject };
  }
  const e = await workspaceEntitlements(ctx, scope.workspaceId, now);
  // Budgets are per person per workspace, so AI in one place never uses up another's.
  return { allowed: e.ai, scope, message: e.ai ? null : AI_WORKSPACE_UPSELL, rateRule: e.aiFairUse === "high" ? "aiHigh" : "ai", rateSubject: `${profile._id}:${scope.workspaceId}` };
}

/** Counts one AI request against the scope it was made in (per person per day; no content). */
export async function recordAiUsage(ctx: MutationCtx, profileId: Id<"profiles">, scope: Scope, now = Date.now()): Promise<void> {
  const day = new Date(now).toISOString().slice(0, 10);
  const workspaceId = scope.kind === "workspace" ? scope.workspaceId : undefined;
  const rows = await ctx.db
    .query("aiUsage")
    .withIndex("by_profile_day", (q) => q.eq("profileId", profileId).eq("day", day))
    .collect();
  const row = rows.find((r) => r.scope === scope.kind && r.workspaceId === workspaceId);
  if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
  else await ctx.db.insert("aiUsage", { profileId, day, count: 1, scope: scope.kind, workspaceId });
}

/** A person's AI requests in Personal since `sinceDay` (rows from before scopes were recorded were all Personal). */
export async function personalAiUsage(ctx: Ctx, profileId: Id<"profiles">, sinceDay: string): Promise<Doc<"aiUsage">[]> {
  const rows = await ctx.db
    .query("aiUsage")
    .withIndex("by_profile_day", (q) => q.eq("profileId", profileId).gte("day", sinceDay))
    .collect();
  return rows.filter((r) => r.scope !== "workspace");
}
