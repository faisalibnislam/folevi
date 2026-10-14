// Web push for reminders and mentions: which browsers asked for it (Settings → Notifications). Sending is
// in pushSend.ts (a Node action, using the web-push library with the VAPID keys in VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY and VAPID_SUBJECT). What's pushed follows the bell's choices for each kind.
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";

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
