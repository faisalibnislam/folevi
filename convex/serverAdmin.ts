// Folevi Server's admin panel backend (docs/self-hosting/CONTRACT.md §7): settings, people, roles, invites,
// quotas. Owner and Admin only; everyone else gets `not_found`, as convex/admin.ts does. Every change is
// written to the audit log (lib/audit.ts). Metadata, never content: nothing here reads a note.
import { v } from "convex/values";
import { action, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { recordAudit } from "./lib/audit";
import { requireIdentity } from "./lib/auth";
import { randomToken } from "./lib/crypto";
import { fail } from "./lib/errors";
import { appUrl } from "./lib/notify";
import { consume } from "./lib/rateLimit";
import { seatsChanged } from "./lib/seats";
import { INVITE_DAYS, INVITE_TTL_MS, inviteState, inviteTokenHash, requireServerAdmin, serverOwner } from "./lib/serverAccess";
import {
  applySettingsPatch,
  changedFields,
  emailConfigured,
  publicSettingsView,
  quotaFor,
  readServerSettings,
  roleFields,
  serverRoleOf,
  SettingsError,
  storageUsedBy,
  vInvitableRole,
  vSettingsPatch,
  writeServerSettings,
  type ServerRole,
} from "./lib/serverSettings";

const ROLE_LABEL: Record<ServerRole, string> = { owner: "Owner", admin: "Admin", member: "Member", guest: "Guest" };

async function audit(ctx: MutationCtx, actor: Doc<"profiles">, action: string, targetType: string, targetId: string, extra: { before?: unknown; after?: unknown } = {}) {
  await recordAudit(ctx, actor, { action, targetType, targetId, ...extra });
}

/** Someone on this server an admin acts on (never a deleted account). */
async function person(ctx: MutationCtx, raw: string): Promise<Doc<"profiles">> {
  const id = ctx.db.normalizeId("profiles", raw);
  const p = id ? await ctx.db.get(id) : null;
  if (!p || p.status === "deleted") fail("not_found", "That person isn't on this server.");
  return p;
}

/**
 * Whether `actor` may act on `target`: never on themselves, never on the owner, and only the owner acts on
 * another admin.
 */
function assertCanManage(actor: { profile: Doc<"profiles">; role: ServerRole }, target: Doc<"profiles">, what: string) {
  if (target._id === actor.profile._id) fail("forbidden", `You can't ${what} yourself.`);
  const targetRole = serverRoleOf(target);
  if (targetRole === "owner") fail("forbidden", `The owner can't be changed this way. Transfer ownership first.`);
  if (targetRole === "admin" && actor.role !== "owner") fail("forbidden", "Only the owner can manage admins.");
}

/** Ends every session the person has (devices and browsers), as the cloud console's "Revoke all sessions" does. */
async function endAllSessions(ctx: MutationCtx, p: Doc<"profiles">, reason: string): Promise<number> {
  const sessions = await ctx.db
    .query("sessionsMirror")
    .withIndex("by_profile", (q) => q.eq("profileId", p._id))
    .collect();
  let n = 0;
  for (const s of sessions) {
    if (!s.revokedAt) {
      await ctx.db.patch(s._id, { revokedAt: Date.now(), revokedReason: reason });
      n++;
    }
  }
  await ctx.scheduler.runAfter(0, internal.identity.revokeProviderSessions, { profileId: p._id, scope: "all" });
  return n;
}

// ---------------------------------------------------------------- settings

export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    await requireServerAdmin(ctx);
    return publicSettingsView(await readServerSettings(ctx));
  },
});

/** Settings sections only the owner changes (the rest are for the owner and admins). */
const OWNER_ONLY_SETTINGS = ["email", "emailIn", "ai", "google", "covers"] as const;

/** A partial of the settings (CONTRACT §8). Secrets are write-only: a string sets one, null clears it. Audited (field names only). */
export const updateSettings = mutation({
  args: { patch: vSettingsPatch },
  handler: async (ctx, args) => {
    const admin = await requireServerAdmin(ctx);
    // Where mail goes, where notes are sent for AI and which keys the server holds are the owner's alone:
    // an admin who could point mail at their own server would read the owner's password-reset link.
    const ownerOnly = OWNER_ONLY_SETTINGS.filter((section) => args.patch[section] !== undefined);
    if (ownerOnly.length > 0 && admin.role !== "owner") fail("forbidden", "Only the owner can change the email, AI, Google sign-in and cover photo settings.");
    const current = await readServerSettings(ctx);
    let next;
    try {
      next = applySettingsPatch(current, args.patch, Date.now(), admin.profile._id);
    } catch (e) {
      if (e instanceof SettingsError) fail("invalid_argument", e.message);
      throw e;
    }
    await writeServerSettings(ctx, next);
    await audit(ctx, admin.profile, "server.update_settings", "server", "settings", { after: { fields: changedFields(args.patch) } });
    return publicSettingsView(next);
  },
});

