// AI credits: the real limit on AI use (docs/BILLING.md). 1 credit = $0.01 of what Gemini charges Folevi,
// so no plan can cost more in AI than it earns.
//
// Accounts: credits belong to one person in one place.
//   Personal account (workspaceId unset): the person's Personal plan. Used in their Personal, in free
//     workspaces, and as a guest anywhere (a guest's AI comes from their own personal plan).
//   Seat account (workspaceId set): a member's seat in a paid workspace (Pro, Pro AI), with that plan's
//     monthly credits for that workspace only.
// Core has no AI: every request in a Core Personal or a Core workspace is refused, for everyone there (and
// a person on Core Personal has no credits to use in free workspaces or as a guest).
//
// Monthly credits reset each period: the billing period's months for paid plans (anchored on the period's
// start), the calendar month (UTC) on Free, and the whole trial for the trial (TRIAL_CREDITS). Bought and
// granted credits (aiCreditPacks) last 12 months and are used oldest-expiring first, after the monthly ones.
//
// Metering: every Gemini call is priced from its usage metadata (prompt, answer and thinking tokens) at the
// rates below, and a request costs ceil(total / $0.01) credits, at least 1. Before a request, a
// conservative estimate is held (aiCreditHolds) so parallel requests can't spend the same credits; the
// real cost replaces the hold when the request settles. If the real cost is more than what's left, the
// balance goes to zero and the difference is recorded (`overrun`), never charged later.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fail } from "./errors";
import { personalEntitlements, workspaceEntitlements } from "./entitlements";
import { subscriptionOf, workspaceSubscriptionOf } from "./billing";
import { DAY_MS, PACK_VALID_MONTHS, PLAN_CATALOG, TIER_NAMES, TRIAL_DAYS, addMonthsUtc, monthStartUtc, planName, type PlanTier } from "./plans";
import type { RateRuleName } from "./rateLimit";
import type { Scope } from "./scope";
import { priceOf, SEARCH_GROUNDING_NANO_PER_QUERY } from "./ai/capabilities";
import { recordFeatureUse, type AiFeature } from "./ai/usage";

type Ctx = QueryCtx | MutationCtx;

// ---------------------------------------------------------------------------------------------------
// Prices: they live with the model registry (lib/ai/capabilities.ts), re-exported here
// ---------------------------------------------------------------------------------------------------

export { GEMINI_PRICES, priceOf } from "./ai/capabilities";
/** One credit, in nano-dollars ($0.01). */
export const CREDIT_NANO_USD = 10_000_000;

/** Token counts from one Gemini call (its usageMetadata), or an estimate when none came back. */
export interface CallUsage {
  model: string;
  promptTokens: number;
  /** Answer tokens (candidatesTokenCount). */
  outputTokens: number;
  /** Thinking tokens (thoughtsTokenCount), billed as output. */
  thoughtsTokens: number;
  /** Google Search queries a grounded call ran (web research), each billed on top of the tokens. */
  searches?: number;
}

/** The cost of some calls, in nano-dollars (integers, so rounding is exact). */
export function costNano(calls: CallUsage[]): number {
  let total = 0;
  for (const c of calls) {
    const p = priceOf(c.model);
    total += Math.max(0, Math.round(c.promptTokens)) * p.inputNanoPerToken + (Math.max(0, Math.round(c.outputTokens)) + Math.max(0, Math.round(c.thoughtsTokens))) * p.outputNanoPerToken;
    total += Math.max(0, Math.round(c.searches ?? 0)) * SEARCH_GROUNDING_NANO_PER_QUERY;
  }
  return total;
}

/** Credits for a request's calls: ceil(cost / $0.01), at least 1 when anything was sent. */
export function creditsFor(calls: CallUsage[]): number {
  if (!calls.length) return 0;
  return Math.max(1, Math.ceil(costNano(calls) / CREDIT_NANO_USD));
}

/** Rough tokens in some text (Gemini averages about 4 characters per token in English; this rounds up). */
export const tokensForChars = (chars: number) => Math.ceil(Math.max(0, chars) / 4);

/** A planned call, for the estimate held before a request runs. */
export interface PlannedCall {
  fast: boolean;
  inputChars: number;
  maxOutputTokens: number;
  /** Google Search queries a grounded call may run (web research). */
  searches?: number;
}

