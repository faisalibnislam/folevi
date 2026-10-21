// End-to-end encryption: a person's account keys and the ways to unlock them (docs/E2EE_DESIGN.md §4.7,
// §5.3). The account master key (AMK) never reaches the server: it stores the account's public keys, a
// check value, a self-signed statement, and the AMK wrapped for each way in (a trusted device, the recovery
// key, a passkey, the passphrase). WP2.
import { v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { ulid } from "@folevi/editor-schema";
import { assertWritable, requireIdentity, requireProfile, sessionIdOf } from "../lib/auth";
import { keyedHash } from "../lib/crypto";
import { fail } from "../lib/errors";
import { scopeOfRow, vScopeArg, workspaceScope } from "../lib/scope";
import {
  activeAccount,
  addPending,
  b64u,
  checkBytes,
  checkPublicKey,
  cleanLabel,
  consumeUnlockAttempt,
  expectStatement,
  grantsOf,
  holdsEncryptedSpace,
  isUlid,
  methodKinds,
  requireAccount,
  requireE2eeFlag,
  storeGrants,
  trustedDevices,
  wrapsOf,
} from "../lib/e2ee/keyStore";
import { failE2ee, isE2eeActive } from "../lib/e2ee/state";
import {
  E2EE_LIMITS,
  vAccountKeyStatement,
  vAccountRegistration,
  vDeviceRegistration,
  vDeviceStatement,
  vSpaceGrantInput,
  vWrapInput,
  vWrapKind,
  type AccountRegistration,
  type DeviceRegistration,
  type WrapInput,
} from "../lib/e2ee/validators";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Wraps of a superseded epoch stay readable this long in case a lost method turns up (§4.7). */
export const SUPERSEDED_WRAP_DAYS = 30;
/** Minimum passphrase stretching a wrap may declare (§4.7.3); parameters may rise later, never fall. */
const KDF_MIN = { m: 65536, t: 3, p: 1, saltBytes: 16 };

/** Checks an account registration against the caller and the epoch it must be. */
function checkRegistration(profileId: Id<"profiles">, reg: AccountRegistration, epoch: number): void {
  if (reg.epoch !== epoch) fail("conflict", "Your encryption keys changed on another device. Reload and try again.");
  checkPublicKey(reg.x25519Pub, "The account key");
  checkPublicKey(reg.ed25519Pub, "The account signing key");
  checkBytes(reg.amkCheck, "The check value", E2EE_LIMITS.checkBytes);
  expectStatement(reg.statement, { profileId, epoch, x25519Pub: b64u(reg.x25519Pub), ed25519Pub: b64u(reg.ed25519Pub) });
}

/** The session behind this call, as sessionsMirror keys it (to sign a revoked device out). */
async function currentSessionKey(ctx: QueryCtx): Promise<string | undefined> {
  const sid = sessionIdOf(await requireIdentity(ctx));
  return sid ? await keyedHash(sid, "session") : undefined;
}

/** Registers (or refreshes) a device row. Status is decided by the caller. */
export async function upsertDevice(
  ctx: MutationCtx,
  profileId: Id<"profiles">,
  device: DeviceRegistration,
  status: Doc<"e2eeDevices">["status"],
): Promise<Doc<"e2eeDevices">> {
  if (!device.deviceId || device.deviceId.length > 64) fail("invalid_argument", "The device id isn't valid.");
  checkPublicKey(device.x25519Pub, "The device key");
  checkPublicKey(device.ed25519Pub, "The device signing key");
  const now = Date.now();
  const existing = await ctx.db
    .query("e2eeDevices")
    .withIndex("by_profile_device", (q) => q.eq("profileId", profileId).eq("deviceId", device.deviceId))
    .unique();
  const fields = {
    kind: device.kind,
    label: cleanLabel(device.label, device.kind === "app" ? "Folevi for Mac" : "Web browser"),
    platform: cleanLabel(device.platform, "web").slice(0, 40),
    x25519Pub: device.x25519Pub,
    ed25519Pub: device.ed25519Pub,
    status,
    ...(device.statement ? { statement: device.statement } : {}),
    sessionKey: await currentSessionKey(ctx),
    lastSeenAt: now,
  };
  if (existing) {
    if (existing.status === "revoked") fail("forbidden", "This device was removed from your account. Sign in again to use encryption here.");
    await ctx.db.patch(existing._id, fields);
    return (await ctx.db.get(existing._id))!;
  }
  const id = await ctx.db.insert("e2eeDevices", { profileId, deviceId: device.deviceId, createdAt: now, ...fields });
  return (await ctx.db.get(id))!;
}

/** Checks a device statement names this device, its keys and who approved it. */
export function checkDeviceStatement(profileId: Id<"profiles">, device: Pick<DeviceRegistration, "deviceId" | "kind" | "x25519Pub" | "ed25519Pub">, statement: { body: string; sig: string }, approvedBy?: string): void {
  expectStatement(statement, {
    profileId,
    deviceId: device.deviceId,
    kind: device.kind,
    x25519Pub: b64u(device.x25519Pub),
    ed25519Pub: b64u(device.ed25519Pub),
    ...(approvedBy ? { approvedBy } : {}),
  });
}

/** Checks one AMK wrap before it's stored; returns the row's kind-specific fields. */
async function wrapFields(ctx: QueryCtx, profileId: Id<"profiles">, w: WrapInput): Promise<Partial<Doc<"e2eeAccountWraps">>> {
  checkBytes(w.wrapped, "The wrapped key", 22 + 16, E2EE_LIMITS.wrapBytes);
  const label = w.label !== undefined ? { label: cleanLabel(w.label, "") } : {};
  if (w.kind === "device") {
    if (!w.deviceId) fail("invalid_argument", "A device wrap names its device.");
    const device = await ctx.db
      .query("e2eeDevices")
      .withIndex("by_profile_device", (q) => q.eq("profileId", profileId).eq("deviceId", w.deviceId!))
      .unique();
    if (!device || device.status === "revoked") fail("not_found", "Device not found.");
    // A public computer keeps the key in memory only: the server never holds a wrap for it (§4.8).
    if (device.kind === "session") fail("invalid_argument", "A public session doesn't keep a wrapped key.");
    return { deviceId: w.deviceId, ...label };
  }
  if (w.kind === "passkey") {
    if (!w.credentialId || w.credentialId.length > 512 || !/^[A-Za-z0-9_-]+$/.test(w.credentialId)) fail("invalid_argument", "A passkey wrap names its credential.");
    if (!w.prfSalt) fail("invalid_argument", "A passkey wrap carries its salt.");
    checkBytes(w.prfSalt, "The passkey salt", 32);
    return { credentialId: w.credentialId, prfSalt: w.prfSalt, ...label };
  }
  if (w.kind === "passphrase") {
    const kdf = w.kdf;
    if (!kdf) fail("invalid_argument", "A passphrase wrap says how its key was made.");
    if (kdf.m < KDF_MIN.m || kdf.t < KDF_MIN.t || kdf.p < KDF_MIN.p || kdf.salt.byteLength !== KDF_MIN.saltBytes) fail("invalid_argument", "The passphrase settings are too weak.");
    return { kdf, ...label };
  }
  return label;
}

/**
 * Stores one AMK wrap. A recovery key or passphrase replaces the one before it; a device's wrap replaces
 * that device's; passkeys add up (one per credential). The id may be chosen by the client, because the wrap's
 * AAD context includes it (§4.5 `amk/recovery/<profileId>/<wrapId>`).
 */
async function storeWrap(ctx: MutationCtx, profileId: Id<"profiles">, epoch: number, w: WrapInput & { wrapId?: string }): Promise<string> {
  const fields = await wrapFields(ctx, profileId, w);
  const publicId = w.wrapId ?? ulid();
  if (!isUlid(publicId)) fail("invalid_argument", "The wrap id isn't valid.");
  const clash = await ctx.db
    .query("e2eeAccountWraps")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique();
  if (clash) fail("conflict", "That wrap id is taken.");
  for (const old of await wrapsOf(ctx, profileId, epoch)) {
    const replaces =
      old.kind === w.kind &&
      (w.kind === "recoveryKey" || w.kind === "passphrase" || (w.kind === "device" && old.deviceId === w.deviceId) || (w.kind === "passkey" && old.credentialId === w.credentialId));
    if (replaces) await ctx.db.delete(old._id);
  }
  await ctx.db.insert("e2eeAccountWraps", { profileId, epoch, publicId, kind: w.kind, wrapped: w.wrapped, createdAt: Date.now(), ...fields });
  return publicId;
}

const vWrapInputWithId = v.object({ ...vWrapInput.fields, wrapId: v.optional(v.string()) });

/** This person's encryption status: whether it's set up, the public keys, which recovery methods exist. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const account = await activeAccount(ctx, profile._id);
    const devices = await trustedDevices(ctx, profile._id);
    if (!account) {
      return { setUp: false as const, epoch: null, x25519Pub: null, ed25519Pub: null, amkCheck: null, statement: null, methods: [] as string[], devices: devices.length, holdsEncryptedSpace: false };
    }
    return {
      setUp: true as const,
      epoch: account.epoch,
      x25519Pub: account.x25519Pub,
      ed25519Pub: account.ed25519Pub,
      amkCheck: account.amkCheck,
      statement: account.statement,
      methods: [...(await methodKinds(ctx, account))].sort(),
      devices: devices.length,
      holdsEncryptedSpace: await holdsEncryptedSpace(ctx, profile._id),
    };
  },
});

/** Sets encryption up: the first epoch's public keys and the first device with its own wrap (§4.7). */
export const createAccount = mutation({
  args: {
    x25519Pub: v.bytes(),
    ed25519Pub: v.bytes(),
    amkCheck: v.bytes(),
    statement: vAccountKeyStatement,
    device: vDeviceRegistration,
    deviceWrap: v.bytes(),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    await requireE2eeFlag(ctx);
    const latest = await ctx.db
      .query("e2eeAccounts")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .order("desc")
      .first();
    if (latest) fail("conflict", "Encryption is already set up for this account.");
    const reg = { epoch: 1, x25519Pub: args.x25519Pub, ed25519Pub: args.ed25519Pub, amkCheck: args.amkCheck, statement: args.statement };
    checkRegistration(profile._id, reg, 1);
    if (args.device.statement) checkDeviceStatement(profile._id, args.device, args.device.statement);
    await ctx.db.insert("e2eeAccounts", { profileId: profile._id, ...reg, status: "active", createdAt: Date.now() });
    const device = await upsertDevice(ctx, profile._id, args.device, "trusted");
    const wrapId = device.kind === "session" ? null : await storeWrap(ctx, profile._id, 1, { kind: "device", deviceId: device.deviceId, wrapped: args.deviceWrap });
    return { epoch: 1, wrapId };
  },
});

/** Adds a way to unlock (a recovery key, a passkey, a passphrase, or this device's own wrap). */
export const addWrap = mutation({
  args: vWrapInputWithId.fields,
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const account = await requireAccount(ctx, profile._id);
    const publicId = await storeWrap(ctx, profile._id, account.epoch, args);
    return { publicId };
  },
});

