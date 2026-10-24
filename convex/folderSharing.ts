// Folder sharing (docs/SHARING.md): a folder shared with people and roles; every note inside, in its
// subfolders too, and notes added later follow the folder. Access itself is decided in one place
// (lib/auth.ts: documentAccess reads folder grants through folderGrantOf, folderAccessInfo for the folder);
// this module is the Share dialog for folders, the invitations, the shared folder page and "Shared with Me".
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { ulid } from "@folevi/editor-schema";
import type { Doc, Id } from "./_generated/dataModel";
import {
  accessAtLeast,
  assertWritable,
  documentAccess,
  folderAccessInfo,
  folderChain,
  folderGrantsReach,
  getDocumentByPublicId,
  memberLevel,
  membership,
  requireProfile,
  roleToAccess,
  type Access,
  type FolderAccessInfo,
  type ShareRole,
} from "./lib/auth";
import { fail } from "./lib/errors";
import { randomToken, sha256Hex } from "./lib/crypto";
import { consume } from "./lib/rateLimit";
import { appUrl, notifyAccessChange, notifyFolderShare, removeInviteNotices, shareRoleLabel } from "./lib/notify";
import { vShareRole } from "./lib/validators";
import { insertScoped, sameScopeRows, scopeOfRow } from "./lib/scope";
import { spaceE2ee } from "./lib/e2ee/state";
import { lockOfFolder } from "./lib/e2ee/sealedRows";

type Ctx = QueryCtx | MutationCtx;

/** How long an emailed folder invitation stays valid (as a page invitation). */
export const FOLDER_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Pending invitations one folder can have at once. */
const MAX_PENDING_FOLDER_INVITES = 50;
/** People one folder can be shared with directly. */
const MAX_FOLDER_GRANTS = 200;
/** Folders below a shared one, and notes in them, read for one answer. */
const SUBTREE_FOLDERS = 200;
const SUBTREE_NOTES = 2000;
const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i;

export const MANAGE_FORBIDDEN = "Only the folder's owner, or a workspace owner or admin, can share it.";
export const ENCRYPTED_SPACE =
  "This folder is in an end-to-end encrypted space, so it can't be shared as a folder. Share its notes one by one: each note's key goes to the person you share it with.";
export const ENCRYPTED_FOLDER = "This folder is always fully encrypted, so it can't be shared as a folder. Share its notes one by one instead.";

async function folderByPublicId(ctx: Ctx, publicId: string): Promise<Doc<"folders"> | null> {
  return await ctx.db
    .query("folders")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique();
}

/** A folder and how the caller stands on it; anything they can't open reads as not found. */
async function sharingFolder(ctx: Ctx, profile: Doc<"profiles">, folderId: string): Promise<{ folder: Doc<"folders">; info: FolderAccessInfo; manage: boolean }> {
  const folder = await folderByPublicId(ctx, folderId);
  if (!folder || folder.deletedAt !== undefined) fail("not_found", "Folder not found.");
  const info = await folderAccessInfo(ctx, profile, folder);
  if (info.access === "none") fail("not_found", "Folder not found.");
  // Managers: the Personal's owner, a workspace's owners and admins. Members and guests never share folders
  // (a folder can hold restricted pages and other people's notes they couldn't hand out one by one).
  return { folder, info, manage: info.access === "manage" && info.inScope };
}

/**
 * Why a folder can't be shared as a folder, or null. End-to-end encrypted notes are shared note by note,
 * each with its key (docs/E2EE_DESIGN.md §8.4), so a folder in an encrypted space, or one that is (or is in)
 * an always fully encrypted folder, isn't shared as a whole.
 */
export async function folderShareBlocked(ctx: Ctx, folder: Doc<"folders">): Promise<string | null> {
  const space = await spaceE2ee(ctx, scopeOfRow(folder));
  if (space && space.level !== "standard") return ENCRYPTED_SPACE;
  if (folder.sealedName || (await lockOfFolder(ctx, folder._id)) !== undefined) return ENCRYPTED_FOLDER;
  return null;
}

