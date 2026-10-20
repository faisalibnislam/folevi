// Spaced repetition (convex/study.ts): the review queue's cards and their schedules.
//
// A card is a toggle marked as a flashcard or quiz question (the toggle's `study` prop; Foli AI marks the
// ones it writes, and anyone can mark their own from the block menu). Its question is the toggle's text and
// its answer is everything inside it. `studyCards` lists the cards so the queue can find ones nobody has
// reviewed yet; `studyReviews` holds each person's FSRS schedule for a card, made by their first review.
// What a card is, its text and the FSRS scheduling are pure and shared with the local backend
// (packages/editor-schema study.ts); this file keeps the tables in step.
import { cardText, childrenMap, studyCardBlocks, studyKindOf, type CardText } from "@folevi/editor-schema";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { insertScoped, scopeOfRow } from "./scope";
import { toWireBlock } from "./documents";
import { sharedLabels } from "./linkLabels";

export type StudyKind = Doc<"studyCards">["kind"];
export { NEW_PER_DAY, NEW_PER_DAY_OPTIONS, RATINGS, intervals, newPerDay, nextSchedule, studyKindOf, type CardText, type StudyRating } from "@folevi/editor-schema";

/** Keeps a block's card row in step with it (the block stays canonical). Templates hold no cards. */
export async function syncStudyCard(ctx: MutationCtx, row: Doc<"blocks">, doc: Doc<"documents">): Promise<void> {
  const kind = doc.kind === "template" ? null : studyKindOf(row);
  const existing = await ctx.db
    .query("studyCards")
    .withIndex("by_block", (q) => q.eq("blockId", row.blockId))
    .unique();
  if (!kind) {
    // People's schedules stay: a card unmarked by mistake (or deleted and brought back) keeps its history.
    if (existing) await ctx.db.delete(existing._id);
    return;
  }
  if (!existing) await insertScoped(ctx, "studyCards", scopeOfRow(doc), { blockId: row.blockId, documentId: doc._id, kind, createdAt: Date.now() });
  else if (existing.kind !== kind) await ctx.db.patch(existing._id, { kind });
}

/**
 * The text of each card in a note, by block id, from the note's live blocks. Links carry only titles
 * everyone who can read the note may see (lib/linkLabels.ts), as tasks do.
 */
export async function cardTexts(ctx: QueryCtx | MutationCtx, doc: Doc<"documents">, rows: Doc<"blocks">[], blockIds: ReadonlySet<string>): Promise<Map<string, CardText>> {
  const out = new Map<string, CardText>();
  const blocks = rows.map(toWireBlock);
  const children = childrenMap(blocks);
  for (const id of blockIds) {
    const card = studyCardBlocks(blocks, id, children);
    if (!card) continue;
    out.set(id, cardText(await sharedLabels(ctx, doc, card)));
  }
  return out;
}
