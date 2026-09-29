// Workspace (Team) plans and billing: a team workspace's own plan (Free, Core, Pro or Pro AI), billed per
// member seat. The subscription belongs to the workspace (not to whoever owns it), so it stays put when
// ownership moves, and it never changes anyone's Personal plan (nor does a Personal plan change it).
//
// Who: the owner, and admins the owner allowed (lib/permissions.ts). Checked here on every function; the
//   web app only hides what people can't use.
// Seats: lib/seats.ts decides who takes one; `syncSeatQuantity` keeps the Polar subscription's seats equal
//   to it (Polar prorates).
// Money: Polar Checkout with seats = billable members (counted here, never taken from the browser); plan
//   changes, seat changes and cancel/resume are Polar subscription updates. The subscription is paid by
//   the person who started it (their own Polar customer); only they can open Polar's customer portal, and
//   any billing manager can change, cancel or resume the plan from Folevi. Access is granted only by
//   webhooks (convex/billing.ts routes a workspace's events here), never by a browser returning from Checkout.
// Without Polar: development builds can make test purchases; admins can set a plan by hand ("manual",
//   convex/adminBilling.ts). Expired test/manual plans fall back to Workspace Free in the hourly
//   `billing.settleExpiredPlans` job.
// Past due: the plan stays in force while Polar retries the payment; when Polar gives up it cancels the
//   subscription, and the workspace is on Free.
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { normalizeMembership, requireIdentity, requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";
import { ensureWorkspaceSubscription, insertPayment, isWorkspaceSubscription, periodEndFrom, storedWorkspacePlanId, workspaceSubscriptionOf, type WorkspaceSubscription } from "./lib/billing";
import { freePool, memberStorageUsed, storageUsage, workspaceEntitlements } from "./lib/entitlements";
import { creditBalance, seatAccount } from "./lib/credits";
import { requireWorkspaceBilling } from "./lib/permissions";
import { PLAN_CATALOG, TIER_NAMES, isPaidPlan, type PaidWorkspacePlanId, type WorkspacePlanId } from "./lib/plans";
import { workspaceScope } from "./lib/scope";
import { billableQuantity, seatChargeCents, seatSummary, seatsChanged } from "./lib/seats";
import { createCheckout, customerPortal, ms, num, polarGet, polarPatch, polarToken, productId, str, testPurchasesAllowed, workspaceCheckoutReady } from "./lib/polar";
import { vPaidWorkspacePlanId } from "./lib/validators";

const intervalOf = (planId: PaidWorkspacePlanId) => PLAN_CATALOG[planId].interval!;
/** Whether a row is a paid plan that hasn't ended (a canceled row still in its paid period counts). */
const livePaid = (s: WorkspaceSubscription, now = Date.now()) => isPaidPlan(storedWorkspacePlanId(s)) && (s.status !== "canceled" || (s.currentPeriodEnd ?? 0) > now);

// ---------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------

/**
 * The workspace's plan and billing page: plan and price, billable seats and the estimated charge, guests
 * (not billed), status and renewal, storage (the owner's free pool, or per member), your own AI credits
 * here, payment method, and this workspace's payments only.
 */
export const summary = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { workspace, member } = await requireWorkspaceBilling(ctx, profile, args.workspaceId);
    const sub = await workspaceSubscriptionOf(ctx, workspace._id);
    const e = await workspaceEntitlements(ctx, workspace);
    const plan = PLAN_CATALOG[e.planId];
    const seats = await seatSummary(ctx, workspace._id);
    const scope = workspaceScope(workspace._id);
    const storage = await storageUsage(ctx, scope);
    const pool = e.storageRule === "shared_free" ? await freePool(ctx, workspace.ownerId) : null;
    const seat = await seatAccount(ctx, profile._id, workspace._id);
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_workspace_created", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(24);
    return {
      workspace: { id: workspace.publicId, name: workspace.name },
      yourRole: normalizeMembership(member).role,
      entitlements: e,
      plan: { id: e.planId, tier: plan.tier, name: TIER_NAMES[plan.tier], interval: plan.interval, seatPriceCents: plan.priceCents },
      subscription:
        sub && sub.provider !== "none"
          ? {
              planId: storedWorkspacePlanId(sub),
              provider: sub.provider,
              status: sub.status,
              cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
              currentPeriodStart: sub.currentPeriodStart ?? null,
              currentPeriodEnd: sub.currentPeriodEnd ?? null,
              trialEndsAt: sub.trialEndsAt ?? null,
              quantity: sub.quantity ?? null,
              paymentMethod: sub.paymentMethod ?? null,
              /** Billed through Polar and paid by you (only the payer can open Polar's portal). */
              youPay: sub.provider === "polar" && sub.polarBuyerId === profile._id,
            }
          : null,
      seats: seats.seats,
      guests: seats.guests,
      pendingInvites: seats.pendingInvites,
      /** seats × the plan's price per seat, per billing interval (0 on Free). */
      estimatedChargeCents: e.paid ? seatChargeCents(plan.priceCents, seats.seats) : 0,
      /** The workspace's total (Free: the owner's whole pool; paid: everyone's uploads here against every member's quota). */
      storageUsedBytes: storage.usedBytes,
      storageLimitBytes: storage.limitBytes,
      storageRule: e.storageRule,
      /** Paid plans: each member's own quota, and yours. */
      storagePerMemberBytes: e.storageRule === "per_person" ? e.storageBytes : null,
      yourStorageUsedBytes: e.storageRule === "per_person" ? await memberStorageUsed(ctx, workspace._id, profile._id) : null,
      /** Free: how many free workspaces share the owner's pool, and whether their Personal does too. */
      pool: pool ? { workspaces: pool.workspaces, includesPersonal: pool.includesPersonal } : null,
      /** Over its limit: on a paid plan, your own quota here; otherwise the pool or the override. */
      overLimit: e.storageRule === "per_person" ? (await memberStorageUsed(ctx, workspace._id, profile._id)) > e.storageBytes : storage.usedBytes > storage.limitBytes,
      /** Your own AI credits here (paid plans with AI; on Free members use their personal credits). */
      credits: seat ? { ...(await creditBalance(ctx, seat)), canBuy: seat.canBuy } : null,
      payments: payments.map((p) => {
        const planId = p.planId ? storedWorkspacePlanId({ planId: p.planId }) : null;
        return { id: p._id as string, amountCents: p.amountCents, currency: p.currency, planId, plan: planId ? PLAN_CATALOG[planId].tier : null, interval: p.interval ?? null, quantity: p.quantity ?? null, status: p.status, createdAt: p.createdAt };
      }),
      checkoutAvailable: workspaceCheckoutReady(),
      testPurchases: testPurchasesAllowed(),
    };
  },
});