/**
 * A conservative estimate of a request's credits: every planned call at its full input and its maximum
 * output (thinking included in the output budget) on the model it would use.
 */
export function estimateCredits(calls: PlannedCall[], models: { main: string; fast: string }): number {
  return creditsFor(calls.map((c) => ({ model: c.fast ? models.fast : models.main, promptTokens: tokensForChars(c.inputChars), outputTokens: c.maxOutputTokens, thoughtsTokens: 0, searches: c.searches ?? 0 })));
}

// ---------------------------------------------------------------------------------------------------
// Accounts and periods
// ---------------------------------------------------------------------------------------------------

export interface CreditPeriod {
  key: string;
  start: number;
  end: number;
}

export interface CreditAccount {
  profileId: Id<"profiles">;
  /** Set for a member's seat in a paid workspace. */
  workspaceId?: Id<"workspaces">;
  kind: "personal" | "seat";
  tier: PlanTier;
  /** What to call the plan the credits come from ("Pro", "Workspace Pro AI"). */
  planLabel: string;
  trialing: boolean;
  /** Monthly (or trial) credits for the current period. */
  allowance: number;
  period: CreditPeriod;
  /** Whether credit packs can be bought for this account (Pro and Pro AI). */
  canBuy: boolean;
  rateRule: RateRuleName;
  rateSubject: string;
}

/** The monthly window, counted from `anchor`, that contains `now`. */
export function monthlyWindow(anchor: number, now: number): { start: number; end: number } {
  if (anchor > now) {
    const start = monthStartUtc(now);
    return { start, end: addMonthsUtc(start, 1) };
  }
  const a = new Date(anchor);
  const n = new Date(now);
  let k = (n.getUTCFullYear() - a.getUTCFullYear()) * 12 + (n.getUTCMonth() - a.getUTCMonth());
  while (k > 0 && addMonthsUtc(anchor, k) > now) k--;
  while (addMonthsUtc(anchor, k + 1) <= now) k++;
  return { start: addMonthsUtc(anchor, k), end: addMonthsUtc(anchor, k + 1) };
}

const periodFrom = (w: { start: number; end: number }): CreditPeriod => ({ key: String(w.start), ...w });

/** A person's Personal credit account (no checks on whether AI is included: see aiAccountFor). */
export async function personalAccount(ctx: Ctx, profileId: Id<"profiles">, now = Date.now()): Promise<CreditAccount> {
  const e = await personalEntitlements(ctx, profileId, now);
  const sub = await subscriptionOf(ctx, profileId);
  let period: CreditPeriod;
  if (e.trialing && e.trialEndsAt) {
    // One allowance for the whole trial, however long it runs (an extension adds days, not credits).
    period = { key: "trial", start: e.trialEndsAt - TRIAL_DAYS * DAY_MS, end: e.trialEndsAt };
  } else if (e.paid && sub) {
    period = periodFrom(monthlyWindow(sub.currentPeriodStart ?? sub.paidSince ?? monthStartUtc(now), now));
  } else {
    const start = monthStartUtc(now);
    period = { key: String(start), start, end: addMonthsUtc(start, 1) };
  }
  return {
    profileId,
    kind: "personal",
    tier: e.plan,
    planLabel: e.trialing ? "Pro AI trial" : TIER_NAMES[e.plan],
    trialing: e.trialing,
    allowance: e.ai ? e.monthlyCredits : 0,
    period,
    canBuy: e.creditPacks && !e.trialing,
    rateRule: e.aiFairUse === "high" ? "aiHigh" : "ai",
    rateSubject: profileId as string,
  };
}

/** A member's seat account in a paid workspace (null when the workspace isn't on a paid plan with AI). */
export async function seatAccount(ctx: Ctx, profileId: Id<"profiles">, workspaceId: Id<"workspaces">, now = Date.now()): Promise<CreditAccount | null> {
  const e = await workspaceEntitlements(ctx, workspaceId, now);
  if (!e.paid || !e.ai) return null;
  const sub = await workspaceSubscriptionOf(ctx, workspaceId);
  return {
    profileId,
    workspaceId,
    kind: "seat",
    tier: PLAN_CATALOG[e.planId].tier,
    planLabel: planName(e.planId),
    trialing: false,
    allowance: e.monthlyCredits,
    period: periodFrom(monthlyWindow(sub?.currentPeriodStart ?? sub?.paidSince ?? monthStartUtc(now), now)),
    canBuy: e.creditPacks,
    rateRule: e.aiFairUse === "high" ? "aiHigh" : "ai",
    // Budgets are per person per workspace, so AI in one place never uses up another's.
    rateSubject: `${profileId}:${workspaceId}`,
  };
}

