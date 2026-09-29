// Personal plans, Polar (checkout, portal, webhooks), admin billing tools and the plan-tier migration
// (docs/BILLING.md). Workspace plans: workspace-billing.test.ts. AI credits: credits.test.ts.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { verifyPolarWebhook } from "../../convex/lib/polar";
import {
  CREDIT_PACKS,
  DAY_MS,
  PLANS,
  PLAN_CATALOG,
  PLAN_ORDER,
  TRIAL_CREDITS,
  TRIAL_DAYS,
  WORKSPACE_PLANS,
  WORKSPACE_PLAN_ORDER,
  monthlyEquivalent,
  personalEntitlementsOf,
  personalPlanId,
  workspaceEntitlementsOf,
  yearlySavingPercent,
} from "../../convex/lib/plans";
import { authSession, identity, person, PERSONAL, setup, type T } from "./helpers";
import { POLAR_SECRET, delivery, fakePolar, order, postEvent, product, subscription, withPolar, withoutPolar } from "./polar";

const GB = 1024 ** 3;
type Person = Awaited<ReturnType<typeof person>>;

async function withRole(t: T, p: Person, role: "super_admin" | "ops_admin" | "support_admin") {
  await t.run(async (ctx) => ctx.db.patch(p.profileId as Id<"profiles">, { platformRole: role }));
}

async function subOf(t: T, p: Person) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("subscriptions")
      .withIndex("by_profile", (q) => q.eq("profileId", p.profileId as Id<"profiles">))
      .unique(),
  );
}

async function endTrial(t: T, p: Person) {
  const sub = await subOf(t, p);
  await t.run(async (ctx) => ctx.db.patch(sub!._id, { trialEndsAt: Date.now() - 1 }));
}

const REASON = "Customer support ticket 4321";

