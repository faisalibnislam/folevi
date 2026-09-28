// Platform administration. Every entry point enforces platform roles server-side and every mutation
// or sensitive view writes an immutable audit record. There is deliberately no document-content viewer.
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { ulid } from "@folevi/editor-schema";
import { ALL_ADMIN_ROLES, requirePlatformRole, type PlatformRole } from "./lib/auth";
import { recordAudit } from "./lib/audit";
import { fail } from "./lib/errors";
import { DEFAULT_RATE_RULES } from "./lib/rateLimit";
import { KNOWN_FLAGS, knownFlag } from "./lib/flags";
import { BUILT_IN_TEMPLATES } from "./lib/templates";
import { keyedHash, redactEmail } from "./lib/crypto";
import { vPlatformRole } from "./lib/validators";
import { entitlementsFor } from "./lib/billing";

// Three tiers (stored names kept for existing admins and audit records):
//   Owner (super_admin)      — everything, including admin roles and money matters
//   Admin (ops_admin)        — users, plans, workspaces, configuration
//   Support staff (support_admin) — look up users and help them (resend emails, password resets,
//                               trial extensions, exports delivered to the user)
const STAFF: PlatformRole[] = ["super_admin", "ops_admin", "support_admin"];
const ADMIN: PlatformRole[] = ["super_admin", "ops_admin"];
const OWNER: PlatformRole[] = ["super_admin"];

const vReason = v.string();
/** Correlation fields every audited admin call accepts (reads and writes alike). */
const vMeta = { requestId: v.optional(v.string()), clientHash: v.optional(v.string()) };
const vRequest = { reason: vReason, ...vMeta };

function requireReason(reason: string): string {
  const r = reason.trim();
  if (r.length < 8) fail("invalid_argument", "Give a reason of at least a few words. It is kept in the audit log.");
  return r.slice(0, 500);
}

async function audit(
  ctx: MutationCtx,
  actor: Doc<"profiles">,
  action: string,
  target: { type: string; id: string },
  extra: { reason?: string; before?: unknown; after?: unknown; requestId?: string; clientHash?: string } = {},
) {
  await recordAudit(ctx, actor, { action, targetType: target.type, targetId: target.id, ...extra });
}

// ---------------------------------------------------------------- dashboard (aggregates only)

export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformRole(ctx, ALL_ADMIN_ROLES);
    const metrics = await ctx.db.query("metrics").take(100);
    const totals = Object.fromEntries(metrics.map((m) => [m.key, m.value]));
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const daily = await ctx.db
      .query("metricsDaily")
      .withIndex("by_date", (q) => q.gte("date", since))
      .take(3000);
    const series: Record<string, { date: string; value: number }[]> = {};
    const cohorts: { week: string; total: number; active: number }[] = [];
    const latestCohort = new Map<string, { total?: number; active?: number; date: string }>();
    for (const d of daily) {
      if (d.key.startsWith("cohort:")) {
        const [, week, kind] = d.key.split(":");
        const cur = latestCohort.get(week!) ?? { date: "" };
        if (d.date >= cur.date) {
          if (d.date > cur.date) {
            cur.total = undefined;
            cur.active = undefined;
          }
          cur.date = d.date;
          if (kind === "total") cur.total = d.value;
          else cur.active = d.value;
          latestCohort.set(week!, cur);
        }
        continue;
      }
      (series[d.key] ??= []).push({ date: d.date, value: d.value });
    }
    for (const [week, c] of [...latestCohort.entries()].sort()) cohorts.push({ week, total: c.total ?? 0, active: c.active ?? 0 });
    for (const s of Object.values(series)) s.sort((a, b) => (a.date < b.date ? -1 : 1));
    const deployments = await ctx.db.query("deployments").withIndex("by_created").order("desc").take(10);
    const recentRateEvents = await ctx.db
      .query("rateLimitEvents")
      .withIndex("by_created", (q) => q.gt("createdAt", Date.now() - 24 * 60 * 60 * 1000))
      .take(1000);
    const rateByRule: Record<string, number> = {};
    for (const e of recentRateEvents) rateByRule[e.rule] = (rateByRule[e.rule] ?? 0) + 1;
    const failedEmails = await ctx.db
      .query("emailSendAttempts")
      .withIndex("by_status_created", (q) => q.eq("status", "failed").gt("createdAt", Date.now() - 7 * 24 * 60 * 60 * 1000))
      .take(1000);
    const rejectedOps = await ctx.db
      .query("syncOperations")
      .withIndex("by_status_created", (q) => q.eq("status", "rejected").gt("createdAt", Date.now() - 7 * 24 * 60 * 60 * 1000))
      .take(1000);
    const syncErrorsByCode: Record<string, number> = {};
    for (const o of rejectedOps) syncErrorsByCode[o.errorCode ?? "unknown"] = (syncErrorsByCode[o.errorCode ?? "unknown"] ?? 0) + 1;
    return {
      totals: {
        users: totals.users_total ?? 0,
        verifiedUsers: totals.users_verified ?? 0,
        workspaces: totals.workspaces_total ?? 0,
        documents: totals.documents_total ?? 0,
        storageBytes: totals.storage_bytes ?? 0,
        emailsAccepted: totals.email_accepted ?? 0,
        emailsFailed: totals.email_failed ?? 0,
        syncRejected: totals.sync_rejected ?? 0,
        syncConflicts: totals.sync_conflicts ?? 0,
      },
      activeUsers: {
        daily: series.dau?.at(-1)?.value ?? null,
        weekly: series.wau?.at(-1)?.value ?? null,
      },
      series: { signups: series.signups ?? [], dau: series.dau ?? [], emailFailed: series.email_failed ?? [], syncRejected: series.sync_rejected ?? [] },
      cohorts: cohorts.slice(-8),
      failedEmailsLast7d: failedEmails.length,
      syncErrorsLast7d: syncErrorsByCode,
      rateLimitedLast24h: rateByRule,
      deployments: deployments.map((d) => ({ environment: d.environment, commitSha: d.commitSha, commitMessage: d.commitMessage, source: d.source, createdAt: d.createdAt })),
    };
  },
});

