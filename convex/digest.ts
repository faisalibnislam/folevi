// Daily digest of unread comments and mentions for people who chose it (Settings → Notifications).
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { appUrl } from "./lib/notify";

export const sendDailyDigests = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const page = await ctx.db.query("profiles").withIndex("by_status", (q) => q.eq("status", "active")).paginate({ cursor: args.cursor ?? null, numItems: 100 });
    for (const p of page.page) {
      if (p.notificationPrefs.digest !== "daily") continue;
      const unread = (
        await ctx.db
          .query("notifications")
          .withIndex("by_profile_created", (q) => q.eq("profileId", p._id).gt("createdAt", since))
          .take(200)
      ).filter((n) => !n.readAt && !n.emailedAt && (n.kind === "comment" || n.kind === "reply" || n.kind === "mention"));
      if (!unread.length) continue;
      // Titles only (never comment bodies) — the minimum needed to be useful.
      const summary = unread
        .slice(0, 5)
        .map((n) => n.title)
        .join("\n")
        .slice(0, 480);
      const date = new Date().toISOString().slice(0, 10);
      await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
        key: "comment_digest",
        profileId: p._id,
        idempotencyKey: `digest:${p._id}:${date}`,
        dataVariables: { count: unread.length, summary, inboxUrl: `${appUrl()}/documents`, preferencesUrl: `${appUrl()}/settings/notifications` },
      });
      for (const n of unread) await ctx.db.patch(n._id, { emailedAt: Date.now() });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.digest.sendDailyDigests, { cursor: page.continueCursor });
  },
});
