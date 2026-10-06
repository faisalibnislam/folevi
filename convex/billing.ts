// Personal billing and AI credits for the signed-in person: their Personal plan, storage and credits;
// upgrading through Polar Checkout; buying credit packs; managing a subscription in Polar's customer
// portal; and the Polar webhook that keeps plans, payments and credits in step (each delivery applied once;
// stale subscription events ignored). The webhook serves workspace plans too: events for a workspace's
// subscription go to convex/workspaceBilling.ts and never touch a Personal plan (and the other way round).
// Polar is optional: without POLAR_* settings, upgrades explain that payments aren't set up, and
// development builds offer test purchases instead (never in production). docs/BILLING.md.
import { v } from "convex/values";
import { action, httpAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireDocument, requireIdentity, requireProfile, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import {
  ensureSubscription,
  ensureWorkspaceSubscription,
  insertPayment,
  isPersonalPayment,
  isPersonalSubscription,
  isWorkspaceSubscription,
  periodEndFrom,
  storedPersonalPlanId,
  subscriptionOf,
  type PersonalSubscription,
} from "./lib/billing";
import { freePool, personalEntitlements, storageUsage } from "./lib/entitlements";
import { addCredits, creditBalance, creditSummary, personalAccount, refundPackCredits, seatAccount, type CreditAccount } from "./lib/credits";
import { CREDIT_PACKS, PLAN_CATALOG, isPaidPlan, personalPlanId, type PersonalTier } from "./lib/plans";
import { listUserSessions } from "./lib/authStore";
import { scopeOfRow, vScopeArg, type Scope } from "./lib/scope";
import {
  createCheckout,
  creditsCheckoutReady,
  customerPortal,
  externalCustomerIdOf,
  metadataOf,
  ms,
  num,
  personalCheckoutReady,
  polarPatch,
  productFor,
  productId,
  str,
  testPurchasesAllowed,
  verifyPolarWebhook,
  type PaidPersonalPlanId,
  type ProductIds,
} from "./lib/polar";
import { productIds } from "./lib/billingProducts";
import { vCreditPackId, vInterval, vPaidPersonalTier } from "./lib/validators";
import { applyWorkspaceOrder, applyWorkspaceSubscriptionEvent, settleExpiredWorkspacePlans } from "./workspaceBilling";

/** Whether a billing row stores a paid Personal plan (whether it's still in force is the entitlements' job). */
const onPaidPlan = (s: PersonalSubscription) => isPaidPlan(storedPersonalPlanId(s));
/** A Polar subscription that hasn't ended. */
const polarLive = (s: PersonalSubscription | null) => Boolean(s && s.provider === "polar" && s.polarSubscriptionId && onPaidPlan(s) && s.status !== "canceled");

// ---------------------------------------------------------------------------------------------------
// The person's own billing
// ---------------------------------------------------------------------------------------------------

/**
 * Personal plan, what it includes, storage (the free pool on Free), AI credits in Personal this period,
 * and payment history (Personal plans and credits bought).
 */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx, { allowOverDeviceLimit: true });
    const sub = await subscriptionOf(ctx, profile._id);
    const entitlements = await personalEntitlements(ctx, profile._id);
    const payments = (
      await ctx.db
        .query("payments")
        .withIndex("by_profile_created", (q) => q.eq("profileId", profile._id))
        .order("desc")
        .take(24)
    ).filter(isPersonalPayment);
    const storage = await storageUsage(ctx, { kind: "personal", profileId: profile._id });
    const pool = storage.rule === "shared_free" ? await freePool(ctx, profile._id) : null;
    const account = await personalAccount(ctx, profile._id);
    const credits = await creditBalance(ctx, account);
    const ids = await productIds(ctx);
    return {
      entitlements,
      subscription: sub
        ? {
            planId: storedPersonalPlanId(sub),
            plan: sub.plan,
            interval: sub.interval ?? null,
            status: sub.status,
            provider: sub.provider,
            currentPeriodEnd: sub.currentPeriodEnd ?? null,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
          }
        : null,
      /** Personal storage (on Free: the pool shared with the free workspaces they own). */
      storageUsedBytes: storage.usedBytes,
      storageLimitBytes: storage.limitBytes,
      storageRule: storage.rule,
      /** On Free: how many free workspaces share the pool. */
      poolWorkspaces: pool?.workspaces ?? 0,
      devicesActive: (await listUserSessions(ctx, profile.authSubject)).length,
      /** AI credits in Personal (also used in free workspaces and as a guest). */
      credits: { ...credits, trialing: account.trialing, canBuy: account.canBuy, aiIncluded: entitlements.ai },
      /** Kept for older clients: AI requests this period. */
      aiRequestsThisMonth: await requestsSince(ctx, profile._id, credits.periodStart),
      payments: payments.map((p) => ({ id: p._id, amountCents: p.amountCents, currency: p.currency, plan: p.plan, interval: p.interval ?? null, credits: p.credits ?? null, status: p.status, createdAt: p.createdAt })),
      checkoutAvailable: personalCheckoutReady(ids),
      creditsCheckoutAvailable: creditsCheckoutReady(ids),
      testPurchases: testPurchasesAllowed(),
    };
  },
});

