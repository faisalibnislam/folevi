import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { ulid } from "@folevi/editor-schema";
import {
  accessAtLeast,
  assertWritable,
  documentAccess,
  documentAccessInfo,
  getDocumentByPublicId,
  maxShareRoleFor,
  membership,
  requireDocument,
  requireProfile,
  shareRoleAtMost,
  type DocumentAccessInfo,
  type ShareRole,
} from "./lib/auth";
import { fail } from "./lib/errors";
import { hashSharePassword, keyedHash, randomToken, sha256Hex, timingSafeEqualHex } from "./lib/crypto";
import { consume } from "./lib/rateLimit";
import { liveBlocks, toWireBlock } from "./lib/documents";
import { signFileUrl } from "./lib/fileUrls";
import { appUrl, notify, notifyAccessChange, notifyAccessLostOnRestrict, shareRoleLabel } from "./lib/notify";
import { sharePermissions } from "./lib/permissions";
import { vShareRole } from "./lib/validators";
import { isFeatureEnabled } from "./lib/flags";
import { insertScoped, scopeOfRow } from "./lib/scope";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/** A read-only snapshot of a collection embedded in a publicly shared page. */
export interface PublicCollection {
  name: string;
  viewType: "table" | "board" | "gallery";
  config: Doc<"collectionViews">["config"];
  properties: { id: string; name: string; type: Doc<"collectionProperties">["type"]; options: Doc<"collectionProperties">["options"] }[];
  rows: { id: string; title: string; icon: string | null; values: Record<string, unknown> }[];
}

/**
 * Collections hosted by the shared page, as the view the block points at. Row titles and property
 * values are part of what the page shows; relation values are reduced to a count (linked pages aren't
 * shared) and people to display names.
 */
async function publicCollections(ctx: MutationCtx, doc: Doc<"documents">, blocks: { type: string; props: Record<string, unknown> }[]): Promise<Record<string, PublicCollection>> {
  const out: Record<string, PublicCollection> = {};
  for (const b of blocks) {
    if (b.type !== "collection" || typeof b.props.collectionId !== "string" || out[b.props.collectionId]) continue;
    const publicId = b.props.collectionId;
    const collection = await ctx.db
      .query("collections")
      .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
      .unique();
    if (!collection || collection.deletedAt || collection.documentId !== doc._id) continue;
    const props = (
      await ctx.db
        .query("collectionProperties")
        .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
        .collect()
    )
      .filter((p) => !p.deletedAt)
      .sort((a, b2) => (a.rank < b2.rank ? -1 : 1));
    const views = (
      await ctx.db
        .query("collectionViews")
        .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
        .collect()
    ).sort((a, b2) => (a.rank < b2.rank ? -1 : 1));
    const view = views.find((vw) => vw.publicId === b.props.viewId) ?? views[0];
    if (!view) continue;
    const byId = new Map(props.map((p) => [p._id as string, p]));
    const names = new Map<string, string>();
    const rows: PublicCollection["rows"] = [];
    const rowDocs = (
      await ctx.db
        .query("collectionRows")
        .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
        .take(1000)
    )
      .filter((r) => !r.deletedAt)
      .sort((a, b2) => (a.rank < b2.rank ? -1 : 1))
      .slice(0, 500);
    for (const r of rowDocs) {
      const rowDoc = await ctx.db.get(r.documentId);
      if (!rowDoc || rowDoc.inTrash) continue;
      const values: Record<string, unknown> = {};
      for (const val of await ctx.db
        .query("collectionValues")
        .withIndex("by_row", (q) => q.eq("rowId", r._id))
        .collect()) {
        const prop = byId.get(val.propertyId);
        if (!prop) continue;
        if (prop.type === "relation") values[prop.publicId] = Array.isArray(val.value) ? val.value.length : 0;
        else if (prop.type === "person" && typeof val.value === "string") {
          if (!names.has(val.value)) {
            const pid = ctx.db.normalizeId("profiles", val.value);
            const person = pid ? await ctx.db.get(pid) : null;
            names.set(val.value, person && person.status !== "deleted" ? person.displayName : "Former member");
          }
          values[prop.publicId] = names.get(val.value);
        } else values[prop.publicId] = val.value;
      }
      rows.push({ id: r.publicId, title: rowDoc.title, icon: rowDoc.icon ?? null, values });
    }
    out[publicId] = {
      name: collection.name,
      viewType: view.type,
      config: view.config,
      properties: props.map((p) => ({ id: p.publicId, name: p.name, type: p.type, options: p.options })),
      rows,
    };
  }
  return out;
}

