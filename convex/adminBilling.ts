// Admin: people's plans, payments and AI access. Same rules as convex/admin.ts — platform roles checked on
// the server, a reason for every change, and an audit record for every read and write. Money moves only
// through the payment provider; here admins set plans by hand (e.g. comps, fixes) and record refunds.
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requirePlatformRole, type PlatformRole } from "./lib/auth";
import { recordAudit } from "./lib/audit";
import { fail } from "./lib/errors";
import { ensureSubscription, ensureWorkspaceSubscription, isPersonalPayment, type PersonalSubscription, type WorkspaceSubscription } from "./lib/billing";
import { personalAiUsage, personalEntitlements, storageUsage } from "./lib/entitlements";
import { DAY_MS, isPaidPlan, personalPlanId } from "./lib/plans";
import { personalScope } from "./lib/scope";
import { billableSeatCount } from "./lib/seats";
import { vWorkspacePlanId } from "./lib/validators";
import { listUserSessions } from "./lib/authStore";

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
  plan: s.plan,
  interval: s.interval ?? null,
  status: s.status,
  provider: s.provider,
  trialEndsAt: s.trialEndsAt ?? null,
  currentPeriodEnd: s.currentPeriodEnd ?? null,
  aiGrant: Boolean(s.aiGrant),
  aiGrantUntil: s.aiGrantUntil ?? null,
  storageOverrideBytes: s.storageOverrideBytes ?? null,
  deviceLimitOverride: s.deviceLimitOverride ?? null,
});

/** One person's Personal plan, entitlements, personal storage, AI use in Personal and payments (an audited read). */
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
    const since = new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10);
    const usage = await personalAiUsage(ctx, p._id, since);
    const byDay = new Map<string, number>();
    for (const u of usage) byDay.set(u.day, (byDay.get(u.day) ?? 0) + u.count);
    const storage = await storageUsage(ctx, { kind: "personal", profileId: p._id });
    return {
      subscription: { ...snapshot(sub), stripeCustomerId: sub.stripeCustomerId ?? null, cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd), paidSince: sub.paidSince ?? null },
      entitlements: await personalEntitlements(ctx, p._id),
      /** Personal storage only (team workspaces have their own). */
      storageUsedBytes: storage.usedBytes,
      storageLimitBytes: storage.limitBytes,
      devicesActive: (await listUserSessions(ctx, p.authSubject)).length,
      aiRequests30d: usage.reduce((n, u) => n + u.count, 0),
      aiByDay: [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count })),
      payments: payments.map((x) => ({ id: x._id as string, amountCents: x.amountCents, currency: x.currency, plan: x.plan, interval: x.interval, status: x.status, provider: x.provider, createdAt: x.createdAt })),
      /** Documents in their Personal (an export of it can be prepared for them). */
      personalDocuments: p.personalDocumentCount ?? 0,
    };
  },
});

/**
 * Sets someone's plan by hand (a comp, a correction, an offline purchase). `until` (ms) ends it; without it
 * the plan has no end date. Plans billed through Stripe should be changed in Stripe instead.
 */
export const setPlan = mutation({
  args: { profileId: v.string(), plan: v.union(v.literal("free"), v.literal("basic"), v.literal("pro")), interval: v.optional(v.union(v.literal("month"), v.literal("year"))), until: v.optional(v.union(v.number(), v.null())), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, ADMIN);
    const reason = requireReason(args.reason);
    const p = await targetProfile(ctx, args.profileId);
    const sub = await ensureSubscription(ctx, p._id);
    const paid = isPaidPlan(personalPlanId(args.plan, args.interval));
    if (sub.provider === "stripe" && sub.status !== "canceled" && isPaidPlan(personalPlanId(sub.plan, sub.interval))) fail("invalid_argument", "This plan is billed through Stripe — change or cancel it there, then set it here if needed.");
    if (args.until !== undefined && args.until !== null && args.until <= Date.now()) fail("invalid_argument", "The end date must be in the future.");
    const before = snapshot(sub);
    const now = Date.now();
    await ctx.db.patch(sub._id, {
      plan: args.plan,
      interval: paid ? (args.interval ?? "month") : undefined,
      status: "active",
      provider: paid ? "manual" : "none",
      currentPeriodEnd: paid ? (args.until ?? undefined) : undefined,
      cancelAtPeriodEnd: false,
      paidSince: !paid ? undefined : sub.plan === args.plan && sub.paidSince ? sub.paidSince : now,
      canceledAt: !paid && isPaidPlan(personalPlanId(sub.plan, sub.interval)) ? now : undefined,
      updatedAt: now,
    });
    await recordAudit(ctx, admin, { action: "billing.set_plan", targetType: "profile", targetId: p._id, reason, before, after: snapshot((await ctx.db.get(sub._id)) as PersonalSubscription), requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

/** Gives (or extends) a Pro trial. Support staff up to 14 days; admins up to 90. */
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

/** Gives AI on any plan (optionally until a date), or takes a grant away. */
export const setAiGrant = mutation({
  args: { profileId: v.string(), grant: v.boolean(), until: v.optional(v.union(v.number(), v.null())), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, ADMIN);
    const reason = requireReason(args.reason);
    const p = await targetProfile(ctx, args.profileId);
    const sub = await ensureSubscription(ctx, p._id);
    if (args.grant && args.until !== undefined && args.until !== null && args.until <= Date.now()) fail("invalid_argument", "The end date must be in the future.");
    const before = snapshot(sub);
    await ctx.db.patch(sub._id, { aiGrant: args.grant || undefined, aiGrantUntil: args.grant ? (args.until ?? undefined) : undefined, updatedAt: Date.now() });
    await recordAudit(ctx, admin, { action: args.grant ? "billing.grant_ai" : "billing.revoke_ai", targetType: "profile", targetId: p._id, reason, before, after: snapshot((await ctx.db.get(sub._id)) as PersonalSubscription), requestId: args.requestId, clientHash: args.clientHash });
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
  planId: s.planId,
  status: s.status,
  provider: s.provider,
  quantity: s.quantity ?? null,
  currentPeriodEnd: s.currentPeriodEnd ?? null,
  cancelAtPeriodEnd: Boolean(s.cancelAtPeriodEnd),
});

/**
 * Sets a team workspace's plan by hand (a comp, an offline purchase, or a plan before online payments are
 * set up). Nobody is charged; seats are counted but not billed. `until` (ms) ends it — after that the hourly
 * job moves the workspace to Workspace Free; without it the plan has no end date. Plans billed through
 * Stripe are changed in Stripe instead.
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
    const stripeLive = sub.provider === "stripe" && isPaidPlan(sub.planId) && (sub.status !== "canceled" || (sub.currentPeriodEnd ?? 0) > now);
    if (stripeLive) fail("invalid_argument", "This workspace is billed through Stripe — change or cancel it there, then set it here if needed.");
    if (args.until !== undefined && args.until !== null && args.until <= now) fail("invalid_argument", "The end date must be in the future.");
    const paid = isPaidPlan(args.planId);
    const before = workspaceSnapshot(sub);
    const wasPaid = isPaidPlan(sub.planId) && sub.status !== "canceled";
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
