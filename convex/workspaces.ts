import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ulid } from "@folevi/editor-schema";
import {
  accessAtLeast,
  assertWritable,
  isScheduledForDeletion,
  membership,
  memberLevel,
  normalizeMembership,
  requestedRole,
  requireProfile,
  requireWorkspace,
  roleToAccess,
  type MemberAccess,
  type ShareRole,
} from "./lib/auth";
import { fail } from "./lib/errors";
import { consume } from "./lib/rateLimit";
import { randomToken, sha256Hex } from "./lib/crypto";
import { vInviteRole, vMemberAccess, vShareRole } from "./lib/validators";
import { createWorkspace } from "./seed";
import { claimIdentityImage, deleteIdentityImage, workspaceLabel, workspaceLogoUrl } from "./lib/identityImages";
import { isFeatureEnabled } from "./lib/flags";
import { aiAccessIn, storageUsage, workspaceEntitlements } from "./lib/entitlements";
import { insertScoped, workspaceScope } from "./lib/scope";
import { PLAN_CATALOG, WORKSPACE_PLANS, planName, type WorkspaceTier } from "./lib/plans";
import { canInviteMember, canManageMember, canManageWorkspace, memberCanManageBilling, requireWorkspaceManager } from "./lib/permissions";
import { billableSeatCount, seatsChanged, seatSummary } from "./lib/seats";
import { notifyAccessChange, notifyInvite, workspaceRoleLabel } from "./lib/notify";
import { workspaceClosing } from "./workspaceBilling";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** How long a workspace the owner deleted can still be restored (like accounts). */
export const WORKSPACE_DELETION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i;
const appUrl = () => process.env.FOLEVI_APP_URL ?? "https://app.folevi.com";

/**
 * The team workspaces you're a member of, with your role and each workspace's own plan and limits.
 * Personal is not listed here: it isn't a workspace (its plan and storage are on users.me / billing).
 * A workspace scheduled for deletion is listed only for its owner (who can cancel it).
 */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .collect();
    const out = [];
    for (const m of memberships) {
      const w = await ctx.db.get(m.workspaceId);
      if (!w || w.status === "deleting") continue;
      const { role, memberAccess } = normalizeMembership(m);
      const deleting = isScheduledForDeletion(w);
      if (deleting && role !== "owner") continue;
      const scope = workspaceScope(w._id);
      const storage = await storageUsage(ctx, scope);
      const plan = (await workspaceEntitlements(ctx, w)).planId;
      const tier = PLAN_CATALOG[plan].tier as WorkspaceTier;
      const level = memberLevel(m);
      out.push({
        id: w.publicId,
        name: w.name,
        icon: w.icon ?? null,
        logoUrl: await workspaceLogoUrl(ctx, w),
        /** owner | admin | member. */
        role,
        /** A member's access: edit (full), comment or view only. Owners and admins: edit. */
        memberAccess,
        /** Whether you can add and change pages, folders and tags here (the server checks again). */
        canEdit: level !== "view" && level !== "comment" && !deleting,
        /** Owner or admin: settings, members, guests, export (the server checks again). */
        canManage: canManageWorkspace(m),
        status: w.status,
        /** Set when the owner asked to delete it: read-only until then, and gone after. */
        deletionScheduledFor: w.deletionScheduledFor ?? null,
        storageUsedBytes: storage.usedBytes,
        /** The storage limit that applies here (the workspace's plan, or an admin override). */
        storageQuotaBytes: storage.limitBytes,
        plan: { scope: "workspace" as const, id: plan, name: planName(plan), tier, shortName: WORKSPACE_PLANS[tier].name },
        /** Whether you may see and change this workspace's plan and billing (the server checks again). */
        canManageBilling: memberCanManageBilling(m) && !deleting,
        /** Whether you can use the AI Assistant here (the server checks again on every request). */
        aiIncluded: (await aiAccessIn(ctx, profile, scope)).allowed,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * The workspace's members. Every member sees the list (names, emails, roles); invitations, seats and the
 * guest count are for owners and admins.
 */
export const members = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { workspace, member } = await requireWorkspace(ctx, profile, args.workspaceId);
    const manager = canManageWorkspace(member);
    const rows = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const out = [];
    for (const r of rows) {
      const p = await ctx.db.get(r.profileId);
      if (!p || p.status === "deleted") continue;
      const n = normalizeMembership(r);
      const isYou = p._id === profile._id;
      out.push({
        profileId: p._id as string,
        displayName: p.displayName,
        email: p.email,
        role: n.role,
        memberAccess: n.memberAccess,
        canManageBilling: memberCanManageBilling(r),
        joinedAt: r.joinedAt,
        isYou,
        /** Whether you may change or remove them (owners: anyone but themselves; admins: members). */
        canManage: !isYou && canManageMember(member, r),
      });
    }
    const invites = manager
      ? (
          await ctx.db
            .query("workspaceInvites")
            .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
            .collect()
        )
          .filter((i) => i.status === "pending")
          .map((i) => {
            const n = normalizeMembership(i);
            return { id: i.publicId, email: i.email, role: n.role, memberAccess: n.memberAccess, expiresAt: i.expiresAt, expired: i.expiresAt < Date.now() };
          })
      : [];
    // Seats and the price of one more, and how many guests there are, for the people who invite.
    let seats = null;
    let guests: number | null = null;
    if (manager) {
      const e = await workspaceEntitlements(ctx, workspace);
      const plan = PLAN_CATALOG[e.planId];
      seats = { billable: await billableSeatCount(ctx, workspace._id), paid: e.paid, planName: WORKSPACE_PLANS[plan.tier as WorkspaceTier].name, seatPriceCents: plan.priceCents, interval: plan.interval };
      guests = (await seatSummary(ctx, workspace._id)).guests;
    }
    const you = normalizeMembership(member);
    return { members: out, invites, yourRole: you.role, yourMemberAccess: you.memberAccess, yourCanManageBilling: memberCanManageBilling(member), canManage: manager, seats, guests };
  },
});

