import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { localDate } from "@folevi/editor-schema";
import {
  assertIdentityClaims,
  assertWritable,
  claimsOf,
  findProfile,
  requireIdentity,
  requireProfile,
} from "./lib/auth";
import { fail } from "./lib/errors";
import { consume } from "./lib/rateLimit";
import { bump } from "./lib/metrics";
import { keyedHash } from "./lib/crypto";
import { vAppearance } from "./lib/validators";
import { seedPersonalWorkspace } from "./seed";

const DELETION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function sanitizeName(name: string): string {
  return name.replace(/[\u0000-\u001F\u007F<>]/g, "").trim().slice(0, 80);
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function publicProfile(p: Doc<"profiles">) {
  return {
    id: p._id as string,
    email: p.email,
    displayName: p.displayName,
    appearance: p.appearance,
    locale: p.locale,
    timeZone: p.timeZone,
    onboardingStep: p.onboardingStep,
    platformRole: p.platformRole ?? null,
    status: p.status,
    defaultWorkspaceId: null as string | null,
    notificationPrefs: p.notificationPrefs,
    deletionScheduledFor: p.deletionScheduledFor ?? null,
    createdAt: p.createdAt,
  };
}

/** The signed-in person's profile, or a typed state the client uses to route (sign-in, verify, set up). */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { state: "signed_out" as const };
    try {
      assertIdentityClaims(identity);
    } catch (e) {
      const code = (e as { data?: { code?: string } }).data?.code;
      return { state: (code === "mfa_required" ? "mfa_required" : "email_unverified") as "mfa_required" | "email_unverified" };
    }
    const profile = await findProfile(ctx, identity);
    if (!profile) return { state: "needs_bootstrap" as const };
    if (profile.status === "suspended") return { state: "suspended" as const };
    if (profile.status === "deleted") return { state: "signed_out" as const };
    const sid = (identity as unknown as Record<string, unknown>).sid;
    if (typeof sid === "string") {
      const key = await keyedHash(sid, "session");
      const session = await ctx.db
        .query("sessionsMirror")
        .withIndex("by_profile_key", (q) => q.eq("profileId", profile._id).eq("sessionKey", key))
        .unique();
      if (session?.revokedAt) return { state: "session_revoked" as const };
    }
    const workspace = profile.defaultWorkspaceId ? await ctx.db.get(profile.defaultWorkspaceId) : null;
    return {
      state: "ready" as const,
      profile: { ...publicProfile(profile), defaultWorkspaceId: workspace?.publicId ?? null },
    };
  },
});

/**
 * First sign-in: creates the profile and a personal workspace with seed content. Idempotent — a second
 * call returns the existing profile. Identity data comes only from the verified token.
 */
export const bootstrap = mutation({
  args: { timeZone: v.string(), locale: v.string() },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const claims = assertIdentityClaims(identity);
    const existing = await findProfile(ctx, identity);
    if (existing) return { created: false, profileId: existing._id };
    await consume(ctx, "bootstrap", identity.subject);
    const email = (identity.email ?? "").toLowerCase();
    if (!email) fail("invalid_argument", "Your account has no email address.");
    const now = Date.now();
    const displayName = sanitizeName(identity.name ?? identity.nickname ?? email.split("@")[0] ?? "Friend") || "Friend";
    const timeZone = isValidTimeZone(args.timeZone) ? args.timeZone : "UTC";
    const profileId = await ctx.db.insert("profiles", {
      tokenIdentifier: identity.tokenIdentifier,
      authSubject: identity.subject,
      authIssuer: identity.issuer,
      email,
      emailVerified: claims.emailVerified,
      mfaVerified: claims.mfa,
      displayName,
      appearance: "system",
      locale: /^[a-z]{2}(-[A-Z]{2})?$/.test(args.locale) ? args.locale : "en",
      timeZone,
      onboardingStep: "workspace",
      status: "active",
      notificationPrefs: { mentions: true, comments: true, shares: true, invites: true, digest: "off", productEmail: false },
      createdAt: now,
      lastActiveAt: now,
    });
    const profile = (await ctx.db.get(profileId))!;
    const workspaceId = await seedPersonalWorkspace(ctx, profile, localDate(now, timeZone));
    await ctx.db.patch(profileId, { defaultWorkspaceId: workspaceId });
    await bump(ctx, "users_total");
    await bump(ctx, "signups");
    if (claims.emailVerified) await bump(ctx, "users_verified");
    await linkPendingInvites(ctx, (await ctx.db.get(profileId))!);
    return { created: true, profileId };
  },
});