// ---------------------------------------------------------------------------------------------------
// Without a payment provider: test purchases (development only) and cancel/resume of test/manual plans
// ---------------------------------------------------------------------------------------------------

/** Development only: put the workspace on a paid plan without paying (records a test payment for its seats). */
export const testPurchase = mutation({
  args: { workspaceId: v.string(), planId: vPaidWorkspacePlanId },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!testPurchasesAllowed()) fail("forbidden", "Test purchases are only available in development.");
    const { workspace } = await requireWorkspaceBilling(ctx, profile, args.workspaceId, { write: true });
    const sub = await ensureWorkspaceSubscription(ctx, workspace._id);
    if (sub.provider === "polar" && livePaid(sub)) fail("invalid_argument", "This workspace is billed through Polar. Change its plan there.");
    const now = Date.now();
    const seats = await billableQuantity(ctx, workspace._id);
    const plan = PLAN_CATALOG[args.planId];
    await ctx.db.patch(sub._id, {
      planId: args.planId,
      status: "active",
      provider: "test",
      quantity: seats,
      currentPeriodStart: now,
      currentPeriodEnd: periodEndFrom(now, plan.interval),
      cancelAtPeriodEnd: false,
      paidSince: sub.paidSince && livePaid(sub, now) ? sub.paidSince : now,
      canceledAt: undefined,
      updatedAt: now,
    });
    await insertPayment(ctx, { kind: "workspace", workspaceId: workspace._id }, { amountCents: seatChargeCents(plan.priceCents, seats), currency: "usd", plan: plan.tier as "core" | "pro" | "pro_ai", planId: args.planId, quantity: seats, interval: intervalOf(args.planId), status: "paid", provider: "test", createdAt: now });
    return null;
  },
});