afterEach(() => {
  withoutPolar();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the catalog", () => {
  test("exact prices, scopes and billing models", () => {
    const price = (id: keyof typeof PLAN_CATALOG) => PLAN_CATALOG[id].priceCents;
    expect(["personal_free", "personal_core_monthly", "personal_core_yearly", "personal_pro_monthly", "personal_pro_yearly", "personal_pro_ai_monthly", "personal_pro_ai_yearly"].map((id) => price(id as keyof typeof PLAN_CATALOG))).toEqual([0, 199, 1900, 499, 4900, 1299, 14900]);
    // Team prices are the same, per member seat.
    expect(["workspace_free", "workspace_core_monthly", "workspace_core_yearly", "workspace_pro_monthly", "workspace_pro_yearly", "workspace_pro_ai_monthly", "workspace_pro_ai_yearly"].map((id) => price(id as keyof typeof PLAN_CATALOG))).toEqual([0, 199, 1900, 499, 4900, 1299, 14900]);
    expect(Object.keys(PLAN_CATALOG)).toHaveLength(14);
    for (const plan of Object.values(PLAN_CATALOG)) {
      expect(plan.id.startsWith(plan.scope)).toBe(true);
      expect(plan.currency).toBe("usd");
      if (plan.priceCents === 0) expect(plan.billingModel).toBe("free");
      else expect(plan.billingModel).toBe(plan.scope === "personal" ? "flat_user" : "per_seat");
    }
    expect(PLAN_ORDER).toEqual(["free", "core", "pro", "pro_ai"]);
    expect(WORKSPACE_PLAN_ORDER).toEqual(["free", "core", "pro", "pro_ai"]);
    expect(CREDIT_PACKS).toEqual({ credits_500: { id: "credits_500", credits: 500, priceCents: 799 }, credits_1000: { id: "credits_1000", credits: 1000, priceCents: 1499 } });
  });

  test("what each plan includes: storage, credits, packs, devices, AI", () => {
    const e = (id: keyof typeof PLAN_CATALOG) => PLAN_CATALOG[id].entitlements;
    const row = (id: keyof typeof PLAN_CATALOG) => [e(id).storageBytes / GB, e(id).storageRule, e(id).monthlyCredits, e(id).creditPacks, e(id).aiAssistant, e(id).devices];
    expect(row("personal_free")).toEqual([1, "shared_free", 25, false, true, 2]);
    expect(row("personal_core_yearly")).toEqual([20, "per_person", 0, false, false, null]);
    expect(row("personal_pro_monthly")).toEqual([20, "per_person", 180, true, true, null]);
    expect(row("personal_pro_ai_yearly")).toEqual([50, "per_person", 550, true, true, null]);
    expect(row("workspace_free")).toEqual([1, "shared_free", 25, false, true, null]);
    expect(row("workspace_core_monthly")).toEqual([20, "per_person", 0, false, false, null]);
    expect(row("workspace_pro_yearly")).toEqual([20, "per_person", 180, true, true, null]);
    expect(row("workspace_pro_ai_monthly")).toEqual([50, "per_person", 550, true, true, null]);
    expect(e("personal_pro_ai_monthly").aiFairUse).toBe("high");
    expect(e("personal_pro_monthly").aiFairUse).toBe("standard");
    // Features that don't exist yet aren't promised; no plan limits members or guests.
    for (const plan of Object.values(PLAN_CATALOG)) expect(plan.entitlements).toMatchObject({ auditLog: false, workspaceAnalytics: false, securityControls: false, advancedPermissions: false, prioritySupport: false, members: null, guests: null });
    // Cards read the catalog.
    expect(PLAN_ORDER.map((t) => [PLANS[t].name, PLANS[t].monthlyCents, PLANS[t].yearlyCents, PLANS[t].monthlyCredits])).toEqual([
      ["Free", 0, 0, 25],
      ["Core", 199, 1900, 0],
      ["Pro", 499, 4900, 180],
      ["Pro AI", 1299, 14900, 550],
    ]);
    expect(WORKSPACE_PLAN_ORDER.map((t) => [WORKSPACE_PLANS[t].name, WORKSPACE_PLANS[t].perSeat])).toEqual([
      ["Free", false],
      ["Core", true],
      ["Pro", true],
      ["Pro AI", true],
    ]);
    expect([monthlyEquivalent(1900), monthlyEquivalent(4900), monthlyEquivalent(14900)]).toEqual(["$1.58", "$4.08", "$12.41"]);
    expect([yearlySavingPercent("core"), yearlySavingPercent("pro"), yearlySavingPercent("pro_ai")]).toEqual([20, 18, 4]);
    expect(PLANS.core.features.join(" ")).toMatch(/No AI/);
    expect(PLANS.pro_ai.features.join(" ")).toMatch(/Unlimited AI, fair use \(550 credits a month\)/);
    expect(Object.values(PLANS).flatMap((p) => p.features).join(" ")).not.toMatch(/\u2014|iOS/);
  });

  test("the rules: the trial is Pro AI with 100 credits; lapsed plans fall back to Free; old tiers read as today's", () => {
    const now = Date.now();
    expect(personalEntitlementsOf(null, now)).toMatchObject({ scope: "personal", planId: "personal_free", plan: "free", paid: false, ai: true, monthlyCredits: 25, storageBytes: 1 * GB, devices: 2 });
    const trial = personalEntitlementsOf({ plan: "free", status: "active", trialEndsAt: now + DAY_MS }, now);
    expect(trial).toMatchObject({ planId: "personal_pro_ai_monthly", paidPlanId: "personal_free", plan: "pro_ai", paidPlan: "free", paid: false, trialing: true, ai: true, aiSource: "trial", monthlyCredits: TRIAL_CREDITS, storageBytes: 50 * GB, devices: null });
    expect(personalEntitlementsOf({ plan: "free", status: "active", trialEndsAt: now - 1 }, now)).toMatchObject({ plan: "free", trialing: false });
    expect(personalEntitlementsOf({ plan: "core", catalogVersion: 2, status: "active", currentPeriodEnd: now + DAY_MS }, now)).toMatchObject({ planId: "personal_core_monthly", ai: false, aiSource: null, storageBytes: 20 * GB });
    expect(personalEntitlementsOf({ plan: "pro", catalogVersion: 2, interval: "year", status: "active" }, now)).toMatchObject({ planId: "personal_pro_yearly", monthlyCredits: 180 });
    expect(personalEntitlementsOf({ plan: "pro", catalogVersion: 2, status: "active", currentPeriodEnd: now - 1 }, now)).toMatchObject({ plan: "free", paid: false });
    expect(personalEntitlementsOf({ plan: "pro_ai", catalogVersion: 2, status: "canceled", currentPeriodEnd: now + DAY_MS }, now)).toMatchObject({ plan: "pro_ai", paid: true });
    // A paying Core customer with a trial date left doesn't get the trial.
    expect(personalEntitlementsOf({ plan: "core", catalogVersion: 2, status: "active", trialEndsAt: now + DAY_MS }, now)).toMatchObject({ trialing: false, ai: false });
    // Rows from before January 2027 (not yet migrated): Basic → Core, the old Pro → Pro AI.
    expect(personalEntitlementsOf({ plan: "basic", status: "active" }, now)).toMatchObject({ planId: "personal_core_monthly" });
    expect(personalEntitlementsOf({ plan: "pro", status: "active" }, now)).toMatchObject({ planId: "personal_pro_ai_monthly" });
    expect(personalEntitlementsOf({ plan: "free", status: "active", storageOverrideBytes: 5 * GB }, now).storageBytes).toBe(5 * GB);
    expect([personalPlanId("free"), personalPlanId("core"), personalPlanId("pro_ai", "year")]).toEqual(["personal_free", "personal_core_monthly", "personal_pro_ai_yearly"]);
  });

  test("workspace entitlements: Free without a subscription; a paid plan while in force; an admin override is its own total", () => {
    const now = Date.now();
    expect(workspaceEntitlementsOf(null, {}, now)).toMatchObject({ scope: "workspace", planId: "workspace_free", paid: false, ai: true, monthlyCredits: 0, storageBytes: 1 * GB, storageRule: "shared_free" });
    expect(workspaceEntitlementsOf({ tier: "pro_ai", interval: "year", status: "active", currentPeriodEnd: now + DAY_MS }, {}, now)).toMatchObject({ planId: "workspace_pro_ai_yearly", ai: true, aiFairUse: "high", monthlyCredits: 550, storageBytes: 50 * GB, storageRule: "per_person" });
    expect(workspaceEntitlementsOf({ tier: "core", status: "active" }, {}, now)).toMatchObject({ planId: "workspace_core_monthly", ai: false, monthlyCredits: 0, storageBytes: 20 * GB });
    expect(workspaceEntitlementsOf({ tier: "pro", status: "canceled", currentPeriodEnd: now + DAY_MS }, {}, now)).toMatchObject({ planId: "workspace_pro_monthly", ai: true });
    expect(workspaceEntitlementsOf({ tier: "pro", status: "active", currentPeriodEnd: now - 1 }, {}, now)).toMatchObject({ planId: "workspace_free" });
    expect(workspaceEntitlementsOf(null, { storageBytes: 50 * GB }, now)).toMatchObject({ storageBytes: 50 * GB, storageOverridden: true, storageRule: "override" });
  });
});

