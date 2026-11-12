// A table block's data and the changes its tools make (pure, so the view and the tests share them). Rows and
// columns that move or go take the formulas that point at them along (remapTableFormulas), and the column
// settings and the saved view follow their columns.
import {
  LIMITS,
  canonicalJson,
  deleteIndexMap,
  evaluateTable,
  insertIndexMap,
  moveIndexMap,
  remapTableFormulas,
  tableCellText,
  totalsFormula,
  type InlineNode,
  type TableColumn,
  type TableOptions,
  type TableViewSettings,
  type TotalsFunction,
} from "@folevi/editor-schema";

export interface TableData {
  rows: InlineNode[][][];
  headerRow: boolean;
  totalsRow: boolean;
  columns: TableColumn[];
  view: TableViewSettings | null;
}

/** The table's data from its node attributes (missing settings read as none). */
export function tableData(attrs: Record<string, unknown>): TableData {
  const rows = Array.isArray(attrs.rows) && attrs.rows.length ? (attrs.rows as InlineNode[][][]) : [[[]]];
  return {
    rows,
    headerRow: attrs.headerRow !== false,
    totalsRow: attrs.totalsRow === true && rows.length >= 2,
    columns: Array.isArray(attrs.columns) ? (attrs.columns as TableColumn[]) : [],
    view: attrs.view && typeof attrs.view === "object" ? (attrs.view as TableViewSettings) : null,
  };
}

/** The node attributes for table data: settings that say nothing are left out (null), as old tables have them. */
export function tableAttrs(t: TableData): Record<string, unknown> {
  const width = t.rows[0]?.length ?? 1;
  const columns = t.columns.slice(0, width);
  const anyColumn = columns.some((c) => c && Object.keys(c).length);
  // A view never names a column the table doesn't have (the server would refuse it).
  const inRange = (c: number) => Number.isInteger(c) && c >= 0 && c < width;
  const sort = t.view?.sort && inRange(t.view.sort.column) ? t.view.sort : undefined;
  const filters = (t.view?.filters ?? []).filter((f) => inRange(f.column));
  const view = sort || filters.length ? { ...(sort ? { sort } : {}), ...(filters.length ? { filters } : {}) } : null;
  return {
    rows: t.rows,
    headerRow: t.headerRow,
    totalsRow: t.totalsRow && t.rows.length >= 2 ? true : null,
    columns: anyColumn ? Array.from({ length: Math.max(...columns.map((c, i) => (c && Object.keys(c).length ? i + 1 : 0))) }, (_, i) => columns[i] ?? {}) : null,
    view,
  };
}

export function tableOptions(t: TableData, today?: string): TableOptions {
  return { headerRow: t.headerRow, totalsRow: t.totalsRow, columns: t.columns, today };
}

export const width = (t: TableData) => t.rows[0]?.length ?? 1;

/** The last row people add to (the totals row stays last). */
const dataEnd = (t: TableData) => (t.totalsRow ? t.rows.length - 1 : t.rows.length);

const emptyRow = (w: number): InlineNode[][] => Array.from({ length: w }, () => []);

/** The view's columns after a column change; settings on a deleted column go. */
function mapView(view: TableViewSettings | null, map: (c: number) => number | null): TableViewSettings | null {
  if (!view) return null;
  const sortColumn = view.sort ? map(view.sort.column) : null;
  const filters = (view.filters ?? []).flatMap((f) => {
    const c = map(f.column);
    return c === null ? [] : [{ ...f, column: c }];
  });
  const next: TableViewSettings = {};
  if (view.sort && sortColumn !== null) next.sort = { ...view.sort, column: sortColumn };
  if (filters.length) next.filters = filters;
  return next.sort || next.filters ? next : null;
}

/** A new row at `at` (default: after the last data row, above the totals row). Null at the row limit. */
export function addRow(t: TableData, at = dataEnd(t)): TableData | null {
  if (t.rows.length >= LIMITS.maxTableRows) return null;
  const rows = [...t.rows.slice(0, at), emptyRow(width(t)), ...t.rows.slice(at)];
  // Whole columns already take new rows in; ranges that reach past `at` grow to include it.
  return { ...t, rows: remapTableFormulas(rows, { rows: insertIndexMap(at) }) };
}

export function deleteRow(t: TableData, i: number): TableData | null {
  if (t.rows.length <= 1 || i < 0 || i >= t.rows.length) return null;
  const totals = t.totalsRow && i === t.rows.length - 1;
  const rows = remapTableFormulas(
    t.rows.filter((_, r) => r !== i),
    { rows: deleteIndexMap(i) },
  );
  return { ...t, rows, totalsRow: t.totalsRow && !totals && rows.length >= 2 };
}

