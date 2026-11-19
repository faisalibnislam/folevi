// A table block's data and the changes its tools make (pure, so the view and the tests share them). Rows and
// columns that move or go take the formulas that point at them along (remapTableFormulas), and the column
// settings and the saved view follow their columns.
import {
  LIMITS,
  TABLE_LIMITS,
  canonicalJson,
  deleteIndexMap,
  evaluateTable,
  insertIndexMap,
  jsonBytes,
  moveIndexMap,
  remapTableFormulas,
  tableCellText,
  tableColumnNames,
  totalsFormula,
  type EvaluatedCell,
  type EvaluatedTable,
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

// --------------------------------------------------------------------------------------- how much it holds
// A table is stored whole, as one block, and a block has a most it can weigh (TABLE_LIMITS in the schema says
// why). Typing and pasting stop at the editor's limits: a cell as long as a paragraph may be, and rows of
// 400,000 bytes. A table already past them (made before there were limits) can still be edited, as long as a
// change doesn't make it larger.

// A row's bytes, kept by the row itself: a change makes new rows only where it changes something (setCell),
// so measuring a table after a key is one row measured and the rest added up.
const ROW_BYTES = new WeakMap<object, number>();
const rowBytes = (row: InlineNode[][]) => {
  let n = ROW_BYTES.get(row);
  if (n === undefined) {
    n = jsonBytes(row);
    ROW_BYTES.set(row, n);
  }
  return n;
};

/** The table's rows as bytes of JSON (what TABLE_LIMITS.dataBytes counts). */
export function tableBytes(rows: InlineNode[][][]): number {
  // The rows, the commas between them and the two brackets round them.
  let n = 2 + Math.max(0, rows.length - 1);
  for (const row of rows) n += rowBytes(row);
  return n;
}

/** Why a change can't be made: a cell would hold too much text, or the table as a whole would. */
export type TableFull = "cell" | "table";

/**
 * Whether `after` may replace `before`: null when it may, else what is full. Only what grew counts: a cell
 * that was already too long may be edited shorter, and a table already too large may lose text.
 */
export function tableFull(before: TableData, after: TableData): TableFull | null {
  if (after.rows === before.rows) return null;
  for (let r = 0; r < after.rows.length; r++) {
    const row = after.rows[r]!;
    const old = before.rows[r];
    if (row === old) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c]!;
      if (cell === old?.[c] || !cell.length) continue;
      const length = tableCellText(cell).length;
      if (length > TABLE_LIMITS.cellLength && length > tableCellText(old?.[c] ?? []).length) return "cell";
    }
  }
  const bytes = tableBytes(after.rows);
  return bytes > TABLE_LIMITS.dataBytes && bytes > tableBytes(before.rows) ? "table" : null;
}

/** What to tell someone whose typing or paste was refused. */
export function tableFullMessage(full: TableFull): string {
  return full === "cell" ? `A cell holds up to ${TABLE_LIMITS.cellLength.toLocaleString("en-US")} characters. The text wasn't added.` : "This table is full. Remove some text to make room.";
}

