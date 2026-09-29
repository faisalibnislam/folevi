// Workspace plans and billing: a team workspace's own plan (Free, Team or Business), billed per member seat.
// The subscription belongs to the workspace — not to whoever owns it — so it stays put when ownership moves,
// and it never changes anyone's Personal plan (nor does a Personal plan change it).
//
// Who: the owner, and admins the owner allowed (lib/permissions.ts). Checked here on every function; the
//   web app only hides what people can't use.
// Seats: lib/seats.ts decides who takes one; `syncSeatQuantity` keeps Stripe's quantity equal to it.
// Money: Stripe Checkout with quantity = seats; plan changes and seat changes are Stripe subscription item
//   updates with proration; cancel/resume set cancel_at_period_end. Access is granted only by webhooks
//   (convex/billing.ts routes a workspace's events here), never by a browser returning from Checkout.
// Without Stripe: development builds can make test purchases; admins can set a plan by hand ("manual",
//   convex/adminBilling.ts). Expired test/manual plans fall back to Workspace Free in the hourly
//   `billing.settleExpiredPlans` job.
// Past due: the plan stays in force while Stripe retries the payment (its retry schedule is the grace);
//   when Stripe gives up it cancels the subscription (or marks it unpaid), and the workspace is on Free.
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { normalizeMembership, requireIdentity, requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";
import { ensureWorkspaceSubscription, insertPayment, isWorkspaceSubscription, markInvoiceRefunded, workspaceSubscriptionOf, type WorkspaceSubscription } from "./lib/billing";
import { storageUsage, workspaceEntitlements } from "./lib/entitlements";
import { requireWorkspaceBilling } from "./lib/permissions";
import { DAY_MS, PLAN_CATALOG, WORKSPACE_PLANS, isPaidPlan, type WorkspacePlanId, type WorkspaceTier } from "./lib/plans";
import { workspaceScope } from "./lib/scope";
import { billableSeatCount, seatSummary, seatsChanged } from "./lib/seats";
import { appUrl, cardLabel, intervalOf, periodOf, stripeGet, stripeKey, stripePost, subscriptionIdOf, subscriptionItems, testPurchasesAllowed, workspacePlanForPrice, workspacePriceId, workspaceStripeReady } from "./lib/stripe";
import { vPaidWorkspacePlanId } from "./lib/validators";
import type { ApplyResult } from "./billing";

type PaidWorkspacePlanId = Exclude<WorkspacePlanId, "workspace_free">;
const periodMs = (planId: PaidWorkspacePlanId) => (intervalOf(planId) === "year" ? 365 : 30) * DAY_MS;
/** Whether a row is a paid plan that hasn't ended (a canceled row still in its paid period counts). */
const livePaid = (s: WorkspaceSubscription, now = Date.now()) => isPaidPlan(s.planId) && (s.status !== "canceled" || (s.currentPeriodEnd ?? 0) > now);

// ---------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------

/**
 * The workspace's plan and billing page: plan and price, billable seats and the estimated charge, guests
 * (not billed), status and renewal, payment method, and this workspace's payments only.
 */
export const summary = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { workspace, member } = await requireWorkspaceBilling(ctx, profile, args.workspaceId);
    const sub = await workspaceSubscriptionOf(ctx, workspace._id);
    const e = await workspaceEntitlements(ctx, workspace);
    const plan = PLAN_CATALOG[e.planId];
    const tier = plan.tier as WorkspaceTier;
    const seats = await seatSummary(ctx, workspace._id);
    const storage = await storageUsage(ctx, workspaceScope(workspace._id));
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_workspace_created", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(24);
    return {
      workspace: { id: workspace.publicId, name: workspace.name },
      yourRole: normalizeMembership(member).role,
      entitlements: e,
      plan: { id: e.planId, tier, name: WORKSPACE_PLANS[tier].name, interval: plan.interval, seatPriceCents: plan.priceCents },
      subscription:
        sub && sub.provider !== "none"
          ? {
              planId: sub.planId,
              provider: sub.provider,
              status: sub.status,
              cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
              currentPeriodStart: sub.currentPeriodStart ?? null,
              currentPeriodEnd: sub.currentPeriodEnd ?? null,
              trialEndsAt: sub.trialEndsAt ?? null,
              quantity: sub.quantity ?? null,
              paymentMethod: sub.paymentMethod ?? null,
            }
          : null,
      seats: seats.seats,
      guests: seats.guests,
      pendingInvites: seats.pendingInvites,
      /** seats × the plan's price per seat, per billing interval (0 on Free). */
      estimatedChargeCents: e.paid ? seats.seats * plan.priceCents : 0,
      storageUsedBytes: storage.usedBytes,
      storageLimitBytes: storage.limitBytes,
      overLimit: storage.usedBytes > storage.limitBytes,
      payments: payments.map((p) => ({ id: p._id as string, amountCents: p.amountCents, currency: p.currency, plan: p.plan, interval: p.interval, quantity: p.quantity ?? null, status: p.status, createdAt: p.createdAt })),
      checkoutAvailable: workspaceStripeReady(),
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
    const { workspace } = await requireWorkspaceBilling(ctx, profile, args.workspaceId);
    const sub = await ensureWorkspaceSubscription(ctx, workspace._id);
    if (sub.provider === "stripe" && livePaid(sub)) fail("invalid_argument", "This workspace is billed through Stripe. Change its plan there.");
    const now = Date.now();
    const seats = await billableSeatCount(ctx, workspace._id);
    const plan = PLAN_CATALOG[args.planId];
    await ctx.db.patch(sub._id, {
      planId: args.planId,
      status: "active",
      provider: "test",
      quantity: seats,
      currentPeriodStart: now,
      currentPeriodEnd: now + periodMs(args.planId),
      cancelAtPeriodEnd: false,
      paidSince: sub.paidSince && livePaid(sub, now) ? sub.paidSince : now,
      canceledAt: undefined,
      updatedAt: now,
    });
    await insertPayment(ctx, { kind: "workspace", workspaceId: workspace._id }, { amountCents: plan.priceCents * seats, currency: "usd", plan: plan.tier as "team" | "business", planId: args.planId, quantity: seats, interval: intervalOf(args.planId), status: "paid", provider: "test", createdAt: now });
    return null;
  },
});

