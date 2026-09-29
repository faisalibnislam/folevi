// Admin → Billing setup (convex/billingSetup.ts): who may use it, reasons and audit, matching Polar
// products to the catalog (metadata, then name), mismatches, creating only what's missing (idempotent),
// Polar's error answers, and checkout preferring the database's product id over the env var's.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectedProduct, productCreateBody } from "../../convex/lib/billingProducts";
import { PRODUCT_KEYS, productFor, resolveProductIds, type ProductKey } from "../../convex/lib/polar";
import { SCOPE_MESSAGE } from "../../convex/billingSetup";
import { person, setup, type T } from "./helpers";
import { fakePolar, product, withPolar, withoutPolar } from "./polar";

type Person = Awaited<ReturnType<typeof person>>;
type Json = Record<string, unknown>;
const REASON = "Setting up Polar products for launch";

afterEach(() => {
  withoutPolar();
  vi.unstubAllGlobals();
});

async function withRole(t: T, p: Person, role: "super_admin" | "ops_admin" | "support_admin") {
  await t.run(async (ctx) => ctx.db.patch(p.profileId as Id<"profiles">, { platformRole: role }));
}

async function owner(t: T, email = "owner@example.com") {
  const p = await person(t, email);
  await withRole(t, p, "super_admin");
  return p;
}

/** Polar settings without any POLAR_PRODUCT_* ids (the database is the only source). */
function tokenOnly() {
  Object.assign(process.env, { POLAR_ACCESS_TOKEN: "polar_oat_test", POLAR_WEBHOOK_SECRET: "whsec_x", POLAR_SERVER: "sandbox" });
}

/** A product as Polar would list it, made from what Billing setup would send (with overrides). */
function polarProduct(key: ProductKey, over: Json = {}, opts: { metadata?: boolean } = {}): Json {
  const body = productCreateBody(expectedProduct(key));
  return {
    id: `polar_${key}`,
    organization_id: "org_1",
    is_recurring: body.recurring_interval !== null,
    is_archived: false,
    ...body,
    prices: (body.prices as Json[]).map((p) => ({ ...p, id: `price_${key}`, is_archived: false })),
    metadata: opts.metadata === false ? {} : body.metadata,
    ...over,
  };
}

/** A fake Polar organization: lists its products, creates new ones, and knows its slug. */
function polarOrg(initial: Json[] = [], opts: { failCreateAfter?: number; createError?: Response } = {}) {
  const products = [...initial];
  let made = 0;
  const calls = fakePolar((method, path, body) => {
    if (method === "GET" && path.startsWith("products/")) return { items: products, pagination: { total_count: products.length, max_page: 1 } };
    if (method === "POST" && path === "products/") {
      if (opts.createError && made >= (opts.failCreateAfter ?? 0)) return opts.createError.clone();
      const p: Json = { id: `new_${++made}`, organization_id: "org_1", is_recurring: body!.recurring_interval !== null, is_archived: false, ...body, prices: (body!.prices as Json[]).map((x) => ({ ...x, is_archived: false })) };
      products.push(p);
      return p;
    }
    if (method === "GET" && path.startsWith("organizations/")) return { id: "org_1", slug: "folevi" };
    return new Response(JSON.stringify({ error: "ResourceNotFound", detail: "Not found" }), { status: 404 });
  });
  return { products, calls, posts: () => calls.filter((c) => c.method === "POST") };
}

async function audit(t: T, action: string) {
  return (await t.run(async (ctx) => ctx.db.query("adminAuditLogs").collect())).filter((a) => a.action === action);
}

async function rows(t: T) {
  return await t.run(async (ctx) => ctx.db.query("billingProducts").collect());
}

const byKey = (o: { products: { key: string }[] }, key: string) => o.products.find((p) => p.key === key)!;

