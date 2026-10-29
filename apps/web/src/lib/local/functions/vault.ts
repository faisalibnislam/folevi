// The Vault of a library on this device (docs/MAC_REBUILD_PLAN.md §0 and §5.6): the account Vault's functions
// (convex/vault.ts, vaultKeys.ts, vaultItems.ts, vaultFiles.ts) answered here, with the same rows and the same
// sealing, so the Vault's screens and lib/vault/* work unchanged and a library's Vault can move into an account
// later. What needs other people stays with an account: People, sharing and one-time links, and the signed activity
// log (vaultPeople, vaultShares and vaultLog's reading are hidden; vaultLog.record does nothing here).
//
// There's no account key on this device, so the grants are the passcode and recovery layers straight around the
// vault key (lib/vault/keys.ts libraryVaultActor). Rows are a table of their own ("vault", synced through the
// library's index, bytes as base64url); file bytes are in the library folder (lib/local/vault/files.ts). Wrong
// passcodes count as on the server: 5 in a row lock the Vault for 15 minutes, every later lockout for an hour.
import { ulid } from "@folevi/editor-schema";
import { fromBase64Url, toBase64Url } from "@folevi/local-store/e2ee";
import type { Id } from "@convex/_generated/dataModel";
import { api } from "@/lib/convex/api";
import { fail } from "../errors";
import { defineLocal, type LocalMutationCtx, type LocalQueryCtx, type LocalReader } from "../registry";
import type { LocalVaultRow } from "../store";
import { localVaultEnabled } from "../vault/enabled";
import { FILE_PREFIX, removeVaultFile, takeStaged, UPLOAD_PREFIX, writeVaultFile } from "../vault/files";
import { getProfile } from "./shared";

const TABLE = "vault" as const;
const PASSWORD_KINDS = ["login", "apiKey", "card", "bankAccount", "secureNote", "sshKey", "wifi", "licence", "identity"] as const;
const MAX_FAILURES = 5;
const LOCKOUT_MS = [15 * 60_000, 60 * 60_000] as const;
const AUTO_LOCK_RANGE = [1, 30] as const;
const MAX_SUMMARY = 8 * 1024;
const MAX_SECRET = 256 * 1024;
const MAX_KEY = 1024;
const TRASH_MS = 30 * 86_400_000;
const LIBRARY_PERSON = "library";

type Kdf = { m: number; t: number; p: number };
type Bytes = ArrayBuffer;

interface MetaRow {
  id: "vault";
  publicId: string;
  createdAt: number;
  keyVersion: number;
  check: string | null;
  autoLockMinutes: number;
  passcode: { version: number; wrapped: string; salt: string; kdf: Kdf }[];
  recovery: { version: number; wrapped: string }[];
  failures: number;
  lockouts: number;
  lockedUntil: number | null;
}

