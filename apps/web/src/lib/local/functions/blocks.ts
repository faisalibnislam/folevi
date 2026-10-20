// blocks.* in local mode (convex/blocks.ts): a note's live blocks, what changed since a seq, and rank rebalancing.
// Links to other notes carry those notes' current titles, resolved as they're read (shared.ts ReaderLabels).
import { LIMITS, rankSequence } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { fail } from "../errors";
import { defineLocal } from "../registry";
import type { LocalBlock } from "../store";
import { liveBlocks, ReaderLabels, requireProfile, toWireBlock } from "./shared";

/** Changes per `changes` call before the caller should load the note again (blocks.ts CHANGES_MAX). */
const CHANGES_MAX = 500;

/** Blocks in the order the server's indexes give them: made first, first (the store's order breaks ties). */
const byCreation = (rows: LocalBlock[]) => [...rows].sort((a, b) => a.createdAt - b.createdAt);

defineLocal(api.blocks.list, "query", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) return null;
  const rows = byCreation(await liveBlocks(ctx.db, doc.id));
  const head = rows.reduce((max, r) => Math.max(max, r.seq), 0);
  const blocks = await new ReaderLabels(ctx.db).blocks(rows.map(toWireBlock));
  return { documentId: doc.id, revision: doc.revision, contentSeq: doc.contentSeq, head, blocks };
});

defineLocal(api.blocks.changes, "query", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) return null;
  const rows = (await ctx.db.list("blocks", doc.id)).filter((b) => b.seq > args.since).sort((a, b) => a.seq - b.seq || a.createdAt - b.createdAt);
  const more = rows.length > CHANGES_MAX;
  const kept = rows.slice(0, CHANGES_MAX);
  const head = kept.reduce((max, r) => Math.max(max, r.seq), args.since);
  return {
    documentId: doc.id,
    revision: doc.revision,
    contentSeq: doc.contentSeq,
    head,
    blocks: await new ReaderLabels(ctx.db).blocks(kept.filter((r) => r.deletedAt === null).map(toWireBlock)),
    deleted: kept.filter((r) => r.deletedAt !== null).map((r) => r.id),
    more,
  };
});

/**
 * Evenly spaced ranks for one list of sibling blocks whose ranks grew too long, in the same order. Nobody
 * edited these lines, so who last changed them stays as it was.
 */
defineLocal(api.blocks.rebalance, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) fail("not_found", "Document not found.");
  const siblings = (await liveBlocks(ctx.db, doc.id)).filter((b) => b.parentId === args.parentId).sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : 1));
  if (!siblings.some((s) => s.rank.length > LIMITS.maxRankLength / 2)) return { rebalanced: 0 };
  const ranks = rankSequence(siblings.length);
  const seq = await ctx.nextSeq();
  for (const [i, s] of siblings.entries()) {
    const revision = s.revision + 1;
    ctx.db.put("blocks", s.id, { ...s, rank: ranks[i]!, revision, positionRev: revision, seq }, doc.id);
  }
  ctx.db.put("documents", doc.id, { ...doc, seq, contentSeq: doc.contentSeq + 1, updatedAt: ctx.now() });
  return { rebalanced: siblings.length };
});