describe("who may use Billing setup", () => {
  test("only the owner: admins, support staff and everyone else get not_found, and nothing is sent to Polar", async () => {
    const t = setup();
    tokenOnly();
    const { calls } = polarOrg();
    const me = await owner(t);
    const view = await me.as.query(api.billingSetup.overview, {});
    expect(view.products).toHaveLength(14);
    for (const [email, role] of [
      ["ops@example.com", "ops_admin"],
      ["support@example.com", "support_admin"],
      ["user@example.com", null],
    ] as const) {
      const p = await person(t, email);
      if (role) await withRole(t, p, role);
      await expect(p.as.query(api.billingSetup.overview, {})).rejects.toThrow(/not_found/);
      await expect(p.as.action(api.billingSetup.checkPolar, { reason: REASON })).rejects.toThrow(/not_found/);
      await expect(p.as.action(api.billingSetup.createMissing, { reason: REASON })).rejects.toThrow(/not_found/);
      await expect(p.as.mutation(api.billingSetup.useProductAnyway, { key: "credits_500", reason: REASON })).rejects.toThrow(/not_found/);
    }
    expect(calls).toHaveLength(0);
  });

  test("without Polar settings the page shows every product as not created and the actions explain why", async () => {
    const t = setup();
    const calls = fakePolar();
    const me = await owner(t);
    const view = await me.as.query(api.billingSetup.overview, {});
    expect(view).toMatchObject({ server: "sandbox", tokenSet: false, webhookSecretSet: false, lastCheckedAt: null });
    expect(view.products.map((p) => p.status)).toEqual(Array(14).fill("not_created"));
    expect(view.products.map((p) => p.key)).toEqual(PRODUCT_KEYS);
    expect(byKey(view, "personal_core_monthly")).toMatchObject({ name: "Folevi Core (monthly)", type: "recurring", priceCents: 199, interval: "month", seatBased: false, envName: "POLAR_PRODUCT_PERSONAL_CORE_MONTHLY" });
    expect(byKey(view, "workspace_pro_ai_yearly")).toMatchObject({ name: "Folevi Team Pro AI (yearly)", priceCents: 14900, interval: "year", seatBased: true, envName: "POLAR_PRODUCT_TEAM_PRO_AI_YEARLY" });
    expect(byKey(view, "credits_1000")).toMatchObject({ name: "Folevi AI credits: 1,000", type: "one_time", priceCents: 1499, interval: null });
    await expect(me.as.action(api.billingSetup.checkPolar, { reason: REASON })).rejects.toThrow(/POLAR_ACCESS_TOKEN/);
    expect(calls).toHaveLength(0);
  });

  test("a reason is required, and each run is audited without the token", async () => {
    const t = setup();
    tokenOnly();
    const { calls } = polarOrg();
    const me = await owner(t);
    await expect(me.as.action(api.billingSetup.checkPolar, { reason: "short" })).rejects.toThrow(/reason/);
    await expect(me.as.action(api.billingSetup.createMissing, { reason: " " })).rejects.toThrow(/reason/);
    expect(calls).toHaveLength(0);
    await me.as.action(api.billingSetup.checkPolar, { reason: REASON, requestId: "req_check_1" });
    const [entry] = await audit(t, "billing.products_check");
    expect(entry).toMatchObject({ reason: REASON, requestId: "req_check_1", actorRole: "super_admin", targetType: "billing_products", targetId: "sandbox" });
    expect(JSON.stringify(entry)).not.toContain("polar_oat_test");
    // Every request carries the token as a Bearer and the pinned API version.
    expect(calls[0]!.headers).toMatchObject({ authorization: "Bearer polar_oat_test", "polar-version": "2026-10" });
    expect(calls[0]!.path).toBe("products/?is_archived=false&limit=100&page=1");
  });
});

