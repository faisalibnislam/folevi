// The Vault's keys and unlocking (docs/VAULT_PLAN.md §3). The server keeps only sealed bytes: a person's grant is
// the vault key sealed to their account key and then to their passcode (or their vault recovery key). It can't
// open either layer, so passcodes are checked on the device; the server logs every unlock it serves, counts the
// wrong passcodes the device reports, and locks the person out for a while after too many.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertWritable, requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";
import { insertScoped, scopeOfRow } from "./lib/scope";
import { activeAccount, requireAccount } from "./lib/e2ee/keyStore";
import { requireVault, vaultRoleOf } from "./lib/vault/access";
import { appendLog } from "./lib/vault/log";
import { vVaultClient } from "./lib/vault/validators";

type Ctx = QueryCtx | MutationCtx;

/** Wrong passcodes in a row before a lockout, and how long the lockouts last (the first, then every later one). */
export const MAX_FAILURES = 5;
export const LOCKOUT_MS = [15 * 60_000, 60 * 60_000] as const;
/** After this many wrong passcodes in a row, custodians are told (vaultNotify). */
export const NOTIFY_CUSTODIANS_AFTER = 10;

const vKdf = v.object({ m: v.number(), t: v.number(), p: v.number() });
const vPasscodeGrant = v.object({ version: v.number(), epoch: v.number(), wrapped: v.bytes(), salt: v.bytes(), kdf: vKdf });
const vSealedGrant = v.object({ version: v.number(), epoch: v.number(), wrapped: v.bytes() });

const MAX_WRAP = 4096;

function checkKdf(kdf: { m: number; t: number; p: number }) {
  // At least the production cost (docs/E2EE_DESIGN.md §4.2); a client can't weaken someone's passcode layer.
  if (!Number.isInteger(kdf.m) || kdf.m < 65536 || kdf.m > 1 << 20 || !Number.isInteger(kdf.t) || kdf.t < 3 || kdf.t > 64 || !Number.isInteger(kdf.p) || kdf.p < 1 || kdf.p > 16) fail("invalid_argument", "Unsupported passcode settings.");
}

function checkWrap(bytes: ArrayBuffer) {
  if (bytes.byteLength < 32 || bytes.byteLength > MAX_WRAP) fail("invalid_argument", "Invalid key data.");
}

/** The caller's encryption account, at the epoch their grants were sealed to. */
async function requireEpoch(ctx: Ctx, profileId: Id<"profiles">, epoch: number) {
  const account = await requireAccount(ctx, profileId);
  if (account.epoch !== epoch) fail("invalid_argument", "Your encryption key changed. Open the Vault again.");
  return account;
}

async function grantsOf(ctx: Ctx, vaultId: Id<"vaults">, profileId: Id<"profiles">, layer: Doc<"vaultGrants">["layer"]) {
  return await ctx.db
    .query("vaultGrants")
    .withIndex("by_vault_profile_layer", (q) => q.eq("vaultId", vaultId).eq("profileId", profileId).eq("layer", layer))
    .collect();
}

async function replaceGrants(ctx: MutationCtx, vault: Doc<"vaults">, profileId: Id<"profiles">, layer: Doc<"vaultGrants">["layer"], rows: { version: number; epoch: number; wrapped: ArrayBuffer; salt?: ArrayBuffer; kdf?: { m: number; t: number; p: number } }[], grantedBy: Id<"profiles">) {
  for (const old of await grantsOf(ctx, vault._id, profileId, layer)) await ctx.db.delete(old._id);
  const now = Date.now();
  for (const g of rows) {
    await insertScoped(ctx, "vaultGrants", scopeOfRow(vault), {
      vaultId: vault._id,
      profileId,
      version: g.version,
      layer,
      epoch: g.epoch,
      wrapped: g.wrapped,
      ...(g.salt ? { passcodeSalt: g.salt } : {}),
      ...(g.kdf ? { kdf: g.kdf } : {}),
      grantedBy,
      createdAt: now,
    });
  }
}

/**
 * The key versions a person must hold: every version, newest last (current = keyVersion). Versions aren't retired:
 * earlier versions of items stay sealed under the key that was current then.
 */
export async function liveVersions(ctx: Ctx, vault: Doc<"vaults">): Promise<number[]> {
  const out: number[] = [];
  for (let version = 1; version <= vault.keyVersion; version++) {
    const row = await ctx.db
      .query("vaultKeys")
      .withIndex("by_vault_version", (q) => q.eq("vaultId", vault._id).eq("version", version))
      .unique();
    if (row && (version === vault.keyVersion || row.retiredAt === undefined)) out.push(version);
  }
  return out;
}

