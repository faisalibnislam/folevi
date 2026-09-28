// Plans in practice: reading someone's subscription and what it entitles them to, and storage across the
// workspaces they own. Rules live in lib/plans.ts.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { DAY_MS, TRIAL_DAYS, entitlementsOf, type Entitlements } from "./plans";

type Ctx = QueryCtx | MutationCtx;

export async function subscriptionOf(ctx: Ctx, profileId: Id<"profiles">): Promise<Doc<"subscriptions"> | null> {
  return await ctx.db
    .query("subscriptions")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .unique();
}

export async function entitlementsFor(ctx: Ctx, profileId: Id<"profiles">, now = Date.now()): Promise<Entitlements> {
  return entitlementsOf(await subscriptionOf(ctx, profileId), now);
}

/** Bytes used across every workspace this person owns (personal and team). */
export async function storageUsedBy(ctx: Ctx, profileId: Id<"profiles">): Promise<number> {
  const owned = await ctx.db
    .query("workspaces")
    .withIndex("by_owner", (q) => q.eq("ownerId", profileId))
    .collect();
  return owned.reduce((n, w) => n + w.storageUsedBytes, 0);
}

/** The billing row for someone, created (on Free, no trial) if it doesn't exist yet. */
export async function ensureSubscription(ctx: MutationCtx, profileId: Id<"profiles">): Promise<Doc<"subscriptions">> {
  const existing = await subscriptionOf(ctx, profileId);
  if (existing) return existing;
  const now = Date.now();
  const id = await ctx.db.insert("subscriptions", { profileId, plan: "free", status: "active", provider: "none", createdAt: now, updatedAt: now });
  return (await ctx.db.get(id))!;
}

/** A new account's billing row: Free, with a Pro trial. */
export async function startTrial(ctx: MutationCtx, profileId: Id<"profiles">): Promise<void> {
  if (await subscriptionOf(ctx, profileId)) return;
  const now = Date.now();
  await ctx.db.insert("subscriptions", { profileId, plan: "free", status: "active", provider: "none", trialEndsAt: now + TRIAL_DAYS * DAY_MS, createdAt: now, updatedAt: now });
}

/** Whether someone may add `bytes` more to a workspace: the workspace's own cap, and the owner's plan. */
export async function assertStorageFor(ctx: Ctx, workspace: Doc<"workspaces">, bytes: number): Promise<string | null> {
  if (workspace.storageUsedBytes + bytes > workspace.storageQuotaBytes) return "This workspace has reached its storage limit.";
  const { storageBytes, plan } = await entitlementsFor(ctx, workspace.ownerId);
  const used = await storageUsedBy(ctx, workspace.ownerId);
  if (used + bytes > storageBytes) {
    return workspace.kind === "personal"
      ? `You've used all the storage on your ${plan === "free" ? "Free" : plan === "basic" ? "Basic" : "Pro"} plan. Upgrade for more room, or free some up.`
      : "This workspace's owner is out of storage on their plan.";
  }
  return null;
}
