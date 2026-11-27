// Folevi's plans: one catalog for every price and limit. The web app imports this file too
// (apps/web/src/lib/plans.ts re-exports it) so pricing is never duplicated. docs/BILLING.md explains it.
//
// The same four plans exist for Personal and for Team (a workspace), and they never affect each other:
// - Personal plans (Free, Core, Pro, Pro AI) belong to a person and cover their Personal: its storage, their
//   devices, and their AI credits in Personal (and in free workspaces, see below).
// - Team plans (Free, Core, Pro, Pro AI) belong to a workspace. Paid team plans are billed per member seat
//   (convex/workspaceBilling.ts, lib/seats.ts); every member gets the plan's storage and AI credits for
//   that workspace, per person. Guests are never billed.
//
// Storage (lib/entitlements.ts):
// - Free: 500 MB in total, shared by the owner's Personal (while it's on Free) and every free workspace they
//   own. Every upload in those workspaces, by anyone, counts against the owner's 500 MB.
// - Core / Pro / Pro AI: 5 GB / 10 GB / 25 GB per person (2026-11-27 prices). In a paid workspace each member's
//   own uploads count against their own quota there; a guest's uploads count against the page owner's.
//
// AI credits (lib/credits.ts): 1 credit = $0.01 of model cost. Monthly credits per person (Free 30, Core 0,
// Pro 150, Pro AI 450), plus one-time packs on every plan that last 12 months and are used after the monthly
// credits. Every plan includes Foli AI; people can also use their own AI key. Turning Foli AI off is a
// setting (profiles.aiEnabled, workspaces.aiDisabled).

import { isServerEdition } from "./edition";

export type PlanScope = "personal" | "workspace";
export type BillingInterval = "month" | "year";
export type BillingModel = "free" | "flat_user" | "per_seat";
export type PersonalTier = "free" | "core" | "pro" | "pro_ai";
export type WorkspaceTier = "free" | "core" | "pro" | "pro_ai";
export type PlanTier = PersonalTier;

export type PersonalPlanId = "personal_free" | "personal_core_monthly" | "personal_core_yearly" | "personal_pro_monthly" | "personal_pro_yearly" | "personal_pro_ai_monthly" | "personal_pro_ai_yearly";
export type WorkspacePlanId = "workspace_free" | "workspace_core_monthly" | "workspace_core_yearly" | "workspace_pro_monthly" | "workspace_pro_yearly" | "workspace_pro_ai_monthly" | "workspace_pro_ai_yearly";
export type PaidWorkspacePlanId = Exclude<WorkspacePlanId, "workspace_free">;
export type CatalogPlanId = PersonalPlanId | WorkspacePlanId;

/**
 * What a plan includes. Flags for features that don't exist yet stay false (or null) until they're built,
 * so nothing is promised that the product can't do.
 */
export interface PlanEntitlements {
  /** Free: the owner's shared pool. Paid: per person (in a workspace, per member). */
  storageBytes: number;
  storageRule: "shared_free" | "per_person";
  /** Devices signed in to one account at once (Personal plans only); null = unlimited or not applicable. */
  devices: number | null;
  /** Whether the AI Assistant can be used on the plan (every plan, since 2026-11-27); how much is the credits. */
  aiAssistant: boolean;
  /** AI credits per person per month (reset each billing period; Free: each calendar month, UTC). */
  monthlyCredits: number;
  /** Whether credit packs can be bought (every plan, since 2026-11-27). */
  creditPacks: boolean;
  /** The hourly abuse limit (convex/lib/rateLimit.ts rules `ai` and `aiHigh`). The credits are the real limit. */
  aiFairUse: "standard" | "high";
  /** Workspace members / guests allowed; null = no plan limit. */
  members: number | null;
  guests: number | null;
  /** How long page versions are kept (the snapshot retention job, the same on every plan today). */
  versionHistoryDays: number;
  advancedPermissions: boolean;
  auditLog: boolean;
  workspaceAnalytics: boolean;
  securityControls: boolean;
  prioritySupport: boolean;
  /** Sharing pages with people outside the workspace (page shares and public links). */
  externalSharing: boolean;
  /** Export a page or everything as a ZIP. */
  exports: boolean;
}

