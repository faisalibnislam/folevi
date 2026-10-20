// Columns: blocks side by side. A `columns` block is the row (no text, no props); each of its direct children
// is a `column` block (no text; `width`, its share of the row, optional); a column's children are what the
// column holds, in order. Everything stays an ordinary block in the tree (parentId + rank), so sync, history,
// copy and paste, search and exports treat column contents like any other nested blocks, and an app that
// doesn't know columns keeps them (unknown types round-trip untouched) and shows their contents in order.
//
// The rules a row keeps (repairColumnLines puts a row back in shape after an edit; readers tolerate anything):
// two to LIMITS.maxColumns columns, every column holds at least one block, nothing but columns directly in a
// row, no row inside a column, no column outside a row.
import { LIMITS } from "./generated/schema";
import type { WireBlock } from "./types";
import { childrenMap, type FlatEntry, type TreeNodeLike } from "./tree";

export const COLUMNS_TYPE = "columns";
export const COLUMN_TYPE = "column";
export const MAX_COLUMNS: number = LIMITS.maxColumns;
export const MIN_COLUMN_WIDTH: number = LIMITS.minColumnWidth;

/** A width the schema accepts: a share of the row from MIN_COLUMN_WIDTH to 1. */
export function isColumnWidth(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= MIN_COLUMN_WIDTH && value <= 1;
}

/**
 * Each column's share of the row (summing to 1): its own width where it has a valid one, an equal share
 * (1 / count) where it doesn't. Widths are relative, so a row that gained or lost a column still fills.
 */
export function columnShares(widths: readonly unknown[]): number[] {
  if (!widths.length) return [];
  const even = 1 / widths.length;
  const raw = widths.map((w) => (isColumnWidth(w) ? w : even));
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map((w) => w / sum);
}

export interface ColumnGroup<T> {
  /** The columns block. */
  block: T;
  /** Index of the columns block in the flat list. */
  index: number;
  /** One past the last entry inside the row. */
  end: number;
  /**
   * Its columns in order: the column block (null for blocks that sit directly in the row before any column,
   * shown as a column of their own), where it is and where its contents start and end.
   */
  columns: { block: T | null; index: number; start: number; end: number }[];
}

/** The row at `index` of a flat list with its columns, or null if it isn't a columns block. */
export function columnGroupAt<T extends Pick<WireBlock, "type">>(flat: readonly FlatEntry<T>[], index: number): ColumnGroup<T> | null {
  const head = flat[index];
  if (!head || head.block.type !== COLUMNS_TYPE) return null;
  let end = index + 1;
  while (end < flat.length && flat[end]!.depth > head.depth) end++;
  const columns: ColumnGroup<T>["columns"] = [];
  for (let i = index + 1; i < end; ) {
    const e = flat[i]!;
    let j = i + 1;
    while (j < end && flat[j]!.depth > head.depth + 1) j++;
    if (e.depth === head.depth + 1 && e.block.type === COLUMN_TYPE) columns.push({ block: e.block, index: i, start: i + 1, end: j });
    else if (columns.length) columns[columns.length - 1]!.end = j;
    else columns.push({ block: null, index: i, start: i, end: j });
    i = j;
  }
  return { block: head.block, index, end, columns };
}

/**
 * The depth each entry is shown at in exports and read-only lists: a column's contents sit at their row's
 * level (not two levels in), and so do the column blocks (which draw nothing in a list).
 */
export function liftColumns<T extends Pick<WireBlock, "type">>(flat: readonly FlatEntry<T>[]): FlatEntry<T>[] {
  // Open rows and columns: their depth and how many levels the lines inside them come up by.
  const stack: { depth: number; type: string; lift: number }[] = [];
  return flat.map(({ block, depth }) => {
    while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
    const top = stack[stack.length - 1];
    const lift = top?.lift ?? 0;
    const shown = Math.max(0, depth - lift);
    if (block.type === COLUMNS_TYPE) stack.push({ depth, type: COLUMNS_TYPE, lift: lift + 1 });
    else if (block.type === COLUMN_TYPE && top?.type === COLUMNS_TYPE && top.depth === depth - 1) stack.push({ depth, type: COLUMN_TYPE, lift: lift + 1 });
    return shown === depth ? { block, depth } : { block, depth: shown };
  });
}

/**
 * A row as HTML for exports: its columns side by side (`.columns` / `.column`, each as wide as its share),
 * each column's blocks drawn by `render` (given the column's blocks, a tree of their own).
 */
