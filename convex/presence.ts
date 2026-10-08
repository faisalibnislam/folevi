import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { accessAtLeast, documentAccess, getDocumentByPublicId, requireProfile } from "./lib/auth";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";

/** Presence is best-effort: pages that are not (yet) on the server or not readable are ignored quietly. */
async function readableDoc(ctx: MutationCtx, profile: Awaited<ReturnType<typeof requireProfile>>, publicId: string) {
  const doc = await getDocumentByPublicId(ctx, publicId);
  if (!doc) return null;
  return accessAtLeast(await documentAccess(ctx, profile, doc), "read") ? doc : null;
}
import { keyedHash } from "./lib/crypto";
import { personColor } from "./lib/authors";

const ACTIVE_MS = 45_000;

/** Heartbeat from a document view. Presence is only readable by people who can read the document. */
export const heartbeat = mutation({
  args: { documentId: v.string(), sessionId: v.string(), focusedBlockId: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const doc = await readableDoc(ctx, profile, args.documentId);
    if (!doc) return null;
    const sessionKey = await keyedHash(`${profile._id}:${args.sessionId}`, "presence");
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_session", (q) => q.eq("sessionKey", sessionKey).eq("documentId", doc._id))
      .unique();
    const focusedBlockId = args.focusedBlockId ?? undefined;
    if (existing) await ctx.db.patch(existing._id, { updatedAt: Date.now(), focusedBlockId });
    else await ctx.db.insert("presence", { documentId: doc._id, profileId: profile._id, sessionKey, focusedBlockId, updatedAt: Date.now() });
    return null;
  },
});

export const leave = mutation({
  args: { documentId: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const doc = await readableDoc(ctx, profile, args.documentId);
    if (!doc) return null;
    const sessionKey = await keyedHash(`${profile._id}:${args.sessionId}`, "presence");
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_session", (q) => q.eq("sessionKey", sessionKey).eq("documentId", doc._id))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

export const list = query({
  args: { documentId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc || !accessAtLeast(await documentAccess(ctx, profile, doc), "read")) return [];
    const rows = await ctx.db
      .query("presence")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id).gt("updatedAt", args.now - ACTIVE_MS))
      .take(50);
    const byProfile = new Map<string, { profileId: string; name: string; color: string; focusedBlockId: string | null }>();
    for (const r of rows) {
      if (r.profileId === profile._id) continue;
      const p = await ctx.db.get(r.profileId);
      if (!p) continue;
      // The same colour as in version history and "Show editors".
      const color = personColor(r.profileId);
      byProfile.set(r.profileId, { profileId: r.profileId, name: p.displayName, color, focusedBlockId: r.focusedBlockId ?? null });
    }
    return [...byProfile.values()];
  },
});

const CLEANUP_BATCH = 500;

export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stale = await ctx.db
      .query("presence")
      .withIndex("by_updated", (q) => q.lt("updatedAt", Date.now() - 10 * 60_000))
      .take(CLEANUP_BATCH);
    for (const s of stale) await ctx.db.delete(s._id);
    // A full batch means there's more; finish now rather than letting stale rows pile up between runs.
    if (stale.length === CLEANUP_BATCH) await ctx.scheduler.runAfter(0, internal.presence.cleanup, {});
  },
});