export interface CatalogPlan {
  id: CatalogPlanId;
  scope: PlanScope;
  tier: PlanTier;
  /** null for free plans. */
  interval: BillingInterval | null;
  /** US cents per interval; per member seat when billingModel is "per_seat". */
  priceCents: number;
  currency: "usd";
  billingModel: BillingModel;
  entitlements: PlanEntitlements;
}

export const MB = 1024 * 1024;
export const GB = 1024 * MB;
/** A storage size as the plans name it ("500 MB", "10 GB"). */
export const sizeLabel = (bytes: number) => (bytes >= GB ? `${bytes / GB} GB` : `${Math.round(bytes / MB)} MB`);

/** AI credits per person per month, per tier. */
// Free has AI only during the trial (2026-10-11): after it, Foli AI needs Pro or Pro AI.
export const MONTHLY_CREDITS: Record<PlanTier, number> = { free: 30, core: 0, pro: 150, pro_ai: 450 };
/** Storage per tier: Free is the shared pool; paid tiers are per person. */
export const STORAGE_BYTES: Record<PlanTier, number> = { free: 500 * MB, core: 5 * GB, pro: 10 * GB, pro_ai: 25 * GB };
/**
 * Every tier can use Foli AI (owner decision 2026-11-27, docs/PRICING_PLAN.md): Core has no included credits but
 * works with credit packs and the person's own AI key. Turning Foli AI off is a setting (profiles.aiEnabled,
 * workspaces.aiDisabled), not a plan.
 */
export const tierHasAi = (_tier: PlanTier) => true;

const BASE: Pick<PlanEntitlements, "members" | "guests" | "versionHistoryDays" | "advancedPermissions" | "auditLog" | "workspaceAnalytics" | "securityControls" | "prioritySupport" | "externalSharing" | "exports"> = {
  members: null,
  guests: null,
  versionHistoryDays: 30,
  advancedPermissions: false,
  auditLog: false,
  workspaceAnalytics: false,
  securityControls: false,
  prioritySupport: false,
  externalSharing: true,
  exports: true,
};

const tierEntitlements = (tier: PlanTier, _scope: PlanScope): PlanEntitlements => ({
  ...BASE,
  storageBytes: STORAGE_BYTES[tier],
  storageRule: tier === "free" ? "shared_free" : "per_person",
  // No plan limits devices (the Free limit was removed 2026-11-27, docs/PRICING_PLAN.md).
  devices: null,
  aiAssistant: tierHasAi(tier),
  monthlyCredits: MONTHLY_CREDITS[tier],
  creditPacks: true,
  aiFairUse: tier === "pro_ai" ? "high" : "standard",
});

const plan = (id: CatalogPlanId, scope: PlanScope, tier: PlanTier, interval: BillingInterval | null, priceCents: number): CatalogPlan => ({
  id,
  scope,
  tier,
  interval,
  priceCents,
  currency: "usd",
  billingModel: tier === "free" ? "free" : scope === "personal" ? "flat_user" : "per_seat",
  entitlements: tierEntitlements(tier, scope),
});

/** Prices in US cents (Team prices are per member seat). */
export const PRICES: Record<Exclude<PlanTier, "free">, Record<BillingInterval, number>> = {
  core: { month: 200, year: 2000 },
  pro: { month: 400, year: 4000 },
  pro_ai: { month: 1000, year: 10000 },
};

