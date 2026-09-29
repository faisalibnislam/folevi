// Folevi's plans: one catalog for every price and limit. The web app imports this file too
// (apps/web/src/lib/plans.ts re-exports it) so pricing is never duplicated.
//
// There are two kinds of plan, and they never affect each other:
// - Personal plans belong to a person (Free, Basic, Pro). They cover that person's own notes and storage,
//   their devices, and the AI Assistant in Personal.
// - Workspace plans belong to a workspace (Free, Team, Business). They cover that workspace's storage and
//   the AI Assistant inside it. Paid workspace plans are billed per member seat (not on sale yet).
//
// A subscription row stores a personal tier ("free" | "basic" | "pro") and an interval; `personalPlanId`
// maps that to a catalog id. Entitlements are resolved in convex/lib/entitlements.ts; code checks
// capabilities (`ai`, `storageBytes`, `devices`…), never plan names.

export type PlanScope = "personal" | "workspace";
export type BillingInterval = "month" | "year";
export type BillingModel = "free" | "flat_user" | "per_seat";
/** What a personal subscription row stores. */
export type PersonalTier = "free" | "basic" | "pro";
export type WorkspaceTier = "free" | "team" | "business";
export type PlanTier = PersonalTier | WorkspaceTier;

export type PersonalPlanId = "personal_free" | "personal_basic_monthly" | "personal_basic_yearly" | "personal_pro_monthly" | "personal_pro_yearly";
export type WorkspacePlanId = "workspace_free" | "workspace_team_monthly" | "workspace_team_yearly" | "workspace_business_monthly" | "workspace_business_yearly";
export type CatalogPlanId = PersonalPlanId | WorkspacePlanId;

/**
 * What a plan includes. Flags for features that don't exist yet stay false (or null) until they're built,
 * so nothing is promised that the product can't do.
 */
