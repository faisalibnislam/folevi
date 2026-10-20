// Spaced repetition: which blocks are cards, what a card says, and FSRS schedules (via ts-fsrs). Pure, so
// the server (convex/lib/study.ts, convex/study.ts) and the local backend schedule reviews identically.
//
// A card is a toggle marked as a flashcard or quiz question (the toggle's `study` prop). Its question is the
// toggle's text and its answer is everything inside it. Time is always passed in (`now`, UTC ms).
import { createEmptyCard, fsrs, Rating, type Card, type FSRS, type Grade } from "ts-fsrs";
import type { StudyKind } from "./generated/schema";
import type { WireBlock } from "./types";
import { childrenMap, flattenTree } from "./tree";
import { plainText } from "./richtext";

export type StudyRating = "again" | "hard" | "good" | "easy";
export const RATINGS: readonly StudyRating[] = ["again", "hard", "good", "easy"];
const GRADE: Record<StudyRating, Grade> = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy };

/** New cards a person starts a day (across everything they study), unless they picked another number. */
export const NEW_PER_DAY = 20;
/** The numbers a person can pick for new cards a day (Reviews, "New cards a day"). */
export const NEW_PER_DAY_OPTIONS = [0, 10, 20, 30, 50, 100] as const;

/** This person's new cards a day: their pick, or NEW_PER_DAY. */
export function newPerDay(profile: { studyNewPerDay?: number }): number {
  const n = profile.studyNewPerDay;
  return n !== undefined && (NEW_PER_DAY_OPTIONS as readonly number[]).includes(n) ? n : NEW_PER_DAY;
}

/**
 * The scheduler. No fuzz: the interval shown on a button is the one you get (and tests stay exact).
 * Short-term steps (1 minute, 10 minutes) keep a card you're learning coming back within the session.
 * Made on first use, so importing this module costs nothing.
 */
let scheduler: FSRS | null = null;
const schedulerOf = (): FSRS => (scheduler ??= fsrs({ enable_fuzz: false, enable_short_term: true }));

/** The study mark on a block: "card" or "quiz" for a live toggle that is one, else null. */
export function studyKindOf(row: { type: string; props?: unknown; deletedAt?: number }): StudyKind | null {
  if (row.deletedAt !== undefined || row.type !== "toggle") return null;
  const study = (row.props as { study?: unknown } | null)?.study;
  return study === "card" || study === "quiz" ? study : null;
}

/** A card's question (the toggle's text) and answer (the text of everything inside it, a line each). */
export interface CardText {
  front: string;
  back: string;
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

/**
 * A card's blocks: the toggle, then everything inside it in reading order. Null when the toggle isn't among
 * `blocks`. Pass `children` (childrenMap of the same blocks) when reading many cards of one note.
 */
export function studyCardBlocks(blocks: readonly WireBlock[], id: string, children: Map<string | null, WireBlock[]> = childrenMap(blocks)): WireBlock[] | null {
  const toggle = blocks.find((b) => b.id === id);
  if (!toggle) return null;
  return [toggle, ...flattenTree(descendants(children, id)).map((e) => e.block)];
}

/** The text of a card from its blocks (studyCardBlocks, with whatever link labels its readers may see). */
export function cardText(card: readonly WireBlock[]): CardText {
  const [head, ...rest] = card;
  return {
    front: plainText(head!.text).trim(),
    back: rest
      .map((b) => plainText(b.text).trim())
      .filter(Boolean)
      .join("\n"),
  };
}

/** One person's FSRS schedule for one card, as stored (times in UTC ms). */
export interface StudySchedule {
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  /** ts-fsrs State: 0 new, 1 learning, 2 review, 3 relearning. */
  state: number;
  lastReview?: number;
}

function toCard(row: StudySchedule | null, now: number): Card {
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

function fromCard(card: Card): StudySchedule {
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
export function nextSchedule(row: StudySchedule | null, rating: StudyRating, now: number): StudySchedule {
  return fromCard(schedulerOf().next(toCard(row, now), new Date(now), GRADE[rating]).card);
}

/** How long until the card comes back after each rating (ms), for the buttons ("10m", "4d"). */
export function intervals(row: StudySchedule | null, now: number): Record<StudyRating, number> {
  const preview = schedulerOf().repeat(toCard(row, now), new Date(now));
  const after = (r: StudyRating) => Math.max(0, preview[GRADE[r]].card.due.getTime() - now);
  return { again: after("again"), hard: after("hard"), good: after("good"), easy: after("easy") };
}
