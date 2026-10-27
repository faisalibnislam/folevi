// Sharing a vault item (docs/VAULT_PLAN.md §6). With a person outside the Vault (a workspace member, or someone
// outside the workspace with a Folevi account, then with an expiry): the item key sealed to their account key; they
// open just that item from Shared with Me. And one-time secret links: the item key wrapped by a key that lives only
// in the link's fragment, working 1 to 10 times until it expires, its wrapped key deleted once used up. Folders are
// never shared. Every share, open, edit and end is logged in the Vault's log.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertWritable, membership, requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";
import { hashSharePassword, keyedHash, timingSafeEqualHex } from "./lib/crypto";
import { consume } from "./lib/rateLimit";
import { activeAccount } from "./lib/e2ee/keyStore";
import { insertScoped, scopeOfRow } from "./lib/scope";
import { requireVault, vaultRoleOf } from "./lib/vault/access";
import { appendLog } from "./lib/vault/log";
import { notifyVaultChange, notifyVaultSecurity } from "./lib/vault/notify";
import { vVaultClient } from "./lib/vault/validators";
import { checkSealed, itemOf, keepVersion, requireCanChange, row } from "./vaultItems";

type Ctx = QueryCtx | MutationCtx;

const DAY = 24 * 60 * 60 * 1000;
/** Shares with people outside the workspace must end; 30 days unless chosen, a year at most. */
export const OUTSIDE_DEFAULT_DAYS = 30;
const MAX_SHARE_MS = 365 * DAY;
const LINK_MIN_MS = 60 * 60 * 1000;
const LINK_MAX_MS = 30 * DAY;
const ID = /^[0-9A-Z]{26}$/;

async function shareOf(ctx: Ctx, shareId: string): Promise<Doc<"vaultShares"> | null> {
  return await ctx.db
    .query("vaultShares")
    .withIndex("by_public_id", (q) => q.eq("publicId", shareId))
    .unique();
}

const live = (s: Doc<"vaultShares">, now = Date.now()) => s.expiresAt === undefined || s.expiresAt > now;

/**
 * Shares an item with one person (who added it, or a custodian). The device sealed the item key to their account
 * key. Someone outside the workspace gets an expiry (30 days unless chosen).
 */
export const share = mutation({
  args: { vaultId: v.string(), itemId: v.string(), shareId: v.string(), profileId: v.string(), canEdit: v.boolean(), wrappedKey: v.bytes(), epoch: v.number(), expiresAt: v.optional(v.number()), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    const item = await itemOf(ctx, vault, args.itemId);
    requireCanChange(role, item, profile._id);
    if (item.deletedAt !== undefined) fail("conflict", "This item is in the Vault's Trash.");
    if (!ID.test(args.shareId)) fail("invalid_argument", "Invalid share id.");
    if (args.canEdit && item.kind !== "note") fail("invalid_argument", "Only notes can be shared to edit.");
    const targetId = ctx.db.normalizeId("profiles", args.profileId);
    const target = targetId ? await ctx.db.get(targetId) : null;
    if (!target || target.status !== "active" || target._id === profile._id) fail("not_found", "Choose someone else.");
    if (await vaultRoleOf(ctx, target, vault)) fail("invalid_argument", "They're in the Vault already.");
    const account = await activeAccount(ctx, target._id);
    if (!account) fail("invalid_argument", "They need to set up encryption in Folevi before something can be shared with them securely.");
    if (account.epoch !== args.epoch) fail("conflict", "Their encryption key changed. Try again.");
    if (args.wrappedKey.byteLength < 32 || args.wrappedKey.byteLength > 4096) fail("invalid_argument", "Invalid key data.");
    const now = Date.now();
    const outside = !vault.workspaceId || !(await membership(ctx, target._id, vault.workspaceId));
    let expiresAt = args.expiresAt;
    if (expiresAt !== undefined && (expiresAt <= now || expiresAt > now + MAX_SHARE_MS)) fail("invalid_argument", "Choose an end date within a year.");
    if (outside && expiresAt === undefined) expiresAt = now + OUTSIDE_DEFAULT_DAYS * DAY;
    // One share per person and item: sharing again replaces it.
    for (const old of await ctx.db
      .query("vaultShares")
      .withIndex("by_item", (q) => q.eq("itemId", item._id))
      .collect())
      if (old.profileId === target._id) await ctx.db.delete(old._id);
    await insertScoped(ctx, "vaultShares", scopeOfRow(vault), { publicId: args.shareId, vaultId: vault._id, itemId: item._id, profileId: target._id, canEdit: args.canEdit, wrappedKey: args.wrappedKey, epoch: args.epoch, ...(expiresAt ? { expiresAt } : {}), sharedBy: profile._id, createdAt: now });
    await appendLog(ctx, vault, { event: "item.shared", actor: { profile, role }, item: { publicId: item.publicId, kind: item.kind }, detail: { to: { profileId: target._id, name: target.displayName, email: target.email }, canEdit: args.canEdit, outsideWorkspace: outside, expiresAt: expiresAt ?? null }, client: args.client });
    if (outside) await notifyVaultSecurity(ctx, vault, profile, `${profile.displayName.slice(0, 80)} shared something from the Vault with someone outside the workspace`, "share.outside");
    return { expiresAt: expiresAt ?? null };
  },
});

