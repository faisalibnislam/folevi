// The website's own spelling checker (lib/spelling/spellCore.ts) against the English lists it ships with.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createSpellChecker } from "@/lib/spelling/spellCore";

const file = (name: string) => readFileSync(join(process.cwd(), "public/spelling", name), "utf8");
const us = createSpellChecker(file("en-US.aff"), file("en-US.dic"));
const gb = createSpellChecker(file("en-GB.aff"), file("en-GB.dic"));

describe("spelling", () => {
  test("right words are right, in the forms the dictionary builds", () => {
    for (const w of ["hello", "Hello", "notes", "writing", "happiness", "unhappy", "tried", "boxes", "children", "it's", "don't", "Monday", "well-known", "re-read"]) expect(us.correct(w), w).toBe(true);
  });

  test("misspelt words are wrong", () => {
    for (const w of ["teh", "recieve", "accomodate", "definately", "wierd", "occurence", "mispelled", "monday", "helo"]) expect(us.correct(w), w).toBe(false);
  });

  test("numbers, single letters and ALL CAPS are never flagged; curly apostrophes count as straight ones", () => {
    for (const w of ["2024", "v2", "x", "NASA", "FOLEVI", "don’t"]) expect(us.correct(w), w).toBe(true);
  });

  test("the guess that was meant is among the first", () => {
    const meant: [string, string][] = [
      ["teh", "the"],
      ["recieve", "receive"],
      ["accomodate", "accommodate"],
      ["definately", "definitely"],
      ["wierd", "weird"],
      ["occurence", "occurrence"],
      ["mispelled", "misspelled"],
      ["helo", "hello"],
      ["monday", "Monday"],
      ["alot", "a lot"],
      ["thankyou", "thank you"],
    ];
    for (const [typed, want] of meant) expect(us.suggest(typed, 5), typed).toContain(want);
  });

  test("guesses keep the capitals that were typed", () => {
    expect(us.suggest("Recieve")).toContain("Receive");
    expect(us.suggest("Teh")).toContain("The");
  });

  test("a right word has no guesses, and a learnt word is right from then on", () => {
    expect(us.suggest("hello")).toEqual([]);
    expect(us.correct("Folevi")).toBe(false);
    us.add("Folevi");
    expect(us.correct("Folevi")).toBe(true);
  });

  test("British and American spellings each have their dictionary", () => {
    expect(gb.correct("colour")).toBe(true);
    expect(gb.correct("organise")).toBe(true);
    expect(us.correct("color")).toBe(true);
    expect(us.correct("colour")).toBe(false);
    expect(us.suggest("colour")).toContain("color");
  });

  test("a guess comes back quickly, even for a long word", () => {
    const start = performance.now();
    us.suggest("internashionalization");
    us.suggest("xqzvkjw");
    expect(performance.now() - start).toBeLessThan(1500);
  });
});

describe("the words of a note that spelling applies to", () => {
  test("ordinary words, with where they are; not code, links, names in capitals, numbers or addresses", async () => {
    const { Editor } = await import("@tiptap/core");
    const { ALL_MARKS, ALL_NODES } = await import("@/components/editor/extensions");
    const { spellableWords } = await import("@/components/editor/spellcheck");
    const e = new Editor({
      extensions: [...ALL_NODES, ...ALL_MARKS],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { depth: 0 }, content: [{ type: "text", text: "Teh quick iPhone NASA v2 mail@example.com notes.txt #tag don’t well-known " }, { type: "text", text: "codee", marks: [{ type: "code" }] }, { type: "text", text: " " }, { type: "text", text: "linkk", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }] },
          { type: "codeBlock", attrs: { depth: 0, language: "plaintext" }, content: [{ type: "text", text: "cnst x" }] },
          { type: "heading", attrs: { depth: 0, level: 2 }, content: [{ type: "text", text: "Plann" }] },
        ],
      },
    });
    const found = spellableWords(e.state.doc);
    expect(found.map((w) => w.word)).toEqual(["Teh", "quick", "don’t", "well-known", "Plann"]);
    for (const w of found) expect(e.state.doc.textBetween(w.from, w.to)).toBe(w.word);
    e.destroy();
  });
});