describe("Check Polar", () => {
  test("matches by metadata, then by exact name; records matches; reports mismatches without recording them", async () => {
    const t = setup();
    tokenOnly();
    polarOrg([
      polarProduct("personal_core_monthly"),
      // No metadata: found by its exact name.
      polarProduct("personal_pro_monthly", {}, { metadata: false }),
      // Its metadata names it, but the price per seat and the name differ.
      polarProduct("workspace_pro_yearly", {
        name: "Team Pro yearly",
        prices: [{ amount_type: "seat_based", price_currency: "usd", is_archived: false, seat_tiers: { seat_tier_type: "volume", tiers: [{ min_seats: 1, max_seats: null, price_per_seat: 5900 }] } }],
      }),
      // A one-time product where a monthly subscription is expected, found by name.
      polarProduct("personal_pro_ai_monthly", { recurring_interval: null, is_recurring: false }, { metadata: false }),
      // Someone else's product with a similar name is ignored.
      { id: "other", name: "Folevi Core (monthly) old", is_recurring: true, recurring_interval: "month", prices: [], metadata: {} },
    ]);
    const me = await owner(t);
    const r = await me.as.action(api.billingSetup.checkPolar, { reason: REASON });
    expect(r.found).toBe(4);
    expect(r.recorded.sort()).toEqual(["personal_core_monthly", "personal_pro_monthly"]);
    expect(r.mismatched.sort()).toEqual(["personal_pro_ai_monthly", "workspace_pro_yearly"]);
    expect(r.missing).toHaveLength(10);

    const stored = await rows(t);
    expect(stored.map((s) => [s.key, s.polarProductId, s.source, s.server]).sort()).toEqual([
      ["personal_core_monthly", "polar_personal_core_monthly", "matched", "sandbox"],
      ["personal_pro_monthly", "polar_personal_pro_monthly", "matched", "sandbox"],
    ]);

    const view = await me.as.query(api.billingSetup.overview, {});
    expect(byKey(view, "personal_core_monthly")).toMatchObject({ status: "created", polarProductId: "polar_personal_core_monthly", source: "matched", dashboardUrl: "https://sandbox.polar.sh/dashboard/folevi/products/polar_personal_core_monthly" });
    expect(byKey(view, "workspace_pro_yearly")).toMatchObject({ status: "mismatch", polarProductId: "polar_workspace_pro_yearly", inUse: false });
    expect(byKey(view, "workspace_pro_yearly").differences).toEqual(['Name is "Team Pro yearly", expected "Folevi Team Pro (yearly)".', "Price is $59 per seat, expected $49 per seat."]);
    expect(byKey(view, "personal_pro_ai_monthly").differences).toEqual(["It's a one-time product, expected a subscription."]);
    expect(byKey(view, "credits_500")).toMatchObject({ status: "not_created", polarProductId: null });
    expect(view.lastCheckedAt).toBeGreaterThan(0);

    // Mismatched products aren't sold until they're fixed in Polar or used anyway.
    const ids = await t.run(async (ctx) => (await import("../../convex/lib/billingProducts")).productIds(ctx));
    expect(ids.workspace_pro_yearly).toEqual([]);
    expect(ids.personal_core_monthly).toEqual(["polar_personal_core_monthly"]);
  });

  test("a recorded product that differs shows as a mismatch; one Polar no longer lists is forgotten", async () => {
    const t = setup();
    tokenOnly();
    const org = polarOrg([polarProduct("credits_500"), polarProduct("credits_1000")]);
    const me = await owner(t);
    await me.as.action(api.billingSetup.checkPolar, { reason: REASON });
    expect((await rows(t)).map((r) => r.key).sort()).toEqual(["credits_1000", "credits_500"]);
    // Someone changes a price in Polar and archives the other product.
    org.products.splice(0, org.products.length, polarProduct("credits_500", { prices: [{ amount_type: "fixed", price_amount: 899, price_currency: "usd", is_archived: false }] }));
    const r = await me.as.action(api.billingSetup.checkPolar, { reason: REASON });
    expect(r.removed).toEqual(["credits_1000"]);
    const view = await me.as.query(api.billingSetup.overview, {});
    expect(byKey(view, "credits_500")).toMatchObject({ status: "mismatch", inUse: true, source: "matched", differences: ["Price is $8.99, expected $7.99."] });
    expect(byKey(view, "credits_1000")).toMatchObject({ status: "not_created" });
    expect((await rows(t)).map((r) => r.key)).toEqual(["credits_500"]);
  });

  test("403: the token lacks the products scopes (a clear message, audited as failed, and the next run isn't blocked)", async () => {
    const t = setup();
    tokenOnly();
    fakePolar(() => new Response(JSON.stringify({ error: "insufficient_scope", error_description: "The token has insufficient scope." }), { status: 403 }));
    const me = await owner(t);
    await expect(me.as.action(api.billingSetup.checkPolar, { reason: REASON })).rejects.toThrow(SCOPE_MESSAGE);
    const [entry] = await audit(t, "billing.products_check");
    expect(entry!.after).toMatchObject({ outcome: "failed", error: SCOPE_MESSAGE });
    expect((await me.as.query(api.billingSetup.overview, {})).lastError).toBe(SCOPE_MESSAGE);
    fakePolar(() => new Response("{}", { status: 401 }));
    await expect(me.as.action(api.billingSetup.checkPolar, { reason: REASON })).rejects.toThrow(/products:read and products:write/);
    polarOrg();
    await me.as.action(api.billingSetup.checkPolar, { reason: REASON });
    expect((await me.as.query(api.billingSetup.overview, {})).lastError).toBeNull();
  });
});