/** An item's shares and links (who added it, or a custodian), for its Share panel. */
export const ofItem = query({
  args: { vaultId: v.string(), itemId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    const item = await itemOf(ctx, vault, args.itemId);
    requireCanChange(role, item, profile._id);
    const now = Date.now();
    const people = [];
    for (const s of await ctx.db
      .query("vaultShares")
      .withIndex("by_item", (q) => q.eq("itemId", item._id))
      .collect()) {
      const p = await ctx.db.get(s.profileId);
      people.push({ id: s.publicId, profileId: s.profileId as string, name: p?.displayName ?? "Someone", email: p?.email ?? null, canEdit: s.canEdit, expiresAt: s.expiresAt ?? null, expired: !live(s, now), sharedAt: s.createdAt });
    }
    const links = (
      await ctx.db
        .query("vaultLinks")
        .withIndex("by_item", (q) => q.eq("itemId", item._id))
        .collect()
    ).map((l) => ({ id: l.publicId, maxViews: l.maxViews, views: l.views, expiresAt: l.expiresAt, hasPassword: l.passwordHash !== undefined, endedHow: l.endedHow ?? (l.expiresAt <= now ? "expired" : null), createdAt: l.createdAt }));
    return { people, links };
  },
});

/** Ends a share (who added the item, or a custodian). The device then gives the item a new key (vaultItems.update). */
export const unshare = mutation({
  args: { vaultId: v.string(), shareId: v.string(), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    const s = await shareOf(ctx, args.shareId);
    if (!s || s.vaultId !== vault._id) fail("not_found", "Share not found.");
    const item = (await ctx.db.get(s.itemId))!;
    requireCanChange(role, item, profile._id);
    const p = await ctx.db.get(s.profileId);
    await ctx.db.delete(s._id);
    await appendLog(ctx, vault, { event: "share.ended", actor: { profile, role }, item: { publicId: item.publicId, kind: item.kind }, detail: { to: { profileId: s.profileId, name: p?.displayName ?? "Someone" } }, client: args.client });
    return null;
  },
});

/** Vault items shared with the caller, still open (Shared with Me). Summaries only. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const now = Date.now();
    const out = [];
    for (const s of await ctx.db
      .query("vaultShares")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(500)) {
      if (!live(s, now)) continue;
      const item = await ctx.db.get(s.itemId);
      const vault = await ctx.db.get(s.vaultId);
      if (!item || !vault || item.deletedAt !== undefined) continue;
      const by = await ctx.db.get(s.sharedBy);
      out.push({ shareId: s.publicId, vaultId: vault.publicId, itemId: item.publicId, kind: item.kind, sealedSummary: item.sealedSummary, wrappedKey: s.wrappedKey, canEdit: s.canEdit, expiresAt: s.expiresAt ?? null, sharedBy: by?.displayName ?? "Someone", sharedAt: s.createdAt, updatedAt: item.updatedAt });
    }
    return out;
  },
});

async function requireShare(ctx: Ctx, profileId: Id<"profiles">, shareId: string) {
  const s = await shareOf(ctx, shareId);
  if (!s || s.profileId !== profileId || !live(s)) fail("not_found", "This was unshared or has ended.");
  const item = await ctx.db.get(s.itemId);
  const vault = await ctx.db.get(s.vaultId);
  if (!item || !vault || item.deletedAt !== undefined) fail("not_found", "This was unshared or has ended.");
  return { s, item, vault };
}

/** Opens an item shared with the caller (its secrets). Logged in the Vault's log as the recipient. */
export const openShared = mutation({
  args: { shareId: v.string(), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { s, item, vault } = await requireShare(ctx, profile._id, args.shareId);
    await appendLog(ctx, vault, { event: "share.opened", actor: { profile, role: "recipient" }, item: { publicId: item.publicId, kind: item.kind }, client: args.client });
    return { ...(await row(ctx, item)), sealed: item.sealed, wrappedKey: s.wrappedKey, vaultId: vault.publicId, canEdit: s.canEdit };
  },
});