export interface PlanEntitlements {
  storageBytes: number;
  /** Devices signed in to one account at once (Personal plans only); null = unlimited or not applicable. */
  devices: number | null;
  aiAssistant: boolean;
  /** The AI budget per person per hour (convex/lib/rateLimit.ts rules `ai` and `aiHigh`); null without AI. */
  aiFairUse: "standard" | "high" | null;
  /** Workspace members / guests allowed; null = no plan limit (Personal: not applicable). */
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

const GB = 1024 * 1024 * 1024;
const TB = 1024 * GB;

const BASE: Omit<PlanEntitlements, "storageBytes" | "devices" | "aiAssistant" | "aiFairUse"> = {
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

const PERSONAL_FREE: PlanEntitlements = { ...BASE, storageBytes: 1 * GB, devices: 2, aiAssistant: false, aiFairUse: null };
const PERSONAL_BASIC: PlanEntitlements = { ...BASE, storageBytes: 20 * GB, devices: null, aiAssistant: false, aiFairUse: null };
const PERSONAL_PRO: PlanEntitlements = { ...BASE, storageBytes: 100 * GB, devices: null, aiAssistant: true, aiFairUse: "standard" };
const WORKSPACE_FREE: PlanEntitlements = { ...BASE, storageBytes: 5 * GB, devices: null, aiAssistant: false, aiFairUse: null };
const WORKSPACE_TEAM: PlanEntitlements = { ...BASE, storageBytes: 100 * GB, devices: null, aiAssistant: true, aiFairUse: "standard" };
const WORKSPACE_BUSINESS: PlanEntitlements = { ...BASE, storageBytes: 1 * TB, devices: null, aiAssistant: true, aiFairUse: "high" };

const plan = (id: CatalogPlanId, scope: PlanScope, tier: PlanTier, interval: BillingInterval | null, priceCents: number, billingModel: BillingModel, entitlements: PlanEntitlements): CatalogPlan => ({
  id,
  scope,
  tier,
  interval,
  priceCents,
  currency: "usd",
  billingModel,
  entitlements,
});

export const PLAN_CATALOG: Record<CatalogPlanId, CatalogPlan> = {
  personal_free: plan("personal_free", "personal", "free", null, 0, "free", PERSONAL_FREE),
  personal_basic_monthly: plan("personal_basic_monthly", "personal", "basic", "month", 200, "flat_user", PERSONAL_BASIC),
  personal_basic_yearly: plan("personal_basic_yearly", "personal", "basic", "year", 900, "flat_user", PERSONAL_BASIC),
  personal_pro_monthly: plan("personal_pro_monthly", "personal", "pro", "month", 500, "flat_user", PERSONAL_PRO),
  personal_pro_yearly: plan("personal_pro_yearly", "personal", "pro", "year", 4900, "flat_user", PERSONAL_PRO),
  workspace_free: plan("workspace_free", "workspace", "free", null, 0, "free", WORKSPACE_FREE),
  workspace_team_monthly: plan("workspace_team_monthly", "workspace", "team", "month", 500, "per_seat", WORKSPACE_TEAM),
  workspace_team_yearly: plan("workspace_team_yearly", "workspace", "team", "year", 4900, "per_seat", WORKSPACE_TEAM),
  workspace_business_monthly: plan("workspace_business_monthly", "workspace", "business", "month", 1000, "per_seat", WORKSPACE_BUSINESS),
  workspace_business_yearly: plan("workspace_business_yearly", "workspace", "business", "year", 9900, "per_seat", WORKSPACE_BUSINESS),
};

/** The catalog id for a stored personal tier and interval (a paid plan without an interval is monthly). */
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

// ---------------------------------------------------------------------------------------------------
// How plans are shown (settings, pricing page, admin). Prices and limits come from the catalog above.
// ---------------------------------------------------------------------------------------------------

/** Where Folevi runs today (the Mac app isn't out yet and there's no iOS app). */
export const AVAILABILITY = "On the web · Mac app coming soon";

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
  ai: boolean;
  blurb: string;
  features: string[];
}

const personalCard = (tier: PersonalTier, name: string, blurb: string, features: string[]): PersonalPlanCard => {
  const monthly = personalPlanId(tier, "month");
  const yearly = personalPlanId(tier, "year");
  const e = PLAN_CATALOG[monthly].entitlements;
  return {
    tier,
    name,
    monthly,
    yearly,
    monthlyCents: PLAN_CATALOG[monthly].priceCents,
    yearlyCents: tier === "free" ? 0 : PLAN_CATALOG[yearly].priceCents,
    storageBytes: e.storageBytes,
    devices: e.devices,
    ai: e.aiAssistant,
    blurb,
    features,
  };
};

/** The three Personal plans, as cards. */
export const PLANS: Record<PersonalTier, PersonalPlanCard> = {
  free: personalCard("free", "Free", "Everything you need to write and organize.", ["1 GB personal storage", "Use on 2 devices", AVAILABILITY, "Unlimited notes, folders and tasks", "Share and collaborate"]),
  basic: personalCard("basic", "Basic", "More room for your files, images and attachments.", ["20 GB personal storage", "Unlimited devices", AVAILABILITY, "Everything in Free"]),
  pro: personalCard("pro", "Pro", "Powerful AI for your notes and ideas.", ["Unlimited AI Assistant", "100 GB personal storage", "Unlimited devices", AVAILABILITY, "Everything in Basic"]),
};
export const PLAN_ORDER: PersonalTier[] = ["free", "basic", "pro"];

export interface WorkspacePlanCard {
  tier: WorkspaceTier;
  name: string;
  monthlyCents: number;
  yearlyCents: number;
  perSeat: boolean;
  blurb: string;
  features: string[];
  /** Whether it can be bought yet (workspace billing isn't live). */
  available: boolean;
}

const workspaceCard = (tier: WorkspaceTier, name: string, blurb: string, features: string[], available: boolean): WorkspacePlanCard => ({
  tier,
  name,
  monthlyCents: PLAN_CATALOG[workspacePlanId(tier, "month")].priceCents,
  yearlyCents: tier === "free" ? 0 : PLAN_CATALOG[workspacePlanId(tier, "year")].priceCents,
  perSeat: PLAN_CATALOG[workspacePlanId(tier, "month")].billingModel === "per_seat",
  blurb,
  features,
  available,
});

/** The three Workspace plans, as cards. Only what exists is listed. */
export const WORKSPACE_PLANS: Record<WorkspaceTier, WorkspacePlanCard> = {
  free: workspaceCard("free", "Free", "For simple collaboration.", ["5 GB workspace storage", "Invite your team", "Shared notes, folders and tasks"], true),
  team: workspaceCard("team", "Team", "For growing teams.", ["100 GB workspace storage", "AI Assistant for every member", "Everything in Free"], false),
  business: workspaceCard("business", "Business", "For organizations that need more room and AI.", ["1 TB workspace storage", "AI Assistant with higher fair-use limits", "Everything in Team"], false),
};
export const WORKSPACE_PLAN_ORDER: WorkspaceTier[] = ["free", "team", "business"];

/** A plan's display name ("Pro", "Workspace Free"…). */
export function planName(id: CatalogPlanId): string {
  const p = PLAN_CATALOG[id];
  return p.scope === "personal" ? PLANS[p.tier as PersonalTier].name : `Workspace ${WORKSPACE_PLANS[p.tier as WorkspaceTier].name}`;
}

/** New accounts get Pro free for this long. */
export const TRIAL_DAYS = 7;
export const DAY_MS = 86_400_000;

export const formatPrice = (cents: number) => (cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`);
/** A yearly price per month, rounded down to the cent ("$0.75", "$4.08"). */
export const monthlyEquivalent = (yearlyCents: number) => formatPrice(Math.floor(yearlyCents / 12));
/** Monthly equivalent of a price, for MRR. */
export const monthlyValueCents = (id: CatalogPlanId) => {
  const p = PLAN_CATALOG[id];
  return p.interval === "year" ? Math.round(p.priceCents / 12) : p.priceCents;
};

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
  aiGrantUntil?: number | null;
  aiGrant?: boolean;
  storageOverrideBytes?: number;
  /** An admin-set device limit that replaces the plan's. */
  deviceLimitOverride?: number | "unlimited";
}

/** What a person's own (Personal) plan gives them. */
export interface PersonalEntitlements {
  scope: "personal";
  /** The plan in effect right now (a trial counts as Pro monthly). */
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
  ai: boolean;
  aiSource: "plan" | "trial" | "grant" | null;
  aiFairUse: "standard" | "high" | null;
  storageBytes: number;
  /** Devices that can use the account at once; null = unlimited. */
  devices: number | null;
}

/** What someone's Personal plan gives right now. No record (older accounts before billing) = Free. */
export function personalEntitlementsOf(sub: SubscriptionLike | null, now: number): PersonalEntitlements {
  // A paid (or admin-set) plan counts while it's active or in its grace period; a period end in the past
  // (a manual plan that ran out, a lapsed subscription) falls back to Free.
  const storedId = sub ? personalPlanId(sub.plan, sub.interval) : "personal_free";
  const paidActive = sub && isPaidPlan(storedId) && sub.status !== "canceled" && (sub.currentPeriodEnd === undefined || sub.currentPeriodEnd > now);
  const canceledButPaidThrough = sub && isPaidPlan(storedId) && sub.status === "canceled" && sub.currentPeriodEnd !== undefined && sub.currentPeriodEnd > now;
  const paidPlanId: PersonalPlanId = paidActive || canceledButPaidThrough ? storedId : "personal_free";
  const paidPlan = PLAN_CATALOG[paidPlanId];
  // The trial gives Pro to anyone whose own plan doesn't already include AI.
  const trialing = Boolean(sub?.trialEndsAt && sub.trialEndsAt > now && !paidPlan.entitlements.aiAssistant);
  const planId: PersonalPlanId = trialing ? "personal_pro_monthly" : paidPlanId;
  const e = PLAN_CATALOG[planId].entitlements;
  const grant = Boolean(sub?.aiGrant && (sub.aiGrantUntil === undefined || sub.aiGrantUntil === null || sub.aiGrantUntil > now));
  const ai = e.aiAssistant || grant;
  return {
    scope: "personal",
    planId,
    paidPlanId,
    plan: PLAN_CATALOG[planId].tier as PersonalTier,
    paidPlan: paidPlan.tier as PersonalTier,
    paid: isPaidPlan(paidPlanId),
    trialing,
    trialEndsAt: sub?.trialEndsAt ?? null,
    ai,
    aiSource: paidPlan.entitlements.aiAssistant ? "plan" : grant ? "grant" : trialing ? "trial" : null,
    aiFairUse: e.aiFairUse ?? (ai ? "standard" : null),
    storageBytes: sub?.storageOverrideBytes ?? e.storageBytes,
    devices: sub?.deviceLimitOverride === "unlimited" ? null : (sub?.deviceLimitOverride ?? e.devices),
  };
}

// ---------------------------------------------------------------------------------------------------
// Workspace entitlements
// ---------------------------------------------------------------------------------------------------

/**
 * A workspace's subscription (none exist yet: workspace billing arrives with per-seat checkout). Until
 * then every team workspace resolves to Workspace Free.
 */
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
  ai: boolean;
  aiFairUse: "standard" | "high" | null;
  storageBytes: number;
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
  const planId: WorkspacePlanId = inForce ? storedId : "workspace_free";
  const e = PLAN_CATALOG[planId].entitlements;
  return {
    scope: "workspace",
    planId,
    paidPlanId: planId,
    paid: isPaidPlan(planId),
    ai: e.aiAssistant,
    aiFairUse: e.aiFairUse,
    storageBytes: overrides.storageBytes ?? e.storageBytes,
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
