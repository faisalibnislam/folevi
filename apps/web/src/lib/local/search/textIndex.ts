// A small full-text index in the style of MiniSearch: an inverted index over a few fields per entry, prefix
// matching on every query term, BM25 ranking, updated one entry at a time, and a snapshot that can be stored
// and loaded again (index.ts keeps it in the library's device-private storage). Local search
// (functions/search.ts) uses one for notes (title and text) and one for the text found in their files.
//
// Words are what `tokenize` makes of a text: normalized like the server's search (normalizeForSearch: case,
// accents and quotes folded), split at anything that isn't a letter or a digit. A query term matches a word
// that is the term or starts with it; a whole word scores higher than a word it's only the start of.
import { normalizeForSearch } from "@folevi/editor-schema";

/** Words longer than this are cut (nobody types them; they'd only grow the index). */
const MAX_WORD = 48;
/** Query terms read at most (the server's search reads 16). */
const MAX_TERMS = 16;
/** A word the term only starts ("gard" in "garden") counts this much of a whole-word match. */
const PREFIX_WEIGHT = 0.6;
const K1 = 1.2;
const B = 0.75;

/** The words of a text, in order (repeats kept: they're the term frequencies). */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const raw of normalizeForSearch(text).split(/[^\p{L}\p{N}]+/u)) {
    if (raw) out.push(raw.length > MAX_WORD ? raw.slice(0, MAX_WORD) : raw);
  }
  return out;
}

/** A query's terms: its words, each once, at most MAX_TERMS. */
export function queryTerms(query: string): string[] {
  return [...new Set(tokenize(query))].slice(0, MAX_TERMS);
}

interface Entry {
  stamp: string;
  /** Words per field (a field's length is its word count). */
  lengths: number[];
  /** Each word's count per field. */
  words: Map<string, number[]>;
}

/** What `snapshot()` gives and `restore()` takes: plain data (structured-cloneable, JSON-safe). */
export interface TextIndexSnapshot {
  v: 1;
  fields: string[];
  /** [id, stamp, field lengths, [word, counts per field][]] */
  entries: [string, string, number[], [string, number[]][]][];
}

export class TextIndex<F extends string> {
  private entries = new Map<string, Entry>();
  /** word → entry id → counts per field. */
  private postings = new Map<string, Map<string, number[]>>();
  /** Every word in the index, sorted (prefix lookups walk it from the term's place). */
  private vocabulary: string[] = [];
  private totals: number[];

  constructor(readonly fields: readonly F[]) {
    this.totals = fields.map(() => 0);
  }

  get size(): number {
    return this.entries.size;
  }

  ids(): IterableIterator<string> {
    return this.entries.keys();
  }

  /** What the entry was indexed from (the caller's stamp), or undefined when it isn't in the index. */
  stampOf(id: string): string | undefined {
    return this.entries.get(id)?.stamp;
  }

  /** Indexes an entry (replacing what it was). */
  set(id: string, stamp: string, texts: Record<F, string>): void {
    const words = new Map<string, number[]>();
    const lengths = this.fields.map((field, i) => {
      const tokens = tokenize(texts[field] ?? "");
      for (const w of tokens) {
        let counts = words.get(w);
        if (!counts) words.set(w, (counts = this.fields.map(() => 0)));
        counts[i]!++;
      }
      return tokens.length;
    });
    this.put(id, { stamp, lengths, words });
  }

  private put(id: string, entry: Entry): void {
    this.remove(id);
    this.entries.set(id, entry);
    entry.lengths.forEach((n, i) => (this.totals[i]! += n));
    for (const [w, counts] of entry.words) {
      let posting = this.postings.get(w);
      if (!posting) {
        this.postings.set(w, (posting = new Map()));
        this.vocabulary.splice(this.lowerBound(w), 0, w);
      }
      posting.set(id, counts);
    }
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    entry.lengths.forEach((n, i) => (this.totals[i]! -= n));
    for (const w of entry.words.keys()) {
      const posting = this.postings.get(w);
      if (!posting) continue;
      posting.delete(id);
      if (!posting.size) {
        this.postings.delete(w);
        const at = this.lowerBound(w);
        if (this.vocabulary[at] === w) this.vocabulary.splice(at, 1);
      }
    }
  }

  clear(): void {
    this.entries.clear();
    this.postings.clear();
    this.vocabulary = [];
    this.totals = this.fields.map(() => 0);
  }

  private lowerBound(w: string): number {
    let lo = 0;
    let hi = this.vocabulary.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.vocabulary[mid]! < w) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** The indexed words a term matches: itself (weight 1) and the words it starts (PREFIX_WEIGHT). */
  private matches(term: string): [string, number][] {
    const out: [string, number][] = [];
    for (let i = this.lowerBound(term); i < this.vocabulary.length; i++) {
      const w = this.vocabulary[i]!;
      if (!w.startsWith(term)) break;
      out.push([w, w === term ? 1 : PREFIX_WEIGHT]);
    }
    return out;
  }

  /**
   * Entries matching any of the query's terms in the given fields, with their BM25 score (each term counts
   * its best-matching word once; an entry matching more terms scores higher). Unordered: the caller sorts,
   * so ties can be broken the way its list is ordered.
   */
  search(query: string, fields: readonly F[] = this.fields): Map<string, number> {
    const scores = new Map<string, number>();
    const n = this.entries.size;
    if (!n) return scores;
    const which = fields.map((f) => this.fields.indexOf(f)).filter((i) => i >= 0);
    for (const term of queryTerms(query)) {
      const best = new Map<string, number>();
      for (const [w, weight] of this.matches(term)) {
        const posting = this.postings.get(w)!;
        for (const i of which) {
          let df = 0;
          for (const counts of posting.values()) if (counts[i]! > 0) df++;
          if (!df) continue;
          const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
          const avg = this.totals[i]! / n || 1;
          for (const [id, counts] of posting) {
            const tf = counts[i]!;
            if (!tf) continue;
            const len = this.entries.get(id)!.lengths[i]!;
            const s = weight * idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / avg)));
            if (s > (best.get(id) ?? 0)) best.set(id, s);
          }
        }
      }
      for (const [id, s] of best) scores.set(id, (scores.get(id) ?? 0) + s);
    }
    return scores;
  }

  snapshot(): TextIndexSnapshot {
    const entries: TextIndexSnapshot["entries"] = [];
    for (const [id, e] of this.entries) entries.push([id, e.stamp, e.lengths, [...e.words]]);
    return { v: 1, fields: [...this.fields], entries };
  }

  /** Loads a snapshot made by `snapshot()` (false, and nothing loaded, when it doesn't fit these fields). */
  restore(snap: unknown): boolean {
    const s = snap as TextIndexSnapshot | null | undefined;
    if (!s || s.v !== 1 || !Array.isArray(s.entries) || !Array.isArray(s.fields) || s.fields.join("\u0000") !== this.fields.join("\u0000")) return false;
    this.clear();
    for (const row of s.entries) {
      if (!Array.isArray(row) || row.length !== 4) continue;
      const [id, stamp, lengths, words] = row;
      if (typeof id !== "string" || typeof stamp !== "string" || !Array.isArray(lengths) || !Array.isArray(words)) continue;
      this.put(id, { stamp, lengths: [...lengths], words: new Map(words) });
    }
    return true;
  }
}