async function requestsSince(ctx: QueryCtx, profileId: Id<"profiles">, since: number): Promise<number> {
  const rows = await ctx.db
    .query("aiUsage")
    .withIndex("by_profile_day", (q) => q.eq("profileId", profileId).gte("day", new Date(since).toISOString().slice(0, 10)))
    .collect();
  return rows.filter((r) => r.scope === "personal").reduce((n, r) => n + r.count, 0);
}

/**
 * The AI credits that apply where the person is working: `scope` (or, with `documentId`, that page's
 * scope). For the meter in the AI panels; the server checks again on every request.
 */
export const credits = query({
  args: { scope: vScopeArg, documentId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    let scope: Scope;
    if (args.documentId) scope = scopeOfRow((await requireDocument(ctx, profile, args.documentId, "read")).doc);
    else scope = (await resolveScope(ctx, profile, args.scope)).scope;
    return await creditSummary(ctx, profile, scope);
  },
});

/**
 * Every credit account the person has: Personal, and their seat in each paid workspace they're a member
 * of. For Settings → Plan & billing (where credits are bought).
 */
export const creditAccounts = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx, { allowOverDeviceLimit: true });
    const personal = await personalAccount(ctx, profile._id);
    const e = await personalEntitlements(ctx, profile._id);
    const out: Array<{ kind: "personal" | "seat"; workspaceId: string | null; name: string; plan: string; aiIncluded: boolean; canBuy: boolean; trialing: boolean } & Awaited<ReturnType<typeof creditBalance>>> = [{ kind: "personal", workspaceId: null, name: "Personal", plan: personal.planLabel, aiIncluded: e.ai, canBuy: personal.canBuy, trialing: personal.trialing, ...(await creditBalance(ctx, personal)) }];
    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .collect();
    for (const m of memberships) {
      const w = await ctx.db.get(m.workspaceId);
      if (!w || w.status === "deleting" || w.deletionScheduledFor) continue;
      const seat = await seatAccount(ctx, profile._id, w._id);
      if (!seat) continue;
      out.push({ kind: "seat", workspaceId: w.publicId, name: w.name, plan: seat.planLabel, aiIncluded: true, canBuy: seat.canBuy, trialing: false, ...(await creditBalance(ctx, seat)) });
    }
    return { accounts: out, checkoutAvailable: creditsCheckoutReady(await productIds(ctx)), testPurchases: testPurchasesAllowed() };
  },
});

