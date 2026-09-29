// Admin: people's plans, payments and AI credits. Same rules as convex/admin.ts: platform roles checked on
// the server, a reason for every change, and an audit record for every read and write. Money moves only
// through the payment provider (Polar); here admins set plans by hand (comps, fixes), grant AI credits and
// record refunds. A plan billed through Polar is changed in Polar, never here.
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requirePlatformRole, type PlatformRole } from "./lib/auth";
import { recordAudit } from "./lib/audit";
import { fail } from "./lib/errors";
import { ensureSubscription, ensureWorkspaceSubscription, isPersonalPayment, paymentTier, personalPlanFields, personalPolarBilled, personalTier, storedPersonalPlanId, storedWorkspacePlanId, workspacePolarBilled, type PersonalSubscription, type WorkspaceSubscription } from "./lib/billing";
import { personalEntitlements, storageUsage } from "./lib/entitlements";
import { addCredits, creditBalance, personalAccount, seatAccount } from "./lib/credits";
import { DAY_MS, PACK_VALID_MONTHS, addMonthsUtc, isPaidPlan, personalPlanId } from "./lib/plans";
import { personalScope } from "./lib/scope";
import { billableSeatCount } from "./lib/seats";
import { vInterval, vPersonalTier, vWorkspacePlanId } from "./lib/validators";
import { listUserSessions } from "./lib/authStore";
import { refundPaymentCredits } from "./billing";

const STAFF: PlatformRole[] = ["super_admin", "ops_admin", "support_admin"];
const ADMIN: PlatformRole[] = ["super_admin", "ops_admin"];
const OWNER: PlatformRole[] = ["super_admin"];
const vMeta = { requestId: v.optional(v.string()), clientHash: v.optional(v.string()) };
const vRequest = { reason: v.string(), ...vMeta };

function requireReason(reason: string): string {
  const r = reason.trim();
  if (r.length < 8) fail("invalid_argument", "Give a reason of at least a few words. It is kept in the audit log.");
  return r.slice(0, 500);
}

async function targetProfile(ctx: MutationCtx, profileId: string): Promise<Doc<"profiles">> {
  const id = ctx.db.normalizeId("profiles", profileId);
  const p = id ? await ctx.db.get(id) : null;
  if (!p || p.status === "deleted") fail("not_found", "User not found.");
  return p;
}

const snapshot = (s: PersonalSubscription) => ({
  plan: personalTier(s),
  interval: s.interval ?? null,
  status: s.status,
  provider: s.provider,
  trialEndsAt: s.trialEndsAt ?? null,
  currentPeriodEnd: s.currentPeriodEnd ?? null,
  storageOverrideBytes: s.storageOverrideBytes ?? null,
  deviceLimitOverride: s.deviceLimitOverride ?? null,
});

/** AI use in Personal per day over 30 days (requests and credits; no content). */
async function personalUsage(ctx: MutationCtx, profileId: Id<"profiles">) {
  const since = new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10);
  const rows = await ctx.db
    .query("aiUsage")
    .withIndex("by_profile_day", (q) => q.eq("profileId", profileId).gte("day", since))
    .collect();
  const byDay = new Map<string, { count: number; credits: number }>();
  for (const u of rows) {
    const d = byDay.get(u.day) ?? { count: 0, credits: 0 };
    byDay.set(u.day, { count: d.count + u.count, credits: d.credits + (u.credits ?? 0) });
  }
  return {
    requests: rows.reduce((n, u) => n + u.count, 0),
    credits: rows.reduce((n, u) => n + (u.credits ?? 0), 0),
    byDay: [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, d]) => ({ day, count: d.count, credits: d.credits })),
  };
}