/** The account a stored key names (a hold, a pack), as it is now. */
export async function accountByKey(ctx: Ctx, profileId: Id<"profiles">, workspaceId: Id<"workspaces"> | undefined, now = Date.now()): Promise<CreditAccount> {
  if (workspaceId) {
    const seat = await seatAccount(ctx, profileId, workspaceId, now);
    // The workspace dropped its paid plan: its seat has no monthly credits (bought ones wait for it).
    if (seat) return seat;
    const base = await personalAccount(ctx, profileId, now);
    return { ...base, workspaceId, kind: "seat", allowance: 0, canBuy: false, planLabel: "Workspace Free", rateSubject: `${profileId}:${workspaceId}` };
  }
  return await personalAccount(ctx, profileId, now);
}

const isMember = async (ctx: Ctx, profileId: Id<"profiles">, workspaceId: Id<"workspaces">) =>
  (await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace_profile", (q) => q.eq("workspaceId", workspaceId).eq("profileId", profileId))
    .unique()) !== null;

export const CORE_PERSONAL = "AI isn't part of Core. Your notes stay yours: nothing is sent to an AI model. To use AI, switch to Pro or Pro AI in Settings → Plan & billing.";
export const CORE_WORKSPACE = "This workspace is on Core, which doesn't include AI. Nothing here is sent to an AI model.";
export const CORE_SHARED_PERSONAL = "This page's owner is on Core, which doesn't include AI. Nothing here is sent to an AI model.";

/**
 * Whether content in `scope` may be sent to AI at all: never from a Core Personal or a Core workspace.
 * Returns the reason when not.
 */
export async function aiBlockedIn(ctx: Ctx, profileId: Id<"profiles">, scope: Scope, now = Date.now()): Promise<string | null> {
  if (scope.kind === "workspace") return (await workspaceEntitlements(ctx, scope.workspaceId, now)).ai ? null : CORE_WORKSPACE;
  if ((await personalEntitlements(ctx, scope.profileId, now)).ai) return null;
  return scope.profileId === profileId ? CORE_PERSONAL : CORE_SHARED_PERSONAL;
}

export interface AiAccess {
  allowed: boolean;
  /** Why not, in words for the person (Core). Running out of credits is checked when holding. */
  message: string | null;
  account: CreditAccount;
}

/**
 * Whose credits a request made in `scope` uses, and whether AI is allowed there at all:
 *   a Core scope: refused for everyone;
 *   a paid workspace: a member's seat credits; a guest's own personal credits;
 *   a free workspace, someone else's Personal (a shared page), or their own Personal: personal credits,
 *     refused when their own personal plan is Core.
 */
export async function aiAccountFor(ctx: Ctx, profile: Doc<"profiles">, scope: Scope, now = Date.now()): Promise<AiAccess> {
  const blocked = await aiBlockedIn(ctx, profile._id, scope, now);
  let account: CreditAccount | null = null;
  if (scope.kind === "workspace" && (await isMember(ctx, profile._id, scope.workspaceId))) account = await seatAccount(ctx, profile._id, scope.workspaceId, now);
  account ??= await personalAccount(ctx, profile._id, now);
  if (blocked) return { allowed: false, message: blocked, account };
  if (account.kind === "personal" && !(await personalEntitlements(ctx, profile._id, now)).ai) {
    return { allowed: false, message: scope.kind === "personal" ? CORE_PERSONAL : "Your personal plan is Core, which doesn't include AI, and AI here uses your personal credits. Switch to Pro or Pro AI in Settings → Plan & billing to use it.", account };
  }
  return { allowed: true, message: null, account };
}

// ---------------------------------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------------------------------

