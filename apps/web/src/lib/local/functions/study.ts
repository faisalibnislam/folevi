// study.* in local mode (convex/study.ts): the review queue. Cards are toggles marked as a flashcard or quiz
// question, read from the notes' blocks (the server lists them in studyCards; here the block is the only
// record). Each card's FSRS schedule is kept with its note (the studyReviews table, under the note), made by
// its first review and scheduled with the server's own FSRS code (packages/editor-schema study.ts).
import {
  NEW_PER_DAY_OPTIONS,
  cardText,
  childrenMap,
  intervals,
  newPerDay,
  nextSchedule,
  studyCardBlocks,
  studyKindOf,
  type StudyKind,
} from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { fail } from "../errors";
import { defineLocal, defineTrigger, type LocalQueryCtx, type LocalReader } from "../registry";
import type { LocalBlock, LocalDocument, LocalStudyReview } from "../store";
import { checkScope, liveBlocks, requireProfile, toWireBlock } from "./shared";

/** Schedules looked at per range (due now, later today): enough for any day's reviews. */
const SCAN = 500;
/** Cards looked at while finding new ones (most of them are already being reviewed). */
const NEW_SCAN = 1000;
/** Cards a note's own review offers at once (its new cards aren't held to the daily cap: you asked for them). */
const NOTE_MAX = 200;
const QUEUE_MAX = 50;
const DAY_MS = 86_400_000;

/** This library's "New cards a day" (the server keeps it on the profile). */
const NEW_PER_DAY_KEY = "studyNewPerDay";

async function cap(db: LocalReader): Promise<number> {
  const n = (await db.get("meta", NEW_PER_DAY_KEY)) as number | undefined;
  return newPerDay({ studyNewPerDay: n });
}

type Window = { now: number; dayStart: number; dayEnd: number };

function checkWindow(w: Window): Window {
  const ok = [w.now, w.dayStart, w.dayEnd].every(Number.isFinite) && w.dayEnd > w.dayStart && w.dayEnd - w.dayStart <= DAY_MS + 2 * 3_600_000;
  if (!ok) fail("invalid_argument", "Invalid day.");
  return w;
}

/** A card: a live toggle marked as one, in a note. */
interface Card {
  blockId: string;
  kind: StudyKind;
  doc: LocalDocument;
  block: LocalBlock;
}

/** What to study: everything (Personal is the only place here), or one note. */
type Target = { kind: "all" } | { kind: "note"; doc: LocalDocument };

interface Entry {
  card: Card;
  review: LocalStudyReview | null;
}

const kindOf = (b: LocalBlock) => (b.deletedAt === null ? studyKindOf({ type: b.type, props: b.props }) : null);

/**
 * Every card in the library, in the order the server's card rows were made (when the block was made, then
 * its place in its note), and by block id. Templates hold no cards.
 */
async function allCards(db: LocalReader): Promise<{ list: Card[]; byId: Map<string, Card> }> {
  const list: Card[] = [];
  for (const doc of await db.list("documents")) {
    if (doc.kind === "template") continue;
    for (const block of await db.list("blocks", doc.id)) {
      const kind = kindOf(block);
      if (kind) list.push({ blockId: block.id, kind, doc, block });
    }
  }
  list.sort((a, b) => a.block.createdAt - b.block.createdAt || (a.block.rank < b.block.rank ? -1 : a.block.rank > b.block.rank ? 1 : 0) || (a.blockId < b.blockId ? -1 : 1));
  return { list, byId: new Map(list.map((c) => [c.blockId, c])) };
}

/** The card's note, when it's one to study here: not in Trash, in the target. */
function studiable(card: Card, target: Target): boolean {
  if (card.doc.inTrash) return false;
  return target.kind !== "note" || card.doc.id === target.doc.id;
}

/**
 * What's due: cards due now (most overdue first), new cards that can start today, and how many more fall
 * due later today (convex/study.ts gather).
 */
async function gather(ctx: LocalQueryCtx, target: Target, w: Window) {
  const cards = await allCards(ctx.db);
  const reviews = (await ctx.db.list("studyReviews")).sort((a, b) => a.due - b.due || a.firstReview - b.firstReview);
  const due: Entry[] = [];
  for (const review of reviews.filter((r) => r.due <= w.now).slice(0, SCAN)) {
    const card = cards.byId.get(review.blockId);
    if (card && studiable(card, target)) due.push({ card, review });
  }
  let later = 0;
  for (const review of reviews.filter((r) => r.due > w.now && r.due <= w.dayEnd).slice(0, SCAN)) {
    const card = cards.byId.get(review.blockId);
    if (card && studiable(card, target)) later++;
  }

  // New cards: never reviewed. At most the library's new cards a day started (a note's own review isn't held to it).
  const perDay = await cap(ctx.db);
  const startedToday = perDay ? Math.min(perDay, reviews.filter((r) => r.firstReview >= w.dayStart).length) : 0;
  const allowance = target.kind === "note" ? NOTE_MAX : Math.max(0, perDay - startedToday);
  const reviewed = new Set(reviews.map((r) => r.blockId));
  const fresh: Entry[] = [];
  let total = 0;
  let scanned = 0;
  const source = target.kind === "note" ? cards.list.filter((c) => c.doc.id === target.doc.id) : cards.list;
  for (const card of source) {
    if (scanned++ >= NEW_SCAN || (fresh.length >= allowance && target.kind !== "note")) break;
    if (target.kind === "note") total++;
    if (fresh.length >= allowance) continue;
    if (reviewed.has(card.blockId)) continue;
    if (studiable(card, target)) fresh.push({ card, review: null });
  }
  due.sort((a, b) => a.review!.due - b.review!.due);
  // Whether there's anything to study at all (the sidebar shows Reviews only then).
  const hasCards = due.length > 0 || fresh.length > 0 || later > 0 || reviews.length > 0;
  return { due, fresh, later, total, hasCards };
}

