// The review queue (spaced repetition): flashcards and quiz questions from every note a person can read
// come back when they're due, scheduled with FSRS (lib/study.ts). No model calls.
//
// Cards are toggles marked as study cards (`studyCards` lists them). Schedules are per person
// (`studyReviews`), made by a card's first review; a card never reviewed is new, and a person starts at most
// NEW_PER_DAY new cards a day (or the number they picked, `studyNewPerDay`). Only cards the person can still
// read count: a card in Trash, in a deleted note or in a note they lost access to drops out (its schedule
// stays, in case it comes back).
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { accessAtLeast, assertWritable, documentAccess, getDocumentByPublicId, PageReader, requireProfile, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { liveBlocks } from "./lib/documents";
import { inScope, personalScope, scopeKey, scopeOfRow, vScopeArg, workspaceScope, type Scope } from "./lib/scope";
import { cardTexts, intervals, newPerDay, nextSchedule, NEW_PER_DAY_OPTIONS, type StudyKind } from "./lib/study";
import { failE2ee, isSealed } from "./lib/e2ee/state";

/** Schedules looked at per range (due now, later today): enough for any day's reviews. */
const SCAN = 500;
/** Cards looked at while finding new ones (most of them are already being reviewed). */
const NEW_SCAN = 1000;
/** Cards a note's own review offers at once (its new cards aren't held to the daily cap: you asked for them). */
const NOTE_MAX = 200;
const QUEUE_MAX = 50;
/** Places looked in when studying everywhere (Personal and each workspace). */
const MAX_PLACES = 50;
const DAY_MS = 86_400_000;

const vRating = v.union(v.literal("again"), v.literal("hard"), v.literal("good"), v.literal("easy"));

/**
 * The person's clock: now, and when their day started and ends (the client knows its time zone best).
 * `now` comes from the client, rounded, so a card that falls due while the queue is open shows up.
 */
const vWindow = { now: v.number(), dayStart: v.number(), dayEnd: v.number() };
type Window = { now: number; dayStart: number; dayEnd: number };

function checkWindow(w: Window): Window {
  const ok = [w.now, w.dayStart, w.dayEnd].every(Number.isFinite) && w.dayEnd > w.dayStart && w.dayEnd - w.dayStart <= DAY_MS + 2 * 3_600_000;
  if (!ok) fail("invalid_argument", "Invalid day.");
  return w;
}

/** What to study: everything, one place, or one note. */
type Target = { kind: "all" } | { kind: "scope"; scope: Scope } | { kind: "note"; doc: Doc<"documents"> };

interface Entry {
  card: Doc<"studyCards">;
  doc: Doc<"documents">;
  review: Doc<"studyReviews"> | null;
}

/** Reads cards and their notes once per call, and decides which notes the person can study. */
class Deck {
  private docs = new Map<string, Doc<"documents"> | null>();
  private cards = new Map<string, Doc<"studyCards"> | null>();
  private readers = new Map<string, PageReader>();
  constructor(
    private ctx: QueryCtx,
    private profile: Doc<"profiles">,
    private target: Target,
  ) {}

  async card(blockId: string): Promise<Doc<"studyCards"> | null> {
    if (!this.cards.has(blockId)) {
      this.cards.set(
        blockId,
        await this.ctx.db
          .query("studyCards")
          .withIndex("by_block", (q) => q.eq("blockId", blockId))
          .unique(),
      );
    }
    return this.cards.get(blockId) ?? null;
  }

  /** The card's note, when it's one to study here: not in Trash, one the person can read, in the target. */
  async noteOf(card: Doc<"studyCards">): Promise<Doc<"documents"> | null> {
    if (!this.docs.has(card.documentId)) this.docs.set(card.documentId, await this.ctx.db.get(card.documentId));
    const doc = this.docs.get(card.documentId);
    // Sealed notes are studied on the device (studyReview records, docs/E2EE_DESIGN.md §5.7).
    if (!doc || doc.inTrash || doc.kind === "template" || isSealed(doc)) return null;
    if (this.target.kind === "note" && doc._id !== this.target.doc._id) return null;
    if (this.target.kind === "scope" && !inScope(doc, this.target.scope)) return null;
    const scope = scopeOfRow(doc);
    let reader = this.readers.get(scopeKey(scope));
    if (!reader) {
      reader = await PageReader.forScope(this.ctx, this.profile, scope);
      this.readers.set(scopeKey(scope), reader);
    }
    return (await reader.canOpen(doc)) ? doc : null;
  }
}

/** The places someone studies everywhere: their Personal, then each workspace they're in. */
async function places(ctx: QueryCtx, profile: Doc<"profiles">): Promise<Scope[]> {
  const out: Scope[] = [personalScope(profile._id)];
  const memberships = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
    .take(MAX_PLACES);
  for (const m of memberships) {
    const w = await ctx.db.get(m.workspaceId);
    if (w && w.status !== "deleting") out.push(workspaceScope(w._id));
  }
  return out;
}

function cardsIn(ctx: QueryCtx, scope: Scope) {
  return scope.kind === "personal"
    ? ctx.db.query("studyCards").withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
    : ctx.db.query("studyCards").withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId));
}

