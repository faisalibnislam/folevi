// Columns in the editor's flat list of lines (packages/editor-schema/src/columns.ts): a `columns` line (the
// row) at depth d, then for each column a `column` line at d + 1 followed by the column's lines at d + 2 and
// deeper. Pure readers of the document (no view), cached per document, so the layout, the keys, drag and drop
// and the commands all ask the same questions.
import type { Node as PMNode } from "@tiptap/pm/model";
import { columnShares } from "@folevi/editor-schema";

export const ROW = "columns";
export const COLUMN = "column";

export interface ColumnInfo {
  /** Index of the column line among the note's lines (-1 for lines that sit in the row before any column). */
  index: number;
  pos: number;
  id: string | null;
  width: unknown;
  /** The column's lines: from `start` to one before `end`. */
  start: number;
  end: number;
}

export interface ColumnRow {
  index: number;
  pos: number;
  id: string | null;
  depth: number;
  /** One past the row's last line. */
  end: number;
  columns: ColumnInfo[];
  /** Each column's share of the row (summing to 1). */
  shares: number[];
}

export interface ColumnsModel {
  rows: ColumnRow[];
  /** Start position of every line. */
  starts: number[];
}

const EMPTY: ColumnsModel = { rows: [], starts: [] };
const cache = new WeakMap<PMNode, ColumnsModel>();

const depthOf = (node: PMNode) => Number(node.attrs.depth ?? 0);

/** The note's rows of columns (rows inside a column are left to the repair: their lines count as the column's). */
export function columnsModel(doc: PMNode): ColumnsModel {
  const hit = cache.get(doc);
  if (hit) return hit;
  let any = false;
  doc.forEach((n) => {
    if (n.type.name === ROW) any = true;
  });
  if (!any) {
    cache.set(doc, EMPTY);
    return EMPTY;
  }
  const n = doc.childCount;
  const starts: number[] = [];
  let p = 0;
  for (let i = 0; i < n; i++) {
    starts.push(p);
    p += doc.child(i).nodeSize;
  }
  const rows: ColumnRow[] = [];
  for (let i = 0; i < n; i++) {
    const node = doc.child(i);
    if (node.type.name !== ROW) continue;
    const d = depthOf(node);
    let end = i + 1;
    while (end < n && depthOf(doc.child(end)) > d) end++;
    const columns: ColumnInfo[] = [];
    for (let k = i + 1; k < end; ) {
      const c = doc.child(k);
      let j = k + 1;
      while (j < end && depthOf(doc.child(j)) > d + 1) j++;
      if (depthOf(c) === d + 1 && c.type.name === COLUMN) columns.push({ index: k, pos: starts[k]!, id: (c.attrs.id as string | null) ?? null, width: c.attrs.width, start: k + 1, end: j });
      else if (columns.length) columns[columns.length - 1]!.end = j;
      else columns.push({ index: -1, pos: starts[k]!, id: null, width: undefined, start: k, end: j });
      k = j;
    }
    rows.push({ index: i, pos: starts[i]!, id: (node.attrs.id as string | null) ?? null, depth: d, end, columns, shares: columnShares(columns.map((c) => c.width)) });
    // A row inside this one is part of a column here (the repair turns it back into lines).
    i = end - 1;
  }
  const model = { rows, starts };
  cache.set(doc, model);
  return model;
}

/** The row a line is inside (not the row's own line), with the column it's in (-1 for a line before any column). */
export function rowOf(doc: PMNode, index: number): { row: ColumnRow; column: number } | null {
  for (const row of columnsModel(doc).rows) {
    if (index <= row.index || index >= row.end) continue;
    const column = row.columns.findIndex((c) => (c.index === index || index >= c.start) && index < c.end);
    return { row, column };
  }
  return null;
}

/** The row whose own line is at `index`. */
export function rowAt(doc: PMNode, index: number): ColumnRow | null {
  return columnsModel(doc).rows.find((r) => r.index === index) ?? null;
}

/** The depth a column's own lines start at (one under the column line). */
export const baseDepth = (row: ColumnRow) => row.depth + 2;
