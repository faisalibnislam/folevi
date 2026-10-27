// The Vault's items (docs/VAULT_PLAN.md §4, §5): password items (login, API key, card…) and, from vaultFiles.ts,
// notes and files. Each item is two records sealed on the device under its own item key: a summary (what lists
// show) and its secrets. Lists get summaries only; the secrets come from `open`, which the server logs itself, so
// "who opened what" can't be left out by a modified browser. Every change keeps the version before it.
import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertWritable, requireIdentity, requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";
import { consume } from "./lib/rateLimit";
import { insertScoped, scopeOfRow } from "./lib/scope";
import { requireVault, vaultRoleAtLeast, type VaultRole } from "./lib/vault/access";
import { appendLog } from "./lib/vault/log";
import { vVaultClient } from "./lib/vault/validators";
import { vVaultItemKind } from "./schema";

type Ctx = QueryCtx | MutationCtx;

/** Password items (their own section); notes and files live in Files & Notes. */
export const PASSWORD_KINDS = ["login", "apiKey", "card", "bankAccount", "secureNote", "sshKey", "wifi", "licence", "identity"] as const;

const MAX_SUMMARY = 8 * 1024;
const MAX_SECRET = 256 * 1024;
const MAX_KEY = 1024;
const IMPORT_BATCH = 100;
const EXPORT_PAGE = 500;
/** Field names a change may name for the log (letters, digits and a few separators). */
const FIELD_NAME = /^[\w .:-]{1,60}$/;

export const vSealedItem = v.object({
  sealedSummary: v.bytes(),
  sealed: v.bytes(),
  wrappedKey: v.bytes(),
  keyVersion: v.number(),
  passwordMac: v.optional(v.string()),
});

export function checkSealed(i: { sealedSummary: ArrayBuffer; sealed: ArrayBuffer; wrappedKey: ArrayBuffer; passwordMac?: string }) {
  if (i.sealedSummary.byteLength < 28 || i.sealedSummary.byteLength > MAX_SUMMARY) fail("invalid_argument", "Invalid item.");
  if (i.sealed.byteLength < 28 || i.sealed.byteLength > MAX_SECRET) fail("invalid_argument", "This item is too big.");
  if (i.wrappedKey.byteLength < 28 || i.wrappedKey.byteLength > MAX_KEY) fail("invalid_argument", "Invalid item.");
  if (i.passwordMac !== undefined && !/^[\w-]{22}$/.test(i.passwordMac)) fail("invalid_argument", "Invalid item.");
}

/** Items are sealed under the Vault's current key; anything else is a stale device. */
export function checkKeyVersion(vault: Doc<"vaults">, keyVersion: number) {
  if (keyVersion !== vault.keyVersion) fail("conflict", "The Vault's key changed. Open it again.");
}

export async function itemOf(ctx: Ctx, vault: Doc<"vaults">, itemId: string): Promise<Doc<"vaultItems">> {
  const item = await ctx.db
    .query("vaultItems")
    .withIndex("by_public_id", (q) => q.eq("publicId", itemId))
    .unique();
  if (!item || item.vaultId !== vault._id) fail("not_found", "Item not found.");
  return item;
}

/** Members change what they added; custodians anything (docs/VAULT_PLAN.md §1). */
export function requireCanChange(role: VaultRole, item: Doc<"vaultItems">, profileId: Id<"profiles">) {
  if (item.createdBy !== profileId && !vaultRoleAtLeast(role, "custodian")) fail("forbidden", "You can change only what you added. Ask a custodian.");
}

const nameOf = async (ctx: Ctx, id: Id<"profiles">) => (await ctx.db.get(id))?.displayName ?? "Someone";

/** What a list row carries: the sealed summary, never the secrets. */
export async function row(ctx: Ctx, i: Doc<"vaultItems">) {
  return {
    id: i.publicId,
    kind: i.kind,
    folderId: i.folderId ?? null,
    sealedSummary: i.sealedSummary,
    wrappedKey: i.wrappedKey,
    keyVersion: i.keyVersion,
    passwordMac: i.passwordMac ?? null,
    revision: i.revision,
    createdBy: { id: i.createdBy as string, name: await nameOf(ctx, i.createdBy) },
    updatedBy: { id: i.updatedBy as string, name: await nameOf(ctx, i.updatedBy) },
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    deletedAt: i.deletedAt ?? null,
    size: i.size ?? null,
  };
}

/**
 * A section's items (summaries only): the password items, or Files & Notes in a folder, or the Vault's Trash.
 */
