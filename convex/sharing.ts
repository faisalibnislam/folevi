import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ulid } from "@folevi/editor-schema";
import { accessAtLeast, assertWritable, documentAccess, requireDocument, requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";
import { hashSharePassword, keyedHash, randomToken, sha256Hex, timingSafeEqualHex } from "./lib/crypto";
import { consume } from "./lib/rateLimit";
import { liveBlocks, toWireBlock } from "./lib/documents";
import { signFileUrl } from "./lib/fileUrls";
import { notify, notifyAccessChange, notifyAccessLostOnRestrict } from "./lib/notify";
import { vShareRole } from "./lib/validators";
import { isFeatureEnabled } from "./lib/flags";
import { insertScoped, scopeOfRow } from "./lib/scope";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

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

export const get = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { doc, access } = await requireDocument(ctx, profile, args.documentId, "read");
    const grants = await ctx.db
      .query("documentPermissions")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .collect();
    const people = [];
    for (const g of grants) {
      const p = await ctx.db.get(g.profileId);
      if (p) people.push({ profileId: p._id as string, displayName: p.displayName, email: accessAtLeast(access, "manage") ? p.email : null, role: g.role });
    }
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
      people,
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

/** Grants a Folevi account access to one document (and its nested pages). */
export const grant = mutation({
  args: { documentId: v.string(), email: v.string(), role: vShareRole },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "manage");
    await consume(ctx, "invite", profile._id);
    const email = args.email.trim().toLowerCase();
    const target = await ctx.db
      .query("profiles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    // Same response whether or not the address exists would hide account existence, but the person
    // sharing needs actionable feedback; only workspace editors can reach this path.
    if (!target || target.status !== "active" || !target.emailVerified) {
      fail("not_found", "There's no verified Folevi account for that address. Invite them to the workspace instead.");
    }
    const existing = await ctx.db
      .query("documentPermissions")
      .withIndex("by_document_profile", (q) => q.eq("documentId", doc._id).eq("profileId", target._id))
      .unique();
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
    return null;
  },
});

export const revoke = mutation({
  args: { documentId: v.string(), profileId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "manage");
    const pid = ctx.db.normalizeId("profiles", args.profileId);
    const row = pid
      ? await ctx.db
          .query("documentPermissions")
          .withIndex("by_document_profile", (q) => q.eq("documentId", doc._id).eq("profileId", pid))
          .unique()
      : null;
    if (row) {
      await ctx.db.delete(row._id);
      await notifyAccessChange(ctx, { recipientId: row.profileId, actor: profile, change: { type: "document_revoked", doc } });
    }
    return null;
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
