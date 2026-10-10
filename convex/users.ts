import { effectiveTheme } from "./lib/noteThemes";
import { applyThemeDefaults } from "./lib/themes";
import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { deviceStatus } from "./lib/devices";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { localDate } from "@folevi/editor-schema";
import {
  assertIdentityClaims,
  assertWritable,
  claimsOf,
  findProfile,
  requireActiveSession,
  requireIdentity,
  requireProfile,
  sessionIdOf,
} from "./lib/auth";
import { deleteSession, findActiveSession, listUserSessions } from "./lib/authStore";
import { fail } from "./lib/errors";
import { startTrial } from "./lib/billing";
import { personalEntitlements } from "./lib/entitlements";
import { consume } from "./lib/rateLimit";
import { bump } from "./lib/metrics";
import { keyedHash } from "./lib/crypto";
import { vAppearance, vNotificationPrefs } from "./lib/validators";
import { seedPersonal } from "./seed";
import { notifyInvite, wantsInApp } from "./lib/notify";
import { claimIdentityImage, deleteIdentityImage, identityImageUrl, workspaceLabel } from "./lib/identityImages";
import { personalScope } from "./lib/scope";
import { nextSeq } from "./lib/seq";
import { aiPrefsOf, aiPrefsPatch, vAiPrefsPatch } from "./lib/ai/prefs";
import { createDocument, specsToWireBlocks } from "./lib/create";
import { BUILT_IN_TEMPLATES } from "./lib/templates";
import { builtInTemplateEnabled } from "./lib/syncEngine";
import { WELCOME_TITLE } from "./lib/seedContent";
import { PLAIN_STYLE, USE_CASE_IDS, isOnboardingNoteStyle, laterStep, starterPagesFor, stepAfter } from "./lib/onboarding";

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
    aiEnabled: p.aiEnabled !== false,
    aiPrefs: aiPrefsOf(p),
    /** The AI's first-time introduction was dismissed (it isn't shown again anywhere). */
    locale: p.locale,
    timeZone: p.timeZone,
    onboardingStep: p.onboardingStep,
    onboardingUseCases: p.onboardingUseCases ?? [],
    platformRole: p.platformRole ?? null,
    status: p.status,
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
    } catch {
      return { state: "email_unverified" as const };
    }
    const sessionId = sessionIdOf(identity);
    if (!sessionId || !(await findActiveSession(ctx, sessionId))) return { state: "session_revoked" as const };
    const profile = await findProfile(ctx, identity);
    if (!profile) return { state: "needs_bootstrap" as const };
    if (profile.status === "suspended") return { state: "suspended" as const };
    if (profile.status === "deleted") return { state: "signed_out" as const };
    // Over the plan's device limit: this device waits until another signs out or the plan is upgraded.
    const devices = await deviceStatus(ctx, profile, sessionId);
    if (!devices.allowed) return { state: "device_limit" as const, limit: devices.limit ?? 0, active: devices.active };
    return {
      state: "ready" as const,
      profile: {
        ...publicProfile(profile),
        avatarUrl: await identityImageUrl(ctx, profile.avatarFileId),
        // What their Personal plan includes right now (AI in Personal, storage, devices, trial). The server
        // enforces it again. A team workspace's own plan is on workspaces.mine.
        entitlements: await personalEntitlements(ctx, profile._id),
      },
    };
  },
});

/**
 * First sign-in: creates the profile and seeds their Personal with example content (no workspace is
 * created: Personal is not a workspace). Idempotent: a second call returns the existing profile.
 * Identity data comes only from the verified token.
 */
