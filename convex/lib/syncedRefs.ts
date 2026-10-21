// The notes that show a synced source (see lib/synced.ts). Kept apart from lib/synced.ts so lib/auth.ts can
// read references without importing what imports it.
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

/** References read at most (a source shown in more notes than this is still kept and still works). */
export const MAX_SYNCED_REFERENCES = 200;

export interface SyncedReference {
  /** The synced block in the note. */
  row: Doc<"blocks">;
  /** The note it's in (possibly in Trash: callers decide). */
  note: Doc<"documents">;
}

/**
 * The live synced blocks that show `source`, each with its note. Found through the backlink index (a synced
 * block links to its source, lib/syncEngine.ts syncLinks) and checked against the block itself, so a page
 * link that merely names the source's id never counts as a reference.
 */
export async function syncedReferences(ctx: Ctx, source: Doc<"documents">): Promise<SyncedReference[]> {
  if (source.kind !== "synced") return [];
  const links = await ctx.db
    .query("documentLinks")
    .withIndex("by_target", (q) => q.eq("targetPublicId", source.publicId))
    .take(MAX_SYNCED_REFERENCES);
  const out: SyncedReference[] = [];
  const seen = new Set<string>();
  const notes = new Map<string, Doc<"documents"> | null>();
  for (const link of links) {
    if (seen.has(link.blockId)) continue;
    seen.add(link.blockId);
    const row = await ctx.db
      .query("blocks")
      .withIndex("by_block_id", (q) => q.eq("blockId", link.blockId))
      .unique();
    if (!row || row.deletedAt !== undefined || row.documentId !== link.sourceDocumentId) continue;
    // A sealed synced block names its source in plain `syncedSource` (docs/E2EE_DESIGN.md §4.6).
    const shows = row.sealed !== undefined ? row.syncedSource === source.publicId : row.type === "synced" && (row.props as { sourceId?: unknown }).sourceId === source.publicId;
    if (!shows) continue;
    let note = notes.get(row.documentId);
    if (note === undefined) {
      note = await ctx.db.get(row.documentId);
      notes.set(row.documentId, note);
    }
    // A synced block is never written inside a source; a page being deleted for good no longer counts.
    if (!note || note.kind === "synced") continue;
    out.push({ row, note });
  }
  return out;
}
