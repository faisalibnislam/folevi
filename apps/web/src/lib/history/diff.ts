// What changed between two versions of a page, for version history: which blocks were added, removed or
// edited (and by whom), and inside an edited line, which words.
import { plainText, type InlineNode, type WireBlock } from "@folevi/editor-schema";

export interface TextPart {
  kind: "same" | "added" | "removed";
  text: string;
}

export interface BlockChange {
  /** "styled": the same words with a different type, format or properties. */
  kind: "added" | "removed" | "edited" | "styled";
  /** Who made it (a person key from the version's `people`), when the version recorded it. */
  author: string | null;
  at: number | null;
  /** For an edited line: its words, kept, added and removed. */
  parts?: TextPart[];
}

export interface VersionDiff {
  /** The version's blocks plus the ones removed since the version before, each at the place it had. */
  blocks: WireBlock[];
  changes: Map<string, BlockChange>;
  /** People with changes in this version, most changes first. */
  authors: string[];
}

/** Who changed which block, as the server sends it: [block id, person key, time]. */
export type Attribution = readonly (readonly [string, string, number])[] | null;

const byBlock = (list: Attribution) => new Map((list ?? []).map(([blockId, who, at]) => [blockId, [who, at] as const]));

// Words, runs of spaces and single punctuation marks: a changed word reads as one change, not letter by letter.
const TOKEN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;
/** Beyond this many token pairs a line is shown as replaced whole (the word diff is quadratic). */
const MAX_PAIRS = 250_000;

/** Word-level differences between two texts, in reading order. */
export function diffWords(before: string, after: string): TextPart[] {
  if (before === after) return before ? [{ kind: "same", text: before }] : [];
  const a = before.match(TOKEN) ?? [];
  const b = after.match(TOKEN) ?? [];
  // Common start and end first: most edits touch a small part of a line.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: TextPart[] = [];
  const push = (kind: TextPart["kind"], text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last?.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  push("same", a.slice(0, start).join(""));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > MAX_PAIRS) {
    push("removed", midA.join(""));
    push("added", midB.join(""));
  } else {
    // Longest common subsequence over the middle, then walked front to back.
    const n = midA.length;
    const m = midB.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) lcs[i]![j] = midA[i] === midB[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        push("same", midA[i]!);
        i++;
        j++;
      } else if (j < m && (i === n || lcs[i]![j + 1]! > lcs[i + 1]![j]!)) {
        // (On a tie the removed words come first: struck-out text, then what replaced it.)
        push("added", midB[j]!);
        j++;
      } else {
        push("removed", midA[i]!);
        i++;
      }
    }
  }
  push("same", a.slice(endA).join(""));
  return out;
}

// Opening or closing a toggle isn't a change to the page.
const shapeOf = (b: WireBlock) => {
  const { collapsed: _open, ...props } = b.props as Record<string, unknown>;
  return JSON.stringify([b.type, props, b.text]);
};

/** The words a block holds, wherever it keeps them (code, formulas and tables keep theirs in properties). */
function wordsOf(b: WireBlock): string {
  const p = b.props as Record<string, unknown>;
  switch (b.type) {
    case "code":
      return String(p.code ?? "");
    case "formula":
      return String(p.latex ?? "");
    case "table":
      return ((p.rows as InlineNode[][][] | undefined) ?? []).map((row) => row.map((cell) => plainText(cell ?? [])).join(" | ")).join("\n");
    default:
      return plainText(b.text);
  }
}
const KEEPS_WORDS_IN_PROPS = new Set(["code", "formula", "table"]);

/**
 * Compares a version with the one before it (null for the first version: nothing is marked). `authors` says
 * who last changed each block in this version, `removed` who deleted each block that's gone since.
 */
export function diffVersions(previous: WireBlock[] | null, current: WireBlock[], authors: Attribution, removed: Attribution): VersionDiff {
  const changes = new Map<string, BlockChange>();
  if (!previous) return { blocks: current, changes, authors: [] };
  const before = new Map(previous.map((b) => [b.id, b]));
  const changedBy = byBlock(authors);
  const removedBy = byBlock(removed);
  const now = new Set(current.map((b) => b.id));
  const tally = new Map<string, number>();
  const credit = (author: string | null) => {
    if (author) tally.set(author, (tally.get(author) ?? 0) + 1);
  };
  for (const b of current) {
    const old = before.get(b.id);
    const [author, at] = changedBy.get(b.id) ?? [null, null];
    if (!old) {
      changes.set(b.id, { kind: "added", author, at });
      credit(author);
      continue;
    }
    // A block that only moved isn't an edit (the order of the page shows it where it is now).
    if (shapeOf(old) === shapeOf(b)) continue;
    const was = wordsOf(old);
    const is = wordsOf(b);
    // (Word by word for lines of text; a changed code block, formula or table is marked edited as a whole.)
    const parts = KEEPS_WORDS_IN_PROPS.has(b.type) || KEEPS_WORDS_IN_PROPS.has(old.type) ? undefined : diffWords(was, is);
    changes.set(b.id, was === is ? { kind: "styled", author, at } : { kind: "edited", author, at, ...(parts ? { parts } : {}) });
    credit(author);
  }
  // Removed blocks keep their place (parent and rank), so they show where they were.
  const gone = previous.filter((b) => !now.has(b.id));
  for (const b of gone) {
    const [author, at] = removedBy.get(b.id) ?? [null, null];
    changes.set(b.id, { kind: "removed", author, at });
    credit(author);
  }
  const ranked = [...tally.entries()].sort((x, y) => y[1] - x[1]).map(([key]) => key);
  return { blocks: gone.length ? [...current, ...gone] : current, changes, authors: ranked };
}
