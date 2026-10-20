// Reviews (flashcards and quiz questions, scheduled with FSRS): what's due, new cards a day, rating a card
// and a second press of the same answer (convex/study.ts, lib/local/functions/study.ts).
import { SCHEMA_VERSION, type WireBlock } from "@folevi/editor-schema";
import { api } from "../../../convex/_generated/api";
import { para } from "../kit";
import { scenario } from "../types";

/** A toggle marked as a study card (or a quiz question). */
function card(id: string, question: string, rank: string, kind: "card" | "quiz" = "card"): WireBlock {
  return { id, type: "toggle", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: question }], props: { collapsed: true, study: kind } };
}

/** The person's day around now (an hour gone, the rest to come), as the client sends it. */
function day() {
  const now = Date.now();
  return { now, dayStart: now - 3_600_000, dayEnd: now + 23 * 3_600_000 };
}

async function refusal(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { data?: unknown }).data ?? String(e);
  }
}

export const scenarios = [
  scenario({
    name: "study: cards from toggles, a review, a repeated press, and new cards a day",
    async run(b, k) {
      const empty = await b.query(api.study.summary, { ...day() });
      const note = await k.newNote("note", { title: "French" });
      const c1 = k.id("c1");
      const c2 = k.id("c2");
      const q1 = k.id("q1");
      await k.upsert(note, [
        card(c1, "le chat", "a1"),
        para(k.id("a1"), "the cat", "a1", c1),
        para(k.id("a1b"), "a cat: un chat", "a2", c1),
        card(c2, "le chien", "a2"),
        para(k.id("a2"), "the dog", "a1", c2),
        card(q1, "Which article goes with maison?", "a3", "quiz"),
        para(k.id("a3"), "la", "a1", q1),
        // A toggle that isn't a card, and a paragraph.
        { id: k.id("plain"), type: "toggle", parentId: null, rank: "a4", schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: "Notes" }], props: { collapsed: false } },
        para(k.id("p"), "Practise every day", "a5"),
      ]);
      const summary = await b.query(api.study.summary, { ...day() });
      const queue = await b.query(api.study.queue, { ...day() });
      const forNote = await b.query(api.study.queue, { ...day(), documentId: note, limit: 2 });
      // Rate the first card Good: it's learning now, back later today.
      const first = await b.mutation(api.study.review, { blockId: c1, rating: "good", lastReview: null });
      // The same press again (a double click, a retry) changes nothing.
      const repeat = await b.mutation(api.study.review, { blockId: c1, rating: "good", lastReview: null });
      const afterReview = await b.query(api.study.queue, { ...day() });
      const again = await b.mutation(api.study.review, { blockId: c2, rating: "again", lastReview: null });
      // No new cards a day: only cards already started come back.
      await b.mutation(api.study.setNewPerDay, { value: 0 });
      const capped = await b.query(api.study.queue, { ...day() });
      const cappedNote = await b.query(api.study.summary, { ...day(), documentId: note });
      await b.mutation(api.study.setNewPerDay, { value: 10 });
      const ten = await b.query(api.study.summary, { ...day() });
      // A card unmarked stops being one; its note in Trash takes its cards out.
      const blocks = (await b.query(api.blocks.list, { documentId: note }))!.blocks;
      const quiz = blocks.find((x) => x.id === q1)!;
      await k.upsert(note, [{ ...quiz, props: { collapsed: true } }], quiz.revision ?? null);
      const unmarked = await b.query(api.study.summary, { ...day() });
      await b.mutation(api.documents.moveToTrash, { documentId: note });
      const trashed = await b.query(api.study.summary, { ...day() });
      const trashedNote = await b.query(api.study.queue, { ...day(), documentId: note });
      return {
        empty,
        summary,
        queue,
        forNote,
        first: { duplicate: first.duplicate },
        repeat: { duplicate: repeat.duplicate, sameDue: repeat.due === first.due },
        afterReview,
        again: { duplicate: again.duplicate },
        capped,
        cappedNote,
        ten,
        unmarked,
        trashed,
        trashedNote,
        notACard: await refusal(b.mutation(api.study.review, { blockId: k.id("nothing"), rating: "easy", lastReview: null })),
        inTrash: await refusal(b.mutation(api.study.review, { blockId: c2, rating: "easy", lastReview: null })),
        badPick: await refusal(b.mutation(api.study.setNewPerDay, { value: 7 })),
        badDay: await refusal(b.query(api.study.summary, { now: 1, dayStart: 10, dayEnd: 5 })),
      };
    },
  }),
];
