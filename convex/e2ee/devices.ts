// End-to-end encryption: devices and trusted browsers, and approving a new one from a trusted one
// (docs/E2EE_DESIGN.md §4.8, §5.3). The approval is commit-then-reveal: the new device commits to its nonce
// and keys before it sees the approver's nonce, so a server substituting keys can't grind a matching code.
// The server only relays; both devices compute and compare the code. WP2.
import { v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { ulid } from "@folevi/editor-schema";
import { assertWritable, requireProfile } from "../lib/auth";
import { deleteSession } from "../lib/authStore";
import { fail } from "../lib/errors";
import { activeAccount, checkBytes, checkPublicKey, requireAccount, wrapsOf } from "../lib/e2ee/keyStore";
import { failE2ee } from "../lib/e2ee/state";
import { E2EE_LIMITS, vDeviceKind, vDeviceRegistration, vDeviceStatement } from "../lib/e2ee/validators";
import { checkDeviceStatement, upsertDevice } from "./keys";

/** An approval request lives this long (§4.8). */
export const APPROVAL_TTL_MS = 10 * 60_000;
/** Three cancelled requests in an hour lock approvals for an hour (§4.8). */
const CANCEL_LIMIT = 3;
const CANCEL_WINDOW_MS = 60 * 60_000;
/** Finished requests are deleted a day after they expire. */
const KEEP_FINISHED_MS = 24 * 60 * 60_000;
const NONCE_BYTES = 32;
const COMMIT_BYTES = 32;

const OPEN_STATUSES = new Set<Doc<"e2eeApprovals">["status"]>(["waiting", "answered", "revealed"]);

async function deviceOf(ctx: QueryCtx, profileId: Id<"profiles">, deviceId: string): Promise<Doc<"e2eeDevices"> | null> {
  return await ctx.db
    .query("e2eeDevices")
    .withIndex("by_profile_device", (q) => q.eq("profileId", profileId).eq("deviceId", deviceId))
    .unique();
}

/** A trusted app or browser of the person (public sessions can't approve, §4.8). */
async function requireApprover(ctx: QueryCtx, profileId: Id<"profiles">, deviceId: string): Promise<Doc<"e2eeDevices">> {
  const device = await deviceOf(ctx, profileId, deviceId);
  if (!device || device.status !== "trusted" || device.kind === "session") fail("forbidden", "Only a trusted device or browser can approve.");
  return device;
}

/** An open (not finished, not expired) request of the caller's account. */
async function openApproval(ctx: QueryCtx, profileId: Id<"profiles">, requestId: string): Promise<Doc<"e2eeApprovals">> {
  const approval = await ctx.db
    .query("e2eeApprovals")
    .withIndex("by_public_id", (q) => q.eq("publicId", requestId))
    .unique();
  if (!approval || approval.profileId !== profileId) fail("not_found", "This request has ended.");
  if (!OPEN_STATUSES.has(approval.status) || approval.expiresAt <= Date.now()) fail("expired", "This request has ended. Try again.");
  return approval;
}

async function cancelledRecently(ctx: QueryCtx, profileId: Id<"profiles">): Promise<number> {
  const since = Date.now() - CANCEL_WINDOW_MS;
  const rows = await ctx.db
    .query("e2eeApprovals")
    .withIndex("by_profile_status", (q) => q.eq("profileId", profileId).eq("status", "cancelled"))
    .order("desc")
    .take(20);
  return rows.filter((r) => r.createdAt >= since).length;
}

async function requireNotLocked(ctx: QueryCtx, profileId: Id<"profiles">): Promise<void> {
  if ((await cancelledRecently(ctx, profileId)) >= CANCEL_LIMIT) {
    failE2ee("e2ee_rate_limited", "Approvals are paused for an hour after several codes didn't match. Use another way to unlock, or try again later.");
  }
}

/** Registers this device or browser's public keys (pending until approved, or trusted with a recovery-made statement). */
export const register = mutation({
  args: { device: vDeviceRegistration },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const account = await requireAccount(ctx, profile._id);
    const existing = await deviceOf(ctx, profile._id, args.device.deviceId);
    if (existing && existing.status === "trusted") {
      // A trusted device's keys never change (its wrap is sealed to them); it re-registers only to refresh.
      if (!sameKeys(existing, args.device)) fail("conflict", "This device already has keys. Remove it in Settings > Devices to start again.");
      // Its statement changes only through approval or an account rotation, never by re-registering.
      const { statement: _ignored, ...device } = args.device;
      const next = await upsertDevice(ctx, profile._id, { ...device, ...(existing.statement ? { statement: existing.statement } : {}) }, "trusted");
      return { status: next.status };
    }
    // Unlocking with a recovery method on this device: it opened the AMK itself and signed its own statement.
    let status: Doc<"e2eeDevices">["status"] = "pending";
    if (args.device.statement) {
      await checkDeviceStatement(profile._id, args.device, args.device.statement, account.ed25519Pub, "recovery");
      status = "trusted";
    }
    const device = await upsertDevice(ctx, profile._id, args.device, status);
    return { status: device.status };
  },
});