/** Cancel (at period end) or resume a plan that isn't billed through Polar. Called by `cancel` / `resume`. */
export const setLocalCancel = internalMutation({
  args: { workspaceId: v.string(), cancel: v.boolean() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    // Canceling is always allowed; resuming isn't while the workspace is scheduled for deletion.
    const { workspace } = await requireWorkspaceBilling(ctx, profile, args.workspaceId, { write: !args.cancel });
    const sub = await workspaceSubscriptionOf(ctx, workspace._id);
    if (!sub || !livePaid(sub)) fail("invalid_argument", "This workspace is on the Free plan.");
    if (sub.provider === "polar") fail("invalid_argument", "Manage this subscription in the billing portal.");
    await ctx.db.patch(sub._id, { cancelAtPeriodEnd: args.cancel, updatedAt: Date.now() });
    return null;
  },
});

// ---------------------------------------------------------------------------------------------------
// Polar: checkout, portal, plan changes, cancel/resume
// ---------------------------------------------------------------------------------------------------

interface BillingContext {
  workspaceId: string;
  profileId: string;
  email: string;
  provider: "none" | "polar" | "manual" | "test" | "stripe";
  polarSubscriptionId: string | null;
  planId: WorkspacePlanId;
  /** A paid plan in force right now. */
  paid: boolean;
  /** A Polar subscription that hasn't ended. */
  polarLive: boolean;
  /** Whether the caller is the person whose Polar customer pays. */
  youPay: boolean;
  seats: number;
}

/** What the Polar actions need, after checking the caller may manage this workspace's billing. */
export const billingContext = internalQuery({
  args: { workspaceId: v.string(), write: v.boolean() },
  handler: async (ctx, args): Promise<BillingContext> => {
    const profile = await requireProfile(ctx);
    const { workspace } = await requireWorkspaceBilling(ctx, profile, args.workspaceId, { write: args.write });
    const sub = await workspaceSubscriptionOf(ctx, workspace._id);
    const e = await workspaceEntitlements(ctx, workspace);
    return {
      workspaceId: workspace._id as string,
      profileId: profile._id as string,
      email: profile.email,
      provider: sub?.provider ?? "none",
      polarSubscriptionId: sub?.polarSubscriptionId ?? null,
      planId: sub ? storedWorkspacePlanId(sub) : "workspace_free",
      paid: e.paid,
      polarLive: Boolean(sub && sub.provider === "polar" && sub.polarSubscriptionId && livePaid(sub) && sub.status !== "canceled"),
      youPay: Boolean(sub && sub.polarBuyerId === profile._id),
      seats: await billableQuantity(ctx, workspace._id),
    };
  },
});

/** `write`: anything but canceling (refused while the workspace is scheduled for deletion). */
async function contextFor(ctx: ActionCtx, workspaceId: string, write = true): Promise<BillingContext> {
  await requireIdentity(ctx);
  return await ctx.runQuery(internal.workspaceBilling.billingContext, { workspaceId, write });
}

/**
 * Starts Polar Checkout for a paid workspace plan, one seat per billable member (counted here); returns the
 * page to open. The caller's own Polar customer pays.
 */
export const checkout = action({
  args: { workspaceId: v.string(), planId: vPaidWorkspacePlanId },
  handler: async (ctx, args): Promise<{ url: string }> => {
    await requireIdentity(ctx);
    const c = await contextFor(ctx, args.workspaceId);
    if (!workspaceCheckoutReady()) fail("maintenance", "Workspace payments aren't set up on this server yet.");
    if (c.polarLive) fail("invalid_argument", "This workspace already has a subscription. Change its plan instead.");
    const url = await createCheckout({
      product: productId(args.planId)!,
      externalCustomerId: c.profileId,
      email: c.email,
      metadata: { kind: "workspace", workspaceId: c.workspaceId, profileId: c.profileId },
      seats: c.seats,
      successPath: "/settings/workspace-billing?checkout=success",
      returnPath: "/settings/workspace-billing",
    });
    return { url };
  },
});

