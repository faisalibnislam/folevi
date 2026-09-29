// Admin analytics: aggregates only (counts, sums, series) — no note content, and no personal details
// beyond the recent-payments list admins need to follow up on. Computed on read from the source tables,
// which is fine at Folevi's size; move to rollups (like metricsDaily) if these tables grow large.
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requirePlatformRole, type PlatformRole } from "./lib/auth";
import { redactEmail } from "./lib/crypto";
import { DAY_MS, PLANS, billedQuantity, monthlyValueCents, personalEntitlementsOf, seatChargeCents, workspaceEntitlementsOf, type PersonalTier } from "./lib/plans";
import { isPersonalPayment, isPersonalSubscription, isWorkspaceSubscription } from "./lib/billing";
import { workspaceSubscriptionLike } from "./lib/entitlements";

const STAFF: PlatformRole[] = ["super_admin", "ops_admin", "support_admin"];
const ADMIN: PlatformRole[] = ["super_admin", "ops_admin"];

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const monthOf = (t: number) => new Date(t).toISOString().slice(0, 7);
function lastDays(n: number, now: number): string[] {
  return Array.from({ length: n }, (_, i) => dayOf(now - (n - 1 - i) * DAY_MS));
}
function lastMonths(n: number, now: number): string[] {
  const d = new Date(now);
  return Array.from({ length: n }, (_, i) => {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (n - 1 - i), 1));
    return m.toISOString().slice(0, 7);
  });
}

/** People: growth, activity, Personal plans, trials and AI use (Personal and workspaces). */
export const users = query({
  args: { days: v.number() },
  handler: async (ctx, args) => {
    await requirePlatformRole(ctx, STAFF);
    const now = Date.now();
    const days = Math.min(Math.max(Math.round(args.days), 7), 180);
    const since = now - days * DAY_MS;
    const profiles = (await ctx.db.query("profiles").collect()).filter((p) => p.status !== "deleted");
    // Personal plans only (workspace plans are counted in `revenue`).
    const subs = (await ctx.db.query("subscriptions").collect()).filter(isPersonalSubscription);
    const subByProfile = new Map(subs.map((s) => [s.profileId as string, s]));

    const signupsByDay = new Map(lastDays(days, now).map((d) => [d, 0]));
    for (const p of profiles) if (p.createdAt >= since) signupsByDay.set(dayOf(p.createdAt), (signupsByDay.get(dayOf(p.createdAt)) ?? 0) + 1);

    const active = (ms: number) => profiles.filter((p) => p.lastActiveAt >= now - ms).length;
    const planCounts: Record<PersonalTier, number> = { free: 0, basic: 0, pro: 0 };
    let trialing = 0;
    let trialsEndingSoon = 0;
    let aiGrants = 0;
    for (const p of profiles) {
      const sub = subByProfile.get(p._id) ?? null;
      const e = personalEntitlementsOf(sub, now);
      planCounts[e.paidPlan]++;
      if (e.trialing) {
        trialing++;
        if ((e.trialEndsAt ?? 0) - now < 3 * DAY_MS) trialsEndingSoon++;
      }
      if (e.aiSource === "grant") aiGrants++;
    }
    // Trial conversion: accounts whose trial has ended (within the window) that are now on a paid plan.
    const endedTrials = subs.filter((s) => s.trialEndsAt && s.trialEndsAt < now && s.trialEndsAt >= since);
    const converted = endedTrials.filter((s) => personalEntitlementsOf(s, now).paid).length;

    const usage = await ctx.db
      .query("aiUsage")
      .withIndex("by_day", (q) => q.gte("day", dayOf(since)))
      .collect();
    const aiByDay = new Map(lastDays(days, now).map((d) => [d, 0]));
    const aiUsers = new Set<string>();
    const aiByScope = { personal: 0, workspace: 0 };
    for (const u of usage) {
      aiByDay.set(u.day, (aiByDay.get(u.day) ?? 0) + u.count);
      aiUsers.add(u.profileId);
      // Rows from before scopes were recorded were all Personal.
      aiByScope[u.scope ?? "personal"] += u.count;
    }
    // Team workspaces plus every Personal (each counts on its own; nothing is double counted).
    const workspaces = await ctx.db.query("workspaces").collect();
    const storageBytes = workspaces.reduce((n, w) => n + w.storageUsedBytes, 0) + profiles.reduce((n, p) => n + (p.personalStorageUsedBytes ?? 0), 0);

    return {
      totals: { users: profiles.length, verified: profiles.filter((p) => p.emailVerified).length, suspended: profiles.filter((p) => p.status === "suspended").length },
      active: { day: active(DAY_MS), week: active(7 * DAY_MS), month: active(30 * DAY_MS) },
      signupsByDay: [...signupsByDay].map(([day, count]) => ({ day, count })),
      signupsInWindow: profiles.filter((p) => p.createdAt >= since).length,
      plans: planCounts,
      trialing,
      trialsEndingSoon,
      aiGrants,
      trialConversion: { ended: endedTrials.length, converted, rate: endedTrials.length ? converted / endedTrials.length : null },
      ai: { requests: usage.reduce((n, u) => n + u.count, 0), users: aiUsers.size, byScope: aiByScope, byDay: [...aiByDay].map(([day, count]) => ({ day, count })) },
      storage: { totalBytes: storageBytes, perUserBytes: profiles.length ? Math.round(storageBytes / profiles.length) : 0 },
    };
  },
});

