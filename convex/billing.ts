// Personal billing for the signed-in person: their Personal plan, personal usage and history; upgrading
// through Stripe Checkout; managing a subscription in Stripe's billing portal; and the Stripe webhook that
// keeps plans in step (each event applied once; stale subscription events ignored). The webhook serves
// workspace plans too: events for a workspace's subscription go to convex/workspaceBilling.ts and never
// touch a Personal plan (and the other way round).
// Stripe is optional: without STRIPE_* settings, upgrades explain that payments aren't set up, and
// development builds offer test purchases instead (never in production).
import { v } from "convex/values";
import { action, httpAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requireIdentity, requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";
import { ensureSubscription, ensureWorkspaceSubscription, failedInvoiceMarksPastDue, insertPayment, invoicePaymentStatus, isPersonalPayment, markInvoiceRefunded, isPersonalSubscription, isWorkspaceSubscription, subscriptionOf, type PersonalSubscription } from "./lib/billing";
import { personalAiUsage, personalEntitlements, storageUsage } from "./lib/entitlements";
import { DAY_MS, PLAN_CATALOG, PLAN_ORDER, isPaidPlan, personalPlanId, type BillingInterval, type PersonalTier } from "./lib/plans";
import { timingSafeEqualHex } from "./lib/crypto";
import { listUserSessions } from "./lib/authStore";
import { appUrl, stripeKey, stripePost, subscriptionIdOf, testPurchasesAllowed } from "./lib/stripe";
import { applyWorkspaceStripeEvent, settleExpiredWorkspacePlans } from "./workspaceBilling";

const vPaidPlan = v.union(v.literal("basic"), v.literal("pro"));
const vInterval = v.union(v.literal("month"), v.literal("year"));

type PaidTier = Exclude<PersonalTier, "free">;
const isPaidTier = (t: PersonalTier): t is PaidTier => isPaidPlan(personalPlanId(t, "month"));
/** The Personal tiers that are paid for (from the catalog). */
const PAID_TIERS = PLAN_ORDER.filter(isPaidTier);
/** Whether a billing row stores a paid Personal plan (whether it's still in force is the entitlements' job). */
const onPaidPlan = (s: Pick<PersonalSubscription, "plan" | "interval">) => isPaidPlan(personalPlanId(s.plan, s.interval));

/** Stripe price ids for each paid plan and interval (Stripe dashboard → Products). */
function priceIdFor(plan: PaidTier, interval: BillingInterval): string | undefined {
  return process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${interval === "month" ? "MONTH" : "YEAR"}`];
}
function planForPrice(priceId: string): { plan: PaidTier; interval: BillingInterval } | null {
  for (const plan of PAID_TIERS) for (const interval of ["month", "year"] as const) if (priceIdFor(plan, interval) === priceId) return { plan, interval };
  return null;
}
const stripeReady = () => Boolean(stripeKey() && priceIdFor("basic", "month") && priceIdFor("pro", "month"));

// ---------------------------------------------------------------------------------------------------
// The person's own billing
// ---------------------------------------------------------------------------------------------------

/** Personal plan, what it includes, personal storage used, AI use in Personal this month and payment history. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx, { allowOverDeviceLimit: true });
    const sub = await subscriptionOf(ctx, profile._id);
    const entitlements = await personalEntitlements(ctx, profile._id);
    // Personal payments only (workspace payments carry a workspace, not a person).
    const payments = (
      await ctx.db
        .query("payments")
        .withIndex("by_profile_created", (q) => q.eq("profileId", profile._id))
        .order("desc")
        .take(24)
    ).filter(isPersonalPayment);
    const month = new Date().toISOString().slice(0, 7);
    const usage = await personalAiUsage(ctx, profile._id, `${month}-01`);
    const storage = await storageUsage(ctx, { kind: "personal", profileId: profile._id });
    return {
      entitlements,
      subscription: sub
        ? {
            planId: personalPlanId(sub.plan, sub.interval),
            plan: sub.plan,
            interval: sub.interval ?? null,
            status: sub.status,
            provider: sub.provider,
            currentPeriodEnd: sub.currentPeriodEnd ?? null,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
            aiGrant: Boolean(sub.aiGrant),
            aiGrantUntil: sub.aiGrantUntil ?? null,
          }
        : null,
      /** Personal storage only: team workspaces have their own. */
      storageUsedBytes: storage.usedBytes,
      storageLimitBytes: storage.limitBytes,
      devicesActive: (await listUserSessions(ctx, profile.authSubject)).length,
      aiRequestsThisMonth: usage.reduce((n, u) => n + u.count, 0),
      payments: payments.map((p) => ({ id: p._id, amountCents: p.amountCents, currency: p.currency, plan: p.plan, interval: p.interval, status: p.status, createdAt: p.createdAt })),
      checkoutAvailable: stripeReady(),
      testPurchases: testPurchasesAllowed(),
    };
  },
});

/** Development only: switch to a paid plan without paying (records a test payment). */
export const testPurchase = mutation({
  args: { plan: vPaidPlan, interval: vInterval },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx, { allowOverDeviceLimit: true });
    if (!testPurchasesAllowed()) fail("forbidden", "Test purchases are only available in development.");
    const sub = await ensureSubscription(ctx, profile._id);
    const now = Date.now();
    await ctx.db.patch(sub._id, {
      plan: args.plan,
      interval: args.interval,
      status: "active",
      provider: "test",
      currentPeriodEnd: now + (args.interval === "year" ? 365 : 30) * DAY_MS,
      cancelAtPeriodEnd: false,
      paidSince: sub.plan === args.plan && sub.paidSince ? sub.paidSince : now,
      canceledAt: undefined,
      // Choosing a plan ends a running trial: they get what they chose from now on.
      trialEndsAt: sub.trialEndsAt && sub.trialEndsAt > now ? now : sub.trialEndsAt,
      updatedAt: now,
    });
    const price = PLAN_CATALOG[personalPlanId(args.plan, args.interval)].priceCents;
    await insertPayment(ctx, { kind: "user", profileId: profile._id }, { amountCents: price, currency: "usd", plan: args.plan, interval: args.interval, status: "paid", provider: "test", createdAt: now });
    return null;
  },
});

/** Cancel at the end of the paid period (test and admin-set plans; Stripe plans use the billing portal). */
export const cancelPlan = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const sub = await subscriptionOf(ctx, profile._id);
    if (!sub || !onPaidPlan(sub)) fail("invalid_argument", "You're on the Free plan.");
    if (sub.provider === "stripe") fail("invalid_argument", "Manage your subscription in the billing portal.");
    await ctx.db.patch(sub._id, { cancelAtPeriodEnd: true, updatedAt: Date.now() });
    return null;
  },
});

export const resumePlan = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const sub = await subscriptionOf(ctx, profile._id);
    if (!sub || !onPaidPlan(sub) || sub.provider === "stripe") fail("invalid_argument", "Nothing to resume.");
    await ctx.db.patch(sub._id, { cancelAtPeriodEnd: false, updatedAt: Date.now() });
    return null;
  },
});

/**
 * Plans set to cancel at period end, and plans whose period has ended: Personal plans back to Free,
 * workspace plans back to Workspace Free (nothing is deleted). Stripe plans are ended by Stripe's own
 * events. Hourly.
 */
export const settleExpiredPlans = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let changed = 0;
    for (const plan of PAID_TIERS) {
      const subs = await ctx.db
        .query("subscriptions")
        .withIndex("by_plan", (q) => q.eq("plan", plan))
        .take(2000);
      for (const s of subs) {
        if (s.provider === "stripe" || s.currentPeriodEnd === undefined || s.currentPeriodEnd > now) continue;
        if (s.provider === "test" && !s.cancelAtPeriodEnd) {
          // Test plans renew by themselves (so development isn't interrupted).
          await ctx.db.patch(s._id, { currentPeriodEnd: now + (s.interval === "year" ? 365 : 30) * DAY_MS, updatedAt: now });
          continue;
        }
        await ctx.db.patch(s._id, { plan: "free", interval: undefined, status: "canceled", canceledAt: now, cancelAtPeriodEnd: false, updatedAt: now });
        changed++;
      }
    }
    const workspaces = await settleExpiredWorkspacePlans(ctx, now);
    return { changed: changed + workspaces };
  },
});

// ---------------------------------------------------------------------------------------------------
// Stripe: Checkout, billing portal, webhook
// ---------------------------------------------------------------------------------------------------

export const checkoutContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx, { allowOverDeviceLimit: true });
    const sub = await subscriptionOf(ctx, profile._id);
    return { profileId: profile._id as string, email: profile.email, customerId: sub?.stripeCustomerId ?? null, provider: sub?.provider ?? "none" };
  },
});

/** Starts Stripe Checkout for a Personal plan; returns the page to send the person to. */
export const checkout = action({
  args: { plan: vPaidPlan, interval: vInterval },
  handler: async (ctx, args): Promise<{ url: string }> => {
    await requireIdentity(ctx);
    if (!stripeReady()) fail("maintenance", "Payments aren't set up on this server yet.");
    const price = priceIdFor(args.plan, args.interval);
    if (!price) fail("maintenance", "That plan isn't available to buy yet.");
    const me: { profileId: string; email: string; customerId: string | null } = await ctx.runQuery(internal.billing.checkoutContext, {});
    const session = await stripePost("checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      client_reference_id: me.profileId,
      "subscription_data[metadata][profileId]": me.profileId,
      ...(me.customerId ? { customer: me.customerId } : { customer_email: me.email }),
      allow_promotion_codes: "true",
      success_url: `${appUrl()}/settings/billing?checkout=success`,
      cancel_url: `${appUrl()}/settings/billing?checkout=canceled`,
    });
    return { url: String(session.url) };
  },
});

/** Stripe's billing portal (change plan, update card, cancel, invoices). */
export const portal = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    await requireIdentity(ctx);
    if (!stripeKey()) fail("maintenance", "Payments aren't set up on this server yet.");
    const me: { customerId: string | null } = await ctx.runQuery(internal.billing.checkoutContext, {});
    if (!me.customerId) fail("invalid_argument", "There's no paid subscription to manage yet.");
    const session = await stripePost("billing_portal/sessions", { customer: me.customerId, return_url: `${appUrl()}/settings/billing` });
    return { url: String(session.url) };
  },
});

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Verifies a Stripe-Signature header (HMAC-SHA256 of "timestamp.body", within 5 minutes). */
export async function verifyStripeSignature(body: string, header: string | null, secret: string, now = Date.now()): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  const signatures = header
    .split(",")
    .filter((kv) => kv.startsWith("v1="))
    .map((kv) => kv.slice(3));
  if (!t || !signatures.length || Math.abs(now / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  return signatures.some((s) => s.length === expected.length && timingSafeEqualHex(s, expected));
}

/** POST /webhooks/stripe: signature-checked, then applied (once per event id). */
export const stripeWebhook = httpAction(async (ctx, request) => {
  const body = await request.text();
  if (!(await verifyStripeSignature(body, request.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET ?? ""))) {
    return new Response("Invalid signature", { status: 400 });
  }
  const event = JSON.parse(body) as { id?: string; type: string; created?: number; data: { object: Record<string, unknown> } };
  // Every Stripe event has an id; without one it couldn't be applied exactly once.
  if (typeof event.id !== "string" || !event.id) return new Response("Missing event id", { status: 400 });
  await ctx.runMutation(internal.billing.applyStripeEvent, {
    eventId: event.id,
    created: typeof event.created === "number" ? event.created : undefined,
    type: event.type,
    object: event.data.object,
  });
  return new Response(null, { status: 200 });
});

/** A checkout or subscription for a workspace names it as `ws:<id>` (client_reference_id) or in metadata. */
function workspaceRefOf(o: Record<string, unknown>): string | null {
  const meta = (o.metadata as Record<string, string> | undefined)?.workspaceId;
  if (typeof meta === "string" && meta) return meta;
  const ref = typeof o.client_reference_id === "string" ? o.client_reference_id : "";
  return ref.startsWith("ws:") ? ref.slice(3) : null;
}

/**
 * The billing row an event is about: by the Stripe subscription id we stored, else by what our Checkout
 * put on it (a workspace's `ws:<id>` / metadata.workspaceId, or a person's profile id), else by customer.
 * Workspace and Personal subscriptions have separate Stripe customers, so a customer names one row.
 */
async function findStripeRow(ctx: MutationCtx, o: Record<string, unknown>): Promise<Doc<"subscriptions"> | null> {
  const subId = subscriptionIdOf(o);
  if (subId) {
    const bySub = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_subscription", (q) => q.eq("stripeSubscriptionId", subId))
      .unique();
    if (bySub) return bySub;
  }
  const workspaceRef = workspaceRefOf(o);
  if (workspaceRef) {
    const workspaceId = ctx.db.normalizeId("workspaces", workspaceRef);
    const workspace = workspaceId ? await ctx.db.get(workspaceId) : null;
    return workspace ? await ensureWorkspaceSubscription(ctx, workspace._id) : null;
  }
  const meta = (o.metadata as Record<string, string> | undefined)?.profileId ?? (typeof o.client_reference_id === "string" ? o.client_reference_id : null);
  const profileId = meta ? ctx.db.normalizeId("profiles", meta) : null;
  if (profileId) return await ensureSubscription(ctx, profileId);
  if (typeof o.customer === "string") {
    const customer = o.customer;
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_customer", (q) => q.eq("stripeCustomerId", customer))
      .first();
  }
  return null;
}

const STATUS: Record<string, Doc<"subscriptions">["status"]> = { active: "active", trialing: "active", past_due: "past_due", unpaid: "past_due", incomplete: "past_due", canceled: "canceled", incomplete_expired: "canceled", paused: "canceled" };

export type ApplyResult = { status: "applied" | "duplicate" | "stale" | "unmatched" };

/**
 * Applies one Stripe event to the matching plan (a person's or a workspace's). Idempotent: an event id is
 * applied once (Stripe redelivers events), payments are keyed by invoice, and a subscription event older
 * than the last one applied to that subscription is ignored (Stripe doesn't promise delivery order).
 * Checking and recording the event id happen in this one transaction, so two deliveries of the same event
 * can't both apply. Access is only ever granted here, never because a browser came back from Checkout.
 */
export const applyStripeEvent = internalMutation({
  args: { eventId: v.optional(v.string()), created: v.optional(v.number()), type: v.string(), object: v.any() },
  handler: async (ctx, args): Promise<ApplyResult> => {
    const eventId = args.eventId;
    if (eventId) {
      const seen = await ctx.db
        .query("billingEvents")
        .withIndex("by_event_id", (q) => q.eq("eventId", eventId))
        .unique();
      if (seen) return { status: "duplicate" };
    }
    const result = await applyEvent(ctx, args.type, args.created, args.object as Record<string, unknown>);
    if (eventId) await ctx.db.insert("billingEvents", { eventId, type: args.type.slice(0, 100), created: args.created, processedAt: Date.now() });
    return result;
  },
});

async function applyEvent(ctx: MutationCtx, type: string, created: number | undefined, o: Record<string, unknown>): Promise<ApplyResult> {
  const row = await findStripeRow(ctx, o);
  if (row && isWorkspaceSubscription(row)) return await applyWorkspaceStripeEvent(ctx, row, type, created, o);
  if (!row || !isPersonalSubscription(row)) {
    console.warn(JSON.stringify({ event: "billing.webhook_unmatched", type }));
    return { status: "unmatched" };
  }
  const now = Date.now();
  if (type === "checkout.session.completed") {
    await ctx.db.patch(row._id, {
      provider: "stripe",
      stripeCustomerId: typeof o.customer === "string" ? o.customer : row.stripeCustomerId,
      stripeSubscriptionId: subscriptionIdOf(o) ?? row.stripeSubscriptionId,
      updatedAt: now,
    });
  } else if (type === "customer.subscription.created" || type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
    if (created !== undefined && row.stripeEventCreatedAt !== undefined && created < row.stripeEventCreatedAt) {
      console.warn(JSON.stringify({ event: "billing.webhook_stale", type }));
      return { status: "stale" };
    }
    const items = (o.items as { data?: { price?: { id?: string } }[] } | undefined)?.data ?? [];
    const mapped = items.map((i) => planForPrice(i.price?.id ?? "")).find(Boolean) ?? null;
    const status = type === "customer.subscription.deleted" ? "canceled" : (STATUS[String(o.status)] ?? "past_due");
    const periodEnd = typeof o.current_period_end === "number" ? o.current_period_end * 1000 : row.currentPeriodEnd;
    const plan: PersonalTier = mapped?.plan ?? row.plan;
    await ctx.db.patch(row._id, {
      provider: "stripe",
      plan,
      interval: mapped?.interval ?? row.interval,
      status,
      currentPeriodEnd: status === "canceled" ? Math.min(periodEnd ?? now, now) : periodEnd,
      cancelAtPeriodEnd: Boolean(o.cancel_at_period_end),
      stripeCustomerId: typeof o.customer === "string" ? o.customer : row.stripeCustomerId,
      stripeSubscriptionId: typeof o.id === "string" ? o.id : row.stripeSubscriptionId,
      paidSince: row.paidSince && row.plan === plan ? row.paidSince : status === "active" ? now : row.paidSince,
      canceledAt: status === "canceled" ? now : undefined,
      trialEndsAt: status === "active" && row.trialEndsAt && row.trialEndsAt > now ? now : row.trialEndsAt,
      stripeEventCreatedAt: created ?? row.stripeEventCreatedAt,
      updatedAt: now,
    });
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
    const tier = row.plan;
    // Payments are keyed by invoice id (a redelivered or late event updates the same row, never adds one).
    if (isPaidTier(tier) && row.interval && amount > 0 && ref) {
      const status = invoicePaymentStatus(existing, paid);
      if (existing) {
        if (existing.status !== status) await ctx.db.patch(existing._id, { status });
      } else await insertPayment(ctx, { kind: "user", profileId: row.profileId }, { amountCents: amount, currency: String(o.currency ?? "usd"), plan: tier, interval: row.interval, status, provider: "stripe", providerRef: ref, createdAt: now });
    }
    if (!paid && failedInvoiceMarksPastDue(existing, created, row)) await ctx.db.patch(row._id, { status: "past_due", updatedAt: now });
  } else if (type === "charge.refunded") {
    await markInvoiceRefunded(ctx, o);
  }
  return { status: "applied" };
}