/** Sets one cell, if there is room for it (see tableFull): null when the cell or the table would be too large. */
export function setCellIfRoom(t: TableData, r: number, c: number, cell: InlineNode[]): TableData | null {
  const next = setCell(t, r, c, cell);
  return tableFull(t, next) ? null : next;
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

/** A grid written into a table: the table, and how many of the grid's rows and columns went in. */
interface Written {
  table: TableData;
  rows: number;
  columns: number;
}

const gridWidth = (grid: InlineNode[][][]) => Math.max(0, ...grid.map((g) => g.length));

/**
 * A grid written in from (r0, c0) on, growing the table as far as its limits allow. What doesn't fit is left
 * out (and counted, so the view can say so): rows past the last one a table may have, and never onto the
 * totals row, which used to be written over by a paste into a table already at its row limit.
 */
function writeGrid(t: TableData, r0: number, c0: number, grid: InlineNode[][][]): Written {
  if (!grid.length) return { table: t, rows: 0, columns: 0 };
  let next = t;
  const needRows = r0 + grid.length - (next.totalsRow ? next.rows.length - 1 : next.rows.length);
  for (let i = 0; i < needRows; i++) next = addRow(next) ?? next;
  const needCols = c0 + gridWidth(grid) - width(next);
  for (let i = 0; i < needCols; i++) next = addColumn(next) ?? next;
  const end = dataEnd(next);
  const rows = next.rows.map((row, r) =>
    r < r0 || r >= end
      ? row
      : row.map((cell, c) => {
          const g = grid[r - r0]?.[c - c0];
          return g === undefined ? cell : g;
        }),
  );
  return { table: { ...next, rows }, rows: Math.max(0, Math.min(grid.length, end - r0)), columns: Math.max(0, Math.min(gridWidth(grid), width(next) - c0)) };
}

/**
 * Cells pasted from a spreadsheet written in from (r, c) on, growing the table as far as its limits allow.
 * A pasted cell's text replaces the cell; formulas are kept as written. The totals row is never written over.
 */
export function pasteGrid(t: TableData, r0: number, c0: number, grid: InlineNode[][][]): TableData {
  return writeGrid(t, r0, c0, grid).table;
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
  return writeGridShown(t, shown, c0, grid).table;
}

function writeGridShown(t: TableData, shown: readonly number[], c0: number, grid: InlineNode[][][]): Written {
  if (!grid.length || !shown.length) return { table: t, rows: 0, columns: 0 };
  const totals = t.totalsRow ? t.rows.length - 1 : -1;
  const first = shown[0]!;
  const stop = shown.indexOf(totals);
  const targets = (stop < 0 ? shown : shown.slice(0, stop)).slice(0, grid.length);
  // Rows showing one after another as they are stored, down to the last: the plain paste does it all.
  if (targets.every((r, i) => r === first + i) && (targets.length === grid.length || first + targets.length === dataEnd(t))) return writeGrid(t, first, c0, grid);
  let next = t;
  const needCols = c0 + gridWidth(grid) - width(next);
  for (let i = 0; i < needCols; i++) next = addColumn(next) ?? next;
  const columns = Math.max(0, Math.min(gridWidth(grid), width(next) - c0));
  const at = new Map(targets.map((r, i) => [r, i]));
  next = { ...next, rows: next.rows.map((row, r) => (at.has(r) ? row.map((cell, c) => grid[at.get(r)!]?.[c - c0] ?? cell) : row)) };
  const rest = grid.slice(targets.length);
  if (!rest.length) return { table: next, rows: targets.length, columns };
  const more = writeGrid(next, dataEnd(next), c0, rest);
  return { table: more.table, rows: targets.length + more.rows, columns };
}

/** What a paste did: the table to write (null when nothing may be written), and what of the grid was left out. */
export interface Pasted {
  table: TableData | null;
  /** The grid's rows and columns that went in. */
  rows: number;
  columns: number;
  /** Rows and columns that didn't fit in a table's 200 rows and 20 columns. */
  cutRows: number;
  cutColumns: number;
  /** The paste was refused whole: a cell or the table would hold too much (tableFull). */
  full: TableFull | null;
}

/**
 * A paste where the rows show (pasteGridShown), with what the view needs to tell the person: how much of the
 * grid went in, how much was cut at the table's row and column limits, and whether it was refused because
 * the table can't hold that much text.
 */
export function pasteCells(t: TableData, shown: readonly number[], c0: number, grid: InlineNode[][][]): Pasted {
  const w = writeGridShown(t, shown, c0, grid);
  const cutRows = grid.length - w.rows;
  const cutColumns = gridWidth(grid) - w.columns;
  const full = tableFull(t, w.table);
  return { table: full || !w.rows || !w.columns ? null : w.table, rows: w.rows, columns: w.columns, cutRows, cutColumns, full };
}

/** What to tell someone whose paste was cut at the table's limits (null: it all went in). */
export function pasteCutMessage(p: Pick<Pasted, "rows" | "columns" | "cutRows" | "cutColumns">): string | null {
  const parts: string[] = [];
  if (p.cutRows) parts.push(`${p.rows} of ${p.rows + p.cutRows} rows`);
  if (p.cutColumns) parts.push(`${p.columns} of ${p.columns + p.cutColumns} columns`);
  if (!parts.length) return null;
  return `Pasted ${parts.join(" and ")}. A table holds up to ${LIMITS.maxTableRows} rows and ${LIMITS.maxTableColumns} columns.`;
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
 * Where the rows and the columns of `prevRows` are in `nextRows`, after a change this view did not make: each
 * is found by its content. `row(r)` and `col(c)` give the new number, or null when it is gone.
 */
export function followAxes(prevRows: InlineNode[][][], nextRows: InlineNode[][][]): { row: (r: number) => number | null; col: (c: number) => number | null } {
  const ph = prevRows.length;
  const nh = nextRows.length;
  const pw = prevRows[0]?.length ?? 0;
  const nw = nextRows[0]?.length ?? 0;
  const inRows = (r: number) => (r >= 0 && r < ph ? r : null);
  const inCols = (c: number) => (c >= 0 && c < pw ? c : null);
  const stay = { row: inRows, col: inCols };
  if (prevRows === nextRows) return stay;
  // Rows are told apart over the columns both tables have, columns over the rows both have.
  const rowKeys = (rows: InlineNode[][][], w: number) => rows.map((row) => row.slice(0, w).map(cellKey).join("\u0001"));
  const colKeys = (rows: InlineNode[][][], w: number, h: number) => Array.from({ length: w }, (_, k) => rows.slice(0, h).map((row) => cellKey(row[k])).join("\u0001"));
  if (ph === nh && pw === nw) {
    // Nothing added or removed: everything stays, unless the same rows (or columns) are now in another order.
    const pr = rowKeys(prevRows, pw);
    const nr = rowKeys(nextRows, nw);
    if (sameList(pr, nr)) return stay;
    if (sameItems(pr, nr)) return { row: (r) => (inRows(r) === null ? null : (followIndex(pr, nr, r) ?? r)), col: inCols };
    const pc = colKeys(prevRows, pw, ph);
    const nc = colKeys(nextRows, nw, nh);
    if (!sameList(pc, nc) && sameItems(pc, nc)) return { row: inRows, col: (c) => (inCols(c) === null ? null : (followIndex(pc, nc, c) ?? c)) };
    return stay;
  }
  const w = Math.min(pw, nw);
  const h = Math.min(ph, nh);
  let rows: [string[], string[]] | null = null;
  let cols: [string[], string[]] | null = null;
  return {
    row: (r) => {
      if (ph === nh) return inRows(r);
      rows ??= [rowKeys(prevRows, w), rowKeys(nextRows, w)];
      return followIndex(rows[0], rows[1], r);
    },
    col: (c) => {
      if (pw === nw) return inCols(c);
      cols ??= [colKeys(prevRows, pw, h), colKeys(nextRows, nw, h)];
      return followIndex(cols[0], cols[1], c);
    },
  };
}

/**
 * Where the cell at (r, c) of `prevRows` is in `nextRows`, after a change this view did not make: the row
 * and the column are found by their content, so a row added, removed or moved above the open cell doesn't
 * leave it editing another row. Null when its row or column is gone (the cell closes).
 */
export function followCell(prevRows: InlineNode[][][], nextRows: InlineNode[][][], r: number, c: number): { r: number; c: number } | null {
  const ph = prevRows.length;
  const pw = prevRows[0]?.length ?? 0;
  if (r < 0 || c < 0 || r >= ph || c >= pw) return null;
  const to = followAxes(prevRows, nextRows);
  const row = to.row(r);
  const col = to.col(c);
  return row === null || col === null ? null : { r: row, c: col };
}

// ------------------------------------------------------------- what the cells show, from one key to the next
// The table is worked out again at every change. Two things keep that cheap, with the same results: a table
// without formulas has only the changed rows worked out (no cell there depends on another), and rows whose
// cells show the same as before keep the very same objects, so the view draws only the rows that changed.

/** A table worked out, kept to work the next one out from. */
export interface Evaluation {
  table: TableData;
  today: string | undefined;
  evaluated: EvaluatedTable;
  /** Whether any cell is a formula (then a change anywhere can change any cell). */
  formulas: boolean;
}

const sameShown = (a: EvaluatedCell, b: EvaluatedCell) =>
  a === b ||
  (a.raw === b.raw && a.display === b.display && a.value === b.value && a.kind === b.kind && a.formula === b.formula && a.numeric === b.numeric && a.changed === b.changed && a.error?.code === b.error?.code && a.error?.message === b.error?.message);
const sameShownRow = (a: readonly EvaluatedCell[] | undefined, b: readonly EvaluatedCell[]) => Boolean(a) && a!.length === b.length && a!.every((x, i) => sameShown(x, b[i]!));
const sameColumns = (a: readonly TableColumn[], b: readonly TableColumn[]) => a === b || canonicalJson(a) === canonicalJson(b);

/** Every cell's value and what it shows (evaluateTable), reusing what `prev` already worked out. */
export function evaluateFrom(prev: Evaluation | null, t: TableData, today?: string): Evaluation {
  if (prev && prev.table === t && prev.today === today) return prev;
  const height = t.rows.length;
  const sameSettings = prev && prev.today === today && prev.table.headerRow === t.headerRow && prev.table.totalsRow === t.totalsRow && sameColumns(prev.table.columns, t.columns);
  if (prev && sameSettings && !prev.formulas && prev.table.rows.length === height && width(prev.table) === width(t)) {
    const cells: EvaluatedCell[][] = [];
    const display: string[][] = [];
    let formula = false;
    for (let r = 0; r < height && !formula; r++) {
      const row = t.rows[r]!;
      const had = prev.evaluated.cells[r]!;
      if (row === prev.table.rows[r]) {
        cells.push(had);
        display.push(prev.evaluated.display[r]!);
        continue;
      }
      // (The header row is names, never formatted.)
      const one = evaluateTable([row], { headerRow: false, columns: t.headerRow && r === 0 ? null : t.columns, today }).cells[0] ?? [];
      if (one.some((c) => c.formula)) formula = true;
      else if (sameShownRow(had, one)) {
        cells.push(had);
        display.push(prev.evaluated.display[r]!);
      } else {
        cells.push(one);
        display.push(one.map((c) => c.display));
      }
    }
    if (!formula) return { table: t, today, formulas: false, evaluated: { cells, display, bodyRows: prev.evaluated.bodyRows, names: tableColumnNames(t.rows, t.headerRow) } };
  }
  const evaluated = evaluateTable(t.rows, tableOptions(t, today));
  const formulas = evaluated.cells.some((row) => row.some((c) => c.formula));
  if (prev) {
    for (let r = 0; r < evaluated.cells.length; r++) {
      const had = prev.evaluated.cells[r];
      if (!sameShownRow(had, evaluated.cells[r]!)) continue;
      evaluated.cells[r] = had!;
      evaluated.display[r] = prev.evaluated.display[r]!;
    }
  }
  return { table: t, today, formulas, evaluated };
}

// ------------------------------------------------------------------------------- a change made from a copy
// Foli AI is sent the table and answers a while later. Its answer is a whole table, made from the table as it
// was when asked. Writing that over the note would undo whatever was typed (here or on another device) in
// the meantime, so its changes are applied to the table as it is now.

/** A changed table made from a copy of the table: the copy (`base`), the result, and how the two line up. */
export interface TableChange {
  base: TableData;
  table: TableData;
  /** The cells (row:column of `table`) that differ from `base`. */
  changed: Set<string>;
  /** For each row of `table`, the row of `base` it was made from (-1: a new row). */
  from: number[];
}

/**
 * Which row of `next` each row of `prev` is, by content: the row's number in `next`, or -1 when it is gone.
 * `added` are the rows of `next` that are none of `prev`'s. Rows that read the same and kept their order
 * are found first; between two of those, as many rows of one as of the other are the same rows edited in
 * place, rows only in `next` were added and rows only in `prev` were deleted. Null when a stretch has both,
 * in different numbers: which row became which can't be told.
 */
function alignRows(prev: InlineNode[][][], next: InlineNode[][][]): { to: number[]; added: Set<number> } | null {
  const key = (row: InlineNode[][]) => row.map(cellKey).join("\u0001");
  const a = prev.map(key);
  const b = next.map(key);
  // The longest run of rows both have in the same order.
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const to = prev.map(() => -1);
  const added = new Set<number>();
  let i = 0;
  let j = 0;
  /** The rows between two that were found: from i to `iEnd` of prev, from j to `jEnd` of next. */
  const between = (iEnd: number, jEnd: number) => {
    const gone = iEnd - i;
    const came = jEnd - j;
    if (gone && came && gone !== came) return false;
    if (gone === came) for (let k = 0; k < gone; k++) to[i + k] = j + k;
    else for (let k = j; k < jEnd; k++) added.add(k);
    return true;
  };
  let ai = 0;
  let bj = 0;
  while (ai < a.length && bj < b.length) {
    if (a[ai] === b[bj]) {
      if (!between(ai, bj)) return null;
      to[ai] = bj;
      i = ++ai;
      j = ++bj;
    } else if (lcs[ai + 1]![bj]! >= lcs[ai]![bj + 1]!) ai++;
    else bj++;
  }
  return between(a.length, b.length) ? { to, added } : null;
}

/**
 * `change` applied to the table as it is now: its changed cells and its rows' order, with every other cell
 * as it is now (not as it was when the copy was made), and rows added since kept above the totals. A row
 * deleted since stays deleted, unless the change is in that very row. Null when the two no longer line up:
 * the table's columns or its header and totals settings changed since the copy, or its rows changed in a
 * way that doesn't say which row is which.
 */
export function applyChange(live: TableData, change: TableChange): { table: TableData; changed: Set<string> } | null {
  const { base, table: result } = change;
  const w = width(result);
  if (live.rows === base.rows) return { table: { ...result, headerRow: live.headerRow, columns: live.columns.slice(0, w), view: live.view }, changed: change.changed };
  if (live.headerRow !== base.headerRow || live.totalsRow !== base.totalsRow || width(live) !== width(base)) return null;
  const cols = followAxes(base.rows, live.rows);
  for (let c = 0; c < width(base); c++) if (cols.col(c) !== c) return null;
  const aligned = alignRows(base.rows, live.rows);
  if (!aligned) return null;
  const bw = width(base);
  const rows: InlineNode[][][] = [];
  const changed = new Set<string>();
  const changedIn = (i: number, row: InlineNode[][]) => row.some((_, c) => change.changed.has(`${i}:${c}`));
  const put = (i: number) => {
    const row = result.rows[i]!;
    const b = change.from[i] ?? -1;
    const l = b >= 0 ? (aligned.to[b] ?? -1) : -1;
    // Made from a row that has been deleted since, and not changed: it stays deleted.
    if (b >= 0 && l < 0 && !changedIn(i, row)) return;
    const now = l < 0 ? null : live.rows[l]!;
    const next = now ? row.map((cell, c) => (change.changed.has(`${i}:${c}`) || c >= bw ? cell : (now[c] ?? cell))) : row;
    for (let c = 0; c < next.length; c++) if (change.changed.has(`${i}:${c}`)) changed.add(`${rows.length}:${c}`);
    rows.push(now && next.length === now.length && next.every((cell, c) => cell === now[c]) ? now : next);
  };
  const body = result.totalsRow ? result.rows.length - 1 : result.rows.length;
  for (let i = 0; i < body; i++) put(i);
  // Rows added since the copy was made (typed here, or by another device): kept, after the others.
  live.rows.forEach((row, l) => {
    if (aligned.added.has(l)) rows.push(Array.from({ length: w }, (_, c) => (c < bw ? (row[c] ?? []) : [])));
  });
  if (result.totalsRow) put(result.rows.length - 1);
  if (!rows.length || rows.length > LIMITS.maxTableRows) return null;
  return { table: { ...live, rows, totalsRow: result.totalsRow && rows.length >= 2, columns: live.columns.slice(0, w) }, changed };
}