/** The folder and every live folder inside it (breadth first, bounded). */
export async function folderSubtree(ctx: Ctx, root: Doc<"folders">): Promise<Doc<"folders">[]> {
  const out: Doc<"folders">[] = [root];
  for (let i = 0; i < out.length && out.length < SUBTREE_FOLDERS; i++) {
    for (const f of await ctx.db
      .query("folders")
      .withIndex("by_parent", (q) => q.eq("parentFolderId", out[i]!._id))
      .take(SUBTREE_FOLDERS)) {
      if (f.deletedAt === undefined && sameScopeRows(f, root) && !out.some((o) => o._id === f._id)) out.push(f);
    }
  }
  return out.slice(0, SUBTREE_FOLDERS);
}

/** A folder's listed notes (top level, not in Trash or the Archive), most recently edited first. */
function listedNotes(ctx: Ctx, folderId: Id<"folders">) {
  return ctx.db
    .query("documents")
    .withIndex("by_folder_listed", (q) => q.eq("folderId", folderId).eq("parentDocumentId", undefined).eq("inTrash", false).eq("archivedAt", undefined))
    .order("desc");
}

/** Whether people with access through a folder grant see this listed note (not restricted, not encrypted, a note). */
function reachableNote(d: Doc<"documents">): boolean {
  return folderGrantsReach(d) && d.accessMode !== "restricted" && d.kind !== "template" && d.kind !== "collectionRow";
}

/** How many notes people with access to the folder see through it (its subfolders' too). */
async function reachableCount(ctx: Ctx, folder: Doc<"folders">): Promise<number> {
  let n = 0;
  for (const f of await folderSubtree(ctx, folder)) {
    for (const d of await listedNotes(ctx, f._id).take(SUBTREE_NOTES)) if (reachableNote(d)) n++;
    if (n >= SUBTREE_NOTES) break;
  }
  return n;
}

const personName = async (ctx: Ctx, id: Id<"profiles"> | undefined) => {
  const p = id ? await ctx.db.get(id) : null;
  return p && p.status !== "deleted" ? p.displayName : null;
};

/** Whose folder it is and where it lives: someone's Personal (whose), or a workspace (its name). */
async function placeOf(ctx: Ctx, folder: Doc<"folders">): Promise<{ ownerName: string | null; workspaceName: string | null }> {
  if (folder.ownerProfileId) return { ownerName: await personName(ctx, folder.ownerProfileId), workspaceName: null };
  const ws = folder.workspaceId ? await ctx.db.get(folder.workspaceId) : null;
  return { ownerName: await personName(ctx, folder.createdBy), workspaceName: ws?.name ?? null };
}

/** Whether `profileId` is outside the folder's scope (a guest there). */
async function isGuest(ctx: Ctx, folder: Doc<"folders">, profileId: Id<"profiles">): Promise<boolean> {
  if (folder.ownerProfileId) return folder.ownerProfileId !== profileId;
  return !folder.workspaceId || !(await membership(ctx, profileId, folder.workspaceId));
}

const roleLabel = (role: ShareRole) => (role === "editor" ? "Can edit" : role === "commenter" ? "Can comment" : "Can view");

/**
 * The Share dialog for a folder. People in its scope see everyone it was shared with (on it, and on the
 * folders above it, which reach it too), marked as guests when they aren't members, with emails for the
 * folder's managers; a guest sees only their own access and who gave it. Pending invitations are for managers.
 */