function sameKeys(a: { x25519Pub: ArrayBuffer; ed25519Pub: ArrayBuffer }, b: { x25519Pub: ArrayBuffer; ed25519Pub: ArrayBuffer }): boolean {
  const eq = (x: ArrayBuffer, y: ArrayBuffer) => x.byteLength === y.byteLength && new Uint8Array(x).every((byte, i) => byte === new Uint8Array(y)[i]);
  return eq(a.x25519Pub, b.x25519Pub) && eq(a.ed25519Pub, b.ed25519Pub);
}

/** Step 1: a new device asks for the key, committing to its nonce and keys. */
export const requestApproval = mutation({
  args: {
    deviceId: v.string(),
    kind: vDeviceKind,
    label: v.string(),
    platform: v.optional(v.string()),
    x25519Pub: v.bytes(),
    ed25519Pub: v.bytes(),
    commit: v.bytes(),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    await requireAccount(ctx, profile._id);
    await requireNotLocked(ctx, profile._id);
    checkPublicKey(args.x25519Pub, "The device key");
    checkPublicKey(args.ed25519Pub, "The device signing key");
    checkBytes(args.commit, "The commitment", COMMIT_BYTES);
    const existing = await deviceOf(ctx, profile._id, args.deviceId);
    if (existing?.status === "trusted") fail("conflict", "This device is already trusted.");
    await upsertDevice(ctx, profile._id, { deviceId: args.deviceId, kind: args.kind, label: args.label, platform: args.platform ?? "web", x25519Pub: args.x25519Pub, ed25519Pub: args.ed25519Pub }, "pending");
    // One open request per device: a new one replaces the last.
    const now = Date.now();
    for (const status of ["waiting", "answered", "revealed"] as const) {
      const open = await ctx.db
        .query("e2eeApprovals")
        .withIndex("by_profile_status", (q) => q.eq("profileId", profile._id).eq("status", status))
        .take(50);
      for (const a of open) if (a.deviceId === args.deviceId) await ctx.db.patch(a._id, { status: "expired" });
    }
    const requestId = ulid();
    await ctx.db.insert("e2eeApprovals", { publicId: requestId, profileId: profile._id, deviceId: args.deviceId, commit: args.commit, status: "waiting", createdAt: now, expiresAt: now + APPROVAL_TTL_MS });
    return { requestId, expiresAt: now + APPROVAL_TTL_MS };
  },
});

/** Step 2: the person taps Approve on a trusted device, which sends its nonce. The first answer wins. */
export const answerApproval = mutation({
  args: { requestId: v.string(), nonce: v.bytes(), approverDeviceId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await requireNotLocked(ctx, profile._id);
    const approval = await openApproval(ctx, profile._id, args.requestId);
    if (approval.status !== "waiting") fail("conflict", "Another device already answered this request.");
    if (args.approverDeviceId === approval.deviceId) fail("invalid_argument", "A device can't approve itself.");
    await requireApprover(ctx, profile._id, args.approverDeviceId);
    checkBytes(args.nonce, "The nonce", NONCE_BYTES);
    await ctx.db.patch(approval._id, { status: "answered", approverDeviceId: args.approverDeviceId, approverNonce: args.nonce });
    return null;
  },
});

/** Step 3: the new device, having seen the approver's nonce, reveals its own. */
export const revealApproval = mutation({
  args: { requestId: v.string(), nonce: v.bytes() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const approval = await openApproval(ctx, profile._id, args.requestId);
    if (approval.status !== "answered") fail("conflict", "Wait for your other device to answer.");
    checkBytes(args.nonce, "The nonce", NONCE_BYTES);
    await ctx.db.patch(approval._id, { status: "revealed", requesterNonce: args.nonce });
    return null;
  },
});