describe("personal plans", () => {
  test("new accounts start on Free with a 7-day Pro AI trial and 100 AI credits", async () => {
    const t = setup();
    const a = await person(t, "trial@example.com");
    const mine = await a.as.query(api.billing.mine, {});
    expect(mine.entitlements).toMatchObject({ plan: "pro_ai", paidPlan: "free", trialing: true, ai: true, aiSource: "trial", monthlyCredits: 100 });
    expect(mine.credits).toMatchObject({ allowance: 100, available: 100, trialing: true, canBuy: false });
    expect(mine.entitlements.trialEndsAt! - Date.now()).toBeGreaterThan((TRIAL_DAYS - 1) * DAY_MS);
    expect(mine.entitlements.trialEndsAt! - Date.now()).toBeLessThanOrEqual(TRIAL_DAYS * DAY_MS);
    expect(mine.credits.resetsAt).toBe(mine.entitlements.trialEndsAt);
    const sub = await subOf(t, a);
    expect(sub).toMatchObject({ plan: "free", catalogVersion: 2 });
  });

  test("test purchases work in development, are recorded, can be canceled, and are refused in production", async () => {
    const t = setup();
    const a = await person(t, "buyer@example.com");
    await a.as.mutation(api.billing.testPurchase, { plan: "pro_ai", interval: "year" });
    let mine = await a.as.query(api.billing.mine, {});
    expect(mine.entitlements).toMatchObject({ plan: "pro_ai", paidPlan: "pro_ai", trialing: false });
    expect(mine.payments[0]).toMatchObject({ amountCents: 14900, plan: "pro_ai", interval: "year", status: "paid" });
    expect(mine.subscription).toMatchObject({ plan: "pro_ai", provider: "test" });
    await a.as.mutation(api.billing.cancelPlan, {});
    mine = await a.as.query(api.billing.mine, {});
    expect(mine.subscription?.cancelAtPeriodEnd).toBe(true);
    const sub = await subOf(t, a);
    await t.run(async (ctx) => ctx.db.patch(sub!._id, { currentPeriodEnd: Date.now() - 1 }));
    await t.mutation(internal.billing.settleExpiredPlans, {});
    expect((await a.as.query(api.billing.mine, {})).entitlements.paidPlan).toBe("free");

    process.env.FOLEVI_ENV = "production";
    try {
      await expect(a.as.mutation(api.billing.testPurchase, { plan: "core", interval: "month" })).rejects.toThrow(/only available in development/);
      await expect(a.as.mutation(api.billing.testBuyCredits, { pack: "credits_500", scope: PERSONAL })).rejects.toThrow(/only available in development/);
      expect((await a.as.query(api.billing.mine, {})).testPurchases).toBe(false);
    } finally {
      process.env.FOLEVI_ENV = "test";
    }
  });

  test("without Polar settings, checkout explains payments aren't set up and nothing is sent", async () => {
    const t = setup();
    const a = await person(t, "nopolar@example.com");
    const calls = fakePolar();
    await expect(a.as.action(api.billing.checkout, { plan: "pro", interval: "month" })).rejects.toThrow(/aren't set up/);
    await expect(a.as.action(api.billing.portal, {})).rejects.toThrow(/nothing billed through Polar/);
    expect(calls).toHaveLength(0);
    expect((await a.as.query(api.billing.mine, {})).checkoutAvailable).toBe(false);
  });
});

describe("Polar checkout and portal", () => {
  test("checkout: the server picks the product and names the buyer; the client sends only a tier and an interval", async () => {
    const t = setup();
    const a = await person(t, "checkout@example.com");
    withPolar();
    const calls = fakePolar(() => ({ id: "chk_1", url: "https://sandbox.polar.sh/checkout/chk_1" }));
    const { url } = await a.as.action(api.billing.checkout, { plan: "pro_ai", interval: "year" });
    expect(url).toBe("https://sandbox.polar.sh/checkout/chk_1");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", path: "checkouts/" });
    expect(calls[0]!.headers["polar-version"]).toBe("2026-10");
    expect(calls[0]!.headers.authorization).toBe("Bearer polar_oat_test");
    expect(calls[0]!.body).toMatchObject({ products: [product("personal_pro_ai_yearly")], external_customer_id: a.profileId, customer_email: "checkout@example.com", metadata: { kind: "personal", profileId: a.profileId } });
    expect(String(calls[0]!.body!.success_url)).toMatch(/\/settings\/billing\?checkout=success&checkout_id=\{CHECKOUT_ID\}$/);
    // Returning from checkout grants nothing by itself.
    expect((await a.as.query(api.billing.mine, {})).entitlements.paidPlan).toBe("free");
  });

  test("with a Polar subscription running, choosing another plan switches it (prorated) instead of a new checkout", async () => {
    const t = setup();
    const a = await person(t, "switcher@example.com");
    withPolar();
    await postEvent(t, "subscription.created", subscription({ id: "sub_sw", productKey: "personal_pro_monthly", metadata: { kind: "personal", profileId: a.profileId } }));
    const calls = fakePolar();
    expect(await a.as.action(api.billing.checkout, { plan: "pro_ai", interval: "month" })).toEqual({ url: null });
    expect(calls).toEqual([expect.objectContaining({ method: "PATCH", path: "subscriptions/sub_sw", body: { product_id: product("personal_pro_ai_monthly"), proration_behavior: "prorate" } })]);
    await expect(a.as.action(api.billing.checkout, { plan: "pro", interval: "month" })).rejects.toThrow(/already on that plan/);
    // Polar plans are managed in the portal, not with the app's own cancel button.
    await expect(a.as.mutation(api.billing.cancelPlan, {})).rejects.toThrow(/billing portal/);
  });

  test("the customer portal opens for the person's own Polar customer only", async () => {
    const t = setup();
    const a = await person(t, "portal@example.com");
    withPolar();
    await postEvent(t, "subscription.created", subscription({ id: "sub_p", productKey: "personal_core_monthly", metadata: { kind: "personal", profileId: a.profileId } }));
    const calls = fakePolar(() => ({ customer_portal_url: "https://sandbox.polar.sh/portal/x" }));
    expect(await a.as.action(api.billing.portal, {})).toEqual({ url: "https://sandbox.polar.sh/portal/x" });
    expect(calls[0]).toMatchObject({ method: "POST", path: "customer-sessions/", body: { external_customer_id: a.profileId } });
  });

  test("credit packs: bought for your Personal (Pro, Pro AI) or your own seat in a paid workspace; never on Free, Core or the trial", async () => {
    const t = setup();
    const a = await person(t, "packs@example.com");
    const other = await person(t, "packs-other@example.com");
    withPolar();
    const calls = fakePolar(() => ({ url: "https://sandbox.polar.sh/checkout/pack" }));
    await expect(a.as.action(api.billing.buyCredits, { pack: "credits_500", scope: PERSONAL })).rejects.toThrow(/Choose a plan first/);
    await endTrial(t, a);
    await expect(a.as.action(api.billing.buyCredits, { pack: "credits_500", scope: PERSONAL })).rejects.toThrow(/Pro and Pro AI/);
    await a.as.mutation(api.billing.testPurchase, { plan: "core", interval: "month" });
    await expect(a.as.action(api.billing.buyCredits, { pack: "credits_500", scope: PERSONAL })).rejects.toThrow(/Pro and Pro AI/);
    await a.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "month" });
    await a.as.action(api.billing.buyCredits, { pack: "credits_1000", scope: PERSONAL });
    expect(calls.at(-1)!.body).toMatchObject({ products: [product("credits_1000")], external_customer_id: a.profileId, metadata: { kind: "credits", profileId: a.profileId, pack: "credits_1000" } });
    expect(calls.at(-1)!.body!.metadata).not.toHaveProperty("workspaceId");
    // A seat in someone else's paid workspace: only once they're a member of it.
    const { id: ws } = await other.as.mutation(api.workspaces.createTeamWorkspace, { name: "Seats" });
    await other.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: ws, planId: "workspace_pro_monthly" });
    await expect(a.as.action(api.billing.buyCredits, { pack: "credits_500", scope: { kind: "workspace", workspaceId: ws } })).rejects.toThrow(/not_found/);
    await other.as.action(api.billing.buyCredits, { pack: "credits_500", scope: { kind: "workspace", workspaceId: ws } });
    const wsDbId = await t.run(async (ctx) => (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", ws)).unique())!._id);
    expect(calls.at(-1)!.body).toMatchObject({ metadata: { kind: "credits", profileId: other.profileId, workspaceId: wsDbId, pack: "credits_500" } });
  });
});