async function linkPendingInvites(ctx: MutationCtx, profile: Doc<"profiles">) {
  const invites = await ctx.db
    .query("workspaceInvites")
    .withIndex("by_email", (q) => q.eq("email", profile.email))
    .collect();
  for (const invite of invites) {
    if (invite.status !== "pending" || invite.expiresAt < Date.now()) continue;
    const workspace = await ctx.db.get(invite.workspaceId);
    if (!workspace) continue;
    await ctx.db.insert("notifications", {
      profileId: profile._id,
      workspaceId: invite.workspaceId,
      kind: "invite",
      actorId: invite.invitedBy,
      inviteId: invite._id,
      title: `You're invited to ${workspace.name}`,
      createdAt: Date.now(),
    });
  }
}

export const completeOnboardingStep = mutation({
  args: {
    step: v.union(v.literal("workspace"), v.literal("appearance"), v.literal("welcome")),
    workspaceName: v.optional(v.string()),
    appearance: v.optional(vAppearance),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    if (args.step === "workspace") {
      const name = sanitizeName(args.workspaceName ?? "");
      if (!name) fail("invalid_argument", "Give your workspace a name.");
      if (profile.defaultWorkspaceId) await ctx.db.patch(profile.defaultWorkspaceId, { name, updatedAt: Date.now() });
      await ctx.db.patch(profile._id, { onboardingStep: "appearance" });
    } else if (args.step === "appearance") {
      await ctx.db.patch(profile._id, { appearance: args.appearance ?? "system", onboardingStep: "welcome" });
    } else {
      await ctx.db.patch(profile._id, { onboardingStep: "done" });
    }
    return null;
  },
});

export const updateProfile = mutation({
  args: {
    displayName: v.optional(v.string()),
    appearance: v.optional(vAppearance),
    timeZone: v.optional(v.string()),
    notificationPrefs: v.optional(
      v.object({
        mentions: v.boolean(),
        comments: v.boolean(),
        shares: v.boolean(),
        invites: v.boolean(),
        digest: v.union(v.literal("off"), v.literal("daily")),
        productEmail: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const patch: Partial<Doc<"profiles">> = {};
    if (args.displayName !== undefined) {
      const name = sanitizeName(args.displayName);
      if (!name) fail("invalid_argument", "Name can't be empty.");
      patch.displayName = name;
    }
    if (args.appearance) patch.appearance = args.appearance;
    if (args.timeZone) {
      if (!isValidTimeZone(args.timeZone)) fail("invalid_argument", "Unknown time zone.");
      patch.timeZone = args.timeZone;
    }
    if (args.notificationPrefs) patch.notificationPrefs = args.notificationPrefs;
    await ctx.db.patch(profile._id, patch);
    return null;
  },
});

// ---------------------------------------------------------------- sessions (product-side mirror)

/**
 * Registers or refreshes this device/browser session. The identity provider remains authoritative for
 * authentication; this mirror powers the session list, revocation checks and new-device alerts.
 */
export const registerSession = mutation({
  args: {
    client: v.union(v.literal("web"), v.literal("mac")),
    label: v.string(),
    userAgent: v.optional(v.string()),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const profile = await requireProfile(ctx);
    const raw = identity as unknown as Record<string, unknown>;
    const sid = typeof raw.sid === "string" ? raw.sid : (args.deviceId ?? identity.subject);
    const sessionKey = await keyedHash(sid, "session");
    const now = Date.now();
    const existing = await ctx.db
      .query("sessionsMirror")
      .withIndex("by_profile_key", (q) => q.eq("profileId", profile._id).eq("sessionKey", sessionKey))
      .unique();
    await ctx.db.patch(profile._id, { lastActiveAt: now });
    if (existing) {
      if (existing.revokedAt) fail("unauthenticated", "This session was signed out.");
      if (now - existing.lastSeenAt > 5 * 60_000) await ctx.db.patch(existing._id, { lastSeenAt: now });
      return { sessionKey, isNew: false };
    }
    await consume(ctx, "deviceRegister", profile._id);
    const others = await ctx.db
      .query("sessionsMirror")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(1);
    await ctx.db.insert("sessionsMirror", {
      profileId: profile._id,
      sessionKey,
      client: args.client,
      label: sanitizeName(args.label) || (args.client === "mac" ? "Folevi for Mac" : "Web browser"),
      userAgentHash: args.userAgent ? await keyedHash(args.userAgent, "ua") : undefined,
      createdAt: now,
      lastSeenAt: now,
    });
    // Alert on a genuinely new device (not the very first sign-in).
    if (others.length > 0) {
      await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
        key: "security_new_device",
        profileId: profile._id,
        idempotencyKey: `new-device:${profile._id}:${sessionKey}`,
        dataVariables: {
          deviceLabel: sanitizeName(args.label) || (args.client === "mac" ? "Folevi for Mac" : "Web browser"),
          signedInAt: new Date(now).toUTCString(),
          securityUrl: `${process.env.FOLEVI_APP_URL ?? "https://app.folevi.com"}/settings/security`,
        },
      });
    }
    return { sessionKey, isNew: true };
  },
});

export const listSessions = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const profile = await requireProfile(ctx);
    const raw = identity as unknown as Record<string, unknown>;
    const currentKey = typeof raw.sid === "string" ? await keyedHash(raw.sid, "session") : null;
    const sessions = await ctx.db
      .query("sessionsMirror")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .order("desc")
      .take(50);
    return sessions.map((s) => ({
      id: s._id as string,
      client: s.client,
      label: s.label,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      revokedAt: s.revokedAt ?? null,
      current: s.sessionKey === currentKey,
    }));
  },
});

