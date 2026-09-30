// Billing rows: a person's Personal subscription and a team workspace's subscription live in the same
// `subscriptions` table (and their payments in `payments`), with exactly one owner each:
//
//   ownerType "user"      → profileId set, workspaceId unset
//   ownerType "workspace" → workspaceId set, profileId unset
//
// Every subscription and payment row is inserted here (tests/convex/static checks nothing else inserts into
// either table), so the "exactly one owner" rule holds. What a plan entitles its owner to is resolved in
// lib/entitlements.ts; the plans themselves live in lib/plans.ts. Payments go through Polar (lib/polar.ts).
import type { WithoutSystemFields } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { DAY_MS, TRIAL_DAYS, addMonthsUtc, isPaidPlan, personalPlanId, type BillingInterval, type PersonalTier, type WorkspacePlanId } from "./plans";

type Ctx = QueryCtx | MutationCtx;

/** Who a billing row belongs to. */
export type BillingOwner = { kind: "user"; profileId: Id<"profiles"> } | { kind: "workspace"; workspaceId: Id<"workspaces"> };

/** A Personal subscription row (its person and tier are always set). */
export type PersonalSubscription = Doc<"subscriptions"> & { profileId: Id<"profiles">; plan: PersonalTier };
/** A workspace subscription row (its workspace and catalog plan id are always set). */
export type WorkspaceSubscription = Doc<"subscriptions"> & { workspaceId: Id<"workspaces">; planId: WorkspacePlanId; ownerType: "workspace" };

export const isWorkspaceSubscription = (s: Doc<"subscriptions">): s is WorkspaceSubscription => s.ownerType === "workspace" && s.workspaceId !== undefined && s.planId !== undefined;
export const isPersonalSubscription = (s: Doc<"subscriptions">): s is PersonalSubscription => s.ownerType === "user" && s.profileId !== undefined && s.plan !== undefined;

/** A Personal row's catalog id (its tier and interval). */
export const storedPersonalPlanId = (s: Pick<PersonalSubscription, "plan" | "interval">) => personalPlanId(s.plan, s.interval);

/** A person's payment (a Personal plan or credits they bought), never a workspace plan's. */
export type PersonalPayment = Doc<"payments"> & { profileId: Id<"profiles"> };
export const isPersonalPayment = (p: Doc<"payments">): p is PersonalPayment => p.profileId !== undefined && p.workspaceId === undefined;

type SubscriptionFields = Omit<WithoutSystemFields<Doc<"subscriptions">>, "ownerType" | "profileId" | "workspaceId" | "catalogVersion">;
type PaymentFields = Omit<WithoutSystemFields<Doc<"payments">>, "profileId" | "workspaceId" | "catalogVersion">;

function ownerFields(owner: BillingOwner) {
  return owner.kind === "user" ? { ownerType: "user" as const, profileId: owner.profileId } : { ownerType: "workspace" as const, workspaceId: owner.workspaceId };
}

/** The one way a subscription row is created: exactly one owner, and the fields its kind requires. */
export async function insertSubscription(ctx: MutationCtx, owner: BillingOwner, fields: SubscriptionFields): Promise<Id<"subscriptions">> {
  if (owner.kind === "user" && (fields.plan === undefined || fields.planId !== undefined)) throw new Error("A Personal subscription stores a personal tier.");
  if (owner.kind === "workspace" && (fields.planId === undefined || fields.plan !== undefined)) throw new Error("A workspace subscription stores a workspace plan id.");
  return await ctx.db.insert("subscriptions", { ...fields, ...ownerFields(owner) });
}

/**
 * The one way a payment row is created: a person's payment (a Personal plan or a credit pack) or a
 * workspace's (a workspace plan), never both.
 */
