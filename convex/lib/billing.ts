// Personal subscriptions: reading and creating a person's billing row. What a plan entitles someone to is
// resolved in lib/entitlements.ts; the plans themselves live in lib/plans.ts.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { DAY_MS, TRIAL_DAYS } from "./plans";

type Ctx = QueryCtx | MutationCtx;

export async function subscriptionOf(ctx: Ctx, profileId: Id<"profiles">): Promise<Doc<"subscriptions"> | null> {
  return await ctx.db
    .query("subscriptions")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .unique();
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