function checkCovers(grants: { version: number }[], versions: number[]) {
  const have = new Set(grants.map((g) => g.version));
  if (grants.length !== have.size || versions.some((ver) => !have.has(ver)) || grants.some((g) => !versions.includes(g.version))) fail("invalid_argument", "Wrap every key version of the Vault.");
}

/**
 * The first key of a Vault, from its owner's device: the key's check value and the owner's two grants (passcode
 * and recovery). Once only.
 */
export const setUp = mutation({
  args: { vaultId: v.string(), check: v.bytes(), passcode: vPasscodeGrant, recovery: vSealedGrant, client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId, "owner");
    if (vault.keyVersion !== 0) fail("conflict", "This Vault is already set up.");
    if (args.check.byteLength !== 16) fail("invalid_argument", "Invalid key data.");
    if (args.passcode.version !== 1 || args.recovery.version !== 1) fail("invalid_argument", "The first key is version 1.");
    checkWrap(args.passcode.wrapped);
    checkWrap(args.recovery.wrapped);
    checkKdf(args.passcode.kdf);
    if (args.passcode.salt.byteLength !== 16) fail("invalid_argument", "Invalid key data.");
    await requireEpoch(ctx, profile._id, args.passcode.epoch);
    if (args.recovery.epoch !== args.passcode.epoch) fail("invalid_argument", "Invalid key data.");
    const now = Date.now();
    await insertScoped(ctx, "vaultKeys", scopeOfRow(vault), { vaultId: vault._id, version: 1, check: args.check, createdBy: profile._id, createdAt: now });
    await ctx.db.patch(vault._id, { keyVersion: 1 });
    await replaceGrants(ctx, vault, profile._id, "passcode", [args.passcode], profile._id);
    await replaceGrants(ctx, vault, profile._id, "recovery", [args.recovery], profile._id);
    await appendLog(ctx, vault, { event: "key.created", actor: { profile, role }, detail: { version: 1 }, client: args.client });
    await appendLog(ctx, vault, { event: "passcode.set", actor: { profile, role }, client: args.client });
    await appendLog(ctx, vault, { event: "recovery.set", actor: { profile, role }, client: args.client });
    return null;
  },
});

/** A lockout in force for this person, or null. */
async function throttleOf(ctx: Ctx, vault: Doc<"vaults">, profileId: Id<"profiles">) {
  return await ctx.db
    .query("vaultThrottles")
    .withIndex("by_vault_profile", (q) => q.eq("vaultId", vault._id).eq("profileId", profileId))
    .unique();
}

/**
 * Starts an unlock: hands the caller their sealed grants for every live key version (by passcode or by recovery
 * key), the key check values and the Vault's auto-lock time. Logged as a server-seen attempt; the device then
 * reports how it went (unlockResult). While the person is locked out it answers `locked` (and logs the try).
 */
export const unlock = mutation({
  args: { vaultId: v.string(), way: v.union(v.literal("passcode"), v.literal("recovery")), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    if (vault.keyVersion === 0) fail("not_found", "This Vault isn't set up yet.");
    const throttle = await throttleOf(ctx, vault, profile._id);
    const now = Date.now();
    if (throttle?.lockedUntil && throttle.lockedUntil > now) {
      // Answered, not thrown: a thrown error would roll the log entry back with it.
      await appendLog(ctx, vault, { event: "vault.unlock", outcome: "failed", reason: "locked_out", actor: { profile, role }, detail: { way: args.way, lockedUntil: throttle.lockedUntil }, client: args.client });
      return { locked: true as const, lockedUntil: throttle.lockedUntil };
    }
    const versions = await liveVersions(ctx, vault);
    const own = await grantsOf(ctx, vault._id, profile._id, args.way);
    const custodian = await grantsOf(ctx, vault._id, profile._id, "custodian");
    const keys = [];
    for (const version of versions) {
      const row = await ctx.db
        .query("vaultKeys")
        .withIndex("by_vault_version", (q) => q.eq("vaultId", vault._id).eq("version", version))
        .unique();
      keys.push({ version, check: row!.check });
    }
    await appendLog(ctx, vault, { event: "vault.unlockAttempt", actor: { profile, role }, detail: { way: args.way }, client: args.client });
    return {
      locked: false as const,
      keyVersion: vault.keyVersion,
      keys,
      grants: own.filter((g) => versions.includes(g.version)).map((g) => ({ version: g.version, epoch: g.epoch, wrapped: g.wrapped, salt: g.passcodeSalt ?? null, kdf: g.kdf ?? null })),
      /** A custodian shared the key: the person sets a passcode (setPasscode) to finish. */
      fromCustodian: custodian.filter((g) => versions.includes(g.version)).map((g) => ({ version: g.version, epoch: g.epoch, wrapped: g.wrapped })),
      autoLockMinutes: vault.autoLockMinutes,
      role,
    };
  },
});