export const createTeamWorkspace = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const name = args.name.trim().slice(0, 80);
    if (!name) fail("invalid_argument", "Give the workspace a name.");
    const owned = await ctx.db
      .query("workspaces")
      .withIndex("by_owner", (q) => q.eq("ownerId", profile._id))
      .collect();
    if (owned.filter((w) => w.status !== "deleting").length >= 10) fail("limit_exceeded", "You can own up to 10 workspaces.");
    const id = await createWorkspace(ctx, profile, name);
    return { id: (await ctx.db.get(id))!.publicId };
  },
});

export const rename = mutation({
  args: { workspaceId: v.string(), name: v.string(), icon: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace } = await requireWorkspaceManager(ctx, profile, args.workspaceId, { write: true });
    const name = args.name.trim().slice(0, 80);
    if (!name) fail("invalid_argument", "Give the workspace a name.");
    await ctx.db.patch(workspace._id, { name, icon: args.icon?.slice(0, 16) ?? workspace.icon, updatedAt: Date.now() });
    return null;
  },
});

/**
 * Sets a team workspace's logo to an image just uploaded with `files.generateUploadUrl` (kind "logo").
 * Owners and admins only; the previous logo is deleted.
 */
export const setLogo = mutation({
  args: { workspaceId: v.string(), fileId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace } = await requireWorkspaceManager(ctx, profile, args.workspaceId, { write: true });
    const file = await claimIdentityImage(ctx, profile, args.fileId, "logo", workspaceScope(workspace._id));
    const previous = workspace.logoFileId;
    await ctx.db.patch(workspace._id, { logoFileId: file._id, updatedAt: Date.now() });
    if (previous && previous !== file._id) await deleteIdentityImage(ctx, previous);
    return null;
  },
});

export const removeLogo = mutation({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace } = await requireWorkspaceManager(ctx, profile, args.workspaceId, { write: true });
    if (!workspace.logoFileId) return null;
    const previous = workspace.logoFileId;
    await ctx.db.patch(workspace._id, { logoFileId: undefined, updatedAt: Date.now() });
    await deleteIdentityImage(ctx, previous);
    return null;
  },
});

/**
 * Creates a member invitation (and its email and, for an existing account, its in-app notice). The caller
 * has checked that the actor may invite this role and that the address is valid.
 */