export function columnsToHtml(row: WireBlock, blocks: readonly WireBlock[], render: (blocks: WireBlock[]) => string): string {
  const kids = childrenMap(blocks);
  const under = (id: string): WireBlock[] => {
    const out: WireBlock[] = [];
    const walk = (parent: string) => {
      for (const c of kids.get(parent) ?? []) {
        out.push(c);
        walk(c.id);
      }
    };
    walk(id);
    return out;
  };
  // Blocks directly in the row before any column make a column of their own, as in the editor.
  const columns: WireBlock[][] = [];
  let loose: WireBlock[] = [];
  for (const child of kids.get(row.id) ?? []) {
    if (child.type === COLUMN_TYPE) {
      if (loose.length) columns.push(loose);
      loose = [];
      columns.push([child]);
    } else if (columns.length && !loose.length) columns[columns.length - 1]!.push(child, ...under(child.id));
    else loose.push(child, ...under(child.id));
  }
  if (loose.length) columns.push(loose);
  const shares = columnShares(columns.map((c) => (c[0]?.type === COLUMN_TYPE ? (c[0].props as { width?: unknown }).width : undefined)));
  const cells = columns.map((c, i) => {
    const head = c[0]?.type === COLUMN_TYPE ? c[0] : null;
    const content = head ? [...under(head.id), ...c.slice(1)] : c;
    // The blocks right under the column become the column's own top level.
    const ids = new Set(content.map((b) => b.id));
    const rooted = content.map((b) => (b.parentId !== null && ids.has(b.parentId) ? b : { ...b, parentId: null }));
    return `<div class="column" style="flex:${Number(shares[i]!.toFixed(4))} 1 0">${render(rooted)}</div>`;
  });
  return `<div class="columns">${cells.join("")}</div>`;
}

/** A line of a flat document, for repairColumnLines: its block type and depth. */
export interface ColumnLine {
  type: string;
  depth: number;
}

/** A line after repairColumnLines: an original line (`from`, its index) at its new depth, or a new column. */
export type RepairedColumnLine = { from: number; depth: number } | { from: null; type: typeof COLUMN_TYPE; depth: number };

/**
 * Puts rows back in shape after an edit, on a flat list of lines (the editor's document): a block directly in
 * a row (not a column) moves into the column before it (into a new first column if there's none); an empty
 * column goes; columns past LIMITS.maxColumns go (their blocks join the last column); a row left with one
 * column becomes its blocks again, one left with none goes; a row inside a column becomes its blocks; a column
 * outside a row goes (its blocks stay, one level out). Nothing a person wrote is ever dropped.
 *
 * `touched(start, end)` limits the repair to rows and stray columns whose lines overlap what an edit changed
 * (lines start..end-1), so a row someone else is still filling in isn't tidied away under them.
 * Returns the repaired lines, or null when nothing needed repairing.
 */
export function repairColumnLines(lines: readonly ColumnLine[], touched: (start: number, end: number) => boolean = () => true): RepairedColumnLine[] | null {
  const n = lines.length;
  const drop: boolean[] = new Array(n).fill(false);
  const delta: number[] = new Array(n).fill(0);
  /** A new column goes before the line at this index, one level under the row at the value's index. */
  const insertBefore = new Map<number, number>();
  const end = (i: number) => {
    let j = i + 1;
    while (j < n && lines[j]!.depth > lines[i]!.depth) j++;
    return j;
  };
  const shift = (from: number, to: number, by: number) => {
    for (let m = from; m < to; m++) delta[m]! += by;
  };
  const live = (from: number, to: number) => {
    let count = 0;
    for (let m = from; m < to; m++) if (!drop[m]) count++;
    return count;
  };

  /** A row inside a column: it and its columns go, their blocks come out to the row's level. */
  const dissolve = (g: number, e: number) => {
    const d = lines[g]!.depth;
    drop[g] = true;
    let inColumn = false;
    for (let k = g + 1; k < e; ) {
      const sub = end(k);
      if (lines[k]!.depth === d + 1 && lines[k]!.type === COLUMN_TYPE) {
        drop[k] = true;
        inColumn = true;
        shift(k + 1, sub, -2);
      } else if (lines[k]!.depth === d + 1) shift(k, sub, -1);
      else shift(k, sub, inColumn ? -2 : -1);
      scan(lines[k]!.depth === d + 1 && lines[k]!.type === COLUMN_TYPE ? k + 1 : k, sub, true);
      k = sub;
    }
  };

  const repairRow = (g: number, e: number) => {
    const d = lines[g]!.depth;
    const columns: { index: number | null; first: number; end: number }[] = [];
    for (let k = g + 1; k < e; ) {
      const line = lines[k]!;
      const sub = end(k);
      if (line.depth === d + 1 && line.type === COLUMN_TYPE) {
        columns.push({ index: k, first: k + 1, end: sub });
        scan(k + 1, sub, true);
      } else {
        // Directly in the row: into the column before it, or a new first column.
        if (!columns.length) {
          insertBefore.set(k, g);
          columns.push({ index: null, first: k, end: sub });
        } else columns[columns.length - 1]!.end = sub;
        if (line.depth === d + 1) shift(k, sub, 1);
        if (line.type === COLUMNS_TYPE) dissolve(k, sub);
        else scan(k, sub, true);
      }
      k = sub;
    }
    const kept = columns.filter((c) => live(c.first, c.end) > 0);
    for (const c of columns) {
      if (kept.includes(c)) continue;
      if (c.index === null) insertBefore.delete(c.first);
      else drop[c.index] = true;
    }
    for (const c of kept.slice(MAX_COLUMNS)) if (c.index !== null) drop[c.index] = true;
    if (kept.length <= 1) {
      // One column (or none) is no row: its blocks take the row's place.
      drop[g] = true;
      for (const c of kept) {
        if (c.index === null) insertBefore.delete(c.first);
        else drop[c.index] = true;
      }
      for (let m = g + 1; m < e; m++) if (!drop[m]) delta[m]! -= 2;
    }
  };

  /** Rows, and columns outside a row, from `from` to `to`; inside a column, a row is dissolved. */
  function scan(from: number, to: number, insideColumn: boolean) {
    for (let k = from; k < to; ) {
      const line = lines[k]!;
      if (line.type === COLUMNS_TYPE) {
        const e = end(k);
        if (insideColumn) dissolve(k, e);
        else if (touched(k, e)) repairRow(k, e);
        else scan(k + 1, e, false);
        k = e;
      } else if (line.type === COLUMN_TYPE) {
        const e = end(k);
        if (touched(k, e)) {
          drop[k] = true;
          shift(k + 1, e, -1);
        }
        scan(k + 1, e, insideColumn);
        k = e;
      } else k++;
    }
  }
  scan(0, n, false);

  let changed = insertBefore.size > 0;
  const out: RepairedColumnLine[] = [];
  for (let i = 0; i < n; i++) {
    const row = insertBefore.get(i);
    if (row !== undefined) out.push({ from: null, type: COLUMN_TYPE, depth: Math.min(LIMITS.maxDepth, Math.max(0, lines[row]!.depth + delta[row]! + 1)) });
    if (drop[i]) {
      changed = true;
      continue;
    }
    const depth = Math.min(LIMITS.maxDepth, Math.max(0, lines[i]!.depth + delta[i]!));
    if (depth !== lines[i]!.depth) changed = true;
    out.push({ from: i, depth });
  }
  return changed ? out : null;
}