describe("Create missing products", () => {
  test("creates exactly the catalog's products with their metadata, records them, and running it again creates nothing", async () => {
    const t = setup();
    tokenOnly();
    const org = polarOrg();
    const me = await owner(t);
    const r = await me.as.action(api.billingSetup.createMissing, { reason: REASON, requestId: "req_create" });
    expect(r.created).toEqual(PRODUCT_KEYS);
    const posts = org.posts();
    expect(posts).toHaveLength(14);
    const body = (key: string) => posts.find((c) => (c.body!.metadata as Json).folevi_key === key)!.body;
    expect(body("personal_core_monthly")).toEqual({
      name: "Folevi Core (monthly)",
      description: "Folevi Core for your Personal space, billed monthly. 20 GB of storage. No AI.",
      recurring_interval: "month",
      prices: [{ amount_type: "fixed", price_currency: "usd", price_amount: 199 }],
      metadata: { folevi_key: "personal_core_monthly" },
    });
    expect(body("personal_pro_ai_yearly")).toMatchObject({ name: "Folevi Pro AI (yearly)", recurring_interval: "year", prices: [{ amount_type: "fixed", price_amount: 14900 }] });
    expect(body("workspace_pro_monthly")).toEqual({
      name: "Folevi Team Pro (monthly)",
      description: "Folevi Pro for a team workspace, billed monthly per member. Each member gets 20 GB of storage and 180 AI credits a month.",
      recurring_interval: "month",
      prices: [{ amount_type: "seat_based", price_currency: "usd", seat_tiers: { seat_tier_type: "volume", tiers: [{ min_seats: 1, max_seats: null, price_per_seat: 499 }] } }],
      metadata: { folevi_key: "workspace_pro_monthly" },
    });
    expect(body("credits_1000")).toEqual({
      name: "Folevi AI credits: 1,000",
      description: "1,000 AI credits for Folevi Pro and Pro AI. Credits last 12 months and are used after your monthly credits run out.",
      recurring_interval: null,
      prices: [{ amount_type: "fixed", price_currency: "usd", price_amount: 1499 }],
      metadata: { folevi_key: "credits_1000" },
    });
    // Plain copy: no em dash anywhere, no trial.
    for (const c of posts) {
      expect(JSON.stringify(c.body)).not.toContain(String.fromCharCode(0x2014));
      expect(c.body).not.toHaveProperty("trial_interval");
    }

    const stored = await rows(t);
    expect(stored).toHaveLength(14);
    expect(stored.every((s) => s.source === "created" && s.server === "sandbox" && s.createdBy === me.profileId)).toBe(true);
    expect(stored.find((s) => s.key === "workspace_core_yearly")).toMatchObject({ priceCents: 1900, interval: "year", seatBased: true, type: "recurring", currency: "usd" });
    expect(await audit(t, "billing.product_create")).toHaveLength(14);
    expect((await audit(t, "billing.products_create"))[0]).toMatchObject({ reason: REASON, requestId: "req_create" });
    const view = await me.as.query(api.billingSetup.overview, {});
    expect(view.products.every((p) => p.status === "created" && p.source === "created")).toBe(true);

    const again = await me.as.action(api.billingSetup.createMissing, { reason: REASON });
    expect(again.created).toEqual([]);
    expect(again.found).toBe(14);
    expect(org.posts()).toHaveLength(14);
    expect(await rows(t)).toHaveLength(14);
  });

  test("only creates products with nothing found: a match is recorded, a mismatch is left alone, a recorded one is kept", async () => {
    const t = setup();
    tokenOnly();
    const org = polarOrg([
      polarProduct("personal_core_monthly", { id: "existing_core" }),
      polarProduct("credits_500", { prices: [{ amount_type: "fixed", price_amount: 999, price_currency: "usd", is_archived: false }] }, { metadata: false }),
    ]);
    const me = await owner(t);
    const r = await me.as.action(api.billingSetup.createMissing, { reason: REASON });
    expect(r.created).toHaveLength(12);
    expect(r.created).not.toContain("personal_core_monthly");
    expect(r.created).not.toContain("credits_500");
    expect(r.mismatched).toEqual(["credits_500"]);
    expect(org.posts().map((c) => c.body!.name)).not.toContain("Folevi AI credits: 500");
    expect((await rows(t)).find((s) => s.key === "personal_core_monthly")).toMatchObject({ polarProductId: "existing_core", source: "matched" });
    expect((await rows(t)).find((s) => s.key === "credits_500")).toBeUndefined();
  });

  test("a creation Polar refuses (seat-based pricing not enabled) shows Polar's message; what was created before is kept", async () => {
    const t = setup();
    tokenOnly();
    const refusal = new Response(JSON.stringify({ error: "PolarRequestValidationError", detail: [{ loc: ["body", "prices", 0, "amount_type"], msg: "Seat-based pricing is not enabled for this organization.", type: "value_error" }] }), { status: 422 });
    polarOrg([], { failCreateAfter: 6, createError: refusal });
    const me = await owner(t);
    await expect(me.as.action(api.billingSetup.createMissing, { reason: REASON })).rejects.toThrow(/Polar refused to create .{0,4}Folevi Team Core \(monthly\).{0,4}: prices\.0\.amount_type: Seat-based pricing is not enabled/);
    expect((await rows(t)).map((s) => s.key)).toEqual(PRODUCT_KEYS.slice(0, 6));
    const view = await me.as.query(api.billingSetup.overview, {});
    expect(view.lastError).toMatch(/Seat-based pricing is not enabled/);
    expect(byKey(view, "personal_pro_ai_yearly").status).toBe("created");
    expect(byKey(view, "workspace_core_monthly").status).toBe("not_created");
  });
});

