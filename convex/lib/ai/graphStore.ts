// The knowledge graph's rows (convex/aiGraph.ts does the work): reading a note as lines for extraction,
// writing what was found, and removing a note's part of the graph (Trash, a lapsed plan, deletion).
import { flattenTree, blockSearchText } from "@folevi/editor-schema";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { liveBlocks, toWireBlock } from "../documents";
import { sharedLabels } from "../linkLabels";
import { inScope, insertScoped, scopeOfRow, type Scope } from "../scope";
import { lineOf } from "./retrieval";
import { textKey, type ExtractedEntity, type ExtractedLink, type ExtractedRelation, type GraphLine } from "./graph";

type Ctx = QueryCtx | MutationCtx;

/** A note's lines in reading order (each with its block), links labelled as everyone who can open it sees them. */
export async function noteLines(ctx: MutationCtx, doc: Doc<"documents">): Promise<GraphLine[]> {
  const blocks = await sharedLabels(ctx, doc, (await liveBlocks(ctx, doc._id)).map(toWireBlock));
  const out: GraphLine[] = [];
  for (const e of flattenTree(blocks)) {
    const line = lineOf(e.block, e.depth);
    if (line) out.push({ blockId: line.blockId, text: line.text, key: textKey(line.text) });
  }
  return out;
}

/** A block's whole text as it is now (for quoting a relation), or null when it's gone or empty. */
export async function blockText(ctx: Ctx, documentId: Id<"documents">, blockId: string | undefined): Promise<string | null> {
  if (!blockId) return null;
  const rows = await ctx.db
    .query("blocks")
    .withIndex("by_block_id", (q) => q.eq("blockId", blockId))
    .take(4);
  const row = rows.find((r) => r.documentId === documentId && r.deletedAt === undefined);
  if (!row) return null;
  const text = blockSearchText(toWireBlock(row)).replace(/\s+/g, " ").trim();
  return text || null;
}

export async function graphStateOf(ctx: Ctx, documentId: Id<"documents">): Promise<Doc<"aiGraphState"> | null> {
  return await ctx.db
    .query("aiGraphState")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .unique();
}

/** The scope's entity with this name, if there is one. */
export async function entityByName(ctx: Ctx, scope: Scope, normalized: string): Promise<Doc<"aiEntities"> | null> {
  return scope.kind === "personal"
    ? await ctx.db
        .query("aiEntities")
        .withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId).eq("normalized", normalized))
        .first()
    : await ctx.db
        .query("aiEntities")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId).eq("normalized", normalized))
        .first();
}

/** Deletes entities nobody mentions any more (after a note's mentions went). */
async function dropOrphans(ctx: MutationCtx, entityIds: Iterable<Id<"aiEntities">>): Promise<void> {
  for (const id of entityIds) {
    const still = await ctx.db
      .query("aiMentions")
      .withIndex("by_entity", (q) => q.eq("entityId", id))
      .first();
    if (!still && (await ctx.db.get(id))) await ctx.db.delete(id);
  }
}

/**
 * Removes up to `n` rows of a note's part of the graph: its mentions (and entities left without any), the
 * relations found in it or pointing at it, and its state. Returns how many rows went (fewer than `n`: done).
 */
export async function dropNoteGraph(ctx: MutationCtx, documentId: Id<"documents">, n = 200): Promise<number> {
  let left = n;
  const mentions = await ctx.db
    .query("aiMentions")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .take(left);
  for (const m of mentions) await ctx.db.delete(m._id);
  await dropOrphans(ctx, new Set(mentions.map((m) => m.entityId)));
  left -= mentions.length;
  for (const index of ["by_source", "by_to_document"] as const) {
    if (left <= 0) return n;
    const rows = await (index === "by_source"
      ? ctx.db.query("aiRelations").withIndex("by_source", (q) => q.eq("sourceDocumentId", documentId))
      : ctx.db.query("aiRelations").withIndex("by_to_document", (q) => q.eq("toDocumentId", documentId))
    ).take(left);
    for (const r of rows) await ctx.db.delete(r._id);
    left -= rows.length;
  }
  if (left <= 0) return n;
  const state = await graphStateOf(ctx, documentId);
  if (state) {
    await ctx.db.delete(state._id);
    left--;
  }
  return n - left;
}

