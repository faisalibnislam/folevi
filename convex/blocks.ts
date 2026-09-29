import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { rankSequence } from "@folevi/editor-schema";
import { assertWritable, documentAccess, getDocumentByPublicId, requireDocument, requireProfile, accessAtLeast } from "./lib/auth";
import { liveBlocks, toWireBlock } from "./lib/documents";
import { nextSeq } from "./lib/seq";
import { scopeOfRow } from "./lib/scope";
import { LIMITS } from "@folevi/editor-schema";

/** Live, canonical blocks of a document (tombstones excluded). Subscribed by the editor. */
export const list = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc) return null;
    const access = await documentAccess(ctx, profile, doc);
    if (!accessAtLeast(access, "read")) return null;
    const rows = await liveBlocks(ctx, doc._id);
    return { documentId: doc.publicId, revision: doc.revision, contentSeq: doc.contentSeq, blocks: rows.map(toWireBlock) };
  },
});

/** Deleted blocks still inside the retention window (for "recently deleted" recovery). */
export const deleted = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "read");
    const rows = await ctx.db
      .query("blocks")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id))
      .collect();
    return rows
      .filter((r) => r.deletedAt !== undefined)
      .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
      .slice(0, 100)
      .map((r) => ({ ...toWireBlock(r), deletedAt: r.deletedAt! }));
  },
});

/**
 * Server-authorized rank rebalance for one sibling list whose ranks grew too long. Rewrites ranks to an
 * evenly spaced sequence in current order and bumps positionRev so clients adopt them.
 */
export const rebalance = mutation({
  args: { documentId: v.string(), parentId: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { doc } = await requireDocument(ctx, profile, args.documentId, "write");
    const siblings = (await liveBlocks(ctx, doc._id))
      .filter((b) => b.parentId === args.parentId)
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.blockId < b.blockId ? -1 : 1));
    if (!siblings.some((s) => s.rank.length > LIMITS.maxRankLength / 2)) return { rebalanced: 0 };
    const ranks = rankSequence(siblings.length);
    const seq = await nextSeq(ctx, scopeOfRow(doc));
    const now = Date.now();
    for (const [i, s] of siblings.entries()) {
      const revision = s.revision + 1;
      await ctx.db.patch(s._id, { rank: ranks[i]!, revision, positionRev: revision, seq, updatedAt: now, updatedBy: profile._id });
    }
    await ctx.db.patch(doc._id, { seq, contentSeq: doc.contentSeq + 1, updatedAt: now });
    return { rebalanced: siblings.length };
  },
});
