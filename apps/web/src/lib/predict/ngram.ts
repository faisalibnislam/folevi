// Next-word prediction that learns from the person's own notes, on their device (docs/SPELLING_PLAN.md): what
// they tend to write after the two words before the caret (a trigram), or after the last one (a bigram), or,
// mid-word, the word they usually finish it as. Nothing leaves the device, and nothing is predicted until it
// has been seen at least twice, so a ghost word is something this person really writes.
//
// Each sentence is learnt once (its hash is remembered), so opening a note again doesn't count it twice. Kept
// free of the browser: the spelling worker runs it (lib/spelling/spellWorker.ts) and stores it in IndexedDB.

export interface Prediction {
  /** The whole word predicted, as it is usually written. */
  word: string;
  /** What to insert at the caret: the rest of the word being typed, or a space and the next word. */
  insert: string;
}

export interface NgramSnapshot {
  v: 1;
  uni: [string, number][];
  bi: [string, [string, number][]][];
  tri: [string, [string, number][]][];
  forms: [string, string][];
  seen: number[];
}

const START = "\u0002";
/** Sentences remembered as learnt, at most (the oldest are forgotten first). */
const MAX_SEEN = 60_000;
/** Pairs and triples kept before the ones seen once are dropped. */
const MAX_PAIRS = 250_000;

