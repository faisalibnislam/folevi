// Chart block data: a small table of values and how to draw it, stored as a JSON string in `props.data`.
//
//   { "v": 1, "kind": "bar", "title": "Sign ups", "takeaway": "March doubled February.",
//     "columns": ["Month", "Web", "iPhone"],
//     "rows": [["Jan", 120, 40], ["Feb", 150, 62], ["Mar", 310, 90]] }
//
// The first column names each row (the category, or the x value for line, area and scatter charts); every
// other column is a series. Scatter and bubble charts read [label, x, y, size] when the first column is
// text, or [x, y…] when it's numbers. Org charts read the rows as people ([name, reports to, role]) and
// Venn diagrams as sets and their overlaps ([set, size], "A & B" for an overlap). Cells are text, numbers
// or null (empty); text like "$1,200" or "42%" stays text and is read as a number when drawn
// (parseChartNumber).
//
// Optional, omitted when they're the default:
//   source      where the rows come from, kept up to date by the editor (the rows are its latest copy, so
//               share pages, exports and search always have them): a table block in the same note
//               ({ type: "table", blockId }) or a collection grouped by a field ({ type: "collection",
//               collectionId, groupBy, aggregate: count | sum | average, field }).
//   colors      a series' (or slice's, set's, team's) colour by its name, from CHART_COLORS.
//   xLabel, yLabel, yMin, yMax   axis titles and the value axis's range.
//   legend      auto (shown for two series or more) | top | bottom | right | none.
//   values      value labels on the marks.
//   sort        none (as entered) | asc | desc (by the first series) | label (A to Z).
//   horizontal  bars run sideways.
//
// On the wire `title` and `takeaway` are optional too. `chartDataIssue` is the strict check the server runs
// on every write; `parseChart` is the forgiving reader clients use before drawing anything.
import { LIMITS } from "./generated/schema";
import { cleanText, isNum, isObj, looseDataObject, oneOf, readDataObject, strayKey } from "./blockData";

