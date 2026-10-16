// Push for reminders and mentions: which browsers asked for it (Settings → Notifications), and which
// iPhones and iPads (the iOS app, through Apple's push service). Browsers are sent to from pushSend.ts (a
// Node action, using the web-push library with the VAPID keys in VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and
// VAPID_SUBJECT), the iOS app from apnsSend.ts (the APNS_* keys, lib/apns.ts). What's pushed follows the
// bell's choices for each kind; lib/push.ts schedules both.
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";
import { APNS_TOKEN_RE, apnsConfig } from "./lib/apns";
import type { Id } from "./_generated/dataModel";

const ENDPOINT_RE = /^https:\/\/[^\s]{10,2000}$/;
const KEY_RE = /^[A-Za-z0-9_-]{10,200}$/;

/** The server's public key (browsers need it to subscribe), or null when push isn't set up here. */
export const publicKey = query({
  args: {},
  handler: async (ctx) => {
    await requireProfile(ctx);
    const key = process.env.VAPID_PUBLIC_KEY;
    return key && key !== "none" ? key : null;
  },
});

/** Whether this browser (by its endpoint) is subscribed, and how many devices are. */
export const status = query({
  args: { endpoint: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const subs = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(50);
    return { devices: subs.length, thisDevice: args.endpoint ? subs.some((s) => s.endpoint === args.endpoint) : false };
  },
});

export const subscribe = mutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string(), label: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!ENDPOINT_RE.test(args.endpoint) || !KEY_RE.test(args.p256dh) || !KEY_RE.test(args.auth)) fail("invalid_argument", "This browser's push details look wrong.");
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .first();
    // An endpoint belongs to one browser: if it was someone else's (a shared computer), it's now yours.
    if (existing) await ctx.db.delete(existing._id);
    const mine = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(30);
    if (mine.length >= 20) await ctx.db.delete(mine.sort((a, b) => a.createdAt - b.createdAt)[0]!._id);
    await ctx.db.insert("pushSubscriptions", { profileId: profile._id, endpoint: args.endpoint, p256dh: args.p256dh, auth: args.auth, label: args.label?.slice(0, 80), createdAt: Date.now() });
    return null;
  },
});

export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .first();
    if (existing && existing.profileId === profile._id) await ctx.db.delete(existing._id);
    return null;
  },
});

export const subscriptionsFor = internalQuery({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) =>
    (
      await ctx.db
        .query("pushSubscriptions")
        .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
        .take(20)
    ).map((s) => ({ id: s._id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth })),
});

/** After a send: drops subscriptions the push service says are gone, marks the others used. */
export const afterSend = internalMutation({
  args: { gone: v.array(v.id("pushSubscriptions")), sent: v.array(v.id("pushSubscriptions")) },
  handler: async (ctx, args) => {
    for (const id of args.gone) if (await ctx.db.get(id)) await ctx.db.delete(id);
    const now = Date.now();
    for (const id of args.sent) if (await ctx.db.get(id)) await ctx.db.patch(id, { lastSentAt: now });
    return null;
  },
});

// ---------------------------------------------------------------- the iPhone and iPad app (APNs)

const BUNDLE_RE = /^[A-Za-z0-9.-]{3,100}$/;
const DEVICE_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** Whether this deployment can send to the iOS app (the APNs key is set); the app hides the option until it is. */
export const apnsAvailable = query({
  args: {},
  handler: async (ctx) => {
    await requireProfile(ctx);
    return apnsConfig() !== null;
  },
});

/** Whether this iPhone or iPad (by the app's install id) gets notifications, and how many of your devices do. */
export const apnsStatus = query({
  args: { deviceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const rows = await ctx.db
      .query("apnsTokens")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(50);
    return { devices: rows.length, thisDevice: args.deviceId ? rows.some((r) => r.deviceId === args.deviceId) : false };
  },
});

/**
 * The iOS app's device token, after the person allowed notifications. One row per token and per device:
 * the same token again updates its row; a token (or a device) that was someone else's is now yours, the
 * way a shared iPad changes hands; a device's new token replaces its old one.
 */
export const registerApns = mutation({
  args: {
    token: v.string(),
    environment: v.union(v.literal("sandbox"), v.literal("production")),
    bundleId: v.string(),
    deviceId: v.string(),
    deviceName: v.string(),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const token = args.token.toLowerCase();
    if (!APNS_TOKEN_RE.test(token) || !BUNDLE_RE.test(args.bundleId) || !DEVICE_ID_RE.test(args.deviceId)) fail("invalid_argument", "This device's notification details look wrong.");
    const deviceName = args.deviceName.replace(/[^\p{L}\p{N} .,()'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 60) || "iPhone";
    const now = Date.now();
    let mine: Id<"apnsTokens"> | null = null;
    for (const row of await ctx.db.query("apnsTokens").withIndex("by_token", (q) => q.eq("token", token)).take(5)) {
      if (row.profileId === profile._id && !mine) mine = row._id;
      else await ctx.db.delete(row._id);
    }
    for (const row of await ctx.db.query("apnsTokens").withIndex("by_device", (q) => q.eq("deviceId", args.deviceId)).take(10)) {
      if (row._id !== mine) await ctx.db.delete(row._id);
    }
    const fields = { environment: args.environment, bundleId: args.bundleId, deviceId: args.deviceId, deviceName, updatedAt: now };
    if (mine) {
      await ctx.db.patch(mine, fields);
      return null;
    }
    const others = await ctx.db
      .query("apnsTokens")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(30);
    if (others.length >= 20) await ctx.db.delete(others.sort((a, b) => a.updatedAt - b.updatedAt)[0]!._id);
    await ctx.db.insert("apnsTokens", { profileId: profile._id, token, ...fields, createdAt: now });
    return null;
  },
});

/** Turned off in Settings, or signing out: this device (by its token or install id) gets nothing more. */
export const unregisterApns = mutation({
  args: { token: v.optional(v.string()), deviceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const rows = [
      ...(args.token ? await ctx.db.query("apnsTokens").withIndex("by_token", (q) => q.eq("token", args.token!.toLowerCase())).take(5) : []),
      ...(args.deviceId ? await ctx.db.query("apnsTokens").withIndex("by_device", (q) => q.eq("deviceId", args.deviceId!)).take(10) : []),
    ];
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.profileId !== profile._id || seen.has(r._id)) continue;
      seen.add(r._id);
      await ctx.db.delete(r._id);
    }
    return null;
  },
});

/** Where to send, and the badge: what's unread in the bell (the same count as the Mac app's Dock badge). */
export const apnsTargets = internalQuery({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("apnsTokens")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
      .take(20);
    const unread = rows.length
      ? await ctx.db
          .query("notifications")
          .withIndex("by_profile_unread", (q) => q.eq("profileId", args.profileId).eq("readAt", undefined))
          .take(100)
      : [];
    return { tokens: rows.map((r) => ({ id: r._id, token: r.token, environment: r.environment, bundleId: r.bundleId })), badge: unread.length };
  },
});

/** After a send: drops tokens Apple says are gone, marks the others used. */
export const afterApnsSend = internalMutation({
  args: { gone: v.array(v.id("apnsTokens")), sent: v.array(v.id("apnsTokens")) },
  handler: async (ctx, args) => {
    for (const id of args.gone) if (await ctx.db.get(id)) await ctx.db.delete(id);
    const now = Date.now();
    for (const id of args.sent) if (await ctx.db.get(id)) await ctx.db.patch(id, { lastSentAt: now });
    return null;
  },
});