export interface CreditBalance {
  /** Monthly (or trial) credits for this period, used and left. */
  allowance: number;
  used: number;
  monthlyLeft: number;
  /** Bought and granted credits still valid. */
  packCredits: number;
  /** Credits set aside for requests running right now. */
  held: number;
  /** What a new request can use. */
  available: number;
  /** When the monthly credits reset (the trial: when it ends). */
  resetsAt: number;
  periodStart: number;
  /** The soonest expiry among bought credits, if any. */
  nextPackExpiry: number | null;
}

/** An account's row for a period (credits used, and use by feature and day). */
export const periodRow = (ctx: Ctx, a: Pick<CreditAccount, "profileId" | "workspaceId">, key: string) =>
  ctx.db
    .query("aiCreditPeriods")
    .withIndex("by_account_period", (q) => q.eq("profileId", a.profileId).eq("workspaceId", a.workspaceId).eq("periodKey", key))
    .unique();

async function activePacks(ctx: Ctx, a: Pick<CreditAccount, "profileId" | "workspaceId">, now: number): Promise<Doc<"aiCreditPacks">[]> {
  const rows = await ctx.db
    .query("aiCreditPacks")
    .withIndex("by_account_expires", (q) => q.eq("profileId", a.profileId).eq("workspaceId", a.workspaceId).gt("expiresAt", now))
    .collect();
  return rows.filter((p) => p.status === "active" && p.remaining > 0);
}

export async function creditBalance(ctx: Ctx, account: CreditAccount, now = Date.now()): Promise<CreditBalance> {
  const row = await periodRow(ctx, account, account.period.key);
  const used = Math.min(row?.used ?? 0, account.allowance);
  const monthlyLeft = Math.max(0, account.allowance - used);
  const packs = await activePacks(ctx, account, now);
  const packCredits = packs.reduce((n, p) => n + p.remaining, 0);
  const holds = await ctx.db
    .query("aiCreditHolds")
    .withIndex("by_account", (q) => q.eq("profileId", account.profileId).eq("workspaceId", account.workspaceId))
    .collect();
  const held = holds.filter((h) => h.expiresAt > now).reduce((n, h) => n + h.credits, 0);
  return {
    allowance: account.allowance,
    used,
    monthlyLeft,
    packCredits,
    held,
    available: Math.max(0, monthlyLeft + packCredits - held),
    resetsAt: account.period.end,
    periodStart: account.period.start,
    nextPackExpiry: packs.length ? Math.min(...packs.map((p) => p.expiresAt)) : null,
  };
}

/** "October 1" (UTC), for messages. */
export const dayLabel = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric", year: new Date(t).getUTCFullYear() !== new Date().getUTCFullYear() ? "numeric" : undefined, timeZone: "UTC" });