/** Whether a page's scope still serves public links: an active workspace, or a Personal whose account is in good standing. */
async function scopeIsOpen(ctx: MutationCtx, doc: Doc<"documents">): Promise<boolean> {
  if (doc.ownerProfileId) {
    const owner = await ctx.db.get(doc.ownerProfileId);
    return Boolean(owner && (owner.status === "active" || owner.status === "pending_deletion"));
  }
  const workspace = doc.workspaceId ? await ctx.db.get(doc.workspaceId) : null;
  return Boolean(workspace && workspace.status === "active");
}

/** A page and how the caller stands on it; anything they can't open reads as not found. */
async function sharingTarget(ctx: QueryCtx, profile: Doc<"profiles">, documentId: string): Promise<{ doc: Doc<"documents">; info: DocumentAccessInfo; manage: boolean; share: boolean }> {
  const doc = await getDocumentByPublicId(ctx, documentId);
  if (!doc) fail("not_found", "Document not found.");
  const info = await documentAccessInfo(ctx, profile, doc);
  if (info.access === "none") fail("not_found", "Document not found.");
  return { doc, info, ...sharePermissions(info) };
}

/** The grant `profile` holds on `doc` or the nearest page above it (what a guest was given). */
async function nearestGrant(ctx: QueryCtx, profile: Doc<"profiles">, doc: Doc<"documents">): Promise<Doc<"documentPermissions"> | null> {
  let cursor: Doc<"documents"> | null = doc;
  for (let depth = 0; cursor && depth < 12; depth++) {
    const current: Doc<"documents"> = cursor;
    const g = await ctx.db
      .query("documentPermissions")
      .withIndex("by_document_profile", (q) => q.eq("documentId", current._id).eq("profileId", profile._id))
      .unique();
    if (g) return g;
    cursor = current.parentDocumentId ? await ctx.db.get(current.parentDocumentId) : null;
  }
  return null;
}

const personName = async (ctx: QueryCtx, id: Id<"profiles"> | undefined) => {
  const p = id ? await ctx.db.get(id) : null;
  return p && p.status !== "deleted" ? p.displayName : null;
};

/**
 * The Share dialog. What it shows depends on who's asking:
 * - people in the page's scope (its Personal's owner, or members of its workspace) see everyone the page
 *   was shared with, marked as guests when they aren't members; emails only for the page's managers;
 * - a guest sees only their own access, the page's owner and who shared it with them — never the other
 *   people it's shared with.
 * Public links and the access mode are for the page's managers; pending email invitations for the people
 * who may see them (managers: all; members who share: their own).
 */