/** Saves a shared note the recipient may edit (sealed under the same item key). The version before is kept. */
export const saveShared = mutation({
  args: { shareId: v.string(), baseRevision: v.number(), sealedSummary: v.bytes(), sealed: v.bytes(), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { s, item, vault } = await requireShare(ctx, profile._id, args.shareId);
    if (!s.canEdit || item.kind !== "note") fail("forbidden", "This was shared with you to read.");
    if (args.baseRevision !== item.revision) fail("conflict", "Someone changed this note meanwhile. Open it again.");
    checkSealed({ sealedSummary: args.sealedSummary, sealed: args.sealed, wrappedKey: item.wrappedKey });
    await keepVersion(ctx, item);
    await ctx.db.patch(item._id, { sealedSummary: args.sealedSummary, sealed: args.sealed, revision: item.revision + 1, updatedBy: profile._id, updatedAt: Date.now() });
    await appendLog(ctx, vault, { event: "note.edited", actor: { profile, role: "recipient" }, item: { publicId: item.publicId, kind: item.kind }, detail: { revision: item.revision + 1, viaShare: true }, client: args.client });
    await notifyVaultChange(ctx, vault, profile, { what: "note", verb: "changed" });
    return { revision: item.revision + 1 };
  },
});

/**
 * A one-time secret link (who added the item, or a custodian): the item key wrapped by the link's own key (only in
 * the URL's fragment), working `maxViews` times (1 to 10) until it expires (1 hour to 30 days), optionally with a
 * password too.
 */
export const createLink = mutation({
  args: { vaultId: v.string(), itemId: v.string(), linkId: v.string(), wrappedKey: v.bytes(), maxViews: v.number(), expiresInMs: v.number(), password: v.optional(v.string()), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    const item = await itemOf(ctx, vault, args.itemId);
    requireCanChange(role, item, profile._id);
    if (item.deletedAt !== undefined) fail("conflict", "This item is in the Vault's Trash.");
    if (!/^[A-Za-z0-9_-]{22,40}$/.test(args.linkId)) fail("invalid_argument", "Invalid link id.");
    if (!Number.isInteger(args.maxViews) || args.maxViews < 1 || args.maxViews > 10) fail("invalid_argument", "A link works 1 to 10 times.");
    if (!(args.expiresInMs >= LINK_MIN_MS && args.expiresInMs <= LINK_MAX_MS)) fail("invalid_argument", "A link lasts 1 hour to 30 days.");
    if (args.wrappedKey.byteLength < 32 || args.wrappedKey.byteLength > 1024) fail("invalid_argument", "Invalid key data.");
    if (args.password !== undefined && (args.password.length < 5 || args.password.length > 200)) fail("invalid_argument", "Use a password of at least 5 characters.");
    const pw = args.password ? await hashSharePassword(args.password) : null;
    const now = Date.now();
    await insertScoped(ctx, "vaultLinks", scopeOfRow(vault), { publicId: args.linkId, vaultId: vault._id, itemId: item._id, wrappedKey: args.wrappedKey, maxViews: args.maxViews, views: 0, expiresAt: now + args.expiresInMs, ...(pw ? { passwordHash: pw.hash, passwordSalt: pw.salt } : {}), createdBy: profile._id, createdAt: now });
    await appendLog(ctx, vault, { event: "link.created", actor: { profile, role }, item: { publicId: item.publicId, kind: item.kind }, detail: { linkId: args.linkId.slice(0, 8), maxViews: args.maxViews, expiresAt: now + args.expiresInMs, password: pw !== null }, client: args.client });
    return { expiresAt: now + args.expiresInMs };
  },
});

async function linkOf(ctx: Ctx, linkId: string) {
  return await ctx.db
    .query("vaultLinks")
    .withIndex("by_public_id", (q) => q.eq("publicId", linkId))
    .unique();
}