describe("Polar webhooks", () => {
  test("signatures: Standard Webhooks key and Polar's older key both verify; wrong secret, changed body, stale or future times, and missing headers don't", async () => {
    const d = await delivery({ type: "order.paid", data: {} });
    const headers = { id: d.id, timestamp: d.timestamp, signature: `v1,${d.signature}` };
    expect(await verifyPolarWebhook(d.body, headers, POLAR_SECRET)).toBe(true);
    const legacy = await delivery({ type: "order.paid", data: {} }, { key: "legacy" });
    expect(await verifyPolarWebhook(legacy.body, { id: legacy.id, timestamp: legacy.timestamp, signature: `v1,${legacy.signature}` }, POLAR_SECRET)).toBe(true);
    // Several signatures (secret rotation): any one may match.
    expect(await verifyPolarWebhook(d.body, { ...headers, signature: `v1,bm90IGl0 v1,${d.signature}` }, POLAR_SECRET)).toBe(true);
    expect(await verifyPolarWebhook(d.body, headers, `whsec_${btoa("another-secret-entirely-32bytes!")}`)).toBe(false);
    expect(await verifyPolarWebhook(`${d.body} `, headers, POLAR_SECRET)).toBe(false);
    expect(await verifyPolarWebhook(d.body, { ...headers, id: "msg_other" }, POLAR_SECRET)).toBe(false);
    expect(await verifyPolarWebhook(d.body, { ...headers, signature: d.signature }, POLAR_SECRET)).toBe(false);
    expect(await verifyPolarWebhook(d.body, { ...headers, signature: null }, POLAR_SECRET)).toBe(false);
    expect(await verifyPolarWebhook(d.body, headers, "")).toBe(false);
    const old = await delivery({ type: "order.paid", data: {} }, { at: Date.now() - 6 * 60_000 });
    expect(await verifyPolarWebhook(old.body, { id: old.id, timestamp: old.timestamp, signature: `v1,${old.signature}` }, POLAR_SECRET)).toBe(false);
    const future = await delivery({ type: "order.paid", data: {} }, { at: Date.now() + 6 * 60_000 });
    expect(await verifyPolarWebhook(future.body, { id: future.id, timestamp: future.timestamp, signature: `v1,${future.signature}` }, POLAR_SECRET)).toBe(false);
  });

  test("the route refuses unsigned, badly signed and unconfigured deliveries, and applies a signed one once (replays are ignored)", async () => {
    const t = setup();
    const a = await person(t, "hook@example.com");
    const event = { type: "subscription.created", timestamp: new Date().toISOString(), data: subscription({ id: "sub_h", productKey: "personal_pro_monthly", metadata: { kind: "personal", profileId: a.profileId } }) };
    const d = await delivery(event);
    // No secret configured: everything is refused.
    expect((await t.fetch("/webhooks/polar", { method: "POST", body: d.body, headers: d.headers })).status).toBe(401);
    withPolar();
    expect((await t.fetch("/webhooks/polar", { method: "POST", body: d.body })).status).toBe(401);
    expect((await t.fetch("/webhooks/polar", { method: "POST", body: d.body, headers: { ...d.headers, "webhook-signature": "v1,AAAA" } })).status).toBe(401);
    expect((await a.as.query(api.billing.mine, {})).entitlements.paidPlan).toBe("free");
    expect((await t.fetch("/webhooks/polar", { method: "POST", body: d.body, headers: d.headers })).status).toBe(202);
    expect((await a.as.query(api.billing.mine, {})).entitlements).toMatchObject({ paidPlan: "pro", ai: true });
    // The same delivery again (a replay, or Polar retrying): applied once.
    expect((await t.fetch("/webhooks/polar", { method: "POST", body: d.body, headers: d.headers })).status).toBe(202);
    expect(await t.run(async (ctx) => (await ctx.db.query("billingEvents").collect()).length)).toBe(1);
    expect(await t.mutation(internal.billing.applyPolarEvent, { eventId: d.id, type: event.type, at: Date.now(), data: event.data })).toEqual({ status: "duplicate" });
  });

  test("a Personal subscription's life: created, paid, set to cancel, uncanceled, renewed, revoked", async () => {
    const t = setup();
    const a = await person(t, "life@example.com");
    withPolar();
    const meta = { kind: "personal", profileId: a.profileId };
    const start = Date.now();
    const sub = (extra: Partial<Parameters<typeof subscription>[0]> = {}) => subscription({ id: "sub_l", productKey: "personal_pro_ai_monthly", metadata: meta, start, ...extra });
    await postEvent(t, "subscription.created", sub(), { at: start });
    let mine = await a.as.query(api.billing.mine, {});
    expect(mine.entitlements).toMatchObject({ paidPlan: "pro_ai", trialing: false, monthlyCredits: 550 });
    expect(mine.subscription).toMatchObject({ provider: "polar", plan: "pro_ai", interval: "month", status: "active" });
    expect(mine.credits.allowance).toBe(550);
    await postEvent(t, "order.paid", order({ id: "ord_1", productKey: "personal_pro_ai_monthly", total: 1299, metadata: meta, subscriptionId: "sub_l" }));
    await postEvent(t, "order.paid", order({ id: "ord_1", productKey: "personal_pro_ai_monthly", total: 1299, metadata: meta, subscriptionId: "sub_l" }));
    mine = await a.as.query(api.billing.mine, {});
    expect(mine.payments).toHaveLength(1);
    expect(mine.payments[0]).toMatchObject({ amountCents: 1299, plan: "pro_ai", interval: "month", status: "paid" });
    await postEvent(t, "subscription.canceled", sub({ cancelAtPeriodEnd: true }), { at: start + 1000 });
    expect((await a.as.query(api.billing.mine, {})).subscription).toMatchObject({ cancelAtPeriodEnd: true, status: "active" });
    await postEvent(t, "subscription.uncanceled", sub({ cancelAtPeriodEnd: false }), { at: start + 2000 });
    expect((await a.as.query(api.billing.mine, {})).subscription).toMatchObject({ cancelAtPeriodEnd: false });
    // An older event delivered late is ignored.
    await postEvent(t, "subscription.canceled", sub({ cancelAtPeriodEnd: true }), { at: start + 1500 });
    expect((await a.as.query(api.billing.mine, {})).subscription).toMatchObject({ cancelAtPeriodEnd: false });
    // Renewal: a new period (the monthly credits reset with it) and another payment.
    const next = start + 30 * DAY_MS;
    await postEvent(t, "subscription.updated", sub({ start: next - 1, end: next + 30 * DAY_MS }), { at: start + 3000 });
    const row = await subOf(t, a);
    expect(row!.currentPeriodStart).toBe(next - 1);
    await postEvent(t, "order.paid", order({ id: "ord_2", productKey: "personal_pro_ai_monthly", total: 1299, metadata: meta, subscriptionId: "sub_l", billingReason: "subscription_cycle" }));
    expect((await a.as.query(api.billing.mine, {})).payments).toHaveLength(2);
    // Revoked: the plan ends now; the history stays.
    await postEvent(t, "subscription.revoked", sub({ status: "canceled" }), { at: start + 4000 });
    mine = await a.as.query(api.billing.mine, {});
    expect(mine.entitlements).toMatchObject({ paidPlan: "free", monthlyCredits: 25 });
    expect(mine.payments).toHaveLength(2);
  });

  test("an old subscription ending after a new one started never takes the new plan away", async () => {
    const t = setup();
    const a = await person(t, "twosubs@example.com");
    withPolar();
    const meta = { kind: "personal", profileId: a.profileId };
    await postEvent(t, "subscription.created", subscription({ id: "sub_new", productKey: "personal_pro_monthly", metadata: meta }));
    expect(await t.mutation(internal.billing.applyPolarEvent, { eventId: "evt_old_end", type: "subscription.revoked", at: Date.now() + 5000, data: subscription({ id: "sub_old", productKey: "personal_core_monthly", status: "canceled", metadata: meta }) })).toEqual({ status: "stale" });
    expect((await a.as.query(api.billing.mine, {})).entitlements.paidPlan).toBe("pro");
  });

  test("a paid credit pack adds credits once; a refund takes back the unused share", async () => {
    const t = setup();
    const a = await person(t, "pack@example.com");
    withPolar();
    await endTrial(t, a);
    await a.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "month" });
    const meta = { kind: "credits", profileId: a.profileId, pack: "credits_1000" };
    const paid = order({ id: "ord_pack", productKey: "credits_1000", total: 1499, metadata: meta });
    await postEvent(t, "order.paid", paid);
    // Redelivered under a new delivery id: still one pack.
    await postEvent(t, "order.paid", paid);
    let mine = await a.as.query(api.billing.mine, {});
    expect(mine.credits).toMatchObject({ packCredits: 1000, available: 180 + 1000 });
    expect(mine.payments[0]).toMatchObject({ amountCents: 1499, plan: "credits", credits: 1000, status: "paid" });
    // A partial refund (about a quarter) takes back 250 unused credits; the payment stays paid.
    await postEvent(t, "order.refunded", { ...paid, status: "partially_refunded", refunded_amount: 374 });
    mine = await a.as.query(api.billing.mine, {});
    expect(mine.credits.packCredits).toBe(750);
    expect(mine.payments[0]!.status).toBe("paid");
    // The rest refunded: the payment is refunded and the pack is empty (used credits stay used).
    await t.run(async (ctx) => {
      const pack = (await ctx.db.query("aiCreditPacks").collect())[0]!;
      await ctx.db.patch(pack._id, { remaining: 600 });
    });
    await postEvent(t, "order.refunded", { ...paid, status: "refunded", refunded_amount: 1499 });
    mine = await a.as.query(api.billing.mine, {});
    expect(mine.credits.packCredits).toBe(0);
    expect(mine.payments[0]!.status).toBe("refunded");
    const pack = await t.run(async (ctx) => (await ctx.db.query("aiCreditPacks").collect())[0]!);
    expect(pack).toMatchObject({ status: "refunded", remaining: 0, source: "polar", orderId: "ord_pack" });
  });

  test("events for products that aren't Folevi's, or without a matching account, change nothing", async () => {
    const t = setup();
    await person(t, "stranger@example.com");
    withPolar();
    expect(await t.mutation(internal.billing.applyPolarEvent, { eventId: "e1", type: "subscription.created", at: Date.now(), data: { ...subscription({ id: "sub_x", productKey: "personal_pro_monthly", metadata: {} }), product_id: "prod_unknown" } })).toEqual({ status: "unmatched" });
    expect(await t.mutation(internal.billing.applyPolarEvent, { eventId: "e2", type: "order.paid", at: Date.now(), data: order({ id: "ord_x", productKey: "credits_500", total: 799, metadata: { kind: "credits", profileId: "not-an-id" } }) })).toEqual({ status: "unmatched" });
    expect(await t.mutation(internal.billing.applyPolarEvent, { eventId: "e3", type: "checkout.created", at: Date.now(), data: {} })).toEqual({ status: "ignored" });
    expect(await t.run(async (ctx) => (await ctx.db.query("payments").collect()).length)).toBe(0);
  });
});