export interface FoundGraph {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
  links: ExtractedLink[];
  similar: { documentId: Id<"documents">; score: number }[];
}

/**
 * Replaces what was found in `doc` (its mentions and the relations sourced from it) with `found`. Entities
 * are shared by name across the scope's notes; ones no note mentions any more are deleted. Relations to
 * notes outside the scope (or gone) are skipped.
 */
export async function writeNoteGraph(ctx: MutationCtx, doc: Doc<"documents">, found: FoundGraph, contentHash: string): Promise<void> {
  const scope = scopeOfRow(doc);
  const now = Date.now();
  // Out with the old (entities kept until the new mentions are in, so a name still mentioned keeps its row).
  const oldMentions = await ctx.db
    .query("aiMentions")
    .withIndex("by_document", (q) => q.eq("documentId", doc._id))
    .collect();
  for (const m of oldMentions) await ctx.db.delete(m._id);
  for (const r of await ctx.db
    .query("aiRelations")
    .withIndex("by_source", (q) => q.eq("sourceDocumentId", doc._id))
    .collect())
    await ctx.db.delete(r._id);

  const ids = new Map<string, Id<"aiEntities">>();
  for (const e of found.entities) {
    const existing = await entityByName(ctx, scope, e.normalized);
    let id: Id<"aiEntities">;
    if (existing) {
      id = existing._id;
      await ctx.db.patch(id, { updatedAt: now });
    } else id = await insertScoped(ctx, "aiEntities", scope, { name: e.name, normalized: e.normalized, kind: e.kind, createdAt: now, updatedAt: now });
    ids.set(e.normalized, id);
    await insertScoped(ctx, "aiMentions", scope, { entityId: id, documentId: doc._id, blockIds: e.blockIds, createdAt: now });
  }
  for (const r of found.relations) {
    const from = ids.get(r.from);
    const to = ids.get(r.to);
    if (!from || !to) continue;
    await insertScoped(ctx, "aiRelations", scope, { kind: r.kind, inferred: true, sourceDocumentId: doc._id, sourceBlockId: r.blockId, fromEntityId: from, toEntityId: to, createdAt: now });
  }
  const sameScopeNote = async (id: Id<"documents">) => {
    const other = await ctx.db.get(id);
    return other !== null && other._id !== doc._id && !other.inTrash && other.deletedAt === undefined && inScope(other, scope);
  };
  for (const l of found.links) {
    const to = l.toDocumentId as Id<"documents">;
    if (!(await sameScopeNote(to))) continue;
    await insertScoped(ctx, "aiRelations", scope, { kind: l.kind, inferred: true, sourceDocumentId: doc._id, sourceBlockId: l.blockId, toDocumentId: to, targetBlockId: l.targetBlockId, sourceKey: l.sourceKey, targetKey: l.targetKey, reason: l.reason, createdAt: now });
  }
  for (const s of found.similar) {
    if (!(await sameScopeNote(s.documentId))) continue;
    await insertScoped(ctx, "aiRelations", scope, { kind: "similar", inferred: true, sourceDocumentId: doc._id, toDocumentId: s.documentId, score: Math.round(s.score * 1000) / 1000, createdAt: now });
  }
  await dropOrphans(ctx, new Set(oldMentions.map((m) => m.entityId)));

  const state = await graphStateOf(ctx, doc._id);
  const fields = { contentHash, entities: found.entities.length, extractedAt: now };
  if (state) await ctx.db.patch(state._id, fields);
  else await insertScoped(ctx, "aiGraphState", scope, { documentId: doc._id, ...fields });
}
