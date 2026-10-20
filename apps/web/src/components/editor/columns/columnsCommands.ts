// What people do with columns: insert a row, drop a block beside another (a new row, or a new column in a
// row), resize, and the repair that keeps rows in shape after any local edit (repairColumnLines in
// packages/editor-schema/src/columns.ts).
import type { Editor } from "@tiptap/core";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { LIMITS, MIN_COLUMN_WIDTH, repairColumnLines, ulid } from "@folevi/editor-schema";
import { blocksInSelection, normalizeDepths } from "../commands";
import { TEXT_NODES } from "../convert";
import { COLUMN, ROW, baseDepth, columnsModel, rowOf } from "./columnsModel";
import type { SideDrop } from "./columnsLayout";
import { announce } from "@/lib/a11y/announce";

const depthOf = (node: PMNode) => Number(node.attrs.depth ?? 0);
const withDepth = (node: PMNode, depth: number) => (depthOf(node) === depth ? node : node.type.create({ ...node.attrs, depth }, node.content, node.marks));

function subtreeEnd(doc: PMNode, index: number): number {
  const d = depthOf(doc.child(index));
  let j = index + 1;
  while (j < doc.childCount && depthOf(doc.child(j)) > d) j++;
  return j;
}

/**
 * A row of `count` empty columns where the caret is: in place of an empty line, else after the current block
 * (and what's nested under it); from inside a row, after that row (rows don't go inside columns). The caret
 * goes into the first column.
 */
export function insertColumns(editor: Editor, count: number): boolean {
  const { state } = editor;
  const { schema, doc } = state;
  const n = Math.max(2, Math.min(LIMITS.maxColumns, Math.round(count)));
  const [current] = blocksInSelection(state);
  let at = doc.content.size;
  let replaceTo: number | null = null;
  let depth = 0;
  if (current) {
    const inRow = rowOf(doc, current.index);
    const rowHere = columnsModel(doc).rows.find((r) => r.index === current.index);
    if (inRow || rowHere) {
      const row = inRow?.row ?? rowHere!;
      depth = row.depth;
      at = positionOf(doc, row.end);
    } else {
      depth = depthOf(current.node);
      const next = doc.maybeChild(current.index + 1);
      const hasChildren = Boolean(next && depthOf(next) > depth);
      const empty = TEXT_NODES.has(current.node.type.name) && current.node.content.size === 0 && !hasChildren;
      if (empty) {
        at = current.pos;
        replaceTo = current.pos + current.node.nodeSize;
      } else {
        const end = subtreeEnd(doc, current.index);
        at = positionOf(doc, end);
      }
    }
  }
  depth = Math.min(depth, LIMITS.maxDepth - 2);
  const nodes: PMNode[] = [schema.nodes[ROW]!.create({ id: ulid(), depth })];
  for (let k = 0; k < n; k++) {
    nodes.push(schema.nodes[COLUMN]!.create({ id: ulid(), depth: depth + 1 }));
    nodes.push(schema.nodes.paragraph!.create({ id: ulid(), depth: depth + 2 }));
  }
  const tr = state.tr;
  if (replaceTo !== null) tr.replaceWith(at, replaceTo, nodes);
  else tr.insert(at, nodes);
  // Into the first column's first line (past the row's and the column's own lines).
  const firstText = at + nodes[0]!.nodeSize + nodes[1]!.nodeSize + 1;
  tr.setSelection(TextSelection.create(tr.doc, firstText));
  editor.view.dispatch(closeHistory(tr).scrollIntoView());
  editor.view.focus();
  announce(`${n} columns`);
  return true;
}

function positionOf(doc: PMNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < Math.min(index, doc.childCount); i++) pos += doc.child(i).nodeSize;
  return pos;
}

/**
 * Drops lines `from`..`last` (with what's nested under the last) beside another block, making a row of the two,
 * or into a new column of a row. Returns the transaction and where the dropped lines landed (for the glow).
 */