describe("admin: billing, plans, credits and analytics", () => {
  test("support staff can look people up and give short trials, but not set plans, grant credits or see revenue", async () => {
    const t = setup();
    const staff = await person(t, "support@example.com");
    const user = await person(t, "customer@example.com");
    await withRole(t, staff, "support_admin");
    const view = await staff.as.mutation(api.adminBilling.userBilling, { profileId: user.profileId });
    expect(view.entitlements.trialing).toBe(true);
    expect(view.credits).toMatchObject({ allowance: 100, plan: "Pro AI trial" });
    await expect(staff.as.mutation(api.adminBilling.extendTrial, { profileId: user.profileId, days: 30, reason: REASON })).rejects.toThrow(/between 1 and 14/);
    await staff.as.mutation(api.adminBilling.extendTrial, { profileId: user.profileId, days: 14, reason: REASON });
    await expect(staff.as.mutation(api.adminBilling.extendTrial, { profileId: user.profileId, days: 3, reason: "short" })).rejects.toThrow(/reason/);
    await expect(staff.as.mutation(api.adminBilling.setPlan, { profileId: user.profileId, plan: "pro", reason: REASON })).rejects.toThrow(/not_found/);
    await expect(staff.as.mutation(api.adminBilling.grantCredits, { profileId: user.profileId, credits: 100, reason: REASON })).rejects.toThrow(/not_found/);
    await expect(staff.as.mutation(api.adminBilling.setStorageOverride, { profileId: user.profileId, gigabytes: 5, reason: REASON })).rejects.toThrow(/not_found/);
    await expect(staff.as.query(api.adminAnalytics.revenue, { months: 12 })).rejects.toThrow(/not_found/);
    const users = await staff.as.query(api.adminAnalytics.users, { days: 30 });
    expect(users.totals.users).toBe(2);
    expect(users.trialing).toBe(2);
    await expect(user.as.mutation(api.adminBilling.userBilling, { profileId: user.profileId })).rejects.toThrow(/not_found/);
  });

  test("admins set plans and grant credits (reason required, audited); owners alone mark refunds, which take back a pack's credits", async () => {
    const t = setup();
    const admin = await person(t, "ops@example.com");
    const owner = await person(t, "owner@example.com");
    const user = await person(t, "comped@example.com");
    await withRole(t, admin, "ops_admin");
    await withRole(t, owner, "super_admin");
    await endTrial(t, user);

    await admin.as.mutation(api.adminBilling.setPlan, { profileId: user.profileId, plan: "core", interval: "year", reason: REASON });
    expect((await user.as.query(api.billing.mine, {})).entitlements).toMatchObject({ plan: "core", ai: false });
    // Core has no AI, so it can't be given credits.
    await expect(admin.as.mutation(api.adminBilling.grantCredits, { profileId: user.profileId, credits: 100, reason: REASON })).rejects.toThrow(/Core/);
    await admin.as.mutation(api.adminBilling.setPlan, { profileId: user.profileId, plan: "pro", interval: "month", reason: REASON });
    await expect(admin.as.mutation(api.adminBilling.grantCredits, { profileId: user.profileId, credits: 100, reason: "short" })).rejects.toThrow(/reason/);
    await expect(admin.as.mutation(api.adminBilling.grantCredits, { profileId: user.profileId, credits: 0, reason: REASON })).rejects.toThrow(/between 1 and/);
    await expect(admin.as.mutation(api.adminBilling.grantCredits, { profileId: user.profileId, credits: 100_000, reason: REASON })).rejects.toThrow(/between 1 and/);
    await admin.as.mutation(api.adminBilling.grantCredits, { profileId: user.profileId, credits: 300, months: 3, reason: REASON });
    const mine = await user.as.query(api.billing.mine, {});
    expect(mine.credits).toMatchObject({ allowance: 180, packCredits: 300, available: 480 });
    const pack = await t.run(async (ctx) => (await ctx.db.query("aiCreditPacks").collect())[0]!);
    expect(pack).toMatchObject({ source: "admin", credits: 300 });
    expect(pack.expiresAt - Date.now()).toBeGreaterThan(85 * DAY_MS);
    expect(pack.expiresAt - Date.now()).toBeLessThan(95 * DAY_MS);
    await admin.as.mutation(api.adminBilling.setStorageOverride, { profileId: user.profileId, gigabytes: 200, reason: REASON });
    expect((await user.as.query(api.billing.mine, {})).entitlements.storageBytes).toBe(200 * GB);
    await expect(admin.as.mutation(api.adminBilling.setPlan, { profileId: user.profileId, plan: "pro_ai", until: Date.now() - 1, reason: REASON })).rejects.toThrow(/future/);

    // Refunds: owner only; a refunded pack's unused credits go.
    await user.as.mutation(api.billing.testBuyCredits, { pack: "credits_500", scope: PERSONAL });
    expect((await user.as.query(api.billing.mine, {})).credits.packCredits).toBe(800);
    const paymentId = (await user.as.query(api.billing.mine, {})).payments.find((p) => p.plan === "credits")!.id;
    await expect(admin.as.mutation(api.adminBilling.markRefunded, { paymentId, reason: REASON })).rejects.toThrow(/not_found/);
    await owner.as.mutation(api.adminBilling.markRefunded, { paymentId, reason: REASON });
    const after = await user.as.query(api.billing.mine, {});
    expect(after.payments.find((p) => p.id === paymentId)!.status).toBe("refunded");
    expect(after.credits.packCredits).toBe(300);

    const log = await owner.as.query(api.admin.auditLog, {});
    const grant = log.entries.find((e) => e.action === "billing.grant_credits");
    expect(grant).toMatchObject({ reason: REASON });
    expect(log.entries.map((e) => e.action)).toEqual(expect.arrayContaining(["billing.set_plan", "billing.grant_credits", "billing.set_storage", "billing.mark_refunded"]));
    const view = await admin.as.mutation(api.adminBilling.userBilling, { profileId: user.profileId });
    expect(view.packs.map((p) => [p.source, p.credits])).toEqual(expect.arrayContaining([["admin", 300], ["test", 500]]));
    // Revenue counts real payments only unless asked to include test ones (a manual plan counts as paying).
    const real = await admin.as.query(api.adminAnalytics.revenue, { months: 12 });
    expect(real.paying).toBe(1);
    expect(real.revenueByMonth.at(-1)!.creditPacksCents).toBe(0);
    const revenue = await admin.as.query(api.adminAnalytics.revenue, { months: 12, includeTest: true });
    expect(revenue.revenueByMonth.at(-1)!.creditPacksCents).toBe(799);
  });

  test("the users list shows each person's plan; plans billed through Polar are flagged and refused", async () => {
    const t = setup();
    const admin = await person(t, "lister@example.com");
    const user = await person(t, "upgraded@example.com");
    await withRole(t, admin, "ops_admin");
    const row = async () => (await admin.as.mutation(api.admin.searchUsers, { query: "upgraded@example.com" })).users[0]!;
    expect(await row()).toMatchObject({ plan: "free", trialing: true, interval: null, planEndsAt: null, billedBy: "none", polarBilled: false });
    const until = Date.now() + 30 * DAY_MS;
    await admin.as.mutation(api.adminBilling.setPlan, { profileId: user.profileId, plan: "pro_ai", interval: "year", until, reason: REASON });
    expect(await row()).toMatchObject({ plan: "pro_ai", interval: "year", planEndsAt: until, billedBy: "manual", polarBilled: false, ai: true });
    await admin.as.mutation(api.adminBilling.setPlan, { profileId: user.profileId, plan: "free", reason: REASON });
    expect(await row()).toMatchObject({ plan: "free", interval: null, planEndsAt: null, billedBy: "none" });
    withPolar();
    await postEvent(t, "subscription.created", subscription({ id: "sub_admin", productKey: "personal_core_monthly", metadata: { kind: "personal", profileId: user.profileId } }));
    expect(await row()).toMatchObject({ plan: "core", interval: "month", billedBy: "polar", polarBilled: true });
    expect((await admin.as.mutation(api.adminBilling.userBilling, { profileId: user.profileId })).polarBilled).toBe(true);
    await expect(admin.as.mutation(api.adminBilling.setPlan, { profileId: user.profileId, plan: "pro", reason: REASON })).rejects.toThrow(/billed through Polar/);
    const log = await admin.as.query(api.admin.auditLog, {});
    expect(log.entries.filter((e) => e.action === "billing.set_plan")).toHaveLength(2);
  });

  test("staff can prepare an export for someone: it's delivered to that person only, never to staff", async () => {
    vi.useFakeTimers();
    const t = setup();
    const staff = await person(t, "helper@example.com");
    const user = await person(t, "exporter@example.com");
    await withRole(t, staff, "support_admin");
    await staff.as.mutation(api.adminBilling.requestUserExport, { profileId: user.profileId, reason: REASON });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const theirs = await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.fileId));
    expect(theirs).toHaveLength(1);
    expect(theirs[0]!.profileId).toBe(user.profileId);
    const view = await staff.as.mutation(api.adminBilling.userBilling, { profileId: user.profileId });
    expect(JSON.stringify(view)).not.toContain(theirs[0]!.fileId!);
  });
});