export interface ColumnsIssue {
  blockId: string;
  code: "column_outside_row" | "too_few_columns" | "too_many_columns" | "not_a_column" | "empty_column" | "row_in_column";
}

/**
 * What's out of shape in a document's rows (see repairColumnLines). The server can't refuse these (blocks are
 * written one at a time, by several people), so the editor repairs them and readers tolerate them.
 */
export function columnsIssues<T extends TreeNodeLike & Pick<WireBlock, "type">>(flat: readonly FlatEntry<T>[]): ColumnsIssue[] {
  const issues: ColumnsIssue[] = [];
  const rows: { depth: number }[] = [];
  for (let i = 0; i < flat.length; i++) {
    const { block, depth } = flat[i]!;
    while (rows.length && rows[rows.length - 1]!.depth >= depth) rows.pop();
    const row = rows[rows.length - 1];
    if (block.type === COLUMN_TYPE && !(row && row.depth === depth - 1)) issues.push({ blockId: block.id, code: "column_outside_row" });
    if (block.type !== COLUMNS_TYPE) continue;
    if (row) issues.push({ blockId: block.id, code: "row_in_column" });
    rows.push({ depth });
    const group = columnGroupAt(flat, i)!;
    const real = group.columns.filter((c) => c.block);
    if (real.length < 2) issues.push({ blockId: block.id, code: "too_few_columns" });
    if (real.length > MAX_COLUMNS) issues.push({ blockId: block.id, code: "too_many_columns" });
    for (const c of group.columns) {
      if (!c.block) issues.push({ blockId: flat[c.start]!.block.id, code: "not_a_column" });
      else if (c.end <= c.start) issues.push({ blockId: c.block.id, code: "empty_column" });
    }
  }
  return issues;
}

/** How a ```columns fence separates its columns: a line holding only "+++". */
const COLUMN_BREAK = /^\s*\+\+\+\s*$/;

/**
 * A ```columns fence's body (Foli AI, MCP) as the Markdown of each column: split at "+++" lines, empty parts
 * left out, parts past LIMITS.maxColumns joined to the last. Null when fewer than two columns are left (the
 * Markdown is then imported as it is).
 */
export function columnsFromFence(body: string): string[] | null {
  const parts: string[][] = [[]];
  for (const line of body.split("\n")) {
    if (COLUMN_BREAK.test(line)) parts.push([]);
    else parts[parts.length - 1]!.push(line);
  }
  const kept = parts.map((p) => p.join("\n")).filter((p) => p.trim());
  if (kept.length < 2) return null;
  return kept.length > MAX_COLUMNS ? [...kept.slice(0, MAX_COLUMNS - 1), kept.slice(MAX_COLUMNS - 1).join("\n\n")] : kept;
}

/**
 * How Foli AI chat and the MCP tools describe the fence to a model (static text, shown in their tool
 * descriptions).
 */
export const COLUMNS_MARKDOWN_HINT =
  `To put blocks side by side, use a fenced block with the language "columns" holding Markdown, split into 2 to ${LIMITS.maxColumns} columns by lines holding only +++ ` +
  "(open it with four backticks, ````columns, when a column holds a ``` code block). It becomes columns in the note; on phones they stack.";
