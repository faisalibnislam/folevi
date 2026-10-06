// Polar (polar.sh, the merchant of record) over plain HTTPS, no SDK: the access token, the product ids,
// small request helpers, and the webhook signature check. Only actions call Polar; secrets stay in the
// Convex environment (never NEXT_PUBLIC). Nothing here logs request bodies, tokens or email addresses.
// docs/BILLING.md has the setup (products, webhook, env vars).
//
//   POLAR_ACCESS_TOKEN    an Organization Access Token (Bearer)
//   POLAR_WEBHOOK_SECRET  the webhook endpoint's secret ("whsec_…")
//   POLAR_SERVER          "sandbox" (default) or "production"
//   POLAR_PRODUCT_*       optional: one product id per plan and interval, and per credit pack (productEnvName
//                         below), used when the database (Admin → Billing setup) has none
import { fail } from "./errors";
import { timingSafeEqualHex } from "./crypto";
import { CREDIT_PACKS, PLAN_CATALOG, type BillingInterval, type CreditPackId, type PaidWorkspacePlanId, type PersonalPlanId, type PersonalTier } from "./plans";
import { appUrl } from "./notify";

/** The API version every request is pinned to (Polar dates its versions; `Polar-Version` header). */
export const POLAR_API_VERSION = "2026-10";

export const polarToken = () => process.env.POLAR_ACCESS_TOKEN ?? "";
export const polarServer = (): "sandbox" | "production" => (process.env.POLAR_SERVER === "production" ? "production" : "sandbox");
export const polarApiBase = () => (polarServer() === "production" ? "https://api.polar.sh/v1" : "https://sandbox-api.polar.sh/v1");
/** Development and test deployments may switch plans and add credits without paying; production never. */
export const testPurchasesAllowed = () => process.env.FOLEVI_ENV !== "production";

// ---------------------------------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------------------------------

export type PaidPersonalPlanId = Exclude<PersonalPlanId, "personal_free">;
export type ProductKey = PaidPersonalPlanId | PaidWorkspacePlanId | CreditPackId;

export const PAID_PERSONAL_PLAN_IDS: PaidPersonalPlanId[] = ["personal_core_monthly", "personal_core_yearly", "personal_pro_monthly", "personal_pro_yearly", "personal_pro_ai_monthly", "personal_pro_ai_yearly"];
export const PRODUCT_KEYS: ProductKey[] = [
  ...PAID_PERSONAL_PLAN_IDS,
  "workspace_core_monthly",
  "workspace_core_yearly",
  "workspace_pro_monthly",
  "workspace_pro_yearly",
  "workspace_pro_ai_monthly",
  "workspace_pro_ai_yearly",
  "credits_500",
  "credits_1000",
];

/**
 * The env var holding a product's Polar id (the fallback when the database has none):
 * POLAR_PRODUCT_PERSONAL_PRO_AI_MONTHLY, POLAR_PRODUCT_TEAM_CORE_YEARLY, POLAR_PRODUCT_CREDITS_500…
 */
export const productEnvName = (key: ProductKey) => `POLAR_PRODUCT_${key.replace(/^workspace_/, "team_").toUpperCase()}`;
export const envProductId = (key: ProductKey): string | undefined => process.env[productEnvName(key)] || undefined;

/**
 * Each product's known Polar ids, the one checkout uses first: the id recorded in the database
 * (`billingProducts`, filled in from Admin → Billing setup) and then the env var. Webhooks accept any of
 * them, so a subscription started under an env id keeps working after the database gets one.
 * Loaded by `productIds` in convex/lib/billingProducts.ts.
 */
export type ProductIds = Record<ProductKey, string[]>;

export function resolveProductIds(recorded: Partial<Record<ProductKey, string>>): ProductIds {
  const out = {} as ProductIds;
  for (const k of PRODUCT_KEYS) out[k] = [...new Set([recorded[k], envProductId(k)].filter((x): x is string => Boolean(x)))];
  return out;
}

/** The Polar id checkout uses for a product (database first, env var as a fallback). */
export const productId = (ids: ProductIds, key: ProductKey): string | undefined => ids[key][0];

