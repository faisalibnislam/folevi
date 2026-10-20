// blocks.* in local mode (convex/blocks.ts): a note's live blocks, and what changed since a seq.
import { api } from "@/lib/convex/api";
import { defineLocal } from "../registry";
import { requireProfile, toWireBlock } from "./shared";

/** Changes per `changes` call before the caller should load the note again (blocks.ts CHANGES_MAX). */
const CHANGES_MAX = 500;

defineLocal(api.blocks.list, "query", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) return null;
  const rows = (await ctx.db.list("blocks", doc.id)).filter((b) => b.deletedAt === null);
  const head = rows.reduce((max, r) => Math.max(max, r.seq), 0);
  return { documentId: doc.id, revision: doc.revision, contentSeq: doc.contentSeq, head, blocks: rows.map(toWireBlock) };
});

defineLocal(api.blocks.changes, "query", async (ctx, args) => {
  await requireProfile(ctx);
  const doc = await ctx.db.get("documents", args.documentId);
  if (!doc) return null;
  const rows = (await ctx.db.list("blocks", doc.id)).filter((b) => b.seq > args.since).sort((a, b) => a.seq - b.seq || (a.id < b.id ? -1 : 1));
  const more = rows.length > CHANGES_MAX;
  const kept = rows.slice(0, CHANGES_MAX);
  const head = kept.reduce((max, r) => Math.max(max, r.seq), args.since);
  return {
    documentId: doc.id,
    revision: doc.revision,
    contentSeq: doc.contentSeq,
    head,
    blocks: kept.filter((r) => r.deletedAt === null).map(toWireBlock),
    deleted: kept.filter((r) => r.deletedAt !== null).map((r) => r.id),
    more,
  };
});
