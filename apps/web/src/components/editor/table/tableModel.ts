// A table block's data and the changes its tools make (pure, so the view and the tests share them). Rows and
// columns that move or go take the formulas that point at them along (remapTableFormulas), and the column
// settings and the saved view follow their columns.
import {
  LIMITS,
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
  const j = i + dir;
  if (j < 0 || j >= t.rows.length) return null;
  if (t.totalsRow && (i === t.rows.length - 1 || j === t.rows.length - 1)) return null;
  const rows = [...t.rows];
  const [row] = rows.splice(i, 1);
  rows.splice(j, 0, row!);
  return { ...t, rows: remapTableFormulas(rows, { rows: moveIndexMap(i, j) }) };
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
  const j = i + dir;
  if (j < 0 || j >= width(t)) return null;
  const swap = <T,>(list: T[]) => {
    const next = [...list];
    const [x] = next.splice(i, 1);
    next.splice(j, 0, x!);
    return next;
  };
  const columns = swap(Array.from({ length: width(t) }, (_, k) => t.columns[k] ?? {}));
  const map = moveIndexMap(i, j);
  return { ...t, rows: remapTableFormulas(t.rows.map(swap), { cols: map }), columns, view: mapView(t.view, map) };
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