/** The refusal when a request needs more credits than are left. */
export function outOfCreditsMessage(account: CreditAccount, balance: CreditBalance, needed: number): string {
  const where = account.kind === "seat" ? " in this workspace" : "";
  const when = account.trialing ? `Your trial ends on ${dayLabel(balance.resetsAt)}; then you get the Free plan's monthly credits.` : `They reset on ${dayLabel(balance.resetsAt)}.`;
  const next = account.canBuy ? "Buy more in Settings → Plan & billing." : account.kind === "seat" ? "" : "Upgrade for more in Settings → Plan & billing.";
  const head =
    balance.available <= 0
      ? account.trialing
        ? `You've used the AI credits in your trial${where}.`
        : `You've used this month's AI credits${where}.`
      : `This needs about ${needed} AI credits and you have ${balance.available} left${where}.`;
  return [head, when, next].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------------------------------
// Holding, settling and granting
// ---------------------------------------------------------------------------------------------------

/** How long a hold counts (longer than any AI request can run). */
export const HOLD_MS = 10 * 60_000;

/**
 * Sets aside `estimate` credits for a request in `scope`, or refuses with `out_of_credits` (and when the
 * monthly credits reset, and whether buying or upgrading helps). `feature` is what the credits are spent
 * on, for the usage card (lib/ai/usage.ts).
 */
export async function holdCredits(ctx: MutationCtx, account: CreditAccount, scope: Scope, estimate: number, now = Date.now(), feature?: AiFeature): Promise<Id<"aiCreditHolds">> {
  const balance = await creditBalance(ctx, account, now);
  const needed = Math.max(1, estimate);
  if (balance.available < needed) {
    fail("out_of_credits", outOfCreditsMessage(account, balance, needed), {
      resetsAt: balance.resetsAt,
      available: balance.available,
      needed,
      action: account.canBuy ? "buy" : account.kind === "seat" ? "none" : "upgrade",
    });
  }
  return await ctx.db.insert("aiCreditHolds", {
    profileId: account.profileId,
    workspaceId: account.workspaceId,
    scope: scope.kind,
    scopeWorkspaceId: scope.kind === "workspace" ? scope.workspaceId : undefined,
    credits: needed,
    ...(feature ? { feature } : {}),
    createdAt: now,
    expiresAt: now + HOLD_MS,
  });
}

/** Takes `credits` from an account: monthly credits first, then packs oldest-expiring first. */
export async function deductCredits(ctx: MutationCtx, account: CreditAccount, credits: number, now = Date.now()): Promise<{ fromMonthly: number; fromPacks: number; overrun: number }> {
  let left = Math.max(0, Math.round(credits));
  const row = await periodRow(ctx, account, account.period.key);
  const used = row?.used ?? 0;
  const fromMonthly = Math.min(left, Math.max(0, account.allowance - used));
  left -= fromMonthly;
  let fromPacks = 0;
  if (left > 0) {
    const packs = (await activePacks(ctx, account, now)).sort((a, b) => a.expiresAt - b.expiresAt || a.purchasedAt - b.purchasedAt);
    for (const p of packs) {
      if (left <= 0) break;
      const take = Math.min(left, p.remaining);
      await ctx.db.patch(p._id, { remaining: p.remaining - take });
      left -= take;
      fromPacks += take;
    }
  }
  const overrun = left;
  if (row) await ctx.db.patch(row._id, { used: used + fromMonthly, ...(overrun ? { overrun: (row.overrun ?? 0) + overrun } : {}), updatedAt: now });
  else await ctx.db.insert("aiCreditPeriods", { profileId: account.profileId, workspaceId: account.workspaceId, periodKey: account.period.key, periodStart: account.period.start, periodEnd: account.period.end, used: fromMonthly, ...(overrun ? { overrun } : {}), updatedAt: now });
  if (overrun) console.warn(JSON.stringify({ event: "ai.credit_overrun", credits: overrun }));
  return { fromMonthly, fromPacks, overrun };
}

/** Counts a request against the scope it was made in (per person per day; no content). */
export async function recordAiUsage(ctx: MutationCtx, profileId: Id<"profiles">, scope: { kind: "personal" | "workspace"; workspaceId?: Id<"workspaces"> }, usage: { credits: number; tokensIn: number; tokensOut: number }, now = Date.now()): Promise<void> {
  const day = new Date(now).toISOString().slice(0, 10);
  const workspaceId = scope.kind === "workspace" ? scope.workspaceId : undefined;
  const rows = await ctx.db
    .query("aiUsage")
    .withIndex("by_profile_day", (q) => q.eq("profileId", profileId).eq("day", day))
    .collect();
  const row = rows.find((r) => r.scope === scope.kind && r.workspaceId === workspaceId);
  if (row) {
    await ctx.db.patch(row._id, { count: row.count + 1, credits: (row.credits ?? 0) + usage.credits, tokensIn: (row.tokensIn ?? 0) + usage.tokensIn, tokensOut: (row.tokensOut ?? 0) + usage.tokensOut });
  } else {
    await ctx.db.insert("aiUsage", { profileId, day, count: 1, scope: scope.kind, workspaceId, credits: usage.credits, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut });
  }
}

/**
 * Ends a request: releases its hold and charges what its calls really cost (nothing when no call was
 * made), counted under the hold's feature for the usage card. Idempotent: a hold is settled once.
 */
export async function settleHold(ctx: MutationCtx, holdId: Id<"aiCreditHolds">, calls: CallUsage[], now = Date.now()): Promise<{ credits: number; overrun: number } | null> {
  const hold = await ctx.db.get(holdId);
  if (!hold) return null;
  await ctx.db.delete(hold._id);
  const credits = creditsFor(calls);
  if (!credits) return { credits: 0, overrun: 0 };
  const account = await accountByKey(ctx, hold.profileId, hold.workspaceId, now);
  const { overrun } = await deductCredits(ctx, account, credits, now);
  const period = await periodRow(ctx, account, account.period.key);
  if (period) await recordFeatureUse(ctx, period, hold.feature ?? "other", credits, now);
  const tokensIn = calls.reduce((n, c) => n + c.promptTokens, 0);
  const tokensOut = calls.reduce((n, c) => n + c.outputTokens + c.thoughtsTokens, 0);
  await recordAiUsage(ctx, hold.profileId, { kind: hold.scope, workspaceId: hold.scopeWorkspaceId }, { credits, tokensIn, tokensOut }, now);
  return { credits, overrun };
}

/**
 * Adds credits to an account: a bought pack (idempotent by `orderId`), a test purchase, or an admin grant.
 * They last PACK_VALID_MONTHS unless `expiresAt` says otherwise.
 */
export async function addCredits(
  ctx: MutationCtx,
  account: { profileId: Id<"profiles">; workspaceId?: Id<"workspaces"> },
  credits: number,
  source: Doc<"aiCreditPacks">["source"],
  opts: { orderId?: string; paymentId?: Id<"payments">; expiresAt?: number; now?: number } = {},
): Promise<Id<"aiCreditPacks">> {
  const now = opts.now ?? Date.now();
  if (opts.orderId) {
    const orderId = opts.orderId;
    const existing = await ctx.db
      .query("aiCreditPacks")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .unique();
    if (existing) return existing._id;
  }
  return await ctx.db.insert("aiCreditPacks", {
    profileId: account.profileId,
    workspaceId: account.workspaceId,
    credits,
    remaining: credits,
    source,
    status: "active",
    purchasedAt: now,
    expiresAt: opts.expiresAt ?? addMonthsUtc(now, PACK_VALID_MONTHS),
    orderId: opts.orderId,
    paymentId: opts.paymentId,
  });
}

/**
 * A refund of a pack's order: the unused credits it paid for are removed (all of them for a full refund; a
 * partial refund removes the refunded share, up to what's unused). Credits already used stay used.
 */
export async function refundPackCredits(ctx: MutationCtx, orderId: string, refundedShare: number): Promise<number> {
  const pack = await ctx.db
    .query("aiCreditPacks")
    .withIndex("by_order", (q) => q.eq("orderId", orderId))
    .unique();
  if (!pack) return 0;
  const full = refundedShare >= 1;
  // `refundedShare` is cumulative (Polar reports the order's total refunded so far), so only the part not
  // already taken back by an earlier refund is removed now.
  const target = full ? pack.credits : Math.min(pack.credits, Math.ceil(pack.credits * Math.max(0, refundedShare)));
  const already = pack.refundedCredits ?? 0;
  const due = Math.max(0, target - already);
  const remove = Math.min(pack.remaining, due);
  await ctx.db.patch(pack._id, { remaining: pack.remaining - remove, refundedCredits: already + due, ...(full ? { status: "refunded" as const } : {}) });
  return remove;
}

/** Hourly: drops holds long past their expiry (a crashed request); expired ones already stopped counting. */
export async function sweepHolds(ctx: MutationCtx, now = Date.now()): Promise<number> {
  const old = await ctx.db
    .query("aiCreditHolds")
    .withIndex("by_expires", (q) => q.lt("expiresAt", now - 60 * 60_000))
    .take(500);
  for (const h of old) await ctx.db.delete(h._id);
  return old.length;
}

/** A credit summary for the app (the meter in AI panels and settings). */
export async function creditSummary(ctx: Ctx, profile: Doc<"profiles">, scope: Scope, now = Date.now()) {
  const access = await aiAccountFor(ctx, profile, scope, now);
  const balance = await creditBalance(ctx, access.account, now);
  const a = access.account;
  return {
    /** Whether AI can be used here at all (false in Core scopes, or with a Core personal plan where personal credits apply). */
    aiIncluded: access.allowed,
    blockedReason: access.message,
    account: a.kind,
    plan: a.planLabel,
    tier: a.tier,
    trialing: a.trialing,
    canBuy: a.canBuy,
    ...balance,
    /** Share of this period's monthly credits left (0 to 1); 1 when the plan has none. */
    monthlyShareLeft: balance.allowance ? balance.monthlyLeft / balance.allowance : 1,
  };
}
