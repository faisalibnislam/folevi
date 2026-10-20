// Columns side by side in a flat editor. ProseMirror keeps the note one flat list of lines (that's what
// syncing, history, selection and every command rely on), so a row's lines can't be wrapped in a box of
// their own. Instead the row's line reserves the row's height, and each column's lines are placed over it:
// a stylesheet keyed by block id (never ProseMirror's DOM, so the editor doesn't re-read anything) gives
// every line its column's left edge and width and its top, worked out from the heights the lines have at that
// width. It runs after every update and whenever a line's size changes (an image loading, a chart drawing).
// Below a sensible width (a phone) nothing is placed: the columns' lines simply follow each other.
import type { EditorView } from "@tiptap/pm/view";
import { LIMITS } from "@folevi/editor-schema";
import { baseDepth, columnsModel, rowOf, type ColumnRow } from "./columnsModel";

/** Narrower than this, a row's columns stack (phones, a narrow window). */
export const STACK_BELOW = 520;
/** Nor is a column ever drawn narrower than this. */
const MIN_COLUMN_PX = 110;
/** The gap between columns, in the note's em: room for a line's grip and, in its middle, the resize handle. */
const GAP_EM = 4;
/** How wide the resize handle in a gap is. */
const GUTTER = 12;

export interface RowSnapshot {
  index: number;
  id: string;
  depth: number;
  stacked: boolean;
  /** Relative to the editor's padding box. */
  top: number;
  height: number;
  left: number;
  width: number;
  gap: number;
  columns: { index: number; left: number; width: number; items: number[] }[];
}

interface Snapshot {
  rows: RowSnapshot[];
}

const registry = new WeakMap<HTMLElement, Snapshot>();
const views = new WeakMap<HTMLElement, ColumnsLayoutView>();
let scopes = 0;

/** The editor whose view this is drew its rows last as this (for hit tests: the block handle, drag and drop). */
export function columnsSnapshot(dom: HTMLElement): Snapshot | null {
  return registry.get(dom) ?? null;
}

