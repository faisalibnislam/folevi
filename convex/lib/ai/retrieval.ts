// Retrieval for Folevi AI (docs/AI_ASSISTANT.md, "Retrieval"): how a note becomes chunks for the vector
// index, how keyword and vector results are merged, and how much note text a prompt gets. Pure functions
// (no database, no network), so they're tested directly; convex/aiIndex.ts and convex/ai.ts use them.
import { blockSearchText, type WireBlock } from "@folevi/editor-schema";
import { sha256Hex } from "../crypto";

/** A chunk aims for about this many characters, along heading and block boundaries. */
export const CHUNK_TARGET = 1_000;
/** No chunk is longer than this (a longer block is split at sentence or word boundaries). */
export const CHUNK_MAX = 1_500;
/** A heading starts a new chunk once the current one has at least this much in it. */
const CHUNK_MIN = 200;
/** Chunks kept per note (about 200,000 characters); the rest of a very long note isn't embedded. */
export const MAX_CHUNKS = 200;
/** The vectors' size (gemini-embedding-001 with outputDimensionality 768). */
export const EMBEDDING_DIMENSIONS = 768;

/** One line of a note, in reading order, as the chunker sees it. */
export interface ChunkLine {
  blockId: string;
  type: string;
  text: string;
  /** Heading level (1-3) for headings. */
  level?: number;
  depth: number;
}

export interface Chunk {
  index: number;
  text: string;
  /** The blocks the chunk's text came from, in order (for citations and highlighting). */
  blockIds: string[];
}

const LIST_TYPES = new Set(["bulleted", "numbered", "toggle"]);

/** A block as one line of text (light Markdown so headings and lists read as such), or null when it has none. */
export function lineOf(block: Pick<WireBlock, "id" | "type" | "text" | "props">, depth: number): ChunkLine | null {
  const text = blockSearchText(block).replace(/[ \t]+/g, " ").trim();
  if (!text) return null;
  const level = block.type === "heading" ? Math.min(3, Math.max(1, Number((block.props as { level?: unknown }).level ?? 1))) : undefined;
  return { blockId: block.id, type: block.type, text, level, depth };
}

function rendered(line: ChunkLine): string {
  const indent = "  ".repeat(Math.min(line.depth, 4));
  if (line.type === "heading") return `${"#".repeat(line.level ?? 1)} ${line.text}`;
  if (line.type === "todo") return `${indent}- [ ] ${line.text}`;
  if (LIST_TYPES.has(line.type)) return `${indent}- ${line.text}`;
  if (line.type === "quote") return `> ${line.text}`;
  return line.text;
}

/** Splits text longer than `max` at sentence ends, else spaces, else anywhere. */
export function splitLong(text: string, max = CHUNK_MAX): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "), window.lastIndexOf("\n"));
    if (cut < max / 2) cut = window.lastIndexOf(" ");
    if (cut < max / 2) cut = max - 1;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trimStart();
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

/**
 * A note's lines as chunks of about CHUNK_TARGET characters. A heading starts a new chunk (unless the one
 * before it is still tiny), a chunk never splits a block unless the block alone is longer than CHUNK_MAX,
 * and a chunk that continues a section starts with that section's heading so it reads on its own. Each
 * chunk keeps the ids of the blocks its text came from (not the repeated heading's).
 */