export const PLAN_CATALOG: Record<CatalogPlanId, CatalogPlan> = {
  personal_free: plan("personal_free", "personal", "free", null, 0),
  personal_core_monthly: plan("personal_core_monthly", "personal", "core", "month", PRICES.core.month),
  personal_core_yearly: plan("personal_core_yearly", "personal", "core", "year", PRICES.core.year),
  personal_pro_monthly: plan("personal_pro_monthly", "personal", "pro", "month", PRICES.pro.month),
  personal_pro_yearly: plan("personal_pro_yearly", "personal", "pro", "year", PRICES.pro.year),
  personal_pro_ai_monthly: plan("personal_pro_ai_monthly", "personal", "pro_ai", "month", PRICES.pro_ai.month),
  personal_pro_ai_yearly: plan("personal_pro_ai_yearly", "personal", "pro_ai", "year", PRICES.pro_ai.year),
  workspace_free: plan("workspace_free", "workspace", "free", null, 0),
  workspace_core_monthly: plan("workspace_core_monthly", "workspace", "core", "month", PRICES.core.month),
  workspace_core_yearly: plan("workspace_core_yearly", "workspace", "core", "year", PRICES.core.year),
  workspace_pro_monthly: plan("workspace_pro_monthly", "workspace", "pro", "month", PRICES.pro.month),
  workspace_pro_yearly: plan("workspace_pro_yearly", "workspace", "pro", "year", PRICES.pro.year),
  workspace_pro_ai_monthly: plan("workspace_pro_ai_monthly", "workspace", "pro_ai", "month", PRICES.pro_ai.month),
  workspace_pro_ai_yearly: plan("workspace_pro_ai_yearly", "workspace", "pro_ai", "year", PRICES.pro_ai.year),
};

/** The catalog id for a personal tier and interval (a paid plan without an interval is monthly). */
export function personalPlanId(tier: PersonalTier, interval?: BillingInterval | null): PersonalPlanId {
  if (tier === "free") return "personal_free";
  return `personal_${tier}_${interval === "year" ? "yearly" : "monthly"}`;
}

export function workspacePlanId(tier: WorkspaceTier, interval?: BillingInterval | null): WorkspacePlanId {
  if (tier === "free") return "workspace_free";
  return `workspace_${tier}_${interval === "year" ? "yearly" : "monthly"}`;
}

/** Whether a plan is paid for (anything but the free plans). */
export const isPaidPlan = (id: CatalogPlanId) => PLAN_CATALOG[id].billingModel !== "free";

/**
 * The quantity a paid per-seat plan is billed for, given the billable seats (counted only by
 * convex/lib/seats.ts): never fewer than one. A paid plan always bills at least its owner's seat, even
 * while the owner's account is suspended. Every quantity sent to Polar, stored or shown comes from here.
 */
export const billedQuantity = (seats: number) => Math.max(1, seats);

/** What a per-seat plan charges per billing interval for `seats` billable seats. */
export const seatChargeCents = (seatPriceCents: number, seats: number) => seatPriceCents * billedQuantity(seats);

// ---------------------------------------------------------------------------------------------------
// AI credit packs and the trial
// ---------------------------------------------------------------------------------------------------

export type CreditPackId = "credits_500" | "credits_1000";
export interface CreditPack {
  id: CreditPackId;
  credits: number;
  priceCents: number;
}
/** One-time AI credit packs (every plan): valid 12 months, used after the monthly credits. */
export const CREDIT_PACKS: Record<CreditPackId, CreditPack> = {
  credits_500: { id: "credits_500", credits: 500, priceCents: 800 },
  credits_1000: { id: "credits_1000", credits: 1000, priceCents: 1500 },
};
export const CREDIT_PACK_ORDER: CreditPackId[] = ["credits_500", "credits_1000"];
/** How long bought (or granted) credits last. */
export const PACK_VALID_MONTHS = 12;

/** New accounts get Pro AI free for this long. */
export const TRIAL_DAYS = 7;
/** The plan a trial gives. */
export const TRIAL_TIER: PersonalTier = "pro_ai";
/** AI credits for the whole trial (a fixed allowance; about what a week of Pro AI costs at most). */
export const TRIAL_CREDITS = 100;
export const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------------------------------
// How plans are shown (settings, pricing page, admin). Prices and limits come from the catalog above.
// ---------------------------------------------------------------------------------------------------

/** Where Folevi runs (Linux is in Beta). */
export const AVAILABILITY = "On the web, Mac, iPhone, iPad, Android, Windows and Linux";

export const TIER_NAMES: Record<PlanTier, string> = { free: "Free", core: "Core", pro: "Pro", pro_ai: "Pro AI" };