/** Cancel (at period end) or resume a plan that isn't billed through Stripe. Called by `cancel` / `resume`. */
export const setLocalCancel = internalMutation({
  args: { workspaceId: v.string(), cancel: v.boolean() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { workspace } = await requireWorkspaceBilling(ctx, profile, args.workspaceId);
    const sub = await workspaceSubscriptionOf(ctx, workspace._id);
    if (!sub || !livePaid(sub)) fail("invalid_argument", "This workspace is on the Free plan.");
    if (sub.provider === "stripe") fail("invalid_argument", "Manage this subscription in the billing portal.");
    await ctx.db.patch(sub._id, { cancelAtPeriodEnd: args.cancel, updatedAt: Date.now() });
    return null;
  },
});

// ---------------------------------------------------------------------------------------------------
// Stripe: checkout, portal, plan changes, cancel/resume
// ---------------------------------------------------------------------------------------------------

interface BillingContext {
  workspaceId: string;
  publicId: string;
  email: string;
  customerId: string | null;
  provider: "none" | "stripe" | "manual" | "test";
  stripeSubscriptionId: string | null;
  itemId: string | null;
  planId: WorkspacePlanId;
  /** A paid plan in force right now. */
  paid: boolean;
  /** A Stripe subscription that hasn't ended. */
  stripeLive: boolean;
  seats: number;
}

