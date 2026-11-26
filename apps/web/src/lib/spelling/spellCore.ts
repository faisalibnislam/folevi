// Is this word spelt right, and if not, what was meant: Folevi's own spelling, the same in every app
// (docs/SPELLING_PLAN.md). Hunspell (hunspell.ts) does the dictionary work; this file adds what a notes app
// needs around it: numbers, single letters and ALL CAPS are never judged, curly apostrophes count as straight
// ones, "well-known" is right when each part is, and the person's own words (Add to dictionary) are right too.
//
// Kept free of the browser so it can be tested, and run in a worker (spellWorker.ts).
import type { Hunspell } from "./hunspell";

export interface SpellChecker {
  /** Whether `word` is spelt right (words with digits, single letters and ALL CAPS always are). */
  correct(word: string): boolean;
  /** Up to `limit` guesses for a misspelt word, the likeliest first, in the word's own capitals. */
  suggest(word: string, limit?: number): string[];
  /** Accepts `word` from now on (this checker only). */
  add(word: string): void;
  /** Takes back a word `add` accepted. */
  remove(word: string): void;
}

/** Straight apostrophes for curly ones (dictionaries list "don't"). */
export const foldApostrophes = (word: string) => word.replace(/[‘’]/g, "'");

/**
 * How far a guess is from what was typed, counting the slips people really make as half a slip: two letters
 * swapped ("teh"), a double letter typed once or twice too often ("accomodate"). Hunspell's own order is kept
 * between guesses equally far.
 */
export function slipDistance(a: string, b: string): number {
  const x = [...a.toLowerCase()];
  const y = [...b.toLowerCase()];
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const same = x[i - 1] === y[j - 1];
      const del = x[i - 1] === x[i - 2] || x[i - 1] === x[i] ? 0.5 : 1;
      const ins = y[j - 1] === y[j - 2] || y[j - 1] === y[j] ? 0.5 : 1;
      let v = Math.min(d[i - 1]![j]! + del, d[i]![j - 1]! + ins, d[i - 1]![j - 1]! + (same ? 0 : 1));
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 0.5);
      d[i]![j] = v;
    }
  }
  return d[x.length]![y.length]!;
}

export function createSpellChecker(h: Hunspell): SpellChecker {
  const added = new Set<string>();
  const right = (w: string): boolean => {
    if (!w || [...w].length === 1 || /\p{N}/u.test(w)) return true;
    if (added.has(w) || added.has(w.toLowerCase())) return true;
    // ALL CAPS is an abbreviation or a heading: not the checker's to judge.
    if (w === w.toUpperCase() && w !== w.toLowerCase()) return true;
    return h.spell(w);
  };
  const correct = (word: string): boolean => {
    const w = foldApostrophes(word).replace(/^'+|'+$/g, "");
    if (right(w)) return true;
    // "well-known": right when each part is.
    return w.includes("-") && w.split("-").every((part) => right(part));
  };
  const suggest = (word: string, limit = 5): string[] => {
    const typed = foldApostrophes(word);
    if (!typed || typed.length > 60 || correct(typed)) return [];
    const guesses = [...new Set(h.suggest(typed))].filter((g) => g !== typed);
    // Two words for one ("a lot"): the letters as typed, plus the missing space as a slip of its own, and one
    // more when a part is a lone letter that is no word on its own ("T eh" is rarely what "Teh" meant; "a lot",
    // "y", "à" and "o" are words).
    const lone = (part: string) => [...part].length === 1 && !/^[aeiouyàAEIOUYÀ]$/u.test(part);
    const split = (g: string) => (g.includes(" ") ? 1 + (g.split(" ").some(lone) ? 1 : 0) : 0);
    const far = new Map(guesses.map((g) => [g, slipDistance(typed, g.replace(/ /g, "")) + split(g)]));
    return guesses
      .map((g, i) => [g, i] as const)
      .sort((a, b) => far.get(a[0])! - far.get(b[0])! || a[1] - b[1])
      .slice(0, limit)
      .map(([g]) => g);
  };
  return {
    correct,
    suggest,
    add: (word) => {
      const w = foldApostrophes(word);
      added.add(w);
      h.add(w);
    },
    remove: (word) => {
      const w = foldApostrophes(word);
      added.delete(w);
      h.remove(w);
    },
  };
}
