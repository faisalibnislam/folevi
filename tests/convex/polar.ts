// Test helpers for Polar: product env vars, signed webhook deliveries, and a fake Polar API.
import { vi } from "vitest";
import { PRODUCT_KEYS, productEnvName, signWebhook, webhookKeys } from "../../convex/lib/polar";
import type { T } from "./helpers";

export const POLAR_SECRET = `whsec_${btoa("folevi-test-webhook-secret-32byt")}`;

/** Product ids as the env names them: prod_<key>. */
export const product = (key: (typeof PRODUCT_KEYS)[number]) => `prod_${key}`;

export const POLAR_ENV: Record<string, string> = {
  POLAR_ACCESS_TOKEN: "polar_oat_test",
  POLAR_WEBHOOK_SECRET: POLAR_SECRET,
  POLAR_SERVER: "sandbox",
  ...Object.fromEntries(PRODUCT_KEYS.map((k) => [productEnvName(k), product(k)])),
};

export function withPolar() {
  Object.assign(process.env, POLAR_ENV);
}
export function withoutPolar() {
  for (const k of Object.keys(POLAR_ENV)) delete process.env[k];
}

let seq = 0;
/** A signed Standard Webhooks delivery of `event` (key: "standard" = base64 of the secret, or "legacy"). */
export async function delivery(event: Record<string, unknown>, opts: { id?: string; at?: number; secret?: string; key?: "standard" | "legacy" } = {}) {
  const body = JSON.stringify(event);
  const id = opts.id ?? `msg_${++seq}_${Math.random().toString(36).slice(2)}`;
  const timestamp = String(Math.floor((opts.at ?? Date.now()) / 1000));
  const keys = webhookKeys(opts.secret ?? POLAR_SECRET);
  const key = opts.key === "legacy" ? keys[0]! : keys[keys.length - 1]!;
  const signature = await signWebhook(key, id, timestamp, body);
  return { body, id, timestamp, signature, headers: { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}`, "content-type": "application/json" } };
}

/** Posts a signed event to the webhook route. */
export async function postEvent(t: T, type: string, data: Record<string, unknown>, opts: { id?: string; at?: number } = {}) {
  const at = opts.at ?? Date.now();
  const d = await delivery({ type, timestamp: new Date(at).toISOString(), api_version: "2026-10", data }, { id: opts.id });
  const res = await t.fetch("/webhooks/polar", { method: "POST", body: d.body, headers: d.headers });
  return { status: res.status, id: d.id };
}

const iso = (ms: number) => new Date(ms).toISOString();

/** A Polar subscription object (2026-10 field names). */
export function subscription(opts: { id: string; productKey: (typeof PRODUCT_KEYS)[number]; status?: string; metadata: Record<string, string>; customerId?: string; externalId?: string; start?: number; end?: number; cancelAtPeriodEnd?: boolean; seats?: number }) {
  const start = opts.start ?? Date.now();
  const end = opts.end ?? start + 30 * 86_400_000;
  return {
    id: opts.id,
    status: opts.status ?? "active",
    product_id: product(opts.productKey),
    customer_id: opts.customerId ?? "cus_1",
    customer: { id: opts.customerId ?? "cus_1", external_id: opts.externalId ?? opts.metadata.profileId ?? null },
    metadata: opts.metadata,
    current_period_start: iso(start),
    current_period_end: iso(end),
    cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
    recurring_interval: opts.productKey.endsWith("yearly") ? "year" : "month",
    seats: opts.seats ?? null,
  };
}

/** A Polar order object. */
export function order(opts: { id: string; productKey: (typeof PRODUCT_KEYS)[number]; total: number; metadata: Record<string, string>; subscriptionId?: string; status?: string; refunded?: number; seats?: number; billingReason?: string }) {
  return {
    id: opts.id,
    status: opts.status ?? "paid",
    paid: true,
    billing_reason: opts.billingReason ?? (opts.subscriptionId ? "subscription_create" : "purchase"),
    product_id: product(opts.productKey),
    subscription_id: opts.subscriptionId ?? null,
    total_amount: opts.total,
    net_amount: opts.total,
    tax_amount: 0,
    refunded_amount: opts.refunded ?? 0,
    currency: "usd",
    seats: opts.seats ?? null,
    customer: { external_id: opts.metadata.profileId ?? null },
    metadata: opts.metadata,
  };
}

/** A fake Polar API: records requests and answers them (a Response answer is sent as is, e.g. an error status). */
export function fakePolar(answer: (method: string, path: string, body: Record<string, unknown> | null) => Record<string, unknown> | Response = () => ({})) {
  const calls: { method: string; path: string; body: Record<string, unknown> | null; headers: Record<string, string> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { method: string; body?: string; headers: Record<string, string> }) => {
      const path = url.replace(/^https:\/\/sandbox-api\.polar\.sh\/v1\//, "");
      const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ method: init.method, path, body, headers: init.headers });
      const a = answer(init.method, path, body);
      return a instanceof Response ? a : new Response(JSON.stringify(a), { status: 200 });
    }),
  );
  return calls;
}