/** What the Stripe actions need, after checking the caller may manage this workspace's billing. */
export const billingContext = internalQuery({
  args: { workspaceId: v.string() },
  handler: async (ctx, args): Promise<BillingContext> => {
    const profile = await requireProfile(ctx);
    const { workspace } = await requireWorkspaceBilling(ctx, profile, args.workspaceId);
    const sub = await workspaceSubscriptionOf(ctx, workspace._id);
    const e = await workspaceEntitlements(ctx, workspace);
    return {
      workspaceId: workspace._id as string,
      publicId: workspace.publicId,
      email: profile.email,
      customerId: sub?.stripeCustomerId ?? null,
      provider: sub?.provider ?? "none",
      stripeSubscriptionId: sub?.stripeSubscriptionId ?? null,
      itemId: sub?.stripeSubscriptionItemId ?? null,
      planId: sub?.planId ?? "workspace_free",
      paid: e.paid,
      stripeLive: Boolean(sub && sub.provider === "stripe" && sub.stripeSubscriptionId && livePaid(sub)),
      seats: Math.max(1, await billableSeatCount(ctx, workspace._id)),
    };
  },
});

async function contextFor(ctx: ActionCtx, workspaceId: string): Promise<BillingContext> {
  await requireIdentity(ctx);
  return await ctx.runQuery(internal.workspaceBilling.billingContext, { workspaceId });
}

/** Starts Stripe Checkout for a paid workspace plan, one seat per billable member; returns the page to open. */
export const checkout = action({
  args: { workspaceId: v.string(), planId: vPaidWorkspacePlanId },
  handler: async (ctx, args): Promise<{ url: string }> => {
    await requireIdentity(ctx);
    if (!workspaceStripeReady()) fail("maintenance", "Workspace payments aren't set up on this server yet.");
    const c = await contextFor(ctx, args.workspaceId);
    if (c.stripeLive) fail("invalid_argument", "This workspace already has a subscription. Change its plan instead.");
    const price = workspacePriceId(args.planId);
    if (!price) fail("maintenance", "That plan isn't available to buy yet.");
    const session = await stripePost("checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": price,
      "line_items[0][quantity]": String(c.seats),
      client_reference_id: `ws:${c.workspaceId}`,
      "metadata[workspaceId]": c.workspaceId,
      "subscription_data[metadata][workspaceId]": c.workspaceId,
      ...(c.customerId ? { customer: c.customerId } : { customer_email: c.email }),
      allow_promotion_codes: "true",
      success_url: `${appUrl()}/settings/workspace-billing?checkout=success`,
      cancel_url: `${appUrl()}/settings/workspace-billing?checkout=canceled`,
    });
    return { url: String(session.url) };
  },
});

/** Stripe's billing portal for the workspace's own Stripe customer (card, invoices, cancel). */
export const portal = action({
  args: { workspaceId: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    await requireIdentity(ctx);
    if (!stripeKey()) fail("maintenance", "Payments aren't set up on this server yet.");
    const c = await contextFor(ctx, args.workspaceId);
    if (!c.customerId) fail("invalid_argument", "There's no paid subscription to manage yet.");
    // A portal configuration of its own keeps Personal plans out of a workspace's portal (optional).
    const configuration = process.env.STRIPE_PORTAL_CONFIG_WS;
    const session = await stripePost("billing_portal/sessions", { customer: c.customerId, return_url: `${appUrl()}/settings/workspace-billing`, ...(configuration ? { configuration } : {}) });
    return { url: String(session.url) };
  },
});

