// Billing rows: a person's Personal subscription and a team workspace's subscription live in the same
// `subscriptions` table (and their payments in `payments`), with exactly one owner each:
//
//   ownerType "user"      → profileId set, workspaceId unset
//   ownerType "workspace" → workspaceId set, profileId unset
//
// Every subscription and payment row is inserted here (tests/convex/static checks nothing else inserts into
// either table), so the "exactly one owner" rule holds. What a plan entitles its owner to is resolved in
// lib/entitlements.ts; the plans themselves live in lib/plans.ts.
import type { WithoutSystemFields } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { DAY_MS, TRIAL_DAYS, isPaidPlan, personalPlanId, type PersonalTier, type WorkspacePlanId } from "./plans";

type Ctx = QueryCtx | MutationCtx;

/** Who a billing row belongs to. */
export type BillingOwner = { kind: "user"; profileId: Id<"profiles"> } | { kind: "workspace"; workspaceId: Id<"workspaces"> };

/** A Personal subscription row (its person and tier are always set). */
export type PersonalSubscription = Doc<"subscriptions"> & { profileId: Id<"profiles">; plan: PersonalTier };
/** A workspace subscription row (its workspace and catalog plan id are always set). */
export type WorkspaceSubscription = Doc<"subscriptions"> & { workspaceId: Id<"workspaces">; planId: WorkspacePlanId; ownerType: "workspace" };

export const isWorkspaceSubscription = (s: Doc<"subscriptions">): s is WorkspaceSubscription => s.ownerType === "workspace" && s.workspaceId !== undefined && s.planId !== undefined;
export const isPersonalSubscription = (s: Doc<"subscriptions">): s is PersonalSubscription => s.ownerType === "user" && s.profileId !== undefined && s.plan !== undefined;

/** A Personal payment row (basic or pro, for a person). */
export type PersonalPayment = Doc<"payments"> & { profileId: Id<"profiles">; plan: "basic" | "pro" };
export const isPersonalPayment = (p: Doc<"payments">): p is PersonalPayment => p.profileId !== undefined && p.workspaceId === undefined && (p.plan === "basic" || p.plan === "pro");

type SubscriptionFields = Omit<WithoutSystemFields<Doc<"subscriptions">>, "ownerType" | "profileId" | "workspaceId">;
type PaymentFields = Omit<WithoutSystemFields<Doc<"payments">>, "profileId" | "workspaceId">;

function ownerFields(owner: BillingOwner) {
  return owner.kind === "user" ? { ownerType: "user" as const, profileId: owner.profileId } : { ownerType: "workspace" as const, workspaceId: owner.workspaceId };
}

/** The one way a subscription row is created: exactly one owner, and the fields its kind requires. */
export async function insertSubscription(ctx: MutationCtx, owner: BillingOwner, fields: SubscriptionFields): Promise<Id<"subscriptions">> {
  if (owner.kind === "user" && (fields.plan === undefined || fields.planId !== undefined)) throw new Error("A Personal subscription stores a personal tier.");
  if (owner.kind === "workspace" && (fields.planId === undefined || fields.plan !== undefined)) throw new Error("A workspace subscription stores a workspace plan id.");
  return await ctx.db.insert("subscriptions", { ...fields, ...ownerFields(owner) });
}

/** The one way a payment row is created: a Personal payment or a workspace payment, never both. */
export async function insertPayment(ctx: MutationCtx, owner: BillingOwner, fields: PaymentFields): Promise<Id<"payments">> {
  const personalTier = fields.plan === "basic" || fields.plan === "pro";
  if ((owner.kind === "user") !== personalTier) throw new Error("A payment's plan must belong to its owner's kind.");
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
 * Whether a Personal plan is billed through Stripe right now. Admins can't set such a plan by hand
 * (adminBilling.setPlan refuses); it is changed or canceled in Stripe.
 */
export function personalStripeBilled(sub: PersonalSubscription | null): boolean {
  return Boolean(sub && sub.provider === "stripe" && sub.status !== "canceled" && isPaidPlan(personalPlanId(sub.plan, sub.interval)));
}

/** A new account's billing row: Free, with a Pro trial. */
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
 * Whether a workspace's plan is billed through Stripe right now (including a canceled plan still inside its
 * paid period). Admins can't set such a plan by hand (adminBilling.setWorkspacePlan refuses).
 */
export function workspaceStripeBilled(sub: WorkspaceSubscription | null, now = Date.now()): boolean {
  return Boolean(sub && sub.provider === "stripe" && isPaidPlan(sub.planId) && (sub.status !== "canceled" || (sub.currentPeriodEnd ?? 0) > now));
}

/** A workspace's billing row, created on Workspace Free if it doesn't exist yet. */
export async function ensureWorkspaceSubscription(ctx: MutationCtx, workspaceId: Id<"workspaces">): Promise<WorkspaceSubscription> {
  const existing = await workspaceSubscriptionOf(ctx, workspaceId);
  if (existing) return existing;
  const now = Date.now();
  const id = await insertSubscription(ctx, { kind: "workspace", workspaceId }, { planId: "workspace_free", status: "active", provider: "none", createdAt: now, updatedAt: now });
  return (await ctx.db.get(id)) as WorkspaceSubscription;
}

/**
 * The status an invoice event leaves on the payment already recorded for that invoice (Stripe events can
 * arrive late, twice or out of order): a refund stays refunded, and a failure delivered after the invoice
 * was paid doesn't undo the payment.
 */
export function invoicePaymentStatus(existing: Doc<"payments"> | null, paid: boolean): Doc<"payments">["status"] {
  if (existing?.status === "refunded") return "refunded";
  if (existing?.status === "paid" && !paid) return "paid";
  return paid ? "paid" : "failed";
}

/**
 * Whether a failed-invoice event may mark the plan past due: not when that invoice has been paid since,
 * nor when a newer subscription event (which carries the real status) was already applied.
 */
export function failedInvoiceMarksPastDue(existing: Doc<"payments"> | null, created: number | undefined, row: { stripeEventCreatedAt?: number }): boolean {
  if (existing && existing.status !== "failed") return false;
  return !(created !== undefined && row.stripeEventCreatedAt !== undefined && created < row.stripeEventCreatedAt);
}

/**
 * A refund in Stripe marks the payment for that invoice refunded (Personal or workspace alike). A partial
 * refund (Stripe's charge says `refunded: false`) leaves it paid.
 */
export async function markInvoiceRefunded(ctx: MutationCtx, o: Record<string, unknown>): Promise<void> {
  if (o.refunded === false) return;
  const ref = typeof o.invoice === "string" ? o.invoice : undefined;
  const payment = ref
    ? await ctx.db
        .query("payments")
        .withIndex("by_provider_ref", (q) => q.eq("providerRef", ref))
        .unique()
    : null;
  if (payment) await ctx.db.patch(payment._id, { status: "refunded" });
}