export const get = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { doc, info, manage, share } = await sharingTarget(ctx, profile, args.documentId);
    const access = info.access;
    const scope = scopeOfRow(doc);
    const ownerName = await personName(ctx, scope.kind === "personal" ? scope.profileId : doc.createdBy);
    const people = [];
    let sharedBy: string | null = null;
    if (info.inScope) {
      const grants = await ctx.db
        .query("documentPermissions")
        .withIndex("by_document", (q) => q.eq("documentId", doc._id))
        .collect();
      for (const g of grants) {
        const p = await ctx.db.get(g.profileId);
        if (!p || p.status === "deleted") continue;
        const guest = scope.kind === "personal" || !(await membership(ctx, p._id, scope.workspaceId));
        people.push({
          profileId: p._id as string,
          displayName: p.displayName,
          email: manage ? p.email : null,
          role: g.role,
          /** Not a member of the page's workspace (everyone in a Personal page's list is a guest). */
          guest,
          isYou: p._id === profile._id,
          /** Whether you may change or remove this grant (managers: any; members: the ones they made). */
          canChange: manage || (share && g.grantedBy === profile._id),
        });
      }
    } else {
      // A guest: only their own grant here, and who gave it.
      const own = await nearestGrant(ctx, profile, doc);
      if (own) sharedBy = await personName(ctx, own.grantedBy);
      if (own && own.documentId === doc._id) {
        people.push({ profileId: profile._id as string, displayName: profile.displayName, email: null, role: own.role, guest: true, isYou: true, canChange: false });
      }
    }
    const pendingInvites =
      manage || share
        ? (
            await ctx.db
              .query("pageInvites")
              .withIndex("by_document", (q) => q.eq("documentId", doc._id))
              .collect()
          )
            .filter((i) => i.status === "pending" && (manage || i.invitedBy === profile._id))
            .map((i) => ({ id: i.publicId, email: i.email, role: i.role, expiresAt: i.expiresAt, expired: i.expiresAt < Date.now() }))
        : [];
    const links = accessAtLeast(access, "manage")
      ? (
          await ctx.db
            .query("publicLinks")
            .withIndex("by_document", (q) => q.eq("documentId", doc._id))
            .collect()
        )
          .filter((l) => !l.revokedAt)
          .map((l) => ({
            id: l.publicId,
            tokenHint: l.tokenHint,
            expiresAt: l.expiresAt ?? null,
            expired: l.expiresAt !== undefined && l.expiresAt < Date.now(),
            hasPassword: Boolean(l.passwordHash),
            allowIndexing: l.allowIndexing,
            viewCount: l.viewCount,
            createdAt: l.createdAt,
          }))
      : [];
    return {
      accessMode: doc.accessMode,
      yourAccess: access,
      /** Access mode, public links and anyone's grants. */
      canManage: manage,
      /** Adding people (up to `maxRole`) and changing the grants and invitations you made. */
      canShare: share,
      maxRole: share ? maxShareRoleFor(access) : null,
      /** You're a guest here: the list shows only you. */
      youAreGuest: !info.inScope,
      /** Whose page it is: the Personal's owner, or the page's creator in a workspace. */
      ownerName,
      /** For a guest: who shared it with them. */
      sharedBy,
      people,
      pendingInvites,
      links,
      publicLinksAvailable: await isFeatureEnabled(ctx, "public_links"),
    };
  },
});

export const setAccessMode = mutation({
  args: { documentId: v.string(), mode: v.union(v.literal("workspace"), v.literal("restricted")) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "manage");
    await ctx.db.patch(doc._id, { accessMode: args.mode, updatedAt: Date.now() });
    if (args.mode === "restricted" && doc.accessMode !== "restricted") await notifyAccessLostOnRestrict(ctx, profile, doc);
    return null;
  },
});

const SHARE_FORBIDDEN = "You can share this page only if you can edit it and it isn't restricted. Ask a workspace admin.";
/** How long an emailed page invitation stays valid. */
export const PAGE_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Pending page invitations one page can have at once. */
const MAX_PENDING_PAGE_INVITES = 50;
const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i;

/** Refuses a role above what the caller may give (a member gives at most their own access). */
function assertRoleAllowed(info: DocumentAccessInfo, manage: boolean, role: ShareRole) {
  if (manage) return;
  const max = maxShareRoleFor(info.access);
  if (!max || !shareRoleAtMost(role, max)) fail("forbidden", "You can't give more access than you have.");
}

/**
 * Shares one page (and its nested pages) with someone by email.
 * - A verified Folevi account gets a page grant right away (in a workspace, a non-member is a guest: no
 *   seat).
 * - Any other address gets a page invitation by email (`pageInvites`): it grants nothing until that person
 *   signs in with the address and accepts it.
 * Who may share: the page's managers (any role), and workspace members who can edit a page that isn't
 * restricted (up to Can edit; they can't change grants others made). Guests can't share.
 */