/** Moves row `i` one step; the totals row (and moving past it) stays put. */
export function moveRow(t: TableData, i: number, dir: -1 | 1): TableData | null {
  return moveRowTo(t, i, i + dir);
}

/**
 * Moves row `from` so it ends up at index `to` (a drag), in one step: the rows between shift by one and the
 * formulas follow. The totals row stays last, and nothing moves past it. Null when nothing would change.
 */
export function moveRowTo(t: TableData, from: number, to: number): TableData | null {
  const n = t.rows.length;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to || from < 0 || to < 0 || from >= n || to >= n) return null;
  if (t.totalsRow && (from === n - 1 || to === n - 1)) return null;
  const rows = [...t.rows];
  const [row] = rows.splice(from, 1);
  rows.splice(to, 0, row!);
  return { ...t, rows: remapTableFormulas(rows, { rows: moveIndexMap(from, to) }) };
}

export function addColumn(t: TableData, at = width(t)): TableData | null {
  if (width(t) >= LIMITS.maxTableColumns) return null;
  const rows = t.rows.map((r) => [...r.slice(0, at), [], ...r.slice(at)]);
  const columns = t.columns.length > at ? [...t.columns.slice(0, at), {}, ...t.columns.slice(at)] : t.columns;
  const map = insertIndexMap(at);
  return { ...t, rows: remapTableFormulas(rows, { cols: map }), columns, view: mapView(t.view, map) };
}

export function deleteColumn(t: TableData, i: number): TableData | null {
  if (width(t) <= 1) return null;
  const rows = t.rows.map((r) => r.filter((_, c) => c !== i));
  const map = deleteIndexMap(i);
  return { ...t, rows: remapTableFormulas(rows, { cols: map }), columns: t.columns.filter((_, c) => c !== i), view: mapView(t.view, map) };
}

export function moveColumn(t: TableData, i: number, dir: -1 | 1): TableData | null {
  return moveColumnTo(t, i, i + dir);
}

/**
 * Moves column `from` so it ends up at index `to` (a drag), in one step: its settings (format, width), the
 * saved view and the formulas follow. Null when nothing would change.
 */
export function moveColumnTo(t: TableData, from: number, to: number): TableData | null {
  const w = width(t);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to || from < 0 || to < 0 || from >= w || to >= w) return null;
  const move = <T,>(list: T[]) => {
    const next = [...list];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x!);
    return next;
  };
  const columns = move(Array.from({ length: w }, (_, k) => t.columns[k] ?? {}));
  const map = moveIndexMap(from, to);
  return { ...t, rows: remapTableFormulas(t.rows.map(move), { cols: map }), columns, view: mapView(t.view, map) };
}

/** Sets one cell. */
export function setCell(t: TableData, r: number, c: number, cell: InlineNode[]): TableData {
  return { ...t, rows: t.rows.map((row, ri) => (ri === r ? row.map((old, ci) => (ci === c ? cell : old)) : row)) };
}

/** A column's settings changed (an empty object clears them). */
export function setColumn(t: TableData, c: number, settings: TableColumn): TableData {
  const columns = Array.from({ length: Math.max(t.columns.length, c + 1) }, (_, i) => (i === c ? settings : (t.columns[i] ?? {})));
  return { ...t, columns };
}

/** A column width people can set: whole pixels within the limits. */
export const clampColumnWidth = (px: number) => Math.min(LIMITS.maxTableColumnWidth, Math.max(LIMITS.minTableColumnWidth, Math.round(px)));

/** A column's width in pixels (null: automatic again, as wide as its content needs). Its other settings stay. */
export function setColumnWidth(t: TableData, c: number, px: number | null): TableData | null {
  if (c < 0 || c >= width(t)) return null;
  const { width: old, ...rest } = t.columns[c] ?? {};
  const next = px === null || !Number.isFinite(px) ? undefined : clampColumnWidth(px);
  if ((old ?? undefined) === next) return null;
  return setColumn(t, c, next === undefined ? rest : { ...rest, width: next });
}

/** What a total adds up for a column, guessed from its data: numbers are summed, anything else counted. */
export function defaultTotal(t: TableData, c: number): TotalsFunction | null {
  const evaluated = evaluateTable(t.rows, tableOptions(t));
  let numbers = 0;
  let filled = 0;
  for (const r of evaluated.bodyRows) {
    const cell = evaluated.cells[r]?.[c];
    if (!cell || cell.kind === "empty") continue;
    filled++;
    if (cell.kind === "number") numbers++;
  }
  if (numbers && numbers >= filled / 2) return "SUM";
  return null;
}

/**
 * The totals row on or off. On: a new last row whose cells add up each numeric column (=SUM(B:B)) and say
 * "Total" in the first; off: the totals row goes.
 */
