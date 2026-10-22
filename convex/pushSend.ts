"use node";
// Sends a web push to every browser a person subscribed (convex/push.ts). The payload is small and
// follows the email policy: a reminder carries its to-do line; anything else only who did what and where.
import { v } from "convex/values";
import webpush from "web-push";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

export const sendToProfile = internalAction({
  args: { profileId: v.id("profiles"), title: v.string(), body: v.optional(v.string()), url: v.string(), tag: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey || publicKey === "none") return { sent: 0 };
    const subs = await ctx.runQuery(internal.push.subscriptionsFor, { profileId: args.profileId });
    if (!subs.length) return { sent: 0 };
    const payload = JSON.stringify({ title: args.title.slice(0, 120), body: args.body?.slice(0, 240), url: args.url, tag: args.tag });
    // A browser signed in to several accounts: the notification says whose it is, and its link opens that account.
    const place = subs.some((s) => s.placeLabel) ? await ctx.runQuery(internal.push.placeOf, { profileId: args.profileId }) : null;
    const labelled = (label: string) => {
      const url = new URL(args.url);
      if (place) url.searchParams.set("place", `acct:${place}`);
      return JSON.stringify({ title: `${label} · ${args.title}`.slice(0, 160), body: args.body?.slice(0, 240), url: url.toString(), tag: args.tag });
    };
    const gone: Id<"pushSubscriptions">[] = [];
    const sent: Id<"pushSubscriptions">[] = [];
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, s.placeLabel ? labelled(s.placeLabel) : payload, {
          vapidDetails: { subject: process.env.VAPID_SUBJECT || "mailto:support@folevi.com", publicKey, privateKey },
          TTL: 60 * 60,
          urgency: "normal",
          timeout: 10_000,
        });
        sent.push(s.id);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(s.id);
      }
    }
    await ctx.runMutation(internal.push.afterSend, { gone, sent });
    console.log(JSON.stringify({ event: "push.send", devices: subs.length, sent: sent.length, gone: gone.length }));
    return { sent: sent.length };
  },
});
