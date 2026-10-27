// The Vault's Files & Notes (docs/VAULT_PLAN.md §5): folders (names sealed, never shared), notes (their content is
// the item's secrets record, kept version by version) and files of any kind (encrypted on the device with their own
// file key; only ciphertext is stored, and it counts toward the place's storage). Opening, downloading, moving in
// and out, and the Vault's Trash are all logged. Password items are in vaultItems.ts, which this shares checks with.
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertWritable, requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";
import { consume } from "./lib/rateLimit";
import { insertScoped, scopeOfRow } from "./lib/scope";
import { adjustStorageUsed, assertStorageFor } from "./lib/entitlements";
import { requireVault, vaultRoleAtLeast } from "./lib/vault/access";
import { appendLog } from "./lib/vault/log";
import { notifyVaultChange, notifyVaultSecurity } from "./lib/vault/notify";
import { vVaultClient } from "./lib/vault/validators";
import { checkKeyVersion, checkSealed, itemOf, keepVersion, requireCanChange, vSealedItem } from "./vaultItems";

type Ctx = QueryCtx | MutationCtx;

/** Days an item stays in the Vault's Trash before it's gone for good. */
export const TRASH_DAYS = 30;
const MAX_FILE = 2 * 1024 * 1024 * 1024;
const MAX_FOLDER_NAME = 1024;
const MAX_DEPTH = 8;
const ID = /^[0-9A-Z]{26}$/;

async function folderOf(ctx: Ctx, vault: Doc<"vaults">, folderId: string): Promise<Doc<"vaultFolders">> {
  const folder = await ctx.db
    .query("vaultFolders")
    .withIndex("by_public_id", (q) => q.eq("publicId", folderId))
    .unique();
  if (!folder || folder.vaultId !== vault._id || folder.deletedAt !== undefined) fail("not_found", "Folder not found.");
  return folder;
}

/** A folder to put something in (or none: the top of Files & Notes). */
async function targetFolder(ctx: Ctx, vault: Doc<"vaults">, folderId: string | null | undefined): Promise<Id<"vaultFolders"> | undefined> {
  return folderId ? (await folderOf(ctx, vault, folderId))._id : undefined;
}

/** The folders above one, nearest first. */
async function ancestors(ctx: Ctx, folder: Doc<"vaultFolders">): Promise<Doc<"vaultFolders">[]> {
  const out: Doc<"vaultFolders">[] = [];
  let cursor = folder.parentFolderId ? await ctx.db.get(folder.parentFolderId) : null;
  while (cursor && out.length < 32) {
    out.push(cursor);
    cursor = cursor.parentFolderId ? await ctx.db.get(cursor.parentFolderId) : null;
  }
  return out;
}

function checkName(sealedName: ArrayBuffer) {
  if (sealedName.byteLength < 28 || sealedName.byteLength > MAX_FOLDER_NAME) fail("invalid_argument", "Invalid folder name.");
}

/** Every live folder of the Vault (names sealed), for the tree. */
export const folders = query({
  args: { vaultId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { vault } = await requireVault(ctx, profile, args.vaultId);
    const rows = [];
    for await (const f of ctx.db.query("vaultFolders").withIndex("by_vault_parent", (q) => q.eq("vaultId", vault._id))) {
      if (f.deletedAt !== undefined) continue;
      const parent = f.parentFolderId ? await ctx.db.get(f.parentFolderId) : null;
      rows.push({ id: f.publicId, parentId: parent?.publicId ?? null, sealedName: f.sealedName, keyVersion: f.keyVersion, createdBy: f.createdBy as string, updatedAt: f.updatedAt });
      if (rows.length >= 2000) break;
    }
    return rows;
  },
});