export const CHART_KINDS = ["bar", "stackedBar", "line", "area", "pie", "donut", "scatter", "bubble", "org", "venn"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

export const CHART_KIND_LABEL: Record<ChartKind, string> = {
  bar: "Bar",
  stackedBar: "Stacked bar",
  line: "Line",
  area: "Area",
  pie: "Pie",
  donut: "Donut",
  scatter: "Scatter",
  bubble: "Bubble",
  org: "Org chart",
  venn: "Venn",
};

/** The series colours, in the order series take them (the drawing maps each to a light and a dark shade). */
export const CHART_COLORS = ["blue", "orange", "teal", "yellow", "pink", "green", "violet", "red", "gray"] as const;
export type ChartColor = (typeof CHART_COLORS)[number];

export const CHART_LEGENDS = ["auto", "top", "bottom", "right", "none"] as const;
export type ChartLegend = (typeof CHART_LEGENDS)[number];

export const CHART_SORTS = ["none", "asc", "desc", "label"] as const;
export type ChartSort = (typeof CHART_SORTS)[number];

export const CHART_AGGREGATES = ["count", "sum", "average"] as const;
export type ChartAggregate = (typeof CHART_AGGREGATES)[number];

export type ChartSource =
  | { type: "table"; blockId: string }
  | { type: "collection"; collectionId: string; groupBy: string; aggregate: ChartAggregate; field?: string };

export type ChartCell = string | number | null;

export interface ChartData {
  v: 1;
  kind: ChartKind;
  title: string;
  takeaway: string;
  columns: string[];
  rows: ChartCell[][];
  source: ChartSource | null;
  colors: Record<string, ChartColor>;
  xLabel: string;
  yLabel: string;
  yMin: number | null;
  yMax: number | null;
  legend: ChartLegend;
  values: boolean;
  sort: ChartSort;
  horizontal: boolean;
}

export const CHART_LIMITS = {
  maxRows: 500,
  maxColumns: 20,
  maxCell: 200,
  maxTitle: 200,
  maxTakeaway: 500,
  maxAxisLabel: 80,
  maxColors: 60,
} as const;

export const CHART_DEFAULT_HEIGHT = 360;

const FIELDS = ["kind", "title", "takeaway", "columns", "rows", "source", "colors", "xLabel", "yLabel", "yMin", "yMax", "legend", "values", "sort", "horizontal"] as const;
/** Block ids, collection ids and collection field ids: url-safe, at most 64 characters. */
const REF_RE = /^[A-Za-z0-9_-]{1,64}$/;
const isRef = (v: unknown): v is string => typeof v === "string" && REF_RE.test(v);
const TABLE_SOURCE_KEYS = new Set(["type", "blockId"]);
const COLLECTION_SOURCE_KEYS = new Set(["type", "collectionId", "groupBy", "aggregate", "field"]);

export const emptyChart = (): ChartData => ({
  v: 1,
  kind: "bar",
  title: "",
  takeaway: "",
  columns: [],
  rows: [],
  source: null,
  colors: {},
  xLabel: "",
  yLabel: "",
  yMin: null,
  yMax: null,
  legend: "auto",
  values: false,
  sort: "none",
  horizontal: false,
});

const cellOk = (c: unknown) => c === null || (typeof c === "string" && c.length <= CHART_LIMITS.maxCell) || isNum(c);

/** Why a source isn't valid, or null. */
function sourceIssue(s: unknown): string | null {
  if (!isObj(s)) return "invalid source";
  if (s.type === "table") return strayKey(s, TABLE_SOURCE_KEYS) || !isRef(s.blockId) ? "invalid source" : null;
  if (s.type === "collection") {
    if (strayKey(s, COLLECTION_SOURCE_KEYS) || !isRef(s.collectionId) || !isRef(s.groupBy) || !oneOf(CHART_AGGREGATES, s.aggregate)) return "invalid source";
    if (s.field !== undefined && !isRef(s.field)) return "invalid source";
    if (s.aggregate !== "count" && s.field === undefined) return "invalid source";
    return null;
  }
  return "invalid source";
}

/** Why `data` isn't valid chart JSON, or null when it is (the server's check on every write). */
export function chartDataIssue(data: string): string | null {
  const { obj, issue } = readDataObject(data, LIMITS.maxChartDataLength, FIELDS, "chart too large");
  if (issue || !obj) return issue;
  const L = CHART_LIMITS;
  if (!oneOf(CHART_KINDS, obj.kind)) return "invalid kind";
  if (obj.title !== undefined && (typeof obj.title !== "string" || obj.title.length > L.maxTitle)) return "invalid title";
  if (obj.takeaway !== undefined && (typeof obj.takeaway !== "string" || obj.takeaway.length > L.maxTakeaway)) return "invalid takeaway";
  const { columns, rows } = obj;
  if (!Array.isArray(columns) || columns.length > L.maxColumns || columns.some((c) => typeof c !== "string" || c.length > L.maxCell)) return "invalid columns";
  if (!Array.isArray(rows)) return "rows must be an array";
  if (rows.length > L.maxRows) return "too many rows";
  for (const [i, r] of rows.entries()) {
    if (!Array.isArray(r) || r.length !== columns.length) return `row ${i}: expected ${columns.length} cells`;
    if (!r.every(cellOk)) return `row ${i}: invalid cell`;
  }
  if (obj.source !== undefined) {
    const bad = sourceIssue(obj.source);
    if (bad) return bad;
  }
  if (obj.colors !== undefined) {
    if (!isObj(obj.colors)) return "invalid colors";
    const entries = Object.entries(obj.colors);
    if (entries.length > L.maxColors || entries.some(([k, c]) => k.length > L.maxCell || !oneOf(CHART_COLORS, c))) return "invalid colors";
  }
  for (const k of ["xLabel", "yLabel"] as const) {
    if (obj[k] !== undefined && (typeof obj[k] !== "string" || (obj[k] as string).length > L.maxAxisLabel)) return `invalid ${k}`;
  }
  for (const k of ["yMin", "yMax"] as const) {
    if (obj[k] !== undefined && !isNum(obj[k])) return `invalid ${k}`;
  }
  if (isNum(obj.yMin) && isNum(obj.yMax) && obj.yMin >= obj.yMax) return "invalid range";
  if (obj.legend !== undefined && !oneOf(CHART_LEGENDS, obj.legend)) return "invalid legend";
  if (obj.sort !== undefined && !oneOf(CHART_SORTS, obj.sort)) return "invalid sort";
  for (const k of ["values", "horizontal"] as const) {
    if (obj[k] !== undefined && typeof obj[k] !== "boolean") return `invalid ${k}`;
  }
  return null;
}

const PLAIN_NUMBER = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$|^[-+]?\.\d+$/;

/**
 * A cell read forgivingly: numbers stay numbers, plain numeric text ("1,200", "3.5") becomes one, other
 * text (with a currency or a percent sign too, so "$1,200" keeps its sign) stays text.
 */
export function chartCell(v: unknown): ChartCell {
  if (isNum(v)) return v;
  if (typeof v !== "string") return null;
  const s = cleanText(v, CHART_LIMITS.maxCell).replace(/\n+/g, " ").trim();
  if (!s) return null;
  const n = PLAIN_NUMBER.test(s) ? Number(s.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) ? n : s;
}

const CURRENCY_PREFIX = /^(?:US\$|A\$|C\$|NZ\$|HK\$|R\$|[$€£¥₹₩₽₺₪฿₫₴₦]|(?:USD|EUR|GBP|JPY|INR|AUD|CAD|CHF|CNY|SEK|NOK|DKK)\s)\s*/i;
const CURRENCY_SUFFIX = /\s*(?:[$€£¥₹₩₽₺₪฿₫₴₦]|\s(?:USD|EUR|GBP|JPY|INR|AUD|CAD|CHF|CNY|SEK|NOK|DKK|kr|zł))$/i;
const SCALE: Record<string, number> = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, mm: 1e6, b: 1e9, B: 1e9, bn: 1e9, Bn: 1e9 };

