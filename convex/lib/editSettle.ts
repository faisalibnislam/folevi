// How an edit to a note's blocks reaches the note's own row (its edited time and editor, contentSeq, sync
// seq, search text, counts and preview). Most queries read note rows (the page tree, titles, comments,
// presence, the note itself), and Convex re-runs a query whenever a row it read changes, so writing the row
// on every save made every open query re-run every few seconds while someone typed.
//
//   The first save of a burst updates the row at once (a single edit shows straight away) and opens a
//   window of SETTLE_MS. Saves inside the window only note who edited and when, in `documentEdits` (a table
//   nothing else reads). When the window ends (documents.settleEdits), a waiting edit is written to the row
//   and the next window opens; with nothing waiting, it closes. So a note being typed in has its row
//   written about once every SETTLE_MS, whatever the number of saves.
//
// The blocks themselves are always saved at once: only the row's summary of them waits. A version saved
// meanwhile settles first (documents.snapshot), so it never misses an edit.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { queueIndex } from "./ai/indexing";
import { refreshDerived } from "./documents";
import { nextSeq } from "./seq";
import { scopeOfRow } from "./scope";
import { emitWebhook } from "./webhooks";

/** How long a note's row may lag behind its blocks while someone types. */
export const SETTLE_MS = 30_000;
/** However long someone keeps typing, the page gets a version at least this often (documents.autoVersion). */
export const AUTO_VERSION_MS = 10 * 60_000;

const pendingOf = async (ctx: MutationCtx, documentId: Id<"documents">) =>
  await ctx.db
    .query("documentEdits")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .first();

/**
 * `doc`'s blocks were just changed by `actorId`. `seq` is the batch's sequence number when it has one;
 * `bulk` (a paste of many lines) refreshes the search text and preview a moment later instead of now.
 */
export async function noteEdited(ctx: MutationCtx, doc: Doc<"documents">, actorId: Id<"profiles">, opts: { seq?: number; bulk?: boolean } = {}): Promise<void> {
  const now = Date.now();
  // Webhooks hear of it (at most once a minute per note; nothing at all when no one listens).
  await emitWebhook(ctx, "note.updated", doc);
  if (doc.settleAt !== undefined && doc.settleAt > now) {
    const pending = await pendingOf(ctx, doc._id);
    const bulk = Boolean(opts.bulk) || Boolean(pending?.bulk);
    if (pending) await ctx.db.patch(pending._id, { profileId: actorId, at: now, bulk });
    else await ctx.db.insert("documentEdits", { documentId: doc._id, profileId: actorId, at: now, bulk });
    // Semantic search still hears of every edit (its own state row, not the note's).
    await queueIndex(ctx, doc);
    return;
  }
  await writeEdit(ctx, doc, actorId, now, opts);
  await ctx.scheduler.runAfter(SETTLE_MS, internal.documents.settleEdits, { documentId: doc._id });
}

/** Writes a waiting edit to the note's row. True when there was one (the window stays open). */
export async function settlePending(ctx: MutationCtx, documentId: Id<"documents">): Promise<boolean> {
  const pending = await pendingOf(ctx, documentId);
  if (!pending) return false;
  await ctx.db.delete(pending._id);
  const doc = await ctx.db.get(documentId);
  if (!doc || doc.deletedAt !== undefined) return false;
  await writeEdit(ctx, doc, pending.profileId, pending.at, { bulk: pending.bulk });
  return true;
}

async function writeEdit(ctx: MutationCtx, doc: Doc<"documents">, actorId: Id<"profiles">, at: number, opts: { seq?: number; bulk?: boolean }): Promise<void> {
  const now = Date.now();
  const seq = opts.seq ?? (await nextSeq(ctx, scopeOfRow(doc)));
  // The first edit after a version schedules the next one (documents.autoVersion), so a long stretch of
  // editing still gets a version every few minutes, whichever app made it and whether or not it stays open.
  // (A due time long past means that run never happened, e.g. it failed: schedule again rather than never.)
  const versionDue = doc.versionDueAt === undefined || doc.versionDueAt < now - AUTO_VERSION_MS;
  await ctx.db.patch(doc._id, {
    updatedAt: at,
    lastEditedBy: actorId,
    contentSeq: doc.contentSeq + 1,
    seq,
    settleAt: now + SETTLE_MS,
    ...(versionDue ? { versionDueAt: now + AUTO_VERSION_MS } : {}),
  });
  if (versionDue) await ctx.scheduler.runAfter(AUTO_VERSION_MS, internal.documents.autoVersion, { documentId: doc._id });
  const fresh = (await ctx.db.get(doc._id))!;
  // Semantic search re-reads the note a little later (one job per burst of edits; eligible plans only).
  await queueIndex(ctx, fresh);
  // A big batch (a paste of many lines) gets its search text, counts and preview a moment later, so saving
  // it doesn't wait on reading the whole page; small edits update them at once.
  if (opts.bulk) await ctx.scheduler.runAfter(0, internal.documents.refreshDerivedLater, { documentId: doc._id });
  else await refreshDerived(ctx, fresh);
}