export const bootstrap = mutation({
  args: { timeZone: v.string(), locale: v.string() },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const claims = assertIdentityClaims(identity);
    await requireActiveSession(ctx, identity);
    const existing = await findProfile(ctx, identity);
    if (existing) return { created: false, profileId: existing._id };
    await consume(ctx, "bootstrap", identity.subject);
    const email = (identity.email ?? "").toLowerCase();
    if (!email) fail("invalid_argument", "Your account has no email address.");
    // A profile created under an earlier identity provider (Auth0 or the old local development
    // sign-in) is re-linked to this account. Safe because the address is verified by this provider.
    const legacy = await ctx.db
      .query("profiles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (legacy && legacy.status !== "deleted" && legacy.authIssuer !== identity.issuer) {
      await ctx.db.patch(legacy._id, {
        tokenIdentifier: identity.tokenIdentifier,
        authSubject: identity.subject,
        authIssuer: identity.issuer,
        emailVerified: claims.emailVerified,
        mfaVerified: claims.mfa,
      });
      return { created: false, profileId: legacy._id };
    }
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
    await seedPersonal(ctx, profile, localDate(now, timeZone));
    // Every new account starts with a Pro AI trial.
    await startTrial(ctx, profileId);
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
    await notifyInvite(ctx, { recipient: profile, actorId: invite.invitedBy, workspaceId: invite.workspaceId, inviteId: invite._id, title: `You're invited to ${workspaceLabel(workspace)}` });
  }
  // Pages shared with this address before the account existed: a notice to accept each (nothing is
  // granted until they do).
  const pageInvites = await ctx.db
    .query("pageInvites")
    .withIndex("by_email", (q) => q.eq("email", profile.email))
    .take(100);
  for (const invite of pageInvites) {
    if (invite.status !== "pending" || invite.expiresAt < Date.now()) continue;
    const doc = await ctx.db.get(invite.documentId);
    if (!doc || doc.inTrash || !wantsInApp(profile.notificationPrefs, "share")) continue;
    const inviter = await ctx.db.get(invite.invitedBy);
    await ctx.db.insert("notifications", {
      profileId: profile._id,
      kind: "share",
      actorId: invite.invitedBy,
      pageInviteId: invite._id,
      title: `${inviter?.displayName ?? "Someone"} shared “${(doc.title || "Untitled").slice(0, 100)}” with you`.slice(0, 200),
      createdAt: Date.now(),
    });
  }
}

/**
 * Completes one onboarding step and moves to the next (never back: see laterStep). Each step can carry
 * its choice, applied here after validation:
 *   uses:       `useCases` (USE_CASES ids) adds each one's starter pages from built-in templates, once
 *   style:      `noteStyle` ("plain" or an ONBOARDING_NOTE_STYLES art id) gives their Welcome page that theme
 *   appearance: `appearance`
 *   ai:         `aiEnabled` turns the AI Assistant on or off
 * Older clients (the archived Swift Mac app) send "workspace" (with an ignored `workspaceName`), "appearance" and
 * "welcome" only; those keep working.
 */
export const completeOnboardingStep = mutation({
  args: {
    step: v.union(v.literal("workspace"), v.literal("uses"), v.literal("style"), v.literal("appearance"), v.literal("ai"), v.literal("welcome")),
    workspaceName: v.optional(v.string()),
    appearance: v.optional(vAppearance),
    useCases: v.optional(v.array(v.string())),
    noteStyle: v.optional(v.string()),
    aiEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    // A choice belongs to its own step; anything else is a client error.
    if (args.useCases !== undefined && args.step !== "uses") fail("invalid_argument", "Use cases belong to the uses step.");
    if (args.noteStyle !== undefined && args.step !== "style") fail("invalid_argument", "A note theme belongs to the style step.");
    if (args.aiEnabled !== undefined && args.step !== "ai") fail("invalid_argument", "The AI setting belongs to the ai step.");
    if (args.appearance !== undefined && args.step !== "appearance") fail("invalid_argument", "Appearance belongs to the appearance step.");

    const patch: Partial<Doc<"profiles">> = {};
    if (args.step === "uses" && args.useCases !== undefined) {
      const ids = args.useCases;
      if (ids.length > USE_CASE_IDS.length) fail("invalid_argument", "Too many use cases.");
      for (const id of ids) if (!USE_CASE_IDS.includes(id)) fail("invalid_argument", "Unknown use case.");
      const applied = profile.onboardingUseCases ?? [];
      const fresh = [...new Set(ids)].filter((id) => !applied.includes(id));
      if (fresh.length) {
        await addStarterPages(ctx, profile, applied, fresh);
        patch.onboardingUseCases = [...applied, ...fresh];
      }
    }
    if (args.step === "style" && args.noteStyle !== undefined) {
      if (!isOnboardingNoteStyle(args.noteStyle)) fail("invalid_argument", "Unknown note theme.");
      await styleWelcomePage(ctx, profile, args.noteStyle);
    }
    // Personal needs no name; `workspaceName` is accepted from older clients and ignored.
    if (args.appearance) patch.appearance = args.appearance;
    if (args.aiEnabled !== undefined) patch.aiEnabled = args.aiEnabled;
    patch.onboardingStep = laterStep(profile.onboardingStep, stepAfter(args.step));
    await ctx.db.patch(profile._id, patch);
    return null;
  },
});

/**
 * Adds the starter pages of `fresh` use cases to the person's Personal: one page per built-in template,
 * skipping templates an earlier choice (`applied`) already added and templates an admin switched off.
 * New pages start Plain, like every new note.
 */