export const whoami = query({
  args: {},
  handler: async (ctx) => {
    const p = await requirePlatformRole(ctx, ALL_ADMIN_ROLES);
    return { role: p.platformRole!, displayName: p.displayName, id: p._id as string };
  },
});

// ---------------------------------------------------------------- users

/** Searching users reveals identity metadata, so it is a mutation that audits the (hashed) query. */
export const searchUsers = mutation({
  args: {
    query: v.string(),
    status: v.optional(v.union(v.literal("active"), v.literal("suspended"), v.literal("pending_deletion"), v.literal("deleted"))),
    cursor: v.optional(v.union(v.string(), v.null())),
    ...vMeta,
  },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, STAFF);
    const q = args.query.trim().toLowerCase();
    await audit(ctx, admin, "user.search", { type: "users", id: q ? await keyedHash(q, "admin-search") : "all" }, { requestId: args.requestId, clientHash: args.clientHash });
    let rows: Doc<"profiles">[];
    let continueCursor: string | null = null;
    if (q.includes("@")) {
      rows = await ctx.db
        .query("profiles")
        .withIndex("by_email", (x) => x.eq("email", q))
        .take(5);
    } else {
      const base = args.status
        ? ctx.db.query("profiles").withIndex("by_status", (x) => x.eq("status", args.status!))
        : ctx.db.query("profiles").withIndex("by_created");
      const page = await base.order("desc").paginate({ cursor: args.cursor ?? null, numItems: 50 });
      rows = page.page.filter((p) => !q || p.displayName.toLowerCase().includes(q) || p.email.includes(q) || (p._id as string) === q);
      continueCursor = page.isDone ? null : page.continueCursor;
    }
    const plans = new Map<string, { plan: string; trialing: boolean; ai: boolean }>();
    for (const p of rows) {
      const e = await entitlementsFor(ctx, p._id);
      plans.set(p._id, { plan: e.paidPlan, trialing: e.trialing, ai: e.ai });
    }
    return {
      users: rows.map((p) => ({
        id: p._id as string,
        email: p.email,
        displayName: p.displayName,
        status: p.status,
        emailVerified: p.emailVerified,
        mfaVerified: p.mfaVerified,
        platformRole: p.platformRole ?? null,
        createdAt: p.createdAt,
        lastActiveAt: p.lastActiveAt,
        ...plans.get(p._id)!,
      })),
      continueCursor,
    };
  },
});