async function targetFor(ctx: LocalQueryCtx, args: { scope?: { kind: "personal" } | { kind: "workspace"; workspaceId: string }; documentId?: string }): Promise<Target | null> {
  if (args.documentId !== undefined) {
    const doc = await ctx.db.get("documents", args.documentId);
    if (!doc || doc.inTrash) return null;
    return { kind: "note", doc };
  }
  if (args.scope) checkScope(args.scope);
  return { kind: "all" };
}

defineLocal(api.study.summary, "query", async (ctx, args) => {
  await requireProfile(ctx);
  const w = checkWindow(args);
  const target = await targetFor(ctx, args);
  if (!target) return null;
  const { due, fresh, later, total, hasCards } = await gather(ctx, target, w);
  return { due: due.length, new: fresh.length, later, total, hasCards };
});

defineLocal(api.study.queue, "query", async (ctx, args) => {
  await requireProfile(ctx);
  const w = checkWindow(args);
  const target = await targetFor(ctx, args);
  if (!target) return null;
  const { due, fresh, later, total, hasCards } = await gather(ctx, target, w);
  const limit = Math.max(1, Math.min(QUEUE_MAX, Math.floor(args.limit ?? QUEUE_MAX)));
  const picked = [...due, ...fresh].slice(0, limit);
  // Each note's blocks are read once for the text of its cards.
  const texts = new Map<string, Map<string, { front: string; back: string }>>();
  for (const e of picked) {
    const docId = e.card.doc.id;
    if (texts.has(docId)) continue;
    const blocks = (await liveBlocks(ctx.db, docId)).map(toWireBlock);
    const children = childrenMap(blocks);
    const mine = new Map<string, { front: string; back: string }>();
    for (const p of picked) {
      if (p.card.doc.id !== docId) continue;
      const card = studyCardBlocks(blocks, p.card.blockId, children);
      if (card) mine.set(p.card.blockId, cardText(card));
    }
    texts.set(docId, mine);
  }
  const cards = [];
  for (const e of picked) {
    const text = texts.get(e.card.doc.id)?.get(e.card.blockId);
    if (!text) continue;
    cards.push({
      blockId: e.card.blockId,
      kind: e.card.kind,
      documentId: e.card.doc.id,
      documentTitle: e.card.doc.title,
      documentIcon: e.card.doc.icon ?? null,
      front: text.front,
      back: text.back,
      isNew: e.review === null,
      lastReview: e.review?.lastReview ?? null,
      intervals: intervals(e.review, w.now),
    });
  }
  return {
    cards,
    counts: { due: due.length, new: fresh.length, later },
    total,
    hasCards,
    documentTitle: target.kind === "note" ? target.doc.title : null,
    newPerDay: await cap(ctx.db),
  };
});

defineLocal(api.study.setNewPerDay, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  if (!(NEW_PER_DAY_OPTIONS as readonly number[]).includes(args.value)) fail("invalid_argument", "Pick one of the numbers offered.");
  ctx.db.put("meta", NEW_PER_DAY_KEY, args.value);
  return null;
});

defineLocal(api.study.review, "mutation", async (ctx, args) => {
  await requireProfile(ctx);
  const { byId } = await allCards(ctx.db);
  const card = byId.get(args.blockId);
  if (!card || card.doc.inTrash) fail("not_found", "This card isn't in a note you can open any more.");
  // A schedule stays with the note it was made in (a card moved since keeps its own).
  const existing = (await ctx.db.list("studyReviews")).find((r) => r.blockId === args.blockId) ?? null;
  if (existing && (existing.lastReview ?? null) !== args.lastReview) return { due: existing.due, duplicate: true };
  const now = ctx.now();
  const next = nextSchedule(existing, args.rating, now);
  const row: LocalStudyReview = existing
    ? { ...existing, ...next }
    : { blockId: args.blockId, documentId: card.doc.id, ...next, firstReview: now };
  // ts-fsrs leaves lastReview unset on a card never reviewed; a stored row never has an undefined field.
  if (row.lastReview === undefined) delete row.lastReview;
  ctx.db.put("studyReviews", args.blockId, row, row.documentId);
  return { due: next.due, duplicate: false };
});

/** A note deleted for good takes its cards' schedules with it (the server's maintenance purge does the same). */
defineTrigger("study:purge", async (ctx, writes) => {
  for (const w of writes) {
    if (w.table !== "documents" || w.value !== null) continue;
    for (const r of await ctx.db.list("studyReviews", w.id)) ctx.db.remove("studyReviews", r.blockId, w.id);
  }
});