// ---------------------------------------------------------------- people

export const listPeople = query({
  args: {},
  handler: async (ctx) => {
    await requireServerAdmin(ctx);
    const settings = await readServerSettings(ctx);
    const profiles = await ctx.db.query("profiles").withIndex("by_created").take(2000);
    const out = [];
    for (const p of profiles) {
      if (p.status === "deleted") continue;
      const quota = quotaFor(p, settings);
      out.push({
        userId: p._id as string,
        name: p.displayName,
        email: p.email,
        role: serverRoleOf(p),
        suspended: p.status === "suspended",
        storageBytes: await storageUsedBy(ctx, p),
        ...(quota !== undefined ? { quotaBytes: quota } : {}),
        lastActiveAt: p.lastActiveAt,
        twoFactor: p.mfaVerified,
      });
    }
    return out;
  },
});

/** Counts for the Overview section. Metadata only: how many people, how much is stored, recent activity. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireServerAdmin(ctx);
    const profiles = (await ctx.db.query("profiles").withIndex("by_created").take(2000)).filter((p) => p.status !== "deleted");
    const workspaces = await ctx.db.query("workspaces").take(2000);
    const storageBytes = profiles.reduce((n, p) => n + (p.personalStorageUsedBytes ?? 0), 0) + workspaces.reduce((n, w) => n + w.storageUsedBytes, 0);
    const docs = await ctx.db
      .query("metrics")
      .withIndex("by_key", (q) => q.eq("key", "documents_total"))
      .first();
    const recent = [...profiles].sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, 10);
    return {
      people: profiles.length,
      storageBytes,
      notes: docs?.value ?? 0,
      lastSignIns: recent.map((p) => ({ userId: p._id as string, name: p.displayName, at: p.lastActiveAt })),
    };
  },
});

/** Changes someone's role (admin, member or guest). Only the owner makes or unmakes admins; there is always exactly one owner. */
export const setRole = mutation({
  args: { userId: v.string(), role: vInvitableRole },
  handler: async (ctx, args) => {
    const admin = await requireServerAdmin(ctx);
    const p = await person(ctx, args.userId);
    assertCanManage(admin, p, "change the role of");
    if (args.role === "admin" && admin.role !== "owner") fail("forbidden", "Only the owner can make admins.");
    const before = serverRoleOf(p);
    await ctx.db.patch(p._id, roleFields(args.role));
    await audit(ctx, admin.profile, "server.set_role", "profile", p._id, { before: { role: before }, after: { role: args.role } });
    return null;
  },
});

/** Makes another person the owner; the current owner becomes an admin. Owner only. */
export const transferOwnership = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const owner = await requireServerAdmin(ctx, ["owner"]);
    const p = await person(ctx, args.userId);
    if (p._id === owner.profile._id) fail("invalid_argument", "You're already the owner.");
    if (p.status !== "active") fail("forbidden", "Only an active account can own the server.");
    if (serverRoleOf(p) === "guest") fail("forbidden", "Make this person a member first.");
    await ctx.db.patch(p._id, roleFields("owner"));
    await ctx.db.patch(owner.profile._id, roleFields("admin"));
    const settings = await readServerSettings(ctx);
    await writeServerSettings(ctx, { ...settings, ownerUserId: p._id, updatedAt: Date.now(), updatedBy: owner.profile._id });
    await audit(ctx, owner.profile, "server.transfer_ownership", "profile", p._id, { before: { owner: owner.profile._id }, after: { owner: p._id } });
    return null;
  },
});

async function setSuspended(ctx: MutationCtx, userId: string, suspend: boolean) {
  const admin = await requireServerAdmin(ctx);
  const p = await person(ctx, userId);
  assertCanManage(admin, p, suspend ? "suspend" : "unsuspend");
  const before = { status: p.status };
  const status = suspend ? "suspended" : "active";
  if (p.status === status) return null;
  if (!suspend && p.status !== "suspended") fail("invalid_argument", "This account isn't suspended.");
  await ctx.db.patch(p._id, { status, suspendedReason: suspend ? "Suspended by a server admin" : undefined });
  if (suspend) await endAllSessions(ctx, p, "admin_suspend");
  const memberships = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_profile", (q) => q.eq("profileId", p._id))
    .collect();
  for (const m of memberships) await seatsChanged(ctx, m.workspaceId);
  await ctx.scheduler.runAfter(0, internal.identity.setProviderBlocked, { profileId: p._id, blocked: suspend });
  await audit(ctx, admin.profile, suspend ? "server.suspend" : "server.unsuspend", "profile", p._id, { before, after: { status } });
  return null;
}