export const get = query({
  args: { folderId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { folder, info, manage } = await sharingFolder(ctx, profile, args.folderId);
    const place = await placeOf(ctx, folder);
    const people = [];
    let sharedBy: string | null = null;
    const inherited: { folderId: string; folderName: string; people: { profileId: string; displayName: string; role: ShareRole; guest: boolean; isYou: boolean }[] }[] = [];
    if (info.inScope) {
      for (const g of await ctx.db
        .query("folderPermissions")
        .withIndex("by_folder", (q) => q.eq("folderId", folder._id))
        .take(MAX_FOLDER_GRANTS)) {
        const p = await ctx.db.get(g.profileId);
        if (!p || p.status === "deleted") continue;
        people.push({
          profileId: p._id as string,
          displayName: p.displayName,
          email: manage ? p.email : null,
          role: g.role,
          guest: await isGuest(ctx, folder, p._id),
          isYou: p._id === profile._id,
          canChange: manage,
          sharedAt: g.createdAt,
        });
      }
      // Grants on the folders above it reach it as well: shown read only, changed where they were given.
      for (const above of (await folderChain(ctx, folder.parentFolderId, scopeOfRow(folder))).slice(0, 8)) {
        const rows = await ctx.db
          .query("folderPermissions")
          .withIndex("by_folder", (q) => q.eq("folderId", above._id))
          .take(MAX_FOLDER_GRANTS);
        if (!rows.length) continue;
        const list = [];
        for (const g of rows) {
          const p = await ctx.db.get(g.profileId);
          if (!p || p.status === "deleted") continue;
          list.push({ profileId: p._id as string, displayName: p.displayName, role: g.role, guest: await isGuest(ctx, folder, p._id), isYou: p._id === profile._id });
        }
        if (list.length) inherited.push({ folderId: above.publicId, folderName: above.name, people: list });
      }
    } else if (info.via) {
      const own = await ctx.db
        .query("folderPermissions")
        .withIndex("by_folder_profile", (q) => q.eq("folderId", info.via!._id).eq("profileId", profile._id))
        .unique();
      if (own) {
        sharedBy = await personName(ctx, own.grantedBy);
        if (own.folderId === folder._id) people.push({ profileId: profile._id as string, displayName: profile.displayName, email: null, role: own.role, guest: true, isYou: true, canChange: false, sharedAt: own.createdAt });
        else inherited.push({ folderId: info.via.publicId, folderName: info.via.name, people: [{ profileId: profile._id as string, displayName: profile.displayName, role: own.role, guest: true, isYou: true }] });
      }
    }
    const pendingInvites = manage
      ? (
          await ctx.db
            .query("folderInvites")
            .withIndex("by_folder", (q) => q.eq("folderId", folder._id))
            .take(200)
        )
          .filter((i) => i.status === "pending")
          .map((i) => ({ id: i.publicId, email: i.email, role: i.role, expiresAt: i.expiresAt, expired: i.expiresAt < Date.now() }))
      : [];
    return {
      folder: { id: folder.publicId, name: folder.name, color: folder.color ?? null },
      yourAccess: info.access,
      /** Add people, change roles, remove people and invitations. */
      canManage: manage,
      /** You're a guest here: the list shows only you. */
      youAreGuest: !info.inScope,
      ownerName: place.ownerName,
      workspaceName: place.workspaceName,
      personal: folder.ownerProfileId !== undefined,
      sharedBy,
      people,
      inherited,
      pendingInvites,
      /** Notes people with access to this folder see through it (its subfolders' included). */
      noteCount: await reachableCount(ctx, folder),
      /** Why it can't be shared as a folder (end-to-end encryption), or null. */
      blocked: await folderShareBlocked(ctx, folder),
    };
  },
});

/** Refuses sharing a folder for anyone but its managers, and an encrypted folder for everyone. */
async function requireManagedFolder(ctx: MutationCtx, profile: Doc<"profiles">, folderId: string) {
  const found = await sharingFolder(ctx, profile, folderId);
  if (!found.manage) fail("forbidden", MANAGE_FORBIDDEN);
  return found;
}

/**
 * Shares a folder (with everything inside it) with someone by email.
 * - A verified Folevi account gets a folder grant right away (in a workspace a non-member is a guest: no seat).
 * - Any other address gets a folder invitation by email: nothing is granted until that person signs in with
 *   the address and accepts it.
 * Only the folder's managers share it; an end-to-end encrypted folder isn't shared as a folder.
 */