interface FolderRow {
  id: string;
  parentId: string | null;
  sealedName: string;
  keyVersion: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

interface ItemRow {
  id: string;
  kind: string;
  folderId: string | null;
  sealedSummary: string;
  sealed: string;
  wrappedKey: string;
  keyVersion: number;
  passwordMac: string | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  size: number | null;
}

interface VersionRow {
  id: string;
  itemId: string;
  revision: number;
  sealedSummary: string;
  sealed: string;
  wrappedKey: string;
  keyVersion: number;
  editedAt: number;
}

interface SealedItem {
  sealedSummary: Bytes;
  sealed: Bytes;
  wrappedKey: Bytes;
  keyVersion: number;
  passwordMac?: string;
}

const b64 = (b: ArrayBuffer | ArrayBufferView) => toBase64Url(ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));
const ab = (s: string): ArrayBuffer => {
  const b = fromBase64Url(s);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const size = (b: ArrayBuffer | ArrayBufferView) => b.byteLength;

const asRow = <T>(r: LocalVaultRow | undefined) => r as unknown as T | undefined;
const put = <T extends { id: string }>(ctx: LocalMutationCtx, partition: string, row: T) => ctx.db.put(TABLE, row.id, row as unknown as LocalVaultRow, partition);

async function meta(db: LocalReader): Promise<MetaRow | null> {
  return asRow<MetaRow>(await db.get(TABLE, "vault", "meta")) ?? null;
}

/** The library's Vault, by the id its screens hold; anything else isn't here. */
async function requireVault(ctx: LocalQueryCtx | LocalMutationCtx, vaultId: string): Promise<MetaRow> {
  if (!localVaultEnabled()) fail("forbidden", "The Vault isn't available yet.");
  const m = await meta(ctx.db);
  if (!m || m.publicId !== vaultId) fail("not_found", "Vault not found.");
  return m;
}

async function person(db: LocalReader) {
  const p = (await getProfile(db)) as { displayName?: string } | null;
  return { id: LIBRARY_PERSON, name: p?.displayName?.trim() || "You" };
}

function checkSealed(i: SealedItem) {
  if (size(i.sealedSummary) < 28 || size(i.sealedSummary) > MAX_SUMMARY) fail("invalid_argument", "Invalid item.");
  if (size(i.sealed) < 28 || size(i.sealed) > MAX_SECRET) fail("invalid_argument", "This item is too big.");
  if (size(i.wrappedKey) < 28 || size(i.wrappedKey) > MAX_KEY) fail("invalid_argument", "Invalid item.");
  if (i.passwordMac !== undefined && !/^[\w-]{22}$/.test(i.passwordMac)) fail("invalid_argument", "Invalid item.");
}

function checkKeyVersion(m: MetaRow, keyVersion: number) {
  if (keyVersion !== m.keyVersion) fail("conflict", "The Vault's key changed. Open it again.");
}

function checkId(id: string, what = "item") {
  if (!/^[0-9A-Z]{26}$/.test(id)) fail("invalid_argument", `Invalid ${what} id.`);
}

async function itemOf(db: LocalReader, itemId: string): Promise<ItemRow> {
  const item = asRow<ItemRow>(await db.get(TABLE, itemId, "items"));
  if (!item) fail("not_found", "Item not found.");
  return item;
}

async function folderOf(db: LocalReader, folderId: string): Promise<FolderRow> {
  const f = asRow<FolderRow>(await db.get(TABLE, folderId, "folders"));
  if (!f || f.deletedAt !== null) fail("not_found", "Folder not found.");
  return f;
}

/** What a list row carries (convex/vaultItems.ts row): the sealed summary, never the secrets. */
async function rowOf(db: LocalReader, i: ItemRow) {
  const who = await person(db);
  return {
    id: i.id,
    kind: i.kind as (typeof PASSWORD_KINDS)[number] | "note" | "file",
    folderId: i.folderId as Id<"vaultFolders"> | null,
    sealedSummary: ab(i.sealedSummary),
    wrappedKey: ab(i.wrappedKey),
    keyVersion: i.keyVersion,
    passwordMac: i.passwordMac,
    revision: i.revision,
    createdBy: who,
    updatedBy: who,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    deletedAt: i.deletedAt,
    size: i.size,
  };
}

const sealedFields = (i: SealedItem) => ({
  sealedSummary: b64(i.sealedSummary),
  sealed: b64(i.sealed),
  wrappedKey: b64(i.wrappedKey),
  keyVersion: i.keyVersion,
  passwordMac: i.passwordMac ?? null,
});

function keepVersion(ctx: LocalMutationCtx, item: ItemRow) {
  const v: VersionRow = { id: `${item.id}:${item.revision}`, itemId: item.id, revision: item.revision, sealedSummary: item.sealedSummary, sealed: item.sealed, wrappedKey: item.wrappedKey, keyVersion: item.keyVersion, editedAt: item.updatedAt };
  put(ctx, "versions", v);
}

async function items(db: LocalReader): Promise<ItemRow[]> {
  return (await db.list(TABLE, "items")) as unknown as ItemRow[];
}

// ---- the Vault itself (convex/vault.ts) ----

defineLocal(api.vault.get, "query", async (ctx) => {
  if (!localVaultEnabled()) return null;
  const m = await meta(ctx.db);
  if (!m) return { exists: false as const, personal: true, role: "owner" as const };
  const hasAccessKey = m.passcode.some((g) => g.version === m.keyVersion);
  return {
    exists: true as const,
    id: m.publicId,
    personal: true,
    role: "owner" as const,
    keyVersion: m.keyVersion,
    hasAccessKey,
    needsPasscode: false,
    waitingForKey: false,
    hasRecovery: m.recovery.some((g) => g.version === m.keyVersion),
    recoveryOutdated: false,
    rotationNeeded: false,
    accessReviewDue: false,
    autoLockMinutes: m.autoLockMinutes,
    custodiansNameCustodians: false,
  };
});

defineLocal(api.vault.create, "mutation", async (ctx) => {
  if (!localVaultEnabled()) fail("forbidden", "The Vault isn't available yet.");
  const had = await meta(ctx.db);
  if (had) return { id: had.publicId };
  const m: MetaRow = { id: "vault", publicId: ulid(), createdAt: ctx.now(), keyVersion: 0, check: null, autoLockMinutes: 5, passcode: [], recovery: [], failures: 0, lockouts: 0, lockedUntil: null };
  put(ctx, "meta", m);
  return { id: m.publicId };
});

defineLocal(api.vault.updateSettings, "mutation", async (ctx, args) => {
  const m = await requireVault(ctx, args.vaultId);
  if (args.autoLockMinutes !== undefined) {
    const [min, max] = AUTO_LOCK_RANGE;
    if (!Number.isInteger(args.autoLockMinutes) || args.autoLockMinutes < min || args.autoLockMinutes > max) fail("invalid_argument", `Choose ${min} to ${max} minutes.`);
    if (args.autoLockMinutes !== m.autoLockMinutes) put(ctx, "meta", { ...m, autoLockMinutes: args.autoLockMinutes });
  }
  return null;
});

// ---- keys and unlocking (convex/vaultKeys.ts) ----

function checkKdf(kdf: Kdf) {
  if (!Number.isInteger(kdf.m) || kdf.m < 65536 || kdf.m > 1 << 20 || !Number.isInteger(kdf.t) || kdf.t < 3 || kdf.t > 64 || !Number.isInteger(kdf.p) || kdf.p < 1 || kdf.p > 16) fail("invalid_argument", "Unsupported passcode settings.");
}

function checkWrap(b: Bytes) {
  if (size(b) < 32 || size(b) > 4096) fail("invalid_argument", "Invalid key data.");
}

defineLocal(api.vaultKeys.setUp, "mutation", async (ctx, args) => {
  const m = await requireVault(ctx, args.vaultId);
  if (m.keyVersion !== 0) fail("conflict", "This Vault is already set up.");
  if (size(args.check) !== 16) fail("invalid_argument", "Invalid key data.");
  if (args.passcode.version !== 1 || args.recovery.version !== 1) fail("invalid_argument", "The first key is version 1.");
  checkWrap(args.passcode.wrapped);
  checkWrap(args.recovery.wrapped);
  checkKdf(args.passcode.kdf);
  if (size(args.passcode.salt) !== 16) fail("invalid_argument", "Invalid key data.");
  put(ctx, "meta", {
    ...m,
    keyVersion: 1,
    check: b64(args.check),
    passcode: [{ version: 1, wrapped: b64(args.passcode.wrapped), salt: b64(args.passcode.salt), kdf: args.passcode.kdf }],
    recovery: [{ version: 1, wrapped: b64(args.recovery.wrapped) }],
  });
  return null;
});

defineLocal(api.vaultKeys.unlock, "mutation", async (ctx, args) => {
  const m = await requireVault(ctx, args.vaultId);
  if (m.keyVersion === 0) fail("not_found", "This Vault isn't set up yet.");
  if (m.lockedUntil && m.lockedUntil > ctx.now()) return { locked: true as const, lockedUntil: m.lockedUntil };
  await purgeOldVaultTrash(ctx);
  const own =
    args.way === "passcode"
      ? m.passcode.map((g) => ({ version: g.version, epoch: 0, wrapped: ab(g.wrapped), salt: ab(g.salt) as ArrayBuffer | null, kdf: g.kdf as Kdf | null }))
      : m.recovery.map((g) => ({ version: g.version, epoch: 0, wrapped: ab(g.wrapped), salt: null, kdf: null }));
  return {
    locked: false as const,
    keyVersion: m.keyVersion,
    keys: [{ version: m.keyVersion, check: ab(m.check!) }],
    grants: own.filter((g) => g.version === m.keyVersion),
    fromCustodian: [],
    autoLockMinutes: m.autoLockMinutes,
    role: "owner" as const,
  };
});

defineLocal(api.vaultKeys.unlockResult, "mutation", async (ctx, args) => {
  const m = await requireVault(ctx, args.vaultId);
  if (args.ok) {
    if (m.failures) put(ctx, "meta", { ...m, failures: 0 });
    return { lockedUntil: null };
  }
  const failures = m.failures + 1;
  let lockedUntil: number | null = null;
  let lockouts = m.lockouts;
  if (failures % MAX_FAILURES === 0) {
    lockedUntil = ctx.now() + LOCKOUT_MS[Math.min(lockouts, LOCKOUT_MS.length - 1)]!;
    lockouts++;
  }
  put(ctx, "meta", { ...m, failures, lockouts, lockedUntil: lockedUntil ?? m.lockedUntil });
  return { lockedUntil };
});

defineLocal(api.vaultKeys.lock, "mutation", async (ctx, args) => {
  await requireVault(ctx, args.vaultId);
  return null;
});

defineLocal(api.vaultKeys.setPasscode, "mutation", async (ctx, args) => {
  const m = await requireVault(ctx, args.vaultId);
  if (args.grants.length !== 1 || args.grants[0]!.version !== m.keyVersion) fail("invalid_argument", "Wrap every key version of the Vault.");
  const g = args.grants[0]!;
  checkWrap(g.wrapped);
  checkKdf(g.kdf);
  if (size(g.salt) !== 16) fail("invalid_argument", "Invalid key data.");
  put(ctx, "meta", { ...m, failures: 0, passcode: [{ version: g.version, wrapped: b64(g.wrapped), salt: b64(g.salt), kdf: g.kdf }] });
  return null;
});

defineLocal(api.vaultKeys.setRecovery, "mutation", async (ctx, args) => {
  const m = await requireVault(ctx, args.vaultId);
  if (args.grants.length !== 1 || args.grants[0]!.version !== m.keyVersion) fail("invalid_argument", "Wrap every key version of the Vault.");
  checkWrap(args.grants[0]!.wrapped);
  put(ctx, "meta", { ...m, recovery: [{ version: m.keyVersion, wrapped: b64(args.grants[0]!.wrapped) }] });
  return null;
});

// ---- items (convex/vaultItems.ts) ----

defineLocal(api.vaultItems.list, "query", async (ctx, args) => {
  const m = await requireVault(ctx, args.vaultId);
  let rows = await items(ctx.db);
  if (args.section === "passwords") rows = rows.filter((i) => (PASSWORD_KINDS as readonly string[]).includes(i.kind) && i.deletedAt === null);
  else if (args.section === "files") {
    if (args.folderId) await folderOf(ctx.db, args.folderId);
    const folderId = args.folderId ?? null;
    rows = rows.filter((i) => (i.kind === "note" || i.kind === "file") && i.deletedAt === null && i.folderId === folderId);
  } else rows = rows.filter((i) => i.deletedAt !== null);
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  return { items: await Promise.all(rows.map((i) => rowOf(ctx.db, i))), keyVersion: m.keyVersion, role: "owner" as const };
});

defineLocal(api.vaultItems.open, "mutation", async (ctx, args) => {
  await requireVault(ctx, args.vaultId);
  const item = await itemOf(ctx.db, args.itemId);
  return { ...(await rowOf(ctx.db, item)), sealed: ab(item.sealed), canChange: true };
});

defineLocal(api.vaultItems.create, "mutation", async (ctx, args) => {
  const m = await requireVault(ctx, args.vaultId);
  if (!(PASSWORD_KINDS as readonly string[]).includes(args.kind)) fail("invalid_argument", "Notes and files are added in Files & Notes.");
  checkId(args.itemId);
  checkSealed(args.item);
  checkKeyVersion(m, args.item.keyVersion);
  if (await ctx.db.get(TABLE, args.itemId, "items")) fail("conflict", "That item already exists.");
  const now = ctx.now();
  const row: ItemRow = { id: args.itemId, kind: args.kind, folderId: null, ...sealedFields(args.item), revision: 1, createdAt: now, updatedAt: now, deletedAt: null, size: null };
  put(ctx, "items", row);
  return null;
});

defineLocal(api.vaultItems.update, "mutation", async (ctx, args) => {
  const m = await requireVault(ctx, args.vaultId);
  const item = await itemOf(ctx.db, args.itemId);
  if (item.deletedAt !== null) fail("conflict", "This item is in the Vault's Trash. Restore it first.");
  if (args.baseRevision !== item.revision) fail("conflict", "Someone changed this item meanwhile. Open it again.");
  checkSealed(args.item);
  checkKeyVersion(m, args.item.keyVersion);
  keepVersion(ctx, item);
  put(ctx, "items", { ...item, ...sealedFields(args.item), revision: item.revision + 1, updatedAt: ctx.now() });
  return { revision: item.revision + 1 };
});

defineLocal(api.vaultItems.history, "mutation", async (ctx, args) => {
  await requireVault(ctx, args.vaultId);
  const item = await itemOf(ctx.db, args.itemId);
  const who = await person(ctx.db);
  const versions = ((await ctx.db.list(TABLE, "versions")) as unknown as VersionRow[]).filter((v) => v.itemId === item.id).sort((a, b) => b.revision - a.revision).slice(0, 200);
  return versions.map((x) => ({ revision: x.revision, sealedSummary: ab(x.sealedSummary), sealed: ab(x.sealed), wrappedKey: ab(x.wrappedKey), keyVersion: x.keyVersion, editedBy: who.name, editedAt: x.editedAt }));
});

defineLocal(api.vaultItems.restoreVersion, "mutation", async (ctx, args) => {
  await requireVault(ctx, args.vaultId);
  const item = await itemOf(ctx.db, args.itemId);
  const old = asRow<VersionRow>(await ctx.db.get(TABLE, `${item.id}:${args.revision}`, "versions"));
  if (!old) fail("not_found", "That version is gone.");
  keepVersion(ctx, item);
  put(ctx, "items", { ...item, sealedSummary: old.sealedSummary, sealed: old.sealed, wrappedKey: old.wrappedKey, keyVersion: old.keyVersion, revision: item.revision + 1, updatedAt: ctx.now() });
  return null;
});

defineLocal(api.vaultItems.remove, "mutation", async (ctx, args) => {
  await requireVault(ctx, args.vaultId);
  const item = await itemOf(ctx.db, args.itemId);
  if (item.deletedAt === null) put(ctx, "items", { ...item, deletedAt: ctx.now() });
  return null;
});

defineLocal(api.vaultItems.restore, "mutation", async (ctx, args) => {
  await requireVault(ctx, args.vaultId);
  const item = await itemOf(ctx.db, args.itemId);
  if (item.deletedAt === null) return null;
  const folder = item.folderId ? asRow<FolderRow>(await ctx.db.get(TABLE, item.folderId, "folders")) : null;
  put(ctx, "items", { ...item, deletedAt: null, ...(item.folderId && (!folder || folder.deletedAt !== null) ? { folderId: null } : {}) });
  return null;
});

defineLocal(api.vaultItems.importBatch, "mutation", async (ctx, args) => {
  const m = await requireVault(ctx, args.vaultId);
  if (!args.items.length || args.items.length > 100) fail("invalid_argument", "Import up to 100 items at a time.");
  const now = ctx.now();
  for (const i of args.items) {
    if (!(PASSWORD_KINDS as readonly string[]).includes(i.kind)) fail("invalid_argument", "Only passwords are imported.");
    checkId(i.itemId);
    checkSealed(i.item);
    checkKeyVersion(m, i.item.keyVersion);
    if (await ctx.db.get(TABLE, i.itemId, "items")) fail("conflict", "That item already exists.");
    put(ctx, "items", { id: i.itemId, kind: i.kind, folderId: null, ...sealedFields(i.item), revision: 1, createdAt: now, updatedAt: now, deletedAt: null, size: null } satisfies ItemRow);
  }
  return null;
});

defineLocal(api.vaultItems.exportPage, "mutation", async (ctx, args) => {
  await requireVault(ctx, args.vaultId);
  const all = (await items(ctx.db)).filter((i) => (PASSWORD_KINDS as readonly string[]).includes(i.kind) && i.deletedAt === null).sort((a, b) => (a.id < b.id ? -1 : 1));
  const start = args.after ? all.findIndex((i) => i.id > args.after!) : 0;
  const page = start < 0 ? [] : all.slice(start, start + 500);
  return {
    items: await Promise.all(page.map(async (i) => ({ ...(await rowOf(ctx.db, i)), sealed: ab(i.sealed) }))),
    next: start >= 0 && start + 500 < all.length ? page.at(-1)!.id : null,
  };
});

defineLocal(api.vaultItems.reuse, "query", async (ctx, args) => {
  await requireVault(ctx, args.vaultId);
  const counts: Record<string, number> = {};
  for (const i of await items(ctx.db)) if (i.passwordMac && i.deletedAt === null && (PASSWORD_KINDS as readonly string[]).includes(i.kind)) counts[i.passwordMac] = (counts[i.passwordMac] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 1));
});

