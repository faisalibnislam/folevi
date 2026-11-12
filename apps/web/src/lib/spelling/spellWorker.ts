// The website's spelling checker, off the page's own thread (lib/spelling/web.ts talks to it): building
// the dictionary takes a moment and a hard guess can too, and neither may hold up typing.
import { createSpellChecker, type SpellChecker } from "./spellCore";

export interface SpellRequest {
  id: number;
  /** Where the dictionary's two files are ("/spelling/en-US"). */
  base: string;
  /** One word, for its guesses (the right-click menu). */
  word: string;
  /** Many words at once, only to hear which are misspelt (the underlines in the note). */
  words?: string[];
  /** Words the person taught this browser, or told it to leave alone. */
  learnt?: string[];
}
export interface SpellAnswer {
  id: number;
  misspelled: boolean;
  guesses: string[];
  /** For `words`: the misspelt ones. */
  wrong?: string[];
}

const checkers = new Map<string, Promise<SpellChecker>>();

function checkerFor(base: string): Promise<SpellChecker> {
  let made = checkers.get(base);
  if (!made) {
    const text = (ext: string) =>
      fetch(`${base}.${ext}`).then((r) => {
        if (!r.ok) throw new Error(`no dictionary at ${base}.${ext}`);
        return r.text();
      });
    made = Promise.all([text("aff"), text("dic")]).then(([aff, dic]) => createSpellChecker(aff, dic));
    // A failed load is tried again on the next question.
    made.catch(() => checkers.delete(base));
    checkers.set(base, made);
  }
  return made;
}

self.onmessage = (e: MessageEvent<SpellRequest>) => {
  const { id, base, word, words, learnt } = e.data;
  void checkerFor(base)
    .then((checker) => {
      for (const w of learnt ?? []) checker.add(w);
      if (words) {
        const answer: SpellAnswer = { id, misspelled: false, guesses: [], wrong: words.filter((w) => !checker.correct(w)) };
        self.postMessage(answer);
        return;
      }
      // An empty word only warms the dictionary up.
      const misspelled = word ? !checker.correct(word) : false;
      const answer: SpellAnswer = { id, misspelled, guesses: misspelled ? checker.suggest(word, 5) : [] };
      self.postMessage(answer);
    })
    .catch(() => self.postMessage({ id, misspelled: false, guesses: [] } satisfies SpellAnswer));
};