async function createMemberInvite(
  ctx: MutationCtx,
  input: { actor: Doc<"profiles">; workspace: Doc<"workspaces">; email: string; role: "admin" | "member"; memberAccess?: MemberAccess },
): Promise<string> {
  const { actor, workspace, email } = input;
  const label = workspaceLabel(workspace);
  const count = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
    .collect();
  if (count.length >= workspace.memberLimit) fail("quota_exceeded", "This workspace has reached its member limit.");
  const existingProfile = await ctx.db
    .query("profiles")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  if (existingProfile && (await membership(ctx, existingProfile._id, workspace._id))) {
    fail("invalid_argument", `${existingProfile.displayName || email} is already a member of ${label}.`);
  }
  const prior = await ctx.db
    .query("workspaceInvites")
    .withIndex("by_email", (q) => q.eq("email", email))
    .collect();
  for (const p of prior) if (p.workspaceId === workspace._id && p.status === "pending") await ctx.db.patch(p._id, { status: "revoked" });
  const token = randomToken(32);
  const publicId = ulid();
  const now = Date.now();
  const memberAccess = input.role === "member" ? (input.memberAccess ?? "edit") : undefined;
  const inviteId = await ctx.db.insert("workspaceInvites", {
    publicId,
    workspaceId: workspace._id,
    email,
    role: input.role,
    ...(memberAccess && memberAccess !== "edit" ? { memberAccess } : {}),
    tokenHash: await sha256Hex(token),
    invitedBy: actor._id,
    status: "pending",
    expiresAt: now + INVITE_TTL_MS,
    createdAt: now,
  });
  if (existingProfile) {
    await notifyInvite(ctx, { recipient: existingProfile, actorId: actor._id, workspaceId: workspace._id, inviteId, title: `${actor.displayName} invited you to ${label}` });
  }
  await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
    key: "workspace_invite",
    // Existing accounts get the mail through their profile so the "Invitations" email preference is honored.
    ...(existingProfile ? { profileId: existingProfile._id } : { to: email }),
    idempotencyKey: `invite:${publicId}`,
    dataVariables: {
      inviterName: actor.displayName,
      workspaceName: label,
      role: workspaceRoleLabel(input.role, memberAccess),
      acceptUrl: `${appUrl()}/invite/${token}`,
      expiresInDays: 7,
      preferencesUrl: `${appUrl()}/settings/notifications`,
    },
  });
  return publicId;
}

export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) fail("invalid_argument", "Enter a valid email address.");
  return email;
}

/**
 * Invites by email as a Member (with an access: edit, comment or view only) or an Admin (owner only). The
 * invite is bound to the verified email address that accepts it. Older clients may still send
 * editor / commenter / viewer; they become Member with that access.
 */
export const invite = mutation({
  args: { workspaceId: v.string(), email: v.string(), role: vInviteRole, memberAccess: v.optional(vMemberAccess) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace, member } = await requireWorkspaceManager(ctx, profile, args.workspaceId, { write: true });
    // Platform switch (admin console → Feature flags → workspace_invites).
    if (!(await isFeatureEnabled(ctx, "workspace_invites"))) fail("forbidden", "Inviting people is turned off for now. Try again later.");
    await consume(ctx, "invite", profile._id);
    const email = normalizeEmail(args.email);
    const wanted = requestedRole(args.role, args.memberAccess);
    if (!canInviteMember(member, wanted.role)) fail("forbidden", "Only the owner can invite admins.");
    if (email === profile.email) fail("invalid_argument", "You’re already in this workspace.");
    return { id: await createMemberInvite(ctx, { actor: profile, workspace, email, role: wanted.role, memberAccess: wanted.memberAccess }) };
  },
});

export const revokeInvite = mutation({
  args: { inviteId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const invite = await ctx.db
      .query("workspaceInvites")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.inviteId))
      .unique();
    if (!invite) fail("not_found", "Invite not found.");
    const workspace = await ctx.db.get(invite.workspaceId);
    if (!workspace) fail("not_found", "Invite not found.");
    const { member } = await requireWorkspaceManager(ctx, profile, workspace.publicId);
    if (!canInviteMember(member, normalizeMembership(invite).role === "admin" ? "admin" : "member")) fail("forbidden", "Only the owner can revoke an admin invitation.");
    await ctx.db.patch(invite._id, { status: "revoked" });
    return null;
  },
});

