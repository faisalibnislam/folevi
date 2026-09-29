// Stripe over plain HTTPS (no SDK): the secret key, price ids, and small request helpers shared by Personal
// billing (convex/billing.ts) and workspace billing (convex/workspaceBilling.ts). Only actions call Stripe.
// Nothing here logs request bodies, keys or email addresses.
import { fail } from "./errors";
import type { BillingInterval, WorkspacePlanId } from "./plans";

export const stripeKey = () => process.env.STRIPE_SECRET_KEY ?? "";
export const appUrl = () => (process.env.FOLEVI_APP_URL ?? "http://app.localhost:3000").replace(/\/$/, "");
/** Development and test deployments may switch plans without paying; production never. */
export const testPurchasesAllowed = () => process.env.FOLEVI_ENV !== "production";

type Params = Record<string, string>;

async function request(method: "GET" | "POST", path: string, params: Params = {}): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params).toString();
  const url = `https://api.stripe.com/v1/${path}${method === "GET" && body ? `?${body}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${stripeKey()}`, ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: method === "POST" ? body : undefined,
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    // The path only (ids of Stripe objects, no personal data); never the body or the key.
    console.warn(JSON.stringify({ event: "billing.stripe_error", path: path.replace(/\/[^/]+$/, "/…"), status: res.status }));
    fail("maintenance", "Payments couldn’t be started. Try again shortly.");
  }
  return data;
}

export const stripePost = (path: string, params: Params) => request("POST", path, params);
export const stripeGet = (path: string, params: Params = {}) => request("GET", path, params);

// ---------------------------------------------------------------------------------------------------
// Workspace prices (per member seat): STRIPE_PRICE_WS_TEAM_MONTH | _YEAR, STRIPE_PRICE_WS_BUSINESS_MONTH | _YEAR
// ---------------------------------------------------------------------------------------------------

type PaidWorkspacePlanId = Exclude<WorkspacePlanId, "workspace_free">;
export const PAID_WORKSPACE_PLAN_IDS: PaidWorkspacePlanId[] = ["workspace_team_monthly", "workspace_team_yearly", "workspace_business_monthly", "workspace_business_yearly"];

export function workspacePriceId(planId: PaidWorkspacePlanId): string | undefined {
  const [, tier, interval] = planId.split("_") as [string, "team" | "business", "monthly" | "yearly"];
  return process.env[`STRIPE_PRICE_WS_${tier.toUpperCase()}_${interval === "yearly" ? "YEAR" : "MONTH"}`] || undefined;
}

export function workspacePlanForPrice(priceId: string): PaidWorkspacePlanId | null {
  if (!priceId) return null;
  return PAID_WORKSPACE_PLAN_IDS.find((id) => workspacePriceId(id) === priceId) ?? null;
}

/** Workspace checkout needs the key and every workspace price. */
export const workspaceStripeReady = () => Boolean(stripeKey() && PAID_WORKSPACE_PLAN_IDS.every((id) => workspacePriceId(id)));

export const intervalOf = (planId: PaidWorkspacePlanId): BillingInterval => (planId.endsWith("yearly") ? "year" : "month");

// ---------------------------------------------------------------------------------------------------
// Reading Stripe objects (field positions differ between API versions)
// ---------------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);

/** The subscription an event's object refers to (a subscription itself, an invoice or a checkout session). */
export function subscriptionIdOf(o: Obj): string | null {
  if (String(o.object) === "subscription") return str(o.id) ?? null;
  const direct = o.subscription;
  if (typeof direct === "string") return direct;
  if (direct && typeof direct === "object") return str((direct as Obj).id) ?? null;
  // Newer API versions: invoice.parent.subscription_details.subscription
  const parent = o.parent as Obj | undefined;
  const details = parent?.subscription_details as Obj | undefined;
  return str(details?.subscription) ?? null;
}

export interface SubscriptionItem {
  id?: string;
  priceId: string;
  quantity?: number;
  periodStart?: number;
  periodEnd?: number;
}

export function subscriptionItems(o: Obj): SubscriptionItem[] {
  const data = ((o.items as Obj | undefined)?.data as Obj[] | undefined) ?? [];
  return data.map((i) => ({
    id: str(i.id),
    priceId: str((i.price as Obj | undefined)?.id) ?? "",
    quantity: num(i.quantity),
    periodStart: num(i.current_period_start),
    periodEnd: num(i.current_period_end),
  }));
}

/** A subscription's current period in ms (on the subscription in older API versions, on its items in newer). */
export function periodOf(o: Obj, item?: SubscriptionItem): { start?: number; end?: number } {
  const start = num(o.current_period_start) ?? item?.periodStart;
  const end = num(o.current_period_end) ?? item?.periodEnd;
  return { start: start === undefined ? undefined : start * 1000, end: end === undefined ? undefined : end * 1000 };
}

/** "Visa •••• 4242" from a charge's card details, when present. */
export function cardLabel(o: Obj): string | undefined {
  const card = ((o.payment_method_details as Obj | undefined)?.card as Obj | undefined) ?? undefined;
  const brand = str(card?.brand);
  const last4 = str(card?.last4);
  if (!brand || !last4 || !/^\d{4}$/.test(last4)) return undefined;
  const name = brand === "amex" ? "American Express" : brand.charAt(0).toUpperCase() + brand.slice(1);
  return `${name.slice(0, 30)} •••• ${last4}`;
}