export const grant = mutation({
  args: { folderId: v.string(), email: v.string(), role: vShareRole },
  handler: async (ctx, args): Promise<{ status: "shared" | "invited" }> => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { folder } = await requireManagedFolder(ctx, profile, args.folderId);
    const blocked = await folderShareBlocked(ctx, folder);
    if (blocked) fail("forbidden", blocked);
    await consume(ctx, "invite", profile._id);
    const email = args.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) fail("invalid_argument", "Enter a valid email address.");
    if (email === profile.email) fail("invalid_argument", "That's you. You already have access.");
    const target = await ctx.db
      .query("profiles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!target || target.status !== "active" || !target.emailVerified) {
      await inviteFolderByEmail(ctx, profile, folder, email, args.role);
      return { status: "invited" };
    }
    // Someone who already manages everything here (a workspace's owner or admin) needs nothing more.
    if (folder.workspaceId) {
      const m = await membership(ctx, target._id, folder.workspaceId);
      const level = m ? memberLevel(m) : null;
      if (level === "owner" || level === "admin") fail("invalid_argument", "They already manage everything in this workspace.");
    }
    const existing = await ctx.db
      .query("folderPermissions")
      .withIndex("by_folder_profile", (q) => q.eq("folderId", folder._id).eq("profileId", target._id))
      .unique();
    if (existing) {
      if (existing.role !== args.role) {
        await ctx.db.patch(existing._id, { role: args.role });
        await notifyAccessChange(ctx, { recipientId: target._id, actor: profile, change: { type: "folder_role", folder, role: args.role } });
      }
      return { status: "shared" };
    }
    const count = (
      await ctx.db
        .query("folderPermissions")
        .withIndex("by_folder", (q) => q.eq("folderId", folder._id))
        .take(MAX_FOLDER_GRANTS)
    ).length;
    if (count >= MAX_FOLDER_GRANTS) fail("limit_exceeded", "This folder is shared with too many people. Remove some first.");
    await insertScoped(ctx, "folderPermissions", scopeOfRow(folder), { folderId: folder._id, profileId: target._id, role: args.role, grantedBy: profile._id, createdAt: Date.now() });
    await notifyFolderShare(ctx, { recipientId: target._id, actor: profile, folder, role: args.role });
    return { status: "shared" };
  },
});

/**
 * A folder invitation for an address without a (verified, active) account: stored with a hashed token and
 * emailed (the share email, whose link opens /share-invite/folder/<token>). A newer invitation for the same
 * folder and address replaces the older one.
 */
async function inviteFolderByEmail(ctx: MutationCtx, actor: Doc<"profiles">, folder: Doc<"folders">, email: string, role: ShareRole): Promise<void> {
  const existing = await ctx.db
    .query("folderInvites")
    .withIndex("by_folder", (q) => q.eq("folderId", folder._id))
    .take(500);
  const pending = existing.filter((i) => i.status === "pending" && i.expiresAt > Date.now());
  for (const i of existing) if (i.status === "pending" && i.email === email) await ctx.db.patch(i._id, { status: "revoked" });
  if (pending.filter((i) => i.email !== email).length >= MAX_PENDING_FOLDER_INVITES) fail("limit_exceeded", "This folder has too many invitations waiting. Revoke some first.");
  const token = randomToken(32);
  const publicId = ulid();
  const now = Date.now();
  await insertScoped(ctx, "folderInvites", scopeOfRow(folder), {
    publicId,
    folderId: folder._id,
    email,
    role,
    tokenHash: await sha256Hex(token),
    invitedBy: actor._id,
    status: "pending",
    expiresAt: now + FOLDER_INVITE_TTL_MS,
    createdAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
    key: "share_notification",
    to: email,
    idempotencyKey: `folder-invite:${publicId}`,
    dataVariables: {
      actorName: actor.displayName.slice(0, 80),
      documentTitle: `the folder “${(folder.name || "Untitled").slice(0, 100)}”`,
      role: shareRoleLabel(role),
      documentUrl: `${appUrl()}/share-invite/folder/${token}`,
      preferencesUrl: `${appUrl()}/settings/notifications`,
    },
  });
}

/** Changes someone's role on a folder (its managers). */
export const setRole = mutation({
  args: { folderId: v.string(), profileId: v.string(), role: vShareRole },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { folder } = await requireManagedFolder(ctx, profile, args.folderId);
    const pid = ctx.db.normalizeId("profiles", args.profileId);
    const row = pid
      ? await ctx.db
          .query("folderPermissions")
          .withIndex("by_folder_profile", (q) => q.eq("folderId", folder._id).eq("profileId", pid))
          .unique()
      : null;
    if (!row) fail("not_found", "They don't have access to this folder.");
    if (row.role !== args.role) {
      await ctx.db.patch(row._id, { role: args.role });
      await notifyAccessChange(ctx, { recipientId: row.profileId, actor: profile, change: { type: "folder_role", folder, role: args.role } });
    }
    return null;
  },
});