export async function insertPayment(ctx: MutationCtx, owner: BillingOwner, fields: PaymentFields): Promise<Id<"payments">> {
  const workspacePlan = fields.planId !== undefined;
  if (owner.kind === "user" && workspacePlan) throw new Error("A payment's plan must belong to its owner's kind.");
  if (owner.kind === "workspace" && (!workspacePlan || fields.plan === "credits")) throw new Error("A payment's plan must belong to its owner's kind.");
  if ((fields.plan === "credits") !== (fields.credits !== undefined)) throw new Error("A credit pack payment records its credits.");
  const who = owner.kind === "user" ? { profileId: owner.profileId } : { workspaceId: owner.workspaceId };
  return await ctx.db.insert("payments", { ...fields, ...who });
}

// ---------------------------------------------------------------------------------------------------
// Personal
// ---------------------------------------------------------------------------------------------------

export async function subscriptionOf(ctx: Ctx, profileId: Id<"profiles">): Promise<PersonalSubscription | null> {
  const row = await ctx.db
    .query("subscriptions")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .unique();
  return row && isPersonalSubscription(row) ? row : null;
}

/** The billing row for someone, created (on Free, no trial) if it doesn't exist yet. */
export async function ensureSubscription(ctx: MutationCtx, profileId: Id<"profiles">): Promise<PersonalSubscription> {
  const existing = await subscriptionOf(ctx, profileId);
  if (existing) return existing;
  const now = Date.now();
  const id = await insertSubscription(ctx, { kind: "user", profileId }, { plan: "free", status: "active", provider: "none", createdAt: now, updatedAt: now });
  return (await ctx.db.get(id)) as PersonalSubscription;
}

/**
 * Whether a Personal plan is billed through Polar right now. Admins can't set such a plan by hand
 * (adminBilling.setPlan refuses); it is changed or canceled in Polar.
 */
export function personalPolarBilled(sub: PersonalSubscription | null): boolean {
  return Boolean(sub && sub.provider === "polar" && sub.status !== "canceled" && isPaidPlan(storedPersonalPlanId(sub)));
}

/** A new account's billing row: Free, with a Pro AI trial. */
export async function startTrial(ctx: MutationCtx, profileId: Id<"profiles">): Promise<void> {
  if (await subscriptionOf(ctx, profileId)) return;
  const now = Date.now();
  await insertSubscription(ctx, { kind: "user", profileId }, { plan: "free", status: "active", provider: "none", trialEndsAt: now + TRIAL_DAYS * DAY_MS, createdAt: now, updatedAt: now });
}

// ---------------------------------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------------------------------

/** A team workspace's subscription row, if it ever had one (no row = Workspace Free). */
export async function workspaceSubscriptionOf(ctx: Ctx, workspaceId: Id<"workspaces">): Promise<WorkspaceSubscription | null> {
  const row = await ctx.db
    .query("subscriptions")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .first();
  return row && isWorkspaceSubscription(row) ? row : null;
}

/**
 * Whether a workspace's plan is billed through Polar right now (including a canceled plan still inside its
 * paid period). Admins can't set such a plan by hand (adminBilling.setWorkspacePlan refuses).
 */
export function workspacePolarBilled(sub: WorkspaceSubscription | null, now = Date.now()): boolean {
  return Boolean(sub && sub.provider === "polar" && isPaidPlan(sub.planId) && (sub.status !== "canceled" || (sub.currentPeriodEnd ?? 0) > now));
}

/** A workspace's billing row, created on Workspace Free if it doesn't exist yet. */
export async function ensureWorkspaceSubscription(ctx: MutationCtx, workspaceId: Id<"workspaces">): Promise<WorkspaceSubscription> {
  const existing = await workspaceSubscriptionOf(ctx, workspaceId);
  if (existing) return existing;
  const now = Date.now();
  const id = await insertSubscription(ctx, { kind: "workspace", workspaceId }, { planId: "workspace_free", status: "active", provider: "none", createdAt: now, updatedAt: now });
  return (await ctx.db.get(id)) as WorkspaceSubscription;
}

/** When a test plan's period that starts at `start` ends: a calendar month or year later (like Polar's). */
export const periodEndFrom = (start: number, interval: BillingInterval | null | undefined) => addMonthsUtc(start, interval === "year" ? 12 : 1);