export const previewInvite = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const hash = await sha256Hex(args.token);
    const found = await ctx.db
      .query("workspaceInvites")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", hash))
      .unique();
    if (!found || found.status !== "pending" || found.expiresAt < Date.now()) return { valid: false as const };
    const workspace = await ctx.db.get(found.workspaceId);
    if (!workspace || workspace.status !== "active" || isScheduledForDeletion(workspace)) return { valid: false as const };
    const inviter = await ctx.db.get(found.invitedBy);
    const n = normalizeMembership(found);
    return {
      valid: true as const,
      workspaceName: workspaceLabel(workspace),
      inviterName: inviter?.displayName ?? "Someone",
      role: n.role,
      memberAccess: n.memberAccess,
      /** e.g. "Member", "Member (view only)", "Admin". */
      roleLabel: workspaceRoleLabel(n.role, n.memberAccess),
      emailMatches: found.email === profile.email,
    };
  },
});

export const acceptInvite = mutation({
  args: { token: v.optional(v.string()), inviteId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    let invite: Doc<"workspaceInvites"> | null = null;
    if (args.token) {
      const hash = await sha256Hex(args.token);
      invite = await ctx.db
        .query("workspaceInvites")
        .withIndex("by_token_hash", (q) => q.eq("tokenHash", hash))
        .unique();
    } else if (args.inviteId) {
      invite = await ctx.db
        .query("workspaceInvites")
        .withIndex("by_public_id", (q) => q.eq("publicId", args.inviteId!))
        .unique();
    }
    if (!invite || invite.status !== "pending") fail("not_found", "This invitation is no longer valid.");
    if (invite.expiresAt < Date.now()) {
      await ctx.db.patch(invite._id, { status: "expired" });
      fail("expired", "This invitation has expired. Ask for a new one.");
    }
    // Invitations are bound to the verified address they were sent to.
    if (invite.email !== profile.email) fail("forbidden", "This invitation was sent to a different email address.");
    const workspace = await ctx.db.get(invite.workspaceId);
    if (!workspace || workspace.status !== "active" || isScheduledForDeletion(workspace)) fail("not_found", "This workspace is unavailable.");
    if (!(await membership(ctx, profile._id, workspace._id))) {
      const count = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
        .collect();
      if (count.length >= workspace.memberLimit) fail("quota_exceeded", "This workspace has reached its member limit. Ask its owner.");
      const n = normalizeMembership(invite);
      // A guest who becomes a member keeps their page grants (they still matter on restricted pages).
      await ctx.db.insert("workspaceMembers", {
        workspaceId: workspace._id,
        profileId: profile._id,
        role: n.role === "admin" ? "admin" : "member",
        ...(n.role === "member" && n.memberAccess !== "edit" ? { memberAccess: n.memberAccess } : {}),
        joinedAt: Date.now(),
      });
      // A new member takes a seat once they accept (pending invitations are free).
      await seatsChanged(ctx, workspace._id);
    }
    await ctx.db.patch(invite._id, { status: "accepted", acceptedBy: profile._id });
    const notes = await ctx.db
      .query("notifications")
      .withIndex("by_profile_created", (q) => q.eq("profileId", profile._id))
      .collect();
    for (const n of notes) if (n.inviteId === invite._id && !n.readAt) await ctx.db.patch(n._id, { readAt: Date.now() });
    return { workspaceId: workspace.publicId };
  },
});

/**
 * Changes a member's role (Member ↔ Admin; only the owner changes admins) or a member's access (edit,
 * comment, view only). Seats don't change: every membership role takes one.
 */
export const changeRole = mutation({
  args: { workspaceId: v.string(), profileId: v.string(), role: vInviteRole, memberAccess: v.optional(vMemberAccess) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace, member } = await requireWorkspaceManager(ctx, profile, args.workspaceId, { write: true });
    const targetId = ctx.db.normalizeId("profiles", args.profileId);
    const target = targetId ? await membership(ctx, targetId, workspace._id) : null;
    if (!target) fail("not_found", "Member not found.");
    if (normalizeMembership(target).role === "owner") fail("forbidden", "Ownership can't be changed here.");
    if (target.profileId === profile._id) fail("forbidden", "You can't change your own role.");
    const wanted = requestedRole(args.role, args.memberAccess);
    if (!canManageMember(member, target) || (wanted.role === "admin" && !canInviteMember(member, "admin"))) fail("forbidden", "Only the owner can change admins.");
    // Billing access is an admin's; it ends when they stop being one. Old role names are rewritten.
    await ctx.db.patch(target._id, {
      role: wanted.role,
      memberAccess: wanted.role === "member" && wanted.memberAccess !== "edit" ? wanted.memberAccess : undefined,
      ...(wanted.role !== "admin" ? { canManageBilling: undefined } : {}),
    });
    await seatsChanged(ctx, workspace._id);
    await notifyAccessChange(ctx, { recipientId: target.profileId, actor: profile, change: { type: "workspace_role", workspace, role: wanted.role === "member" ? `member:${wanted.memberAccess ?? "edit"}` : wanted.role } });
    return null;
  },
});