export const list = query({
  args: { vaultId: v.string(), section: v.union(v.literal("passwords"), v.literal("files"), v.literal("trash")), folderId: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    let items: Doc<"vaultItems">[] = [];
    if (args.section === "passwords") {
      for (const kind of PASSWORD_KINDS)
        items.push(
          ...(await ctx.db
            .query("vaultItems")
            .withIndex("by_vault_kind", (q) => q.eq("vaultId", vault._id).eq("kind", kind))
            .take(5000)),
        );
      items = items.filter((i) => i.deletedAt === undefined);
    } else if (args.section === "files") {
      let folderId: Id<"vaultFolders"> | undefined;
      if (args.folderId) {
        const folder = await ctx.db
          .query("vaultFolders")
          .withIndex("by_public_id", (q) => q.eq("publicId", args.folderId!))
          .unique();
        if (!folder || folder.vaultId !== vault._id) fail("not_found", "Folder not found.");
        folderId = folder._id;
      }
      items = (
        await ctx.db
          .query("vaultItems")
          .withIndex("by_vault_folder", (q) => q.eq("vaultId", vault._id).eq("folderId", folderId))
          .take(5000)
      ).filter((i) => (i.kind === "note" || i.kind === "file") && i.deletedAt === undefined);
    } else {
      for (const kind of [...PASSWORD_KINDS, "note", "file"] as const)
        items.push(
          ...(
            await ctx.db
              .query("vaultItems")
              .withIndex("by_vault_kind", (q) => q.eq("vaultId", vault._id).eq("kind", kind))
              .take(5000)
          ).filter((i) => i.deletedAt !== undefined),
        );
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    return { items: await Promise.all(items.map((i) => row(ctx, i))), keyVersion: vault.keyVersion, role };
  },
});

/** An item's secrets, for showing it. Logged as the server saw it (an item opened). */
export const open = mutation({
  args: { vaultId: v.string(), itemId: v.string(), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    const item = await itemOf(ctx, vault, args.itemId);
    await appendLog(ctx, vault, { event: "item.open", actor: { profile, role }, item: { publicId: item.publicId, kind: item.kind }, client: args.client });
    return { ...(await row(ctx, item)), sealed: item.sealed, canChange: item.createdBy === profile._id || vaultRoleAtLeast(role, "custodian") };
  },
});

/** A new password item (anyone in the Vault). The device sealed it under the current vault key. */
export const create = mutation({
  args: { vaultId: v.string(), itemId: v.string(), kind: vVaultItemKind, item: vSealedItem, client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    if (!(PASSWORD_KINDS as readonly string[]).includes(args.kind)) fail("invalid_argument", "Notes and files are added in Files & Notes.");
    if (!/^[0-9A-Z]{26}$/.test(args.itemId)) fail("invalid_argument", "Invalid item id.");
    checkSealed(args.item);
    checkKeyVersion(vault, args.item.keyVersion);
    const taken = await ctx.db
      .query("vaultItems")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.itemId))
      .unique();
    if (taken) fail("conflict", "That item already exists.");
    await consume(ctx, "vaultWrite", profile._id);
    const now = Date.now();
    await insertScoped(ctx, "vaultItems", scopeOfRow(vault), {
      publicId: args.itemId,
      vaultId: vault._id,
      kind: args.kind,
      sealedSummary: args.item.sealedSummary,
      sealed: args.item.sealed,
      wrappedKey: args.item.wrappedKey,
      keyVersion: args.item.keyVersion,
      ...(args.item.passwordMac ? { passwordMac: args.item.passwordMac } : {}),
      revision: 1,
      createdBy: profile._id,
      updatedBy: profile._id,
      createdAt: now,
      updatedAt: now,
    });
    await appendLog(ctx, vault, { event: "item.created", actor: { profile, role }, item: { publicId: args.itemId, kind: args.kind }, client: args.client });
    return null;
  },
});

/** Keeps the item as it is now in its history, before a change. */
export async function keepVersion(ctx: MutationCtx, item: Doc<"vaultItems">) {
  await insertScoped(ctx, "vaultItemVersions", scopeOfRow(item), {
    itemId: item._id,
    vaultId: item.vaultId,
    revision: item.revision,
    sealedSummary: item.sealedSummary,
    sealed: item.sealed,
    wrappedKey: item.wrappedKey,
    keyVersion: item.keyVersion,
    editedBy: item.updatedBy,
    editedAt: item.updatedAt,
  });
}

/**
 * A change to an item (who added it, or a custodian). `baseRevision` is the revision the device edited, so a change
 * made meanwhile elsewhere isn't overwritten; `changed` names the fields (never their values) for the log.
 */