/**
 * Removes someone's access to a folder (its managers), or your own (leaving a folder shared with you). The
 * notes inside go with it, unless they were shared with that person on their own.
 */
export const revoke = mutation({
  args: { folderId: v.string(), profileId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const leaving = args.profileId === (profile._id as string);
    const { folder, manage } = await sharingFolder(ctx, profile, args.folderId);
    if (!manage && !leaving) fail("forbidden", MANAGE_FORBIDDEN);
    const pid = ctx.db.normalizeId("profiles", args.profileId);
    const row = pid
      ? await ctx.db
          .query("folderPermissions")
          .withIndex("by_folder_profile", (q) => q.eq("folderId", folder._id).eq("profileId", pid))
          .unique()
      : null;
    if (row) {
      await ctx.db.delete(row._id);
      if (!leaving) await notifyAccessChange(ctx, { recipientId: row.profileId, actor: profile, change: { type: "folder_revoked", folder } });
    }
    return null;
  },
});

async function folderInviteBy(ctx: Ctx, args: { token?: string; inviteId?: string }): Promise<Doc<"folderInvites"> | null> {
  if (args.token) {
    const hash = await sha256Hex(args.token);
    return await ctx.db
      .query("folderInvites")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", hash))
      .unique();
  }
  if (args.inviteId) {
    const id = args.inviteId;
    return await ctx.db
      .query("folderInvites")
      .withIndex("by_public_id", (q) => q.eq("publicId", id))
      .unique();
  }
  return null;
}

/** Revokes a pending folder invitation (the folder's managers). */
export const revokeInvite = mutation({
  args: { inviteId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const invite = await folderInviteBy(ctx, { inviteId: args.inviteId });
    if (!invite) fail("not_found", "Invitation not found.");
    const folder = await ctx.db.get(invite.folderId);
    if (!folder) fail("not_found", "Invitation not found.");
    await requireManagedFolder(ctx, profile, folder.publicId);
    if (invite.status === "pending") await ctx.db.patch(invite._id, { status: "revoked" });
    return null;
  },
});

/**
 * Whether a folder invitation can still be used: pending, not expired, its folder still there and not
 * encrypted, and the person who sent it still managing the folder.
 */
async function usableFolderInvite(ctx: Ctx, invite: Doc<"folderInvites"> | null): Promise<{ invite: Doc<"folderInvites">; folder: Doc<"folders"> } | null> {
  if (!invite || invite.status !== "pending" || invite.expiresAt < Date.now()) return null;
  const folder = await ctx.db.get(invite.folderId);
  if (!folder || folder.deletedAt !== undefined) return null;
  const inviter = await ctx.db.get(invite.invitedBy);
  if (!inviter || inviter.status !== "active") return null;
  const info = await folderAccessInfo(ctx, inviter, folder);
  if (info.access !== "manage" || !info.inScope) return null;
  if (await folderShareBlocked(ctx, folder)) return null;
  return { invite, folder };
}

/** What /share-invite/folder/<token> shows before accepting. The folder's name only to the invited address. */
export const previewInvite = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const found = await usableFolderInvite(ctx, await folderInviteBy(ctx, { token: args.token }));
    if (!found) return { valid: false as const };
    const { invite, folder } = found;
    const emailMatches = invite.email === profile.email;
    const inviter = await ctx.db.get(invite.invitedBy);
    return {
      valid: true as const,
      emailMatches,
      inviterName: inviter?.displayName ?? "Someone",
      name: emailMatches ? folder.name || "Untitled" : null,
      roleLabel: shareRoleLabel(invite.role),
    };
  },
});

/**
 * Accepts a folder invitation: signed in, with the verified address it was sent to. Creates the folder grant
 * (keeping a higher one they may already have). A guest takes no seat.
 */