export const SOLE_OWNER_LEAVE = "You own this workspace, so you can't leave it. Transfer ownership to another member first, or delete the workspace.";

/** Deletes every page grant `profileId` holds in `workspace`. */
async function revokeWorkspaceGrants(ctx: MutationCtx, workspace: Doc<"workspaces">, profileId: Id<"profiles">): Promise<number> {
  const grants = await ctx.db
    .query("documentPermissions")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .collect();
  let n = 0;
  for (const g of grants) {
    if (g.workspaceId !== workspace._id) continue;
    await ctx.db.delete(g._id);
    n++;
  }
  return n;
}

/**
 * Removes a member (owners and admins; admins only members) or leaves (anyone but the owner). Their
 * grants in this workspace go too; their Personal and their own subscription are never touched.
 */
export const removeMember = mutation({
  args: { workspaceId: v.string(), profileId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const targetId = ctx.db.normalizeId("profiles", args.profileId);
    const leaving = targetId === profile._id;
    const { workspace, member } = leaving ? await requireWorkspace(ctx, profile, args.workspaceId) : await requireWorkspaceManager(ctx, profile, args.workspaceId, { write: true });
    const target = targetId ? await membership(ctx, targetId, workspace._id) : null;
    if (!target) fail("not_found", "Member not found.");
    if (normalizeMembership(target).role === "owner") fail("forbidden", leaving ? SOLE_OWNER_LEAVE : "The owner can't be removed.");
    if (!leaving && !canManageMember(member, target)) fail("forbidden", "Only the owner can remove admins.");
    await ctx.db.delete(target._id);
    await revokeWorkspaceGrants(ctx, workspace, target.profileId);
    await seatsChanged(ctx, workspace._id);
    if (!leaving) await notifyAccessChange(ctx, { recipientId: target.profileId, actor: profile, change: { type: "workspace_removed", workspace } });
    return null;
  },
});

/**
 * Hands a team workspace to another member. The new owner must already be a member; the previous
 * owner stays on as an admin. The workspace's subscription stays with the workspace.
 */
export const transferOwnership = mutation({
  args: { workspaceId: v.string(), profileId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace, member } = await requireWorkspace(ctx, profile, args.workspaceId, "owner");
    const targetId = ctx.db.normalizeId("profiles", args.profileId);
    if (!targetId || targetId === profile._id) fail("invalid_argument", "Choose another member.");
    const target = await membership(ctx, targetId, workspace._id);
    const targetProfile = await ctx.db.get(targetId);
    if (!target || !targetProfile || targetProfile.status !== "active") fail("not_found", "Member not found.");
    const owned = await ctx.db
      .query("workspaces")
      .withIndex("by_owner", (q) => q.eq("ownerId", targetId))
      .collect();
    if (owned.filter((w) => w.status !== "deleting").length >= 10) fail("limit_exceeded", `${targetProfile.displayName} already owns 10 workspaces.`);
    // The workspace's subscription belongs to the workspace, so it stays as it is; only who owns it changes.
    await ctx.db.patch(target._id, { role: "owner", memberAccess: undefined, canManageBilling: undefined });
    await ctx.db.patch(member._id, { role: "admin", memberAccess: undefined, canManageBilling: undefined });
    await ctx.db.patch(workspace._id, { ownerId: targetId, updatedAt: Date.now() });
    await seatsChanged(ctx, workspace._id);
    await notifyAccessChange(ctx, { recipientId: targetId, actor: profile, change: { type: "workspace_role", workspace, role: "owner" } });
    return null;
  },
});

/**
 * The owner lets an admin manage the workspace's plan and billing (or stops them). Members and guests can
 * never be given it; owners always have it.
 */