export function setTotalsRow(t: TableData, on: boolean): TableData | null {
  if (on === t.totalsRow) return null;
  if (!on) return { ...t, rows: t.rows.slice(0, -1), totalsRow: false };
  if (t.rows.length >= LIMITS.maxTableRows) return null;
  const w = width(t);
  const row: InlineNode[][] = Array.from({ length: w }, (_, c) => {
    const fn = defaultTotal(t, c);
    if (fn) return [{ type: "text", text: totalsFormula(fn, c) }];
    return c === 0 ? [{ type: "text", text: "Total" }] : [];
  });
  return { ...t, rows: [...t.rows, row], totalsRow: true };
}

/** The saved view changed (null clears it). */
export function setView(t: TableData, view: TableViewSettings | null): TableData {
  return { ...t, view: view && (view.sort || view.filters?.length) ? view : null };
}

/**
 * Cells pasted from a spreadsheet written in from (r, c) on, growing the table as far as its limits allow.
 * A pasted cell's text replaces the cell; formulas are kept as written.
 */
export function pasteGrid(t: TableData, r0: number, c0: number, grid: InlineNode[][][]): TableData {
  if (!grid.length) return t;
  let next = t;
  const needRows = r0 + grid.length - (next.totalsRow ? next.rows.length - 1 : next.rows.length);
  for (let i = 0; i < needRows; i++) next = addRow(next) ?? next;
  const needCols = c0 + Math.max(...grid.map((g) => g.length)) - width(next);
  for (let i = 0; i < needCols; i++) next = addColumn(next) ?? next;
  const rows = next.rows.map((row, r) =>
    row.map((cell, c) => {
      const g = grid[r - r0]?.[c - c0];
      return g === undefined ? cell : g;
    }),
  );
  return { ...next, rows };
}

/** Whether a cell's text is a formula. */
export const cellIsFormula = (cell: InlineNode[] | undefined) => /^\s*=/.test(tableCellText(cell ?? []));

// ------------------------------------------------------------------------------------- a range of cells
// A range is the rows as they show (the view's order, so a sorted or filtered table selects what is seen)
// by a run of columns: `rows` are the stored rows' indexes in that order, `c0` to `c1` the columns.

/** Empties the cells of a range. Null when they were all empty already (nothing to undo). */
export function clearCells(t: TableData, rows: readonly number[], c0: number, c1: number): TableData | null {
  const hit = new Set(rows);
  let changed = false;
  const next = t.rows.map((row, r) =>
    hit.has(r)
      ? row.map((cell, c) => {
          if (c < c0 || c > c1 || !cell.length) return cell;
          changed = true;
          return [];
        })
      : row,
  );
  return changed ? { ...t, rows: next } : null;
}

/** Every cell of a range set to what `cell(r, c)` gives (one copied value pasted over several cells). */
export function fillCells(t: TableData, rows: readonly number[], c0: number, c1: number, cell: (r: number, c: number) => InlineNode[]): TableData {
  const hit = new Set(rows);
  return { ...t, rows: t.rows.map((row, r) => (hit.has(r) ? row.map((old, c) => (c < c0 || c > c1 ? old : cell(r, c))) : row)) };
}

/**
 * Formulas of copied cells moved with them: a cell pasted `dr` rows down and `dc` columns across points at
 * cells that far from the ones it pointed at, as in a spreadsheet. A reference that would leave the sheet
 * is #REF!. Cells that aren't formulas are kept as they are.
 */
export function shiftGridFormulas(grid: InlineNode[][][], dr: number, dc: number): InlineNode[][][] {
  if (!dr && !dc) return grid;
  const move = (by: number, limit: number) => (i: number) => (i + by >= 0 && i + by < limit ? i + by : null);
  return remapTableFormulas(grid, { rows: move(dr, LIMITS.maxTableRows), cols: move(dc, LIMITS.maxTableColumns) });
}

/**
 * A grid pasted where the rows show: its first row lands on `shown[0]`, the next on `shown[1]` and so on
 * (`shown` is the view's order from the paste's first row down), so pasting into a sorted or filtered table
 * fills the rows that are seen, not the ones stored after them. Rows past the last one shown are added at
 * the end, above the totals row, which is never written over.
 */