/** Words in `text`, with sentence starts marked. `segment` splits a language without spaces (Chinese). */
export function tokenize(text: string, segment?: (s: string) => string[]): string[][] {
  const sentences = text.split(/(?<=[.!?])\s+|(?<=[。！？])|\n+/u);
  const out: string[][] = [];
  for (const s of sentences) {
    const words = segment ? segment(s) : (s.match(/[\p{L}\p{M}][\p{L}\p{M}\p{N}'’-]*/gu) ?? []);
    if (words.length) out.push(words.map((w) => w.replace(/[’]/g, "'")));
  }
  return out;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function bump<K>(m: Map<K, number>, k: K, by = 1) {
  m.set(k, (m.get(k) ?? 0) + by);
}

function best(m: Map<string, number> | undefined, min: number, fits?: (w: string) => boolean): [string, number] | null {
  if (!m) return null;
  let top: [string, number] | null = null;
  let total = 0;
  for (const [w, n] of m) {
    if (fits && !fits(w)) continue;
    total += n;
    if (!top || n > top[1]) top = [w, n];
  }
  // Seen enough, and clearly the usual choice (not one of many).
  if (!top || top[1] < min || top[1] / total < 0.2) return null;
  return top;
}

export class NgramModel {
  private uni = new Map<string, number>();
  private bi = new Map<string, Map<string, number>>();
  private tri = new Map<string, Map<string, number>>();
  /** How a word is written when it isn't all small letters ("Paris", "I"). */
  private forms = new Map<string, string>();
  private seen = new Set<number>();
  private pairs = 0;
  /** Whether anything was learnt since the last snapshot. */
  dirty = false;

  constructor(private readonly spaced = true) {}

  /** Learns every sentence of `text` not learnt before. */
  learn(text: string, segment?: (s: string) => string[]) {
    for (const words of tokenize(text, segment)) {
      if (words.length < 2) continue;
      const h = hash(words.join(" "));
      if (this.seen.has(h)) continue;
      this.seen.add(h);
      if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.values().next().value!);
      this.dirty = true;
      const keys = words.map((w) => w.toLowerCase());
      words.forEach((w, i) => {
        // A capital that isn't only the sentence's start is part of how the word is written.
        if (w !== keys[i] && (i > 0 || w === "I")) this.forms.set(keys[i]!, w);
      });
      let prev2 = START;
      let prev = START;
      for (const k of keys) {
        bump(this.uni, k);
        this.add(this.bi, prev, k);
        this.add(this.tri, `${prev2} ${prev}`, k);
        prev2 = prev;
        prev = k;
      }
    }
    if (this.pairs > MAX_PAIRS) this.prune();
  }

  private add(m: Map<string, Map<string, number>>, key: string, next: string) {
    let inner = m.get(key);
    if (!inner) m.set(key, (inner = new Map()));
    if (!inner.has(next)) this.pairs++;
    bump(inner, next);
  }

  private prune() {
    this.pairs = 0;
    for (const m of [this.bi, this.tri]) {
      for (const [k, inner] of m) {
        for (const [w, n] of inner) if (n < 2) inner.delete(w);
        if (!inner.size) m.delete(k);
        else this.pairs += inner.size;
      }
    }
    for (const [w, n] of this.uni) if (n < 2) this.uni.delete(w);
  }

  private shape(key: string, sentenceStart: boolean): string {
    const form = this.forms.get(key) ?? key;
    return sentenceStart ? form.charAt(0).toUpperCase() + form.slice(1) : form;
  }

  /**
   * The word to show after `before` (the text before the caret in its line), or null. When `before` ends in
   * a letter the last word is still being typed and is finished; after a space, the next word is guessed;
   * right after a whole word, the next word comes with a space.
   */
  predict(before: string, segment?: (s: string) => string[]): Prediction | null {
    // Right after punctuation ("Done." "Well,"): nothing until a space.
    if (this.spaced && /[^\s\p{L}\p{M}\p{N}'’-]$/u.test(before)) return null;
    const sentences = tokenize(before.slice(-300), segment);
    const tail = /[.!?。！？]\s*$/u.test(before) || !before.trim() ? [] : (sentences.at(-1) ?? []);
    const partial = this.spaced && /[\p{L}\p{M}\p{N}'’-]$/u.test(before) ? (tail.at(-1) ?? "") : "";
    const context = (partial ? tail.slice(0, -1) : tail).map((w) => w.toLowerCase());
    const prev = context.at(-1) ?? START;
    const prev2 = context.at(-2) ?? (context.length ? START : START);
    const sentenceStart = context.length === 0;
    if (partial) {
      const low = partial.toLowerCase();
      const fits = (w: string) => w.length > low.length && w.startsWith(low);
      const hit =
        best(this.tri.get(`${prev2} ${prev}`), 1, fits) ?? best(this.bi.get(prev), 1, fits) ?? best(this.uni, 3, fits);
      if (hit) {
        const word = this.shape(hit[0], sentenceStart && partial[0] !== low[0]);
        // Keep what was typed; only the rest is inserted.
        const rest = word.slice(partial.length);
        if (rest) return { word, insert: rest };
      }
      // A whole word already: the next one, after a space.
      if (!this.uni.has(low)) return null;
      return this.next([...context, low], false, true);
    }
    return this.next(context, sentenceStart, false);
  }

  private next(context: string[], sentenceStart: boolean, space: boolean): Prediction | null {
    const prev = context.at(-1) ?? START;
    const prev2 = context.at(-2) ?? START;
    const hit = best(this.tri.get(`${prev2} ${prev}`), 2) ?? best(this.bi.get(prev), 2);
    if (!hit) return null;
    const word = this.shape(hit[0], sentenceStart);
    return { word, insert: (space && this.spaced ? " " : "") + word };
  }

  snapshot(): NgramSnapshot {
    const nest = (m: Map<string, Map<string, number>>) => [...m].map(([k, v]) => [k, [...v]] as [string, [string, number][]]);
    return { v: 1, uni: [...this.uni], bi: nest(this.bi), tri: nest(this.tri), forms: [...this.forms], seen: [...this.seen] };
  }

  static restore(s: NgramSnapshot | null | undefined, spaced = true): NgramModel {
    const m = new NgramModel(spaced);
    if (!s || s.v !== 1) return m;
    m.uni = new Map(s.uni);
    const nest = (rows: [string, [string, number][]][]) => new Map(rows.map(([k, v]) => [k, new Map(v)]));
    m.bi = nest(s.bi);
    m.tri = nest(s.tri);
    m.forms = new Map(s.forms);
    m.seen = new Set(s.seen);
    for (const inner of [...m.bi.values(), ...m.tri.values()]) m.pairs += inner.size;
    return m;
  }
}