export function applySideDrop(state: EditorState, from: number, last: number, drop: SideDrop): { tr: Transaction; index: number; count: number } | null {
  const { doc, schema } = state;
  if (from < 0 || last < from || last >= doc.childCount) return null;
  const srcEnd = subtreeEnd(doc, last);
  const inSource = (i: number) => i >= from && i < srcEnd;
  const srcBase = depthOf(doc.child(from));
  const model = columnsModel(doc);
  let spanFrom: number;
  let spanTo: number;
  let build: (moved: PMNode[]) => { out: PMNode[]; first: PMNode | undefined };
  if (drop.kind === "new") {
    const b = drop.target;
    if (b < 0 || b >= doc.childCount || inSource(b)) return null;
    const bEnd = subtreeEnd(doc, b);
    if (from > b && from < bEnd) return null;
    const d = depthOf(doc.child(b));
    if (d + 2 > LIMITS.maxDepth) return null;
    spanFrom = Math.min(from, b);
    spanTo = Math.max(srcEnd, bEnd);
    build = (moved) => {
      const target: PMNode[] = [];
      for (let i = b; i < bEnd; i++) target.push(withDepth(doc.child(i), Math.min(LIMITS.maxDepth, depthOf(doc.child(i)) + 2)));
      const shifted = moved.map((n) => withDepth(n, Math.min(LIMITS.maxDepth, depthOf(n) - srcBase + d + 2)));
      const left = drop.side === "left" ? shifted : target;
      const right = drop.side === "left" ? target : shifted;
      const row = [schema.nodes[ROW]!.create({ id: ulid(), depth: d }), schema.nodes[COLUMN]!.create({ id: ulid(), depth: d + 1 }), ...left, schema.nodes[COLUMN]!.create({ id: ulid(), depth: d + 1 }), ...right];
      const out: PMNode[] = [];
      for (let i = spanFrom; i < spanTo; i++) {
        if (inSource(i)) continue;
        if (i === b) out.push(...row);
        if (i >= b && i < bEnd) continue;
        out.push(doc.child(i));
      }
      return { out, first: shifted[0] };
    };
  } else {
    const row = model.rows.find((r) => r.index === drop.row);
    if (!row || inSource(row.index) || row.columns.length >= LIMITS.maxColumns) return null;
    const at = Math.max(0, Math.min(row.columns.length, drop.at));
    const insertBefore = at < row.columns.length ? row.columns[at]!.index : row.end;
    if (insertBefore < 0) return null;
    spanFrom = Math.min(from, row.index);
    spanTo = Math.max(srcEnd, row.end);
    const base = baseDepth(row);
    build = (moved) => {
      const column = schema.nodes[COLUMN]!.create({ id: ulid(), depth: row.depth + 1 });
      const shifted = moved.map((n) => withDepth(n, Math.min(LIMITS.maxDepth, depthOf(n) - srcBase + base)));
      const out: PMNode[] = [];
      for (let i = spanFrom; i < spanTo; i++) {
        if (i === insertBefore) out.push(column, ...shifted);
        if (inSource(i)) continue;
        const node = doc.child(i);
        // A new column: every column takes an equal share again.
        out.push(i > row.index && i < row.end && node.type.name === COLUMN && node.attrs.width !== null ? node.type.create({ ...node.attrs, width: null }) : node);
      }
      if (insertBefore === spanTo) out.push(column, ...shifted);
      return { out, first: shifted[0] };
    };
  }
  const moved: PMNode[] = [];
  for (let i = from; i < srcEnd; i++) moved.push(doc.child(i));
  const { out, first } = build(moved);
  const start = positionOf(doc, spanFrom);
  const end = positionOf(doc, spanTo);
  const tr = state.tr.replaceWith(start, end, Fragment.fromArray(out));
  normalizeDepths(tr);
  // Where the first dropped line is now.
  const index = spanFrom + Math.max(0, first ? out.indexOf(first) : 0);
  return { tr, index, count: srcEnd - from };
}