/** A new folder (anyone in the Vault). */
export const createFolder = mutation({
  args: { vaultId: v.string(), folderId: v.string(), parentId: v.optional(v.string()), sealedName: v.bytes(), keyVersion: v.number(), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    if (!ID.test(args.folderId)) fail("invalid_argument", "Invalid folder id.");
    checkName(args.sealedName);
    checkKeyVersion(vault, args.keyVersion);
    const parent = args.parentId ? await folderOf(ctx, vault, args.parentId) : null;
    if (parent && (await ancestors(ctx, parent)).length + 2 > MAX_DEPTH) fail("invalid_argument", "Folders go 8 levels deep at most.");
    await consume(ctx, "vaultWrite", profile._id);
    const now = Date.now();
    await insertScoped(ctx, "vaultFolders", scopeOfRow(vault), { publicId: args.folderId, vaultId: vault._id, ...(parent ? { parentFolderId: parent._id } : {}), sealedName: args.sealedName, keyVersion: args.keyVersion, createdBy: profile._id, createdAt: now, updatedAt: now });
    await appendLog(ctx, vault, { event: "folder.created", actor: { profile, role }, item: { publicId: args.folderId, kind: "folder" }, client: args.client });
    return null;
  },
});

/** Renames (a new sealed name) or moves a folder (who made it, or a custodian). */
export const updateFolder = mutation({
  args: { vaultId: v.string(), folderId: v.string(), sealedName: v.optional(v.bytes()), keyVersion: v.optional(v.number()), parentId: v.optional(v.union(v.string(), v.null())), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    const folder = await folderOf(ctx, vault, args.folderId);
    if (folder.createdBy !== profile._id && !vaultRoleAtLeast(role, "custodian")) fail("forbidden", "You can change only folders you made. Ask a custodian.");
    const patch: Partial<Doc<"vaultFolders">> = { updatedAt: Date.now() };
    const changed: string[] = [];
    if (args.sealedName) {
      checkName(args.sealedName);
      checkKeyVersion(vault, args.keyVersion ?? -1);
      patch.sealedName = args.sealedName;
      patch.keyVersion = args.keyVersion;
      changed.push("name");
    }
    if (args.parentId !== undefined) {
      const parent = args.parentId ? await folderOf(ctx, vault, args.parentId) : null;
      if (parent && (parent._id === folder._id || (await ancestors(ctx, parent)).some((a) => a._id === folder._id))) fail("invalid_argument", "A folder can't go inside itself.");
      patch.parentFolderId = parent?._id;
      changed.push("location");
    }
    if (!changed.length) return null;
    await ctx.db.patch(folder._id, patch);
    await appendLog(ctx, vault, { event: changed.includes("location") ? "folder.moved" : "folder.renamed", actor: { profile, role }, item: { publicId: folder.publicId, kind: "folder" }, detail: { changed }, client: args.client });
    return null;
  },
});

/** A folder to the Vault's Trash, with everything inside it (who made it, or a custodian). */
export const removeFolder = mutation({
  args: { vaultId: v.string(), folderId: v.string(), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    const folder = await folderOf(ctx, vault, args.folderId);
    if (folder.createdBy !== profile._id && !vaultRoleAtLeast(role, "custodian")) fail("forbidden", "You can delete only folders you made. Ask a custodian.");
    const now = Date.now();
    let items = 0;
    const queue: Doc<"vaultFolders">[] = [folder];
    for (let i = 0; i < queue.length && queue.length < 500; i++) {
      const f = queue[i]!;
      await ctx.db.patch(f._id, { deletedAt: now });
      for (const item of await ctx.db
        .query("vaultItems")
        .withIndex("by_vault_folder", (q) => q.eq("vaultId", vault._id).eq("folderId", f._id))
        .take(2000))
        if (item.deletedAt === undefined) {
          await ctx.db.patch(item._id, { deletedAt: now });
          items++;
        }
      queue.push(
        ...(
          await ctx.db
            .query("vaultFolders")
            .withIndex("by_vault_parent", (q) => q.eq("vaultId", vault._id).eq("parentFolderId", f._id))
            .take(200)
        ).filter((c) => c.deletedAt === undefined),
      );
    }
    await appendLog(ctx, vault, { event: "folder.deleted", actor: { profile, role }, item: { publicId: folder.publicId, kind: "folder" }, detail: { folders: queue.length, items }, client: args.client });
    return null;
  },
});