export const acceptInvite = mutation({
  args: { token: v.optional(v.string()), inviteId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const raw = await folderInviteBy(ctx, args);
    if (raw && raw.status === "pending" && raw.expiresAt < Date.now()) fail("expired", "This invitation has expired. Ask for a new one.");
    const found = await usableFolderInvite(ctx, raw);
    if (!found) fail("not_found", "This invitation is no longer valid.");
    const { invite, folder } = found;
    if (invite.email !== profile.email) fail("forbidden", "This invitation was sent to a different email address.");
    const existing = await ctx.db
      .query("folderPermissions")
      .withIndex("by_folder_profile", (q) => q.eq("folderId", folder._id).eq("profileId", profile._id))
      .unique();
    if (existing) {
      if (accessRank(roleToAccess(invite.role)) > accessRank(roleToAccess(existing.role))) await ctx.db.patch(existing._id, { role: invite.role });
    } else {
      await insertScoped(ctx, "folderPermissions", scopeOfRow(folder), { folderId: folder._id, profileId: profile._id, role: invite.role, grantedBy: invite.invitedBy, createdAt: Date.now() });
    }
    await ctx.db.patch(invite._id, { status: "accepted", acceptedBy: profile._id });
    const notes = await ctx.db
      .query("notifications")
      .withIndex("by_profile_created", (q) => q.eq("profileId", profile._id))
      .take(200);
    for (const n of notes) if (n.folderInviteId === invite._id && !n.readAt) await ctx.db.patch(n._id, { readAt: Date.now() });
    return { folderId: folder.publicId };
  },
});

/**
 * Declines a folder invitation sent to this person's verified address: it can't be used any more, and its
 * notification goes from the bell. Nobody is told. Declining again (or one already used up) does nothing.
 */
export const declineInvite = mutation({
  args: { token: v.optional(v.string()), inviteId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const invite = await folderInviteBy(ctx, args);
    if (!invite) fail("not_found", "This invitation is no longer valid.");
    if (invite.email !== profile.email) fail("forbidden", "This invitation was sent to a different email address.");
    if (invite.status === "pending") await ctx.db.patch(invite._id, { status: "declined" });
    const id = invite._id;
    await removeInviteNotices(ctx, profile._id, (n) => n.folderInviteId === id);
    return null;
  },
});

const ACCESS_RANK: Record<Access, number> = { none: -1, read: 0, comment: 1, write: 2, manage: 3 };
const accessRank = (a: Access) => ACCESS_RANK[a];

/**
 * Folders shared with the caller, for Shared with Me: each with its place, who shared it, the caller's
 * role and how many notes are in it for them. A folder inside another one shared with them is left out (it
 * opens from there). Folders of their own places (their Personal, a workspace they're in) count too when
 * someone gave them more there.
 */
export const sharedFolders = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const grants = await ctx.db
      .query("folderPermissions")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(200);
    const shared = new Set(grants.map((g) => g.folderId as string));
    const out = [];
    for (const g of grants) {
      const folder = await ctx.db.get(g.folderId);
      if (!folder || folder.deletedAt !== undefined) continue;
      const info = await folderAccessInfo(ctx, profile, folder);
      if (!accessAtLeast(info.access, "read")) continue;
      const above = await folderChain(ctx, folder.parentFolderId, scopeOfRow(folder));
      if (above.some((f) => shared.has(f._id))) continue;
      const place = await placeOf(ctx, folder);
      let updatedAt = folder.updatedAt;
      let noteCount = 0;
      for (const f of await folderSubtree(ctx, folder)) {
        const notes = await listedNotes(ctx, f._id).take(SUBTREE_NOTES);
        for (const d of notes) {
          if (!reachableNote(d)) continue;
          noteCount++;
          updatedAt = Math.max(updatedAt, d.updatedAt);
        }
      }
      out.push({
        id: folder.publicId,
        name: folder.name,
        color: folder.color ?? null,
        role: g.role,
        access: info.access,
        sharedBy: (await personName(ctx, g.grantedBy)) ?? "Someone",
        sharedAt: g.createdAt,
        workspaceName: place.workspaceName,
        ownerName: place.ownerName,
        noteCount,
        updatedAt,
        /** In one of your own places (you could already see it; this raised your access). */
        inYourPlace: info.inScope,
      });
    }
    return out.sort((a, b) => b.sharedAt - a.sharedAt);
  },
});