export const grant = mutation({
  args: { documentId: v.string(), email: v.string(), role: vShareRole },
  handler: async (ctx, args): Promise<{ status: "shared" | "invited" }> => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc, info, manage, share } = await sharingTarget(ctx, profile, args.documentId);
    if (!share) fail("forbidden", SHARE_FORBIDDEN);
    assertRoleAllowed(info, manage, args.role);
    await consume(ctx, "invite", profile._id);
    const email = args.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) fail("invalid_argument", "Enter a valid email address.");
    if (email === profile.email) fail("invalid_argument", "That's you — you already have access.");
    const target = await ctx.db
      .query("profiles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!target || target.status !== "active" || !target.emailVerified) {
      await invitePageByEmail(ctx, profile, doc, email, args.role);
      return { status: "invited" };
    }
    const existing = await ctx.db
      .query("documentPermissions")
      .withIndex("by_document_profile", (q) => q.eq("documentId", doc._id).eq("profileId", target._id))
      .unique();
    if (existing && !manage && existing.grantedBy !== profile._id) fail("forbidden", "Someone else already shared this page with them. A workspace admin can change their access.");
    if (existing) await ctx.db.patch(existing._id, { role: args.role });
    else await insertScoped(ctx, "documentPermissions", scopeOfRow(doc), { documentId: doc._id, profileId: target._id, role: args.role, grantedBy: profile._id, createdAt: Date.now() });
    if (existing) {
      if (existing.role !== args.role) {
        await notifyAccessChange(ctx, { recipientId: target._id, actor: profile, change: { type: "document_role", doc, role: args.role } });
      }
    } else {
      await notify(ctx, {
        recipientId: target._id,
        actor: profile,
        kind: "share",
        doc,
        title: `${profile.displayName} shared ${doc.title || "Untitled"} with you`,
        email: { key: "share_notification", role: args.role },
      });
    }
    return { status: "shared" };
  },
});

/**
 * A page invitation for an address without a (verified, active) account: stored with a hashed token and
 * emailed (the share email, whose link opens /share-invite/<token>). A newer invitation for the same page
 * and address replaces the older one.
 */
async function invitePageByEmail(ctx: MutationCtx, actor: Doc<"profiles">, doc: Doc<"documents">, email: string, role: ShareRole): Promise<void> {
  const existing = await ctx.db
    .query("pageInvites")
    .withIndex("by_document", (q) => q.eq("documentId", doc._id))
    .collect();
  const pending = existing.filter((i) => i.status === "pending" && i.expiresAt > Date.now());
  for (const i of existing) if (i.status === "pending" && i.email === email) await ctx.db.patch(i._id, { status: "revoked" });
  if (pending.filter((i) => i.email !== email).length >= MAX_PENDING_PAGE_INVITES) fail("limit_exceeded", "This page has too many invitations waiting. Revoke some first.");
  const token = randomToken(32);
  const publicId = ulid();
  const now = Date.now();
  await insertScoped(ctx, "pageInvites", scopeOfRow(doc), {
    publicId,
    documentId: doc._id,
    email,
    role,
    tokenHash: await sha256Hex(token),
    invitedBy: actor._id,
    status: "pending",
    expiresAt: now + PAGE_INVITE_TTL_MS,
    createdAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
    key: "share_notification",
    to: email,
    idempotencyKey: `page-invite:${publicId}`,
    dataVariables: {
      actorName: actor.displayName.slice(0, 80),
      documentTitle: (doc.title || "Untitled").slice(0, 120),
      role: shareRoleLabel(role),
      documentUrl: `${appUrl()}/share-invite/${token}`,
      preferencesUrl: `${appUrl()}/settings/notifications`,
    },
  });
}