/**
 * A new note in Files & Notes (anyone in the Vault). `movedFrom` names the regular note it replaces when a note is
 * moved into the Vault: the device then deletes that note for good, so no readable copy stays.
 */
export const createNote = mutation({
  args: { vaultId: v.string(), itemId: v.string(), folderId: v.optional(v.string()), item: vSealedItem, movedFrom: v.optional(v.string()), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    if (!ID.test(args.itemId)) fail("invalid_argument", "Invalid item id.");
    checkSealed(args.item);
    checkKeyVersion(vault, args.item.keyVersion);
    const folderId = await targetFolder(ctx, vault, args.folderId);
    await consume(ctx, "vaultWrite", profile._id);
    const now = Date.now();
    await insertScoped(ctx, "vaultItems", scopeOfRow(vault), { publicId: args.itemId, vaultId: vault._id, kind: "note", ...(folderId ? { folderId } : {}), sealedSummary: args.item.sealedSummary, sealed: args.item.sealed, wrappedKey: args.item.wrappedKey, keyVersion: args.item.keyVersion, revision: 1, createdBy: profile._id, updatedBy: profile._id, createdAt: now, updatedAt: now });
    await appendLog(ctx, vault, { event: args.movedFrom ? "note.movedIn" : "item.created", actor: { profile, role }, item: { publicId: args.itemId, kind: "note" }, ...(args.movedFrom ? { detail: { from: args.movedFrom.slice(0, 40) } } : {}), client: args.client });
    await notifyVaultChange(ctx, vault, profile, { what: "note", verb: "added" });
    return null;
  },
});

/** Where a file's encrypted bytes go (anyone in the Vault). */
export const uploadUrl = mutation({
  args: { vaultId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    await requireVault(ctx, profile, args.vaultId);
    await consume(ctx, "upload", profile._id);
    return await ctx.storage.generateUploadUrl();
  },
});

/** The stored size of an upload, which must be what the device says (it can't make a file look smaller). */
async function storedSize(ctx: MutationCtx, storageId: Id<"_storage">, claimed: number): Promise<number> {
  const meta = await ctx.db.system.get(storageId);
  if (!meta) fail("not_found", "The upload didn't arrive. Try again.");
  if (meta.size !== claimed || claimed > MAX_FILE) {
    await ctx.storage.delete(storageId);
    fail("invalid_argument", meta.size > MAX_FILE ? "Files are 2 GB at most." : "The upload doesn't match. Try again.");
  }
  return meta.size;
}