export const setBillingManager = mutation({
  args: { workspaceId: v.string(), profileId: v.string(), allowed: v.boolean() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace } = await requireWorkspace(ctx, profile, args.workspaceId, "owner");
    const targetId = ctx.db.normalizeId("profiles", args.profileId);
    const target = targetId ? await membership(ctx, targetId, workspace._id) : null;
    if (!target) fail("not_found", "Member not found.");
    if (normalizeMembership(target).role !== "admin") fail("invalid_argument", "Only admins can be allowed to manage billing.");
    await ctx.db.patch(target._id, { canManageBilling: args.allowed || undefined });
    return null;
  },
});

// ---------------------------------------------------------------------------------------------------
// Guests: people with page grants in this workspace and no membership. They take no seat.
// ---------------------------------------------------------------------------------------------------

/** A guest of `workspace` by profile id (a grant holder who isn't a member), or not found. */
async function requireGuest(ctx: MutationCtx, workspace: Doc<"workspaces">, rawProfileId: string): Promise<{ guest: Doc<"profiles">; grants: Doc<"documentPermissions">[] }> {
  const id = ctx.db.normalizeId("profiles", rawProfileId);
  const guest = id ? await ctx.db.get(id) : null;
  if (!guest || guest.status === "deleted" || (await membership(ctx, guest._id, workspace._id))) fail("not_found", "Guest not found.");
  const grants = (
    await ctx.db
      .query("documentPermissions")
      .withIndex("by_profile", (q) => q.eq("profileId", guest._id))
      .collect()
  ).filter((g) => g.workspaceId === workspace._id);
  if (!grants.length) fail("not_found", "Guest not found.");
  return { guest, grants };
}

/**
 * The Guests list (owners and admins): everyone with page access here who isn't a member, the pages they
 * were given (a grant reaches the pages under it too) and their access; plus page invitations still
 * waiting for someone to sign up.
 */
export const guests = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { workspace } = await requireWorkspaceManager(ctx, profile, args.workspaceId);
    const members = new Set(
      (
        await ctx.db
          .query("workspaceMembers")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
          .collect()
      ).map((m) => m.profileId as string),
    );
    const grants = await ctx.db
      .query("documentPermissions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .take(2000);
    const byPerson = new Map<string, Doc<"documentPermissions">[]>();
    for (const g of grants) {
      if (members.has(g.profileId)) continue;
      const list = byPerson.get(g.profileId) ?? [];
      list.push(g);
      byPerson.set(g.profileId, list);
    }
    const out = [];
    for (const [id, list] of byPerson) {
      const p = await ctx.db.get(id as Id<"profiles">);
      if (!p || p.status === "deleted") continue;
      const pages = [];
      for (const g of list) {
        const d = await ctx.db.get(g.documentId);
        if (!d) continue;
        pages.push({ documentId: d.publicId, title: d.title || "Untitled", icon: d.icon ?? null, inTrash: d.inTrash, role: g.role, grantedAt: g.createdAt });
      }
      pages.sort((a, b) => a.title.localeCompare(b.title));
      out.push({ profileId: p._id as string, displayName: p.displayName, email: p.email, pages });
    }
    out.sort((a, b) => a.displayName.localeCompare(b.displayName));
    const pending = [];
    for (const i of await ctx.db
      .query("pageInvites")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .take(500)) {
      if (i.status !== "pending") continue;
      const d = await ctx.db.get(i.documentId);
      if (!d) continue;
      pending.push({ id: i.publicId, email: i.email, documentId: d.publicId, title: d.title || "Untitled", role: i.role, expiresAt: i.expiresAt, expired: i.expiresAt < Date.now() });
    }
    return { guests: out, pendingInvites: pending };
  },
});

/** Changes a guest's access to one page they were given (owners and admins). */
export const setGuestAccess = mutation({
  args: { workspaceId: v.string(), profileId: v.string(), documentId: v.string(), role: vShareRole },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace } = await requireWorkspaceManager(ctx, profile, args.workspaceId, { write: true });
    const { guest, grants } = await requireGuest(ctx, workspace, args.profileId);
    const doc = await ctx.db
      .query("documents")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.documentId))
      .unique();
    const grant = doc ? grants.find((g) => g.documentId === doc._id) : undefined;
    if (!doc || !grant) fail("not_found", "Page not found.");
    if (grant.role === args.role) return null;
    await ctx.db.patch(grant._id, { role: args.role });
    await notifyAccessChange(ctx, { recipientId: guest._id, actor: profile, change: { type: "document_role", doc, role: args.role } });
    return null;
  },
});