describe("the January 2027 plan migration", () => {
  test("old tiers are rewritten (Basic → Core, Pro → Pro AI, Team → Pro, Business → Pro AI), in batches, once", async () => {
    vi.useFakeTimers();
    const t = setup();
    const people = [await person(t, "m-basic@example.com"), await person(t, "m-pro@example.com"), await person(t, "m-free@example.com")];
    const [basic, pro] = people;
    const { id: teamWs } = await basic!.as.mutation(api.workspaces.createTeamWorkspace, { name: "Old team" });
    const { id: bizWs } = await basic!.as.mutation(api.workspaces.createTeamWorkspace, { name: "Old business" });
    // Rows as they were stored before January 2027 (no catalogVersion).
    await t.run(async (ctx) => {
      for (const s of await ctx.db.query("subscriptions").collect()) await ctx.db.patch(s._id, { catalogVersion: undefined });
      const set = async (p: Person, plan: "basic" | "pro") => {
        const s = (await ctx.db.query("subscriptions").withIndex("by_profile", (q) => q.eq("profileId", p.profileId as Id<"profiles">)).unique())!;
        await ctx.db.patch(s._id, { plan, interval: "month", status: "active", provider: "manual", trialEndsAt: Date.now() - 1 });
      };
      await set(basic!, "basic");
      await set(pro!, "pro");
      const now = Date.now();
      for (const [publicId, planId] of [[teamWs, "workspace_team_yearly"], [bizWs, "workspace_business_monthly"]] as const) {
        const w = (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique())!;
        await ctx.db.insert("subscriptions", { ownerType: "workspace", workspaceId: w._id, planId, status: "active", provider: "manual", quantity: 1, createdAt: now, updatedAt: now });
        await ctx.db.insert("payments", { workspaceId: w._id, amountCents: 4900, currency: "usd", plan: planId.includes("team") ? "team" : "business", planId, interval: "year", status: "paid", provider: "manual", createdAt: now });
      }
      await ctx.db.insert("payments", { profileId: pro!.profileId as Id<"profiles">, amountCents: 500, currency: "usd", plan: "pro", interval: "month", status: "paid", provider: "manual", createdAt: now });
      await ctx.db.insert("payments", { profileId: basic!.profileId as Id<"profiles">, amountCents: 200, currency: "usd", plan: "basic", interval: "month", status: "paid", provider: "manual", createdAt: now });
    });
    // Before the migration the old rows already read as today's plans (the schema deploys on old data).
    expect((await basic!.as.query(api.billing.mine, {})).entitlements.paidPlan).toBe("core");
    expect((await pro!.as.query(api.billing.mine, {})).entitlements.paidPlan).toBe("pro_ai");
    expect((await basic!.as.query(api.workspaceBilling.summary, { workspaceId: teamWs })).entitlements.planId).toBe("workspace_pro_yearly");
    const before = await t.query(internal.migrations.planTierReport, {});
    expect(before.subscriptions).toBeGreaterThanOrEqual(5);
    expect(before.payments).toBe(4);
    // A dry run changes nothing.
    const dry = await t.mutation(internal.migrations.migratePlanTiers, { dryRun: true });
    expect(dry.changes).toEqual(expect.arrayContaining(["subscriptions: basic → core", "subscriptions: pro → pro_ai", "subscriptions: workspace_team_yearly → workspace_pro_yearly", "subscriptions: workspace_business_monthly → workspace_pro_ai_monthly"]));
    expect(await t.query(internal.migrations.planTierReport, {})).toEqual(before);
    await t.mutation(internal.migrations.migratePlanTiers, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(internal.migrations.planTierReport, {})).toEqual({ subscriptions: 0, payments: 0 });
    const subs = await t.run(async (ctx) => ctx.db.query("subscriptions").collect());
    expect(subs.find((s) => s.profileId === basic!.profileId)).toMatchObject({ plan: "core", catalogVersion: 2 });
    expect(subs.find((s) => s.profileId === pro!.profileId)).toMatchObject({ plan: "pro_ai", catalogVersion: 2 });
    expect(subs.filter((s) => s.ownerType === "workspace" && s.planId !== "workspace_free").map((s) => s.planId).sort()).toEqual(["workspace_pro_ai_monthly", "workspace_pro_yearly"]);
    const payments = await t.run(async (ctx) => ctx.db.query("payments").collect());
    expect(payments.map((p) => p.plan).sort()).toEqual(["core", "pro", "pro_ai", "pro_ai"]);
    expect(payments.every((p) => p.catalogVersion === 2)).toBe(true);
    // Nobody's plan changed meaning, and running it again changes nothing.
    expect((await basic!.as.query(api.billing.mine, {})).entitlements.paidPlan).toBe("core");
    expect((await pro!.as.query(api.billing.mine, {})).entitlements.paidPlan).toBe("pro_ai");
    const again = await t.mutation(internal.migrations.migratePlanTiers, {});
    expect(again.changed).toBe(0);
  });
});