/** One person's Personal plan, entitlements, storage, AI credits and use, and payments (an audited read). */
export const userBilling = mutation({
  args: { profileId: v.string(), ...vMeta },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, STAFF);
    const p = await targetProfile(ctx, args.profileId);
    await recordAudit(ctx, admin, { action: "user.view_billing", targetType: "profile", targetId: p._id, requestId: args.requestId, clientHash: args.clientHash });
    const sub = await ensureSubscription(ctx, p._id);
    const payments = (
      await ctx.db
        .query("payments")
        .withIndex("by_profile_created", (q) => q.eq("profileId", p._id))
        .order("desc")
        .take(50)
    ).filter(isPersonalPayment);
    const usage = await personalUsage(ctx, p._id);
    const storage = await storageUsage(ctx, { kind: "personal", profileId: p._id });
    const account = await personalAccount(ctx, p._id);
    const packs = await ctx.db
      .query("aiCreditPacks")
      .withIndex("by_account_expires", (q) => q.eq("profileId", p._id))
      .collect();
    const workspaceNames = new Map<string, string>();
    for (const pack of packs) if (pack.workspaceId && !workspaceNames.has(pack.workspaceId)) workspaceNames.set(pack.workspaceId, (await ctx.db.get(pack.workspaceId))?.name ?? "Deleted workspace");
    return {
      subscription: { ...snapshot(sub), planId: storedPersonalPlanId(sub), cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd), paidSince: sub.paidSince ?? null, polarCustomerId: sub.polarCustomerId ?? null },
      /** Billed through Polar: the plan can't be set by hand here (setPlan refuses). */
      polarBilled: personalPolarBilled(sub),
      entitlements: await personalEntitlements(ctx, p._id),
      /** Personal storage (on Free: the pool shared with the free workspaces they own). */
      storageUsedBytes: storage.usedBytes,
      storageLimitBytes: storage.limitBytes,
      storageRule: storage.rule,
      devicesActive: (await listUserSessions(ctx, p.authSubject)).length,
      /** Personal AI credits this period. */
      credits: { ...(await creditBalance(ctx, account)), plan: account.planLabel, trialing: account.trialing },
      /** Bought and granted credits (Personal and workspace seats), newest first. */
      packs: packs
        .sort((a, b) => b.purchasedAt - a.purchasedAt)
        .slice(0, 50)
        .map((k) => ({ id: k._id as string, credits: k.credits, remaining: k.remaining, source: k.source, status: k.status, purchasedAt: k.purchasedAt, expiresAt: k.expiresAt, workspace: k.workspaceId ? (workspaceNames.get(k.workspaceId) ?? null) : null })),
      aiRequests30d: usage.requests,
      aiCredits30d: usage.credits,
      aiByDay: usage.byDay,
      payments: payments.map((x) => ({ id: x._id as string, amountCents: x.amountCents, currency: x.currency, plan: paymentTier(x), interval: x.interval ?? null, credits: x.credits ?? null, status: x.status, provider: x.provider, createdAt: x.createdAt })),
      /** Documents in their Personal (an export of it can be prepared for them). */
      personalDocuments: p.personalDocumentCount ?? 0,
    };
  },
});

/**
 * Sets someone's plan by hand (a comp, a correction, an offline purchase). `until` (ms) ends it; without it
 * the plan has no end date. Plans billed through Polar are changed in Polar instead.
 */
