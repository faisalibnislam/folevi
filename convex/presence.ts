import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { accessAtLeast, documentAccess, getDocumentByPublicId, requireProfile } from "./lib/auth";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { fail } from "./lib/errors";

/** Presence is best-effort: pages that are not (yet) on the server or not readable are ignored quietly. */
async function readableDoc(ctx: MutationCtx, profile: Awaited<ReturnType<typeof requireProfile>>, publicId: string) {
  const doc = await getDocumentByPublicId(ctx, publicId);
  if (!doc) return null;
  return accessAtLeast(await documentAccess(ctx, profile, doc), "read") ? doc : null;
}
import { keyedHash } from "./lib/crypto";
import { personColor } from "./lib/authors";
import { identityImageUrl } from "./lib/identityImages";

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
    // A caret left resting for a while stays (the sweep below takes cursors not touched in 10 minutes).
    const cursor = await ctx.db
      .query("presenceCursors")
      .withIndex("by_session", (q) => q.eq("sessionKey", sessionKey).eq("documentId", doc._id))
      .unique();
    if (cursor && cursor.updatedAt < Date.now() - 5 * 60_000) await ctx.db.patch(cursor._id, { updatedAt: Date.now() });
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
    const cursor = await ctx.db
      .query("presenceCursors")
      .withIndex("by_session", (q) => q.eq("sessionKey", sessionKey).eq("documentId", doc._id))
      .unique();
    if (cursor) await ctx.db.delete(cursor._id);
    return null;
  },
});

/** Block ids as the editor makes them (ULIDs, or ids from an import): letters, digits, "-" and "_". */
const BLOCK_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Longer than any line can be: an offset past it is a bad request, not a caret. */
const MAX_OFFSET = 1_000_000;

const vCaretPoint = v.object({ blockId: v.string(), offset: v.number() });

function checkPoint(p: { blockId: string; offset: number }) {
  if (!BLOCK_ID.test(p.blockId)) fail("invalid_argument", "Not a block id.");
  if (!Number.isInteger(p.offset) || p.offset < 0 || p.offset > MAX_OFFSET) fail("invalid_argument", "Not an offset in a line.");
}

/**
 * Where this session's selection is in a note (live carets), or null when it has none. Only positions: a
 * block id and an offset into its text for each end, or whole blocks. Sent at most a few times a second
 * while it moves, and only while someone else is in the note; anyone who can read the note may send theirs.
 */
export const setCursor = mutation({
  args: {
    documentId: v.string(),
    sessionId: v.string(),
    cursor: v.union(v.null(), v.object({ anchor: vCaretPoint, head: vCaretPoint, block: v.optional(v.boolean()) })),
  },
  handler: async (ctx, args) => {
    if (args.sessionId.length > 64) fail("invalid_argument", "Not a session.");
    if (args.cursor) {
      checkPoint(args.cursor.anchor);
      checkPoint(args.cursor.head);
    }
    const profile = await requireProfile(ctx);
    const doc = await readableDoc(ctx, profile, args.documentId);
    if (!doc) return null;
    const sessionKey = await keyedHash(`${profile._id}:${args.sessionId}`, "presence");
    const existing = await ctx.db
      .query("presenceCursors")
      .withIndex("by_session", (q) => q.eq("sessionKey", sessionKey).eq("documentId", doc._id))
      .unique();
    if (!args.cursor) {
      if (existing) await ctx.db.delete(existing._id);
      return null;
    }
    const { anchor, head } = args.cursor;
    const row = {
      anchorBlockId: anchor.blockId,
      anchorOffset: anchor.offset,
      headBlockId: head.blockId,
      headOffset: head.offset,
      block: Boolean(args.cursor.block),
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("presenceCursors", { documentId: doc._id, profileId: profile._id, sessionKey, ...row });
    return null;
  },
});

/**
 * Other people's carets in a note, for people who can read it. The client shows the ones of people the
 * presence list says are here, so a session that went away without saying so drops out with its presence.
 */
export const cursors = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc || !accessAtLeast(await documentAccess(ctx, profile, doc), "read")) return [];
    const rows = await ctx.db
      .query("presenceCursors")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .order("desc")
      .take(50);
    const names = new Map<string, string>();
    const out = [];
    for (const r of rows) {
      if (r.profileId === profile._id) continue;
      let name = names.get(r.profileId);
      if (name === undefined) {
        name = (await ctx.db.get(r.profileId))?.displayName ?? "";
        names.set(r.profileId, name);
      }
      if (!name) continue;
      out.push({
        // The session, as an opaque key: one person in two windows has two carets.
        key: r.sessionKey.slice(0, 12),
        profileId: r.profileId,
        name,
        color: personColor(r.profileId),
        anchor: { blockId: r.anchorBlockId, offset: r.anchorOffset },
        head: { blockId: r.headBlockId, offset: r.headOffset },
        block: r.block,
        updatedAt: r.updatedAt,
      });
    }
    return out;
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
    const byProfile = new Map<string, { profileId: string; name: string; color: string; avatarUrl: string | null; focusedBlockId: string | null }>();
    for (const r of rows) {
      if (r.profileId === profile._id) continue;
      const p = await ctx.db.get(r.profileId);
      if (!p) continue;
      // The same colour as in version history and "Show editors".
      const color = personColor(r.profileId);
      if (byProfile.has(r.profileId)) continue;
      byProfile.set(r.profileId, { profileId: r.profileId, name: p.displayName, color, avatarUrl: await identityImageUrl(ctx, p.avatarFileId), focusedBlockId: r.focusedBlockId ?? null });
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
    const staleCursors = await ctx.db
      .query("presenceCursors")
      .withIndex("by_updated", (q) => q.lt("updatedAt", Date.now() - 10 * 60_000))
      .take(CLEANUP_BATCH);
    for (const c of staleCursors) await ctx.db.delete(c._id);
    // A full batch means there's more; finish now rather than letting stale rows pile up between runs.
    if (stale.length === CLEANUP_BATCH || staleCursors.length === CLEANUP_BATCH) await ctx.scheduler.runAfter(0, internal.presence.cleanup, {});
  },
});