describe("device limits", () => {
  async function anotherDevice(t: T, p: Person, email: string) {
    const sessionId = await authSession(t, p.userId, "Mozilla/5.0 (iPhone) Safari/18");
    return { as: t.withIdentity(identity(email, { subject: p.userId, tokenIdentifier: `https://test.folevi.local|${p.userId}`, sessionId })), sessionId };
  }

  test("Free allows 2 devices: a third is held (and refused) until one signs out", async () => {
    vi.useFakeTimers();
    const t = setup();
    const a = await person(t, "devices@example.com");
    await endTrial(t, a);
    vi.advanceTimersByTime(1000);
    const second = await anotherDevice(t, a, "devices@example.com");
    vi.advanceTimersByTime(1000);
    const third = await anotherDevice(t, a, "devices@example.com");
    expect((await a.as.query(api.users.me, {})).state).toBe("ready");
    expect((await second.as.query(api.users.me, {})).state).toBe("ready");
    expect(await third.as.query(api.users.me, {})).toMatchObject({ state: "device_limit", limit: 2, active: 3 });
    await expect(third.as.mutation(api.users.updateProfile, { displayName: "Held" })).rejects.toThrow(/device_limit/);
    await third.as.mutation(api.users.revokeSession, { sessionId: second.sessionId });
    expect((await third.as.query(api.users.me, {})).state).toBe("ready");
    expect((await third.as.query(api.billing.mine, {})).devicesActive).toBe(2);
  });

  test("the Pro AI trial, Core, Pro and Pro AI have unlimited devices; upgrading frees a held device", async () => {
    vi.useFakeTimers();
    const t = setup();
    const a = await person(t, "many-devices@example.com");
    const extra = [];
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(1000);
      extra.push(await anotherDevice(t, a, "many-devices@example.com"));
    }
    for (const d of extra) expect((await d.as.query(api.users.me, {})).state).toBe("ready");
    expect((await a.as.query(api.billing.mine, {})).entitlements.devices).toBeNull();
    await endTrial(t, a);
    expect((await extra[2]!.as.query(api.users.me, {})).state).toBe("device_limit");
    await extra[2]!.as.mutation(api.billing.testPurchase, { plan: "core", interval: "month" });
    expect((await extra[2]!.as.query(api.users.me, {})).state).toBe("ready");
  });

  test("admins can set a device limit for someone (audited); support staff can't", async () => {
    const t = setup();
    const admin = await person(t, "ops-devices@example.com");
    const staff = await person(t, "support-devices@example.com");
    const user = await person(t, "limited@example.com");
    await withRole(t, admin, "ops_admin");
    await withRole(t, staff, "support_admin");
    await endTrial(t, user);
    await expect(staff.as.mutation(api.adminBilling.setDeviceLimit, { profileId: user.profileId, devices: 5, reason: REASON })).rejects.toThrow(/not_found/);
    await admin.as.mutation(api.adminBilling.setDeviceLimit, { profileId: user.profileId, devices: 5, reason: REASON });
    expect((await user.as.query(api.billing.mine, {})).entitlements.devices).toBe(5);
    await admin.as.mutation(api.adminBilling.setDeviceLimit, { profileId: user.profileId, devices: "unlimited", reason: REASON });
    expect((await user.as.query(api.billing.mine, {})).entitlements.devices).toBeNull();
    await admin.as.mutation(api.adminBilling.setDeviceLimit, { profileId: user.profileId, devices: null, reason: REASON });
    expect((await user.as.query(api.billing.mine, {})).entitlements.devices).toBe(2);
  });
});