/** A new file, or a new version of a file (who added it, or a custodian), once its encrypted bytes are stored. */
export const saveFile = mutation({
  args: { vaultId: v.string(), itemId: v.string(), folderId: v.optional(v.string()), storageId: v.id("_storage"), size: v.number(), item: vSealedItem, baseRevision: v.optional(v.number()), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    checkSealed(args.item);
    checkKeyVersion(vault, args.item.keyVersion);
    const scope = scopeOfRow(vault);
    const size = await storedSize(ctx, args.storageId, args.size);
    const existing = await ctx.db
      .query("vaultItems")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.itemId))
      .unique();
    const now = Date.now();
    if (existing) {
      if (existing.vaultId !== vault._id || existing.kind !== "file") fail("not_found", "File not found.");
      requireCanChange(role, existing, profile._id);
      if (args.baseRevision !== existing.revision) fail("conflict", "Someone changed this file meanwhile. Open it again.");
      const grows = size - (existing.size ?? 0);
      const problem = grows > 0 ? await assertStorageFor(ctx, scope, grows, profile._id) : null;
      if (problem) {
        await ctx.storage.delete(args.storageId);
        fail("quota_exceeded", problem);
      }
      await keepVersion(ctx, existing);
      if (existing.storageId) await ctx.storage.delete(existing.storageId);
      await ctx.db.patch(existing._id, { storageId: args.storageId, size, sealedSummary: args.item.sealedSummary, sealed: args.item.sealed, wrappedKey: args.item.wrappedKey, keyVersion: args.item.keyVersion, revision: existing.revision + 1, updatedBy: profile._id, updatedAt: now });
      await adjustStorageUsed(ctx, scope, grows, scope.kind === "workspace" ? existing.createdBy : undefined);
      await appendLog(ctx, vault, { event: "file.updated", actor: { profile, role }, item: { publicId: existing.publicId, kind: "file" }, detail: { size, revision: existing.revision + 1 }, client: args.client });
      await notifyVaultChange(ctx, vault, profile, { what: "file", verb: "changed" });
      return { revision: existing.revision + 1 };
    }
    if (!ID.test(args.itemId)) fail("invalid_argument", "Invalid item id.");
    const problem = await assertStorageFor(ctx, scope, size, profile._id);
    if (problem) {
      await ctx.storage.delete(args.storageId);
      fail("quota_exceeded", problem);
    }
    const folderId = await targetFolder(ctx, vault, args.folderId);
    await consume(ctx, "vaultWrite", profile._id);
    await insertScoped(ctx, "vaultItems", scope, { publicId: args.itemId, vaultId: vault._id, kind: "file", ...(folderId ? { folderId } : {}), storageId: args.storageId, size, sealedSummary: args.item.sealedSummary, sealed: args.item.sealed, wrappedKey: args.item.wrappedKey, keyVersion: args.item.keyVersion, revision: 1, createdBy: profile._id, updatedBy: profile._id, createdAt: now, updatedAt: now });
    await adjustStorageUsed(ctx, scope, size, scope.kind === "workspace" ? profile._id : undefined);
    await appendLog(ctx, vault, { event: "file.added", actor: { profile, role }, item: { publicId: args.itemId, kind: "file" }, detail: { size }, client: args.client });
    await notifyVaultChange(ctx, vault, profile, { what: "file", verb: "added" });
    return { revision: 1 };
  },
});

/** A note's new content (who added it, or a custodian); the version before is kept. */
export const saveNote = mutation({
  args: { vaultId: v.string(), itemId: v.string(), baseRevision: v.number(), item: vSealedItem, client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    const item = await itemOf(ctx, vault, args.itemId);
    if (item.kind !== "note") fail("not_found", "Note not found.");
    requireCanChange(role, item, profile._id);
    if (item.deletedAt !== undefined) fail("conflict", "This note is in the Vault's Trash. Restore it first.");
    if (args.baseRevision !== item.revision) fail("conflict", "Someone changed this note meanwhile. Open it again.");
    checkSealed(args.item);
    checkKeyVersion(vault, args.item.keyVersion);
    await consume(ctx, "vaultWrite", profile._id);
    await keepVersion(ctx, item);
    await ctx.db.patch(item._id, { sealedSummary: args.item.sealedSummary, sealed: args.item.sealed, wrappedKey: args.item.wrappedKey, keyVersion: args.item.keyVersion, revision: item.revision + 1, updatedBy: profile._id, updatedAt: Date.now() });
    await appendLog(ctx, vault, { event: "note.edited", actor: { profile, role }, item: { publicId: item.publicId, kind: "note" }, detail: { revision: item.revision + 1 }, client: args.client });
    await notifyVaultChange(ctx, vault, profile, { what: "note", verb: "changed" });
    return { revision: item.revision + 1 };
  },
});

/** A link to a file's encrypted bytes, to preview or download it on the device. Logged by the server. */
export const fileUrl = mutation({
  args: { vaultId: v.string(), itemId: v.string(), purpose: v.union(v.literal("preview"), v.literal("download")), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    const item = await itemOf(ctx, vault, args.itemId);
    if (item.kind !== "file" || !item.storageId) fail("not_found", "File not found.");
    const url = await ctx.storage.getUrl(item.storageId);
    if (!url) fail("not_found", "File not found.");
    await appendLog(ctx, vault, { event: args.purpose === "preview" ? "file.preview" : "file.download", actor: { profile, role }, item: { publicId: item.publicId, kind: "file" }, detail: { size: item.size ?? 0 }, client: args.client });
    return { url, sealed: item.sealed, wrappedKey: item.wrappedKey, keyVersion: item.keyVersion, revision: item.revision };
  },
});