/**
 * Step 5: the codes matched; the approver hands over the AMK sealed to the new device's key and the device
 * statement it signed. The new device becomes trusted.
 */
export const completeApproval = mutation({
  args: { requestId: v.string(), wrapped: v.bytes(), statement: vDeviceStatement },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const account = await requireAccount(ctx, profile._id);
    const approval = await openApproval(ctx, profile._id, args.requestId);
    if (approval.status !== "revealed" || !approval.approverDeviceId) fail("conflict", "This request isn't ready yet.");
    await requireApprover(ctx, profile._id, approval.approverDeviceId);
    const device = await deviceOf(ctx, profile._id, approval.deviceId);
    if (!device || device.status === "revoked") fail("not_found", "Device not found.");
    await checkDeviceStatement(profile._id, device, args.statement, account.ed25519Pub, approval.approverDeviceId);
    checkBytes(args.wrapped, "The wrapped key", 49 + 16, E2EE_LIMITS.wrapBytes);
    if (device.kind !== "session") {
      for (const w of await wrapsOf(ctx, profile._id, account.epoch)) if (w.kind === "device" && w.deviceId === device.deviceId) await ctx.db.delete(w._id);
      await ctx.db.insert("e2eeAccountWraps", { profileId: profile._id, epoch: account.epoch, publicId: ulid(), kind: "device", deviceId: device.deviceId, wrapped: args.wrapped, createdAt: Date.now() });
    }
    await ctx.db.patch(device._id, { status: "trusted", statement: args.statement, lastSeenAt: Date.now() });
    // The new device also reads the sealed key from the request (a public session has no stored wrap).
    await ctx.db.patch(approval._id, { status: "done", wrapped: args.wrapped });
    return null;
  },
});

/** "They don't match" (or the new device gave up). Three in an hour lock approvals for an hour. */
export const cancelApproval = mutation({
  args: { requestId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const approval = await ctx.db
      .query("e2eeApprovals")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.requestId))
      .unique();
    if (!approval || approval.profileId !== profile._id) fail("not_found", "This request has ended.");
    if (OPEN_STATUSES.has(approval.status)) await ctx.db.patch(approval._id, { status: "cancelled" });
    return null;
  },
});

/** Open requests for this account, for the approve dialog on trusted devices. */
export const approvals = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const now = Date.now();
    const out = [];
    for (const status of ["waiting", "answered", "revealed"] as const) {
      const rows = await ctx.db
        .query("e2eeApprovals")
        .withIndex("by_profile_status", (q) => q.eq("profileId", profile._id).eq("status", status))
        .take(20);
      for (const a of rows) {
        if (a.expiresAt <= now) continue;
        const device = await deviceOf(ctx, profile._id, a.deviceId);
        if (!device || device.status === "revoked") continue;
        out.push({
          requestId: a.publicId,
          status: a.status,
          deviceId: a.deviceId,
          kind: device.kind,
          label: device.label,
          platform: device.platform,
          x25519Pub: device.x25519Pub,
          ed25519Pub: device.ed25519Pub,
          commit: a.commit,
          approverDeviceId: a.approverDeviceId ?? null,
          approverNonce: a.approverNonce ?? null,
          requesterNonce: a.requesterNonce ?? null,
          createdAt: a.createdAt,
          expiresAt: a.expiresAt,
        });
      }
    }
    return out.sort((x, y) => y.createdAt - x.createdAt);
  },
});

/** One request, for the new device: the approver's nonce and signing key once answered, the sealed key once done. */
export const approval = query({
  args: { requestId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const a = await ctx.db
      .query("e2eeApprovals")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.requestId))
      .unique();
    if (!a || a.profileId !== profile._id) return null;
    const status = OPEN_STATUSES.has(a.status) && a.expiresAt <= Date.now() ? ("expired" as const) : a.status;
    const approver = a.approverDeviceId ? await deviceOf(ctx, profile._id, a.approverDeviceId) : null;
    return {
      requestId: a.publicId,
      status,
      deviceId: a.deviceId,
      approverDeviceId: a.approverDeviceId ?? null,
      approverEd25519Pub: approver?.ed25519Pub ?? null,
      approverNonce: a.approverNonce ?? null,
      wrapped: status === "done" ? (a.wrapped ?? null) : null,
      expiresAt: a.expiresAt,
    };
  },
});