/** The layout of an editor (for a live resize). */
export function columnsLayoutOf(dom: HTMLElement): ColumnsLayoutView | null {
  return views.get(dom) ?? null;
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

export class ColumnsLayoutView {
  private readonly style: HTMLStyleElement;
  private readonly scope: string;
  private readonly resize: ResizeObserver | null;
  private observed = new Set<Element>();
  private frame = 0;
  private tops = new Map<string, number>();
  private text = "";
  /** Shares shown while a gap is being dragged (not saved yet). */
  private preview: { rowId: string; shares: number[] } | null = null;

  constructor(private view: EditorView) {
    this.scope = `c${++scopes}`;
    view.dom.setAttribute("data-fb-cols", this.scope);
    this.style = document.createElement("style");
    this.style.dataset.fbColumns = this.scope;
    document.head.appendChild(this.style);
    this.resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => this.schedule());
    this.resize?.observe(view.dom);
    views.set(view.dom as HTMLElement, this);
    this.layout();
  }

  update(view: EditorView) {
    this.view = view;
    // Now, before the browser paints (a frame later every placed line would jump).
    this.layout();
  }

  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resize?.disconnect();
    this.style.remove();
    registry.delete(this.view.dom as HTMLElement);
    views.delete(this.view.dom as HTMLElement);
  }

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.layout();
    });
  }

  /** Draws a row with these shares until `null` (while its gap is dragged). */
  setPreview(preview: { rowId: string; shares: number[] } | null) {
    this.preview = preview;
    this.layout();
  }

  private sel(id: string) {
    return `.fb-editor[data-fb-cols="${this.scope}"] > [data-block-id="${CSS.escape(id)}"]`;
  }

  private write(text: string) {
    if (text === this.text) return;
    this.text = text;
    this.style.textContent = text;
  }

  layout() {
    const view = this.view;
    const dom = view.dom as HTMLElement;
    if (!dom.isConnected) return;
    const { doc } = view.state;
    const model = columnsModel(doc);
    if (!model.rows.length) {
      this.write("");
      registry.delete(dom);
      this.observe([]);
      return;
    }
    // The editor is what the placed lines are positioned in: before anything is measured.
    const base = `.fb-editor[data-fb-cols="${this.scope}"]{position:relative}`;
    if (!this.text) this.write(base);
    const fontSize = parseFloat(getComputedStyle(dom).fontSize) || 16;
    const gap = GAP_EM * fontSize;
    const editorWidth = dom.clientWidth;
    type Item = { id: string; el: HTMLElement; column: number; rel: number; index: number };
    const plans: { row: ColumnRow; marker: HTMLElement; snap: RowSnapshot; items: Item[] }[] = [];
    const rules: string[] = [base];
    const watched: Element[] = [];
    for (const row of model.rows) {
      const marker = view.nodeDOM(row.pos) as HTMLElement | null;
      if (!marker || !row.id || !(marker instanceof HTMLElement)) continue;
      const items: Item[] = [];
      const lineRules: string[] = [];
      row.columns.forEach((c, k) => {
        if (c.index >= 0 && c.id) lineRules.push(c.id);
        for (let i = c.start; i < c.end; i++) {
          const node = doc.child(i);
          const id = node.attrs.id as string | null;
          const el = view.nodeDOM(model.starts[i]!) as HTMLElement | null;
          if (!id || !(el instanceof HTMLElement)) continue;
          items.push({ id, el, column: k, rel: Math.max(0, Number(node.attrs.depth ?? 0) - baseDepth(row)), index: i });
        }
      });
      // A column's lines are indented from the column's edge, not the page's (and not by a tab's lift).
      for (const it of items) rules.push(`${this.sel(it.id)}{--depth:${it.rel}!important;--lift:0!important}`);
      // An empty column says where to write (the caret's own line shows the usual hint instead).
      if (view.editable)
        for (const c of row.columns) {
          const only = c.end === c.start + 1 ? doc.child(c.start) : null;
          const id = only?.attrs.id as string | null | undefined;
          if (only?.type.name === "paragraph" && !only.content.size && id)
            rules.push(`${this.sel(id)}:not(.is-empty)::before{content:"Write here";color:var(--color-ink-faint);float:left;height:0;pointer-events:none}`);
        }
      const hidden = marker.offsetParent === null;
      const width = marker.offsetWidth;
      const n = row.columns.length;
      const stacked = hidden || n < 2 || width < STACK_BELOW || (width - gap * (n - 1)) / n < MIN_COLUMN_PX;
      const snap: RowSnapshot = { index: row.index, id: row.id, depth: row.depth, stacked, top: marker.offsetTop, height: 0, left: marker.offsetLeft, width, gap, columns: [] };
      if (stacked) {
        // One after another: a little room between columns, and the row's line takes no room.
        row.columns.forEach((c, k) => {
          if (k > 0 && c.id) rules.push(`${this.sel(c.id)}{height:0.75em}`);
        });
        marker.style.height = "";
        marker.dataset.stacked = "true";
        plans.push({ row, marker, snap, items: [] });
        continue;
      }
      delete marker.dataset.stacked;
      const shares = this.preview?.rowId === row.id && this.preview.shares.length === n ? this.preview.shares : row.shares;
      const avail = width - gap * (n - 1);
      let x = snap.left;
      for (let k = 0; k < n; k++) {
        const w = avail * shares[k]!;
        const c = row.columns[k]!;
        snap.columns.push({ index: c.index, left: x, width: w, items: [] });
        x += w + gap;
      }
      for (const it of items) {
        const col = snap.columns[it.column]!;
        rules.push(`${this.sel(it.id)}{position:absolute!important;left:${px(col.left)};right:${px(editorWidth - col.left - col.width)};width:auto}`);
        watched.push(it.el);
      }
      for (const id of lineRules) {
        const k = row.columns.findIndex((c) => c.id === id);
        const col = snap.columns[k]!;
        rules.push(`${this.sel(id)}{position:absolute!important;left:${px(col.left)};width:${px(col.width)};top:${px(snap.top)};height:0;overflow:hidden;visibility:hidden}`);
      }
      plans.push({ row, marker, snap, items });
    }
    // Widths first (with the tops worked out last time), then each line's height at its width gives the tops.
    const topRule = (it: { id: string }, top: number) => `${this.sel(it.id)}{top:${px(top)}}`;
    const withTops = (tops: Map<string, number>) => [...rules, ...plans.flatMap((p) => p.items.map((it) => topRule(it, tops.get(it.id) ?? p.snap.top)))].join("\n");
    this.write(withTops(this.tops));
    const tops = new Map<string, number>();
    for (const p of plans) {
      if (p.snap.stacked) continue;
      const heights = new Array(p.snap.columns.length).fill(0);
      const lastMargin = new Array(p.snap.columns.length).fill(0);
      for (const it of p.items) {
        const col = p.snap.columns[it.column]!;
        if (it.el.classList.contains("fb-hidden") || it.el.offsetParent === null) continue;
        const cs = getComputedStyle(it.el);
        const mt = parseFloat(cs.marginTop) || 0;
        const mb = parseFloat(cs.marginBottom) || 0;
        const h = it.el.offsetHeight;
        // Margins between lines meet (the larger one counts), as they would one under another.
        const y = col.items.length ? heights[it.column]! + Math.max(lastMargin[it.column]!, mt) - mt : 0;
        tops.set(it.id, p.snap.top + y);
        heights[it.column] = y + mt + h;
        lastMargin[it.column] = mb;
        col.items.push(it.index);
      }
      const height = Math.max(fontSize * 1.65, ...heights.map((h, k) => h + lastMargin[k]!));
      p.snap.height = height;
      const want = px(height);
      if (p.marker.style.height !== want) p.marker.style.height = want;
    }
    this.tops = tops;
    this.write(withTops(tops));
    // The row's own line moved (its height above changed): the tops were measured from the old place.
    for (const p of plans) {
      if (!p.snap.stacked && p.marker.offsetTop !== p.snap.top) {
        this.schedule();
        break;
      }
    }
    for (const p of plans) placeGutters(p.marker, p.snap, view.editable);
    registry.set(dom, { rows: plans.map((p) => p.snap) });
    this.observe(watched);
  }

  private observe(els: Element[]) {
    if (!this.resize) return;
    const next = new Set(els);
    for (const el of this.observed) if (!next.has(el)) this.resize.unobserve(el);
    for (const el of next) if (!this.observed.has(el)) this.resize.observe(el);
    this.observed = next;
  }
}