export function pasteGridShown(t: TableData, shown: readonly number[], c0: number, grid: InlineNode[][][]): TableData {
  if (!grid.length || !shown.length) return t;
  const totals = t.totalsRow ? t.rows.length - 1 : -1;
  const first = shown[0]!;
  const stop = shown.indexOf(totals);
  const targets = (stop < 0 ? shown : shown.slice(0, stop)).slice(0, grid.length);
  // Rows showing one after another as they are stored, down to the last: the plain paste does it all.
  if (targets.every((r, i) => r === first + i) && (targets.length === grid.length || first + targets.length === dataEnd(t))) return pasteGrid(t, first, c0, grid);
  let next = t;
  const needCols = c0 + Math.max(...grid.map((g) => g.length)) - width(next);
  for (let i = 0; i < needCols; i++) next = addColumn(next) ?? next;
  const at = new Map(targets.map((r, i) => [r, i]));
  next = { ...next, rows: next.rows.map((row, r) => (at.has(r) ? row.map((cell, c) => grid[at.get(r)!]?.[c - c0] ?? cell) : row)) };
  const rest = grid.slice(targets.length);
  return rest.length ? pasteGrid(next, dataEnd(next), c0, rest) : next;
}

// ------------------------------------------------------------------------- the open cell keeping its row
// Cells are addressed by row and column number. When rows or columns are added, removed or moved by
// something other than this view (another device, the note's undo), the numbers under an open cell change
// meaning: without this, typing would carry on in whichever row now has the old number.

/** What tells a cell apart. A formula is only "a formula": moving rows rewrites its references. */
const cellKey = (cell: InlineNode[] | undefined) => (cellIsFormula(cell) ? "=" : cell?.length ? canonicalJson(cell) : "");

/**
 * Where item `i` of `prev` is in `next`, both lists of keys. What is the same from the top and from the
 * bottom has not moved (it only shifts by what was added or removed before it). In the part that changed,
 * the item is found by its key; among equal keys, the same one counting from the top. An item that isn't
 * found is the same one edited in place when nothing was added or removed, and gone (null) otherwise.
 */
function followIndex(prev: readonly string[], next: readonly string[], i: number): number | null {
  if (i < 0 || i >= prev.length) return null;
  const most = Math.min(prev.length, next.length);
  let top = 0;
  while (top < most && prev[top] === next[top]) top++;
  if (i < top) return i;
  let bottom = 0;
  while (bottom < most - top && prev[prev.length - 1 - bottom] === next[next.length - 1 - bottom]) bottom++;
  if (i >= prev.length - bottom) return i + next.length - prev.length;
  const key = prev[i]!;
  let nth = 0;
  for (let k = top; k < i; k++) if (prev[k] === key) nth++;
  const found: number[] = [];
  for (let k = top; k < next.length - bottom; k++) if (next[k] === key) found.push(k);
  if (found.length) return found[Math.min(nth, found.length - 1)]!;
  return prev.length === next.length ? i : null;
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameItems = (a: readonly string[], b: readonly string[]) => sameList([...a].sort(), [...b].sort());

/**
 * Where the cell at (r, c) of `prevRows` is in `nextRows`, after a change this view did not make: the row
 * and the column are found by their content, so a row added, removed or moved above the open cell doesn't
 * leave it editing another row. Null when its row or column is gone (the cell closes).
 */
export function followCell(prevRows: InlineNode[][][], nextRows: InlineNode[][][], r: number, c: number): { r: number; c: number } | null {
  const ph = prevRows.length;
  const nh = nextRows.length;
  const pw = prevRows[0]?.length ?? 0;
  const nw = nextRows[0]?.length ?? 0;
  if (r < 0 || c < 0 || r >= ph || c >= pw) return null;
  if (prevRows === nextRows) return { r, c };
  // Rows are told apart over the columns both tables have, columns over the rows both have.
  const rowKeys = (rows: InlineNode[][][], w: number) => rows.map((row) => row.slice(0, w).map(cellKey).join("\u0001"));
  const colKeys = (rows: InlineNode[][][], w: number, h: number) => Array.from({ length: w }, (_, k) => rows.slice(0, h).map((row) => cellKey(row[k])).join("\u0001"));
  if (ph === nh && pw === nw) {
    // Nothing added or removed: the cell stays, unless the same rows (or columns) are now in another order.
    const pr = rowKeys(prevRows, pw);
    const nr = rowKeys(nextRows, nw);
    if (sameList(pr, nr)) return { r, c };
    if (sameItems(pr, nr)) return { r: followIndex(pr, nr, r) ?? r, c };
    const pc = colKeys(prevRows, pw, ph);
    const nc = colKeys(nextRows, nw, nh);
    if (!sameList(pc, nc) && sameItems(pc, nc)) return { r, c: followIndex(pc, nc, c) ?? c };
    return { r, c };
  }
  const w = Math.min(pw, nw);
  const h = Math.min(ph, nh);
  const row = ph === nh ? r : followIndex(rowKeys(prevRows, w), rowKeys(nextRows, w), r);
  const col = pw === nw ? c : followIndex(colKeys(prevRows, pw, h), colKeys(nextRows, nw, h), c);
  return row === null || col === null ? null : { r: row, c: col };
}
