// Where a chart's rows can come from besides its own table: a table block in the same note (read as the
// text people see in each cell, numbers parsed when drawn), a collection grouped by one of its fields and
// counted or summed, and CSV or rows pasted from a spreadsheet. Pure, so the editor and the tests share it.
import { CHART_LIMITS, chartCell, chartFromGrid, chartNumber, evaluateTable, parseChartNumber, parseDelimited, plainText, tableOptionsFromProps, tableRowOrder, type ChartAggregate, type ChartCell, type InlineNode, type TableViewInput } from "@folevi/editor-schema";

export interface ChartRows {
  columns: string[];
  rows: ChartCell[][];
}

/** A cell's text as shown. Formulas (=…) without their result read as empty. */
export function plainCellText(cell: unknown): string {
  const text = Array.isArray(cell) ? plainText(cell as InlineNode[]).replace(/\s+/g, " ").trim() : "";
  return text.startsWith("=") ? "" : text;
}

/**
 * A table block's rows as chart data. With a header row it names the columns; without one, the columns are
 * named "Label", "Column 2"…, and every row is data.
 */
export function tableToChartRows(rows: unknown, headerRow: boolean, cellText: (cell: unknown, row: number, col: number) => string = plainCellText): ChartRows {
  const grid = (Array.isArray(rows) ? rows : []).filter(Array.isArray).map((r: unknown[], i) => r.map((c, j) => cellText(c, i, j)));
  if (!grid.length) return { columns: [], rows: [] };
  return chartFromGrid(headerRow ? grid : [grid[0]!.map(() => ""), ...grid]);
}

/**
 * A table block's rows as chart data, as the table shows them (packages/editor-schema tableFormulas.ts):
 * formula results and formatted numbers ("$1,200.00", "42%", read back with their units), the rows its saved
 * view shows in that order, without its header and totals rows. Errors read as empty.
 */
export function tableBlockRows(attrs: Record<string, unknown>): ChartRows {
  const rows = (Array.isArray(attrs.rows) ? attrs.rows : []).filter(Array.isArray) as InlineNode[][][];
  if (!rows.length) return { columns: [], rows: [] };
  const options = tableOptionsFromProps(attrs);
  const table = evaluateTable(rows, options);
  const body = new Set(table.bodyRows);
  const order = tableRowOrder(table, options, (attrs.view ?? null) as TableViewInput | null).filter((r) => body.has(r));
  const width = Math.min(CHART_LIMITS.maxColumns, Math.max(0, ...rows.map((r) => r.length)));
  const head = options.headerRow ? (table.display[0] ?? []) : [];
  const columns = Array.from({ length: width }, (_, c) => (head[c] ?? "").replace(/\s+/g, " ").trim().slice(0, CHART_LIMITS.maxCell) || (c === 0 ? "Label" : `Column ${c + 1}`));
  const cellOf = (r: number, c: number): ChartCell => {
    const e = table.cells[r]?.[c];
    if (!e || e.kind === "error" || e.kind === "empty") return null;
    if (e.kind === "number") return parseChartNumber(e.display) ? chartCell(e.display.slice(0, CHART_LIMITS.maxCell)) : (e.value as number);
    return chartCell(e.display.replace(/\s+/g, " ").slice(0, CHART_LIMITS.maxCell));
  };
  return { columns, rows: order.slice(0, CHART_LIMITS.maxRows).map((r) => Array.from({ length: width }, (_, c) => cellOf(r, c))) };
}

/** CSV, TSV or pasted spreadsheet rows as chart data (the first row names the columns). */
export function textToChartRows(text: string): ChartRows {
  return chartFromGrid(parseDelimited(text));
}

/** Whether two sets of rows are the same (so a live source only writes when something changed). */
export function sameRows(a: ChartRows, b: ChartRows): boolean {
  return JSON.stringify([a.columns, a.rows]) === JSON.stringify([b.columns, b.rows]);
}

/** The parts of a collection (api.collections.get) a chart reads. */
export interface CollectionLike {
  name: string;
  properties: { id: string; name: string; type: string; options: { id: string; name: string }[] }[];
  rows: { title: string; values: Record<string, unknown> }[];
  people: { id: string; name: string }[];
}

