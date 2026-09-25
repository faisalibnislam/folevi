import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireProfile } from "./lib/auth";

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_profile_created", (q) => q.eq("profileId", profile._id))
      .order("desc")
      .take(Math.min(args.limit ?? 50, 100));
    const out = [];
    for (const n of rows) {
      const actor = n.actorId ? await ctx.db.get(n.actorId) : null;
      const doc = n.documentId ? await ctx.db.get(n.documentId) : null;
      const invite = n.inviteId ? await ctx.db.get(n.inviteId) : null;
      out.push({
        id: n._id as string,
        kind: n.kind,
        title: n.title,
        body: n.body ?? null,
        actorName: actor?.displayName ?? null,
        documentId: doc && !doc.inTrash ? doc.publicId : null,
        inviteId: invite && invite.status === "pending" ? invite.publicId : null,
        createdAt: n.createdAt,
        read: n.readAt !== undefined,
      });
    }
    return out;
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_profile_unread", (q) => q.eq("profileId", profile._id).eq("readAt", undefined))
      .take(100);
    return rows.length;
  },
});

export const markRead = mutation({
  args: { ids: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const now = Date.now();
    if (args.ids) {
      for (const raw of args.ids.slice(0, 100)) {
        const id = ctx.db.normalizeId("notifications", raw);
        const n = id ? await ctx.db.get(id) : null;
        if (n && n.profileId === profile._id && !n.readAt) await ctx.db.patch(n._id, { readAt: now });
      }
      return null;
    }
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_profile_unread", (q) => q.eq("profileId", profile._id).eq("readAt", undefined))
      .take(500);
    for (const n of rows) await ctx.db.patch(n._id, { readAt: now });
    return null;
  },
});
