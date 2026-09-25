import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { ulid } from "@folevi/editor-schema";
import { assertWritable, membership, requireProfile, requireWorkspace, roleAtLeast } from "./lib/auth";
import { fail } from "./lib/errors";
import { consume } from "./lib/rateLimit";
import { randomToken, sha256Hex } from "./lib/crypto";
import { vWorkspaceRole } from "./lib/validators";
import { createWorkspace } from "./seed";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i;

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
      out.push({
        id: w.publicId,
        name: w.name,
        kind: w.kind,
        icon: w.icon ?? null,
        role: m.role,
        status: w.status,
        isDefault: profile.defaultWorkspaceId === w._id,
        storageUsedBytes: w.storageUsedBytes,
        storageQuotaBytes: w.storageQuotaBytes,
      });
    }
    return out.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
  },
});

export const members = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { workspace, member } = await requireWorkspace(ctx, profile, args.workspaceId);
    const rows = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const out = [];
    for (const r of rows) {
      const p = await ctx.db.get(r.profileId);
      if (!p || p.status === "deleted") continue;
      out.push({ profileId: p._id as string, displayName: p.displayName, email: p.email, role: r.role, joinedAt: r.joinedAt, isYou: p._id === profile._id });
    }
    const invites = roleAtLeast(member.role, "admin")
      ? (
          await ctx.db
            .query("workspaceInvites")
            .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
            .collect()
        )
          .filter((i) => i.status === "pending")
          .map((i) => ({ id: i.publicId, email: i.email, role: i.role, expiresAt: i.expiresAt, expired: i.expiresAt < Date.now() }))
      : [];
    return { members: out, invites, yourRole: member.role };
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
    if (owned.length >= 10) fail("limit_exceeded", "You can own up to 10 workspaces.");
    const id = await createWorkspace(ctx, profile, name, "team");
    return { id: (await ctx.db.get(id))!.publicId };
  },
});

export const rename = mutation({
  args: { workspaceId: v.string(), name: v.string(), icon: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace } = await requireWorkspace(ctx, profile, args.workspaceId, "admin");
    const name = args.name.trim().slice(0, 80);
    if (!name) fail("invalid_argument", "Give the workspace a name.");
    await ctx.db.patch(workspace._id, { name, icon: args.icon?.slice(0, 16) ?? workspace.icon, updatedAt: Date.now() });
    return null;
  },
});

/** Invites by email. The invite is bound to the verified email address that accepts it. */
export const invite = mutation({
  args: { workspaceId: v.string(), email: v.string(), role: vWorkspaceRole },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace, member } = await requireWorkspace(ctx, profile, args.workspaceId, "admin");
    await consume(ctx, "invite", profile._id);
    const email = args.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) fail("invalid_argument", "Enter a valid email address.");
    if (args.role === "owner") fail("invalid_argument", "Transfer ownership instead of inviting an owner.");
    if (args.role === "admin" && member.role !== "owner") fail("forbidden", "Only the owner can invite admins.");
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
      fail("invalid_argument", "That person is already a member.");
    }
    const prior = await ctx.db
      .query("workspaceInvites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    for (const p of prior) if (p.workspaceId === workspace._id && p.status === "pending") await ctx.db.patch(p._id, { status: "revoked" });
    const token = randomToken(32);
    const publicId = ulid();
    const now = Date.now();
    const inviteId = await ctx.db.insert("workspaceInvites", {
      publicId,
      workspaceId: workspace._id,
      email,
      role: args.role,
      tokenHash: await sha256Hex(token),
      invitedBy: profile._id,
      status: "pending",
      expiresAt: now + INVITE_TTL_MS,
      createdAt: now,
    });
    if (existingProfile) {
      await ctx.db.insert("notifications", {
        profileId: existingProfile._id,
        workspaceId: workspace._id,
        kind: "invite",
        actorId: profile._id,
        inviteId,
        title: `${profile.displayName} invited you to ${workspace.name}`,
        createdAt: now,
      });
    }
    await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
      key: "workspace_invite",
      to: email,
      idempotencyKey: `invite:${publicId}`,
      dataVariables: {
        inviterName: profile.displayName,
        workspaceName: workspace.name,
        role: args.role,
        acceptUrl: `${process.env.FOLEVI_APP_URL ?? "https://app.folevi.com"}/invite/${token}`,
        expiresInDays: 7,
        preferencesUrl: `${process.env.FOLEVI_APP_URL ?? "https://app.folevi.com"}/settings/notifications`,
      },
    });
    return { id: publicId };
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
    const workspace = (await ctx.db.get(invite.workspaceId))!;
    await requireWorkspace(ctx, profile, workspace.publicId, "admin");
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
    const inviter = await ctx.db.get(found.invitedBy);
    return {
      valid: true as const,
      workspaceName: workspace?.name ?? "a workspace",
      inviterName: inviter?.displayName ?? "Someone",
      role: found.role,
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
    if (!workspace || workspace.status !== "active") fail("not_found", "This workspace is unavailable.");
    if (!(await membership(ctx, profile._id, workspace._id))) {
      await ctx.db.insert("workspaceMembers", { workspaceId: workspace._id, profileId: profile._id, role: invite.role, joinedAt: Date.now() });
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

export const changeRole = mutation({
  args: { workspaceId: v.string(), profileId: v.string(), role: vWorkspaceRole },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { workspace, member } = await requireWorkspace(ctx, profile, args.workspaceId, "admin");
    const targetId = ctx.db.normalizeId("profiles", args.profileId);
    const target = targetId ? await membership(ctx, targetId, workspace._id) : null;
    if (!target) fail("not_found", "Member not found.");
    if (target.role === "owner" || args.role === "owner") fail("forbidden", "Ownership can't be changed here.");
    if ((args.role === "admin" || target.role === "admin") && member.role !== "owner") fail("forbidden", "Only the owner can change admins.");
    await ctx.db.patch(target._id, { role: args.role });
    return null;
  },
});

export const removeMember = mutation({
  args: { workspaceId: v.string(), profileId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const targetId = ctx.db.normalizeId("profiles", args.profileId);
    const leaving = targetId === profile._id;
    const { workspace, member } = await requireWorkspace(ctx, profile, args.workspaceId, leaving ? "viewer" : "admin");
    const target = targetId ? await membership(ctx, targetId, workspace._id) : null;
    if (!target) fail("not_found", "Member not found.");
    if (target.role === "owner") fail("forbidden", "The owner can't leave or be removed.");
    if (!leaving && target.role === "admin" && member.role !== "owner") fail("forbidden", "Only the owner can remove admins.");
    await ctx.db.delete(target._id);
    const grants = await ctx.db
      .query("documentPermissions")
      .withIndex("by_profile", (q) => q.eq("profileId", target.profileId))
      .collect();
    for (const g of grants) if (g.workspaceId === workspace._id) await ctx.db.delete(g._id);
    return null;
  },
});