/**
 * What's due for a person: cards due now (most overdue first), new cards they can start today, and how many
 * more fall due later today.
 */
async function gather(ctx: QueryCtx, profile: Doc<"profiles">, target: Target, w: Window) {
  const deck = new Deck(ctx, profile, target);
  const reviews = ctx.db.query("studyReviews");
  const due: Entry[] = [];
  for (const review of await reviews.withIndex("by_profile_due", (q) => q.eq("profileId", profile._id).lte("due", w.now)).take(SCAN)) {
    const card = await deck.card(review.blockId);
    const doc = card && (await deck.noteOf(card));
    if (card && doc) due.push({ card, doc, review });
  }
  let later = 0;
  for (const review of await reviews.withIndex("by_profile_due", (q) => q.eq("profileId", profile._id).gt("due", w.now).lte("due", w.dayEnd)).take(SCAN)) {
    const card = await deck.card(review.blockId);
    if (card && (await deck.noteOf(card))) later++;
  }

  // New cards: never reviewed by this person. Everywhere or in one place, at most their new cards a day started.
  const cap = newPerDay(profile);
  const startedToday = cap ? (await reviews.withIndex("by_profile_first", (q) => q.eq("profileId", profile._id).gte("firstReview", w.dayStart)).take(cap)).length : 0;
  const allowance = target.kind === "note" ? NOTE_MAX : Math.max(0, cap - startedToday);
  const fresh: Entry[] = [];
  let total = 0;
  let scanned = 0;
  const sources = target.kind === "note" ? [ctx.db.query("studyCards").withIndex("by_document", (q) => q.eq("documentId", target.doc._id))] : (target.kind === "scope" ? [target.scope] : await places(ctx, profile)).map((s) => cardsIn(ctx, s));
  for (const source of sources) {
    for await (const card of source) {
      if (scanned++ >= NEW_SCAN || (fresh.length >= allowance && target.kind !== "note")) break;
      if (target.kind === "note") total++;
      if (fresh.length >= allowance) continue;
      const seen = await reviews.withIndex("by_block", (q) => q.eq("profileId", profile._id).eq("blockId", card.blockId)).first();
      if (seen) continue;
      const doc = await deck.noteOf(card);
      if (doc) fresh.push({ card, doc, review: null });
    }
  }
  due.sort((a, b) => a.review!.due - b.review!.due);
  // Whether there's anything to study at all (the sidebar shows Reviews only then).
  const hasCards = due.length > 0 || fresh.length > 0 || later > 0 || (await reviews.withIndex("by_profile_due", (q) => q.eq("profileId", profile._id)).first()) !== null;
  return { due, fresh, later, total, hasCards };
}

async function targetFor(ctx: QueryCtx, profile: Doc<"profiles">, args: { scope?: { kind: "personal" } | { kind: "workspace"; workspaceId: string }; documentId?: string }): Promise<Target | null> {
  if (args.documentId !== undefined) {
    const doc = await getDocumentByPublicId(ctx, args.documentId);
    if (!doc || doc.inTrash || !accessAtLeast(await documentAccess(ctx, profile, doc), "read")) return null;
    if (isSealed(doc)) failE2ee("e2ee_device_only");
    return { kind: "note", doc };
  }
  if (args.scope) return { kind: "scope", scope: (await resolveScope(ctx, profile, args.scope)).scope };
  return { kind: "all" };
}

const vTarget = { scope: v.optional(vScopeArg), documentId: v.optional(v.string()) };