/** Removes someone's grant on a page (managers: anyone's; members who share: the grants they made). */
export const revoke = mutation({
  args: { documentId: v.string(), profileId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc, manage, share } = await sharingTarget(ctx, profile, args.documentId);
    if (!share) fail("forbidden", SHARE_FORBIDDEN);
    const pid = ctx.db.normalizeId("profiles", args.profileId);
    const row = pid
      ? await ctx.db
          .query("documentPermissions")
          .withIndex("by_document_profile", (q) => q.eq("documentId", doc._id).eq("profileId", pid))
          .unique()
      : null;
    if (row) {
      if (!manage && row.grantedBy !== profile._id) fail("forbidden", "Only a workspace admin can remove access someone else gave.");
      await ctx.db.delete(row._id);
      await notifyAccessChange(ctx, { recipientId: row.profileId, actor: profile, change: { type: "document_revoked", doc } });
    }
    return null;
  },
});

async function pageInviteBy(ctx: QueryCtx, args: { token?: string; inviteId?: string }): Promise<Doc<"pageInvites"> | null> {
  if (args.token) {
    const hash = await sha256Hex(args.token);
    return await ctx.db
      .query("pageInvites")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", hash))
      .unique();
  }
  if (args.inviteId) {
    const id = args.inviteId;
    return await ctx.db
      .query("pageInvites")
      .withIndex("by_public_id", (q) => q.eq("publicId", id))
      .unique();
  }
  return null;
}

/** Revokes a pending page invitation (managers: any; members: the ones they sent). */
export const revokePageInvite = mutation({
  args: { inviteId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const invite = await pageInviteBy(ctx, { inviteId: args.inviteId });
    if (!invite) fail("not_found", "Invitation not found.");
    const doc = await ctx.db.get(invite.documentId);
    if (!doc) fail("not_found", "Invitation not found.");
    const { manage, share } = await sharingTarget(ctx, profile, doc.publicId);
    if (!manage && !(share && invite.invitedBy === profile._id)) fail("forbidden", "Only a workspace admin can revoke an invitation someone else sent.");
    if (invite.status === "pending") await ctx.db.patch(invite._id, { status: "revoked" });
    return null;
  },
});

/**
 * Whether a page invitation can still be used: pending, not expired, its page still there, and the person
 * who sent it still allowed to share it at that level (someone removed from the workspace, or whose
 * access dropped, can't hand out access through an old invitation).
 */
async function usablePageInvite(ctx: QueryCtx, invite: Doc<"pageInvites"> | null): Promise<{ invite: Doc<"pageInvites">; doc: Doc<"documents"> } | null> {
  if (!invite || invite.status !== "pending" || invite.expiresAt < Date.now()) return null;
  const doc = await ctx.db.get(invite.documentId);
  if (!doc || doc.inTrash) return null;
  const inviter = await ctx.db.get(invite.invitedBy);
  if (!inviter || inviter.status !== "active") return null;
  const info = await documentAccessInfo(ctx, inviter, doc);
  const perms = sharePermissions(info);
  if (!perms.share) return null;
  const max = maxShareRoleFor(info.access);
  if (!perms.manage && (!max || !shareRoleAtMost(invite.role, max))) return null;
  return { invite, doc };
}

/** What /share-invite/<token> shows before accepting. The page's title only to the invited address. */
export const previewPageInvite = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const found = await usablePageInvite(ctx, await pageInviteBy(ctx, { token: args.token }));
    if (!found) return { valid: false as const };
    const { invite, doc } = found;
    const emailMatches = invite.email === profile.email;
    const inviter = await ctx.db.get(invite.invitedBy);
    return {
      valid: true as const,
      emailMatches,
      inviterName: inviter?.displayName ?? "Someone",
      title: emailMatches ? doc.title || "Untitled" : null,
      roleLabel: shareRoleLabel(invite.role),
    };
  },
});

/**
 * Accepts a page invitation: signed in, with the verified address it was sent to. Creates the page grant
 * (keeping a higher one they may already have). A guest takes no seat.
 */
