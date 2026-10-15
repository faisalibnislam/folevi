// Spaced repetition (convex/study.ts): the review queue's cards and their schedules.
//
// A card is a toggle marked as a flashcard or quiz question (the toggle's `study` prop; Foli AI marks the
// ones it writes, and anyone can mark their own from the block menu). Its question is the toggle's text and
// its answer is everything inside it. `studyCards` lists the cards so the queue can find ones nobody has
// reviewed yet; `studyReviews` holds each person's FSRS schedule for a card, made by their first review.
import { createEmptyCard, fsrs, Rating, type Card, type Grade } from "ts-fsrs";
import { childrenMap, flattenTree, plainText, type WireBlock } from "@folevi/editor-schema";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { insertScoped, scopeOfRow } from "./scope";
import { toWireBlock } from "./documents";
import { sharedLabels } from "./linkLabels";

export type StudyKind = Doc<"studyCards">["kind"];
export type StudyRating = "again" | "hard" | "good" | "easy";
export const RATINGS: readonly StudyRating[] = ["again", "hard", "good", "easy"];
const GRADE: Record<StudyRating, Grade> = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy };

/** New cards a person starts a day (across everything they study), unless they picked another number. */
export const NEW_PER_DAY = 20;
/** The numbers a person can pick for new cards a day (Reviews, "New cards a day"). */
export const NEW_PER_DAY_OPTIONS = [0, 10, 20, 30, 50, 100] as const;

/** This person's new cards a day: their pick, or NEW_PER_DAY. */
export function newPerDay(profile: Pick<Doc<"profiles">, "studyNewPerDay">): number {
  const n = profile.studyNewPerDay;
  return n !== undefined && (NEW_PER_DAY_OPTIONS as readonly number[]).includes(n) ? n : NEW_PER_DAY;
}

/**
 * The scheduler. No fuzz: the interval shown on a button is the one you get (and tests stay exact).
 * Short-term steps (1 minute, 10 minutes) keep a card you're learning coming back within the session.
 */
const scheduler = fsrs({ enable_fuzz: false, enable_short_term: true });

/** The study mark on a block: "card" or "quiz" for a live toggle that is one, else null. */
export function studyKindOf(row: Pick<Doc<"blocks">, "type" | "props" | "deletedAt">): StudyKind | null {
  if (row.deletedAt !== undefined || row.type !== "toggle") return null;
  const study = (row.props as { study?: unknown } | null)?.study;
  return study === "card" || study === "quiz" ? study : null;
}

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

/** A card's question (the toggle's text) and answer (the text of everything inside it, a line each). */
export interface CardText {
  front: string;
  back: string;
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
    const toggle = blocks.find((b) => b.id === id);
    if (!toggle) continue;
    const inside = flattenTree(descendants(children, id)).map((e) => e.block);
    const labelled = await sharedLabels(ctx, doc, [toggle, ...inside]);
    const [head, ...rest] = labelled;
    out.set(id, {
      front: plainText(head!.text).trim(),
      back: rest
        .map((b) => plainText(b.text).trim())
        .filter(Boolean)
        .join("\n"),
    });
  }
  return out;
}

/** Every block below `id`, with the top ones re-rooted so flattenTree keeps their order. */
function descendants(children: Map<string | null, WireBlock[]>, id: string): WireBlock[] {
  const out: WireBlock[] = [];
  const walk = (parent: string, depth: number) => {
    if (depth > 12) return;
    for (const c of children.get(parent) ?? []) {
      out.push(parent === id ? { ...c, parentId: null } : c);
      walk(c.id, depth + 1);
    }
  };
  walk(id, 0);
  return out;
}

type Schedule = Pick<Doc<"studyReviews">, "due" | "stability" | "difficulty" | "elapsedDays" | "scheduledDays" | "learningSteps" | "reps" | "lapses" | "state" | "lastReview">;

function toCard(row: Schedule | null, now: number): Card {
  if (!row) return createEmptyCard(new Date(now));
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsedDays,
    scheduled_days: row.scheduledDays,
    learning_steps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.lastReview !== undefined ? new Date(row.lastReview) : undefined,
  };
}

function fromCard(card: Card): Schedule {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review?.getTime(),
  };
}

/** The schedule after rating a card at `now` (a card with no schedule yet is new). */
export function nextSchedule(row: Schedule | null, rating: StudyRating, now: number): Schedule {
  return fromCard(scheduler.next(toCard(row, now), new Date(now), GRADE[rating]).card);
}

/** How long until the card comes back after each rating (ms), for the buttons ("10m", "4d"). */
export function intervals(row: Schedule | null, now: number): Record<StudyRating, number> {
  const preview = scheduler.repeat(toCard(row, now), new Date(now));
  const after = (r: StudyRating) => Math.max(0, preview[GRADE[r]].card.due.getTime() - now);
  return { again: after("again"), hard: after("hard"), good: after("good"), easy: after("easy") };
}