/** Signs the person out everywhere and refuses every request from them until unsuspended. Their notes are kept. */
export const suspend = mutation({ args: { userId: v.string() }, handler: async (ctx, args) => await setSuspended(ctx, args.userId, true) });
export const unsuspend = mutation({ args: { userId: v.string() }, handler: async (ctx, args) => await setSuspended(ctx, args.userId, false) });

/**
 * Removes a person from the server: they are signed out and blocked at once, and their account and Personal are
 * deleted by the deletion job (workspaces other people use pass to another member, as in the cloud).
 */
export const removePerson = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireServerAdmin(ctx);
    const p = await person(ctx, args.userId);
    assertCanManage(admin, p, "remove");
    const now = Date.now();
    // Suspended, so the person can't sign in and cancel the deletion the way someone deleting their own account can.
    await ctx.db.patch(p._id, { status: "suspended", suspendedReason: "Removed by a server admin", deletionScheduledFor: now, ...roleFields("member") });
    await endAllSessions(ctx, p, "admin_remove");
    await ctx.db.insert("deletionJobs", { kind: "account", targetId: p._id, requestedBy: admin.profile._id, requestedByAdmin: true, reason: "Removed from the server", scheduledFor: now, status: "scheduled", progress: 0, createdAt: now });
    await ctx.scheduler.runAfter(0, internal.identity.setProviderBlocked, { profileId: p._id, blocked: true });
    await audit(ctx, admin.profile, "server.remove_person", "profile", p._id, { before: { status: p.status, role: serverRoleOf(p) }, after: { scheduledFor: now } });
    return null;
  },
});

/** Signs the person out of every device and browser. */
export const endSessions = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireServerAdmin(ctx);
    const p = await person(ctx, args.userId);
    if (p._id !== admin.profile._id) assertCanManage(admin, p, "sign out");
    const ended = await endAllSessions(ctx, p, "admin");
    await audit(ctx, admin.profile, "server.end_sessions", "profile", p._id, { after: { ended } });
    return { ended };
  },
});

/** How long an admin's reset link works. */
const RESET_LINK_MS = 60 * 60 * 1000;

/**
 * A password reset. With email on, the link is emailed to the person (the admin never sees it) and `link` is
 * null. With email off there is no other way to reach them, so a one-time link (1 hour) is returned for the admin
 * to hand over in person.
 */
export const resetPassword = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireServerAdmin(ctx);
    const p = await person(ctx, args.userId);
    assertCanManage(admin, p, "reset the password of");
    const settings = await readServerSettings(ctx);
    if (emailConfigured(settings)) {
      await ctx.scheduler.runAfter(0, internal.identity.startPasswordReset, { profileId: p._id });
      await audit(ctx, admin.profile, "server.reset_password", "profile", p._id, { after: { delivery: "email" } });
      return { emailed: true, link: null as string | null, expiresAt: null as number | null };
    }
    if (!p.authSubject) fail("invalid_argument", "This account has no password to reset.");
    // The same record Better Auth's own reset makes (`reset-password:<token>`, valued with the user id), so its
    // reset page and endpoint take it as they take an emailed one.
    const token = randomToken(24);
    const now = Date.now();
    const expiresAt = now + RESET_LINK_MS;
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: { model: "verification", data: { identifier: `reset-password:${token}`, value: p.authSubject, expiresAt, createdAt: now, updatedAt: now } },
    });
    await audit(ctx, admin.profile, "server.reset_password", "profile", p._id, { after: { delivery: "link", expiresAt } });
    return { emailed: false, link: `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`, expiresAt };
  },
});

/** A person's own storage quota in bytes, or null for the server's default. */
export const setQuota = mutation({
  args: { userId: v.string(), quotaBytes: v.union(v.number(), v.null()) },
  handler: async (ctx, args) => {
    const admin = await requireServerAdmin(ctx);
    const p = await person(ctx, args.userId);
    // An admin sets members' quotas and their own; the owner's and other admins' are the owner's to set.
    if (p._id !== admin.profile._id) assertCanManage(admin, p, "change the storage of");
    if (args.quotaBytes !== null && (!Number.isFinite(args.quotaBytes) || args.quotaBytes < 0)) fail("invalid_argument", "A storage quota can't be negative.");
    const before = { quotaBytes: p.serverQuotaBytes ?? null };
    await ctx.db.patch(p._id, { serverQuotaBytes: args.quotaBytes === null ? undefined : Math.floor(args.quotaBytes) });
    await audit(ctx, admin.profile, "server.set_quota", "profile", p._id, { before, after: { quotaBytes: args.quotaBytes } });
    return null;
  },
});