/** Money (Personal plans): recurring revenue, subscribers, monthly revenue, new vs churned, failures and refunds. */
export const revenue = query({
  args: { months: v.number(), includeTest: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requirePlatformRole(ctx, ADMIN);
    const now = Date.now();
    const months = Math.min(Math.max(Math.round(args.months), 3), 24);
    const counts = (p: Doc<"payments"> | Doc<"subscriptions">) => args.includeTest || p.provider !== "test";
    const allSubs = (await ctx.db.query("subscriptions").collect()).filter(counts);
    const subs = allSubs.filter(isPersonalSubscription);

    // Workspace plans: paying workspaces, their seats and recurring revenue (per seat × seats).
    const workspaceTotals = { paying: 0, seats: 0, mrrCents: 0 };
    for (const s of allSubs.filter(isWorkspaceSubscription)) {
      const e = workspaceEntitlementsOf(workspaceSubscriptionLike(s), {}, now);
      if (!e.paid || s.status === "canceled") continue;
      workspaceTotals.paying++;
      // The stored quantity is the billed one (convex/lib/seats.ts keeps it in step with the members).
      const quantity = billedQuantity(s.quantity ?? 0);
      workspaceTotals.seats += quantity;
      if (s.provider !== "manual") workspaceTotals.mrrCents += seatChargeCents(monthlyValueCents(e.planId), quantity);
    }

    // Recurring revenue from plans in effect today (paid, not canceled; manual comps count at list price).
    let mrr = 0;
    const byPlan: Record<string, number> = { "basic:month": 0, "basic:year": 0, "pro:month": 0, "pro:year": 0 };
    let paying = 0;
    let cancelingAtPeriodEnd = 0;
    let pastDue = 0;
    for (const s of subs) {
      const e = personalEntitlementsOf(s, now);
      if (!e.paid || s.status === "canceled") continue;
      const interval = s.interval ?? "month";
      paying++;
      byPlan[`${e.paidPlan}:${interval}`] = (byPlan[`${e.paidPlan}:${interval}`] ?? 0) + 1;
      if (s.cancelAtPeriodEnd) cancelingAtPeriodEnd++;
      if (s.status === "past_due") pastDue++;
      if (s.provider !== "manual") mrr += monthlyValueCents(e.paidPlanId);
    }

    const since = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() - (months - 1), 1);
    const payments = (
      await ctx.db
        .query("payments")
        .withIndex("by_created", (q) => q.gte("createdAt", since))
        .collect()
    )
      .filter(counts)
      .filter(isPersonalPayment);
    const monthsList = lastMonths(months, now);
    const revenueByMonth = new Map(monthsList.map((m) => [m, { gross: 0, refunded: 0 }]));
    for (const p of payments) {
      const row = revenueByMonth.get(monthOf(p.createdAt));
      if (!row) continue;
      if (p.status === "paid") row.gross += p.amountCents;
      if (p.status === "refunded") {
        row.gross += p.amountCents;
        row.refunded += p.amountCents;
      }
    }
    const newByMonth = new Map(monthsList.map((m) => [m, 0]));
    const churnByMonth = new Map(monthsList.map((m) => [m, 0]));
    for (const s of subs) {
      if (s.paidSince && newByMonth.has(monthOf(s.paidSince))) newByMonth.set(monthOf(s.paidSince), newByMonth.get(monthOf(s.paidSince))! + 1);
      if (s.canceledAt && churnByMonth.has(monthOf(s.canceledAt))) churnByMonth.set(monthOf(s.canceledAt), churnByMonth.get(monthOf(s.canceledAt))! + 1);
    }
    const last30 = payments.filter((p) => p.createdAt >= now - 30 * DAY_MS);
    const recent = [...payments].sort((a, b) => b.createdAt - a.createdAt).slice(0, 25);
    const names = new Map<string, { name: string; email: string }>();
    for (const p of recent) {
      if (names.has(p.profileId)) continue;
      const prof = await ctx.db.get(p.profileId);
      names.set(p.profileId, { name: prof?.displayName ?? "Deleted user", email: prof ? redactEmail(prof.email) : "" });
    }
    return {
      mrrCents: mrr,
      arrCents: mrr * 12,
      paying,
      arppuCents: paying ? Math.round(mrr / paying) : 0,
      byPlan,
      cancelingAtPeriodEnd,
      pastDue,
      revenueByMonth: [...revenueByMonth].map(([month, r]) => ({ month, grossCents: r.gross, refundedCents: r.refunded, netCents: r.gross - r.refunded })),
      newByMonth: [...newByMonth].map(([month, count]) => ({ month, count })),
      churnByMonth: [...churnByMonth].map(([month, count]) => ({ month, count })),
      last30: {
        grossCents: last30.filter((p) => p.status !== "failed").reduce((n, p) => n + p.amountCents, 0),
        refundedCents: last30.filter((p) => p.status === "refunded").reduce((n, p) => n + p.amountCents, 0),
        failed: last30.filter((p) => p.status === "failed").length,
      },
      recent: recent.map((p) => ({ id: p._id as string, profileId: p.profileId as string, ...names.get(p.profileId)!, amountCents: p.amountCents, currency: p.currency, plan: p.plan, interval: p.interval, status: p.status, provider: p.provider, createdAt: p.createdAt })),
      prices: { basic: { month: PLANS.basic.monthlyCents, year: PLANS.basic.yearlyCents }, pro: { month: PLANS.pro.monthlyCents, year: PLANS.pro.yearlyCents } },
      workspaces: workspaceTotals,
      testIncluded: Boolean(args.includeTest),
    };
  },
});