/** Polar's customer portal (payment method, invoices), for the person who pays for this workspace only. */
export const portal = action({
  args: { workspaceId: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    await requireIdentity(ctx);
    const c = await contextFor(ctx, args.workspaceId);
    if (c.provider !== "polar") fail("invalid_argument", "There's no paid subscription to manage yet.");
    if (!c.youPay) fail("forbidden", "Only the person who started this subscription can open its billing portal. You can still change, cancel or resume the plan here.");
    return { url: await customerPortal(c.profileId, "/settings/workspace-billing") };
  },
});

/** Core, Pro and Pro AI, monthly or yearly, on a Polar subscription (prorated by Polar). */
export const changePlan = action({
  args: { workspaceId: v.string(), planId: vPaidWorkspacePlanId },
  handler: async (ctx, args): Promise<null> => {
    await requireIdentity(ctx);
    const c = await contextFor(ctx, args.workspaceId);
    if (!c.polarLive || !c.polarSubscriptionId) fail("invalid_argument", "There's no subscription to change. Choose a plan to start one.");
    if (c.planId === args.planId) fail("invalid_argument", "The workspace is already on that plan.");
    const product = productId(args.planId);
    if (!product) fail("maintenance", "That plan isn't available to buy yet.");
    await polarPatch(`subscriptions/${c.polarSubscriptionId}`, { product_id: product, proration_behavior: "prorate" });
    // Seats are their own update (Polar takes one kind of change at a time); the sync reads the count again.
    await ctx.runMutation(internal.workspaceBilling.recordPolarChange, { workspaceId: c.workspaceId as Id<"workspaces">, planId: args.planId });
    return null;
  },
});

async function setCancel(ctx: ActionCtx, workspaceId: string, cancel: boolean): Promise<null> {
  const c = await contextFor(ctx, workspaceId, !cancel);
  if (!c.paid) fail("invalid_argument", "This workspace is on the Free plan.");
  if (c.provider === "polar" && c.polarSubscriptionId) {
    await polarPatch(`subscriptions/${c.polarSubscriptionId}`, { cancel_at_period_end: cancel });
    await ctx.runMutation(internal.workspaceBilling.recordPolarChange, { workspaceId: c.workspaceId as Id<"workspaces">, cancelAtPeriodEnd: cancel });
  } else {
    await ctx.runMutation(internal.workspaceBilling.setLocalCancel, { workspaceId, cancel });
  }
  return null;
}

/** Cancels at the end of the paid period: the plan stays until then, then the workspace is on Free. */
export const cancel = action({
  args: { workspaceId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    await requireIdentity(ctx);
    return await setCancel(ctx, args.workspaceId, true);
  },
});

/** Keeps a plan that was set to cancel at period end. */
export const resume = action({
  args: { workspaceId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    await requireIdentity(ctx);
    return await setCancel(ctx, args.workspaceId, false);
  },
});

/** Reflects a change Polar just accepted (its webhook confirms it again moments later). */
export const recordPolarChange = internalMutation({
  args: { workspaceId: v.id("workspaces"), planId: v.optional(vPaidWorkspacePlanId), cancelAtPeriodEnd: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const sub = await workspaceSubscriptionOf(ctx, args.workspaceId);
    if (!sub || sub.provider !== "polar") return null;
    await ctx.db.patch(sub._id, {
      ...(args.planId ? { planId: args.planId } : {}),
      ...(args.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: args.cancelAtPeriodEnd } : {}),
      updatedAt: Date.now(),
    });
    return null;
  },
});

// ---------------------------------------------------------------------------------------------------
// Seat sync (scheduled by lib/seats.ts seatsChanged)
// ---------------------------------------------------------------------------------------------------