export const viewUser = mutation({
  args: { profileId: v.string(), ...vMeta },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, STAFF);
    const id = ctx.db.normalizeId("profiles", args.profileId);
    const p = id ? await ctx.db.get(id) : null;
    if (!p) fail("not_found", "User not found.");
    await audit(ctx, admin, "user.view", { type: "profile", id: p._id }, { requestId: args.requestId, clientHash: args.clientHash });
    const sessions = await ctx.db
      .query("sessionsMirror")
      .withIndex("by_profile", (q) => q.eq("profileId", p._id))
      .order("desc")
      .take(50);
    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_profile", (q) => q.eq("profileId", p._id))
      .collect();
    const workspaces = [];
    for (const m of memberships) {
      const w = await ctx.db.get(m.workspaceId);
      if (w) workspaces.push({ id: w.publicId, name: w.name, kind: w.kind, role: m.role, status: w.status, documentCount: w.documentCount, storageUsedBytes: w.storageUsedBytes });
    }
    const history = await ctx.db
      .query("adminAuditLogs")
      .withIndex("by_target", (q) => q.eq("targetType", "profile").eq("targetId", p._id))
      .order("desc")
      .take(50);
    const actorNames = new Map<string, string>();
    for (const h of history) if (!actorNames.has(h.actorId)) actorNames.set(h.actorId, (await ctx.db.get(h.actorId))?.displayName ?? "Admin");
    const emails = await ctx.db
      .query("emailSendAttempts")
      .withIndex("by_profile", (q) => q.eq("profileId", p._id))
      .order("desc")
      .take(20);
    const deletion = await ctx.db
      .query("deletionJobs")
      .withIndex("by_target", (q) => q.eq("kind", "account").eq("targetId", p._id))
      .order("desc")
      .first();
    return {
      id: p._id as string,
      email: p.email,
      displayName: p.displayName,
      authSubject: p.authSubject,
      authIssuer: p.authIssuer,
      status: p.status,
      suspendedReason: p.suspendedReason ?? null,
      emailVerified: p.emailVerified,
      mfaVerified: p.mfaVerified,
      platformRole: p.platformRole ?? null,
      createdAt: p.createdAt,
      lastActiveAt: p.lastActiveAt,
      timeZone: p.timeZone,
      deletionScheduledFor: p.deletionScheduledFor ?? null,
      deletionJob: deletion ? { status: deletion.status, scheduledFor: deletion.scheduledFor } : null,
      sessions: sessions.map((s) => ({ id: s._id as string, client: s.client, label: s.label, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, revokedAt: s.revokedAt ?? null })),
      workspaces,
      usage: {
        workspaces: workspaces.length,
        documents: workspaces.filter((w) => w.role === "owner").reduce((n, w) => n + w.documentCount, 0),
        storageBytes: workspaces.filter((w) => w.role === "owner").reduce((n, w) => n + w.storageUsedBytes, 0),
      },
      emails: emails.map((e) => ({ id: e._id as string, templateKey: e.templateKey, status: e.status, attempts: e.attempts, errorCode: e.errorCode ?? null, createdAt: e.createdAt })),
      audit: history.map((h) => ({ action: h.action, actor: actorNames.get(h.actorId) ?? "Admin", reason: h.reason ?? null, createdAt: h.createdAt, requestId: h.requestId })),
    };
  },
});

async function targetProfile(ctx: MutationCtx, raw: string) {
  const id = ctx.db.normalizeId("profiles", raw);
  const p = id ? await ctx.db.get(id) : null;
  if (!p || p.status === "deleted") fail("not_found", "User not found.");
  return p;
}