describe("Use this product anyway", () => {
  test("pins the differing product the last check found (audited); checkout then sells it", async () => {
    const t = setup();
    tokenOnly();
    polarOrg([polarProduct("credits_500", { name: "AI credits 500" })]);
    const me = await owner(t);
    await expect(me.as.mutation(api.billingSetup.useProductAnyway, { key: "credits_500", reason: REASON })).rejects.toThrow(/Check Polar first/);
    await me.as.action(api.billingSetup.checkPolar, { reason: REASON });
    await expect(me.as.mutation(api.billingSetup.useProductAnyway, { key: "credits_500", reason: "nope" })).rejects.toThrow(/reason/);
    await expect(me.as.mutation(api.billingSetup.useProductAnyway, { key: "not_a_product", reason: REASON })).rejects.toThrow(/Unknown product/);
    await me.as.mutation(api.billingSetup.useProductAnyway, { key: "credits_500", reason: REASON });
    expect((await rows(t))[0]).toMatchObject({ key: "credits_500", polarProductId: "polar_credits_500", source: "pinned", differences: ['Name is "AI credits 500", expected "Folevi AI credits: 500".'] });
    const [entry] = await audit(t, "billing.product_pin");
    expect(entry).toMatchObject({ reason: REASON, targetId: "credits_500" });
    const view = await me.as.query(api.billingSetup.overview, {});
    expect(byKey(view, "credits_500")).toMatchObject({ status: "created", source: "pinned", inUse: true });
    // A later check keeps the pin (it isn't reported as a mismatch again).
    await me.as.action(api.billingSetup.checkPolar, { reason: REASON });
    expect(byKey(await me.as.query(api.billingSetup.overview, {}), "credits_500")).toMatchObject({ status: "created", source: "pinned" });
  });
});