export const acceptPageInvite = mutation({
  args: { token: v.optional(v.string()), inviteId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const raw = await pageInviteBy(ctx, args);
    // (Housekeeping marks it expired; a failed mutation couldn't store that anyway.)
    if (raw && raw.status === "pending" && raw.expiresAt < Date.now()) fail("expired", "This invitation has expired. Ask for a new one.");
    const found = await usablePageInvite(ctx, raw);
    if (!found) fail("not_found", "This invitation is no longer valid.");
    const { invite, doc } = found;
    if (invite.email !== profile.email) fail("forbidden", "This invitation was sent to a different email address.");
    const existing = await ctx.db
      .query("documentPermissions")
      .withIndex("by_document_profile", (q) => q.eq("documentId", doc._id).eq("profileId", profile._id))
      .unique();
    if (existing) {
      if (!shareRoleAtMost(invite.role, existing.role)) await ctx.db.patch(existing._id, { role: invite.role });
    } else {
      await insertScoped(ctx, "documentPermissions", scopeOfRow(doc), { documentId: doc._id, profileId: profile._id, role: invite.role, grantedBy: invite.invitedBy, createdAt: Date.now() });
    }
    await ctx.db.patch(invite._id, { status: "accepted", acceptedBy: profile._id });
    const notes = await ctx.db
      .query("notifications")
      .withIndex("by_profile_created", (q) => q.eq("profileId", profile._id))
      .take(200);
    for (const n of notes) if (n.pageInviteId === invite._id && !n.readAt) await ctx.db.patch(n._id, { readAt: Date.now() });
    return { documentId: doc.publicId };
  },
});

export const sharedWithMe = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const grants = await ctx.db
      .query("documentPermissions")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(500);
    const out = [];
    for (const g of grants) {
      const d = await ctx.db.get(g.documentId);
      if (!d || d.inTrash) continue;
      if (!accessAtLeast(await documentAccess(ctx, profile, d), "read")) continue;
      const by = await ctx.db.get(g.grantedBy);
      // Where it lives: a team workspace (its name), or someone's Personal (whose).
      const ws = d.workspaceId ? await ctx.db.get(d.workspaceId) : null;
      const owner = d.ownerProfileId ? await ctx.db.get(d.ownerProfileId) : null;
      out.push({
        id: d.publicId,
        title: d.title,
        icon: d.icon ?? null,
        role: g.role,
        sharedBy: by?.displayName ?? "Someone",
        sharedAt: g.createdAt,
        workspaceName: ws?.name ?? null,
        ownerName: owner && owner.status !== "deleted" ? owner.displayName : null,
        updatedAt: d.updatedAt,
        excerpt: d.excerpt,
      });
    }
    return out.sort((a, b) => b.sharedAt - a.sharedAt);
  },
});

// ---------------------------------------------------------------- public links

/** Creates an unguessable public link. The raw token is returned exactly once; only its hash is stored. */
export const createPublicLink = mutation({
  args: { documentId: v.string(), expiresAt: v.optional(v.number()), password: v.optional(v.string()), allowIndexing: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "manage");
    if (!(await isFeatureEnabled(ctx, "public_links"))) fail("forbidden", "Public links are turned off for Folevi right now.");
    if (args.expiresAt !== undefined && args.expiresAt <= Date.now()) fail("invalid_argument", "Choose an expiry in the future.");
    let passwordHash: string | undefined;
    let passwordSalt: string | undefined;
    if (args.password) {
      if (args.password.length < 8 || args.password.length > 200) fail("invalid_argument", "Use a password of at least 8 characters.");
      const h = await hashSharePassword(args.password);
      passwordHash = h.hash;
      passwordSalt = h.salt;
    }
    const token = randomToken(32);
    const publicId = ulid();
    await insertScoped(ctx, "publicLinks", scopeOfRow(doc), {
      publicId,
      documentId: doc._id,
      tokenHash: await sha256Hex(token),
      tokenHint: token.slice(0, 4),
      expiresAt: args.expiresAt,
      passwordHash,
      passwordSalt,
      allowIndexing: args.allowIndexing ?? false,
      createdBy: profile._id,
      createdAt: Date.now(),
      viewCount: 0,
    });
    return { id: publicId, token };
  },
});