// Pwned Passwords asked straight from this device (k-anonymity: only 5 characters of the password's SHA-1 leave it,
// and nothing goes through Folevi). No network: [], which Health shows as "not checked yet".
defineLocal(api.vaultItems.breachRange, "action", async (_ctx, args) => {
  if (!/^[0-9A-F]{5}$/.test(args.prefix)) fail("invalid_argument", "Invalid prefix.");
  const res = await fetch(`https://api.pwnedpasswords.com/range/${args.prefix}`, { headers: { "Add-Padding": "true" } }).catch(() => null);
  if (!res?.ok) return [];
  return (await res.text())
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[0-9A-F]{35}:[1-9]\d*$/i.test(line))
    .map((line) => line.slice(0, 35).toUpperCase());
});

// ---- Files & Notes (convex/vaultFiles.ts) ----

defineLocal(api.vaultFiles.folders, "query", async (ctx, args) => {
  await requireVault(ctx, args.vaultId);
  const rows = ((await ctx.db.list(TABLE, "folders")) as unknown as FolderRow[]).filter((f) => f.deletedAt === null);
  return rows.slice(0, 2000).map((f) => ({ id: f.id, parentId: f.parentId, sealedName: ab(f.sealedName), keyVersion: f.keyVersion, createdBy: LIBRARY_PERSON, updatedAt: f.updatedAt }));
});