describe("where checkout finds product ids", () => {
  test("the database's id comes first, the env var's is the fallback, and webhooks accept either", async () => {
    const t = setup();
    withPolar();
    const a = await person(t, "buyer@example.com");
    await t.run(async (ctx) => {
      await ctx.db.insert("billingProducts", { key: "personal_pro_ai_yearly", server: "sandbox", polarProductId: "prod_from_db", source: "created", name: "Folevi Pro AI (yearly)", type: "recurring", priceCents: 14900, currency: "usd", interval: "year", seatBased: false, createdAt: Date.now(), createdBy: a.profileId as Id<"profiles"> });
      // A row for the other Polar server is never used here.
      await ctx.db.insert("billingProducts", { key: "personal_pro_yearly", server: "production", polarProductId: "prod_production", source: "created", name: "Folevi Pro (yearly)", type: "recurring", priceCents: 4900, currency: "usd", interval: "year", seatBased: false, createdAt: Date.now(), createdBy: a.profileId as Id<"profiles"> });
    });
    let calls = fakePolar(() => ({ id: "chk_1", url: "https://sandbox.polar.sh/checkout/chk_1" }));
    await a.as.action(api.billing.checkout, { plan: "pro_ai", interval: "year" });
    expect(calls[0]!.body).toMatchObject({ products: ["prod_from_db"] });
    calls = fakePolar(() => ({ id: "chk_2", url: "https://sandbox.polar.sh/checkout/chk_2" }));
    await a.as.action(api.billing.checkout, { plan: "pro", interval: "year" });
    expect(calls[0]!.body).toMatchObject({ products: [product("personal_pro_yearly")] });

    const ids = resolveProductIds({ personal_pro_ai_yearly: "prod_from_db" });
    expect(ids.personal_pro_ai_yearly).toEqual(["prod_from_db", product("personal_pro_ai_yearly")]);
    expect(productFor(ids, "prod_from_db")).toMatchObject({ kind: "personal", tier: "pro_ai", interval: "year" });
    expect(productFor(ids, product("personal_pro_ai_yearly"))).toMatchObject({ kind: "personal", tier: "pro_ai" });
    expect(productFor(ids, "prod_unknown")).toBeNull();
  });

  test("checkout is available once every product has an id, from the database alone", async () => {
    const t = setup();
    tokenOnly();
    polarOrg();
    const me = await owner(t);
    expect((await me.as.query(api.billing.mine, {})).checkoutAvailable).toBe(false);
    await me.as.action(api.billingSetup.createMissing, { reason: REASON });
    const mine = await me.as.query(api.billing.mine, {});
    expect(mine.checkoutAvailable).toBe(true);
    expect(mine.creditsCheckoutAvailable).toBe(true);
  });
});