export interface PersonalPlanCard {
  tier: PersonalTier;
  name: string;
  monthly: PersonalPlanId;
  yearly: PersonalPlanId;
  /** Prices in US cents, from the catalog. */
  monthlyCents: number;
  yearlyCents: number;
  storageBytes: number;
  devices: number | null;
  /** Whether the plan includes the AI Assistant (every plan but Core). */
  ai: boolean;
  monthlyCredits: number;
  blurb: string;
  features: string[];
}

const personalCard = (tier: PersonalTier, blurb: string, features: string[]): PersonalPlanCard => {
  const monthly = personalPlanId(tier, "month");
  const yearly = personalPlanId(tier, "year");
  const e = PLAN_CATALOG[monthly].entitlements;
  return {
    tier,
    name: TIER_NAMES[tier],
    monthly,
    yearly,
    monthlyCents: PLAN_CATALOG[monthly].priceCents,
    yearlyCents: tier === "free" ? 0 : PLAN_CATALOG[yearly].priceCents,
    storageBytes: e.storageBytes,
    devices: e.devices,
    ai: e.aiAssistant,
    monthlyCredits: e.monthlyCredits,
    blurb,
    features,
  };
};

/** The four Personal plans, as cards. */
export const PLANS: Record<PersonalTier, PersonalPlanCard> = {
  free: personalCard("free", "Try Folevi Cloud for free.", [
    `${sizeLabel(STORAGE_BYTES.free)} storage, shared with the free workspaces you own`,
    `${MONTHLY_CREDITS.free} AI credits a month`,
    "Unlimited devices",
    "Unlimited notes, folders and tasks",
    AVAILABILITY,
  ]),
  core: personalCard("core", "More room in Folevi Cloud.", [
    `${sizeLabel(STORAGE_BYTES.core)} storage`,
    "No AI credits included: buy credits when you want Foli AI",
    "Unlimited devices",
    "Everything in Free",
  ]),
  pro: personalCard("pro", "More room, and Foli AI most days.", [
    `${sizeLabel(STORAGE_BYTES.pro)} storage`,
    `${MONTHLY_CREDITS.pro} AI credits a month`,
    "Unlimited devices",
    "Buy more AI credits when you need them",
    "Everything in Core",
  ]),
  pro_ai: personalCard("pro_ai", "For people who use Foli AI all day.", [
    `${sizeLabel(STORAGE_BYTES.pro_ai)} storage`,
    `${MONTHLY_CREDITS.pro_ai} AI credits a month, the most of any plan`,
    "Unlimited devices",
    "Buy more AI credits when you need them",
    "Everything in Pro",
  ]),
};
export const PLAN_ORDER: PersonalTier[] = ["free", "core", "pro", "pro_ai"];

export interface WorkspacePlanCard {
  tier: WorkspaceTier;
  name: string;
  monthly: WorkspacePlanId;
  yearly: WorkspacePlanId;
  monthlyCents: number;
  yearlyCents: number;
  perSeat: boolean;
  storageBytes: number;
  monthlyCredits: number;
  blurb: string;
  features: string[];
  /** Kept for older clients; checkout availability comes from the server (workspaceBilling.summary). */
  available: boolean;
}

const workspaceCard = (tier: WorkspaceTier, blurb: string, features: string[]): WorkspacePlanCard => {
  const monthly = workspacePlanId(tier, "month");
  const yearly = workspacePlanId(tier, "year");
  const e = PLAN_CATALOG[monthly].entitlements;
  return {
    tier,
    name: TIER_NAMES[tier],
    monthly,
    yearly,
    monthlyCents: PLAN_CATALOG[monthly].priceCents,
    yearlyCents: tier === "free" ? 0 : PLAN_CATALOG[yearly].priceCents,
    perSeat: PLAN_CATALOG[monthly].billingModel === "per_seat",
    storageBytes: e.storageBytes,
    monthlyCredits: e.monthlyCredits,
    blurb,
    features,
    available: true,
  };
};