export const setPlan = mutation({
  args: { profileId: v.string(), plan: vPersonalTier, interval: v.optional(vInterval), until: v.optional(v.union(v.number(), v.null())), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, ADMIN);
    const reason = requireReason(args.reason);
    const p = await targetProfile(ctx, args.profileId);
    const sub = await ensureSubscription(ctx, p._id);
    const paid = isPaidPlan(personalPlanId(args.plan, args.interval));
    if (personalPolarBilled(sub)) fail("invalid_argument", "This plan is billed through Polar. Change or cancel it there, then set it here if needed.");
    if (args.until !== undefined && args.until !== null && args.until <= Date.now()) fail("invalid_argument", "The end date must be in the future.");
    const before = snapshot(sub);
    const now = Date.now();
    const wasPaid = isPaidPlan(storedPersonalPlanId(sub));
    await ctx.db.patch(sub._id, {
      ...personalPlanFields(args.plan),
      interval: paid ? (args.interval ?? "month") : undefined,
      status: "active",
      provider: paid ? "manual" : "none",
      currentPeriodStart: paid ? now : undefined,
      currentPeriodEnd: paid ? (args.until ?? undefined) : undefined,
      cancelAtPeriodEnd: false,
      paidSince: !paid ? undefined : personalTier(sub) === args.plan && sub.paidSince ? sub.paidSince : now,
      canceledAt: !paid && wasPaid ? now : undefined,
      updatedAt: now,
    });
    await recordAudit(ctx, admin, { action: "billing.set_plan", targetType: "profile", targetId: p._id, reason, before, after: snapshot((await ctx.db.get(sub._id)) as PersonalSubscription), requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

/** Gives (or extends) a Pro AI trial. Support staff up to 14 days; admins up to 90. */
export const extendTrial = mutation({
  args: { profileId: v.string(), days: v.number(), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, STAFF);
    const reason = requireReason(args.reason);
    const max = admin.platformRole === "support_admin" ? 14 : 90;
    if (!Number.isInteger(args.days) || args.days < 1 || args.days > max) fail("invalid_argument", `Choose between 1 and ${max} days.`);
    const p = await targetProfile(ctx, args.profileId);
    const sub = await ensureSubscription(ctx, p._id);
    const before = snapshot(sub);
    const from = Math.max(Date.now(), sub.trialEndsAt ?? 0);
    await ctx.db.patch(sub._id, { trialEndsAt: from + args.days * DAY_MS, updatedAt: Date.now() });
    await recordAudit(ctx, admin, { action: "billing.extend_trial", targetType: "profile", targetId: p._id, reason, before, after: snapshot((await ctx.db.get(sub._id)) as PersonalSubscription), requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

/** The most credits one grant can add. */
export const MAX_GRANT_CREDITS = 10_000;

/**
 * Grants AI credits to someone: for their Personal, or for their seat in a paid workspace they're a member
 * of (`workspaceId`, its public id). Granted credits are used after the monthly ones and last `months`
 * (default 12). Audited with the reason. A Core scope can't be given credits: it has no AI.
 */
export const grantCredits = mutation({
  args: { profileId: v.string(), credits: v.number(), workspaceId: v.optional(v.string()), months: v.optional(v.number()), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, ADMIN);
    const reason = requireReason(args.reason);
    if (!Number.isInteger(args.credits) || args.credits < 1 || args.credits > MAX_GRANT_CREDITS) fail("invalid_argument", `Choose between 1 and ${MAX_GRANT_CREDITS.toLocaleString("en-US")} credits.`);
    const months = args.months ?? PACK_VALID_MONTHS;
    if (!Number.isInteger(months) || months < 1 || months > 24) fail("invalid_argument", "Choose between 1 and 24 months.");
    const p = await targetProfile(ctx, args.profileId);
    let workspaceId: Id<"workspaces"> | undefined;
    if (args.workspaceId) {
      const w = await ctx.db
        .query("workspaces")
        .withIndex("by_public_id", (q) => q.eq("publicId", args.workspaceId!))
        .unique();
      if (!w || w.status === "deleting") fail("not_found", "Workspace not found.");
      if (!(await seatAccount(ctx, p._id, w._id))) fail("invalid_argument", "That workspace isn't on Pro or Pro AI, so its members use their personal credits there. Grant personal credits instead.");
      const member = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_profile", (q) => q.eq("workspaceId", w._id).eq("profileId", p._id))
        .unique();
      if (!member) fail("invalid_argument", "They aren't a member of that workspace.");
      workspaceId = w._id;
    } else if (!(await personalEntitlements(ctx, p._id)).ai) {
      fail("invalid_argument", "Their personal plan is Core, which has no AI. Change the plan first.");
    }
    const now = Date.now();
    const packId = await addCredits(ctx, { profileId: p._id, workspaceId }, args.credits, "admin", { expiresAt: addMonthsUtc(now, months), now });
    await recordAudit(ctx, admin, {
      action: "billing.grant_credits",
      targetType: "profile",
      targetId: p._id,
      reason,
      after: { credits: args.credits, months, workspaceId: workspaceId ?? null, packId },
      requestId: args.requestId,
      clientHash: args.clientHash,
    });
    return null;
  },
});

/** A storage limit for this person that replaces their plan's (null = back to the plan's). */
export const setStorageOverride = mutation({
  args: { profileId: v.string(), gigabytes: v.union(v.number(), v.null()), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, ADMIN);
    const reason = requireReason(args.reason);
    if (args.gigabytes !== null && (!(args.gigabytes > 0) || args.gigabytes > 10_000)) fail("invalid_argument", "Choose between 1 and 10,000 GB.");
    const p = await targetProfile(ctx, args.profileId);
    const sub = await ensureSubscription(ctx, p._id);
    const before = snapshot(sub);
    await ctx.db.patch(sub._id, { storageOverrideBytes: args.gigabytes === null ? undefined : Math.round(args.gigabytes * 1024 ** 3), updatedAt: Date.now() });
    await recordAudit(ctx, admin, { action: "billing.set_storage", targetType: "profile", targetId: p._id, reason, before, after: snapshot((await ctx.db.get(sub._id)) as PersonalSubscription), requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

/** A device limit for this person that replaces their plan's: a number, "unlimited", or null (the plan's). */
export const setDeviceLimit = mutation({
  args: { profileId: v.string(), devices: v.union(v.number(), v.literal("unlimited"), v.null()), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, ADMIN);
    const reason = requireReason(args.reason);
    if (typeof args.devices === "number" && (!Number.isInteger(args.devices) || args.devices < 1 || args.devices > 100)) fail("invalid_argument", "Choose between 1 and 100 devices.");
    const p = await targetProfile(ctx, args.profileId);
    const sub = await ensureSubscription(ctx, p._id);
    const before = snapshot(sub);
    await ctx.db.patch(sub._id, { deviceLimitOverride: args.devices ?? undefined, updatedAt: Date.now() });
    await recordAudit(ctx, admin, { action: "billing.set_devices", targetType: "profile", targetId: p._id, reason, before, after: snapshot((await ctx.db.get(sub._id)) as PersonalSubscription), requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

/** Marks a payment refunded in Folevi's records (the refund itself is made in the payment provider). */
export const markRefunded = mutation({
  args: { paymentId: v.string(), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, OWNER);
    const reason = requireReason(args.reason);
    const id = ctx.db.normalizeId("payments", args.paymentId);
    const pay = id ? await ctx.db.get(id) : null;
    if (!pay) fail("not_found", "Payment not found.");
    if (pay.status === "refunded") return null;
    await ctx.db.patch(pay._id, { status: "refunded" });
    // A refunded credit pack takes back its unused credits.
    await refundPaymentCredits(ctx, pay);
    const target = pay.workspaceId ? { targetType: "workspace", targetId: pay.workspaceId as string } : { targetType: "profile", targetId: pay.profileId as string };
    await recordAudit(ctx, admin, { action: "billing.mark_refunded", ...target, reason, before: { status: pay.status, amountCents: pay.amountCents }, after: { status: "refunded" }, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

/**
 * Prepares an export of the person's Personal for them, at their request. The ZIP is delivered only to
 * the person (a notification with a download); staff never see note content.
 */
export const requestUserExport = mutation({
  args: { profileId: v.string(), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, STAFF);
    const reason = requireReason(args.reason);
    const p = await targetProfile(ctx, args.profileId);
    if (p.status === "deleted") fail("not_found", "User not found.");
    await ctx.scheduler.runAfter(0, internal.exports.exportForUser, { profileId: p._id, scope: personalScope(p._id) });
    await recordAudit(ctx, admin, { action: "user.request_export", targetType: "profile", targetId: p._id, reason, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});


// ---------------------------------------------------------------------------------------------------
// Workspace plans
// ---------------------------------------------------------------------------------------------------

const workspaceSnapshot = (s: WorkspaceSubscription) => ({
  planId: storedWorkspacePlanId(s),
  status: s.status,
  provider: s.provider,
  quantity: s.quantity ?? null,
  currentPeriodEnd: s.currentPeriodEnd ?? null,
  cancelAtPeriodEnd: Boolean(s.cancelAtPeriodEnd),
});

/**
 * Sets a team workspace's plan by hand (a comp, an offline purchase, or a plan before online payments are
 * set up). Nobody is charged; seats are counted but not billed. `until` (ms) ends it. After that the hourly
 * job moves the workspace to Workspace Free; without it the plan has no end date. Plans billed through
 * Polar are changed in Polar instead.
 */
export const setWorkspacePlan = mutation({
  args: { workspaceId: v.string(), planId: vWorkspacePlanId, until: v.optional(v.union(v.number(), v.null())), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, ADMIN);
    const reason = requireReason(args.reason);
    const w = await ctx.db
      .query("workspaces")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.workspaceId))
      .unique();
    if (!w || w.status === "deleting") fail("not_found", "Workspace not found.");
    const sub = await ensureWorkspaceSubscription(ctx, w._id);
    const now = Date.now();
    if (workspacePolarBilled(sub, now)) fail("invalid_argument", "This workspace is billed through Polar. Change or cancel it there, then set it here if needed.");
    if (args.until !== undefined && args.until !== null && args.until <= now) fail("invalid_argument", "The end date must be in the future.");
    const paid = isPaidPlan(args.planId);
    const before = workspaceSnapshot(sub);
    const wasPaid = isPaidPlan(storedWorkspacePlanId(sub)) && sub.status !== "canceled";
    await ctx.db.patch(sub._id, {
      planId: args.planId,
      status: paid ? "active" : "canceled",
      provider: paid ? "manual" : "none",
      quantity: paid ? await billableSeatCount(ctx, w._id) : undefined,
      currentPeriodStart: paid ? now : undefined,
      currentPeriodEnd: paid ? (args.until ?? undefined) : undefined,
      cancelAtPeriodEnd: false,
      paidSince: !paid ? undefined : wasPaid && sub.paidSince ? sub.paidSince : now,
      canceledAt: !paid && wasPaid ? now : undefined,
      updatedAt: now,
    });
    await recordAudit(ctx, admin, { action: "billing.set_workspace_plan", targetType: "workspace", targetId: w._id, reason, before, after: workspaceSnapshot((await ctx.db.get(sub._id)) as WorkspaceSubscription), requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});