/** Removes a way to unlock. Refused when it would leave fewer than two kinds while a space is encrypted. */
export const removeWrap = mutation({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const account = await requireAccount(ctx, profile._id);
    const wrap = await ctx.db
      .query("e2eeAccountWraps")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.publicId))
      .unique();
    if (!wrap || wrap.profileId !== profile._id) fail("not_found", "Not found.");
    if (wrap.epoch === account.epoch) {
      const before = await methodKinds(ctx, account);
      const after = await methodKinds(ctx, account, wrap._id);
      if (after.size < 2 && after.size < before.size && (await holdsEncryptedSpace(ctx, profile._id))) failE2ee("e2ee_last_method");
    }
    await ctx.db.delete(wrap._id);
    return null;
  },
});

/** The ways to unlock this account (kinds, labels, dates). Never the wrapped key itself. */
export const listWraps = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const account = await activeAccount(ctx, profile._id);
    if (!account) return [];
    const wraps = await wrapsOf(ctx, profile._id, account.epoch);
    return wraps.map((w) => ({
      publicId: w.publicId,
      kind: w.kind,
      label: w.label ?? null,
      deviceId: w.deviceId ?? null,
      // A passkey ceremony needs the credential and its salt before it can produce the key (§4.7.2).
      credentialId: w.credentialId ?? null,
      prfSalt: w.prfSalt ?? null,
      createdAt: w.createdAt,
      lastUsedAt: w.lastUsedAt ?? null,
    }));
  },
});