/** Development only: switch to a paid plan without paying (records a test payment). */
export const testPurchase = mutation({
  args: { plan: vPaidPersonalTier, interval: vInterval },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx, { allowOverDeviceLimit: true });
    if (!testPurchasesAllowed()) fail("forbidden", "Test purchases are only available in development.");
    const sub = await ensureSubscription(ctx, profile._id);
    if (polarLive(sub)) fail("invalid_argument", "This plan is billed through Polar. Change it in the billing portal.");
    const now = Date.now();
    await ctx.db.patch(sub._id, {
      plan: args.plan,
      interval: args.interval,
      status: "active",
      provider: "test",
      currentPeriodStart: now,
      currentPeriodEnd: periodEndFrom(now, args.interval),
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

/** The credit account credits for `scope` go to: Personal, or the caller's seat in a paid workspace. */
async function buyableAccount(ctx: Parameters<typeof resolveScope>[0], profile: Doc<"profiles">, scope: { kind: "personal" } | { kind: "workspace"; workspaceId: string }): Promise<CreditAccount> {
  if (scope.kind === "personal") {
    const account = await personalAccount(ctx, profile._id);
    if (!account.canBuy) fail("invalid_argument", account.trialing ? "Credit packs are for Pro and Pro AI. Choose a plan first." : "Credit packs are for Pro and Pro AI.");
    return account;
  }
  const resolved = (await resolveScope(ctx, profile, scope)).scope;
  if (resolved.kind !== "workspace") fail("not_found", "Workspace not found.");
  const seat = await seatAccount(ctx, profile._id, resolved.workspaceId);
  if (!seat) fail("invalid_argument", "AI in this workspace uses your personal credits (or isn't included). Buy credits for your Personal instead.");
  if (!seat.canBuy) fail("invalid_argument", "Credit packs are for Pro and Pro AI.");
  return seat;
}

/** Development only: add a credit pack without paying (records a test payment). */
export const testBuyCredits = mutation({
  args: { pack: vCreditPackId, scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!testPurchasesAllowed()) fail("forbidden", "Test purchases are only available in development.");
    const account = await buyableAccount(ctx, profile, args.scope);
    const pack = CREDIT_PACKS[args.pack];
    const now = Date.now();
    const paymentId = await insertPayment(ctx, { kind: "user", profileId: profile._id }, { amountCents: pack.priceCents, currency: "usd", plan: "credits", credits: pack.credits, creditsWorkspaceId: account.workspaceId, status: "paid", provider: "test", createdAt: now });
    await addCredits(ctx, account, pack.credits, "test", { paymentId, now });
    return null;
  },
});

/** Cancel at the end of the paid period (test and admin-set plans; Polar plans use the customer portal). */
export const cancelPlan = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const sub = await subscriptionOf(ctx, profile._id);
    if (!sub || !onPaidPlan(sub)) fail("invalid_argument", "You're on the Free plan.");
    if (sub.provider === "polar") fail("invalid_argument", "Manage your subscription in the billing portal.");
    await ctx.db.patch(sub._id, { cancelAtPeriodEnd: true, updatedAt: Date.now() });
    return null;
  },
});

export const resumePlan = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const sub = await subscriptionOf(ctx, profile._id);
    if (!sub || !onPaidPlan(sub) || sub.provider === "polar") fail("invalid_argument", "Nothing to resume.");
    await ctx.db.patch(sub._id, { cancelAtPeriodEnd: false, updatedAt: Date.now() });
    return null;
  },
});

/** Providers whose Personal plans this job ends (Polar plans are ended by Polar's own events). */
const SETTLED_PROVIDERS = ["none", "manual", "test", "stripe"] as const;
const SETTLE_BATCH = 200;

/**
 * Plans set to cancel at period end, and plans whose period has ended: Personal plans back to Free,
 * workspace plans back to Workspace Free (nothing is deleted). Polar plans are ended by Polar's own
 * events. Hourly.
 *
 * Personal plans are read straight from the expired part of the index (paid tier, non-Polar provider,
 * period ended), so Polar rows and plans still running are never read, and every row read leaves that
 * range once handled (moved to Free, or a test plan renewed). A full batch reschedules the job.
 */
export const settleExpiredPlans = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let changed = 0;
    let more = false;
    for (const plan of ["core", "pro", "pro_ai"] as const) {
      for (const provider of SETTLED_PROVIDERS) {
        const subs = await ctx.db
          .query("subscriptions")
          // A lower bound of 0 leaves out rows without a period end (they sort first).
          .withIndex("by_plan_provider_period", (q) => q.eq("plan", plan).eq("provider", provider).gte("currentPeriodEnd", 0).lte("currentPeriodEnd", now))
          .take(SETTLE_BATCH);
        if (subs.length === SETTLE_BATCH) more = true;
        for (const s of subs) {
          if (!isPersonalSubscription(s) || !onPaidPlan(s)) continue;
          if (s.provider === "polar" || s.currentPeriodEnd === undefined || s.currentPeriodEnd > now) continue;
          if (s.provider === "test" && !s.cancelAtPeriodEnd) {
            // Test plans renew by themselves (so development isn't interrupted).
            await ctx.db.patch(s._id, { currentPeriodStart: now, currentPeriodEnd: periodEndFrom(now, s.interval), updatedAt: now });
            continue;
          }
          await ctx.db.patch(s._id, { plan: "free", interval: undefined, status: "canceled", canceledAt: now, cancelAtPeriodEnd: false, updatedAt: now });
          changed++;
        }
      }
    }
    const workspaces = await settleExpiredWorkspacePlans(ctx, now);
    if (more || workspaces.more) await ctx.scheduler.runAfter(0, internal.billing.settleExpiredPlans, {});
    return { changed: changed + workspaces.changed };
  },
});

