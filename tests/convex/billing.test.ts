import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { verifyStripeSignature } from "../../convex/billing";
import { DAY_MS, PLAN_CATALOG, PLANS, TRIAL_DAYS, WORKSPACE_PLANS, monthlyEquivalent, personalEntitlementsOf, personalPlanId, workspaceEntitlementsOf } from "../../convex/lib/plans";
import { authSession, identity, person, setup, ulid, type T } from "./helpers";

const MB = 1024 ** 2;
const GB = 1024 ** 3;
type Person = Awaited<ReturnType<typeof person>>;

async function newDoc(p: Person) {
  const id = ulid();
  await p.as.mutation(api.sync.push, {
    workspaceId: p.workspaceId,
    deviceId: "device-billing",
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title: "Doc", icon: null } }],
  });
  return id;
}

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

const REASON = "Customer support ticket 4321";

describe("plans and entitlements", () => {
  test("the rules: trial is Pro, grants give AI, lapsed plans fall back to Free", () => {
    const now = Date.now();
    expect(personalEntitlementsOf(null, now)).toMatchObject({ scope: "personal", planId: "personal_free", plan: "free", paid: false, ai: false, storageBytes: 1 * GB, devices: 2 });
    const trial = personalEntitlementsOf({ plan: "free", status: "active", trialEndsAt: now + DAY_MS }, now);
    expect(trial).toMatchObject({ planId: "personal_pro_monthly", paidPlanId: "personal_free", plan: "pro", paidPlan: "free", paid: false, trialing: true, ai: true, aiSource: "trial", storageBytes: 100 * GB });
    expect(personalEntitlementsOf({ plan: "free", status: "active", trialEndsAt: now - 1 }, now)).toMatchObject({ plan: "free", trialing: false, ai: false });
    expect(personalEntitlementsOf({ plan: "basic", status: "active", currentPeriodEnd: now + DAY_MS }, now)).toMatchObject({ planId: "personal_basic_monthly", plan: "basic", paid: true, ai: false, storageBytes: 20 * GB });
    expect(personalEntitlementsOf({ plan: "basic", interval: "year", status: "active" }, now)).toMatchObject({ planId: "personal_basic_yearly" });
    expect(personalEntitlementsOf({ plan: "basic", status: "active", currentPeriodEnd: now - 1 }, now)).toMatchObject({ plan: "free", paid: false });
    expect(personalEntitlementsOf({ plan: "pro", status: "canceled", currentPeriodEnd: now + DAY_MS }, now)).toMatchObject({ plan: "pro", ai: true });
    expect(personalEntitlementsOf({ plan: "free", status: "active", aiGrant: true }, now)).toMatchObject({ plan: "free", ai: true, aiSource: "grant" });
    expect(personalEntitlementsOf({ plan: "free", status: "active", aiGrant: true, aiGrantUntil: now - 1 }, now)).toMatchObject({ ai: false });
    expect(personalEntitlementsOf({ plan: "free", status: "active", storageOverrideBytes: 5 * GB }, now).storageBytes).toBe(5 * GB);
  });

  test("the catalog: exact prices, scopes, billing models and entitlements", () => {
    const price = (id: keyof typeof PLAN_CATALOG) => PLAN_CATALOG[id].priceCents;
    expect([price("personal_free"), price("personal_basic_monthly"), price("personal_basic_yearly"), price("personal_pro_monthly"), price("personal_pro_yearly")]).toEqual([0, 200, 900, 500, 4900]);
    expect([price("workspace_free"), price("workspace_team_monthly"), price("workspace_team_yearly"), price("workspace_business_monthly"), price("workspace_business_yearly")]).toEqual([0, 500, 4900, 1000, 9900]);
    for (const plan of Object.values(PLAN_CATALOG)) {
      expect(plan.id.startsWith(plan.scope)).toBe(true);
      expect(plan.currency).toBe("usd");
      if (plan.priceCents === 0) expect(plan.billingModel).toBe("free");
      else expect(plan.billingModel).toBe(plan.scope === "personal" ? "flat_user" : "per_seat");
    }
    const e = (id: keyof typeof PLAN_CATALOG) => PLAN_CATALOG[id].entitlements;
    expect([e("personal_free").storageBytes, e("personal_basic_yearly").storageBytes, e("personal_pro_monthly").storageBytes]).toEqual([1 * GB, 20 * GB, 100 * GB]);
    expect([e("personal_free").devices, e("personal_basic_monthly").devices, e("personal_pro_yearly").devices]).toEqual([2, null, null]);
    expect([e("personal_free").aiAssistant, e("personal_basic_monthly").aiAssistant, e("personal_pro_monthly").aiAssistant]).toEqual([false, false, true]);
    expect([e("workspace_free").storageBytes, e("workspace_team_monthly").storageBytes, e("workspace_business_yearly").storageBytes]).toEqual([5 * GB, 100 * GB, 1024 * GB]);
    expect([e("workspace_free").aiAssistant, e("workspace_team_yearly").aiAssistant, e("workspace_business_monthly").aiAssistant]).toEqual([false, true, true]);
    expect(e("workspace_business_monthly").aiFairUse).toBe("high");
    // Features that don't exist yet aren't promised by any plan.
    for (const plan of Object.values(PLAN_CATALOG)) expect(plan.entitlements).toMatchObject({ auditLog: false, workspaceAnalytics: false, securityControls: false, advancedPermissions: false, prioritySupport: false, members: null, guests: null });
    // Stored tiers map to catalog ids; display cards read the catalog.
    expect([personalPlanId("free"), personalPlanId("basic"), personalPlanId("pro", "year")]).toEqual(["personal_free", "personal_basic_monthly", "personal_pro_yearly"]);
    expect([PLANS.basic.monthlyCents, PLANS.basic.yearlyCents, PLANS.pro.monthlyCents, PLANS.pro.yearlyCents]).toEqual([200, 900, 500, 4900]);
    expect([monthlyEquivalent(PLANS.basic.yearlyCents), monthlyEquivalent(PLANS.pro.yearlyCents)]).toEqual(["$0.75", "$4.08"]);
    expect(PLANS.free.features).toContain("1 GB personal storage");
    expect(Object.values(PLANS).flatMap((p) => p.features).join(" ")).not.toMatch(/across|iOS/);
    expect([WORKSPACE_PLANS.team.monthlyCents, WORKSPACE_PLANS.team.yearlyCents, WORKSPACE_PLANS.business.monthlyCents, WORKSPACE_PLANS.business.yearlyCents]).toEqual([500, 4900, 1000, 9900]);
    expect([WORKSPACE_PLANS.team.available, WORKSPACE_PLANS.business.available]).toEqual([false, false]);
  });

  test("workspace entitlements: Free without a subscription; a paid plan while in force; an admin override replaces storage", () => {
    const now = Date.now();
    expect(workspaceEntitlementsOf(null, {}, now)).toMatchObject({ scope: "workspace", planId: "workspace_free", paid: false, ai: false, storageBytes: 5 * GB, storageOverridden: false });
    expect(workspaceEntitlementsOf({ tier: "business", interval: "year", status: "active", currentPeriodEnd: now + DAY_MS }, {}, now)).toMatchObject({ planId: "workspace_business_yearly", ai: true, aiFairUse: "high", storageBytes: 1024 * GB });
    expect(workspaceEntitlementsOf({ tier: "team", status: "canceled", currentPeriodEnd: now + DAY_MS }, {}, now)).toMatchObject({ planId: "workspace_team_monthly", ai: true });
    expect(workspaceEntitlementsOf({ tier: "team", status: "active", currentPeriodEnd: now - 1 }, {}, now)).toMatchObject({ planId: "workspace_free", ai: false });
    expect(workspaceEntitlementsOf(null, { storageBytes: 50 * GB }, now)).toMatchObject({ storageBytes: 50 * GB, storageOverridden: true });
  });

  test("new accounts start on Free with a 7-day Pro trial", async () => {
    const t = setup();
    const a = await person(t, "trial@example.com");
    const mine = await a.as.query(api.billing.mine, {});
    expect(mine.entitlements).toMatchObject({ plan: "pro", paidPlan: "free", trialing: true, ai: true });
    expect(mine.entitlements.trialEndsAt! - Date.now()).toBeGreaterThan((TRIAL_DAYS - 1) * DAY_MS);
    expect(mine.entitlements.trialEndsAt! - Date.now()).toBeLessThanOrEqual(TRIAL_DAYS * DAY_MS);
  });

  test("after the trial, Free has no AI: the server refuses before anything is sent", async () => {
    const t = setup();
    const a = await person(t, "no-ai@example.com");
    const sub = await subOf(t, a);
    await t.run(async (ctx) => ctx.db.patch(sub!._id, { trialEndsAt: Date.now() - 1 }));
    await expect(a.as.mutation(internal.ai.begin, { workspaceId: a.workspaceId })).rejects.toThrow(/part of Pro/);
    expect(await t.run(async (ctx) => ctx.db.query("aiUsage").collect())).toHaveLength(0);
    // An admin grant turns it back on.
    await t.run(async (ctx) => ctx.db.patch(sub!._id, { aiGrant: true }));
    await a.as.mutation(internal.ai.begin, { workspaceId: a.workspaceId });
  });

  test("personal storage counts only Personal, against the Personal plan (team workspaces never add to it)", async () => {
    const t = setup();
    const a = await person(t, "storage@example.com");
    const sub = await subOf(t, a);
    await t.run(async (ctx) => ctx.db.patch(sub!._id, { trialEndsAt: Date.now() - 1 }));
    const docId = await newDoc(a);
    const { id: teamId } = await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Team" });
    // 1010 MB in Personal (of the Free plan's 1024 MB) and 4 GB in the team workspace.
    await t.run(async (ctx) => {
      for (const w of await ctx.db.query("workspaces").collect()) {
        if (w.ownerId !== a.profileId) continue;
        await ctx.db.patch(w._id, { storageUsedBytes: w.publicId === teamId ? 4 * GB : 1010 * MB });
      }
    });
    const upload = (size: number) => a.as.mutation(api.files.generateUploadUrl, { workspaceId: a.workspaceId, documentId: docId, filename: "a.png", size, mimeType: "image/png", kind: "image" });
    await expect(upload(15 * MB)).rejects.toThrow(/personal storage on your Free plan/);
    expect((await upload(10 * MB)).uploadUrl).toBeTruthy();
    // Basic has room.
    await a.as.mutation(api.billing.testPurchase, { plan: "basic", interval: "month" });
    expect((await upload(15 * MB)).uploadUrl).toBeTruthy();
    const mine = await a.as.query(api.billing.mine, {});
    expect(mine.storageUsedBytes).toBe(1010 * MB);
    expect(mine.storageLimitBytes).toBe(20 * GB);
  });

  test("test purchases work in development, are recorded, can be canceled — and are refused in production", async () => {
    const t = setup();
    const a = await person(t, "buyer@example.com");
    await a.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "year" });
    let mine = await a.as.query(api.billing.mine, {});
    expect(mine.entitlements).toMatchObject({ plan: "pro", paidPlan: "pro", trialing: false });
    expect(mine.payments[0]).toMatchObject({ amountCents: 4900, plan: "pro", interval: "year", status: "paid" });
    await a.as.mutation(api.billing.cancelPlan, {});
    mine = await a.as.query(api.billing.mine, {});
    expect(mine.subscription?.cancelAtPeriodEnd).toBe(true);
    // At period end the hourly job moves them to Free.
    const sub = await subOf(t, a);
    await t.run(async (ctx) => ctx.db.patch(sub!._id, { currentPeriodEnd: Date.now() - 1 }));
    await t.mutation(internal.billing.settleExpiredPlans, {});
    expect((await a.as.query(api.billing.mine, {})).entitlements.paidPlan).toBe("free");

    process.env.FOLEVI_ENV = "production";
    try {
      await expect(a.as.mutation(api.billing.testPurchase, { plan: "basic", interval: "month" })).rejects.toThrow(/only available in development/);
      expect((await a.as.query(api.billing.mine, {})).testPurchases).toBe(false);
    } finally {
      process.env.FOLEVI_ENV = "test";
    }
  });
});