/**
 * Hands out a recovery wrap to open on the device (a recovery key, a passkey or the passphrase). A
 * mutation so it can count: 10 an hour per account (§4.7.3). Records `lastUsedAt` (spaces.lower checks a
 * method was re-checked in the last 10 minutes).
 */
export const getWrap = mutation({
  args: { kind: vWrapKind, credentialId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const account = await requireAccount(ctx, profile._id);
    if (args.kind === "device") fail("invalid_argument", "A device opens its own wrap (getDeviceWrap).");
    await consumeUnlockAttempt(ctx, profile._id);
    const wraps = (await wrapsOf(ctx, profile._id, account.epoch)).filter((w) => w.kind === args.kind && (args.kind !== "passkey" || !args.credentialId || w.credentialId === args.credentialId));
    const wrap = wraps.sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!wrap) return null;
    await ctx.db.patch(wrap._id, { lastUsedAt: Date.now() });
    return {
      publicId: wrap.publicId,
      epoch: wrap.epoch,
      kind: wrap.kind,
      wrapped: wrap.wrapped,
      kdf: wrap.kdf ?? null,
      prfSalt: wrap.prfSalt ?? null,
      credentialId: wrap.credentialId ?? null,
    };
  },
});

/** This device's own wrap of the AMK (sealed to its key). Null once the device is revoked or has none. */
export const getDeviceWrap = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const account = await activeAccount(ctx, profile._id);
    if (!account) return null;
    const device = await ctx.db
      .query("e2eeDevices")
      .withIndex("by_profile_device", (q) => q.eq("profileId", profile._id).eq("deviceId", args.deviceId))
      .unique();
    if (!device || device.status !== "trusted") return null;
    const wrap = await ctx.db
      .query("e2eeAccountWraps")
      .withIndex("by_profile_device", (q) => q.eq("profileId", profile._id).eq("deviceId", args.deviceId))
      .filter((q) => q.eq(q.field("epoch"), account.epoch))
      .first();
    return wrap ? { publicId: wrap.publicId, epoch: wrap.epoch, wrapped: wrap.wrapped } : null;
  },
});