// ---------------------------------------------------------------------------------------------------
// Polar: checkout, credit packs, customer portal
// ---------------------------------------------------------------------------------------------------

export const checkoutContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx, { allowOverDeviceLimit: true });
    const sub = await subscriptionOf(ctx, profile._id);
    const hasPolarCustomer =
      Boolean(sub?.polarCustomerId) ||
      (
        await ctx.db
          .query("payments")
          .withIndex("by_profile_created", (q) => q.eq("profileId", profile._id))
          .collect()
      ).some((p) => p.provider === "polar");
    return {
      profileId: profile._id as string,
      email: profile.email,
      live: polarLive(sub),
      polarSubscriptionId: sub?.polarSubscriptionId ?? null,
      planId: sub ? storedPersonalPlanId(sub) : ("personal_free" as const),
      hasPolarCustomer,
    };
  },
});

/**
 * Starts Polar Checkout for a Personal plan and returns the page to send the person to. With a Polar
 * subscription already running, it's switched to the chosen plan instead (Polar prorates) and no page is
 * returned. Access changes only when Polar's webhook confirms it.
 */
export const checkout = action({
  args: { plan: vPaidPersonalTier, interval: vInterval },
  handler: async (ctx, args): Promise<{ url: string | null }> => {
    await requireIdentity(ctx);
    const planId = personalPlanId(args.plan, args.interval) as PaidPersonalPlanId;
    const me: { profileId: string; email: string; live: boolean; polarSubscriptionId: string | null; planId: string } = await ctx.runQuery(internal.billing.checkoutContext, {});
    const ids: ProductIds = await ctx.runQuery(internal.billingSetup.productIds, {});
    if (!personalCheckoutReady(ids)) fail("maintenance", "Payments aren't set up on this server yet.");
    const product = productId(ids, planId)!;
    if (me.live && me.polarSubscriptionId) {
      if (me.planId === planId) fail("invalid_argument", "You're already on that plan.");
      await polarPatch(`subscriptions/${me.polarSubscriptionId}`, { product_id: product, proration_behavior: "prorate" });
      return { url: null };
    }
    const url = await createCheckout({ product, externalCustomerId: me.profileId, email: me.email, metadata: { kind: "personal", profileId: me.profileId }, successPath: "/settings/billing?checkout=success", returnPath: "/settings/billing" });
    return { url };
  },
});

/**
 * Starts Polar Checkout for a credit pack, for the caller's Personal or their own seat in a paid
 * workspace. The credits are added when Polar's webhook says the order is paid.
 */
export const buyCredits = action({
  args: { pack: vCreditPackId, scope: vScopeArg },
  handler: async (ctx, args): Promise<{ url: string }> => {
    await requireIdentity(ctx);
    const target: { profileId: string; email: string; workspaceId: string | null } = await ctx.runQuery(internal.billing.creditsCheckoutContext, { scope: args.scope });
    const ids: ProductIds = await ctx.runQuery(internal.billingSetup.productIds, {});
    if (!creditsCheckoutReady(ids)) fail("maintenance", "Payments aren't set up on this server yet.");
    const metadata: Record<string, string> = { kind: "credits", profileId: target.profileId, pack: args.pack, ...(target.workspaceId ? { workspaceId: target.workspaceId } : {}) };
    const url = await createCheckout({ product: productId(ids, args.pack)!, externalCustomerId: target.profileId, email: target.email, metadata, successPath: "/settings/billing?credits=success", returnPath: "/settings/billing" });
    return { url };
  },
});

export const creditsCheckoutContext = internalQuery({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const account = await buyableAccount(ctx, profile, args.scope);
    return { profileId: profile._id as string, email: profile.email, workspaceId: (account.workspaceId as string | undefined) ?? null };
  },
});

/** Polar's customer portal for the person's own Polar customer (plans, payment method, invoices, cancel). */
export const portal = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    await requireIdentity(ctx);
    const me: { profileId: string; hasPolarCustomer: boolean } = await ctx.runQuery(internal.billing.checkoutContext, {});
    if (!me.hasPolarCustomer) fail("invalid_argument", "There's nothing billed through Polar to manage yet.");
    return { url: await customerPortal(me.profileId, "/settings/billing") };
  },
});

