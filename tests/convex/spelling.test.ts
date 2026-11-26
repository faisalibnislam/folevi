// Spelling settings and the personal dictionary (convex/spelling.ts): one person's, on every device.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { person, setup } from "./helpers";

describe("spelling settings and the personal dictionary", () => {
  test("defaults until set; words added and taken back; each person has their own", async () => {
    const t = setup();
    const a = await person(t, "spell-a@example.com");
    const b = await person(t, "spell-b@example.com");
    expect(await a.as.query(api.spelling.get, {})).toEqual({ spellcheck: null, predictions: null, english: null, learnt: [], ignored: [], offNotes: [] });

    await a.as.mutation(api.spelling.setPrefs, { english: "en-GB", predictions: false });
    await a.as.mutation(api.spelling.setWord, { word: "Folevi", kind: "learnt", add: true });
    // Sending it again changes nothing.
    await a.as.mutation(api.spelling.setWord, { word: "Folevi", kind: "learnt", add: true });
    await a.as.mutation(api.spelling.setWord, { word: "lorem", kind: "ignored", add: true });
    expect(await a.as.query(api.spelling.get, {})).toEqual({ spellcheck: null, predictions: false, english: "en-GB", learnt: ["Folevi"], ignored: ["lorem"], offNotes: [] });
    // One note's spell check off, then on again.
    const note = "01J00000000000000000000000";
    await a.as.mutation(api.spelling.setNote, { documentId: note, on: false });
    expect((await a.as.query(api.spelling.get, {})).offNotes).toEqual([note]);
    await a.as.mutation(api.spelling.setNote, { documentId: note, on: true });
    expect((await a.as.query(api.spelling.get, {})).offNotes).toEqual([]);

    await a.as.mutation(api.spelling.setWord, { word: "lorem", kind: "ignored", add: false });
    await a.as.mutation(api.spelling.setPrefs, { spellcheck: false });
    expect(await a.as.query(api.spelling.get, {})).toMatchObject({ spellcheck: false, predictions: false, english: "en-GB", ignored: [] });
    expect((await b.as.query(api.spelling.get, {})).learnt).toEqual([]);
  });

  test("refuses what isn't a word", async () => {
    const t = setup();
    const a = await person(t, "spell-c@example.com");
    await expect(a.as.mutation(api.spelling.setWord, { word: "two words", kind: "learnt", add: true })).rejects.toThrow(/isn't a word/);
    await expect(a.as.mutation(api.spelling.setWord, { word: "x".repeat(65), kind: "learnt", add: true })).rejects.toThrow(/isn't a word/);
  });
});