async function addStarterPages(ctx: MutationCtx, profile: Doc<"profiles">, applied: string[], fresh: string[]) {
  const done = new Set(starterPagesFor(applied).map((p) => p.template));
  for (const page of starterPagesFor(fresh)) {
    if (done.has(page.template)) continue;
    done.add(page.template);
    const template = BUILT_IN_TEMPLATES.find((t) => t.key === page.template);
    if (!template || !(await builtInTemplateEnabled(ctx, template.key))) continue;
    await createDocument(ctx, {
      scope: personalScope(profile._id),
      actor: profile,
      title: template.name,
      templateKey: `builtin:${template.key}`,
      blocks: specsToWireBlocks(template.blocks()),
    });
  }
}

/** Gives the person's own "Welcome to Folevi" page (from their seed content) a note theme, if it's still there. */
async function styleWelcomePage(ctx: MutationCtx, profile: Doc<"profiles">, noteStyle: string) {
  const candidates = await ctx.db
    .query("documents")
    .withIndex("by_owner_trash_title", (q) => q.eq("ownerProfileId", profile._id).eq("inTrash", false).eq("title", WELCOME_TITLE))
    .take(20);
  const doc = candidates.find((d) => d.kind === "document" && d.createdBy === profile._id && !d.deletedAt);
  if (!doc) return;
  const cover: Doc<"documents">["cover"] = noteStyle === PLAIN_STYLE ? { kind: "none" } : { kind: "art", value: noteStyle };
  if (doc.cover.kind === cover.kind && doc.cover.value === cover.value) return;
  // The backdrop follows the theme, and the page takes the theme's colours, separator and font type (as
  // when a theme is picked in the page tools).
  const theme = cover.kind === "art" ? await effectiveTheme(ctx, cover.value!) : null;
  const style = theme ? applyThemeDefaults({ ...doc.style }, theme.defaults) : { ...doc.style };
  delete style.backdrop;
  const revision = doc.revision + 1;
  await ctx.db.patch(doc._id, {
    cover,
    style,
    revision,
    seq: await nextSeq(ctx, personalScope(profile._id)),
    updatedAt: Date.now(),
    lastEditedBy: profile._id,
  });
}

export const updateProfile = mutation({
  args: {
    displayName: v.optional(v.string()),
    appearance: v.optional(vAppearance),
    aiEnabled: v.optional(v.boolean()),
    /** Settings > AI (lib/ai/prefs.ts): only the settings given change. */
    aiPrefs: v.optional(vAiPrefsPatch),
    timeZone: v.optional(v.string()),
    notificationPrefs: v.optional(vNotificationPrefs),
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
    if (args.aiEnabled !== undefined) patch.aiEnabled = args.aiEnabled;
    if (args.aiPrefs) Object.assign(patch, aiPrefsPatch(args.aiPrefs));
    if (args.timeZone) {
      if (!isValidTimeZone(args.timeZone)) fail("invalid_argument", "Unknown time zone.");
      patch.timeZone = args.timeZone;
    }
    if (args.notificationPrefs) patch.notificationPrefs = args.notificationPrefs;
    await ctx.db.patch(profile._id, patch);
    return null;
  },
});


/**
 * Sets your profile picture to an image just uploaded with `files.generateUploadUrl` (kind "avatar"),
 * which stores it as a Personal file (counted in your personal storage). The previous picture is deleted.
 */
export const setAvatar = mutation({
  args: { fileId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const file = await claimIdentityImage(ctx, profile, args.fileId, "avatar", personalScope(profile._id));
    const previous = profile.avatarFileId;
    await ctx.db.patch(profile._id, { avatarFileId: file._id });
    if (previous && previous !== file._id) await deleteIdentityImage(ctx, previous);
    return null;
  },
});

export const removeAvatar = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    if (!profile.avatarFileId) return null;
    const previous = profile.avatarFileId;
    await ctx.db.patch(profile._id, { avatarFileId: undefined });
    await deleteIdentityImage(ctx, previous);
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
    const sid = sessionIdOf(identity)!;
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
      authSessionId: sid,
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