export const update = mutation({
  args: { vaultId: v.string(), itemId: v.string(), baseRevision: v.number(), item: vSealedItem, changed: v.array(v.string()), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    const item = await itemOf(ctx, vault, args.itemId);
    requireCanChange(role, item, profile._id);
    if (item.deletedAt !== undefined) fail("conflict", "This item is in the Vault's Trash. Restore it first.");
    if (args.baseRevision !== item.revision) fail("conflict", "Someone changed this item meanwhile. Open it again.");
    if (args.changed.length > 40 || args.changed.some((f) => !FIELD_NAME.test(f))) fail("invalid_argument", "Invalid field names.");
    checkSealed(args.item);
    checkKeyVersion(vault, args.item.keyVersion);
    await consume(ctx, "vaultWrite", profile._id);
    await keepVersion(ctx, item);
    const now = Date.now();
    await ctx.db.patch(item._id, {
      sealedSummary: args.item.sealedSummary,
      sealed: args.item.sealed,
      wrappedKey: args.item.wrappedKey,
      keyVersion: args.item.keyVersion,
      passwordMac: args.item.passwordMac,
      revision: item.revision + 1,
      updatedBy: profile._id,
      updatedAt: now,
    });
    await appendLog(ctx, vault, { event: "item.edited", actor: { profile, role }, item: { publicId: item.publicId, kind: item.kind }, detail: { fields: [...new Set(args.changed)].sort(), revision: item.revision + 1 }, client: args.client });
    return { revision: item.revision + 1 };
  },
});

/** An item's earlier versions (who changed it, when), sealed; seeing them is logged. */
export const history = mutation({
  args: { vaultId: v.string(), itemId: v.string(), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    const item = await itemOf(ctx, vault, args.itemId);
    const versions = await ctx.db
      .query("vaultItemVersions")
      .withIndex("by_item", (q) => q.eq("itemId", item._id))
      .order("desc")
      .take(200);
    await appendLog(ctx, vault, { event: "history.view", actor: { profile, role }, item: { publicId: item.publicId, kind: item.kind }, detail: { versions: versions.length }, client: args.client });
    return await Promise.all(
      versions.map(async (x) => ({ revision: x.revision, sealedSummary: x.sealedSummary, sealed: x.sealed, wrappedKey: x.wrappedKey, keyVersion: x.keyVersion, editedBy: await nameOf(ctx, x.editedBy), editedAt: x.editedAt })),
    );
  },
});

/** Brings an earlier version back (as a new change, so nothing is lost). */
export const restoreVersion = mutation({
  args: { vaultId: v.string(), itemId: v.string(), revision: v.number(), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    const item = await itemOf(ctx, vault, args.itemId);
    requireCanChange(role, item, profile._id);
    const old = await ctx.db
      .query("vaultItemVersions")
      .withIndex("by_item", (q) => q.eq("itemId", item._id).eq("revision", args.revision))
      .unique();
    if (!old) fail("not_found", "That version is gone.");
    await keepVersion(ctx, item);
    await ctx.db.patch(item._id, { sealedSummary: old.sealedSummary, sealed: old.sealed, wrappedKey: old.wrappedKey, keyVersion: old.keyVersion, revision: item.revision + 1, updatedBy: profile._id, updatedAt: Date.now() });
    await appendLog(ctx, vault, { event: "item.versionRestored", actor: { profile, role }, item: { publicId: item.publicId, kind: item.kind }, detail: { from: args.revision, revision: item.revision + 1 }, client: args.client });
    return null;
  },
});

/** To the Vault's Trash (who added it, or a custodian); kept 30 days. */
export const remove = mutation({
  args: { vaultId: v.string(), itemId: v.string(), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    const item = await itemOf(ctx, vault, args.itemId);
    requireCanChange(role, item, profile._id);
    if (item.deletedAt !== undefined) return null;
    await ctx.db.patch(item._id, { deletedAt: Date.now() });
    await appendLog(ctx, vault, { event: "item.deleted", actor: { profile, role }, item: { publicId: item.publicId, kind: item.kind }, client: args.client });
    return null;
  },
});

/** Back from the Vault's Trash. */
export const restore = mutation({
  args: { vaultId: v.string(), itemId: v.string(), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    const item = await itemOf(ctx, vault, args.itemId);
    requireCanChange(role, item, profile._id);
    if (item.deletedAt === undefined) return null;
    // Its folder went to Trash meanwhile: it comes back at the top of Files & Notes.
    const folder = item.folderId ? await ctx.db.get(item.folderId) : null;
    await ctx.db.patch(item._id, { deletedAt: undefined, ...(folder && folder.deletedAt !== undefined ? { folderId: undefined } : {}) });
    await appendLog(ctx, vault, { event: "item.restored", actor: { profile, role }, item: { publicId: item.publicId, kind: item.kind }, client: args.client });
    return null;
  },
});

/**
 * One batch of an import (up to 100 items, sealed on the device). Each batch is one log entry with its count and
 * the source app's name; the import's id ties the batches together.
 */
