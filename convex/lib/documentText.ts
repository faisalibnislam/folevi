// A note's search text lives in its own table (documentText), not on the note's row: it can be 32,000
// characters, and every list, count and title read of a note used to pay for it. The documentText row holds
// the text with the full-text search index, and copies of the note's fields that search filters on, kept in step
// by every write to a note (lib/functions.ts calls documentTextWritten). The text itself is written here by
// refreshDerived (setNoteText); a sealed note's text is emptied (its text is derived on devices).
//
// Rollout (docs/perf/backend-results.md, step 3): widen (both places written), backfill
// (migrations.backfillDocumentText), then this switch: readers use documentText, and documents.searchText is
// emptied (migrations.narrowDocumentText) and dropped.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { hasValidScope, insertScoped, scopeOfRow } from "./scope";

/** The note fields documentText copies (what search filters on). */
function filters(d: Doc<"documents">) {
  return { inTrash: d.inTrash, folderId: d.folderId, createdBy: d.createdBy, kind: d.kind };
}

type Filters = { inTrash: boolean; folderId?: Id<"folders">; createdBy: Id<"profiles">; kind: Doc<"documents">["kind"] };
const same = (a: Filters, b: Filters) => a.inTrash === b.inTrash && a.folderId === b.folderId && a.createdBy === b.createdBy && a.kind === b.kind;

export async function documentTextOf(ctx: QueryCtx, documentId: Id<"documents">): Promise<Doc<"documentText"> | null> {
  return await ctx.db
    .query("documentText")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .unique();
}

/** A note's search text (title first, then its text); "" for a note without one. */
export async function noteText(ctx: QueryCtx, documentId: Id<"documents">): Promise<string> {
  return (await documentTextOf(ctx, documentId))?.searchText ?? "";
}

/** Sets a note's search text (refreshDerived). */
export async function setNoteText(ctx: MutationCtx, doc: Doc<"documents">, searchText: string): Promise<void> {
  if (!hasValidScope(doc)) return;
  const row = await documentTextOf(ctx, doc._id);
  if (!row) await insertScoped(ctx, "documentText", scopeOfRow(doc), { documentId: doc._id, searchText, ...filters(doc) });
  else if (row.searchText !== searchText) await ctx.db.patch(row._id, { searchText });
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
  const sealedNow = after.sealedAt !== undefined && before?.sealedAt === undefined;
  // Most writes to a note change nothing search keeps (no read of the row then).
  if (before && !sealedNow && same(filters(before), filters(after))) return;
  if (!hasValidScope(after)) return;
  const row = await documentTextOf(ctx, after._id);
  const fields = filters(after);
  // A new note's text is its title until refreshDerived derives it; a sealed note keeps none.
  if (!row) await insertScoped(ctx, "documentText", scopeOfRow(after), { documentId: after._id, searchText: after.sealedAt !== undefined ? "" : after.title, ...fields });
  else if (!same(row, fields) || (sealedNow && row.searchText !== "")) await ctx.db.patch(row._id, { ...fields, ...(sealedNow ? { searchText: "" } : {}) });
}

/** Copies a note's text and fields into documentText (migrations.backfillDocumentText, before the switch). */
export async function buildDocumentText(ctx: MutationCtx, d: Doc<"documents">): Promise<boolean> {
  if (!hasValidScope(d) || (await documentTextOf(ctx, d._id))) return false;
  await insertScoped(ctx, "documentText", scopeOfRow(d), { documentId: d._id, searchText: d.searchText ?? "", ...filters(d) });
  return true;
}