/** Saves a row's column shares (every column's, so they always add up). */
export function setColumnShares(editor: Editor, rowIndex: number, shares: number[] | null): boolean {
  const { state } = editor;
  const row = columnsModel(state.doc).rows.find((r) => r.index === rowIndex);
  if (!row) return false;
  const tr = state.tr;
  row.columns.forEach((c, k) => {
    if (c.index < 0) return;
    const node = state.doc.child(c.index);
    const width = shares ? Math.round(Math.max(MIN_COLUMN_WIDTH, Math.min(1, shares[k] ?? 0)) * 10000) / 10000 : null;
    if (node.attrs.width === width) return;
    tr.setNodeMarkup(c.pos, undefined, { ...node.attrs, width });
  });
  if (!tr.docChanged) return false;
  editor.view.dispatch(closeHistory(tr));
  return true;
}

/**
 * After a local edit, rows the edit touched are put back in shape (repairColumnLines): a line outdented or
 * dropped straight into a row goes into a column, an emptied column goes, a row left with one column becomes
 * its lines again. Remote changes are never repaired here: someone else's row may still be arriving.
 */
export function repairColumns(state: EditorState, changed: { from: number; to: number } | null): Transaction | null {
  const { doc, schema } = state;
  if (!changed) return null;
  let any = false;
  doc.forEach((n) => {
    if (n.type.name === ROW || n.type.name === COLUMN) any = true;
  });
  if (!any) return null;
  const lines: { type: string; depth: number }[] = [];
  const starts: number[] = [];
  let p = 0;
  let fromIndex = -1;
  let toIndex = -1;
  doc.forEach((n, _o, i) => {
    lines.push({ type: n.type.name, depth: depthOf(n) });
    starts.push(p);
    const end = p + n.nodeSize;
    if (end > changed.from && p <= changed.to) {
      if (fromIndex < 0) fromIndex = i;
      toIndex = i;
    }
    p = end;
  });
  if (fromIndex < 0) {
    fromIndex = Math.max(0, lines.length - 1);
    toIndex = fromIndex;
  }
  // The lines around an edit count too: removing a column's last line leaves the empty column just before it.
  const lo = Math.max(0, fromIndex - 1);
  const hi = Math.min(lines.length - 1, toIndex + 1);
  const repaired = repairColumnLines(lines, (s, e) => s <= hi && e > lo);
  if (!repaired) return null;
  // Replace the stretch that changed.
  let first = 0;
  while (first < repaired.length && first < lines.length && repaired[first]!.from === first && repaired[first]!.depth === lines[first]!.depth) first++;
  let tailOut = repaired.length - 1;
  let tailIn = lines.length - 1;
  while (tailOut >= first && tailIn >= first && repaired[tailOut]!.from === tailIn && repaired[tailOut]!.depth === lines[tailIn]!.depth) {
    tailOut--;
    tailIn--;
  }
  const nodes: PMNode[] = [];
  for (let k = first; k <= tailOut; k++) {
    const r = repaired[k]!;
    nodes.push(r.from === null ? schema.nodes[COLUMN]!.create({ id: ulid(), depth: r.depth }) : withDepth(doc.child(r.from), r.depth));
  }
  const start = first < lines.length ? starts[first]! : doc.content.size;
  const end = tailIn + 1 < lines.length ? starts[tailIn + 1]! : doc.content.size;
  const tr = state.tr.replaceWith(start, Math.max(start, end), nodes);
  if (tr.doc.childCount === 0) tr.insert(0, schema.nodes.paragraph!.create({ id: ulid(), depth: 0 }));
  normalizeDepths(tr);
  // The caret stays where it was in its line (replacing the lines around it would otherwise move it).
  const { $from, $to, empty } = state.selection;
  const keep = (pos: number, $p: typeof $from): number | null => {
    const line = $p.depth >= 1 ? $p.index(0) : -1;
    const k = repaired.findIndex((r) => r.from === line);
    if (line < first || line > tailIn || k < 0) return null;
    // The line's new start: where the stretch starts, then the stretch's lines before it.
    let at = start;
    for (let i = first; i < k; i++) at += nodes[i - first]!.nodeSize;
    return at + (pos - starts[line]!);
  };
  const a = keep($from.pos, $from);
  const h = empty ? a : keep($to.pos, $to);
  const inText = (pos: number | null) => pos !== null && pos <= tr.doc.content.size && tr.doc.resolve(pos).parent.inlineContent;
  if (inText(a) && inText(h)) tr.setSelection(TextSelection.create(tr.doc, a!, h!));
  return tr;
}
