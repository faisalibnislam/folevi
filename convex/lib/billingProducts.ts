// The 14 Polar products Folevi sells, as Polar should have them (names, prices, intervals, seat pricing,
// all from convex/lib/plans.ts), how to create one through the Polar API, how to tell whether a product in
// Polar is the one we expect, and where checkout finds each product's id (the database first, then the
// POLAR_PRODUCT_* env var). Admin → Billing setup (convex/billingSetup.ts) uses this; docs/BILLING.md.
import type { DatabaseReader } from "../_generated/server";
import { CREDIT_PACKS, PACK_VALID_MONTHS, PLAN_CATALOG, STORAGE_BYTES, MONTHLY_CREDITS, TIER_NAMES, GB, formatPrice, type BillingInterval, type PlanTier } from "./plans";
import { PRODUCT_KEYS, polarServer, resolveProductIds, type ProductIds, type ProductKey } from "./polar";

/** The metadata key every product made by Billing setup carries (its value is the product key). */
export const PRODUCT_METADATA_KEY = "folevi_key";

export interface ExpectedProduct {
  key: ProductKey;
  name: string;
  description: string;
  type: "recurring" | "one_time";
  priceCents: number;
  currency: "usd";
  interval: BillingInterval | null;
  seatBased: boolean;
}

const INTERVAL_WORD: Record<BillingInterval, string> = { month: "monthly", year: "yearly" };

function features(tier: Exclude<PlanTier, "free">, perMember: boolean): string {
  const storage = `${STORAGE_BYTES[tier] / GB} GB of storage`;
  const lead = perMember ? "Each member gets " : "";
  if (MONTHLY_CREDITS[tier] === 0) return `${lead}${storage}. No AI.`;
  return `${lead}${storage} and ${MONTHLY_CREDITS[tier]} AI credits a month.`;
}

/** What Polar should have for a product key. */
export function expectedProduct(key: ProductKey): ExpectedProduct {
  if (key === "credits_500" || key === "credits_1000") {
    const pack = CREDIT_PACKS[key];
    return {
      key,
      name: `Folevi AI credits: ${pack.credits.toLocaleString("en-US")}`,
      description: `${pack.credits.toLocaleString("en-US")} AI credits for Folevi Pro and Pro AI. Credits last ${PACK_VALID_MONTHS} months and are used after your monthly credits run out.`,
      type: "one_time",
      priceCents: pack.priceCents,
      currency: "usd",
      interval: null,
      seatBased: false,
    };
  }
  const plan = PLAN_CATALOG[key];
  const tier = plan.tier as Exclude<PlanTier, "free">;
  const interval = plan.interval!;
  const team = plan.scope === "workspace";
  return {
    key,
    name: `Folevi ${team ? "Team " : ""}${TIER_NAMES[tier]} (${INTERVAL_WORD[interval]})`,
    description: team
      ? `Folevi ${TIER_NAMES[tier]} for a team workspace, billed ${INTERVAL_WORD[interval]} per member. ${features(tier, true)}`
      : `Folevi ${TIER_NAMES[tier]} for your Personal space, billed ${INTERVAL_WORD[interval]}. ${features(tier, false)}`,
    type: "recurring",
    priceCents: plan.priceCents,
    currency: "usd",
    interval,
    seatBased: team,
  };
}

export const EXPECTED_PRODUCTS: ExpectedProduct[] = PRODUCT_KEYS.map(expectedProduct);

/**
 * The body of POST /v1/products/ for a product (https://polar.sh/docs/api-reference/products/create).
 * Recurring: `recurring_interval` "month" or "year". One-time: `recurring_interval` null. Personal plans
 * and packs have one fixed price (`price_amount` in cents); Team plans one seat-based price with a single
 * volume tier from 1 seat up (`price_per_seat` in cents). No trial on Polar's side (Folevi runs its own).
 */
export function productCreateBody(e: ExpectedProduct): Record<string, unknown> {
  const price = e.seatBased
    ? { amount_type: "seat_based", price_currency: e.currency, seat_tiers: { seat_tier_type: "volume", tiers: [{ min_seats: 1, max_seats: null, price_per_seat: e.priceCents }] } }
    : { amount_type: "fixed", price_currency: e.currency, price_amount: e.priceCents };
  return {
    name: e.name,
    description: e.description,
    recurring_interval: e.type === "recurring" ? e.interval : null,
    prices: [price],
    metadata: { [PRODUCT_METADATA_KEY]: e.key },
  };
}

// ---------------------------------------------------------------------------------------------------
// Reading Polar products
// ---------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const money = (cents: number, currency: string) => (currency.toLowerCase() === "usd" ? formatPrice(cents) : `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`);