/** This account's devices and browsers, with their statements (a new device checks them against the account key). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const account = await activeAccount(ctx, profile._id);
    const rows = [];
    for (const status of ["trusted", "pending", "revoked"] as const) {
      rows.push(
        ...(await ctx.db
          .query("e2eeDevices")
          .withIndex("by_profile", (q) => q.eq("profileId", profile._id).eq("status", status))
          .take(200)),
      );
    }
    const wraps = account ? await wrapsOf(ctx, profile._id, account.epoch) : [];
    const wrapped = new Set(wraps.filter((w) => w.kind === "device").map((w) => w.deviceId));
    return rows
      .map((d) => ({
        deviceId: d.deviceId,
        kind: d.kind,
        label: d.label,
        platform: d.platform,
        status: d.status,
        x25519Pub: d.x25519Pub,
        ed25519Pub: d.ed25519Pub,
        statement: d.statement ?? null,
        hasWrap: wrapped.has(d.deviceId),
        createdAt: d.createdAt,
        lastSeenAt: d.lastSeenAt,
        revokedAt: d.revokedAt ?? null,
      }))
      .sort((x, y) => y.lastSeenAt - x.lastSeenAt);
  },
});

/** Signs out the session a device registered from (Settings > Devices). */
async function signOutDevice(ctx: MutationCtx, profileId: Id<"profiles">, sessionKey: string | undefined): Promise<boolean> {
  if (!sessionKey) return false;
  const mirror = await ctx.db
    .query("sessionsMirror")
    .withIndex("by_profile_key", (q) => q.eq("profileId", profileId).eq("sessionKey", sessionKey))
    .unique();
  if (!mirror) return false;
  if (mirror.authSessionId) await deleteSession(ctx, mirror.authSessionId);
  if (!mirror.revokedAt) await ctx.db.patch(mirror._id, { revokedAt: Date.now(), revokedReason: "e2ee_device_revoked" });
  return true;
}

/**
 * Removes a device: deletes its wraps (every epoch) and statement, signs its session out and marks it
 * revoked, so it can't fetch wraps any more. Whether to also change the encryption key is the client's next
 * step (keys.rotateAccount, then spaces.rotate for Personal; §4.8).
 */
export const revoke = mutation({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const device = await deviceOf(ctx, profile._id, args.deviceId);
    if (!device) fail("not_found", "Device not found.");
    const wraps = await ctx.db
      .query("e2eeAccountWraps")
      .withIndex("by_profile_device", (q) => q.eq("profileId", profile._id).eq("deviceId", args.deviceId))
      .take(100);
    for (const w of wraps) await ctx.db.delete(w._id);
    for (const status of ["waiting", "answered", "revealed"] as const) {
      const open = await ctx.db
        .query("e2eeApprovals")
        .withIndex("by_profile_status", (q) => q.eq("profileId", profile._id).eq("status", status))
        .take(50);
      for (const a of open) if (a.deviceId === args.deviceId || a.approverDeviceId === args.deviceId) await ctx.db.patch(a._id, { status: "expired" });
    }
    const signedOut = await signOutDevice(ctx, profile._id, device.sessionKey);
    await ctx.db.patch(device._id, { status: "revoked", statement: undefined, revokedAt: Date.now() });
    return { signedOut };
  },
});

/** Marks a device as seen (the client calls it about once an hour). */
export const touch = mutation({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const device = await deviceOf(ctx, profile._id, args.deviceId);
    if (!device || device.status === "revoked") return null;
    const now = Date.now();
    if (now - device.lastSeenAt > 5 * 60_000) await ctx.db.patch(device._id, { lastSeenAt: now });
    return null;
  },
});

/** Cron (every 5 minutes): open requests past their time expire; finished ones are deleted a day later. */
export const expireRequests = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("e2eeApprovals")
      .withIndex("by_expires", (q) => q.lt("expiresAt", now))
      .take(200);
    let expired = 0;
    let deleted = 0;
    for (const a of rows) {
      if (a.expiresAt < now - KEEP_FINISHED_MS) {
        await ctx.db.delete(a._id);
        deleted++;
      } else if (OPEN_STATUSES.has(a.status)) {
        await ctx.db.patch(a._id, { status: "expired" });
        expired++;
      }
    }
    return { expired, deleted };
  },
});
