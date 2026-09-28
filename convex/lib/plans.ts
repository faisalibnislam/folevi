// Folevi's plans and what each includes. The single source of truth for prices, storage and AI — the web
// app imports this file too (apps/web/src/lib/plans.ts re-exports it) so pricing is never duplicated.
//
// Storage counts across every workspace a person owns (their personal workspace and team workspaces they
// own). Members of a team workspace use the owner's storage there.

export type PlanId = "free" | "basic" | "pro";
export type BillingInterval = "month" | "year";

export interface Plan {
  id: PlanId;
  name: string;
  /** Prices in US cents. */
  monthlyCents: number;
  yearlyCents: number;
  storageBytes: number;
  /** How many devices (signed-in browsers and apps) can use the account at once; null = unlimited. */
  devices: number | null;
  ai: boolean;
  blurb: string;
  features: string[];
}

const GB = 1024 * 1024 * 1024;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    monthlyCents: 0,
    yearlyCents: 0,
    storageBytes: 1 * GB,
    devices: 2,
    ai: false,
    blurb: "Everything you need to write and organize. No card required.",
    features: ["1 GB storage across all your workspaces", "Use on 2 devices", "Web, Mac and iOS", "Unlimited notes, folders and tasks", "Team workspaces and sharing"],
  },
  basic: {
    id: "basic",
    name: "Basic",
    monthlyCents: 200,
    yearlyCents: 900,
    storageBytes: 20 * GB,
    devices: null,
    ai: false,
    blurb: "Room for all your files, images and attachments.",
    features: ["20 GB storage across all your workspaces", "Unlimited devices", "Web, Mac and iOS", "Everything in Free"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyCents: 500,
    yearlyCents: 4900,
    storageBytes: 100 * GB,
    devices: null,
    ai: true,
    blurb: "Unlimited AI to write, summarize and find anything in your notes.",
    features: ["Unlimited AI Assistant", "100 GB storage across all your workspaces", "Unlimited devices", "Web, Mac and iOS", "Everything in Basic"],
  },
};
export const PLAN_ORDER: PlanId[] = ["free", "basic", "pro"];
/** New accounts get Pro free for this long. */
export const TRIAL_DAYS = 7;
export const DAY_MS = 86_400_000;

export const formatPrice = (cents: number) => (cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`);
/** Monthly equivalent of a price, for MRR. */
export const monthlyValueCents = (plan: PlanId, interval: BillingInterval) => (interval === "year" ? Math.round(PLANS[plan].yearlyCents / 12) : PLANS[plan].monthlyCents);

/** The billing record fields entitlements depend on (see the subscriptions table). */
export interface SubscriptionLike {
  plan: PlanId;
  interval?: BillingInterval;
  status: "active" | "past_due" | "canceled";
  trialEndsAt?: number;
  currentPeriodEnd?: number;
  aiGrantUntil?: number | null;
  aiGrant?: boolean;
  storageOverrideBytes?: number;
  /** An admin-set device limit that replaces the plan's. */
  deviceLimitOverride?: number | "unlimited";
}

export interface Entitlements {
  /** The plan in effect right now (a trial counts as Pro). */
  plan: PlanId;
  /** The plan paid for (or set by an admin), ignoring the trial. */
  paidPlan: PlanId;
  trialing: boolean;
  trialEndsAt: number | null;
  ai: boolean;
  aiSource: "plan" | "trial" | "grant" | null;
  storageBytes: number;
  /** Devices that can use the account at once; null = unlimited. */
  devices: number | null;
}

/** What someone gets right now. No record (older accounts before billing) = Free. */
export function entitlementsOf(sub: SubscriptionLike | null, now: number): Entitlements {
  // A paid (or admin-set) plan counts while it's active or in its grace period; a period end in the past
  // (a manual plan that ran out, a lapsed subscription) falls back to Free.
  const paidActive = sub && sub.plan !== "free" && sub.status !== "canceled" && (sub.currentPeriodEnd === undefined || sub.currentPeriodEnd > now);
  const canceledButPaidThrough = sub && sub.plan !== "free" && sub.status === "canceled" && sub.currentPeriodEnd !== undefined && sub.currentPeriodEnd > now;
  const paidPlan: PlanId = sub && (paidActive || canceledButPaidThrough) ? sub.plan : "free";
  const trialing = Boolean(sub?.trialEndsAt && sub.trialEndsAt > now && paidPlan !== "pro");
  const plan: PlanId = trialing ? "pro" : paidPlan;
  const grant = Boolean(sub?.aiGrant && (sub.aiGrantUntil === undefined || sub.aiGrantUntil === null || sub.aiGrantUntil > now));
  const ai = PLANS[plan].ai || grant;
  return {
    plan,
    paidPlan,
    trialing,
    trialEndsAt: sub?.trialEndsAt ?? null,
    ai,
    aiSource: PLANS[paidPlan].ai ? "plan" : grant ? "grant" : trialing ? "trial" : null,
    storageBytes: sub?.storageOverrideBytes ?? PLANS[plan].storageBytes,
    devices: sub?.deviceLimitOverride === "unlimited" ? null : (sub?.deviceLimitOverride ?? PLANS[plan].devices),
  };
}