/** The field a row's title is grouped by. */
export const TITLE_FIELD = "title";

/** Fields a collection's rows can be grouped by: the title and every field that names a group. */
export const groupableTypes = new Set(["select", "multiSelect", "checkbox", "person", "text", "date", "number", "url"]);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NO_VALUE = "No value";

/**
 * A collection's rows grouped by a field (`groupBy`, a field id or "title"), and in each group the number
 * of rows, or the sum or average of a number field. Groups come in the field's own order (its options, the
 * calendar for dates), with "No value" last.
 */
export function aggregateCollection(c: CollectionLike, groupBy: string, aggregate: ChartAggregate, field?: string): ChartRows {
  const prop = c.properties.find((p) => p.id === groupBy);
  const measure = field ? c.properties.find((p) => p.id === field) : undefined;
  const groups = new Map<string, { sum: number; count: number; values: number }>();
  const order: string[] = [];
  const add = (key: string, v: number | null) => {
    let g = groups.get(key);
    if (!g) {
      g = { sum: 0, count: 0, values: 0 };
      groups.set(key, g);
      order.push(key);
    }
    g.count++;
    if (v !== null) {
      g.sum += v;
      g.values++;
    }
  };
  const people = new Map(c.people.map((p) => [p.id, p.name]));
  for (const row of c.rows) {
    const raw = prop ? row.values[prop.id] : undefined;
    const mv = measure ? row.values[measure.id] : undefined;
    const v = typeof mv === "number" ? mv : typeof mv === "string" ? chartNumber(mv) : null;
    let keys: string[];
    if (!prop || groupBy === TITLE_FIELD) keys = [row.title.trim() || "Untitled"];
    else if (raw === null || raw === undefined || raw === "") keys = prop.type === "checkbox" ? ["No"] : [NO_VALUE];
    else if (prop.type === "select") keys = [prop.options.find((o) => o.id === raw)?.name ?? NO_VALUE];
    else if (prop.type === "multiSelect") keys = Array.isArray(raw) && raw.length ? raw.map((id) => prop.options.find((o) => o.id === id)?.name ?? NO_VALUE) : [NO_VALUE];
    else if (prop.type === "checkbox") keys = [raw === true ? "Yes" : "No"];
    else if (prop.type === "person") keys = [people.get(String(raw)) ?? "Someone"];
    else if (prop.type === "date") keys = [/^\d{4}-\d{2}/.test(String(raw)) ? String(raw).slice(0, 7) : NO_VALUE];
    else keys = [String(raw).trim() || NO_VALUE];
    for (const k of keys) add(k, v);
  }
  let keys = [...order];
  if (prop && (prop.type === "select" || prop.type === "multiSelect")) {
    const rank = new Map(prop.options.map((o, i) => [o.name, i]));
    keys.sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9));
  } else if (prop?.type === "date" || prop?.type === "number") {
    keys.sort((a, b) => (a === NO_VALUE ? 1 : b === NO_VALUE ? -1 : prop.type === "number" ? Number(a) - Number(b) : a.localeCompare(b)));
  } else if (prop?.type === "checkbox") keys = ["Yes", "No"].filter((k) => groups.has(k));
  keys = [...keys.filter((k) => k !== NO_VALUE), ...keys.filter((k) => k === NO_VALUE)];
  const label = (k: string) => (prop?.type === "date" && /^\d{4}-\d{2}$/.test(k) ? `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}` : k);
  const value = (g: { sum: number; count: number; values: number }) => (aggregate === "count" ? g.count : aggregate === "sum" ? Math.round(g.sum * 1e6) / 1e6 : g.values ? Math.round((g.sum / g.values) * 100) / 100 : null);
  const valueName = aggregate === "count" ? "Count" : `${aggregate === "sum" ? "Total" : "Average"} ${measure?.name ?? ""}`.trim();
  return {
    columns: [groupBy === TITLE_FIELD ? "Name" : (prop?.name ?? "Group"), valueName],
    rows: keys.slice(0, 500).map((k) => [label(k), value(groups.get(k)!)]),
  };
}