defineLocal(api.vaultFiles.createFolder, "mutation", async (ctx, args) => {
  const m = await requireVault(ctx, args.vaultId);
  checkId(args.folderId, "folder");
  checkKeyVersion(m, args.keyVersion);
  if (size(args.sealedName) < 28 || size(args.sealedName) > 1024) fail("invalid_argument", "Invalid folder name.");
  if (args.parentId) await folderOf(ctx.db, args.parentId);
  if (await ctx.db.get(TABLE, args.folderId, "folders")) fail("conflict", "That folder already exists.");
  const now = ctx.now();
  put(ctx, "folders", { id: args.folderId, parentId: args.parentId ?? null, sealedName: b64(args.sealedName), keyVersion: args.keyVersion, createdAt: now, updatedAt: now, deletedAt: null } satisfies FolderRow);
  return null;
});

defineLocal(api.vaultFiles.updateFolder, "mutation", async (ctx, args) => {
  const m = await requireVault(ctx, args.vaultId);
  const f = await folderOf(ctx.db, args.folderId);
  const next: FolderRow = { ...f, updatedAt: ctx.now() };
  if (args.sealedName !== undefined) {
    checkKeyVersion(m, args.keyVersion ?? 0);
    next.sealedName = b64(args.sealedName);
    next.keyVersion = args.keyVersion!;
  }
  if (args.parentId !== undefined) {
    // Never into itself or one of its own subfolders.
    for (let at = args.parentId; at; at = (await folderOf(ctx.db, at)).parentId) if (at === f.id) fail("invalid_argument", "A folder can't go inside itself.");
    next.parentId = args.parentId;
  }
  put(ctx, "folders", next);
  return null;
});

