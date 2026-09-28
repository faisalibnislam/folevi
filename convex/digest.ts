// Daily digest of unread comments and mentions for people who chose it (Settings → Notifications).
//
// People on the digest get no per-event comment/mention emails (lib/notify.ts#wantsImmediateEmail),
// and every notification that was already emailed carries `emailedAt`, so nothing is ever sent twice.
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { appUrl, includedInDigest } from "./lib/notify";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Titles only (never comment bodies) — the minimum needed to be useful. */
export function digestSummary(unread: Pick<Doc<"notifications">, "title">[]): string {
  const lines = unread.slice(0, 5).map((n) => `• ${n.title}`);
  if (unread.length > 5) lines.push(`…and ${unread.length - 5} more`);
  return lines.join("\n").slice(0, 480);
}

export const sendDailyDigests = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const since = now - DAY_MS;
    const date = new Date(now).toISOString().slice(0, 10);
    const page = await ctx.db
      .query("profiles")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .paginate({ cursor: args.cursor ?? null, numItems: 100 });
    let sent = 0;
    for (const p of page.page) {
      if (p.notificationPrefs.digest !== "daily") continue;
      const unread = (
        await ctx.db
          .query("notifications")
          .withIndex("by_profile_created", (q) => q.eq("profileId", p._id).gt("createdAt", since))
          .take(200)
      ).filter((n) => !n.readAt && !n.emailedAt && includedInDigest(p.notificationPrefs, n.kind));
      if (!unread.length) continue;
      await ctx.scheduler.runAfter(0, internal.email.sendTemplate, {
        key: "comment_digest",
        profileId: p._id,
        idempotencyKey: `digest:${p._id}:${date}`,
        dataVariables: {
          count: unread.length,
          summary: digestSummary(unread),
          inboxUrl: `${appUrl()}/documents`,
          preferencesUrl: `${appUrl()}/settings/notifications`,
        },
      });
      for (const n of unread) await ctx.db.patch(n._id, { emailedAt: now });
      sent++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.digest.sendDailyDigests, { cursor: page.continueCursor, now });
    return { sent, done: page.isDone };
  },
});