export type ProductMatch =
  | { kind: "personal"; planId: PaidPersonalPlanId; tier: Exclude<PersonalTier, "free">; interval: BillingInterval }
  | { kind: "workspace"; planId: PaidWorkspacePlanId; interval: BillingInterval }
  | { kind: "credits"; pack: CreditPackId; credits: number };

/** What a Polar product id is (null: not one of ours). */
export function productFor(ids: ProductIds, id: string | undefined | null): ProductMatch | null {
  if (!id) return null;
  const key = PRODUCT_KEYS.find((k) => ids[k].includes(id));
  if (!key) return null;
  if (key === "credits_500" || key === "credits_1000") return { kind: "credits", pack: key, credits: CREDIT_PACKS[key].credits };
  const plan = PLAN_CATALOG[key];
  if (plan.scope === "personal") return { kind: "personal", planId: key as PaidPersonalPlanId, tier: plan.tier as Exclude<PersonalTier, "free">, interval: plan.interval! };
  return { kind: "workspace", planId: key as PaidWorkspacePlanId, interval: plan.interval! };
}

export const WORKSPACE_PRODUCT_KEYS: PaidWorkspacePlanId[] = ["workspace_core_monthly", "workspace_core_yearly", "workspace_pro_monthly", "workspace_pro_yearly", "workspace_pro_ai_monthly", "workspace_pro_ai_yearly"];

/** Whether checkout can run for these products (the token and an id for every one of them). */
export const polarReady = (ids: ProductIds, keys: ProductKey[]) => Boolean(polarToken() && keys.every((k) => productId(ids, k)));
export const personalCheckoutReady = (ids: ProductIds) => polarReady(ids, PAID_PERSONAL_PLAN_IDS);
export const workspaceCheckoutReady = (ids: ProductIds) => polarReady(ids, WORKSPACE_PRODUCT_KEYS);
export const creditsCheckoutReady = (ids: ProductIds) => polarReady(ids, ["credits_500", "credits_1000"]);

// ---------------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

/** Polar's answer: its HTTP status and JSON body (an empty object when there's none). */
export interface PolarResponse {
  ok: boolean;
  status: number;
  data: Json;
}

/** A Polar request (answer included) that takes longer than this is given up as unreachable. */
const POLAR_TIMEOUT_MS = 20_000;

/**
 * One request to the Polar API with the access token and the pinned API version. Throws only when Polar
 * can't be reached (or doesn't answer in time); an error answer is returned for the caller to explain.
 * Never logs the token or a body.
 */
export async function polarSend(method: "GET" | "POST" | "PATCH", path: string, body?: Json): Promise<PolarResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POLAR_TIMEOUT_MS);
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${polarApiBase()}/${path}`, {
      method,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${polarToken()}`,
        "polar-version": POLAR_API_VERSION,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }
  let data: Json;
  try {
    const parsed: unknown = text ? JSON.parse(text) : {};
    data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Json) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    // The path without ids or query and the status only; never the body, the token or an address.
    console.warn(JSON.stringify({ event: "billing.polar_error", path: path.replace(/\?.*$/, "").replace(/\/[^/]+\/?$/, "/…"), status: res.status }));
  }
  return { ok: res.ok, status: res.status, data };
}

async function request(method: "GET" | "POST" | "PATCH", path: string, body?: Json): Promise<Json> {
  if (!polarToken()) fail("maintenance", "Payments aren't set up on this server yet.");
  let res: PolarResponse;
  try {
    res = await polarSend(method, path, body);
  } catch {
    // Unreachable, or no answer in time.
    fail("maintenance", "Payments couldn't be reached. Try again shortly.");
  }
  if (!res.ok) fail("maintenance", res.status === 429 ? "Payments are busy right now. Try again in a minute." : "Payments couldn't be started. Try again shortly.");
  return res.data;
}

export const polarGet = (path: string) => request("GET", path);
export const polarPost = (path: string, body: Json) => request("POST", path, body);
export const polarPatch = (path: string, body: Json) => request("PATCH", path, body);