// ---------------------------------------------------------------------------------------------------
// Polar webhook
// ---------------------------------------------------------------------------------------------------

/** Deliveries are small JSON documents; anything bigger isn't Polar. */
const MAX_WEBHOOK_BYTES = 1024 * 1024;

/**
 * POST /webhooks/polar: Standard Webhooks signature (webhook-id, webhook-timestamp within 5 minutes,
 * webhook-signature under POLAR_WEBHOOK_SECRET), then applied once per delivery id. Without a secret every
 * request is refused. Nothing from the body is logged or echoed.
 */
export const polarWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.POLAR_WEBHOOK_SECRET ?? "";
  if (!secret) return new Response("Webhook not configured", { status: 401 });
  if (Number(request.headers.get("content-length") ?? "0") > MAX_WEBHOOK_BYTES) return new Response("Too large", { status: 413 });
  const body = await request.text();
  if (body.length > MAX_WEBHOOK_BYTES) return new Response("Too large", { status: 413 });
  const headers = { id: request.headers.get("webhook-id"), timestamp: request.headers.get("webhook-timestamp"), signature: request.headers.get("webhook-signature") };
  if (!(await verifyPolarWebhook(body, headers, secret))) return new Response("Invalid signature", { status: 401 });
  let event: { type?: unknown; timestamp?: unknown; data?: unknown };
  try {
    event = JSON.parse(body) as typeof event;
  } catch {
    return new Response("Malformed body", { status: 400 });
  }
  if (typeof event.type !== "string" || !event.data || typeof event.data !== "object") return new Response("Malformed body", { status: 400 });
  const result = await ctx.runMutation(internal.billing.applyPolarEvent, {
    eventId: headers.id!,
    type: event.type,
    at: ms(event.timestamp) ?? Number(headers.timestamp) * 1000,
    data: event.data,
  });
  console.log(JSON.stringify({ event: "billing.webhook", provider: "polar", type: event.type.slice(0, 60), status: result.status }));
  return new Response(null, { status: 202 });
});

export type ApplyResult = { status: "applied" | "duplicate" | "stale" | "unmatched" | "ignored" };

/**
 * Applies one Polar webhook delivery. Idempotent: a delivery id is applied once (Polar retries), payments
 * and packs are keyed by order id, and a subscription event older than the last one applied to that plan is
 * ignored (delivery order isn't promised). Checking and recording the delivery id happen in this one
 * transaction, so two deliveries of the same event can't both apply. Access is only ever granted here,
 * never because a browser came back from Checkout.
 */