export const suspendUser = mutation({
  args: { profileId: v.string(), suspend: v.boolean(), confirmEmail: v.string(), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, ADMIN);
    const reason = requireReason(args.reason);
    const p = await targetProfile(ctx, args.profileId);
    if (p._id === admin._id) fail("forbidden", "You can't suspend yourself.");
    if (p.platformRole === "super_admin" && admin.platformRole !== "super_admin") fail("forbidden", "Only a super admin can suspend another super admin.");
    if (args.confirmEmail.trim().toLowerCase() !== p.email) fail("invalid_argument", "Type the user's email to confirm.");
    const before = { status: p.status };
    const status = args.suspend ? "suspended" : "active";
    await ctx.db.patch(p._id, { status, suspendedReason: args.suspend ? reason : undefined });
    if (args.suspend) {
      const sessions = await ctx.db
        .query("sessionsMirror")
        .withIndex("by_profile", (q) => q.eq("profileId", p._id))
        .collect();
      for (const s of sessions) if (!s.revokedAt) await ctx.db.patch(s._id, { revokedAt: Date.now(), revokedReason: "admin_suspend" });
    }
    await ctx.scheduler.runAfter(0, internal.identity.setProviderBlocked, { profileId: p._id, blocked: args.suspend });
    await audit(ctx, admin, args.suspend ? "user.suspend" : "user.unsuspend", { type: "profile", id: p._id }, { reason, before, after: { status }, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

export const revokeAllSessions = mutation({
  args: { profileId: v.string(), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, ADMIN);
    const reason = requireReason(args.reason);
    const p = await targetProfile(ctx, args.profileId);
    const sessions = await ctx.db
      .query("sessionsMirror")
      .withIndex("by_profile", (q) => q.eq("profileId", p._id))
      .collect();
    let n = 0;
    for (const s of sessions) {
      if (!s.revokedAt) {
        await ctx.db.patch(s._id, { revokedAt: Date.now(), revokedReason: "admin" });
        n++;
      }
    }
    await ctx.scheduler.runAfter(0, internal.identity.revokeProviderSessions, { profileId: p._id, scope: "all" });
    await audit(ctx, admin, "user.revoke_sessions", { type: "profile", id: p._id }, { reason, after: { revoked: n }, requestId: args.requestId, clientHash: args.clientHash });
    return { revoked: n };
  },
});

export const resendVerification = mutation({
  args: { profileId: v.string(), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, STAFF);
    const reason = requireReason(args.reason);
    const p = await targetProfile(ctx, args.profileId);
    if (p.emailVerified) fail("invalid_argument", "This email address is already verified.");
    await ctx.scheduler.runAfter(0, internal.identity.resendVerificationEmail, { profileId: p._id });
    await audit(ctx, admin, "user.resend_verification", { type: "profile", id: p._id }, { reason, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

/** Only for resets the user asked for (e.g. via support). The reset link goes to the user, never to the admin. */
export const initiatePasswordReset = mutation({
  args: { profileId: v.string(), userRequested: v.literal(true), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, STAFF);
    const reason = requireReason(args.reason);
    const p = await targetProfile(ctx, args.profileId);
    await ctx.scheduler.runAfter(0, internal.identity.startPasswordReset, { profileId: p._id });
    await audit(ctx, admin, "user.password_reset", { type: "profile", id: p._id }, { reason, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

export const setPlatformRole = mutation({
  args: { profileId: v.string(), role: v.union(vPlatformRole, v.null()), confirmEmail: v.string(), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, OWNER);
    const reason = requireReason(args.reason);
    const p = await targetProfile(ctx, args.profileId);
    if (args.confirmEmail.trim().toLowerCase() !== p.email) fail("invalid_argument", "Type the user's email to confirm.");
    if (p._id === admin._id && args.role !== "super_admin") {
      const supers = await ctx.db
        .query("profiles")
        .withIndex("by_platform_role", (q) => q.eq("platformRole", "super_admin"))
        .take(2);
      if (supers.length < 2) fail("forbidden", "Keep at least one super admin.");
    }
    if (args.role && (!p.emailVerified || !p.mfaVerified)) fail("forbidden", "Admins need a verified email and two-step verification.");
    const before = { platformRole: p.platformRole ?? null };
    await ctx.db.patch(p._id, { platformRole: args.role ?? undefined });
    await audit(ctx, admin, "user.set_platform_role", { type: "profile", id: p._id }, { reason, before, after: { platformRole: args.role }, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

export const scheduleAccountDeletion = mutation({
  args: { profileId: v.string(), confirmEmail: v.string(), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, ADMIN);
    const reason = requireReason(args.reason);
    const p = await targetProfile(ctx, args.profileId);
    if (args.confirmEmail.trim().toLowerCase() !== p.email) fail("invalid_argument", "Type the user's email to confirm.");
    if (p.platformRole) fail("forbidden", "Remove the platform role first.");
    const scheduledFor = Date.now() + 7 * 24 * 60 * 60 * 1000;
    await ctx.db.patch(p._id, { status: "pending_deletion", deletionScheduledFor: scheduledFor });
    await ctx.db.insert("deletionJobs", {
      kind: "account",
      targetId: p._id,
      requestedBy: admin._id,
      requestedByAdmin: true,
      reason,
      scheduledFor,
      status: "scheduled",
      progress: 0,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
      key: "account_deletion_scheduled",
      profileId: p._id,
      idempotencyKey: `deletion-scheduled:${p._id}:${scheduledFor}`,
      dataVariables: { scheduledFor: new Date(scheduledFor).toUTCString(), cancelUrl: `${process.env.FOLEVI_APP_URL ?? "https://app.folevi.com"}/settings/account` },
    });
    await audit(ctx, admin, "user.schedule_deletion", { type: "profile", id: p._id }, { reason, after: { scheduledFor }, requestId: args.requestId, clientHash: args.clientHash });
    return { scheduledFor };
  },
});

// ---------------------------------------------------------------- workspaces

export const viewWorkspace = mutation({
  args: { workspaceId: v.string(), ...vMeta },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, STAFF);
    const w = await ctx.db
      .query("workspaces")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.workspaceId))
      .unique();
    if (!w) fail("not_found", "Workspace not found.");
    await audit(ctx, admin, "workspace.view", { type: "workspace", id: w._id }, { requestId: args.requestId, clientHash: args.clientHash });
    const members = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", w._id))
      .collect();
    const people = [];
    for (const m of members) {
      const p = await ctx.db.get(m.profileId);
      if (p) people.push({ profileId: p._id as string, displayName: p.displayName, email: p.email, role: m.role, joinedAt: m.joinedAt });
    }
    const invites = await ctx.db
      .query("workspaceInvites")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", w._id))
      .collect();
    const history = await ctx.db
      .query("adminAuditLogs")
      .withIndex("by_target", (q) => q.eq("targetType", "workspace").eq("targetId", w._id))
      .order("desc")
      .take(30);
    return {
      id: w.publicId,
      name: w.name,
      kind: w.kind,
      status: w.status,
      createdAt: w.createdAt,
      documentCount: w.documentCount,
      storageUsedBytes: w.storageUsedBytes,
      storageQuotaBytes: w.storageQuotaBytes,
      memberLimit: w.memberLimit,
      members: people,
      invites: invites.map((i) => ({ email: redactEmail(i.email), role: i.role, status: i.status, expiresAt: i.expiresAt, createdAt: i.createdAt })),
      audit: history.map((h) => ({ action: h.action, reason: h.reason ?? null, createdAt: h.createdAt })),
    };
  },
});

export const setWorkspaceSuspended = mutation({
  args: { workspaceId: v.string(), suspended: v.boolean(), confirmName: v.string(), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, ADMIN);
    const reason = requireReason(args.reason);
    const w = await ctx.db
      .query("workspaces")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.workspaceId))
      .unique();
    if (!w || w.status === "deleting") fail("not_found", "Workspace not found.");
    if (args.confirmName.trim() !== w.name) fail("invalid_argument", "Type the workspace name to confirm.");
    const status = args.suspended ? "suspended" : "active";
    await ctx.db.patch(w._id, { status });
    await audit(ctx, admin, args.suspended ? "workspace.suspend" : "workspace.unsuspend", { type: "workspace", id: w._id }, { reason, before: { status: w.status }, after: { status }, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

export const setWorkspaceQuota = mutation({
  args: { workspaceId: v.string(), storageQuotaBytes: v.number(), memberLimit: v.number(), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, ADMIN);
    const reason = requireReason(args.reason);
    const w = await ctx.db
      .query("workspaces")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.workspaceId))
      .unique();
    if (!w) fail("not_found", "Workspace not found.");
    if (args.storageQuotaBytes < 0 || args.memberLimit < 1 || args.memberLimit > 10_000) fail("invalid_argument", "Invalid quota.");
    const before = { storageQuotaBytes: w.storageQuotaBytes, memberLimit: w.memberLimit };
    await ctx.db.patch(w._id, { storageQuotaBytes: args.storageQuotaBytes, memberLimit: args.memberLimit });
    await audit(ctx, admin, "workspace.set_quota", { type: "workspace", id: w._id }, { reason, before, after: { storageQuotaBytes: args.storageQuotaBytes, memberLimit: args.memberLimit }, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

/** Listing workspaces reveals names (user content), so like other identity reads it is an audited mutation. */
export const listWorkspaces = mutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), ...vMeta },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, STAFF);
    await audit(ctx, admin, "workspace.list", { type: "workspaces", id: args.cursor ? "page" : "first_page" }, { requestId: args.requestId, clientHash: args.clientHash });
    const page = await ctx.db.query("workspaces").withIndex("by_created").order("desc").paginate({ cursor: args.cursor ?? null, numItems: 50 });
    // Workspace names are user content but needed to identify records; no document data is exposed.
    return {
      workspaces: page.page.map((w) => ({ id: w.publicId, name: w.name, kind: w.kind, status: w.status, documentCount: w.documentCount, storageUsedBytes: w.storageUsedBytes, createdAt: w.createdAt })),
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

// ---------------------------------------------------------------- email operations

export const listEmails = mutation({
  args: { status: v.optional(v.union(v.literal("queued"), v.literal("accepted"), v.literal("failed"), v.literal("skipped"))), ...vMeta },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, ALL_ADMIN_ROLES);
    await audit(ctx, admin, "email.list", { type: "email_attempts", id: args.status ?? "all" }, { requestId: args.requestId, clientHash: args.clientHash });
    const rows = args.status
      ? await ctx.db
          .query("emailSendAttempts")
          .withIndex("by_status_created", (q) => q.eq("status", args.status!))
          .order("desc")
          .take(100)
      : await ctx.db.query("emailSendAttempts").withIndex("by_created").order("desc").take(100);
    const out = [];
    for (const r of rows) {
      // Provider delivery state appears only if a signature-verified Loops webhook reported it, and only
      // events matched to this exact send (provider id, or recipient + template + time) at receipt.
      const events = await ctx.db
        .query("emailProviderEvents")
        .withIndex("by_attempt", (q) => q.eq("attemptId", r._id))
        .take(10);
      out.push({
        id: r._id as string,
        templateKey: r.templateKey,
        category: r.category,
        recipientHint: r.recipientHint,
        status: r.status,
        attempts: r.attempts,
        httpStatus: r.httpStatus ?? null,
        errorCode: r.errorCode ?? null,
        environment: r.environment,
        requestId: r.requestId,
        createdAt: r.createdAt,
        hasProviderId: Boolean(r.providerMessageId),
        providerEvents: events.map((e) => ({ eventName: e.eventName, eventTime: e.eventTime < 1e12 ? e.eventTime * 1000 : e.eventTime })),
      });
    }
    return { attempts: out, webhooksConfigured: Boolean(process.env.LOOPS_WEBHOOK_SECRET) };
  },
});

/**
 * Safe resend. Only notices whose variables contain no one-time links or user content are replayable
 * (their payload is kept for that purpose); identity links are regenerated through the identity provider.
 */
export const resendEmail = mutation({
  args: { attemptId: v.string(), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, STAFF);
    const reason = requireReason(args.reason);
    const id = ctx.db.normalizeId("emailSendAttempts", args.attemptId);
    const attempt = id ? await ctx.db.get(id) : null;
    if (!attempt) fail("not_found", "Email not found.");
    if (attempt.category === "identity") fail("invalid_argument", "Identity emails carry one-time links. Use “Resend verification” or a user-requested password reset instead.");
    if (attempt.status !== "failed") fail("invalid_argument", "Only failed emails can be resent.");
    if (!attempt.resendPayload || !attempt.profileId) fail("invalid_argument", "This notice can't be replayed because its content isn't stored. Ask the person to repeat the action.");
    const prior = await ctx.db
      .query("emailSendAttempts")
      .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", attempt.idempotencyKey))
      .collect();
    await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
      key: attempt.templateKey,
      profileId: attempt.profileId,
      idempotencyKey: `${attempt.idempotencyKey}:resend:${prior.length}`.slice(0, 100),
      dataVariables: attempt.resendPayload as Record<string, string | number>,
      resendOf: attempt._id,
    });
    await audit(ctx, admin, "email.resend", { type: "email_attempt", id: attempt._id }, { reason, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

// ---------------------------------------------------------------- flags, maintenance, templates, rate limits

export const configuration = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformRole(ctx, ALL_ADMIN_ROLES);
    const flags = await ctx.db.query("featureFlags").take(100);
    const maintenance = await ctx.db
      .query("systemSettings")
      .withIndex("by_key", (q) => q.eq("key", "maintenance"))
      .unique();
    const limits = await ctx.db
      .query("systemSettings")
      .withIndex("by_key", (q) => q.eq("key", "rate_limits"))
      .unique();
    const templates = await ctx.db.query("builtInTemplates").take(100);
    const known = new Map(templates.map((t) => [t.key, t]));
    return {
      flags: KNOWN_FLAGS.map((f) => {
        const row = flags.find((x) => x.key === f.key);
        return { key: f.key, description: f.description, enabled: row ? row.enabled : f.default, updatedAt: row?.updatedAt ?? null };
      }),
      maintenance: (maintenance?.value as { bannerMessage?: string; readOnly?: boolean } | undefined) ?? { bannerMessage: "", readOnly: false },
      rateLimits: Object.entries(DEFAULT_RATE_RULES).map(([name, rule]) => {
        const override = (limits?.value as Record<string, { limit: number; windowMs: number }> | undefined)?.[name];
        return { name, limit: override?.limit ?? rule.limit, windowMs: override?.windowMs ?? rule.windowMs, overridden: Boolean(override) };
      }),
      templates: BUILT_IN_TEMPLATES.map((t) => ({ key: t.key, name: t.name, description: t.description, icon: t.icon, enabled: known.get(t.key)?.enabled ?? true })),
    };
  },
});

export const setFlag = mutation({
  args: { key: v.string(), enabled: v.boolean(), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, ADMIN);
    const reason = requireReason(args.reason);
    const known = knownFlag(args.key);
    if (!known) fail("invalid_argument", "Unknown flag.");
    const row = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    const before = row ? row.enabled : known.default;
    if (row) await ctx.db.patch(row._id, { enabled: args.enabled, updatedBy: admin._id, updatedAt: Date.now() });
    else await ctx.db.insert("featureFlags", { key: args.key, enabled: args.enabled, description: known.description, updatedBy: admin._id, updatedAt: Date.now() });
    await audit(ctx, admin, "flag.set", { type: "flag", id: args.key }, { reason, before: { enabled: before }, after: { enabled: args.enabled }, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

export const setMaintenance = mutation({
  args: { bannerMessage: v.string(), readOnly: v.boolean(), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, OWNER);
    const reason = requireReason(args.reason);
    const value = { bannerMessage: args.bannerMessage.trim().slice(0, 280), readOnly: args.readOnly };
    const row = await ctx.db
      .query("systemSettings")
      .withIndex("by_key", (q) => q.eq("key", "maintenance"))
      .unique();
    const before = row?.value ?? null;
    if (row) await ctx.db.patch(row._id, { value, updatedBy: admin._id, updatedAt: Date.now() });
    else await ctx.db.insert("systemSettings", { key: "maintenance", value, updatedBy: admin._id, updatedAt: Date.now() });
    await audit(ctx, admin, "maintenance.set", { type: "setting", id: "maintenance" }, { reason, before, after: value, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

export const setRateLimit = mutation({
  args: { name: v.string(), limit: v.union(v.number(), v.null()), windowMs: v.optional(v.number()), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, ADMIN);
    const reason = requireReason(args.reason);
    if (!(args.name in DEFAULT_RATE_RULES)) fail("invalid_argument", "Unknown rule.");
    const row = await ctx.db
      .query("systemSettings")
      .withIndex("by_key", (q) => q.eq("key", "rate_limits"))
      .unique();
    const current = { ...((row?.value as Record<string, { limit: number; windowMs: number }> | undefined) ?? {}) };
    const before = current[args.name] ?? null;
    if (args.limit === null) delete current[args.name];
    else {
      if (args.limit < 1 || args.limit > 100_000) fail("invalid_argument", "Limit out of range.");
      const windowMs = args.windowMs ?? DEFAULT_RATE_RULES[args.name as keyof typeof DEFAULT_RATE_RULES].windowMs;
      if (windowMs < 1000 || windowMs > 24 * 60 * 60 * 1000) fail("invalid_argument", "Window out of range.");
      current[args.name] = { limit: Math.floor(args.limit), windowMs };
    }
    if (row) await ctx.db.patch(row._id, { value: current, updatedBy: admin._id, updatedAt: Date.now() });
    else await ctx.db.insert("systemSettings", { key: "rate_limits", value: current, updatedBy: admin._id, updatedAt: Date.now() });
    await audit(ctx, admin, "rate_limit.set", { type: "rate_limit", id: args.name }, { reason, before, after: current[args.name] ?? null, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

export const setTemplateEnabled = mutation({
  args: { key: v.string(), enabled: v.boolean(), ...vRequest },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, ADMIN);
    const reason = requireReason(args.reason);
    const t = BUILT_IN_TEMPLATES.find((x) => x.key === args.key);
    if (!t) fail("invalid_argument", "Unknown template.");
    const row = await ctx.db
      .query("builtInTemplates")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (row) await ctx.db.patch(row._id, { enabled: args.enabled, updatedAt: Date.now() });
    else await ctx.db.insert("builtInTemplates", { key: t.key, name: t.name, description: t.description, icon: t.icon, enabled: args.enabled, rank: "V", updatedAt: Date.now() });
    await audit(ctx, admin, "template.set_enabled", { type: "template", id: args.key }, { reason, after: { enabled: args.enabled }, requestId: args.requestId, clientHash: args.clientHash });
    return null;
  },
});

// ---------------------------------------------------------------- audit log

export const auditLog = query({
  args: { targetType: v.optional(v.string()), targetId: v.optional(v.string()), cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const admin = await requirePlatformRole(ctx, ALL_ADMIN_ROLES);
    const base =
      args.targetType && args.targetId
        ? ctx.db.query("adminAuditLogs").withIndex("by_target", (q) => q.eq("targetType", args.targetType!).eq("targetId", args.targetId!))
        : admin.platformRole === "super_admin"
          ? ctx.db.query("adminAuditLogs").withIndex("by_created")
          : ctx.db.query("adminAuditLogs").withIndex("by_actor", (q) => q.eq("actorId", admin._id));
    const page = await base.order("desc").paginate({ cursor: args.cursor ?? null, numItems: 50 });
    const names = new Map<string, string>();
    const entries = [];
    for (const e of page.page) {
      if (admin.platformRole !== "super_admin" && e.actorId !== admin._id && !(args.targetType && args.targetId)) continue;
      if (!names.has(e.actorId)) names.set(e.actorId, (await ctx.db.get(e.actorId))?.displayName ?? "Admin");
      entries.push({
        id: e._id as string,
        actor: names.get(e.actorId)!,
        actorRole: e.actorRole,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        reason: e.reason ?? null,
        before: e.before ?? null,
        after: e.after ?? null,
        requestId: e.requestId,
        createdAt: e.createdAt,
      });
    }
    return { entries, continueCursor: page.isDone ? null : page.continueCursor };
  },
});

export const deletionJobs = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformRole(ctx, ADMIN);
    const rows = await ctx.db.query("deletionJobs").order("desc").take(100);
    return rows.map((j) => ({ id: j._id as string, kind: j.kind, status: j.status, requestedByAdmin: j.requestedByAdmin, reason: j.reason, scheduledFor: j.scheduledFor, progress: j.progress, createdAt: j.createdAt, completedAt: j.completedAt ?? null, error: j.error ?? null }));
  },
});

// ---------------------------------------------------------------- bootstrap & deployments (CLI only)

/** Run once with `npx convex run admin:bootstrapSuperAdmin '{"email":"you@example.com"}'` (requires deploy access). */
export const bootstrapSuperAdmin = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_platform_role", (q) => q.eq("platformRole", "super_admin"))
      .first();
    if (existing) throw new Error("A super admin already exists; use the admin console to grant roles.");
    const p = await ctx.db
      .query("profiles")
      .withIndex("by_email", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .unique();
    if (!p) throw new Error("No profile with that email. Sign in once first.");
    await ctx.db.patch(p._id, { platformRole: "super_admin" });
    await ctx.db.insert("adminAuditLogs", {
      actorId: p._id,
      actorRole: "super_admin",
      action: "bootstrap.super_admin",
      targetType: "profile",
      targetId: p._id,
      reason: "Initial super admin granted via deployment CLI",
      requestId: ulid(),
      createdAt: Date.now(),
    });
    return p._id as Id<"profiles">;
  },
});

export const recordDeployment = internalMutation({
  args: { environment: v.string(), commitSha: v.string(), commitMessage: v.string(), source: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("deployments", {
      environment: args.environment.slice(0, 40),
      commitSha: args.commitSha.slice(0, 40),
      commitMessage: args.commitMessage.slice(0, 200),
      source: args.source.slice(0, 40),
      createdAt: Date.now(),
    });
  },
});