/** Team ↔ Business and monthly ↔ yearly on a Stripe subscription (prorated by Stripe). */
export const changePlan = action({
  args: { workspaceId: v.string(), planId: vPaidWorkspacePlanId },
  handler: async (ctx, args): Promise<null> => {
    await requireIdentity(ctx);
    const c = await contextFor(ctx, args.workspaceId);
    if (!c.stripeLive || !c.stripeSubscriptionId) fail("invalid_argument", "There's no subscription to change. Choose a plan to start one.");
    if (c.planId === args.planId) fail("invalid_argument", "The workspace is already on that plan.");
    const price = workspacePriceId(args.planId);
    if (!price) fail("maintenance", "That plan isn't available to buy yet.");
    const itemId = c.itemId ?? (await firstItemId(c.stripeSubscriptionId));
    await stripePost(`subscription_items/${itemId}`, { price, quantity: String(c.seats), proration_behavior: "create_prorations" });
    await ctx.runMutation(internal.workspaceBilling.recordStripeChange, { workspaceId: c.workspaceId as Id<"workspaces">, planId: args.planId, quantity: c.seats, itemId });
    return null;
  },
});

async function firstItemId(subscriptionId: string): Promise<string> {
  const sub = await stripeGet(`subscriptions/${subscriptionId}`);
  const id = subscriptionItems(sub)[0]?.id;
  if (!id) fail("maintenance", "The subscription couldn't be read from Stripe. Try again shortly.");
  return id;
}