/** The handles in the gaps between columns (in the row's line, which this view owns). */
function placeGutters(marker: HTMLElement, snap: RowSnapshot, editable: boolean) {
  const want = editable && !snap.stacked ? snap.columns.length - 1 : 0;
  const existing = [...marker.querySelectorAll<HTMLElement>(":scope > .fb-columns-gutter")];
  for (let k = existing.length; k < want; k++) {
    const g = document.createElement("div");
    g.className = "fb-columns-gutter";
    g.setAttribute("role", "separator");
    g.setAttribute("aria-orientation", "vertical");
    g.setAttribute("aria-label", "Resize columns");
    g.tabIndex = 0;
    marker.appendChild(g);
    existing.push(g);
  }
  existing.forEach((g, k) => {
    if (k >= want) {
      g.remove();
      return;
    }
    const a = snap.columns[k]!;
    const center = a.left + a.width + snap.gap / 2 - snap.left;
    g.dataset.gap = String(k);
    // A narrow strip in the middle of the gap (the right of the gap is the next column's grip).
    g.style.left = px(center - GUTTER / 2);
    g.style.width = px(GUTTER);
    g.style.height = px(snap.height);
    const share = Math.round((a.width / (snap.width - snap.gap * (snap.columns.length - 1))) * 100);
    g.setAttribute("aria-valuenow", String(share));
    g.setAttribute("aria-valuemin", "10");
    g.setAttribute("aria-valuemax", "90");
    g.setAttribute("aria-valuetext", `Column ${k + 1}: ${share}% of the row`);
  });
}

/**
 * The note's line under (x, y) when that's in a row drawn side by side: the line of the column there that
 * holds y, or the row's own line over the row's empty space. -1 when (x, y) isn't in such a row.
 */
export function columnsBlockAt(dom: HTMLElement, children: HTMLElement[], x: number, y: number): number {
  const snap = registry.get(dom);
  if (!snap) return -1;
  const r = dom.getBoundingClientRect();
  const ox = r.left + dom.clientLeft;
  const oy = r.top + dom.clientTop;
  for (const row of snap.rows) {
    if (row.stacked) continue;
    const top = oy + row.top;
    if (y < top - 2 || y > top + row.height + 2) continue;
    const col = nearestColumn(row, x - ox);
    if (!col) return row.index;
    for (const i of col.items) {
      const el = children[i];
      if (!el || el.classList.contains("fb-hidden")) continue;
      const b = el.getBoundingClientRect();
      if (y >= b.top - 2 && y <= b.bottom + 2) return i;
    }
    return row.index;
  }
  return -1;
}