/** Supersedes the current epoch with a new one (keeps the old one's wraps for SUPERSEDED_WRAP_DAYS). */
async function newEpoch(ctx: MutationCtx, profileId: Id<"profiles">, current: Doc<"e2eeAccounts">, reg: AccountRegistration): Promise<void> {
  checkRegistration(profileId, reg, current.epoch + 1);
  const now = Date.now();
  await ctx.db.patch(current._id, { status: "superseded", supersededAt: now });
  await ctx.db.insert("e2eeAccounts", { profileId, ...reg, status: "active", createdAt: now });
}

const vDeviceStatementUpdate = v.object({ deviceId: v.string(), statement: vDeviceStatement });

/**
 * Changes the AMK (after revoking a device with "Also change your encryption key", §4.8): a new epoch, its
 * wraps for every remaining method and device, the person's space keys granted again to the new account key,
 * and their devices' statements signed again by it. Space keys themselves don't change here.
 */
export const rotateAccount = mutation({
  args: {
    newEpoch: vAccountRegistration,
    wraps: v.array(vWrapInputWithId),
    regrants: v.array(v.object({ scope: vScopeArg, grant: vSpaceGrantInput })),
    deviceStatements: v.optional(v.array(vDeviceStatementUpdate)),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const current = await requireAccount(ctx, profile._id);
    if (args.wraps.length > E2EE_LIMITS.batch || args.regrants.length > E2EE_LIMITS.batch) fail("invalid_argument", "Too many items in one call.");
    await newEpoch(ctx, profile._id, current, args.newEpoch);
    const epoch = args.newEpoch.epoch;
    for (const w of args.wraps) await storeWrap(ctx, profile._id, epoch, w);
    const fresh = (await activeAccount(ctx, profile._id))!;
    if ((await holdsEncryptedSpace(ctx, profile._id)) && (await methodKinds(ctx, fresh)).size < 2) failE2ee("e2ee_recovery_required");
    for (const { scope: arg, grant } of args.regrants) {
      if (grant.profileId !== profile._id || grant.epoch !== epoch) fail("invalid_argument", "A rotation re-grants your own keys only.");
      const scope = arg.kind === "personal" ? { kind: "personal" as const, profileId: profile._id } : workspaceScope(await workspaceIdOf(ctx, arg.workspaceId));
      // Only versions the person already held (at the old epoch) can be granted again by them.
      const held = (await grantsOf(ctx, scope, profile._id)).some((g) => g.version === grant.version);
      if (!held) fail("forbidden", "You don't hold that key.");
      await storeGrants(ctx, scope, profile._id, [grant]);
    }
    for (const { deviceId, statement } of args.deviceStatements ?? []) {
      const device = await ctx.db
        .query("e2eeDevices")
        .withIndex("by_profile_device", (q) => q.eq("profileId", profile._id).eq("deviceId", deviceId))
        .unique();
      if (!device || device.status !== "trusted") continue;
      checkDeviceStatement(profile._id, device, statement);
      await ctx.db.patch(device._id, { statement });
    }
    return { epoch };
  },
});