/** Live sessions of the signed-in person (from the identity store), with device labels where known. */
export const listSessions = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const profile = await requireProfile(ctx, { allowOverDeviceLimit: true });
    const current = sessionIdOf(identity);
    const sessions = await listUserSessions(ctx, profile.authSubject);
    const mirrors = await ctx.db
      .query("sessionsMirror")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .order("desc")
      .take(100);
    const byAuthId = new Map(mirrors.filter((m) => m.authSessionId).map((m) => [m.authSessionId!, m]));
    return sessions
      .map((s) => {
        const mirror = byAuthId.get(s._id);
        return {
          id: s._id,
          client: mirror?.client ?? ("web" as const),
          label: mirror?.label ?? browserLabel(s.userAgent ?? ""),
          createdAt: s.createdAt,
          lastSeenAt: Math.max(mirror?.lastSeenAt ?? 0, s.updatedAt),
          expiresAt: s.expiresAt,
          revokedAt: null as number | null,
          current: s._id === current,
        };
      })
      .sort((x, y) => Number(y.current) - Number(x.current) || y.lastSeenAt - x.lastSeenAt);
  },
});

/** Ends one of the signed-in person's sessions. It stops working on its very next request. */
export const revokeSession = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx, { allowOverDeviceLimit: true });
    const session = await findActiveSession(ctx, args.sessionId);
    if (!session || session.userId !== profile.authSubject) fail("not_found", "Session not found.");
    await deleteSession(ctx, session._id);
    await markMirrorRevoked(ctx, profile._id, [session._id], "user");
    return null;
  },
});

/** Ends every session except this one (also forgets nothing else; trusted devices re-ask for a code). */
export const revokeOtherSessions = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const profile = await requireProfile(ctx, { allowOverDeviceLimit: true });
    const current = sessionIdOf(identity);
    const sessions = await listUserSessions(ctx, profile.authSubject);
    const ended: string[] = [];
    for (const s of sessions) {
      if (s._id === current) continue;
      await deleteSession(ctx, s._id);
      ended.push(s._id);
    }
    await markMirrorRevoked(ctx, profile._id, ended, "user_others");
    return { ended: ended.length };
  },
});

async function markMirrorRevoked(ctx: MutationCtx, profileId: Doc<"profiles">["_id"], authSessionIds: string[], reason: string) {
  if (!authSessionIds.length) return;
  const ids = new Set(authSessionIds);
  const mirrors = await ctx.db
    .query("sessionsMirror")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .take(200);
  const now = Date.now();
  for (const m of mirrors) if (m.authSessionId && ids.has(m.authSessionId) && !m.revokedAt) await ctx.db.patch(m._id, { revokedAt: now, revokedReason: reason });
}

/** "Chrome on macOS"-style label from a user agent, for sessions created before a device registered. */
function browserLabel(ua: string): string {
  // Native apps name themselves (lib/nativeAuth.ts): "Folevi for Mac (Studio iMac)".
  const app = /^(Folevi for \w+)/.exec(ua);
  if (app) return app[1]!;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Web browser";
  // Phones and tablets first: iOS user agents also say "like Mac OS X".
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

// ---------------------------------------------------------------- account deletion

/**
 * Team workspaces `profileId` owns that still have other members (and aren't already being deleted).
 * Deleting the account needs each of them handed on or deleted first; owned workspaces with nobody else
 * in them are deleted with the account.
 */
export async function ownedWorkspacesWithMembers(ctx: QueryCtx, profileId: Id<"profiles">): Promise<{ id: string; name: string; otherMembers: number }[]> {
  const owned = await ctx.db
    .query("workspaces")
    .withIndex("by_owner", (q) => q.eq("ownerId", profileId))
    .collect();
  const out = [];
  for (const w of owned) {
    if (w.status === "deleting" || w.deletionScheduledFor !== undefined) continue;
    const members = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", w._id))
      .collect();
    const others = members.filter((m) => m.profileId !== profileId).length;
    if (others > 0) out.push({ id: w.publicId, name: w.name, otherMembers: others });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** What stands in the way of deleting your account (Settings → Security shows it before you confirm). */
export const deletionBlockers = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    return { workspaces: await ownedWorkspacesWithMembers(ctx, profile._id) };
  },
});

export const requestAccountDeletion = mutation({
  args: { confirmEmail: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (args.confirmEmail.trim().toLowerCase() !== profile.email) fail("invalid_argument", "Type your email address exactly to confirm.");
    if (profile.status === "pending_deletion") return { scheduledFor: profile.deletionScheduledFor ?? Date.now() };
    // Other people's work is never deleted with your account: hand those workspaces on (or delete them) first.
    const blockers = await ownedWorkspacesWithMembers(ctx, profile._id);
    if (blockers.length) {
      const names = blockers.map((b) => `“${b.name}”`).join(", ");
      fail("forbidden", `You own ${blockers.length === 1 ? "a workspace" : "workspaces"} other people use: ${names}. Transfer ownership to another member or delete ${blockers.length === 1 ? "it" : "them"} first.`);
    }
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