/** How a product in Polar differs from what we expect (empty: it's the one). Only name, type, interval and price count. */
export function productDifferences(e: ExpectedProduct, p: Json): string[] {
  const out: string[] = [];
  const name = typeof p.name === "string" ? p.name : "";
  if (name !== e.name) out.push(`Name is "${name}", expected "${e.name}".`);
  const recurring = p.is_recurring === true || (typeof p.recurring_interval === "string" && p.recurring_interval !== "");
  if (e.type === "recurring" && !recurring) out.push("It's a one-time product, expected a subscription.");
  if (e.type === "one_time" && recurring) out.push("It's a subscription, expected a one-time product.");
  if (e.type === "recurring" && recurring) {
    const interval = p.recurring_interval;
    const count = typeof p.recurring_interval_count === "number" ? p.recurring_interval_count : 1;
    if (interval !== e.interval || count !== 1) out.push(`Billed every ${count === 1 ? "" : `${count} `}${String(interval ?? "unknown")}${count === 1 ? "" : "s"}, expected every ${e.interval}.`);
  }
  if (typeof p.trial_interval === "string" && p.trial_interval) out.push("It has a free trial in Polar, expected none (Folevi runs its own trial).");
  const prices = arr(p.prices)
    .map(obj)
    .filter((x) => x.is_archived !== true);
  if (prices.length !== 1) {
    out.push(`It has ${prices.length} prices, expected 1.`);
    return out;
  }
  const price = prices[0]!;
  const currency = typeof price.price_currency === "string" ? price.price_currency : "usd";
  if (currency.toLowerCase() !== e.currency) out.push(`Currency is ${currency.toUpperCase()}, expected USD.`);
  if (e.seatBased) {
    if (price.amount_type !== "seat_based") {
      out.push(`Pricing is ${String(price.amount_type ?? "unknown").replace(/_/g, " ")}, expected seat-based.`);
      return out;
    }
    const tiers = arr(obj(price.seat_tiers).tiers).map(obj);
    if (tiers.length !== 1) {
      out.push(`It has ${tiers.length} seat tiers, expected 1.`);
      return out;
    }
    const tier = tiers[0]!;
    const perSeat = typeof tier.price_per_seat === "number" ? tier.price_per_seat : NaN;
    if (perSeat !== e.priceCents) out.push(`Price is ${Number.isFinite(perSeat) ? money(perSeat, currency) : "unknown"} per seat, expected ${formatPrice(e.priceCents)} per seat.`);
    if (tier.min_seats !== 1) out.push(`Minimum is ${String(tier.min_seats ?? "unknown")} seats, expected 1.`);
    if (tier.max_seats !== null && tier.max_seats !== undefined) out.push(`Maximum is ${String(tier.max_seats)} seats, expected no maximum.`);
  } else {
    if (price.amount_type !== "fixed") {
      out.push(`Pricing is ${String(price.amount_type ?? "unknown").replace(/_/g, " ")}, expected a fixed price.`);
      return out;
    }
    const amount = typeof price.price_amount === "number" ? price.price_amount : NaN;
    if (amount !== e.priceCents) out.push(`Price is ${Number.isFinite(amount) ? money(amount, currency) : "unknown"}, expected ${formatPrice(e.priceCents)}.`);
  }
  return out;
}

export interface ProductFinding {
  key: ProductKey;
  polarProductId: string;
  matchedBy: "recorded" | "env" | "metadata" | "name";
  differences: string[];
}

/**
 * Finds each key's product among the organization's (unarchived) Polar products: the id already recorded
 * in the database, then the env var's id, then the product whose metadata names the key, then an exact
 * name match. Among several candidates of one kind, one without differences wins.
 */
export function matchProducts(products: Json[], known: { recorded: Partial<Record<ProductKey, string>>; env: Partial<Record<ProductKey, string>> }): Map<ProductKey, ProductFinding> {
  const out = new Map<ProductKey, ProductFinding>();
  const byId = new Map(products.filter((p) => typeof p.id === "string").map((p) => [p.id as string, p]));
  for (const e of EXPECTED_PRODUCTS) {
    const pick = (candidates: Json[], matchedBy: ProductFinding["matchedBy"]): boolean => {
      if (!candidates.length) return false;
      const scored = candidates.map((p) => ({ p, d: productDifferences(e, p) }));
      const best = scored.find((s) => s.d.length === 0) ?? scored[0]!;
      out.set(e.key, { key: e.key, polarProductId: best.p.id as string, matchedBy, differences: best.d });
      return true;
    };
    const recorded = known.recorded[e.key];
    const env = known.env[e.key];
    if (recorded && pick(byId.has(recorded) ? [byId.get(recorded)!] : [], "recorded")) continue;
    if (env && pick(byId.has(env) ? [byId.get(env)!] : [], "env")) continue;
    if (pick([...byId.values()].filter((p) => obj(p.metadata)[PRODUCT_METADATA_KEY] === e.key), "metadata")) continue;
    pick([...byId.values()].filter((p) => p.name === e.name), "name");
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Where checkout finds product ids
// ---------------------------------------------------------------------------------------------------

/** The product ids recorded in the database for the Polar server this deployment uses. */
export async function recordedProductIds(db: DatabaseReader): Promise<Partial<Record<ProductKey, string>>> {
  const rows = await db
    .query("billingProducts")
    .withIndex("by_server_key", (q) => q.eq("server", polarServer()))
    .collect();
  const out: Partial<Record<ProductKey, string>> = {};
  for (const r of rows) if ((PRODUCT_KEYS as string[]).includes(r.key)) out[r.key as ProductKey] = r.polarProductId;
  return out;
}

/** Every product's Polar ids, the database's first and the env var's as a fallback. */
export async function productIds(ctx: { db: DatabaseReader }): Promise<ProductIds> {
  return resolveProductIds(await recordedProductIds(ctx.db));
}