/** Whether a line sits in a column after the first of a row drawn side by side (its handle is in the gap). */
export function columnsGripOnly(dom: HTMLElement, index: number): boolean {
  const snap = registry.get(dom);
  return Boolean(snap?.rows.some((r) => !r.stacked && r.columns.some((c, k) => k > 0 && c.items.includes(index))));
}

function nearestColumn(row: RowSnapshot, x: number) {
  let best: RowSnapshot["columns"][number] | null = null;
  let dist = Infinity;
  for (const c of row.columns) {
    const d = x < c.left ? c.left - x : x > c.left + c.width ? x - c.left - c.width : 0;
    if (d < dist) {
      dist = d;
      best = c;
    }
  }
  return best;
}

/** Making a row, or adding a column to one, by dropping a block beside another (see columnsCommands.ts). */
export type SideDrop = { kind: "new"; target: number; side: "left" | "right" } | { kind: "add"; row: number; at: number };

export interface ColumnsDropTarget {
  /** Before which line, at what depth (a move into a column; for a side drop, where it would go otherwise). */
  index: number;
  depth: number;
  side?: SideDrop;
  /** The drop line, in the window's coordinates. */
  line: { x: number; y: number; length: number; vertical: boolean };
}

/**
 * Where a dragged block lands when the pointer is over a row drawn side by side (a place in the column under
 * it, or a new column in a gap or at either end), or beside a block outside rows (a new row of the two). Null:
 * the usual top-to-bottom drop. `source` is the dragged lines (null when inserting something new).
 */