async function endLink(ctx: MutationCtx, link: Doc<"vaultLinks">, how: "usedUp" | "revoked" | "expired") {
  await ctx.db.patch(link._id, { wrappedKey: undefined, endedAt: Date.now(), endedHow: how });
}

/** Ends a link before it's used up (who added the item, or a custodian). */
export const revokeLink = mutation({
  args: { vaultId: v.string(), linkId: v.string(), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    const link = await linkOf(ctx, args.linkId);
    if (!link || link.vaultId !== vault._id) fail("not_found", "Link not found.");
    const item = (await ctx.db.get(link.itemId))!;
    requireCanChange(role, item, profile._id);
    if (link.endedAt) return null;
    await endLink(ctx, link, "revoked");
    await appendLog(ctx, vault, { event: "link.revoked", actor: { profile, role }, item: { publicId: item.publicId, kind: item.kind }, detail: { linkId: link.publicId.slice(0, 8), views: link.views }, client: args.client });
    return null;
  },
});

/**
 * Opens a one-time link, for the link page's server route (FOLEVI_SERVER_SECRET and a hashed client key for rate
 * limits; nobody needs to be signed in). Answers, never throws, so every try stays in the log: "gone" (used up,
 * revoked, expired), "password" (one is needed or it was wrong), or the item, sealed, with its key wrapped by the
 * link's key, which only the link's fragment opens. The last allowed view deletes the wrapped key.
 */
export const openLink = mutation({
  args: { linkId: v.string(), password: v.optional(v.string()), serverSecret: v.string(), clientKey: v.string() },
  handler: async (ctx, args) => {
    const secret = process.env.FOLEVI_SERVER_SECRET;
    if (!secret || args.serverSecret.length !== secret.length || !timingSafeEqualHex(args.serverSecret, secret)) fail("forbidden", "Not allowed.");
    const client = await keyedHash(args.clientKey, "client");
    await consume(ctx, "publicLinkOpen", client);
    const link = /^[A-Za-z0-9_-]{22,40}$/.test(args.linkId) ? await linkOf(ctx, args.linkId) : null;
    if (!link) return { status: "gone" as const };
    const vault = await ctx.db.get(link.vaultId);
    const item = await ctx.db.get(link.itemId);
    if (!vault || !item) return { status: "gone" as const };
    const who = { profile: null, role: "link" as const, name: "Someone with the link" };
    const asItem = { publicId: item.publicId, kind: item.kind };
    const now = Date.now();
    if (!link.endedAt && link.expiresAt <= now) {
      await endLink(ctx, link, "expired");
      await appendLog(ctx, vault, { event: "link.expired", actor: who, item: asItem, detail: { linkId: link.publicId.slice(0, 8), views: link.views } });
    }
    if (link.endedAt || link.expiresAt <= now || !link.wrappedKey || item.deletedAt !== undefined) {
      await appendLog(ctx, vault, { event: "link.opened", outcome: "failed", reason: "gone", actor: who, item: asItem, detail: { client } });
      return { status: "gone" as const };
    }
    if (link.passwordHash) {
      if (!args.password) return { status: "password" as const, wrong: false };
      await consume(ctx, "publicLinkPassword", `${client}:${link._id}`);
      const { hash } = await hashSharePassword(args.password, link.passwordSalt!);
      if (!timingSafeEqualHex(hash, link.passwordHash)) {
        await appendLog(ctx, vault, { event: "link.opened", outcome: "failed", reason: "wrong_password", actor: who, item: asItem, detail: { client } });
        return { status: "password" as const, wrong: true };
      }
    }
    const views = link.views + 1;
    const wrappedKey = link.wrappedKey;
    await ctx.db.patch(link._id, { views });
    await appendLog(ctx, vault, { event: "link.opened", actor: who, item: asItem, detail: { linkId: link.publicId.slice(0, 8), view: views, of: link.maxViews, client } });
    if (views >= link.maxViews) {
      await endLink(ctx, { ...link, views }, "usedUp");
      await appendLog(ctx, vault, { event: "link.usedUp", actor: who, item: asItem, detail: { linkId: link.publicId.slice(0, 8), views } });
    }
    return { status: "ok" as const, vaultId: vault.publicId, itemId: item.publicId, kind: item.kind, sealedSummary: item.sealedSummary, sealed: item.sealed, wrappedKey, viewsLeft: Math.max(0, link.maxViews - views) };
  },
});