export interface ChartNumber {
  value: number;
  /** A currency sign written before the number ("$"), kept for labels. */
  prefix: string;
  /** "%" or a currency sign written after the number. */
  suffix: string;
}

/**
 * A number in text as people write it: "1,200", "1 200", "1.234,5", "$4.2k", "(300)", "−12", "42%",
 * "12 €". Null when it isn't one. Thousands separators and decimal commas are told apart by their place.
 */
export function parseChartNumber(raw: string): ChartNumber | null {
  let s = raw.trim().replace(/[   ]/g, " ");
  if (!s || s.length > 60) return null;
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1]!.trim();
  }
  if (/^[-−–]/.test(s)) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) s = s.slice(1).trim();
  let prefix = "";
  const pre = CURRENCY_PREFIX.exec(s);
  if (pre) {
    prefix = pre[0].trim();
    s = s.slice(pre[0].length);
  }
  // A minus after the currency sign ("$-12").
  if (/^[-−–]/.test(s)) {
    negative = !negative;
    s = s.slice(1);
  }
  let suffix = "";
  if (s.endsWith("%")) {
    suffix = "%";
    s = s.slice(0, -1).trim();
  } else {
    const post = CURRENCY_SUFFIX.exec(s);
    if (post) {
      suffix = post[0].trim();
      s = s.slice(0, -post[0].length).trim();
    }
  }
  let scale = 1;
  const unit = /^(.*\d)\s?(k|K|m|M|mm|b|B|bn|Bn)$/.exec(s);
  if (unit && !suffix) {
    scale = SCALE[unit[2]!]!;
    s = unit[1]!;
  }
  // Spaces and apostrophes between digits group thousands.
  s = s.replace(/(\d)[ '’](?=\d{3}(?:\D|$))/g, "$1");
  if (!/^(?:\d[\d.,]*|[.,]\d+)$/.test(s)) return null;
  const comma = s.includes(",");
  const dot = s.includes(".");
  if (comma && dot) {
    // The last of the two is the decimal mark.
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (comma) {
    s = /^\d{1,3}(?:,\d{3})+$/.test(s) ? s.replace(/,/g, "") : /^\d*,\d+$/.test(s) ? s.replace(",", ".") : "";
  } else if (dot && /^\d{1,3}(?:\.\d{3}){2,}$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!s || (s.match(/\./g) ?? []).length > 1) return null;
  const n = Number(s) * scale;
  if (!Number.isFinite(n)) return null;
  return { value: negative ? -n : n, prefix, suffix };
}

/** A cell as a number (numbers as they are, text through parseChartNumber), or null. */
export function chartNumber(c: ChartCell | undefined): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  if (typeof c !== "string") return null;
  return parseChartNumber(c)?.value ?? null;
}

function readSource(s: unknown): ChartSource | null {
  if (!isObj(s)) return null;
  if (s.type === "table" && isRef(s.blockId)) return { type: "table", blockId: s.blockId };
  if (s.type === "collection" && isRef(s.collectionId) && isRef(s.groupBy)) {
    const aggregate = oneOf(CHART_AGGREGATES, s.aggregate) ? s.aggregate : "count";
    const field = isRef(s.field) ? s.field : undefined;
    if (aggregate !== "count" && !field) return { type: "collection", collectionId: s.collectionId, groupBy: s.groupBy, aggregate: "count" };
    return { type: "collection", collectionId: s.collectionId, groupBy: s.groupBy, aggregate, ...(field ? { field } : {}) };
  }
  return null;
}

function readColors(c: unknown): Record<string, ChartColor> {
  const out: Record<string, ChartColor> = {};
  if (!isObj(c)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(c)) {
    if (n >= CHART_LIMITS.maxColors) break;
    const key = cleanText(k, CHART_LIMITS.maxCell).replace(/\n+/g, " ");
    if (!key || !oneOf(CHART_COLORS, v)) continue;
    out[key] = v;
    n++;
  }
  return out;
}

/**
 * Forgiving reader for any chart-shaped value (stored data, AI output, pasted JSON). Never throws: an
 * unknown kind reads as a bar chart, rows are padded or cut to the columns, cells cleaned (see chartCell),
 * strings trimmed to their limits, options that don't fit dropped.
 */
export function normalizeChart(input: unknown): ChartData {
  const out = emptyChart();
  if (!isObj(input)) return out;
  const L = CHART_LIMITS;
  if (oneOf(CHART_KINDS, input.kind)) out.kind = input.kind;
  out.title = cleanText(input.title, L.maxTitle).replace(/\n+/g, " ");
  out.takeaway = cleanText(input.takeaway, L.maxTakeaway);
  const rows = (Array.isArray(input.rows) ? input.rows : []).filter(Array.isArray).slice(0, L.maxRows) as unknown[][];
  const width = Math.min(L.maxColumns, Array.isArray(input.columns) ? input.columns.length : Math.max(0, ...rows.map((r) => r.length)));
  out.columns = Array.from({ length: width }, (_, i) => cleanText((input.columns as unknown[] | undefined)?.[i], L.maxCell).replace(/\n+/g, " "));
  out.rows = rows.map((r) => Array.from({ length: width }, (_, i) => chartCell(r[i])));
  out.source = readSource(input.source);
  out.colors = readColors(input.colors);
  out.xLabel = cleanText(input.xLabel, L.maxAxisLabel).replace(/\n+/g, " ");
  out.yLabel = cleanText(input.yLabel, L.maxAxisLabel).replace(/\n+/g, " ");
  out.yMin = isNum(input.yMin) ? input.yMin : null;
  out.yMax = isNum(input.yMax) ? input.yMax : null;
  if (out.yMin !== null && out.yMax !== null && out.yMin >= out.yMax) {
    out.yMin = null;
    out.yMax = null;
  }
  if (oneOf(CHART_LEGENDS, input.legend)) out.legend = input.legend;
  out.values = input.values === true;
  if (oneOf(CHART_SORTS, input.sort)) out.sort = input.sort;
  out.horizontal = input.horizontal === true;
  return out;
}

/** Reads stored chart data; anything unusable reads as an empty chart (never throws). */
export function parseChart(data: string | null | undefined): ChartData {
  return normalizeChart(looseDataObject(data, LIMITS.maxChartDataLength));
}

/** Compact wire JSON (defaults omitted). A chart with no columns and no source serialises to "". */
export function serializeChart(chart: ChartData): string {
  if (!chart.columns.length && !chart.source) return "";
  const o: Record<string, unknown> = { v: 1, kind: chart.kind };
  if (chart.title) o.title = chart.title;
  if (chart.takeaway) o.takeaway = chart.takeaway;
  o.columns = chart.columns;
  o.rows = chart.rows;
  if (chart.source) o.source = chart.source;
  if (chart.colors && Object.keys(chart.colors).length) o.colors = chart.colors;
  if (chart.xLabel) o.xLabel = chart.xLabel;
  if (chart.yLabel) o.yLabel = chart.yLabel;
  if (chart.yMin !== null && chart.yMin !== undefined) o.yMin = chart.yMin;
  if (chart.yMax !== null && chart.yMax !== undefined) o.yMax = chart.yMax;
  if (chart.legend && chart.legend !== "auto") o.legend = chart.legend;
  if (chart.values) o.values = true;
  if (chart.sort && chart.sort !== "none") o.sort = chart.sort;
  if (chart.horizontal) o.horizontal = true;
  return JSON.stringify(o);
}

/** A cell as text (exports, search). */
export const chartCellText = (c: ChartCell): string => (c === null ? "" : typeof c === "number" ? String(c) : c);

/** All of the chart's words and labels, for search. */
export const chartText = (chart: ChartData): string =>
  [chart.title, chart.takeaway, ...chart.columns, ...chart.rows.map((r) => chartCellText(r[0] ?? null))]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");

/**
 * Rows of cells from CSV, TSV or rows pasted from a spreadsheet: the delimiter is the one the first line
 * uses most (tab, comma or semicolon), quoted cells may hold delimiters, quotes ("") and new lines. Blank
 * lines are skipped; every row is as long as the longest.
 */
export function parseDelimited(text: string, maxRows = CHART_LIMITS.maxRows + 1, maxColumns = CHART_LIMITS.maxColumns): string[][] {
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const first = src.split("\n", 1)[0] ?? "";
  const count = (ch: string) => first.split(ch).length - 1;
  const delim = count("\t") ? "\t" : count(";") > count(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) rows.push(row.slice(0, maxColumns).map((c) => c.trim()));
    row = [];
    cell = "";
  };
  for (let i = 0; i < src.length && rows.length < maxRows; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") endRow();
    else cell += ch;
  }
  if ((cell || row.length) && rows.length < maxRows) endRow();
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array.from({ length: width - r.length }, () => "")]);
}