export const revokeSession = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const id = ctx.db.normalizeId("sessionsMirror", args.sessionId);
    const session = id ? await ctx.db.get(id) : null;
    if (!session || session.profileId !== profile._id) fail("not_found", "Session not found.");
    if (!session.revokedAt) await ctx.db.patch(session._id, { revokedAt: Date.now(), revokedReason: "user" });
    await ctx.scheduler.runAfter(0, internal.identity.revokeProviderSessions, { profileId: profile._id, scope: "one" });
    return null;
  },
});

export const revokeOtherSessions = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const profile = await requireProfile(ctx);
    const raw = identity as unknown as Record<string, unknown>;
    const currentKey = typeof raw.sid === "string" ? await keyedHash(raw.sid, "session") : null;
    const sessions = await ctx.db
      .query("sessionsMirror")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .collect();
    const now = Date.now();
    for (const s of sessions) {
      if (!s.revokedAt && s.sessionKey !== currentKey) await ctx.db.patch(s._id, { revokedAt: now, revokedReason: "user_others" });
    }
    return null;
  },
});

// ---------------------------------------------------------------- account deletion

export const requestAccountDeletion = mutation({
  args: { confirmEmail: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (args.confirmEmail.trim().toLowerCase() !== profile.email) fail("invalid_argument", "Type your email address exactly to confirm.");
    if (profile.status === "pending_deletion") return { scheduledFor: profile.deletionScheduledFor ?? Date.now() };
    const scheduledFor = Date.now() + DELETION_GRACE_MS;
    await ctx.db.patch(profile._id, { status: "pending_deletion", deletionScheduledFor: scheduledFor });
    await ctx.db.insert("deletionJobs", {
      kind: "account",
      targetId: profile._id,
      requestedBy: profile._id,
      requestedByAdmin: false,
      reason: "user_request",
      scheduledFor,
      status: "scheduled",
      progress: 0,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
      key: "account_deletion_scheduled",
      profileId: profile._id,
      idempotencyKey: `deletion-scheduled:${profile._id}:${scheduledFor}`,
      dataVariables: {
        scheduledFor: new Date(scheduledFor).toUTCString(),
        cancelUrl: `${process.env.FOLEVI_APP_URL ?? "https://app.folevi.com"}/settings/account`,
      },
    });
    return { scheduledFor };
  },
});

/** Pending-deletion accounts can still sign in to cancel (writes are otherwise blocked). */
export const cancelAccountDeletion = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    if (profile.status !== "pending_deletion") return null;
    await ctx.db.patch(profile._id, { status: "active", deletionScheduledFor: undefined });
    const jobs = await ctx.db
      .query("deletionJobs")
      .withIndex("by_target", (q) => q.eq("kind", "account").eq("targetId", profile._id))
      .collect();
    for (const job of jobs) if (job.status === "scheduled") await ctx.db.patch(job._id, { status: "canceled" });
    return null;
  },
});

// ---------------------------------------------------------------- internal helpers

export const getForEmail = internalQuery({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, { profileId }) => {
    const p = await ctx.db.get(profileId);
    if (!p) return null;
    return { email: p.email, displayName: p.displayName, status: p.status, prefs: p.notificationPrefs, authSubject: p.authSubject };
  },
});

export const touchClaims = internalMutation({
  args: { profileId: v.id("profiles"), emailVerified: v.boolean(), mfaVerified: v.boolean() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.profileId, { emailVerified: args.emailVerified, mfaVerified: args.mfaVerified });
  },
});

/** Keeps the verified/MFA mirror fresh for admin views; called opportunistically by clients. */
export const heartbeat = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const profile = await requireProfile(ctx);
    const claims = claimsOf(identity);
    const patch: Partial<Doc<"profiles">> = { lastActiveAt: Date.now() };
    if (claims.emailVerified !== profile.emailVerified) {
      patch.emailVerified = claims.emailVerified;
      if (claims.emailVerified) await bump(ctx, "users_verified");
    }
    if (claims.mfa !== profile.mfaVerified) patch.mfaVerified = claims.mfa;
    if (Date.now() - profile.lastActiveAt > 60_000 || patch.emailVerified !== undefined || patch.mfaVerified !== undefined) {
      await ctx.db.patch(profile._id, patch);
    }
    return null;
  },
});
