import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { accessAtLeast, documentAccess, getDocumentByPublicId, requireProfile } from "./lib/auth";
import { identityImageUrl } from "./lib/identityImages";
import { noteMode } from "./lib/notify";

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const limit = Math.min(args.limit ?? 50, 100);
    const rows = (
      await ctx.db
        .query("notifications")
        .withIndex("by_profile_created", (q) => q.eq("profileId", profile._id))
        .order("desc")
        .take(limit * 2)
    )
      // Hidden rows only exist for email (that kind is turned off for the bell).
      .filter((n) => !n.silent)
      .slice(0, limit);
    const actors = new Map<string, { name: string; avatarUrl: string | null } | null>();
    const actorOf = async (id: Id<"profiles">) => {
      if (!actors.has(id)) {
        const p = await ctx.db.get(id);
        actors.set(id, p && p.status !== "deleted" ? { name: p.displayName, avatarUrl: await identityImageUrl(ctx, p.avatarFileId) } : null);
      }
      return actors.get(id)!;
    };
    const readable = new Map<string, Doc<"documents"> | null>();
    const docOf = async (id: Id<"documents">) => {
      if (!readable.has(id)) {
        const doc = await ctx.db.get(id);
        // Only link to documents the person can still open (access may have changed since).
        readable.set(id, doc && !doc.inTrash && accessAtLeast(await documentAccess(ctx, profile, doc), "read") ? doc : null);
      }
      return readable.get(id)!;
    };
    const out = [];
    for (const n of rows) {
      const actor = n.actorId ? await actorOf(n.actorId) : null;
      const doc = n.documentId ? await docOf(n.documentId) : null;
      const invite = n.inviteId ? await ctx.db.get(n.inviteId) : null;
      const thread = doc && n.threadId ? await ctx.db.get(n.threadId) : null;
      out.push({
        id: n._id as string,
        kind: n.kind,
        title: n.title,
        // Note and comment text only while the person can still read the note.
        body: n.documentId && !doc ? null : (n.body ?? null),
        fileId: n.fileId ?? null,
        actorName: actor?.name ?? null,
        actorAvatarUrl: actor?.avatarUrl ?? null,
        documentId: doc ? doc.publicId : null,
        /** The note's current title (the stored `title` sentence keeps the one it had then). */
        documentTitle: doc ? doc.title || "Untitled" : null,
        threadId: thread ? thread.publicId : null,
        blockId: doc ? (n.blockId ?? thread?.blockId ?? null) : null,
        commentId: thread ? (n.commentId ?? null) : null,
        count: n.count ?? 1,
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

/** The caller's own notifications among `ids` (anything else is silently ignored). */
async function own(ctx: MutationCtx, profileId: Id<"profiles">, ids: string[]): Promise<Doc<"notifications">[]> {
  const out = [];
  for (const raw of ids.slice(0, 100)) {
    const id = ctx.db.normalizeId("notifications", raw);
    const n = id ? await ctx.db.get(id) : null;
    if (n && n.profileId === profileId && !n.silent) out.push(n);
  }
  return out;
}

export const markRead = mutation({
  args: { ids: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const now = Date.now();
    if (args.ids) {
      for (const n of await own(ctx, profile._id, args.ids)) if (!n.readAt) await ctx.db.patch(n._id, { readAt: now });
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

export const markUnread = mutation({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    for (const n of await own(ctx, profile._id, args.ids)) if (n.readAt) await ctx.db.patch(n._id, { readAt: undefined });
    return null;
  },
});

export const remove = mutation({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    for (const n of await own(ctx, profile._id, args.ids)) await ctx.db.delete(n._id);
    return null;
  },
});

const vNoteMode = v.union(v.literal("default"), v.literal("follow"), v.literal("mute"));

/**
 * How comments on one note reach you: "default" (notes you created, threads you're in and @mentions),
 * "follow" (every comment) or "mute" (no comment or reply notifications; @mentions still arrive).
 * Null when the page isn't readable (or isn't on the server yet).
 */
export const noteSubscription = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc || !accessAtLeast(await documentAccess(ctx, profile, doc), "read")) return null;
    return { mode: (await noteMode(ctx, profile._id, doc._id)) ?? "default", isAuthor: doc.createdBy === profile._id };
  },
});

export const setNoteSubscription = mutation({
  args: { documentId: v.string(), mode: vNoteMode },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    // Same answer for "missing" and "not yours to read".
    if (!doc || !accessAtLeast(await documentAccess(ctx, profile, doc), "read")) return null;
    const existing = await ctx.db
      .query("noteSubscriptions")
      .withIndex("by_profile_document", (q) => q.eq("profileId", profile._id).eq("documentId", doc._id))
      .unique();
    if (args.mode === "default") {
      if (existing) await ctx.db.delete(existing._id);
    } else if (existing) {
      await ctx.db.patch(existing._id, { mode: args.mode, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("noteSubscriptions", { profileId: profile._id, documentId: doc._id, workspaceId: doc.workspaceId, mode: args.mode, updatedAt: Date.now() });
    }
    return null;
  },
});