defineLocal(api.vaultFiles.removeFolder, "mutation", async (ctx, args) => {
  await requireVault(ctx, args.vaultId);
  const f = await folderOf(ctx.db, args.folderId);
  const now = ctx.now();
  const all = (await ctx.db.list(TABLE, "folders")) as unknown as FolderRow[];
  const gone = new Set([f.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of all) if (c.deletedAt === null && c.parentId && gone.has(c.parentId) && !gone.has(c.id)) {
      gone.add(c.id);
      grew = true;
    }
  }
  for (const c of all) if (gone.has(c.id)) put(ctx, "folders", { ...c, deletedAt: now });
  for (const i of await items(ctx.db)) if (i.folderId && gone.has(i.folderId) && i.deletedAt === null) put(ctx, "items", { ...i, deletedAt: now });
  return null;
});

defineLocal(api.vaultFiles.createNote, "mutation", async (ctx, args) => {
  const m = await requireVault(ctx, args.vaultId);
  checkId(args.itemId);
  checkSealed(args.item);
  checkKeyVersion(m, args.item.keyVersion);
  if (args.folderId) await folderOf(ctx.db, args.folderId);
  if (await ctx.db.get(TABLE, args.itemId, "items")) fail("conflict", "That item already exists.");
  const now = ctx.now();
  put(ctx, "items", { id: args.itemId, kind: "note", folderId: args.folderId ?? null, ...sealedFields(args.item), passwordMac: null, revision: 1, createdAt: now, updatedAt: now, deletedAt: null, size: null } satisfies ItemRow);
  return null;
});