describe("Stripe", () => {
  async function sign(body: string, secret: string, t = Math.floor(Date.now() / 1000)) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
    return `t=${t},v1=${[...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  }

  test("webhook signatures are checked (secret, body and age)", async () => {
    const body = '{"type":"invoice.paid"}';
    const header = await sign(body, "whsec_test");
    expect(await verifyStripeSignature(body, header, "whsec_test")).toBe(true);
    expect(await verifyStripeSignature(body, header, "whsec_other")).toBe(false);
    expect(await verifyStripeSignature(`${body} `, header, "whsec_test")).toBe(false);
    expect(await verifyStripeSignature(body, null, "whsec_test")).toBe(false);
    expect(await verifyStripeSignature(body, header, "")).toBe(false);
    const old = await sign(body, "whsec_test", Math.floor(Date.now() / 1000) - 3600);
    expect(await verifyStripeSignature(body, old, "whsec_test")).toBe(false);
  });

  test("the webhook route rejects unsigned requests", async () => {
    const t = setup();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    try {
      const res = await t.fetch("/webhooks/stripe", { method: "POST", body: '{"type":"invoice.paid","data":{"object":{}}}' });
      expect(res.status).toBe(400);
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    }
  });

  test("subscription events set the plan; invoices are recorded once; refunds and cancellations apply", async () => {
    const t = setup();
    const a = await person(t, "stripe@example.com");
    process.env.STRIPE_PRICE_PRO_MONTH = "price_pro_m";
    try {
      const end = Math.floor((Date.now() + 30 * DAY_MS) / 1000);
      await t.mutation(internal.billing.applyStripeEvent, { type: "checkout.session.completed", object: { client_reference_id: a.profileId, customer: "cus_1", subscription: "sub_1" } });
      await t.mutation(internal.billing.applyStripeEvent, {
        type: "customer.subscription.updated",
        object: { object: "subscription", id: "sub_1", customer: "cus_1", status: "active", current_period_end: end, cancel_at_period_end: false, items: { data: [{ price: { id: "price_pro_m" } }] } },
      });
      let mine = await a.as.query(api.billing.mine, {});
      expect(mine.entitlements).toMatchObject({ paidPlan: "pro", ai: true });
      expect(mine.subscription).toMatchObject({ provider: "stripe", interval: "month" });
      const invoice = { id: "in_1", subscription: "sub_1", customer: "cus_1", amount_paid: 500, currency: "usd" };
      await t.mutation(internal.billing.applyStripeEvent, { type: "invoice.paid", object: invoice });
      await t.mutation(internal.billing.applyStripeEvent, { type: "invoice.paid", object: invoice });
      mine = await a.as.query(api.billing.mine, {});
      expect(mine.payments).toHaveLength(1);
      await t.mutation(internal.billing.applyStripeEvent, { type: "charge.refunded", object: { invoice: "in_1", customer: "cus_1" } });
      expect((await a.as.query(api.billing.mine, {})).payments[0]!.status).toBe("refunded");
      await t.mutation(internal.billing.applyStripeEvent, { type: "customer.subscription.deleted", object: { object: "subscription", id: "sub_1", customer: "cus_1", status: "canceled", current_period_end: end } });
      expect((await a.as.query(api.billing.mine, {})).entitlements.paidPlan).toBe("free");
      // Stripe-billed plans can't be canceled from the app's own button.
      await t.mutation(internal.billing.applyStripeEvent, {
        type: "customer.subscription.updated",
        object: { object: "subscription", id: "sub_1", customer: "cus_1", status: "active", current_period_end: end, items: { data: [{ price: { id: "price_pro_m" } }] } },
      });
      await expect(a.as.mutation(api.billing.cancelPlan, {})).rejects.toThrow(/billing portal/);
    } finally {
      delete process.env.STRIPE_PRICE_PRO_MONTH;
    }
  });

  test("a redelivered event is applied once, so the state stays correct (scenario 34)", async () => {
    const t = setup();
    const a = await person(t, "dup@example.com");
    process.env.STRIPE_PRICE_PRO_MONTH = "price_pro_m";
    try {
      const sec = Math.floor(Date.now() / 1000);
      const end = sec + 30 * 86_400;
      const active = { object: "subscription", id: "sub_d", customer: "cus_d", status: "active", current_period_end: end, cancel_at_period_end: false, metadata: { profileId: a.profileId }, items: { data: [{ price: { id: "price_pro_m" } }] } };
      const failed = { id: "in_d1", subscription: "sub_d", customer: "cus_d", amount_due: 500, currency: "usd" };
      expect(await t.mutation(internal.billing.applyStripeEvent, { eventId: "evt_1", created: sec, type: "customer.subscription.created", object: active })).toEqual({ status: "applied" });
      expect(await t.mutation(internal.billing.applyStripeEvent, { eventId: "evt_2", created: sec + 1, type: "invoice.payment_failed", object: failed })).toEqual({ status: "applied" });
      // The customer fixes their card: paid, and the subscription is active again.
      await t.mutation(internal.billing.applyStripeEvent, { eventId: "evt_3", created: sec + 2, type: "invoice.paid", object: { ...failed, amount_paid: 500 } });
      await t.mutation(internal.billing.applyStripeEvent, { eventId: "evt_4", created: sec + 2, type: "customer.subscription.updated", object: active });
      expect((await a.as.query(api.billing.mine, {})).subscription?.status).toBe("active");
      // Stripe redelivers the failure (and the others): nothing changes.
      expect(await t.mutation(internal.billing.applyStripeEvent, { eventId: "evt_2", created: sec + 1, type: "invoice.payment_failed", object: failed })).toEqual({ status: "duplicate" });
      expect(await t.mutation(internal.billing.applyStripeEvent, { eventId: "evt_3", created: sec + 2, type: "invoice.paid", object: { ...failed, amount_paid: 500 } })).toEqual({ status: "duplicate" });
      const mine = await a.as.query(api.billing.mine, {});
      expect(mine.subscription?.status).toBe("active");
      expect(mine.entitlements).toMatchObject({ paidPlan: "pro", ai: true });
      expect(mine.payments).toHaveLength(1);
      expect(mine.payments[0]!.status).toBe("paid");
      expect(await t.run(async (ctx) => (await ctx.db.query("billingEvents").collect()).length)).toBe(4);
    } finally {
      delete process.env.STRIPE_PRICE_PRO_MONTH;
    }
  });

  test("a subscription event older than the last one applied is ignored (out of order)", async () => {
    const t = setup();
    const a = await person(t, "order@example.com");
    process.env.STRIPE_PRICE_PRO_MONTH = "price_pro_m";
    process.env.STRIPE_PRICE_BASIC_MONTH = "price_basic_m";
    try {
      const sec = Math.floor(Date.now() / 1000);
      const end = sec + 30 * 86_400;
      const sub = (price: string, extra: Record<string, unknown> = {}) => ({ object: "subscription", id: "sub_o", customer: "cus_o", status: "active", current_period_end: end, metadata: { profileId: a.profileId }, items: { data: [{ price: { id: price } }] }, ...extra });
      await t.mutation(internal.billing.applyStripeEvent, { eventId: "evt_new", created: sec + 10, type: "customer.subscription.updated", object: sub("price_pro_m") });
      // An upgrade made later, delivered first; then the older Basic event arrives.
      expect(await t.mutation(internal.billing.applyStripeEvent, { eventId: "evt_old", created: sec, type: "customer.subscription.updated", object: sub("price_basic_m") })).toEqual({ status: "stale" });
      expect((await a.as.query(api.billing.mine, {})).entitlements.paidPlan).toBe("pro");
      // A newer event still applies (same second counts as newer or equal).
      await t.mutation(internal.billing.applyStripeEvent, { eventId: "evt_newer", created: sec + 10, type: "customer.subscription.updated", object: sub("price_pro_m", { cancel_at_period_end: true }) });
      expect((await a.as.query(api.billing.mine, {})).subscription?.cancelAtPeriodEnd).toBe(true);
      const row = await subOf(t, a);
      expect(row!.stripeEventCreatedAt).toBe(sec + 10);
    } finally {
      delete process.env.STRIPE_PRICE_PRO_MONTH;
      delete process.env.STRIPE_PRICE_BASIC_MONTH;
    }
  });
});

describe("admin: billing, tiers and analytics", () => {
  test("support staff can look people up and give short trials, but not set plans, grant AI or see revenue", async () => {
    const t = setup();
    const staff = await person(t, "support@example.com");
    const user = await person(t, "customer@example.com");
    await withRole(t, staff, "support_admin");
    const view = await staff.as.mutation(api.adminBilling.userBilling, { profileId: user.profileId });
    expect(view.entitlements.trialing).toBe(true);
    await expect(staff.as.mutation(api.adminBilling.extendTrial, { profileId: user.profileId, days: 30, reason: REASON })).rejects.toThrow(/between 1 and 14/);
    await staff.as.mutation(api.adminBilling.extendTrial, { profileId: user.profileId, days: 14, reason: REASON });
    await expect(staff.as.mutation(api.adminBilling.extendTrial, { profileId: user.profileId, days: 3, reason: "short" })).rejects.toThrow(/reason/);
    await expect(staff.as.mutation(api.adminBilling.setPlan, { profileId: user.profileId, plan: "pro", reason: REASON })).rejects.toThrow(/not_found/);
    await expect(staff.as.mutation(api.adminBilling.setAiGrant, { profileId: user.profileId, grant: true, reason: REASON })).rejects.toThrow(/not_found/);
    await expect(staff.as.mutation(api.adminBilling.setStorageOverride, { profileId: user.profileId, gigabytes: 5, reason: REASON })).rejects.toThrow(/not_found/);
    await expect(staff.as.mutation(api.admin.suspendUser, { profileId: user.profileId, suspend: true, confirmEmail: "customer@example.com", reason: REASON })).rejects.toThrow(/not_found/);
    await expect(staff.as.query(api.adminAnalytics.revenue, { months: 12 })).rejects.toThrow(/not_found/);
    const users = await staff.as.query(api.adminAnalytics.users, { days: 30 });
    expect(users.totals.users).toBe(2);
    expect(users.trialing).toBe(2);
    // Regular people can't reach any of it.
    await expect(user.as.mutation(api.adminBilling.userBilling, { profileId: user.profileId })).rejects.toThrow(/not_found/);
    await expect(user.as.query(api.adminAnalytics.users, { days: 30 })).rejects.toThrow(/not_found/);
  });

  test("admins set plans, grant AI and storage (audited); owners alone mark refunds", async () => {
    const t = setup();
    const admin = await person(t, "ops@example.com");
    const owner = await person(t, "owner@example.com");
    const user = await person(t, "comped@example.com");
    await withRole(t, admin, "ops_admin");
    await withRole(t, owner, "super_admin");
    const sub = await subOf(t, user);
    await t.run(async (ctx) => ctx.db.patch(sub!._id, { trialEndsAt: Date.now() - 1 }));

    await admin.as.mutation(api.adminBilling.setPlan, { profileId: user.profileId, plan: "basic", interval: "year", reason: REASON });
    expect((await user.as.query(api.billing.mine, {})).entitlements).toMatchObject({ plan: "basic", ai: false });
    await admin.as.mutation(api.adminBilling.setAiGrant, { profileId: user.profileId, grant: true, until: Date.now() + DAY_MS, reason: REASON });
    expect((await user.as.query(api.billing.mine, {})).entitlements).toMatchObject({ ai: true, aiSource: "grant" });
    await admin.as.mutation(api.adminBilling.setStorageOverride, { profileId: user.profileId, gigabytes: 200, reason: REASON });
    expect((await user.as.query(api.billing.mine, {})).entitlements.storageBytes).toBe(200 * GB);
    await expect(admin.as.mutation(api.adminBilling.setPlan, { profileId: user.profileId, plan: "pro", until: Date.now() - 1, reason: REASON })).rejects.toThrow(/future/);

    // Refunds: owner only.
    await user.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "month" });
    const paymentId = (await user.as.query(api.billing.mine, {})).payments[0]!.id;
    await expect(admin.as.mutation(api.adminBilling.markRefunded, { paymentId, reason: REASON })).rejects.toThrow(/not_found/);
    await owner.as.mutation(api.adminBilling.markRefunded, { paymentId, reason: REASON });
    expect((await user.as.query(api.billing.mine, {})).payments[0]!.status).toBe("refunded");

    // Revenue counts real payments only unless asked to include test ones.
    expect((await admin.as.query(api.adminAnalytics.revenue, { months: 12 })).paying).toBe(0);
    expect((await admin.as.query(api.adminAnalytics.revenue, { months: 12, includeTest: true })).paying).toBe(1);

    const log = await owner.as.query(api.admin.auditLog, {});
    expect(log.entries.map((e) => e.action)).toEqual(expect.arrayContaining(["billing.set_plan", "billing.grant_ai", "billing.set_storage", "billing.mark_refunded"]));
  });

  test("owner-only: platform roles and maintenance mode", async () => {
    const t = setup();
    const admin = await person(t, "ops2@example.com");
    const user = await person(t, "plain@example.com");
    await withRole(t, admin, "ops_admin");
    await expect(admin.as.mutation(api.admin.setPlatformRole, { profileId: user.profileId, role: "support_admin", confirmEmail: "plain@example.com", reason: REASON })).rejects.toThrow(/not_found/);
    await expect(admin.as.mutation(api.admin.setMaintenance, { bannerMessage: "x", readOnly: true, reason: REASON })).rejects.toThrow(/not_found/);
  });

  test("staff can prepare an export for someone: it's delivered to that person only, never to staff", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const staff = await person(t, "helper@example.com");
      const user = await person(t, "exporter@example.com");
      await withRole(t, staff, "support_admin");
      await staff.as.mutation(api.adminBilling.requestUserExport, { profileId: user.profileId, reason: REASON });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const theirs = await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.fileId));
      expect(theirs).toHaveLength(1);
      expect(theirs[0]!.profileId).toBe(user.profileId);
      expect(theirs[0]!.title).toMatch(/Your export of .* is ready/);
      // Nothing in staff's view of the account carries the file or any content.
      const view = await staff.as.mutation(api.adminBilling.userBilling, { profileId: user.profileId });
      expect(JSON.stringify(view)).not.toContain(theirs[0]!.fileId!);
      expect(JSON.stringify(view)).not.toContain("quiet place for ideas");
      const staffNotifications = await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.profileId === staff.profileId && n.fileId));
      expect(staffNotifications).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("device limits", () => {
  /** Another signed-in device for the same person (a new session on their account). */
  async function anotherDevice(t: T, p: Person, email: string) {
    const sessionId = await authSession(t, p.userId, "Mozilla/5.0 (iPhone) Safari/18");
    return { as: t.withIdentity(identity(email, { subject: p.userId, tokenIdentifier: `https://test.folevi.local|${p.userId}`, sessionId })), sessionId };
  }
  async function endTrial(t: T, p: Person) {
    const sub = await subOf(t, p);
    await t.run(async (ctx) => ctx.db.patch(sub!._id, { trialEndsAt: Date.now() - 1 }));
  }

  test("Free allows 2 devices: a third is held (and refused) until one signs out", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const a = await person(t, "devices@example.com");
      await endTrial(t, a);
      vi.advanceTimersByTime(1000);
      const second = await anotherDevice(t, a, "devices@example.com");
      vi.advanceTimersByTime(1000);
      const third = await anotherDevice(t, a, "devices@example.com");
      // The first two work; the newest is held.
      expect((await a.as.query(api.users.me, {})).state).toBe("ready");
      expect((await second.as.query(api.users.me, {})).state).toBe("ready");
      expect(await third.as.query(api.users.me, {})).toMatchObject({ state: "device_limit", limit: 2, active: 3 });
      await expect(third.as.query(api.organization.sidebar, { workspaceId: a.workspaceId })).rejects.toThrow(/device_limit/);
      await expect(third.as.mutation(api.users.updateProfile, { displayName: "Held" })).rejects.toThrow(/device_limit/);
      // From the held device they can see their devices and sign one out…
      const sessions = await third.as.query(api.users.listSessions, {});
      expect(sessions).toHaveLength(3);
      await third.as.mutation(api.users.revokeSession, { sessionId: second.sessionId });
      // …and then it works.
      expect((await third.as.query(api.users.me, {})).state).toBe("ready");
      expect((await third.as.query(api.billing.mine, {})).devicesActive).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("the Pro trial, Basic and Pro have unlimited devices; upgrading frees a held device", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const a = await person(t, "many-devices@example.com");
      const extra = [];
      for (let i = 0; i < 3; i++) {
        vi.advanceTimersByTime(1000);
        extra.push(await anotherDevice(t, a, "many-devices@example.com"));
      }
      // On the trial every device works.
      for (const d of extra) expect((await d.as.query(api.users.me, {})).state).toBe("ready");
      expect((await a.as.query(api.billing.mine, {})).entitlements.devices).toBeNull();
      await endTrial(t, a);
      expect((await extra[2]!.as.query(api.users.me, {})).state).toBe("device_limit");
      // Upgrading (allowed from the held device) lifts the limit.
      await extra[2]!.as.mutation(api.billing.testPurchase, { plan: "basic", interval: "month" });
      expect((await extra[2]!.as.query(api.users.me, {})).state).toBe("ready");
    } finally {
      vi.useRealTimers();
    }
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
    const view = await admin.as.mutation(api.adminBilling.userBilling, { profileId: user.profileId });
    expect(view.devicesActive).toBe(1);
  });
});