/** A note or file into another folder, or the top of Files & Notes. */
export const moveItem = mutation({
  args: { vaultId: v.string(), itemId: v.string(), folderId: v.union(v.string(), v.null()), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    const item = await itemOf(ctx, vault, args.itemId);
    if (item.kind !== "note" && item.kind !== "file") fail("invalid_argument", "Password items aren't in folders.");
    requireCanChange(role, item, profile._id);
    const folderId = await targetFolder(ctx, vault, args.folderId);
    await ctx.db.patch(item._id, { folderId, updatedAt: Date.now() });
    await appendLog(ctx, vault, { event: "item.moved", actor: { profile, role }, item: { publicId: item.publicId, kind: item.kind }, detail: { to: args.folderId ?? "top" }, client: args.client });
    return null;
  },
});

/** An item, its versions and its stored bytes, gone for good; the storage it used is given back. */
async function purge(ctx: MutationCtx, item: Doc<"vaultItems">) {
  for (const old of await ctx.db
    .query("vaultItemVersions")
    .withIndex("by_item", (q) => q.eq("itemId", item._id))
    .collect())
    await ctx.db.delete(old._id);
  if (item.storageId) {
    await ctx.storage.delete(item.storageId);
    const scope = scopeOfRow(item);
    await adjustStorageUsed(ctx, scope, -(item.size ?? 0), scope.kind === "workspace" ? item.createdBy : undefined);
  }
  await ctx.db.delete(item._id);
}

/**
 * A note moved out of the Vault into a regular note (custodians only, after a warning on the device, which has just
 * written the note in the space). The vault item is gone afterwards; the log keeps where it went.
 */
export const moveOut = mutation({
  args: { vaultId: v.string(), itemId: v.string(), toDocumentId: v.string(), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId, "custodian");
    const item = await itemOf(ctx, vault, args.itemId);
    if (item.kind !== "note") fail("invalid_argument", "Only notes move out of the Vault.");
    await appendLog(ctx, vault, { event: "note.movedOut", actor: { profile, role }, item: { publicId: item.publicId, kind: "note" }, detail: { to: args.toDocumentId.slice(0, 40) }, client: args.client });
    await purge(ctx, item);
    return null;
  },
});

/** Empties the Vault's Trash (custodians). */
export const emptyTrash = mutation({
  args: { vaultId: v.string(), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId, "custodian");
    let n = 0;
    for (const item of await ctx.db
      .query("vaultItems")
      .withIndex("by_vault_deleted", (q) => q.eq("vaultId", vault._id).gt("deletedAt", 0))
      .take(300)) {
      await purge(ctx, item);
      n++;
    }
    for (const f of await ctx.db
      .query("vaultFolders")
      .withIndex("by_vault_parent", (q) => q.eq("vaultId", vault._id))
      .take(2000))
      if (f.deletedAt !== undefined) await ctx.db.delete(f._id);
    await appendLog(ctx, vault, { event: "trash.emptied", actor: { profile, role }, detail: { items: n }, client: args.client });
    return { removed: n };
  },
});

/** Daily: items in a Vault's Trash longer than 30 days go for good (logged as the system). */
export const purgeOldTrash = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - TRASH_DAYS * 24 * 60 * 60 * 1000;
    const byVault = new Map<Id<"vaults">, number>();
    let seen = 0;
    for await (const item of ctx.db.query("vaultItems")) {
      if (++seen > 20_000) break;
      if (item.deletedAt === undefined || item.deletedAt > cutoff) continue;
      byVault.set(item.vaultId, (byVault.get(item.vaultId) ?? 0) + 1);
      await purge(ctx, item);
      if ([...byVault.values()].reduce((a, b) => a + b, 0) >= 300) break;
    }
    for (const [vaultId, n] of byVault) {
      const vault = await ctx.db.get(vaultId);
      if (vault) await appendLog(ctx, vault, { event: "trash.expired", actor: { profile: null, role: "system", name: "Folevi" }, detail: { items: n, afterDays: TRASH_DAYS } });
    }
    return null;
  },
});
