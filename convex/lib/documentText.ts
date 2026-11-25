// A note's search text lives in its own table (documentText), not on the note's row: it can be 32,000
// characters, and every list, count and title read of a note used to pay for it. The documentText row holds
// the text with the full-text search index and copies of the note's fields that search filters on, kept in
// step by every write to a note (lib/functions.ts calls documentTextWritten).
//
// Rollout (docs/perf/backend-results.md, "Note text"): this widen step writes both places; reads still use
// documents.searchText until migrations.backfillDocumentText has copied every note, then readers move here and
// documents.searchText is emptied and dropped.
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { hasValidScope, insertScoped, scopeOfRow } from "./scope";

/** The fields documentText copies from its note (what search filters on, and the text). */
function mirrored(d: Doc<"documents">) {
  return { searchText: d.searchText, inTrash: d.inTrash, folderId: d.folderId, createdBy: d.createdBy, kind: d.kind };
}

type Mirrored = { searchText: string; inTrash: boolean; folderId?: Doc<"documents">["folderId"]; createdBy: Doc<"documents">["createdBy"]; kind: Doc<"documents">["kind"] };

const same = (a: Mirrored, b: Mirrored) =>
  a.searchText === b.searchText && a.inTrash === b.inTrash && a.folderId === b.folderId && a.createdBy === b.createdBy && a.kind === b.kind;

export async function documentTextOf(ctx: QueryCtx, documentId: Doc<"documents">["_id"]): Promise<Doc<"documentText"> | null> {
  return await ctx.db
    .query("documentText")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .unique();
}

/** Keeps a note's documentText row in step with one write to the note. */
export async function documentTextWritten(ctx: MutationCtx, before: Doc<"documents"> | null, after: Doc<"documents"> | null): Promise<void> {
  if (!after) {
    if (before) {
      const row = await documentTextOf(ctx, before._id);
      if (row) await ctx.db.delete(row._id);
    }
    return;
  }
  // Most writes to a note change nothing search keeps (no read of the row then).
  if (before && same(mirrored(before), mirrored(after))) return;
  if (!hasValidScope(after)) return;
  const row = await documentTextOf(ctx, after._id);
  const fields = mirrored(after);
  if (!row) await insertScoped(ctx, "documentText", scopeOfRow(after), { documentId: after._id, ...fields });
  else if (!same(row, fields)) await ctx.db.patch(row._id, fields);
}

/** Copies a note's text and fields into documentText (migrations.backfillDocumentText). */
export async function buildDocumentText(ctx: MutationCtx, d: Doc<"documents">): Promise<boolean> {
  if (!hasValidScope(d) || (await documentTextOf(ctx, d._id))) return false;
  await insertScoped(ctx, "documentText", scopeOfRow(d), { documentId: d._id, ...mirrored(d) });
  return true;
}