export const importBatch = mutation({
  args: { vaultId: v.string(), importId: v.string(), source: v.string(), items: v.array(v.object({ itemId: v.string(), kind: vVaultItemKind, item: vSealedItem })), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    if (!args.items.length || args.items.length > IMPORT_BATCH) fail("invalid_argument", `Import up to ${IMPORT_BATCH} items at a time.`);
    if (!/^[\w .-]{1,40}$/.test(args.source)) fail("invalid_argument", "Invalid source.");
    await consume(ctx, "vaultWrite", profile._id);
    const now = Date.now();
    for (const it of args.items) {
      if (!(PASSWORD_KINDS as readonly string[]).includes(it.kind)) fail("invalid_argument", "Only password items can be imported.");
      if (!/^[0-9A-Z]{26}$/.test(it.itemId)) fail("invalid_argument", "Invalid item id.");
      checkSealed(it.item);
      checkKeyVersion(vault, it.item.keyVersion);
      await insertScoped(ctx, "vaultItems", scopeOfRow(vault), {
        publicId: it.itemId,
        vaultId: vault._id,
        kind: it.kind,
        sealedSummary: it.item.sealedSummary,
        sealed: it.item.sealed,
        wrappedKey: it.item.wrappedKey,
        keyVersion: it.item.keyVersion,
        ...(it.item.passwordMac ? { passwordMac: it.item.passwordMac } : {}),
        revision: 1,
        createdBy: profile._id,
        updatedBy: profile._id,
        createdAt: now,
        updatedAt: now,
      });
    }
    await appendLog(ctx, vault, { event: "items.imported", actor: { profile, role }, detail: { importId: args.importId.slice(0, 40), source: args.source, count: args.items.length }, client: args.client });
    return null;
  },
});

/**
 * One page of every password item with its secrets, for an export (custodians; the owner of a Personal Vault).
 * Starting an export (`after` null) is logged with its format.
 */
export const exportPage = mutation({
  args: { vaultId: v.string(), after: v.union(v.string(), v.null()), format: v.union(v.literal("encrypted"), v.literal("csv")), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId, "custodian");
    const all: Doc<"vaultItems">[] = [];
    for (const kind of PASSWORD_KINDS)
      all.push(
        ...(
          await ctx.db
            .query("vaultItems")
            .withIndex("by_vault_kind", (q) => q.eq("vaultId", vault._id).eq("kind", kind))
            .take(5000)
        ).filter((i) => i.deletedAt === undefined),
      );
    all.sort((a, b) => (a.publicId < b.publicId ? -1 : 1));
    const start = args.after ? all.findIndex((i) => i.publicId > args.after!) : 0;
    const page = start < 0 ? [] : all.slice(start, start + EXPORT_PAGE);
    if (args.after === null) await appendLog(ctx, vault, { event: "items.exported", actor: { profile, role }, detail: { format: args.format, count: all.length }, client: args.client });
    return {
      items: await Promise.all(page.map(async (i) => ({ ...(await row(ctx, i)), sealed: i.sealed }))),
      next: start >= 0 && start + EXPORT_PAGE < all.length ? page.at(-1)!.publicId : null,
    };
  },
});

/** How many items in the Vault share each password (by its blind index), for Health's "reused". */
export const reuse = query({
  args: { vaultId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { vault } = await requireVault(ctx, profile, args.vaultId);
    const counts: Record<string, number> = {};
    for (const kind of PASSWORD_KINDS)
      for (const i of await ctx.db
        .query("vaultItems")
        .withIndex("by_vault_kind", (q) => q.eq("vaultId", vault._id).eq("kind", kind))
        .take(5000))
        if (i.passwordMac && i.deletedAt === undefined) counts[i.passwordMac] = (counts[i.passwordMac] ?? 0) + 1;
    return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 1));
  },
});

/**
 * Pwned Passwords' range for a 5-character SHA-1 prefix (k-anonymity: the password, and the rest of its hash,
 * never leave the device; the match happens there). The reply is padded. Signed in only.
 */
export const breachRange = action({
  args: { prefix: v.string() },
  handler: async (ctx, args): Promise<string[]> => {
    await requireIdentity(ctx);
    if (!/^[0-9A-F]{5}$/.test(args.prefix)) fail("invalid_argument", "Invalid prefix.");
    const res = await fetch(`https://api.pwnedpasswords.com/range/${args.prefix}`, { headers: { "Add-Padding": "true", "User-Agent": "Folevi Vault health" } }).catch(() => null);
    if (!res?.ok) return [];
    return (await res.text())
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[0-9A-F]{35}:[1-9]\d*$/i.test(line))
      .map((line) => line.slice(0, 35).toUpperCase());
  },
});