/**
 * A shared folder opened like a folder: its name and place, the way up as far as the caller can go, its
 * subfolders and the notes in it they can open (most recently edited first). Read only or editable by role:
 * `access` is theirs on the folder; each note's own access is decided as always (documentAccess).
 */
export const open = query({
  args: { folderId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const found = await folderByPublicId(ctx, args.folderId);
    if (!found || found.deletedAt !== undefined) return null;
    const info = await folderAccessInfo(ctx, profile, found);
    if (!accessAtLeast(info.access, "read")) return null;
    const scope = scopeOfRow(found);
    // The way up: the folders above it the caller can open (a guest stops at the folder shared with them).
    const path: { id: string; name: string }[] = [];
    for (const f of await folderChain(ctx, found.parentFolderId, scope)) {
      if (!accessAtLeast((await folderAccessInfo(ctx, profile, f)).access, "read")) break;
      path.unshift({ id: f.publicId, name: f.name });
    }
    const subfolders = [];
    for (const f of await ctx.db
      .query("folders")
      .withIndex("by_parent", (q) => q.eq("parentFolderId", found._id))
      .take(200)) {
      if (f.deletedAt !== undefined || !sameScopeRows(f, found)) continue;
      let noteCount = 0;
      for (const sub of await folderSubtree(ctx, f)) for (const d of await listedNotes(ctx, sub._id).take(SUBTREE_NOTES)) if (reachableNote(d)) noteCount++;
      subfolders.push({ id: f.publicId, name: f.name, color: f.color ?? null, rank: f.rank, noteCount });
    }
    subfolders.sort((a, b) => (a.rank < b.rank ? -1 : 1));
    const notes = [];
    for (const d of await listedNotes(ctx, found._id).take(500)) {
      if (d.kind === "template" || d.kind === "collectionRow") continue;
      const access = await documentAccess(ctx, profile, d);
      if (!accessAtLeast(access, "read")) continue;
      notes.push({
        id: d.publicId,
        title: d.title,
        icon: d.icon ?? null,
        kind: d.kind,
        cover: d.cover,
        excerpt: d.excerpt.slice(0, 280),
        updatedAt: d.updatedAt,
        access,
      });
    }
    const place = await placeOf(ctx, found);
    const own = info.via
      ? await ctx.db
          .query("folderPermissions")
          .withIndex("by_folder_profile", (q) => q.eq("folderId", info.via!._id).eq("profileId", profile._id))
          .unique()
      : null;
    return {
      folder: { id: found.publicId, name: found.name, color: found.color ?? null },
      access: info.access,
      /** In your own place (it also shows in your sidebar). */
      inYourPlace: info.inScope,
      role: own?.role ?? null,
      roleLabel: own ? roleLabel(own.role) : null,
      sharedBy: own ? await personName(ctx, own.grantedBy) : null,
      /** The folder the access comes from (this one, or one above it). */
      sharedFolderId: info.via?.publicId ?? null,
      ownerName: place.ownerName,
      workspaceName: place.workspaceName,
      path,
      subfolders,
      notes,
    };
  },
});

/** The folder a note lives in: its own, or its top-level page's. */
async function homeFolderOf(ctx: Ctx, doc: Doc<"documents">): Promise<{ folderId: Id<"folders"> | undefined; restricted: boolean }> {
  let restricted = false;
  let cursor: Doc<"documents"> | null = doc;
  for (let depth = 0; cursor && depth < 12; depth++) {
    if (cursor.accessMode === "restricted") restricted = true;
    if (cursor.folderId !== undefined) return { folderId: cursor.folderId, restricted };
    cursor = cursor.parentDocumentId ? await ctx.db.get(cursor.parentDocumentId) : null;
  }
  return { folderId: undefined, restricted };
}

