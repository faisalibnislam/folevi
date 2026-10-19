// Chart block data: a small table of values and how to draw it, stored as a JSON string in `props.data`.
//
//   { "v": 1, "kind": "bar", "title": "Sign ups", "takeaway": "March doubled February.",
//     "columns": ["Month", "Web", "iPhone"],
//     "rows": [["Jan", 120, 40], ["Feb", 150, 62], ["Mar", 310, 90]] }
//
// The first column names each row (the category, or the x value for line, area and scatter charts); every
// other column is a series. Org charts read the rows as people ([name, reports to, role]) and Venn diagrams
// as sets and their overlaps ([set, size], "A & B" for an overlap). Cells are text, numbers or null (empty).
// On the wire `title` and `takeaway` are optional. `chartDataIssue` is the strict check the server runs on
// every write; `parseChart` is the forgiving reader clients use before drawing anything.
import { LIMITS } from "./generated/schema";
import { cleanText, isNum, isObj, looseDataObject, oneOf, readDataObject } from "./blockData";

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

export type ChartCell = string | number | null;

export interface ChartData {
  v: 1;
  kind: ChartKind;
  title: string;
  takeaway: string;
  columns: string[];
  rows: ChartCell[][];
}

export const CHART_LIMITS = {
  maxRows: 500,
  maxColumns: 20,
  maxCell: 200,
  maxTitle: 200,
  maxTakeaway: 500,
} as const;

export const CHART_DEFAULT_HEIGHT = 360;

export const emptyChart = (): ChartData => ({ v: 1, kind: "bar", title: "", takeaway: "", columns: [], rows: [] });

const cellOk = (c: unknown) => c === null || (typeof c === "string" && c.length <= CHART_LIMITS.maxCell) || isNum(c);

/** Why `data` isn't valid chart JSON, or null when it is (the server's check on every write). */
export function chartDataIssue(data: string): string | null {
  const { obj, issue } = readDataObject(data, LIMITS.maxChartDataLength, ["kind", "title", "takeaway", "columns", "rows"], "chart too large");
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
  return null;
}

/** A cell read forgivingly: numbers stay numbers, numeric text ("1,200", "42%") becomes one, the rest text. */
export function chartCell(v: unknown): ChartCell {
  if (isNum(v)) return v;
  if (typeof v !== "string") return null;
  const s = cleanText(v, CHART_LIMITS.maxCell).replace(/\n+/g, " ").trim();
  if (!s) return null;
  const n = /^[-+]?[\d,]*\.?\d+%?$/.test(s) ? Number(s.replace(/[,%]/g, "")) : NaN;
  return Number.isFinite(n) ? n : s;
}

/**
 * Forgiving reader for any chart-shaped value (stored data, AI output, pasted JSON). Never throws: an
 * unknown kind reads as a bar chart, rows are padded or cut to the columns, cells cleaned (see chartCell),
 * strings trimmed to their limits.
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
  return out;
}

/** Reads stored chart data; anything unusable reads as an empty chart (never throws). */
export function parseChart(data: string | null | undefined): ChartData {
  return normalizeChart(looseDataObject(data, LIMITS.maxChartDataLength));
}

/** Compact wire JSON (defaults omitted). A chart with no columns serialises to "". */
export function serializeChart(chart: ChartData): string {
  if (!chart.columns.length) return "";
  const o: Record<string, unknown> = { v: 1, kind: chart.kind };
  if (chart.title) o.title = chart.title;
  if (chart.takeaway) o.takeaway = chart.takeaway;
  o.columns = chart.columns;
  o.rows = chart.rows;
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