async function setCancel(ctx: ActionCtx, workspaceId: string, cancel: boolean): Promise<null> {
  const c = await contextFor(ctx, workspaceId);
  if (!c.paid) fail("invalid_argument", "This workspace is on the Free plan.");
  if (c.provider === "stripe" && c.stripeSubscriptionId) {
    await stripePost(`subscriptions/${c.stripeSubscriptionId}`, { cancel_at_period_end: String(cancel) });
    await ctx.runMutation(internal.workspaceBilling.recordStripeChange, { workspaceId: c.workspaceId as Id<"workspaces">, cancelAtPeriodEnd: cancel });
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

/** Reflects a change Stripe just accepted (its webhook confirms it again moments later). */
export const recordStripeChange = internalMutation({
  args: { workspaceId: v.id("workspaces"), planId: v.optional(vPaidWorkspacePlanId), quantity: v.optional(v.number()), itemId: v.optional(v.string()), cancelAtPeriodEnd: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const sub = await workspaceSubscriptionOf(ctx, args.workspaceId);
    if (!sub || sub.provider !== "stripe") return null;
    await ctx.db.patch(sub._id, {
      ...(args.planId ? { planId: args.planId } : {}),
      ...(args.quantity !== undefined ? { quantity: args.quantity } : {}),
      ...(args.itemId ? { stripeSubscriptionItemId: args.itemId } : {}),
      ...(args.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: args.cancelAtPeriodEnd } : {}),
      updatedAt: Date.now(),
    });
    return null;
  },
});

// ---------------------------------------------------------------------------------------------------
// Seat quantity sync (scheduled by lib/seats.ts seatsChanged)
// ---------------------------------------------------------------------------------------------------

/** Clears the pending mark and says what Stripe's quantity should be now (null: nothing to tell Stripe). */
export const beginSeatSync = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<{ itemId: string; seats: number } | null> => {
    const sub = await workspaceSubscriptionOf(ctx, args.workspaceId);
    if (!sub) return null;
    if (sub.seatSyncScheduledAt !== undefined) await ctx.db.patch(sub._id, { seatSyncScheduledAt: undefined });
    if (!livePaid(sub) || sub.status === "canceled") return null;
    const seats = await billableSeatCount(ctx, args.workspaceId);
    if (sub.provider !== "stripe") {
      if (sub.quantity !== seats) await ctx.db.patch(sub._id, { quantity: seats, updatedAt: Date.now() });
      return null;
    }
    // No item yet (the subscription events haven't arrived): the created event schedules a sync itself.
    if (!sub.stripeSubscriptionItemId) return null;
    return { itemId: sub.stripeSubscriptionItemId, seats: Math.max(1, seats) };
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
 * Sets the Stripe subscription's quantity to the workspace's current billable seats, with proration —
 * only when Stripe's quantity differs, so running it twice (or for two changes at once) is harmless.
 */
export const syncSeatQuantity = internalAction({
  args: { workspaceId: v.id("workspaces"), attempt: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ status: "noop" | "synced" | "unchanged" | "failed"; seats?: number }> => {
    const job = await ctx.runMutation(internal.workspaceBilling.beginSeatSync, { workspaceId: args.workspaceId });
    if (!job) return { status: "noop" };
    try {
      const item = await stripeGet(`subscription_items/${job.itemId}`);
      const changed = Number(item.quantity) !== job.seats;
      if (changed) await stripePost(`subscription_items/${job.itemId}`, { quantity: String(job.seats), proration_behavior: "create_prorations" });
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

/** A workspace being deleted: stop its Stripe subscription renewing (it runs to the end of the paid period). */
export const stopForDeletedWorkspace = internalAction({
  args: { stripeSubscriptionId: v.string() },
  handler: async (_ctx, args) => {
    if (!stripeKey()) return null;
    await stripePost(`subscriptions/${args.stripeSubscriptionId}`, { cancel_at_period_end: "true" });
    return null;
  },
});

/** Called when a workspace is purged: schedules the end of its Stripe subscription, if it has one. */
export async function workspaceClosing(ctx: MutationCtx, workspaceId: Id<"workspaces">): Promise<void> {
  const sub = await workspaceSubscriptionOf(ctx, workspaceId);
  if (!sub || !livePaid(sub)) return;
  await ctx.db.patch(sub._id, { cancelAtPeriodEnd: true, updatedAt: Date.now() });
  if (sub.provider === "stripe" && sub.stripeSubscriptionId && !sub.cancelAtPeriodEnd) {
    await ctx.scheduler.runAfter(0, internal.workspaceBilling.stopForDeletedWorkspace, { stripeSubscriptionId: sub.stripeSubscriptionId });
  }
}

// ---------------------------------------------------------------------------------------------------
// Webhook (routed here by convex/billing.ts applyStripeEvent, which dedupes by event id)
// ---------------------------------------------------------------------------------------------------

/** Stripe subscription status → ours. Unpaid and incomplete subscriptions give no access. */
const WS_STATUS: Record<string, WorkspaceSubscription["status"]> = { active: "active", trialing: "active", past_due: "past_due", unpaid: "canceled", incomplete: "canceled", incomplete_expired: "canceled", canceled: "canceled", paused: "canceled" };

export async function applyWorkspaceStripeEvent(ctx: MutationCtx, row: WorkspaceSubscription, type: string, created: number | undefined, o: Record<string, unknown>): Promise<ApplyResult> {
  const now = Date.now();
  const customer = typeof o.customer === "string" ? o.customer : row.stripeCustomerId;
  if (type === "checkout.session.completed") {
    await ctx.db.patch(row._id, { provider: "stripe", stripeCustomerId: customer, stripeSubscriptionId: subscriptionIdOf(o) ?? row.stripeSubscriptionId, updatedAt: now });
  } else if (type === "customer.subscription.created" || type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
    if (created !== undefined && row.stripeEventCreatedAt !== undefined && created < row.stripeEventCreatedAt) {
      console.warn(JSON.stringify({ event: "billing.webhook_stale", type }));
      return { status: "stale" };
    }
    const items = subscriptionItems(o);
    const item = items.find((i) => workspacePlanForPrice(i.priceId)) ?? items[0];
    const mapped = item ? workspacePlanForPrice(item.priceId) : null;
    if (!mapped) console.warn(JSON.stringify({ event: "billing.webhook_unknown_price", type }));
    const rawStatus = String(o.status);
    const status = type === "customer.subscription.deleted" ? "canceled" : (WS_STATUS[rawStatus] ?? "past_due");
    const period = periodOf(o, item);
    const periodEnd = period.end ?? row.currentPeriodEnd;
    const planId: WorkspacePlanId = mapped ?? row.planId;
    const trialEnd = rawStatus === "trialing" && typeof o.trial_end === "number" ? o.trial_end * 1000 : undefined;
    await ctx.db.patch(row._id, {
      provider: "stripe",
      planId,
      status,
      quantity: item?.quantity ?? row.quantity,
      stripeSubscriptionItemId: item?.id ?? row.stripeSubscriptionItemId,
      currentPeriodStart: period.start ?? row.currentPeriodStart,
      currentPeriodEnd: status === "canceled" ? Math.min(periodEnd ?? now, now) : periodEnd,
      cancelAtPeriodEnd: Boolean(o.cancel_at_period_end),
      trialEndsAt: trialEnd,
      stripeCustomerId: customer,
      stripeSubscriptionId: typeof o.id === "string" ? o.id : row.stripeSubscriptionId,
      paidSince: row.paidSince && livePaid(row, now) && PLAN_CATALOG[row.planId].tier === PLAN_CATALOG[planId].tier ? row.paidSince : status === "canceled" ? row.paidSince : now,
      canceledAt: status === "canceled" ? (row.canceledAt ?? now) : undefined,
      stripeEventCreatedAt: created ?? row.stripeEventCreatedAt,
      updatedAt: now,
    });
    // Members may have joined or left while Checkout was open: bring Stripe's quantity to the current count.
    if (status !== "canceled" && isPaidPlan(planId) && item?.quantity !== undefined && item.quantity !== Math.max(1, await billableSeatCount(ctx, row.workspaceId))) {
      await seatsChanged(ctx, row.workspaceId);
    }
  } else if (type === "invoice.paid" || type === "invoice.payment_failed") {
    const ref = typeof o.id === "string" ? o.id : undefined;
    const existing = ref
      ? await ctx.db
          .query("payments")
          .withIndex("by_provider_ref", (q) => q.eq("providerRef", ref))
          .unique()
      : null;
    const paid = type === "invoice.paid";
    const amount = Number(paid ? o.amount_paid : o.amount_due) || 0;
    if (isPaidPlan(row.planId) && amount > 0) {
      const planId = row.planId as PaidWorkspacePlanId;
      if (existing) await ctx.db.patch(existing._id, { status: paid ? "paid" : "failed" });
      else {
        await insertPayment(ctx, { kind: "workspace", workspaceId: row.workspaceId }, {
          amountCents: amount,
          currency: String(o.currency ?? "usd"),
          plan: PLAN_CATALOG[planId].tier as "team" | "business",
          planId,
          quantity: row.quantity,
          interval: intervalOf(planId),
          status: paid ? "paid" : "failed",
          provider: "stripe",
          providerRef: ref,
          createdAt: now,
        });
      }
    }
    if (!paid) await ctx.db.patch(row._id, { status: "past_due", updatedAt: now });
  } else if (type === "charge.succeeded") {
    const label = cardLabel(o);
    if (label && label !== row.paymentMethod) await ctx.db.patch(row._id, { paymentMethod: label, updatedAt: now });
  } else if (type === "charge.refunded") {
    await markInvoiceRefunded(ctx, o);
  }
  return { status: "applied" };
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
    if (!isWorkspaceSubscription(s) || !isPaidPlan(s.planId) || s.provider === "stripe" || s.currentPeriodEnd === undefined || s.currentPeriodEnd > now) continue;
    if (s.provider === "test" && !s.cancelAtPeriodEnd) {
      await ctx.db.patch(s._id, { currentPeriodStart: now, currentPeriodEnd: now + periodMs(s.planId as PaidWorkspacePlanId), updatedAt: now });
      continue;
    }
    await ctx.db.patch(s._id, { planId: "workspace_free", status: "canceled", quantity: undefined, canceledAt: now, cancelAtPeriodEnd: false, updatedAt: now });
    changed++;
  }
  return changed;
}