/**
 * Access a note has from the folders it's in, for the note's Share dialog: each folder (its own and the
 * ones above it) shared with people, and with whom. People in the note's scope see everyone; a guest only
 * their own. `reason` says why folder access doesn't reach it (a restricted page, an encrypted note).
 */
export const forNote = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc || !accessAtLeast(await documentAccess(ctx, profile, doc), "read")) return null;
    const { folderId, restricted } = await homeFolderOf(ctx, doc);
    if (!folderId) return { folders: [], reason: null };
    if (!folderGrantsReach(doc)) return { folders: [], reason: "encrypted" as const };
    if (restricted) return { folders: [], reason: "restricted" as const };
    const scope = scopeOfRow(doc);
    const inScope = scope.kind === "personal" ? scope.profileId === profile._id : Boolean(await membership(ctx, profile._id, scope.workspaceId));
    const folders = [];
    for (const f of await folderChain(ctx, folderId, scope)) {
      const rows = await ctx.db
        .query("folderPermissions")
        .withIndex("by_folder", (q) => q.eq("folderId", f._id))
        .take(MAX_FOLDER_GRANTS);
      const people = [];
      for (const g of rows) {
        if (!inScope && g.profileId !== profile._id) continue;
        const p = await ctx.db.get(g.profileId);
        if (!p || p.status === "deleted") continue;
        people.push({ profileId: p._id as string, displayName: p.displayName, role: g.role, guest: await isGuest(ctx, f, p._id), isYou: p._id === profile._id });
      }
      if (!people.length) continue;
      const finfo = await folderAccessInfo(ctx, profile, f);
      folders.push({ id: f.publicId, name: f.name, people, canManage: finfo.access === "manage" && finfo.inScope });
    }
    return { folders, reason: null };
  },
});

/** Everyone holding a folder grant on `folderId` or a folder above it. */
async function folderAudience(ctx: Ctx, folderId: Id<"folders"> | undefined, row: Doc<"documents">): Promise<Map<string, ShareRole>> {
  const out = new Map<string, ShareRole>();
  if (!folderId) return out;
  for (const f of await folderChain(ctx, folderId, scopeOfRow(row))) {
    for (const g of await ctx.db
      .query("folderPermissions")
      .withIndex("by_folder", (q) => q.eq("folderId", f._id))
      .take(MAX_FOLDER_GRANTS)) {
      const had = out.get(g.profileId);
      if (!had || accessRank(roleToAccess(g.role)) > accessRank(roleToAccess(had))) out.set(g.profileId, g.role);
    }
  }
  return out;
}

/**
 * Who would gain or lose access if these notes moved to `folderId` (null: Drafts), through folder sharing,
 * so the app can warn before a move changes who can see them. Notes folder access doesn't reach
 * (restricted, encrypted) change nothing. Up to 5 names each way, and the counts.
 */
export const moveCheck = query({
  args: { documentIds: v.array(v.string()), folderId: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const target = args.folderId ? await folderByPublicId(ctx, args.folderId) : null;
    const gains = new Set<string>();
    const loses = new Set<string>();
    for (const id of args.documentIds.slice(0, 50)) {
      const doc = await getDocumentByPublicId(ctx, id);
      if (!doc || !accessAtLeast(await documentAccess(ctx, profile, doc), "write")) continue;
      if (!folderGrantsReach(doc)) continue;
      const home = await homeFolderOf(ctx, doc);
      if (home.restricted) continue;
      if (target && (!sameScopeRows(target, doc) || target.deletedAt !== undefined)) continue;
      const before = await folderAudience(ctx, home.folderId, doc);
      const after = await folderAudience(ctx, target?._id, doc);
      for (const p of after.keys()) if (!before.has(p) && p !== (profile._id as string)) gains.add(p);
      for (const p of before.keys()) if (!after.has(p) && p !== (profile._id as string)) loses.add(p);
    }
    const names = async (ids: Set<string>) => {
      const out: string[] = [];
      for (const id of [...ids].slice(0, 5)) {
        const name = await personName(ctx, id as Id<"profiles">);
        if (name) out.push(name);
      }
      return out;
    };
    return { gainCount: gains.size, loseCount: loses.size, gains: await names(gains), loses: await names(loses) };
  },
});