/** Clears the pending mark and says what Polar's seats should be now (null: nothing to tell Polar). */
export const beginSeatSync = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<{ subscriptionId: string; seats: number } | null> => {
    const sub = await workspaceSubscriptionOf(ctx, args.workspaceId);
    if (!sub) return null;
    if (sub.seatSyncScheduledAt !== undefined) await ctx.db.patch(sub._id, { seatSyncScheduledAt: undefined });
    if (!livePaid(sub) || sub.status === "canceled") return null;
    const seats = await billableQuantity(ctx, args.workspaceId);
    if (sub.provider !== "polar") {
      if (sub.quantity !== seats) await ctx.db.patch(sub._id, { quantity: seats, updatedAt: Date.now() });
      return null;
    }
    // No subscription id yet (its events haven't arrived): the created event schedules a sync itself.
    if (!sub.polarSubscriptionId) return null;
    return { subscriptionId: sub.polarSubscriptionId, seats };
  },
});

export const recordSeatQuantity = internalMutation({
  args: { workspaceId: v.id("workspaces"), quantity: v.number() },
  handler: async (ctx, args) => {
    const sub = await workspaceSubscriptionOf(ctx, args.workspaceId);
    if (sub && sub.quantity !== args.quantity) await ctx.db.patch(sub._id, { quantity: args.quantity, updatedAt: Date.now() });
    return null;
  },
});

const SYNC_RETRIES = 5;

/**
 * Sets the Polar subscription's seats to the workspace's current billable seats (Polar prorates). It does
 * nothing when Polar already agrees, so running it twice (or for two changes at once) is harmless. A
 * failure is retried with a growing delay.
 */
export const syncSeatQuantity = internalAction({
  args: { workspaceId: v.id("workspaces"), attempt: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ status: "noop" | "synced" | "unchanged" | "failed"; seats?: number }> => {
    const job = await ctx.runMutation(internal.workspaceBilling.beginSeatSync, { workspaceId: args.workspaceId });
    if (!job) return { status: "noop" };
    try {
      const current = await polarGet(`subscriptions/${job.subscriptionId}`);
      const changed = num(current.seats) !== job.seats;
      if (changed) await polarPatch(`subscriptions/${job.subscriptionId}`, { seats: job.seats, proration_behavior: "prorate" });
      await ctx.runMutation(internal.workspaceBilling.recordSeatQuantity, { workspaceId: args.workspaceId, quantity: job.seats });
      return { status: changed ? "synced" : "unchanged", seats: job.seats };
    } catch {
      const attempt = (args.attempt ?? 0) + 1;
      console.warn(JSON.stringify({ event: "billing.seat_sync_failed", attempt }));
      if (attempt < SYNC_RETRIES) await ctx.scheduler.runAfter(attempt * 60_000, internal.workspaceBilling.syncSeatQuantity, { workspaceId: args.workspaceId, attempt });
      return { status: "failed" };
    }
  },
});

/**
 * A workspace (or an account) being deleted: stop its Polar subscription renewing (it runs to the end of the
 * paid period).
 */
export const stopForDeletedWorkspace = internalAction({
  args: { polarSubscriptionId: v.string() },
  handler: async (_ctx, args) => {
    if (!polarToken()) return null;
    await polarPatch(`subscriptions/${args.polarSubscriptionId}`, { cancel_at_period_end: true });
    return null;
  },
});

/** Called when a workspace is purged: schedules the end of its Polar subscription, if it has one. */
export async function workspaceClosing(ctx: MutationCtx, workspaceId: Id<"workspaces">): Promise<void> {
  const sub = await workspaceSubscriptionOf(ctx, workspaceId);
  if (!sub || !livePaid(sub)) return;
  await ctx.db.patch(sub._id, { cancelAtPeriodEnd: true, updatedAt: Date.now() });
  if (sub.provider === "polar" && sub.polarSubscriptionId && !sub.cancelAtPeriodEnd) {
    await ctx.scheduler.runAfter(0, internal.workspaceBilling.stopForDeletedWorkspace, { polarSubscriptionId: sub.polarSubscriptionId });
  }
}

// ---------------------------------------------------------------------------------------------------
// Webhook (routed here by convex/billing.ts applyPolarEvent, which dedupes by delivery id)
// ---------------------------------------------------------------------------------------------------