/**
 * How an unlock went, from the device (it alone can check the passcode). A wrong passcode counts toward a
 * lockout: 5 in a row lock this person out for 15 minutes, every later lockout lasts an hour.
 */
export const unlockResult = mutation({
  args: { vaultId: v.string(), ok: v.boolean(), way: v.union(v.literal("passcode"), v.literal("recovery")), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    const throttle = await throttleOf(ctx, vault, profile._id);
    const now = Date.now();
    if (args.ok) {
      if (throttle && throttle.failures) await ctx.db.patch(throttle._id, { failures: 0, updatedAt: now });
      await appendLog(ctx, vault, { event: "vault.unlock", actor: { profile, role }, detail: { way: args.way }, client: args.client, source: "device" });
      return { lockedUntil: null };
    }
    const failures = (throttle?.failures ?? 0) + 1;
    let lockedUntil: number | undefined;
    let lockouts = throttle?.lockouts ?? 0;
    if (failures % MAX_FAILURES === 0) {
      lockedUntil = now + LOCKOUT_MS[Math.min(lockouts, LOCKOUT_MS.length - 1)]!;
      lockouts++;
    }
    if (throttle) await ctx.db.patch(throttle._id, { failures, lockouts, updatedAt: now, ...(lockedUntil ? { lockedUntil } : {}) });
    else await insertScoped(ctx, "vaultThrottles", scopeOfRow(vault), { vaultId: vault._id, profileId: profile._id, failures, lockouts, updatedAt: now, ...(lockedUntil ? { lockedUntil } : {}) });
    await appendLog(ctx, vault, { event: "vault.unlock", outcome: "failed", reason: args.way === "passcode" ? "wrong_passcode" : "wrong_recovery_key", actor: { profile, role }, detail: { way: args.way, failuresInARow: failures, ...(lockedUntil ? { lockedUntil } : {}) }, client: args.client, source: "device" });
    return { lockedUntil: lockedUntil ?? null };
  },
});

/** The Vault locked on a device: by hand, after being idle, the tab closing, the computer sleeping, signing out. */
export const lock = mutation({
  args: { vaultId: v.string(), how: v.union(v.literal("manual"), v.literal("idle"), v.literal("tab"), v.literal("sleep"), v.literal("signout")), openForMs: v.optional(v.number()), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    await appendLog(ctx, vault, { event: "vault.lock", actor: { profile, role }, detail: { how: args.how, ...(args.openForMs !== undefined ? { openForMs: Math.max(0, Math.round(args.openForMs)) } : {}) }, client: args.client, source: "device" });
    return null;
  },
});

/**
 * Sets the caller's passcode: their passcode-layer grants for every live key version, sealed on their device. Used
 * the first time (after a custodian shared the key), to change it, and to reset it with the recovery key; a
 * custodian's inner-only grants go once the person's own are in.
 */
export const setPasscode = mutation({
  args: { vaultId: v.string(), grants: v.array(vPasscodeGrant), reason: v.union(v.literal("first"), v.literal("changed"), v.literal("reset"), v.literal("rotation")), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    const versions = await liveVersions(ctx, vault);
    checkCovers(args.grants, versions);
    for (const g of args.grants) {
      checkWrap(g.wrapped);
      checkKdf(g.kdf);
      if (g.salt.byteLength !== 16) fail("invalid_argument", "Invalid key data.");
      await requireEpoch(ctx, profile._id, g.epoch);
    }
    await replaceGrants(ctx, vault, profile._id, "passcode", args.grants, profile._id);
    for (const old of await grantsOf(ctx, vault._id, profile._id, "custodian")) await ctx.db.delete(old._id);
    const throttle = await throttleOf(ctx, vault, profile._id);
    if (throttle) await ctx.db.patch(throttle._id, { failures: 0, updatedAt: Date.now() });
    const event = { changed: "passcode.changed", reset: "passcode.reset", first: "passcode.set", rotation: "key.adopted" }[args.reason];
    await appendLog(ctx, vault, { event, actor: { profile, role }, ...(args.reason === "rotation" ? { detail: { version: vault.keyVersion } } : {}), client: args.client });
    return null;
  },
});