export function chunkLines(lines: ChunkLine[], target = CHUNK_TARGET): Chunk[] {
  const chunks: Chunk[] = [];
  // The chunk being built: its lines (perhaps starting with a carried heading), their blocks, and the
  // size of its own text (a carried heading doesn't count).
  let parts: string[] = [];
  let ids: string[] = [];
  let size = 0;
  let heading: string | null = null;
  const flush = () => {
    if (ids.length) chunks.push({ index: chunks.length, text: parts.join("\n"), blockIds: [...new Set(ids)] });
    parts = [];
    ids = [];
    size = 0;
  };
  const add = (text: string, blockId: string) => {
    parts.push(text);
    ids.push(blockId);
    size += text.length + 1;
  };
  for (const line of lines) {
    if (chunks.length >= MAX_CHUNKS) break;
    const text = rendered(line);
    if (line.type === "heading") {
      if (size >= CHUNK_MIN || (size > 0 && size + text.length > target)) flush();
      // A heading never follows a carried one.
      if (!ids.length) parts = [];
      heading = text;
      add(text, line.blockId);
      continue;
    }
    for (const piece of text.length > CHUNK_MAX ? splitLong(text) : [text]) {
      if (size > 0 && size + piece.length + 1 > target) flush();
      // A continuation starts with its section's heading, so it reads on its own.
      if (!parts.length && heading) parts.push(heading);
      add(piece, line.blockId);
    }
  }
  flush();
  return chunks.slice(0, MAX_CHUNKS);
}

/** The text a chunk is embedded with: the note's title, then the chunk (so short chunks keep their topic). */
export const embeddingText = (title: string, chunk: Pick<Chunk, "text">) => `${title.trim() || "Untitled"}\n\n${chunk.text}`;

/**
 * A chunk's content hash: what it would be embedded with and by which model. Two chunks with the same
 * hash get the same embedding, so an unchanged chunk keeps its vector when the note around it changes.
 */
export async function chunkHash(title: string, chunk: Pick<Chunk, "text">, model: string): Promise<string> {
  return (await sha256Hex(`${model}\n${embeddingText(title, chunk)}`)).slice(0, 32);
}

/** Scales a vector to length 1 (Gemini's truncated embeddings aren't normalized; cosine wants them to be). */
export function normalize(vector: number[]): number[] {
  let sum = 0;
  for (const x of vector) sum += x * x;
  const len = Math.sqrt(sum);
  return len > 0 ? vector.map((x) => x / len) : vector;
}

/** The constant in reciprocal rank fusion: higher flattens the difference between ranks. */
export const RRF_K = 60;

/**
 * Reciprocal rank fusion: each list adds 1 / (k + rank) to an item's score (rank from 1), and items are
 * returned best first. Ties keep the order items were first seen in (the first list wins).
 */
export function reciprocalRankFusion(lists: readonly (readonly string[])[], k = RRF_K): string[] {
  const score = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  for (const list of lists) {
    const seen = new Set<string>();
    list.forEach((id, i) => {
      if (seen.has(id)) return;
      seen.add(id);
      score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1));
      if (!firstSeen.has(id)) firstSeen.set(id, firstSeen.size);
    });
  }
  return [...score.keys()].sort((a, b) => score.get(b)! - score.get(a)! || firstSeen.get(a)! - firstSeen.get(b)!);
}

/** Tokens a text will take, estimated from its length (about 4 characters a token; credits use the same). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Fits passages into a prompt's token budget, best first: each keeps at most `perItem` tokens, and once
 * the budget runs out the rest are left out (the last one that fits partly is trimmed at a word).
 */
export function fitToBudget<T extends { text: string }>(items: readonly T[], budget: number, perItem = Infinity): T[] {
  const out: T[] = [];
  let left = budget;
  for (const item of items) {
    if (left <= 0) break;
    const cap = Math.min(left, perItem) * 4;
    let text = item.text;
    if (text.length > cap) {
      const cut = text.lastIndexOf(" ", cap);
      text = `${text.slice(0, cut > cap * 0.6 ? cut : cap).trimEnd()}…`;
      // A sliver isn't worth sending.
      if (text.length < 200 && item.text.length > 200) break;
    }
    out.push({ ...item, text });
    left -= estimateTokens(text);
  }
  return out;
}

/** Text compared for duplicates: lowercased, letters and digits only. */
const fingerprint = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Drops passages whose text another, better-ranked one already has (a copied note, a repeated chunk). */
export function dedupePassages<T extends { text: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = fingerprint(item.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