/** A Polar subscription event for a workspace's plan. */
export async function applyWorkspaceSubscriptionEvent(ctx: MutationCtx, row: WorkspaceSubscription, planId: PaidWorkspacePlanId, status: WorkspaceSubscription["status"], at: number, o: Record<string, unknown>): Promise<void> {
  const now = Date.now();
  const periodEnd = ms(o.current_period_end) ?? row.currentPeriodEnd;
  const seats = num(o.seats);
  const buyer = (() => {
    const meta = (o.metadata as Record<string, unknown> | undefined)?.profileId;
    const ext = (o.customer as Record<string, unknown> | undefined)?.external_id;
    const ref = typeof meta === "string" ? meta : typeof ext === "string" ? ext : undefined;
    return ref ? (ctx.db.normalizeId("profiles", ref) ?? undefined) : undefined;
  })();
  const wasLive = livePaid(row, now) && row.status !== "canceled";
  const sameTier = PLAN_CATALOG[storedWorkspacePlanId(row)].tier === PLAN_CATALOG[planId].tier;
  await ctx.db.patch(row._id, {
    provider: "polar",
    planId,
    status,
    quantity: seats ?? row.quantity,
    currentPeriodStart: ms(o.current_period_start) ?? row.currentPeriodStart,
    currentPeriodEnd: status === "canceled" ? Math.min(periodEnd ?? now, now) : periodEnd,
    cancelAtPeriodEnd: Boolean(o.cancel_at_period_end),
    trialEndsAt: o.status === "trialing" ? ms(o.trial_end) : undefined,
    polarCustomerId: str(o.customer_id) ?? row.polarCustomerId,
    polarSubscriptionId: str(o.id) ?? row.polarSubscriptionId,
    polarProductId: str(o.product_id),
    polarBuyerId: buyer ?? row.polarBuyerId,
    paidSince: wasLive && row.paidSince && sameTier ? row.paidSince : status === "canceled" ? row.paidSince : now,
    canceledAt: status === "canceled" ? (row.canceledAt ?? now) : undefined,
    polarEventAt: at,
    updatedAt: now,
  });
  // Members may have joined or left while Checkout was open: bring Polar's seats to the current count.
  if (status !== "canceled" && seats !== undefined && seats !== (await billableQuantity(ctx, row.workspaceId))) {
    await seatsChanged(ctx, row.workspaceId);
  }
}

/** A paid Polar order for a workspace's plan (first payment, renewal or change), keyed by order id. */
export async function applyWorkspaceOrder(ctx: MutationCtx, row: WorkspaceSubscription, planId: PaidWorkspacePlanId, orderId: string, amountCents: number, currency: string, seats: number | undefined): Promise<void> {
  const plan = PLAN_CATALOG[planId];
  await insertPayment(ctx, { kind: "workspace", workspaceId: row.workspaceId }, {
    amountCents,
    currency,
    plan: plan.tier as "core" | "pro" | "pro_ai",
    planId,
    quantity: seats ?? row.quantity,
    interval: intervalOf(planId),
    status: "paid",
    provider: "polar",
    providerRef: orderId,
    createdAt: Date.now(),
  });
}

// ---------------------------------------------------------------------------------------------------
// End of period (called from billing.settleExpiredPlans, hourly)
// ---------------------------------------------------------------------------------------------------

/** Test and manual workspace plans whose period ended → Workspace Free (test plans renew unless canceled). */
export async function settleExpiredWorkspacePlans(ctx: MutationCtx, now: number): Promise<number> {
  const rows = await ctx.db
    .query("subscriptions")
    .withIndex("by_owner_type", (q) => q.eq("ownerType", "workspace"))
    .take(2000);
  let changed = 0;
  for (const s of rows) {
    if (!isWorkspaceSubscription(s)) continue;
    const planId = storedWorkspacePlanId(s);
    if (!isPaidPlan(planId) || s.provider === "polar" || s.currentPeriodEnd === undefined || s.currentPeriodEnd > now) continue;
    if (s.provider === "test" && !s.cancelAtPeriodEnd) {
      await ctx.db.patch(s._id, { currentPeriodStart: now, currentPeriodEnd: periodEndFrom(now, PLAN_CATALOG[planId].interval), updatedAt: now });
      continue;
    }
    await ctx.db.patch(s._id, { planId: "workspace_free", status: "canceled", quantity: undefined, canceledAt: now, cancelAtPeriodEnd: false, updatedAt: now });
    changed++;
  }
  return changed;
}