/** Today's reviews in numbers: due now, new to start, later today; for one note, also how many cards it has. */
export const summary = query({
  args: { ...vTarget, ...vWindow },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const w = checkWindow(args);
    const target = await targetFor(ctx, profile, args);
    if (!target) return null;
    const { due, fresh, later, total, hasCards } = await gather(ctx, profile, target, w);
    return { due: due.length, new: fresh.length, later, total, hasCards };
  },
});

/**
 * The cards to review now, in order (due ones first, most overdue first, then new ones), each with its
 * note, question and answer, and how long until it comes back after each rating. Studying everywhere covers
 * the person's Personal and every workspace they're in, plus shared notes whose cards they've reviewed.
 */
export const queue = query({
  args: { ...vTarget, ...vWindow, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const w = checkWindow(args);
    const target = await targetFor(ctx, profile, args);
    if (!target) return null;
    const { due, fresh, later, total, hasCards } = await gather(ctx, profile, target, w);
    const limit = Math.max(1, Math.min(QUEUE_MAX, Math.floor(args.limit ?? QUEUE_MAX)));
    const picked = [...due, ...fresh].slice(0, limit);
    // Each note's blocks are read once for the text of its cards.
    const texts = new Map<string, Map<string, { front: string; back: string }>>();
    for (const e of picked) {
      if (texts.has(e.doc._id)) continue;
      const ids = new Set(picked.filter((p) => p.doc._id === e.doc._id).map((p) => p.card.blockId));
      texts.set(e.doc._id, await cardTexts(ctx, e.doc, await liveBlocks(ctx, e.doc._id), ids));
    }
    const cards = [];
    for (const e of picked) {
      const text = texts.get(e.doc._id)?.get(e.card.blockId);
      if (!text) continue;
      cards.push({
        blockId: e.card.blockId,
        kind: e.card.kind as StudyKind,
        documentId: e.doc.publicId,
        documentTitle: e.doc.title,
        documentIcon: e.doc.icon ?? null,
        front: text.front,
        back: text.back,
        isNew: e.review === null,
        lastReview: e.review?.lastReview ?? null,
        intervals: intervals(e.review, w.now),
      });
    }
    return { cards, counts: { due: due.length, new: fresh.length, later }, total, hasCards, documentTitle: target.kind === "note" ? target.doc.title : null, newPerDay: newPerDay(profile) };
  },
});

/** Sets how many new cards a day this person starts (one of NEW_PER_DAY_OPTIONS). A note's own review isn't held to it. */
export const setNewPerDay = mutation({
  args: { value: v.number() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!(NEW_PER_DAY_OPTIONS as readonly number[]).includes(args.value)) fail("invalid_argument", "Pick one of the numbers offered.");
    await ctx.db.patch(profile._id, { studyNewPerDay: args.value });
    return null;
  },
});

/**
 * Rates a card (Again, Hard, Good, Easy) and schedules it with FSRS; the first review starts its schedule.
 * `lastReview` is the card's last review as the client saw it: a second submit of the same answer (a double
 * press, a retry) finds the card already moved on and changes nothing.
 */
export const review = mutation({
  args: { blockId: v.string(), rating: vRating, lastReview: v.union(v.number(), v.null()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const card = await ctx.db
      .query("studyCards")
      .withIndex("by_block", (q) => q.eq("blockId", args.blockId))
      .unique();
    const doc = card ? await ctx.db.get(card.documentId) : null;
    if (!card || !doc || doc.inTrash || !accessAtLeast(await documentAccess(ctx, profile, doc), "read")) fail("not_found", "This card isn't in a note you can open any more.");
    if (isSealed(doc)) failE2ee("e2ee_device_only");
    const existing = await ctx.db
      .query("studyReviews")
      .withIndex("by_block", (q) => q.eq("profileId", profile._id).eq("blockId", args.blockId))
      .unique();
    if (existing && (existing.lastReview ?? null) !== args.lastReview) return { due: existing.due, duplicate: true };
    const now = Date.now();
    const next = nextSchedule(existing, args.rating, now);
    if (existing) await ctx.db.patch(existing._id, next);
    else await ctx.db.insert("studyReviews", { profileId: profile._id, documentId: doc._id, blockId: args.blockId, ...next, firstReview: now });
    return { due: next.due, duplicate: false };
  },
});