/**
 * A grid of text (CSV, a pasted range, a table block) as chart columns and rows: the first row names the
 * columns (blank names become "Column 2"…), the others are the rows.
 */
export function chartFromGrid(grid: string[][]): { columns: string[]; rows: ChartCell[][] } {
  const L = CHART_LIMITS;
  const width = Math.min(L.maxColumns, Math.max(0, ...grid.map((r) => r.length)));
  if (!width) return { columns: [], rows: [] };
  const head = grid[0] ?? [];
  const columns = Array.from({ length: width }, (_, i) => cleanText(head[i] ?? "", L.maxCell).replace(/\n+/g, " ").trim() || (i === 0 ? "Label" : `Column ${i + 1}`));
  const rows = grid.slice(1, L.maxRows + 1).map((r) => Array.from({ length: width }, (_, i) => chartCell(r[i] ?? "")));
  return { columns, rows };
}

/**
 * Markdown for exports: the title in bold, the data as a table, then the takeaway in italics. `esc`
 * escapes Markdown (pipes included); `indent` is the block's own nesting.
 */
export function chartToMarkdown(chart: ChartData, esc: (s: string) => string, indent = ""): string[] {
  if (!chart.columns.length) return [];
  const lines: string[] = [];
  const cell = (s: string) => esc(s.replace(/\n+/g, " ")) || " ";
  if (chart.title) lines.push(`${indent}**${esc(chart.title)}**`, "");
  lines.push(`${indent}| ${chart.columns.map(cell).join(" | ")} |`);
  lines.push(`${indent}| ${chart.columns.map(() => "---").join(" | ")} |`);
  for (const r of chart.rows) lines.push(`${indent}| ${r.map((c) => cell(chartCellText(c))).join(" | ")} |`);
  lines.push("");
  if (chart.takeaway) lines.push(`${indent}_${esc(chart.takeaway.replace(/\s*\n+\s*/g, " "))}_`, "");
  return lines;
}

/** HTML for exports: the data as a table under the title, with the takeaway after it. */
export function chartToHtml(chart: ChartData, esc: (s: string) => string): string {
  if (!chart.columns.length) return "";
  const head = `<tr>${chart.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
  const body = chart.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(chartCellText(c))}</td>`).join("")}</tr>`).join("");
  return `<figure class="chart">${chart.title ? `<figcaption>${esc(chart.title)}</figcaption>` : ""}<table>${head}${body}</table>${chart.takeaway ? `<p>${esc(chart.takeaway)}</p>` : ""}</figure>`;
}

/**
 * A chart block's data from a ```chart fence in Markdown (Foli AI, MCP and pasted Markdown): JSON with at
 * least the columns, read forgivingly. Null when it isn't a usable chart (the fence stays code).
 */
export function chartFromFence(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isObj(parsed) || !Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) return null;
  const chart = normalizeChart(parsed);
  chart.source = null;
  if (!chart.columns.length) return null;
  const data = serializeChart(chart);
  return data.length <= LIMITS.maxChartDataLength && chartDataIssue(data) === null ? data : null;
}