/** The four Team (workspace) plans, as cards. Only what exists is listed. */
export const WORKSPACE_PLANS: Record<WorkspaceTier, WorkspacePlanCard> = {
  free: workspaceCard("free", "For simple collaboration.", [
    `Uses the owner's free ${sizeLabel(STORAGE_BYTES.free)}`,
    "Members use their own AI credits",
    "Unlimited members and guests",
    "Shared notes, folders and tasks",
  ]),
  core: workspaceCard("core", "More room for every member.", [
    `${sizeLabel(STORAGE_BYTES.core)} per member`,
    "No AI credits included: members buy credits when they want Foli AI",
    "Unlimited members, each billed; guests are free",
    "Everything in Free",
  ]),
  pro: workspaceCard("pro", "More room and AI for every member.", [
    `${sizeLabel(STORAGE_BYTES.pro)} per member`,
    `${MONTHLY_CREDITS.pro} AI credits per member a month`,
    "Unlimited members, each billed; guests are free",
    "Everything in Core",
  ]),
  pro_ai: workspaceCard("pro_ai", "AI as much as your team needs.", [
    `${sizeLabel(STORAGE_BYTES.pro_ai)} per member`,
    `${MONTHLY_CREDITS.pro_ai} AI credits per member a month, the most of any plan`,
    "Unlimited members, each billed; guests are free",
    "Everything in Pro",
  ]),
};
export const WORKSPACE_PLAN_ORDER: WorkspaceTier[] = ["free", "core", "pro", "pro_ai"];

/** A plan's display name ("Pro AI", "Workspace Free"…). */
export function planName(id: CatalogPlanId): string {
  const p = PLAN_CATALOG[id];
  return p.scope === "personal" ? TIER_NAMES[p.tier] : `Workspace ${TIER_NAMES[p.tier]}`;
}

