// Entitlements: what a scope may do right now, resolved on the server from its own plan. Nothing here
// merges the two scopes — a Personal plan never upgrades a workspace, and a workspace plan never upgrades
// anyone's Personal.
//
//   { kind: "personal", profileId }    a person's own notes, storage and AI (their Personal plan)
//   { kind: "workspace", workspaceId } a team workspace (its Workspace plan)
//
// Personal is still stored as a workspace row of kind "personal"; `scopeOfWorkspace` is the one place
// that maps a workspace row to its scope, so callers keep working when Personal stops being a workspace.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { subscriptionOf } from "./billing";
import { personalWorkspaceOf } from "./identityImages";
import { PLANS, personalEntitlementsOf, planName, workspaceEntitlementsOf, type Entitlements, type PersonalEntitlements, type WorkspaceEntitlements, type WorkspaceSubscriptionLike } from "./plans";
import type { RateRuleName } from "./rateLimit";

type Ctx = QueryCtx | MutationCtx;

export type Scope = { kind: "personal"; profileId: Id<"profiles"> } | { kind: "workspace"; workspaceId: Id<"workspaces"> };

/** The storage quota every workspace row was created with (before per-workspace overrides had a field). */
export const DEFAULT_WORKSPACE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

/** The scope a workspace row stands for: a personal workspace is its owner's Personal; a team is itself. */
export function scopeOfWorkspace(workspace: Doc<"workspaces">): Scope {
  return workspace.kind === "personal" ? { kind: "personal", profileId: workspace.ownerId } : { kind: "workspace", workspaceId: workspace._id };
}

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

/**
 * What a team workspace's plan gives. Workspace subscriptions don't exist yet, so every team workspace is
 * on Workspace Free; per-seat billing plugs its subscription row in here.
 */
export async function workspaceEntitlements(ctx: Ctx, workspace: Id<"workspaces"> | Doc<"workspaces">, now = Date.now()): Promise<WorkspaceEntitlements> {
  const w = typeof workspace === "string" ? await ctx.db.get(workspace) : workspace;
  const subscription: WorkspaceSubscriptionLike | null = null;
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
    const personal = await personalWorkspaceOf(ctx, scope.profileId);
    const override = personal ? workspaceStorageOverride(personal) : undefined;
    return { usedBytes: personal?.storageUsedBytes ?? 0, limitBytes: override ?? (await personalEntitlements(ctx, scope.profileId)).storageBytes };
  }
  const workspace = await ctx.db.get(scope.workspaceId);
  return { usedBytes: workspace?.storageUsedBytes ?? 0, limitBytes: (await workspaceEntitlements(ctx, scope.workspaceId)).storageBytes };
}

const gb = (bytes: number) => {
  const n = bytes / 1024 ** 3;
  return n >= 1024 ? `${Math.round((n / 1024) * 10) / 10} TB` : `${Math.round(n * 10) / 10} GB`;
};

/**
 * Whether `bytes` more may be added to a workspace, against its scope's limit. Returns the reason when
 * not. Over the limit only growth is refused: everything already stored stays readable, and deleting
 * frees room.
 */
export async function assertStorageFor(ctx: Ctx, workspace: Doc<"workspaces">, bytes: number, actorId?: Id<"profiles">): Promise<string | null> {
  const scope = scopeOfWorkspace(workspace);
  const { usedBytes, limitBytes } = await storageUsage(ctx, scope);
  if (usedBytes + bytes <= limitBytes) return null;
  if (scope.kind === "personal") {
    if (actorId && actorId !== scope.profileId) return "The owner of this workspace is out of storage.";
    const e = await personalEntitlements(ctx, scope.profileId);
    return `You've used all the personal storage on your ${e.trialing ? "Pro trial" : `${PLANS[e.plan].name} plan`}. Upgrade for more room, or free some up.`;
  }
  const e = await workspaceEntitlements(ctx, workspace);
  return `This workspace has used all of its ${gb(limitBytes)} of storage${e.storageOverridden ? "" : ` on ${planName(e.planId)}`}. Free some up to add more.`;
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
 * Whether `profile` may use the AI Assistant in `workspace`. Personal: their own Personal plan (Pro, the
 * trial or an admin grant) — and only in their own Personal. A team workspace: that workspace's plan.
 */
export async function aiAccessIn(ctx: Ctx, profile: Doc<"profiles">, workspace: Doc<"workspaces">, now = Date.now()): Promise<AiAccess> {
  const scope = scopeOfWorkspace(workspace);
  if (scope.kind === "personal") {
    const rateSubject = profile._id as string;
    // Someone else's Personal: neither their plan nor the owner's covers it.
    if (scope.profileId !== profile._id) return { allowed: false, scope, message: "The AI Assistant isn't available in someone else's Personal.", rateRule: "ai", rateSubject };
    const e = await personalEntitlements(ctx, profile._id, now);
    return { allowed: e.ai, scope, message: e.ai ? null : AI_PERSONAL_UPSELL, rateRule: e.aiFairUse === "high" ? "aiHigh" : "ai", rateSubject };
  }
  const e = await workspaceEntitlements(ctx, workspace, now);
  // Budgets are per person per workspace, so AI in one place never uses up another's.
  return { allowed: e.ai, scope, message: e.ai ? null : AI_WORKSPACE_UPSELL, rateRule: e.aiFairUse === "high" ? "aiHigh" : "ai", rateSubject: `${profile._id}:${workspace._id}` };
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