export function columnsDropAt(view: EditorView, x: number, y: number, source: { from: number; count: number } | null, children: HTMLElement[]): ColumnsDropTarget | null {
  const dom = view.dom as HTMLElement;
  const { doc } = view.state;
  const snap = registry.get(dom);
  const r = dom.getBoundingClientRect();
  const ox = r.left + dom.clientLeft;
  const oy = r.top + dom.clientTop;
  const fontSize = parseFloat(getComputedStyle(dom).fontSize) || 16;
  const indent = fontSize * 1.6;
  const inSource = (i: number) => source !== null && i >= source.from && i < source.from + source.count;
  const sourceSpan = source ? spanDepth(view, source.from, source.count) : 0;
  const model = columnsModel(doc);
  for (const row of snap?.rows ?? []) {
    if (row.stacked) continue;
    const top = oy + row.top;
    if (y < top || y > top + row.height) continue;
    // The row itself (or what it's in) is being dragged: the usual rules (it can't go into itself).
    if (inSource(row.index)) return null;
    const live = model.rows.find((m) => m.index === row.index);
    if (!live) return null;
    const n = row.columns.length;
    const lx = x - ox;
    const fits = baseDepth(live) + sourceSpan <= LIMITS.maxDepth;
    const lineOf = (atX: number): ColumnsDropTarget["line"] => ({ x: ox + atX, y: top, length: row.height, vertical: true });
    // In a gap or past either end: a new column there.
    if (source && fits && n < LIMITS.maxColumns) {
      const first = row.columns[0]!;
      const last = row.columns[n - 1]!;
      let at = -1;
      let lineX = 0;
      if (lx < first.left - 12) [at, lineX] = [0, first.left - Math.min(12, row.gap / 4)];
      else if (lx > last.left + last.width + 12) [at, lineX] = [n, last.left + last.width + Math.min(12, row.gap / 4)];
      else
        for (let k = 0; k < n - 1; k++) {
          const a = row.columns[k]!;
          const b = row.columns[k + 1]!;
          if (lx > a.left + a.width + 6 && lx < b.left - 6) [at, lineX] = [k + 1, (a.left + a.width + b.left) / 2];
        }
      if (at >= 0) return { index: at < n ? live.columns[at]!.index : live.end, depth: live.depth + 1, side: { kind: "add", row: row.index, at }, line: lineOf(lineX) };
    }
    if (!fits) return null;
    // Into the column under the pointer: before the first of its lines below the pointer's middle.
    const k = row.columns.indexOf(nearestColumn(row, lx)!);
    const col = row.columns[k]!;
    const info = live.columns[k]!;
    const base = baseDepth(live);
    let index = info.end;
    let lineY = top;
    let above: number | null = null;
    for (let i = info.start; i < info.end; i++) {
      if (inSource(i)) continue;
      const el = children[i];
      if (!el || el.classList.contains("fb-hidden")) continue;
      const b = el.getBoundingClientRect();
      if (y < b.top + b.height / 2) {
        index = i;
        lineY = b.top;
        break;
      }
      above = i;
      lineY = b.bottom;
    }
    const aboveRel = above === null ? -1 : Number(doc.child(above).attrs.depth ?? 0) - base;
    const want = Math.floor((lx - col.left) / indent) - 1;
    const rel = Math.max(0, Math.min(aboveRel + 1, want, LIMITS.maxDepth - base - sourceSpan));
    const left = ox + col.left + rel * indent;
    return { index, depth: base + rel, line: { x: left, y: lineY, length: Math.max(48, col.width - rel * indent), vertical: false } };
  }
  // Beside a block outside rows: a new row of the two (only where the row would show side by side).
  if (!source || dom.clientWidth < STACK_BELOW) return null;
  for (let i = 0; i < children.length; i++) {
    const el = children[i]!;
    if (inSource(i) || el.classList.contains("fb-hidden") || el.hasAttribute("data-fb-widget")) continue;
    const b = el.getBoundingClientRect();
    if (y < b.top || y > b.bottom) continue;
    const node = doc.maybeChild(i);
    if (!node || node.type.name === "columns" || node.type.name === "column" || rowOf(doc, i)) return null;
    const depth = Number(node.attrs.depth ?? 0);
    const contentLeft = b.left - (parseFloat(getComputedStyle(el).marginLeft) || 0) + depth * indent;
    if (b.right - contentLeft < STACK_BELOW) return null;
    const side = x > b.right - 24 && x < b.right + 240 ? "right" : x < contentLeft - 48 && x > contentLeft - 240 ? "left" : null;
    if (!side) return null;
    // Both blocks (with what's nested under them) go two levels in.
    if (depth + 2 + Math.max(spanDepth(view, i, subtreeCount(view, i)), sourceSpan) > LIMITS.maxDepth) return null;
    const lineX = side === "right" ? b.right + 4 : contentLeft - 10;
    return { index: i, depth, side: { kind: "new", target: i, side }, line: { x: lineX, y: b.top, length: b.height, vertical: true } };
  }
  return null;
}

/** How many lines the block at `index` spans with what's nested under it. */
function subtreeCount(view: EditorView, index: number): number {
  const { doc } = view.state;
  const d = Number(doc.child(index).attrs.depth ?? 0);
  let j = index + 1;
  while (j < doc.childCount && Number(doc.child(j).attrs.depth ?? 0) > d) j++;
  return j - index;
}

/** How many levels lines `from`..`from + count` reach below the first of them. */
function spanDepth(view: EditorView, from: number, count: number): number {
  const { doc } = view.state;
  const first = doc.maybeChild(from);
  if (!first) return 0;
  const d = Number(first.attrs.depth ?? 0);
  let max = 0;
  for (let i = from; i < Math.min(doc.childCount, from + count); i++) max = Math.max(max, Number(doc.child(i).attrs.depth ?? 0) - d);
  return max;
}

/**
 * A top-to-bottom drop next to a row (a stacked one, or just above or below one): what's dropped among a
 * column's lines stays in the column (at least at the column's own level), right after the row's line it goes
 * into the first column, and just after the row it goes after the row unless it's dropped at a column's level.
 */
export function clampDropToColumns(view: EditorView, index: number, depth: number): { index: number; depth: number } {
  const { doc } = view.state;
  for (const row of columnsModel(doc).rows) {
    const base = baseDepth(row);
    if (index > row.index && index < row.end) {
      if (index === row.index + 1 && row.columns[0]?.index === row.index + 1) return { index: row.index + 2, depth: Math.max(depth, base) };
      return { index, depth: Math.max(depth, base) };
    }
    if (index === row.end && depth > row.depth && depth < base) return { index, depth: row.depth };
  }
  return { index, depth };
}