// ---------------------------------------------------------------- invitations

/**
 * An invitation link (7 days). Emailed when an address is given and email is on; otherwise the admin shares the
 * link (or its QR code). Only the owner invites admins. Only the token's hash is stored.
 */
export const invite = mutation({
  args: { email: v.optional(v.string()), role: vInvitableRole },
  handler: async (ctx, args) => {
    const admin = await requireServerAdmin(ctx);
    if (args.role === "admin" && admin.role !== "owner") fail("forbidden", "Only the owner can invite admins.");
    await consume(ctx, "invite", admin.profile._id);
    const email = args.email?.trim().toLowerCase() || undefined;
    if (email && (email.length > 320 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))) fail("invalid_argument", "Enter a valid email address.");
    const token = randomToken(32);
    const now = Date.now();
    const expiresAt = now + INVITE_TTL_MS;
    const inviteId = await ctx.db.insert("serverInvites", { tokenHash: await inviteTokenHash(token), email, role: args.role, invitedBy: admin.profile._id, createdAt: now, expiresAt });
    const url = `${appUrl()}/join/${token}`;
    const settings = await readServerSettings(ctx);
    let emailed = false;
    if (email && emailConfigured(settings)) {
      await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
        key: "workspace_invite",
        to: email,
        idempotencyKey: `server-invite:${inviteId}`,
        dataVariables: { inviterName: admin.profile.displayName.slice(0, 80), workspaceName: settings.name.slice(0, 80), role: ROLE_LABEL[args.role], acceptUrl: url, expiresInDays: INVITE_DAYS, preferencesUrl: `${appUrl()}/settings/notifications` },
      });
      emailed = true;
    }
    await audit(ctx, admin.profile, "server.invite", "serverInvite", inviteId, { after: { role: args.role, email: Boolean(email), emailed } });
    return { token, url, expiresAt, inviteId: inviteId as string, emailed };
  },
});

export const listInvites = query({
  args: {},
  handler: async (ctx) => {
    await requireServerAdmin(ctx);
    const rows = await ctx.db.query("serverInvites").withIndex("by_created").order("desc").take(200);
    const names = new Map<string, string>();
    const out = [];
    for (const r of rows) {
      if (!names.has(r.invitedBy)) names.set(r.invitedBy, (await ctx.db.get(r.invitedBy))?.displayName ?? "Admin");
      out.push({
        inviteId: r._id as string,
        ...(r.email ? { email: r.email } : {}),
        role: r.role,
        invitedBy: names.get(r.invitedBy)!,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        state: inviteState(r),
        ...(r.acceptedBy ? { acceptedBy: r.acceptedBy as string } : {}),
      });
    }
    return out;
  },
});

export const revokeInvite = mutation({
  args: { inviteId: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireServerAdmin(ctx);
    const id = ctx.db.normalizeId("serverInvites", args.inviteId);
    const row = id ? await ctx.db.get(id) : null;
    if (!row) fail("not_found", "That invitation doesn't exist.");
    if (row.role === "admin" && admin.role !== "owner") fail("forbidden", "Only the owner can revoke an admin's invitation.");
    if (!row.revokedAt) await ctx.db.patch(row._id, { revokedAt: Date.now() });
    await audit(ctx, admin.profile, "server.revoke_invite", "serverInvite", row._id);
    return null;
  },
});

// ---------------------------------------------------------------- email test

/** Whether the caller is the owner or an admin (for actions, which can't read the database themselves). */
export const adminCheck = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { profile } = await requireServerAdmin(ctx);
    return { profileId: profile._id, owner: (await serverOwner(ctx))?._id === profile._id };
  },
});

/** Sends a short test message through the server's email settings and says whether it went. */
export const testEmail = action({
  args: { to: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    await requireIdentity(ctx);
    await ctx.runQuery(internal.serverAdmin.adminCheck, {});
    try {
      return await ctx.runAction(internal.email.sendServerTest, { to: args.to });
    } catch (e) {
      // A send that blew up (the mail server unreachable, a timeout) is still an answer for the admin, not a crash.
      console.warn(JSON.stringify({ event: "email.server_test", outcome: "threw", error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }));
      return { ok: false, error: "Folevi couldn't reach the mail server. Check the sending server and port, and that this machine is connected to the internet." };
    }
  },
});
