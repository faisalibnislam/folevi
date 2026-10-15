// The review queue (convex/study.ts): flashcards from every note a person can read, scheduled with FSRS.
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { rankSequence } from "@folevi/editor-schema";
import { NEW_PER_DAY } from "../../convex/lib/study";
import { inWorkspace, join, para, person, PERSONAL, setup, teamWorkspace, ulid, type ScopeArg, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

const DAY = 86_400_000;
/** The person's day, as the client sends it (UTC here). */
function day(now = Date.now()) {
  const dayStart = now - (now % DAY);
  return { now, dayStart, dayEnd: dayStart + DAY };
}

async function push(p: Person, scope: ScopeArg, ops: unknown[]) {
  return await p.as.mutation(api.sync.push, { scope, deviceId: "device-study", ops: ops as never });
}

/** A note with flashcards: each a toggle marked as a card, with its answer inside. */
async function noteWithCards(p: Person, scope: ScopeArg, title: string, cards: [string, string][], study: "card" | "quiz" | null = "card") {
  const docId = ulid();
  await push(p, scope, [{ opId: ulid(), kind: "document.create", document: { id: docId, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } }]);
  const ids: string[] = [];
  const ops: unknown[] = [];
  const ranks = rankSequence(cards.length);
  cards.forEach(([q, a], i) => {
    const toggle = { ...para(ulid(), q, ranks[i]), type: "toggle", props: { collapsed: true, ...(study ? { study } : {}) } };
    const answer = para(ulid(), a, "V", toggle.id);
    ids.push(toggle.id);
    ops.push({ opId: ulid(), kind: "block.upsert", documentId: docId, block: toggle, baseRevision: null, fields: ["content", "position"] });
    ops.push({ opId: ulid(), kind: "block.upsert", documentId: docId, block: answer, baseRevision: null, fields: ["content", "position"] });
  });
  await push(p, scope, ops);
  return { docId, ids };
}

const queue = (p: Person, extra: { scope?: ScopeArg; documentId?: string } = {}, w = day()) => p.as.query(api.study.queue, { ...extra, ...w });

describe("the review queue", () => {
  test("new cards from Personal and each workspace, with the question, the answer and the note", async () => {
    const t = setup();
    const a = await person(t, "study-a@example.com");
    const { workspaceId } = await teamWorkspace(a, "Class");
    await noteWithCards(a, PERSONAL, "Biology", [["What do cells divide by?", "Mitosis"]]);
    await noteWithCards(a, inWorkspace(workspaceId), "History", [["When did the war end?", "1945"]]);
    // A plain toggle (not marked as a card) isn't studied.
    await noteWithCards(a, PERSONAL, "Plain", [["Just a toggle", "Inside"]], null);

    const all = (await queue(a))!;
    expect(all.counts).toEqual({ due: 0, new: 2, later: 0 });
    expect(all.cards.map((c) => [c.front, c.back, c.documentTitle, c.isNew])).toEqual([
      ["What do cells divide by?", "Mitosis", "Biology", true],
      ["When did the war end?", "1945", "History", true],
    ]);
    expect(all.cards[0]!.intervals.again).toBeLessThan(all.cards[0]!.intervals.easy);

    const personal = (await queue(a, { scope: PERSONAL }))!;
    expect(personal.cards.map((c) => c.front)).toEqual(["What do cells divide by?"]);
    const team = (await queue(a, { scope: inWorkspace(workspaceId) }))!;
    expect(team.cards.map((c) => c.front)).toEqual(["When did the war end?"]);
  });

  test("rating a card schedules it: it leaves the queue, comes back when due, and Good after Good waits longer", async () => {
    const t = setup();
    const a = await person(t, "study-sched@example.com");
    const { ids } = await noteWithCards(a, PERSONAL, "Chemistry", [["H2O is?", "Water"]]);
    const before = Date.now();
    const first = await a.as.mutation(api.study.review, { blockId: ids[0]!, rating: "easy", lastReview: null });
    expect(first.duplicate).toBe(false);
    // Easy on a new card skips the learning steps: days away.
    expect(first.due - before).toBeGreaterThan(DAY / 2);
    expect((await queue(a))!.counts).toEqual({ due: 0, new: 0, later: 0 });

    // When it falls due, it's back with its schedule (not new).
    const later = day(first.due + 1000);
    const back = (await queue(a, {}, later))!;
    expect(back.counts.due).toBe(1);
    expect(back.cards[0]).toMatchObject({ front: "H2O is?", isNew: false });
    const row = await t.run(async (ctx) => (await ctx.db.query("studyReviews").collect())[0]!);
    expect(back.cards[0]!.lastReview).toBe(row.lastReview);
    expect(row).toMatchObject({ reps: 1, lapses: 0 });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(first.due + 1000);
      const second = await a.as.mutation(api.study.review, { blockId: ids[0]!, rating: "good", lastReview: back.cards[0]!.lastReview });
      const firstGap = first.due - before;
      expect(second.due - (first.due + 1000)).toBeGreaterThan(firstGap);
      const after = await t.run(async (ctx) => (await ctx.db.query("studyReviews").collect())[0]!);
      expect(after.reps).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("Again keeps a card in today's learning: it's due again later today", async () => {
    const t = setup();
    const a = await person(t, "study-again@example.com");
    const { ids } = await noteWithCards(a, PERSONAL, "Words", [["Hola", "Hello"]]);
    const w = day();
    const res = await a.as.mutation(api.study.review, { blockId: ids[0]!, rating: "again", lastReview: null });
    expect(res.due - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    const q = (await queue(a, {}, { ...w, now: Date.now(), dayEnd: Math.max(w.dayEnd, res.due + 1) }))!;
    expect(q.counts).toEqual({ due: 0, new: 0, later: 1 });
  });

  test("a second submit of the same answer changes nothing", async () => {
    const t = setup();
    const a = await person(t, "study-twice@example.com");
    const { ids } = await noteWithCards(a, PERSONAL, "Maths", [["2 + 2", "4"]]);
    const one = await a.as.mutation(api.study.review, { blockId: ids[0]!, rating: "good", lastReview: null });
    const two = await a.as.mutation(api.study.review, { blockId: ids[0]!, rating: "good", lastReview: null });
    expect(two).toEqual({ due: one.due, duplicate: true });
    const rows = await t.run(async (ctx) => await ctx.db.query("studyReviews").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reps).toBe(1);
    // A stale last review (an older copy of the card) is a duplicate too.
    const three = await a.as.mutation(api.study.review, { blockId: ids[0]!, rating: "again", lastReview: rows[0]!.lastReview! - 5 });
    expect(three.duplicate).toBe(true);
  });

  test(`at most ${NEW_PER_DAY} new cards a day; the rest wait for tomorrow, and a note's own review isn't capped`, async () => {
    const t = setup();
    const a = await person(t, "study-cap@example.com");
    const cards = Array.from({ length: NEW_PER_DAY + 5 }, (_, i): [string, string] => [`Question ${i}`, `Answer ${i}`]);
    const { docId, ids } = await noteWithCards(a, PERSONAL, "Deck", cards);
    expect((await queue(a))!.counts.new).toBe(NEW_PER_DAY);
    for (const id of ids.slice(0, 3)) await a.as.mutation(api.study.review, { blockId: id, rating: "easy", lastReview: null });
    expect((await queue(a))!.counts.new).toBe(NEW_PER_DAY - 3);
    // Tomorrow, a fresh allowance.
    expect((await queue(a, {}, day(Date.now() + DAY)))!.counts.new).toBe(NEW_PER_DAY);
    // The note's own review offers every card it has left, and says how many cards it has.
    const note = (await queue(a, { documentId: docId }))!;
    expect(note.counts.new).toBe(cards.length - 3);
    expect(note.total).toBe(cards.length);
    expect(note.documentTitle).toBe("Deck");
    const summary = await a.as.query(api.study.summary, { documentId: docId, ...day() });
    expect(summary).toMatchObject({ total: cards.length, new: cards.length - 3, hasCards: true });
  });

  test("new cards a day is the person's own pick: fewer, none, or more; only the numbers offered", async () => {
    const t = setup();
    const a = await person(t, "study-pick@example.com");
    const b = await person(t, "study-pick-other@example.com");
    const cards = Array.from({ length: 35 }, (_, i): [string, string] => [`Question ${i}`, `Answer ${i}`]);
    const { docId, ids } = await noteWithCards(a, PERSONAL, "Deck", cards);
    expect((await queue(a))!).toMatchObject({ newPerDay: NEW_PER_DAY, counts: { new: NEW_PER_DAY } });

    await a.as.mutation(api.study.setNewPerDay, { value: 10 });
    expect((await queue(a))!).toMatchObject({ newPerDay: 10, counts: { new: 10 } });
    for (const id of ids.slice(0, 4)) await a.as.mutation(api.study.review, { blockId: id, rating: "good", lastReview: null });
    expect((await queue(a))!.counts.new).toBe(6);
    // More than the default: started cards today still count.
    await a.as.mutation(api.study.setNewPerDay, { value: 30 });
    expect((await queue(a))!.counts.new).toBe(26);
    // None: only cards already due; a note's own review still offers its new cards.
    await a.as.mutation(api.study.setNewPerDay, { value: 0 });
    expect((await queue(a))!.counts.new).toBe(0);
    expect((await queue(a, { documentId: docId }))!.counts.new).toBe(cards.length - 4);

    await expect(a.as.mutation(api.study.setNewPerDay, { value: 25 })).rejects.toThrow(/numbers offered/);
    // Someone else keeps the default.
    expect((await queue(b))!.newPerDay).toBe(NEW_PER_DAY);
  });

  test("cards drop out when their note goes to Trash, the toggle is unmarked or deleted, or access is lost", async () => {
    const t = setup();
    const owner = await person(t, "study-owner@example.com");
    const member = await person(t, "study-member@example.com");
    const { workspaceId } = await teamWorkspace(owner, "Lab");
    await join(t, owner, member, "study-member@example.com", workspaceId, "editor");
    const ws = inWorkspace(workspaceId);
    const shared = await noteWithCards(owner, ws, "Shared deck", [["Q1", "A1"]]);
    const trashed = await noteWithCards(owner, ws, "Old deck", [["Q2", "A2"]]);
    const edited = await noteWithCards(owner, ws, "Edited deck", [["Q3", "A3"], ["Q4", "A4"]]);
    expect((await queue(member))!.counts.new).toBe(4);

    // Each reader has their own schedule.
    await member.as.mutation(api.study.review, { blockId: shared.ids[0]!, rating: "easy", lastReview: null });
    expect((await queue(owner))!.counts.new).toBe(4);
    expect((await queue(member))!.counts.new).toBe(3);

    await owner.as.mutation(api.documents.moveToTrash, { documentId: trashed.docId });
    expect((await queue(member))!.cards.map((c) => c.front)).toEqual(["Q3", "Q4"]);

    // Unmarking one toggle and deleting the other.
    const blocks = (await owner.as.query(api.blocks.list, { documentId: edited.docId }))!.blocks;
    const q3 = blocks.find((b) => b.id === edited.ids[0])!;
    const q4 = blocks.find((b) => b.id === edited.ids[1])!;
    const q4answer = blocks.find((b) => b.parentId === q4.id)!;
    await push(owner, ws, [
      { opId: ulid(), kind: "block.upsert", documentId: edited.docId, block: { ...q3, props: { collapsed: true } }, baseRevision: q3.revision, fields: ["content"] },
      { opId: ulid(), kind: "block.delete", documentId: edited.docId, blockId: q4answer.id, baseRevision: q4answer.revision },
      { opId: ulid(), kind: "block.delete", documentId: edited.docId, blockId: q4.id, baseRevision: q4.revision },
    ]);
    expect((await queue(member))!.counts.new).toBe(0);
    expect(await t.run(async (ctx) => (await ctx.db.query("studyCards").collect()).length)).toBe(2);

    // The reviewed card, due later: gone for the member once the note is restricted, though the owner keeps it.
    const due = day(Date.now() + 40 * DAY);
    expect((await queue(member, {}, due))!.counts.due).toBe(1);
    await owner.as.mutation(api.sharing.setAccessMode, { documentId: shared.docId, mode: "restricted" });
    expect((await queue(member, {}, due))!.counts.due).toBe(0);
    await expect(member.as.mutation(api.study.review, { blockId: shared.ids[0]!, rating: "good", lastReview: null })).rejects.toThrow(/isn't in a note you can open/);
    await owner.as.mutation(api.sharing.setAccessMode, { documentId: shared.docId, mode: "workspace" });
    expect((await queue(member, {}, due))!.counts.due).toBe(1);
    // Leaving the workspace takes its cards with it.
    await owner.as.mutation(api.workspaces.removeMember, { workspaceId, profileId: member.profileId });
    expect((await queue(member, {}, due))!.counts).toEqual({ due: 0, new: 0, later: 0 });
    await expect(queue(member, { scope: ws })).rejects.toThrow();
  });

  test("purging a note removes its cards and everyone's schedules", async () => {
    const t = setup();
    const a = await person(t, "study-purge@example.com");
    const { docId, ids } = await noteWithCards(a, PERSONAL, "Gone", [["Q", "A"]]);
    await a.as.mutation(api.study.review, { blockId: ids[0]!, rating: "good", lastReview: null });
    await a.as.mutation(api.documents.moveToTrash, { documentId: docId });
    await a.as.mutation(api.documents.deletePermanently, { documentId: docId, confirmTitle: "Gone" });
    await drain(t);
    const left = await t.run(async (ctx) => [(await ctx.db.query("studyCards").collect()).length, (await ctx.db.query("studyReviews").collect()).length]);
    expect(left).toEqual([0, 0]);
  });

  test("the backfill lists cards made before the queue existed", async () => {
    const t = setup();
    const a = await person(t, "study-backfill@example.com");
    await noteWithCards(a, PERSONAL, "Before", [["Q", "A"]], "quiz");
    await t.run(async (ctx) => {
      for (const c of await ctx.db.query("studyCards").collect()) await ctx.db.delete(c._id);
    });
    expect((await queue(a))!.counts.new).toBe(0);
    await t.mutation(internal.migrations.backfillStudyCards, {});
    const q = (await queue(a))!;
    expect(q.cards.map((c) => [c.front, c.kind])).toEqual([["Q", "quiz"]]);
  });

  test("an invalid day is refused, and a note you can't read has no queue", async () => {
    const t = setup();
    const a = await person(t, "study-args@example.com");
    const b = await person(t, "study-other@example.com");
    const { docId } = await noteWithCards(a, PERSONAL, "Mine", [["Q", "A"]]);
    await expect(a.as.query(api.study.queue, { now: 1, dayStart: 10, dayEnd: 5 })).rejects.toThrow(/Invalid day/);
    expect(await queue(b, { documentId: docId })).toBeNull();
  });
});

/** Runs the scheduled purge to the end. */
async function drain(t: T) {
  vi.useFakeTimers();
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
}