export const formatPrice = (cents: number) => (cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`);
/** A yearly price per month, rounded down to the cent ("$4.08", "$12.41"). */
export const monthlyEquivalent = (yearlyCents: number) => formatPrice(Math.floor(yearlyCents / 12));
/** Monthly equivalent of a price, for MRR. */
export const monthlyValueCents = (id: CatalogPlanId) => {
  const p = PLAN_CATALOG[id];
  return p.interval === "year" ? Math.round(p.priceCents / 12) : p.priceCents;
};
/** How much paying yearly saves on a tier, in whole percent. */
export const yearlySavingPercent = (tier: Exclude<PlanTier, "free">) => Math.round((1 - PRICES[tier].year / (PRICES[tier].month * 12)) * 100);

// ---------------------------------------------------------------------------------------------------
// Personal entitlements
// ---------------------------------------------------------------------------------------------------

/** The billing record fields personal entitlements depend on (see the subscriptions table). */
export interface SubscriptionLike {
  plan: PersonalTier;
  interval?: BillingInterval;
  status: "active" | "past_due" | "canceled";
  trialEndsAt?: number;
  currentPeriodEnd?: number;
  storageOverrideBytes?: number;
  /** An admin-set device limit that replaces the plan's. */
  deviceLimitOverride?: number | "unlimited";
}

/** What a person's own (Personal) plan gives them. */
export interface PersonalEntitlements {
  scope: "personal";
  /** The plan in effect right now (a trial counts as Pro AI monthly). */
  planId: PersonalPlanId;
  /** The plan paid for (or set by an admin), ignoring the trial. */
  paidPlanId: PersonalPlanId;
  /** planId's tier (kept for older clients). */
  plan: PersonalTier;
  /** paidPlanId's tier (kept for older clients). */
  paidPlan: PersonalTier;
  /** Whether they pay for (or were given) a plan. */
  paid: boolean;
  trialing: boolean;
  trialEndsAt: number | null;
  /** Whether the plan includes the AI Assistant (false only on Core); credits decide how much. */
  ai: boolean;
  aiSource: "plan" | "trial" | null;
  aiFairUse: "standard" | "high";
  /** AI credits a month (the trial: TRIAL_CREDITS for the whole trial). */
  monthlyCredits: number;
  creditPacks: boolean;
  /** Personal storage limit. On Free (not trialing) this is the shared pool with free workspaces owned. */
  storageBytes: number;
  storageRule: "shared_free" | "per_person";
  /** Devices that can use the account at once; null = unlimited. */
  devices: number | null;
}

/**
 * Folevi Server has no plans or billing (docs/SELF_HOSTING_PLAN.md §7): everyone has everything, with no trial.
 * Storage is limited only by the server's quotas (lib/serverSettings.ts, checked in lib/entitlements.ts), and Foli
 * AI by the server's monthly limit per person, when the owner set one.
 */
export const SERVER_STORAGE_BYTES = Number.MAX_SAFE_INTEGER;
/** "Unlimited" AI credits a month on a server (a limit set in the server's settings replaces it). */
export const SERVER_MONTHLY_CREDITS = 1_000_000_000;

function serverPersonalEntitlements(sub: SubscriptionLike | null): PersonalEntitlements {
  const planId: PersonalPlanId = "personal_pro_ai_yearly";
  const e = PLAN_CATALOG[planId].entitlements;
  return {
    scope: "personal",
    planId,
    paidPlanId: planId,
    plan: "pro_ai",
    paidPlan: "pro_ai",
    paid: true,
    trialing: false,
    trialEndsAt: null,
    ai: true,
    aiSource: "plan",
    aiFairUse: e.aiFairUse,
    monthlyCredits: SERVER_MONTHLY_CREDITS,
    creditPacks: false,
    storageBytes: sub?.storageOverrideBytes ?? SERVER_STORAGE_BYTES,
    storageRule: "per_person",
    devices: null,
  };
}

/** What someone's Personal plan gives right now. No record (older accounts before billing) = Free. */
export function personalEntitlementsOf(sub: SubscriptionLike | null, now: number): PersonalEntitlements {
  if (isServerEdition()) return serverPersonalEntitlements(sub);
  // A paid (or admin-set) plan counts while it's active or in its grace period; a period end in the past
  // (a manual plan that ran out, a lapsed subscription) falls back to Free.
  const storedId = sub ? personalPlanId(sub.plan, sub.interval) : "personal_free";
  const paidActive = sub && isPaidPlan(storedId) && sub.status !== "canceled" && (sub.currentPeriodEnd === undefined || sub.currentPeriodEnd > now);
  const canceledButPaidThrough = sub && isPaidPlan(storedId) && sub.status === "canceled" && sub.currentPeriodEnd !== undefined && sub.currentPeriodEnd > now;
  const paidPlanId: PersonalPlanId = paidActive || canceledButPaidThrough ? storedId : "personal_free";
  const paidPlan = PLAN_CATALOG[paidPlanId];
  // The trial gives Pro AI to anyone who isn't paying for a plan.
  const trialing = Boolean(sub?.trialEndsAt && sub.trialEndsAt > now && !isPaidPlan(paidPlanId));
  const planId: PersonalPlanId = trialing ? personalPlanId(TRIAL_TIER, "month") : paidPlanId;
  const e = PLAN_CATALOG[planId].entitlements;
  return {
    scope: "personal",
    planId,
    paidPlanId,
    plan: PLAN_CATALOG[planId].tier,
    paidPlan: paidPlan.tier,
    paid: isPaidPlan(paidPlanId),
    trialing,
    trialEndsAt: sub?.trialEndsAt ?? null,
    ai: e.aiAssistant,
    aiSource: trialing ? "trial" : e.aiAssistant ? "plan" : null,
    aiFairUse: e.aiFairUse,
    monthlyCredits: trialing ? TRIAL_CREDITS : e.monthlyCredits,
    creditPacks: e.creditPacks,
    storageBytes: sub?.storageOverrideBytes ?? e.storageBytes,
    storageRule: e.storageRule,
    devices: sub?.deviceLimitOverride === "unlimited" ? null : (sub?.deviceLimitOverride ?? e.devices),
  };
}

// ---------------------------------------------------------------------------------------------------
// Workspace entitlements
// ---------------------------------------------------------------------------------------------------

/** A workspace's subscription, as the entitlement rules read it (none: Workspace Free). */
export interface WorkspaceSubscriptionLike {
  tier: WorkspaceTier;
  interval?: BillingInterval;
  status: "active" | "past_due" | "canceled";
  currentPeriodEnd?: number;
}

/** What a workspace's plan gives everyone working in it. */
export interface WorkspaceEntitlements {
  scope: "workspace";
  planId: WorkspacePlanId;
  paidPlanId: WorkspacePlanId;
  paid: boolean;
  /** Whether AI can be used here at all (false on Core); on Free each member uses their own personal credits. */
  ai: boolean;
  aiFairUse: "standard" | "high";
  /** AI credits per member a month here; 0 on Free (members use their personal credits). */
  monthlyCredits: number;
  creditPacks: boolean;
  /** Free: the owner's shared pool (500 MB). Paid: per member. An admin override: the workspace's own total. */
  storageBytes: number;
  storageRule: "shared_free" | "per_person" | "override";
  /** Whether an admin set this workspace's storage limit by hand (it replaces the plan's). */
  storageOverridden: boolean;
  members: number | null;
  guests: number | null;
  versionHistoryDays: number;
  advancedPermissions: boolean;
  auditLog: boolean;
  workspaceAnalytics: boolean;
  securityControls: boolean;
  prioritySupport: boolean;
  externalSharing: boolean;
  exports: boolean;
}

export function workspaceEntitlementsOf(sub: WorkspaceSubscriptionLike | null, overrides: { storageBytes?: number }, now: number): WorkspaceEntitlements {
  const storedId = sub ? workspacePlanId(sub.tier, sub.interval) : "workspace_free";
  // Same rule as Personal: in force while active, or canceled but paid through the period's end.
  const inForce = sub && isPaidPlan(storedId) && (sub.currentPeriodEnd === undefined ? sub.status !== "canceled" : sub.currentPeriodEnd > now);
  // Folevi Server: every workspace has the top plan, unbilled (storage is limited by people's quotas).
  if (isServerEdition()) {
    const top = workspaceEntitlementsOfPlan("workspace_pro_ai_yearly", overrides);
    return { ...top, monthlyCredits: SERVER_MONTHLY_CREDITS, creditPacks: false, members: null, guests: null, storageBytes: overrides.storageBytes ?? SERVER_STORAGE_BYTES };
  }
  const planId: WorkspacePlanId = inForce ? storedId : "workspace_free";
  return workspaceEntitlementsOfPlan(planId, overrides);
}

function workspaceEntitlementsOfPlan(planId: WorkspacePlanId, overrides: { storageBytes?: number }): WorkspaceEntitlements {
  const e = PLAN_CATALOG[planId].entitlements;
  const paid = isPaidPlan(planId);
  return {
    scope: "workspace",
    planId,
    paidPlanId: planId,
    paid,
    ai: e.aiAssistant,
    aiFairUse: e.aiFairUse,
    monthlyCredits: paid ? e.monthlyCredits : 0,
    creditPacks: e.creditPacks,
    storageBytes: overrides.storageBytes ?? e.storageBytes,
    storageRule: overrides.storageBytes !== undefined ? "override" : e.storageRule,
    storageOverridden: overrides.storageBytes !== undefined,
    members: e.members,
    guests: e.guests,
    versionHistoryDays: e.versionHistoryDays,
    advancedPermissions: e.advancedPermissions,
    auditLog: e.auditLog,
    workspaceAnalytics: e.workspaceAnalytics,
    securityControls: e.securityControls,
    prioritySupport: e.prioritySupport,
    externalSharing: e.externalSharing,
    exports: e.exports,
  };
}

export type Entitlements = PersonalEntitlements | WorkspaceEntitlements;

// ---------------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------------

/** `t` plus `months` calendar months (UTC), the day clamped to the month's length (Jan 31 + 1 = Feb 28). */
export function addMonthsUtc(t: number, months: number): number {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

/** The first moment of the calendar month (UTC) containing `t`. */
export function monthStartUtc(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}