/**
 * Creates a Polar checkout session and returns its page. `externalCustomerId` is the buyer's profile id
 * (one Polar customer per person); `metadata` carries our own ids and is copied onto the subscription and
 * its orders, which is how webhooks find the plan they're about.
 */
export async function createCheckout(opts: { product: string; externalCustomerId: string; email: string; metadata: Record<string, string>; successPath: string; returnPath: string; seats?: number; customerIp?: string }): Promise<string> {
  const session = await polarPost("checkouts/", {
    products: [opts.product],
    external_customer_id: opts.externalCustomerId,
    customer_email: opts.email,
    metadata: opts.metadata,
    success_url: `${appUrl()}${opts.successPath}${opts.successPath.includes("?") ? "&" : "?"}checkout_id={CHECKOUT_ID}`,
    return_url: `${appUrl()}${opts.returnPath}`,
    ...(opts.seats !== undefined ? { seats: opts.seats } : {}),
    ...(opts.customerIp ? { customer_ip_address: opts.customerIp } : {}),
  });
  const url = typeof session.url === "string" ? session.url : "";
  if (!url.startsWith("https://")) fail("maintenance", "Payments couldn't be started. Try again shortly.");
  return url;
}

/** A customer portal session for the person's own Polar customer (by their profile id). */
export async function customerPortal(externalCustomerId: string, returnPath: string): Promise<string> {
  const session = await polarPost("customer-sessions/", { external_customer_id: externalCustomerId, return_url: `${appUrl()}${returnPath}` });
  const url = typeof session.customer_portal_url === "string" ? session.customer_portal_url : "";
  if (!url.startsWith("https://")) fail("maintenance", "The billing portal couldn't be opened. Try again shortly.");
  return url;
}

// ---------------------------------------------------------------------------------------------------
// Webhooks (Standard Webhooks)
// ---------------------------------------------------------------------------------------------------

/** Deliveries older (or newer) than this are refused, so a captured request can't be replayed later. */
export const WEBHOOK_TOLERANCE_S = 300;

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * The HMAC keys a Polar secret may stand for. Standard Webhooks: base64-decode what follows "whsec_".
 * Polar secrets made before September 2026 are used as the UTF-8 bytes of the whole string (Polar's SDK
 * tries both), so both are tried here too.
 */
export function webhookKeys(secret: string): Uint8Array[] {
  const keys: Uint8Array[] = [new TextEncoder().encode(secret)];
  if (secret.startsWith("whsec_")) {
    const decoded = base64ToBytes(secret.slice("whsec_".length));
    if (decoded && decoded.length) keys.push(decoded);
  }
  return keys;
}

/** The signature Standard Webhooks expects for a delivery under one key (base64 HMAC-SHA256). */
export async function signWebhook(key: Uint8Array, id: string, timestamp: string, body: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", key as Uint8Array<ArrayBuffer>, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToBase64(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
}

/**
 * Verifies a Polar webhook delivery: `webhook-id`, `webhook-timestamp` (seconds, within 5 minutes) and
 * `webhook-signature` (space-separated "v1,<base64>" entries; any one may match).
 */
export async function verifyPolarWebhook(body: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, secret: string, now = Date.now()): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > WEBHOOK_TOLERANCE_S) return false;
  const given = signature
    .split(" ")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("v1,"))
    .map((s) => s.slice(3));
  if (!given.length) return false;
  for (const key of webhookKeys(secret)) {
    const expected = await signWebhook(key, id, timestamp, body);
    if (given.some((g) => g.length === expected.length && timingSafeEqualHex(g, expected))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------
// Reading Polar objects
// ---------------------------------------------------------------------------------------------------

export const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
export const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
/** An ISO date (Polar's format) in ms. */
export const ms = (v: unknown) => {
  const s = str(v);
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
};
export const metadataOf = (o: Json): Record<string, string> => {
  const m = o.metadata;
  if (!m || typeof m !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m as Json)) if (typeof v === "string") out[k] = v;
  return out;
};
/** The customer's external id (our profile id), from the object or its embedded customer. */
export const externalCustomerIdOf = (o: Json) => str((o.customer as Json | undefined)?.external_id) ?? str(o.external_customer_id);