export const applyPolarEvent = internalMutation({
  args: { eventId: v.string(), type: v.string(), at: v.number(), data: v.any() },
  handler: async (ctx, args): Promise<ApplyResult> => {
    const seen = await ctx.db
      .query("billingEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (seen) return { status: "duplicate" };
    const result = await applyEvent(ctx, args.type, args.at, args.data as Record<string, unknown>);
    await ctx.db.insert("billingEvents", { eventId: args.eventId.slice(0, 200), type: args.type.slice(0, 100), created: Math.floor(args.at / 1000), processedAt: Date.now() });
    return result;
  },
});

async function applyEvent(ctx: MutationCtx, type: string, at: number, o: Record<string, unknown>): Promise<ApplyResult> {
  if (type.startsWith("subscription.")) return await applySubscriptionEvent(ctx, type, at, o);
  if (type === "order.paid") return await applyOrderPaid(ctx, o);
  if (type === "order.refunded" || type === "order.updated") return await applyOrderRefund(ctx, o);
  return { status: "ignored" };
}

/** A profile or workspace id carried in metadata, if it names a real row. */
const profileRef = (ctx: MutationCtx, id: string | undefined) => (id ? ctx.db.normalizeId("profiles", id) : null);
const workspaceRef = (ctx: MutationCtx, id: string | undefined) => (id ? ctx.db.normalizeId("workspaces", id) : null);

/**
 * The billing row a subscription (or its order) is about: by the Polar subscription id we stored, else by
 * what our checkout put in its metadata (a workspace id, or a person's profile id), else by the customer's
 * external id (our profile id) for a Personal product.
 */
async function findRow(ctx: MutationCtx, subscriptionId: string | undefined, o: Record<string, unknown>, kind: "personal" | "workspace" | null): Promise<Doc<"subscriptions"> | null> {
  if (subscriptionId) {
    const bySub = await ctx.db
      .query("subscriptions")
      .withIndex("by_polar_subscription", (q) => q.eq("polarSubscriptionId", subscriptionId))
      .unique();
    if (bySub) return bySub;
  }
  const meta = metadataOf(o);
  if (kind === "workspace" || meta.kind === "workspace") {
    const workspaceId = workspaceRef(ctx, meta.workspaceId);
    const workspace = workspaceId ? await ctx.db.get(workspaceId) : null;
    return workspace ? await ensureWorkspaceSubscription(ctx, workspace._id) : null;
  }
  const profileId = profileRef(ctx, meta.profileId) ?? profileRef(ctx, externalCustomerIdOf(o));
  const profile = profileId ? await ctx.db.get(profileId) : null;
  return profile ? await ensureSubscription(ctx, profile._id) : null;
}

/** Polar subscription status → ours. Only active and trialing give access; past due keeps it while Polar retries. */
export function statusOf(type: string, raw: unknown): Doc<"subscriptions">["status"] {
  if (type === "subscription.revoked") return "canceled";
  if (raw === "active" || raw === "trialing") return "active";
  if (raw === "past_due") return "past_due";
  return "canceled";
}

async function applySubscriptionEvent(ctx: MutationCtx, type: string, at: number, o: Record<string, unknown>): Promise<ApplyResult> {
  const product = productFor(await productIds(ctx), str(o.product_id));
  if (!product || product.kind === "credits") {
    console.warn(JSON.stringify({ event: "billing.webhook_unknown_product", type }));
    return { status: "unmatched" };
  }
  const row = await findRow(ctx, str(o.id), o, product.kind);
  if (!row) {
    console.warn(JSON.stringify({ event: "billing.webhook_unmatched", type }));
    return { status: "unmatched" };
  }
  if (row.polarEventAt !== undefined && at < row.polarEventAt) {
    console.warn(JSON.stringify({ event: "billing.webhook_stale", type }));
    return { status: "stale" };
  }
  const status = statusOf(type, o.status);
  // An event about another subscription than the one this plan follows (an old one ending after a new
  // one started) never takes the plan away.
  if (row.polarSubscriptionId && row.polarSubscriptionId !== str(o.id) && status === "canceled" && row.status !== "canceled") return { status: "stale" };
  if (isWorkspaceSubscription(row)) {
    if (product.kind !== "workspace") return { status: "unmatched" };
    await applyWorkspaceSubscriptionEvent(ctx, row, product.planId, status, at, o);
    return { status: "applied" };
  }
  if (!isPersonalSubscription(row) || product.kind !== "personal") return { status: "unmatched" };
  const now = Date.now();
  const periodEnd = ms(o.current_period_end) ?? row.currentPeriodEnd;
  const tier: PersonalTier = product.tier;
  const wasPaid = onPaidPlan(row) && row.status !== "canceled";
  await ctx.db.patch(row._id, {
    provider: "polar",
    plan: tier,
    interval: product.interval,
    status,
    currentPeriodStart: ms(o.current_period_start) ?? row.currentPeriodStart,
    currentPeriodEnd: status === "canceled" ? Math.min(periodEnd ?? now, now) : periodEnd,
    cancelAtPeriodEnd: Boolean(o.cancel_at_period_end),
    polarCustomerId: str(o.customer_id) ?? row.polarCustomerId,
    polarSubscriptionId: str(o.id) ?? row.polarSubscriptionId,
    polarProductId: str(o.product_id),
    paidSince: wasPaid && row.paidSince ? row.paidSince : status === "active" ? now : row.paidSince,
    canceledAt: status === "canceled" ? (row.canceledAt ?? now) : undefined,
    // Paying ends a running trial: they get what they chose from now on.
    trialEndsAt: status === "active" && row.trialEndsAt && row.trialEndsAt > now ? now : row.trialEndsAt,
    polarEventAt: at,
    updatedAt: now,
  });
  return { status: "applied" };
}

/** A paid order: a credit pack (credits added) or a subscription payment (recorded, keyed by order id). */
async function applyOrderPaid(ctx: MutationCtx, o: Record<string, unknown>): Promise<ApplyResult> {
  const orderId = str(o.id);
  const product = productFor(await productIds(ctx), str(o.product_id));
  if (!orderId || !product) {
    console.warn(JSON.stringify({ event: "billing.webhook_unknown_product", type: "order.paid" }));
    return { status: "unmatched" };
  }
  const existing = await ctx.db
    .query("payments")
    .withIndex("by_provider_ref", (q) => q.eq("providerRef", orderId))
    .unique();
  if (existing) return { status: "duplicate" };
  const now = Date.now();
  const amount = num(o.total_amount) ?? 0;
  const currency = str(o.currency) ?? "usd";
  if (product.kind === "credits") {
    const meta = metadataOf(o);
    const profileId = profileRef(ctx, meta.profileId) ?? profileRef(ctx, externalCustomerIdOf(o));
    const profile = profileId ? await ctx.db.get(profileId) : null;
    if (!profile) {
      console.warn(JSON.stringify({ event: "billing.webhook_unmatched", type: "order.paid" }));
      return { status: "unmatched" };
    }
    const workspaceId = workspaceRef(ctx, meta.workspaceId) ?? undefined;
    const paymentId = await insertPayment(ctx, { kind: "user", profileId: profile._id }, { amountCents: amount, currency, plan: "credits", credits: product.credits, creditsWorkspaceId: workspaceId, status: "paid", provider: "polar", providerRef: orderId, createdAt: now });
    await addCredits(ctx, { profileId: profile._id, workspaceId }, product.credits, "polar", { orderId, paymentId, now });
    return { status: "applied" };
  }
  const row = await findRow(ctx, str(o.subscription_id), o, product.kind);
  if (!row) {
    console.warn(JSON.stringify({ event: "billing.webhook_unmatched", type: "order.paid" }));
    return { status: "unmatched" };
  }
  if (amount <= 0) return { status: "ignored" };
  if (isWorkspaceSubscription(row) && product.kind === "workspace") {
    await applyWorkspaceOrder(ctx, row, product.planId, orderId, amount, currency, num(o.seats));
    return { status: "applied" };
  }
  if (isPersonalSubscription(row) && product.kind === "personal") {
    await insertPayment(ctx, { kind: "user", profileId: row.profileId }, { amountCents: amount, currency, plan: product.tier, interval: product.interval, status: "paid", provider: "polar", providerRef: orderId, createdAt: now });
    return { status: "applied" };
  }
  return { status: "unmatched" };
}

/**
 * A refund on an order (Polar reports the order's total refunded so far): a full refund marks the payment
 * refunded; any refund of a credit pack removes the matching share of its unused credits.
 */
async function applyOrderRefund(ctx: MutationCtx, o: Record<string, unknown>): Promise<ApplyResult> {
  const orderId = str(o.id);
  const refunded = num(o.refunded_amount) ?? 0;
  if (!orderId || refunded <= 0) return { status: "ignored" };
  const total = num(o.total_amount) ?? 0;
  const payment = await ctx.db
    .query("payments")
    .withIndex("by_provider_ref", (q) => q.eq("providerRef", orderId))
    .unique();
  const full = o.status === "refunded" || (total > 0 && refunded >= total);
  if (payment && (payment.refundedCents ?? 0) < refunded) await ctx.db.patch(payment._id, { refundedCents: refunded, ...(full ? { status: "refunded" as const } : {}) });
  else if (payment && full && payment.status !== "refunded") await ctx.db.patch(payment._id, { status: "refunded" });
  await refundPackCredits(ctx, orderId, full ? 1 : total > 0 ? refunded / total : 0);
  return { status: payment ? "applied" : "unmatched" };
}

/** Kept for the admin refund tool: a manual refund of a credit pack payment takes back its unused credits. */
export async function refundPaymentCredits(ctx: MutationCtx, payment: Doc<"payments">): Promise<void> {
  if (payment.plan !== "credits") return;
  const pack = (
    await ctx.db
      .query("aiCreditPacks")
      .withIndex("by_account_expires", (q) => q.eq("profileId", payment.profileId!).eq("workspaceId", payment.creditsWorkspaceId))
      .collect()
  ).find((p) => p.paymentId === payment._id || (payment.providerRef !== undefined && p.orderId === payment.providerRef));
  if (pack && pack.status !== "refunded") await ctx.db.patch(pack._id, { remaining: 0, status: "refunded", refundedCredits: pack.credits });
}