/** Removes a guest from the workspace: every page grant they hold here (owners and admins). */
export const removeGuest = mutation({
  args: { workspaceId: v.string(), profileId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace } = await requireWorkspaceManager(ctx, profile, args.workspaceId, { write: true });
    const { guest } = await requireGuest(ctx, workspace, args.profileId);
    await revokeWorkspaceGrants(ctx, workspace, guest._id);
    await notifyAccessChange(ctx, { recipientId: guest._id, actor: profile, change: { type: "workspace_removed", workspace } });
    return null;
  },
});

/**
 * Invites a guest to become a member (owners and admins): an ordinary member invitation to their account's
 * address. Nothing changes until they accept; then they're a member (a seat) and keep their page grants.
 */
export const convertGuestToMember = mutation({
  args: { workspaceId: v.string(), profileId: v.string(), memberAccess: v.optional(vMemberAccess) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace } = await requireWorkspaceManager(ctx, profile, args.workspaceId, { write: true });
    if (!(await isFeatureEnabled(ctx, "workspace_invites"))) fail("forbidden", "Inviting people is turned off for now. Try again later.");
    await consume(ctx, "invite", profile._id);
    const { guest } = await requireGuest(ctx, workspace, args.profileId);
    if (guest.status !== "active") fail("invalid_argument", "This account can't join workspaces right now.");
    return { id: await createMemberInvite(ctx, { actor: profile, workspace, email: guest.email, role: "member", memberAccess: args.memberAccess }) };
  },
});

/** The page grant a member made a guest gets on pages they created (never more than they had). */
function guestRoleFor(member: Doc<"workspaceMembers">): ShareRole {
  const level = memberLevel(member);
  return level === "view" ? "viewer" : level === "comment" ? "commenter" : "editor";
}

/** Pages checked under one created page before giving its creator a grant on it. */
const CONVERT_SUBTREE_LIMIT = 200;
/** Pages they created that are considered (the rest keep only their explicit grants). */
const CONVERT_PAGE_LIMIT = 200;

/**
 * Whether a grant on `root` reaches no restricted page (a grant would open it). A subtree bigger than we
 * check counts as "no" — never over-granted.
 */
async function subtreeUnrestricted(ctx: MutationCtx, root: Doc<"documents">): Promise<boolean> {
  const queue: Id<"documents">[] = [root._id];
  let seen = 0;
  while (queue.length) {
    const id = queue.shift()!;
    const kids = await ctx.db
      .query("documents")
      .withIndex("by_parent", (q) => q.eq("parentDocumentId", id))
      .take(CONVERT_SUBTREE_LIMIT + 1);
    for (const k of kids) {
      if (++seen > CONVERT_SUBTREE_LIMIT || k.accessMode === "restricted") return false;
      queue.push(k._id);
    }
  }
  return true;
}

/** Whether `doc` sits under a restricted page. */
async function underRestricted(ctx: MutationCtx, doc: Doc<"documents">): Promise<boolean> {
  let cursor = doc.parentDocumentId ? await ctx.db.get(doc.parentDocumentId) : null;
  for (let depth = 0; cursor && depth < 12; depth++) {
    if (cursor.accessMode === "restricted") return true;
    cursor = cursor.parentDocumentId ? await ctx.db.get(cursor.parentDocumentId) : null;
  }
  return false;
}

/**
 * Makes a member a guest (owners and admins; admins only members). The membership ends (one seat less) and
 * they keep, as page grants:
 *   - every grant they already had in this workspace;
 *   - a grant on each page they created (up to 200, not in the Trash) at their former access (view only →
 *     Can view, comment → Can comment, otherwise Can edit) — unless the page, a page above it or a page
 *     under it is restricted, since a grant there would reach restricted content. Those can be shared with
 *     them again from the page's Share dialog.
 * Nobody gains access they didn't have. Their Personal and subscription aren't touched.
 */
