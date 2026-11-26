// Folevi's own spelling (lib/spelling/spellCore.ts on Hunspell, hunspell.ts) against the dictionaries it ships
// with (public/spelling), in every language it checks.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { createHunspell, loadHunspellModule } from "@/lib/spelling/hunspell";
import { LANGUAGES, type SpellLanguage } from "@/lib/spelling/languages";
import { createSpellChecker, type SpellChecker } from "@/lib/spelling/spellCore";

const file = (name: string) => readFileSync(join(process.cwd(), "public/spelling", name), "utf8");
const checkers = new Map<SpellLanguage, SpellChecker>();
const load = async (lang: SpellLanguage) => {
  const m = await loadHunspellModule(readFileSync(join(process.cwd(), "public/spelling/hunspell.wasm")));
  const d = LANGUAGES[lang].dictionary!;
  const c = createSpellChecker(createHunspell(m, file(`${d}.aff`), file(`${d}.dic`)));
  checkers.set(lang, c);
  return c;
};
let us: SpellChecker;
let gb: SpellChecker;
beforeAll(async () => {
  us = await load("en-US");
  gb = await load("en-GB");
});

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
    ];
    for (const [typed, want] of meant) expect(us.suggest(typed, 5), typed).toContain(want);
  });

  test("a split into a lone letter isn't the first guess", () => {
    expect(us.suggest("Teh")[0]).toBe("The");
    expect(us.suggest("teh")[0]).toBe("the");
  });

  test("guesses keep the capitals that were typed", () => {
    expect(us.suggest("Recieve")).toContain("Receive");
    expect(us.suggest("Teh")).toContain("The");
  });

  test("a right word has no guesses; an added word is right until it is taken back", () => {
    expect(us.suggest("hello")).toEqual([]);
    expect(us.correct("Folevi")).toBe(false);
    us.add("Folevi");
    expect(us.correct("Folevi")).toBe(true);
    us.remove("Folevi");
    expect(us.correct("Folevi")).toBe(false);
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

describe("every language Folevi checks", () => {
  // A right word, a misspelling, and the word meant.
  const cases: [SpellLanguage, string[], string, string][] = [
    ["es", ["casa", "hablaríamos", "corazón"], "cassa", "casa"],
    ["fr", ["maison", "mangeaient", "l'homme"], "maisonn", "maison"],
    ["de", ["Haus", "Häuser", "gegangen", "Donaudampfschiff"], "Hasu", "Haus"],
    ["pt", ["casa", "coração", "falávamos"], "coracao", "coração"],
    ["id", ["rumah", "makanan", "berjalan"], "rumha", "rumah"],
    ["hi", ["भारत", "किताब", "किताबें"], "किताबब", "किताब"],
    ["bn", ["বাংলা", "আমি", "বই"], "আমমি", "আমি"],
    ["ar", ["كتاب", "مكتبة", "والكتاب", "يكتبون"], "كتابب", "كتاب"],
  ];
  for (const [lang, right, wrong, meant] of cases) {
    test(`${LANGUAGES[lang].name}: loads in time, knows its words, finds the one meant`, async () => {
      const start = performance.now();
      const c = await load(lang);
      expect(performance.now() - start).toBeLessThan(5000);
      for (const w of right) expect(c.correct(w), w).toBe(true);
      expect(c.correct(wrong), wrong).toBe(false);
      expect(c.suggest(wrong, 5), wrong).toContain(meant);
    });
  }

  test("Chinese has no dictionary: prediction only", () => {
    expect(LANGUAGES.zh.dictionary).toBeNull();
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