defineLocal(api.vaultFiles.saveNote, "mutation", async (ctx, args) => {
  const m = await requireVault(ctx, args.vaultId);
  const item = await itemOf(ctx.db, args.itemId);
  if (item.kind !== "note") fail("invalid_argument", "Not a note.");
  if (item.deletedAt !== null) fail("conflict", "This note is in the Vault's Trash. Restore it first.");
  if (args.baseRevision !== item.revision) fail("conflict", "Someone changed this note meanwhile. Open it again.");
  checkSealed(args.item);
  checkKeyVersion(m, args.item.keyVersion);
  keepVersion(ctx, item);
  put(ctx, "items", { ...item, ...sealedFields(args.item), passwordMac: null, revision: item.revision + 1, updatedAt: ctx.now() });
  return { revision: item.revision + 1 };
});

defineLocal(api.vaultFiles.uploadUrl, "mutation", async (ctx, args) => {
  await requireVault(ctx, args.vaultId);
  return `${UPLOAD_PREFIX}${ulid()}`;
});

defineLocal(api.vaultFiles.saveFile, "mutation", async (ctx, args) => {
  const m = await requireVault(ctx, args.vaultId);
  checkId(args.itemId);
  checkSealed(args.item);
  checkKeyVersion(m, args.item.keyVersion);
  if (args.folderId) await folderOf(ctx.db, args.folderId);
  const bytes = takeStaged(String(args.storageId));
  if (!bytes) fail("invalid_argument", "The upload didn't go through. Try again.");
  const existing = asRow<ItemRow>(await ctx.db.get(TABLE, args.itemId, "items"));
  if (existing && (existing.kind !== "file" || args.baseRevision !== existing.revision)) fail("conflict", "Someone changed this file meanwhile. Open it again.");
  await writeVaultFile(args.itemId, bytes);
  const now = ctx.now();
  if (existing) {
    keepVersion(ctx, existing);
    put(ctx, "items", { ...existing, ...sealedFields(args.item), passwordMac: null, revision: existing.revision + 1, updatedAt: now, size: bytes.length });
    return { revision: existing.revision + 1 };
  }
  put(ctx, "items", { id: args.itemId, kind: "file", folderId: args.folderId ?? null, ...sealedFields(args.item), passwordMac: null, revision: 1, createdAt: now, updatedAt: now, deletedAt: null, size: bytes.length } satisfies ItemRow);
  return { revision: 1 };
});