async function workspaceIdOf(ctx: QueryCtx, publicId: string): Promise<Id<"workspaces">> {
  const ws = await ctx.db
    .query("workspaces")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique();
  if (!ws) fail("not_found", "Workspace not found.");
  return ws._id;
}

/**
 * Starts over after every way to unlock was lost (§8.7): a new epoch with new wraps. Notes keyed only to the
 * old epoch stay unreadable; every encrypted workspace the person belongs to gets a "reset" pending grant so
 * an admin's device can share its key with the new account key.
 */
export const resetAccount = mutation({
  args: { newEpoch: vAccountRegistration, wraps: v.array(vWrapInputWithId) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const current = await requireAccount(ctx, profile._id);
    if (args.wraps.length > E2EE_LIMITS.batch) fail("invalid_argument", "Too many items in one call.");
    await newEpoch(ctx, profile._id, current, args.newEpoch);
    for (const w of args.wraps) await storeWrap(ctx, profile._id, args.newEpoch.epoch, w);
    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(500);
    let pending = 0;
    for (const m of memberships) {
      const scope = workspaceScope(m.workspaceId);
      const space = await ctx.db
        .query("e2eeSpaces")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", m.workspaceId))
        .first();
      if (!space || space.currentKeyVersion < 1 || !isE2eeActive(space)) continue;
      await addPending(ctx, scope, profile._id, "reset");
      pending++;
    }
    return { epoch: args.newEpoch.epoch, pending };
  },
});

/**
 * The current public keys and account statement of people the caller shares a workspace or a page with
 * (themselves included), so a device can seal a key to them after checking the statement. Others read as
 * null, like people with no keys.
 */
export const accountKeysOf = query({
  args: { profileIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (args.profileIds.length > 200) fail("invalid_argument", "Too many people in one call.");
    const myWorkspaces = new Set(
      (
        await ctx.db
          .query("workspaceMembers")
          .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
          .take(500)
      ).map((m) => m.workspaceId as string),
    );
    const out: { profileId: string; epoch: number; x25519Pub: ArrayBuffer; ed25519Pub: ArrayBuffer; statement: Doc<"e2eeAccounts">["statement"] }[] = [];
    for (const id of args.profileIds) {
      const profileId = ctx.db.normalizeId("profiles", id);
      if (!profileId) continue;
      if (profileId !== profile._id && !(await sharesWith(ctx, profile._id, myWorkspaces, profileId))) continue;
      const account = await activeAccount(ctx, profileId);
      if (!account) continue;
      out.push({ profileId: id, epoch: account.epoch, x25519Pub: account.x25519Pub, ed25519Pub: account.ed25519Pub, statement: account.statement });
    }
    return out;
  },
});

/** Whether `other` is in one of the caller's workspaces, or a page grant links the two people. */
async function sharesWith(ctx: QueryCtx, me: Id<"profiles">, myWorkspaces: Set<string>, other: Id<"profiles">): Promise<boolean> {
  const theirs = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_profile", (q) => q.eq("profileId", other))
    .take(500);
  if (theirs.some((m) => myWorkspaces.has(m.workspaceId))) return true;
  // A page of mine (my Personal or my workspaces) shared with them, or a page of their Personal shared with me.
  const theirGrants = await ctx.db
    .query("documentPermissions")
    .withIndex("by_profile", (q) => q.eq("profileId", other))
    .take(500);
  for (const g of theirGrants) {
    if (g.ownerProfileId === me || (g.workspaceId && myWorkspaces.has(g.workspaceId))) return true;
  }
  const myGrants = await ctx.db
    .query("documentPermissions")
    .withIndex("by_profile", (q) => q.eq("profileId", me))
    .take(500);
  for (const g of myGrants) {
    const scope = scopeOfRow(g);
    if (scope.kind === "personal" && scope.profileId === other) return true;
  }
  return false;
}

/** Daily: deletes wraps of epochs superseded more than SUPERSEDED_WRAP_DAYS ago (cron). */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - SUPERSEDED_WRAP_DAYS * 86_400_000;
    const old = await ctx.db
      .query("e2eeAccounts")
      .withIndex("by_status_superseded", (q) => q.eq("status", "superseded").lt("supersededAt", cutoff))
      .take(100);
    let deleted = 0;
    for (const account of old) {
      const wraps = await wrapsOf(ctx, account.profileId, account.epoch);
      for (const w of wraps) {
        await ctx.db.delete(w._id);
        deleted++;
      }
      // The old epoch's public keys go too once nothing can open it any more.
      if (wraps.length < 200) await ctx.db.delete(account._id);
    }
    return { deleted };
  },
});