export const convertMemberToGuest = mutation({
  args: { workspaceId: v.string(), profileId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace, member } = await requireWorkspaceManager(ctx, profile, args.workspaceId, { write: true });
    const targetId = ctx.db.normalizeId("profiles", args.profileId);
    const target = targetId ? await membership(ctx, targetId, workspace._id) : null;
    if (!target) fail("not_found", "Member not found.");
    if (target.profileId === profile._id) fail("forbidden", "You can't make yourself a guest.");
    if (!canManageMember(member, target)) fail("forbidden", normalizeMembership(target).role === "owner" ? "The owner can't be made a guest." : "Only the owner can change admins.");
    const role = guestRoleFor(target);
    const created = await ctx.db
      .query("documents")
      .withIndex("by_workspace_created", (q) => q.eq("workspaceId", workspace._id))
      .filter((q) => q.and(q.eq(q.field("createdBy"), target.profileId), q.eq(q.field("inTrash"), false)))
      .take(CONVERT_PAGE_LIMIT);
    let granted = 0;
    for (const d of created) {
      if (d.kind === "collectionRow" || d.accessMode === "restricted") continue;
      if ((await underRestricted(ctx, d)) || !(await subtreeUnrestricted(ctx, d))) continue;
      const existing = await ctx.db
        .query("documentPermissions")
        .withIndex("by_document_profile", (q) => q.eq("documentId", d._id).eq("profileId", target.profileId))
        .unique();
      if (existing) {
        if (accessAtLeast(roleToAccess(existing.role), roleToAccess(role))) continue;
        await ctx.db.patch(existing._id, { role });
      } else {
        await insertScoped(ctx, "documentPermissions", workspaceScope(workspace._id), { documentId: d._id, profileId: target.profileId, role, grantedBy: profile._id, createdAt: Date.now() });
      }
      granted++;
    }
    await ctx.db.delete(target._id);
    await seatsChanged(ctx, workspace._id);
    await notifyAccessChange(ctx, { recipientId: target.profileId, actor: profile, change: { type: "workspace_guest", workspace } });
    return { granted };
  },
});

// ---------------------------------------------------------------------------------------------------
// Deleting a workspace (owner only): scheduled with a grace period, cancelable, then purged.
// ---------------------------------------------------------------------------------------------------

/**
 * Schedules the workspace's deletion (owner only; type its name to confirm). For 7 days it's read-only for
 * the owner (who can cancel) and hidden from members and guests; then maintenance purges it with all its
 * content. Its paid plan is set to end with the current period. Members are told.
 */
export const scheduleDeletion = mutation({
  args: { workspaceId: v.string(), confirmName: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace } = await requireWorkspace(ctx, profile, args.workspaceId, "owner");
    if (args.confirmName.trim() !== workspace.name.trim()) fail("invalid_argument", "Type the workspace's name exactly to confirm.");
    const now = Date.now();
    const scheduledFor = now + WORKSPACE_DELETION_GRACE_MS;
    await ctx.db.patch(workspace._id, { deletionScheduledFor: scheduledFor, updatedAt: now });
    await ctx.db.insert("deletionJobs", {
      kind: "workspace",
      targetId: workspace._id,
      requestedBy: profile._id,
      requestedByAdmin: false,
      reason: "owner_request",
      scheduledFor,
      status: "scheduled",
      progress: 0,
      createdAt: now,
    });
    // Nobody is billed on for a workspace that's going away: the plan ends with the paid period.
    await workspaceClosing(ctx, workspace._id);
    // Pending member invitations can't be accepted any more.
    for (const i of await ctx.db
      .query("workspaceInvites")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect()) {
      if (i.status === "pending") await ctx.db.patch(i._id, { status: "revoked" });
    }
    const updated = (await ctx.db.get(workspace._id))!;
    const members = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .take(500);
    for (const m of members) {
      if (m.profileId === profile._id) continue;
      await notifyAccessChange(ctx, { recipientId: m.profileId, actor: profile, change: { type: "workspace_deletion_scheduled", workspace: updated, at: scheduledFor } });
    }
    return { scheduledFor };
  },
});

/**
 * Cancels a scheduled deletion (owner only). The workspace is back for everyone. A paid plan stays set to
 * end with its period: resume it in Plan & billing to keep it.
 */
export const cancelDeletion = mutation({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace } = await requireWorkspace(ctx, profile, args.workspaceId, "owner", { allowScheduledDeletion: true });
    if (!isScheduledForDeletion(workspace)) return null;
    await ctx.db.patch(workspace._id, { deletionScheduledFor: undefined, updatedAt: Date.now() });
    const jobs = await ctx.db
      .query("deletionJobs")
      .withIndex("by_target", (q) => q.eq("kind", "workspace").eq("targetId", workspace._id))
      .collect();
    for (const job of jobs) if (job.status === "scheduled") await ctx.db.patch(job._id, { status: "canceled" });
    return null;
  },
});