defineLocal(api.vaultFiles.fileUrl, "mutation", async (ctx, args) => {
  await requireVault(ctx, args.vaultId);
  const item = await itemOf(ctx.db, args.itemId);
  if (item.kind !== "file") fail("invalid_argument", "Not a file.");
  return { url: `${FILE_PREFIX}${item.id}`, sealed: ab(item.sealed), wrappedKey: ab(item.wrappedKey), keyVersion: item.keyVersion, revision: item.revision };
});

defineLocal(api.vaultFiles.moveItem, "mutation", async (ctx, args) => {
  await requireVault(ctx, args.vaultId);
  const item = await itemOf(ctx.db, args.itemId);
  if (args.folderId) await folderOf(ctx.db, args.folderId);
  put(ctx, "items", { ...item, folderId: args.folderId, updatedAt: ctx.now() });
  return null;
});

defineLocal(api.vaultFiles.emptyTrash, "mutation", async (ctx, args) => {
  await requireVault(ctx, args.vaultId);
  let n = 0;
  for (const i of await items(ctx.db)) {
    if (i.deletedAt === null) continue;
    await purge(ctx, i);
    n++;
  }
  return { removed: n };
});

/** An item gone for good: its row, its earlier versions and its file's bytes. */
async function purge(ctx: LocalMutationCtx, i: ItemRow) {
  ctx.db.remove(TABLE, i.id, "items");
  for (const v of (await ctx.db.list(TABLE, "versions")) as unknown as VersionRow[]) if (v.itemId === i.id) ctx.db.remove(TABLE, v.id, "versions");
  if (i.kind === "file") ctx.runAfter(async () => void (await removeVaultFile(i.id).catch(() => undefined)));
}

/** Items in the Trash longer than 30 days go for good (run when the Vault opens: there's no daily job here). */
export async function purgeOldVaultTrash(ctx: LocalMutationCtx): Promise<number> {
  let n = 0;
  for (const i of await items(ctx.db)) {
    if (i.deletedAt === null || i.deletedAt > ctx.now() - TRASH_MS) continue;
    await purge(ctx, i);
    n++;
  }
  return n;
}

// ---- the log (convex/vaultLog.ts): the signed log needs an account; what the device reports goes nowhere ----

defineLocal(api.vaultLog.record, "mutation", async (ctx, args) => {
  await requireVault(ctx, args.vaultId);
  return null;
});