export const revokePublicLink = mutation({
  args: { linkId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const link = await ctx.db
      .query("publicLinks")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.linkId))
      .unique();
    if (!link) fail("not_found", "Link not found.");
    const doc = (await ctx.db.get(link.documentId))!;
    await requireDocument(ctx, profile, doc.publicId, "manage");
    if (!link.revokedAt) await ctx.db.patch(link._id, { revokedAt: Date.now() });
    return null;
  },
});

/**
 * Resolves a public link for the share page. Called only by the Next.js server route, which proves
 * itself with FOLEVI_SERVER_SECRET and passes a client key (hashed IP) for rate limiting.
 */
export const openPublicLink = mutation({
  args: { token: v.string(), password: v.optional(v.string()), serverSecret: v.string(), clientKey: v.string() },
  handler: async (ctx, args) => {
    const secret = process.env.FOLEVI_SERVER_SECRET;
    if (!secret || args.serverSecret.length !== secret.length || !timingSafeEqualHex(args.serverSecret, secret)) {
      fail("forbidden", "Not allowed.");
    }
    const client = await keyedHash(args.clientKey, "client");
    await consume(ctx, "publicLinkOpen", client);
    if (!(await isFeatureEnabled(ctx, "public_links"))) return { status: "unavailable" as const };
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(args.token)) return { status: "not_found" as const };
    const tokenHash = await sha256Hex(args.token);
    const found = await ctx.db
      .query("publicLinks")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!found || found.revokedAt) return { status: "not_found" as const };
    if (found.expiresAt !== undefined && found.expiresAt < Date.now()) return { status: "expired" as const };
    const doc = await ctx.db.get(found.documentId);
    if (!doc || doc.inTrash || !(await scopeIsOpen(ctx, doc))) return { status: "not_found" as const };
    if (found.passwordHash) {
      if (!args.password) return { status: "password_required" as const };
      await consume(ctx, "publicLinkPassword", `${client}:${found._id}`);
      const { hash } = await hashSharePassword(args.password, found.passwordSalt);
      if (!timingSafeEqualHex(hash, found.passwordHash)) return { status: "password_incorrect" as const };
    }
    await ctx.db.patch(found._id, { viewCount: found.viewCount + 1 });
    const blocks = (await liveBlocks(ctx, doc._id)).map(toWireBlock);
    const collections = await publicCollections(ctx, doc, blocks as { type: string; props: Record<string, unknown> }[]);
    // Attachments of this document only, via short-lived signed URLs.
    const site = process.env.CONVEX_SITE_URL ?? "";
    const exp = Date.now() + 60 * 60_000;
    const fileUrls: Record<string, string> = {};
    for (const b of blocks) {
      const fileId = (b.props as { fileId?: unknown }).fileId;
      if (typeof fileId !== "string") continue;
      const file = await ctx.db
        .query("files")
        .withIndex("by_public_id", (q) => q.eq("publicId", fileId))
        .unique();
      if (!file || file.documentId !== doc._id || file.status !== "ready") continue;
      fileUrls[fileId] = `${site}/files/${fileId}?exp=${exp}&sig=${await signFileUrl(`${fileId}:${exp}`)}`;
    }
    // The note's own style image, if it has one (only a file stored with this document).
    let coverUrl: string | null = null;
    let coverPalette: Doc<"files">["palette"] | null = null;
    if (doc.cover.kind === "image" && doc.cover.value) {
      const coverId = doc.cover.value;
      const file = await ctx.db
        .query("files")
        .withIndex("by_public_id", (q) => q.eq("publicId", coverId))
        .unique();
      if (file && file.documentId === doc._id && file.status === "ready") {
        coverUrl = `${site}/files/${coverId}?exp=${exp}&sig=${await signFileUrl(`${coverId}:${exp}`)}`;
        coverPalette = file.palette ?? null;
      }
    }
    return {
      status: "ok" as const,
      document: { title: doc.title, icon: doc.icon ?? null, style: doc.style, cover: doc.cover, coverUrl, coverPalette, updatedAt: doc.updatedAt },
      blocks,
      fileUrls,
      collections,
      allowIndexing: found.allowIndexing,
    };
  },
});