/** A new vault recovery key for the caller (their recovery-layer grants, sealed on their device). */
export const setRecovery = mutation({
  args: { vaultId: v.string(), grants: v.array(vSealedGrant), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    checkCovers(args.grants, await liveVersions(ctx, vault));
    for (const g of args.grants) {
      checkWrap(g.wrapped);
      await requireEpoch(ctx, profile._id, g.epoch);
    }
    const had = (await grantsOf(ctx, vault._id, profile._id, "recovery")).length > 0;
    await replaceGrants(ctx, vault, profile._id, "recovery", args.grants, profile._id);
    await appendLog(ctx, vault, { event: had ? "recovery.changed" : "recovery.set", actor: { profile, role }, client: args.client });
    return null;
  },
});

/**
 * Someone who forgot their passcode and has no recovery key asks a custodian for the key again (team Vault only:
 * a Personal Vault has nobody else). Their own grants go; a custodian's device grants them anew.
 */
export const requestReset = mutation({
  args: { vaultId: v.string(), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    if (vault.ownerProfileId) fail("forbidden", "A Personal Vault opens only with your passcode or your recovery key.");
    for (const layer of ["passcode", "recovery", "custodian"] as const) for (const g of await grantsOf(ctx, vault._id, profile._id, layer)) await ctx.db.delete(g._id);
    const pending = await ctx.db
      .query("vaultPendingGrants")
      .withIndex("by_vault_profile", (q) => q.eq("vaultId", vault._id).eq("profileId", profile._id))
      .first();
    if (!pending) await insertScoped(ctx, "vaultPendingGrants", scopeOfRow(vault), { vaultId: vault._id, profileId: profile._id, reason: "reset", createdAt: Date.now() });
    await appendLog(ctx, vault, { event: "access.resetRequested", actor: { profile, role }, client: args.client });
    return null;
  },
});

/**
 * People waiting for the vault key (added, reset, or after a rotation), with the account public keys a custodian's
 * device seals it to. Custodians only.
 */
export const pending = query({
  args: { vaultId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { vault } = await requireVault(ctx, profile, args.vaultId, "custodian");
    const rows = await ctx.db
      .query("vaultPendingGrants")
      .withIndex("by_vault", (q) => q.eq("vaultId", vault._id))
      .take(200);
    const out = [];
    for (const r of rows) {
      const p = await ctx.db.get(r.profileId);
      const account = await activeAccount(ctx, r.profileId);
      out.push({
        profileId: r.profileId as string,
        name: p?.displayName ?? "Someone",
        email: p?.email ?? null,
        reason: r.reason,
        since: r.createdAt,
        /** Null until they set up encryption (the grant waits). */
        account: account ? { epoch: account.epoch, x25519Pub: account.x25519Pub, ed25519Pub: account.ed25519Pub, statement: account.statement } : null,
      });
    }
    return { keyVersions: await liveVersions(ctx, vault), people: out };
  },
});

/**
 * A custodian's device shares the vault key with someone waiting: every live version sealed to their account key
 * (the inner layer only). They finish by setting their passcode. Logged for both sides.
 */
export const grant = mutation({
  args: { vaultId: v.string(), profileId: v.string(), grants: v.array(vSealedGrant), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId, "custodian");
    const targetId = ctx.db.normalizeId("profiles", args.profileId);
    const target = targetId ? await ctx.db.get(targetId) : null;
    if (!target) fail("not_found", "They aren't in this Vault.");
    if (!(await vaultRoleOf(ctx, target, vault))) fail("not_found", "They aren't in this Vault.");
    checkCovers(args.grants, await liveVersions(ctx, vault));
    for (const g of args.grants) {
      checkWrap(g.wrapped);
      await requireEpoch(ctx, target._id, g.epoch);
    }
    await replaceGrants(ctx, vault, target._id, "custodian", args.grants, profile._id);
    for (const p of await ctx.db
      .query("vaultPendingGrants")
      .withIndex("by_vault_profile", (q) => q.eq("vaultId", vault._id).eq("profileId", target._id))
      .collect())
      await ctx.db.delete(p._id);
    await appendLog(ctx, vault, { event: "access.granted", actor: { profile, role }, detail: { to: { profileId: target._id, name: target.displayName, email: target.email }, versions: args.grants.map((g) => g.version) }, client: args.client });
    return null;
  },
});
