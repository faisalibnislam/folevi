import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ulid } from "@folevi/editor-schema";
import { accessAtLeast, assertWritable, documentAccess, requireDocument, requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";
import { hashSharePassword, keyedHash, randomToken, sha256Hex, timingSafeEqualHex } from "./lib/crypto";
import { consume } from "./lib/rateLimit";
import { liveBlocks, toWireBlock } from "./lib/documents";
import { notify } from "./lib/notify";
import { vShareRole } from "./lib/validators";

async function flagEnabled(ctx: { db: import("./_generated/server").QueryCtx["db"] }, key: string, fallback: boolean): Promise<boolean> {
  const row = await ctx.db
    .query("featureFlags")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  return row ? row.enabled : fallback;
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
      publicLinksAvailable: await flagEnabled(ctx, "public_links", true),
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
    else await ctx.db.insert("documentPermissions", { documentId: doc._id, workspaceId: doc.workspaceId, profileId: target._id, role: args.role, grantedBy: profile._id, createdAt: Date.now() });
    await notify(ctx, {
      recipientId: target._id,
      actor: profile,
      kind: existing ? "share_change" : "share",
      doc,
      title: `${profile.displayName} shared ${doc.title || "Untitled"} with you`,
      email: existing ? undefined : { key: "share_notification", role: args.role },
    });
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
    if (row) await ctx.db.delete(row._id);
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
      const ws = await ctx.db.get(d.workspaceId);
      out.push({ id: d.publicId, title: d.title, icon: d.icon ?? null, role: g.role, sharedBy: by?.displayName ?? "Someone", sharedAt: g.createdAt, workspaceName: ws?.name ?? "", updatedAt: d.updatedAt, excerpt: d.excerpt });
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
    if (!(await flagEnabled(ctx, "public_links", true))) fail("forbidden", "Public links are turned off for Folevi right now.");
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
    await ctx.db.insert("publicLinks", {
      publicId,
      documentId: doc._id,
      workspaceId: doc.workspaceId,
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
    if (!(await flagEnabled(ctx, "public_links", true))) return { status: "unavailable" as const };
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(args.token)) return { status: "not_found" as const };
    const tokenHash = await sha256Hex(args.token);
    const found = await ctx.db
      .query("publicLinks")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!found || found.revokedAt) return { status: "not_found" as const };
    if (found.expiresAt !== undefined && found.expiresAt < Date.now()) return { status: "expired" as const };
    const doc = await ctx.db.get(found.documentId);
    const workspace = doc ? await ctx.db.get(doc.workspaceId) : null;
    if (!doc || doc.inTrash || !workspace || workspace.status !== "active") return { status: "not_found" as const };
    if (found.passwordHash) {
      if (!args.password) return { status: "password_required" as const };
      await consume(ctx, "publicLinkPassword", `${client}:${found._id}`);
      const { hash } = await hashSharePassword(args.password, found.passwordSalt);
      if (!timingSafeEqualHex(hash, found.passwordHash)) return { status: "password_incorrect" as const };
    }
    await ctx.db.patch(found._id, { viewCount: found.viewCount + 1 });
    const blocks = (await liveBlocks(ctx, doc._id)).map(toWireBlock);
    return {
      status: "ok" as const,
      document: { title: doc.title, icon: doc.icon ?? null, style: doc.style, cover: doc.cover, updatedAt: doc.updatedAt },
      blocks: blocks.filter((b) => b.type !== "collection"),
      allowIndexing: found.allowIndexing,
    };
  },
});
