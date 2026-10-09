// Simple text similarity for find_duplicates and compare_notes: word shingles and Jaccard overlap, plus
// a title comparison. Cheap and explainable; the knowledge graph (milestone 7) can do better later.

const WORD = /[\p{L}\p{N}]+/gu;

export function wordsOf(text: string, limit = 4_000): string[] {
  return (text.toLowerCase().match(WORD) ?? []).slice(0, limit);
}

/** Overlapping runs of `n` words (single words when the text is shorter). */
export function shingles(text: string, n = 3): Set<string> {
  const w = wordsOf(text);
  if (w.length < n) return new Set(w);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let both = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) both++;
  return both / (a.size + b.size - both);
}

/** How alike two titles are (0 to 1): the same words count, order and case don't. */
export function titleSimilarity(a: string, b: string): number {
  const wa = new Set(wordsOf(a));
  const wb = new Set(wordsOf(b));
  if (!wa.size || !wb.size) return 0;
  return jaccard(wa, wb);
}

/** How alike two notes are (0 to 1): mostly their text, a little their titles. */
export function noteSimilarity(a: { title: string; text: string }, b: { title: string; text: string }): number {
  const text = jaccard(shingles(a.text), shingles(b.text));
  const title = titleSimilarity(a.title, b.title);
  return Math.round((0.75 * text + 0.25 * title) * 100) / 100;
}

/**
 * Pairs of notes that look like duplicates, most alike first: their score is at least `threshold`.
 * With `focus`, only pairs that include that note. Quadratic, so callers cap the list (a few hundred).
 */
export function duplicatePairs<T extends { id: string; title: string; text: string }>(notes: T[], threshold = 0.5, focus?: string): { a: T; b: T; score: number }[] {
  const prepared = notes.map((n) => ({ n, sh: shingles(n.text), words: new Set(wordsOf(n.title)) }));
  const out: { a: T; b: T; score: number }[] = [];
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const x = prepared[i]!;
      const y = prepared[j]!;
      if (focus && x.n.id !== focus && y.n.id !== focus) continue;
      const title = x.words.size && y.words.size ? jaccard(x.words, y.words) : 0;
      const score = Math.round((0.75 * jaccard(x.sh, y.sh) + 0.25 * title) * 100) / 100;
      if (score >= threshold) out.push({ a: x.n, b: y.n, score });
    }
  }
  return out.sort((p, q) => q.score - p.score);
}
