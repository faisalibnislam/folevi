// Pure collection view logic (formulas, filters, sorts, summaries and exports), shared by the live embed
// (client) and the read-only copy on public share pages (server). No React, no Convex.
import {
  evaluateCollectionFormulas,
  formatTableDate,
  formatTableNumber,
  parseTableDate,
  parseTableNumber,
  type CollectionFormulaResult,
  type CollectionNumberFormat,
} from "@folevi/editor-schema";

export type PropertyType = "text" | "number" | "checkbox" | "date" | "select" | "multiSelect" | "url" | "person" | "relation" | "formula";
export type FilterOp = "is" | "isNot" | "contains" | "isEmpty" | "isNotEmpty" | "gt" | "lt" | "checked" | "unchecked";

export interface ViewProperty {
  id: string;
  name: string;
  type: PropertyType;
  options: { id: string; name: string; color: string }[];
  /** Formula properties: the formula. */
  formula?: string | null;
  /** Number and formula properties: how numbers show. */
  numberFormat?: CollectionNumberFormat | null;
}
export interface ViewFilter {
  propertyId: string;
  op: FilterOp;
  value?: unknown;
}
export interface ViewSort {
  propertyId: string;
  direction: "asc" | "desc";
}
export interface ViewRow {
  title: string;
  values: Record<string, unknown>;
}

/** The row title, filterable and sortable like a property. */
export const TITLE_ID = "title";
export type FilterTarget = { id: string; name: string; type: PropertyType | "title"; options: ViewProperty["options"] };

export const OPS: Record<FilterTarget["type"], FilterOp[]> = {
  title: ["contains", "is", "isNot", "isEmpty", "isNotEmpty"],
  text: ["contains", "is", "isNot", "isEmpty", "isNotEmpty"],
  url: ["contains", "is", "isNot", "isEmpty", "isNotEmpty"],
  number: ["is", "isNot", "gt", "lt", "isEmpty", "isNotEmpty"],
  checkbox: ["checked", "unchecked"],
  date: ["is", "lt", "gt", "isEmpty", "isNotEmpty"],
  select: ["is", "isNot", "isEmpty", "isNotEmpty"],
  multiSelect: ["is", "isNot", "isEmpty", "isNotEmpty"],
  person: ["is", "isNot", "isEmpty", "isNotEmpty"],
  relation: ["isNotEmpty", "isEmpty"],
  formula: ["contains", "is", "isNot", "gt", "lt", "isEmpty", "isNotEmpty", "checked", "unchecked"],
};

export const NO_VALUE_OPS: FilterOp[] = ["isEmpty", "isNotEmpty", "checked", "unchecked"];

export function opLabel(type: FilterTarget["type"], op: FilterOp): string {
  if (type === "date") return ({ is: "is on", isNot: "is not on", lt: "is before", gt: "is after", isEmpty: "is empty", isNotEmpty: "is not empty" } as Record<string, string>)[op] ?? op;
  if (type === "multiSelect") return ({ is: "has", isNot: "doesn’t have", isEmpty: "is empty", isNotEmpty: "is not empty" } as Record<string, string>)[op] ?? op;
  if (type === "number") return ({ is: "=", isNot: "≠", gt: ">", lt: "<", isEmpty: "is empty", isNotEmpty: "is not empty" } as Record<string, string>)[op] ?? op;
  return { is: "is", isNot: "is not", contains: "contains", isEmpty: "is empty", isNotEmpty: "is not empty", checked: "is checked", unchecked: "is unchecked", gt: "is greater than", lt: "is less than" }[op];
}

export function filterTargets(props: readonly ViewProperty[]): FilterTarget[] {
  return [{ id: TITLE_ID, name: "Name", type: "title", options: [] }, ...props.map((p) => ({ id: p.id, name: p.name, type: p.type, options: p.options }))];
}

/** Select filters store an option id; older views stored the typed option name, so map those to the id. */
export function resolveOption(target: FilterTarget, value: unknown): unknown {
  if (target.type !== "select" && target.type !== "multiSelect") return value;
  if (typeof value !== "string") return value;
  if (target.options.some((o) => o.id === value)) return value;
  return target.options.find((o) => o.name.toLowerCase() === value.trim().toLowerCase())?.id ?? value;
}

export function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

export function matchesFilter(row: ViewRow, f: ViewFilter, props: readonly ViewProperty[]): boolean {
  const target = filterTargets(props).find((t) => t.id === f.propertyId);
  if (!target) return true; // filter on a deleted property: ignored
  const v = target.type === "title" ? row.title : row.values[f.propertyId];
  if (target.type === "formula") return matchesFormula(isFormulaResult(v) ? v : undefined, f);
  const empty = isEmptyValue(v) || (target.type === "relation" && v === 0);
  switch (f.op) {
    case "isEmpty":
      return empty;
    case "isNotEmpty":
      return !empty;
    case "checked":
      return v === true;
    case "unchecked":
      return v !== true;
  }
  const wanted = resolveOption(target, f.value);
  if (isEmptyValue(wanted)) return true; // a filter without a value yet doesn't hide anything
  switch (target.type) {
    case "select":
    case "person":
      return f.op === "isNot" ? v !== wanted : f.op === "is" ? v === wanted : true;
    case "multiSelect": {
      const has = Array.isArray(v) && v.includes(wanted);
      return f.op === "isNot" ? !has : f.op === "is" ? has : true;
    }
    case "number": {
      const n = typeof v === "number" ? v : NaN;
      const t = typeof wanted === "number" ? wanted : Number(wanted);
      if (!Number.isFinite(t)) return true;
      if (f.op === "isNot") return n !== t;
      if (empty) return false;
      return f.op === "is" ? n === t : f.op === "gt" ? n > t : f.op === "lt" ? n < t : true;
    }
    case "date": {
      // ISO dates (YYYY-MM-DD) order correctly as strings; never coerce them to numbers.
      const t = String(wanted);
      if (f.op === "isNot") return v !== t;
      if (empty || typeof v !== "string") return false;
      return f.op === "is" ? v === t : f.op === "gt" ? v > t : f.op === "lt" ? v < t : true;
    }
    case "relation":
      return true;
    default: {
      const s = String(v ?? "").toLowerCase();
      const t = String(wanted).toLowerCase();
      return f.op === "contains" ? s.includes(t) : f.op === "is" ? s === t : f.op === "isNot" ? s !== t : true;
    }
  }
}

export function applyView<R extends ViewRow>(rows: R[], config: { filters: ViewFilter[]; sorts: ViewSort[] }, props: readonly ViewProperty[]): R[] {
  let out = rows.filter((r) => config.filters.every((f) => matchesFilter(r, f, props)));
  if (config.sorts.length) {
    out = [...out].sort((a, b) => {
      for (const s of config.sorts) {
        const av = sortValue(s.propertyId === TITLE_ID ? a.title : a.values[s.propertyId]);
        const bv = sortValue(s.propertyId === TITLE_ID ? b.title : b.values[s.propertyId]);
        const cmp = av === bv ? 0 : av === undefined ? 1 : bv === undefined ? -1 : typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
        if (cmp) return s.direction === "asc" ? cmp : -cmp;
      }
      return 0;
    });
  }
  return out;
}

/**
 * Rows placed on a calendar by a date property: by day (YYYY-MM-DD, in the order given), and the rows
 * with no date (or one that isn't a day) for the "No date" tray.
 */
export function rowsByDate<R extends ViewRow>(rows: R[], datePropertyId: string): { byDate: Map<string, R[]>; undated: R[] } {
  const byDate = new Map<string, R[]>();
  const undated: R[] = [];
  for (const r of rows) {
    const v = r.values[datePropertyId];
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      undated.push(r);
      continue;
    }
    const day = byDate.get(v);
    if (day) day.push(r);
    else byDate.set(v, [r]);
  }
  return { byDate, undated };
}

// ------------------------------------------------------------------------------------------- formulas

/** Whether a row value is a formula's result (formula properties hold one per row once worked out). */
export function isFormulaResult(v: unknown): v is CollectionFormulaResult {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && "kind" in v && "display" in v);
}

/** What a value sorts by: a formula by its result (empty and errors last), anything else as it is. */
function sortValue(v: unknown): unknown {
  if (!isFormulaResult(v)) return v;
  if (formulaEmpty(v) || v.kind === "error" || v.value === null) return undefined;
  return v.kind === "boolean" ? (v.value ? 1 : 0) : v.value;
}

/**
 * The rows with every formula property's result in place (values[formulaId] is a CollectionFormulaResult),
 * worked out on this device. Rows come back as they were when the collection has no formulas.
 */
export function withFormulaValues<R extends ViewRow>(rows: R[], props: readonly ViewProperty[], opts: { people?: readonly { id: string; name: string }[]; today?: Date | string; locale?: string } = {}): R[] {
  if (!props.some((p) => p.type === "formula")) return rows;
  const names = new Map((opts.people ?? []).map((p) => [p.id, p.name]));
  const results = evaluateCollectionFormulas(props, rows, { personName: (id) => names.get(id) ?? (opts.people ? "Someone" : id), today: opts.today, locale: opts.locale });
  return rows.map((r, i) => ({ ...r, values: { ...r.values, ...results[i] } }));
}

const formulaEmpty = (r: CollectionFormulaResult | undefined) => !r || r.kind === "empty" || (r.kind === "text" && !String(r.value ?? "").trim());

/** A filter on a formula: compares its result as what it is (a number, a date, text or true/false). */
function matchesFormula(r: CollectionFormulaResult | undefined, f: ViewFilter): boolean {
  switch (f.op) {
    case "isEmpty":
      return formulaEmpty(r);
    case "isNotEmpty":
      return !formulaEmpty(r);
    case "checked":
      return r?.kind === "boolean" && r.value === true;
    case "unchecked":
      return !(r?.kind === "boolean" && r.value === true);
  }
  const wanted = typeof f.value === "number" ? String(f.value) : typeof f.value === "string" ? f.value.trim() : "";
  if (!wanted) return true; // a filter without a value yet doesn't hide anything
  if (!r || r.kind === "error" || formulaEmpty(r)) return f.op === "isNot";
  let cmp: number | null = null;
  if (r.kind === "number") {
    const n = parseTableNumber(wanted);
    if (n !== null) cmp = Math.sign((r.value as number) - n);
  } else if (r.kind === "date") {
    const d = parseTableDate(wanted);
    if (d !== null) {
      const iso = new Date(d * 86_400_000).toISOString().slice(0, 10);
      cmp = r.value === iso ? 0 : String(r.value) < iso ? -1 : 1;
    }
  } else if (r.kind === "boolean") {
    const b = /^(true|yes|checked|1)$/i.test(wanted) ? true : /^(false|no|unchecked|0)$/i.test(wanted) ? false : null;
    if (b !== null) cmp = r.value === b ? 0 : r.value ? 1 : -1;
  }
  const text = r.display.toLowerCase();
  const w = wanted.toLowerCase();
  if (f.op === "contains") return text.includes(w) || String(r.value).toLowerCase().includes(w);
  if (cmp === null) cmp = String(r.value).toLowerCase() === w || text === w ? 0 : String(r.value).toLowerCase().localeCompare(w);
  return f.op === "is" ? cmp === 0 : f.op === "isNot" ? cmp !== 0 : f.op === "gt" ? cmp > 0 : f.op === "lt" ? cmp < 0 : true;
}

// ------------------------------------------------------------------------------------------- summaries

export type SummaryFn = "count" | "countEmpty" | "countNotEmpty" | "percentEmpty" | "percentNotEmpty" | "sum" | "average" | "min" | "max" | "percentChecked";
export interface ViewSummary {
  propertyId: string;
  fn: SummaryFn;
}

const EMPTY_FNS: SummaryFn[] = ["count", "countEmpty", "countNotEmpty", "percentEmpty", "percentNotEmpty"];

/** The summaries a column can show, by its type (the title is "title"). */
export function summaryFns(type: FilterTarget["type"]): SummaryFn[] {
  switch (type) {
    case "number":
      return [...EMPTY_FNS, "sum", "average", "min", "max"];
    case "formula":
      return [...EMPTY_FNS, "sum", "average", "min", "max", "percentChecked"];
    case "date":
      return [...EMPTY_FNS, "min", "max"];
    case "checkbox":
      return ["count", "countNotEmpty", "countEmpty", "percentChecked"];
    default:
      return EMPTY_FNS;
  }
}

/** A summary's name in the menu and before its value ("Sum", "Earliest" for a date's min, "Checked"). */
export function summaryLabel(type: FilterTarget["type"], fn: SummaryFn): string {
  if (type === "checkbox" && fn === "countNotEmpty") return "Checked";
  if (type === "checkbox" && fn === "countEmpty") return "Unchecked";
  if (type === "date" && fn === "min") return "Earliest";
  if (type === "date" && fn === "max") return "Latest";
  return {
    count: "Count all",
    countEmpty: "Empty",
    countNotEmpty: "Not empty",
    percentEmpty: "Percent empty",
    percentNotEmpty: "Percent not empty",
    sum: "Sum",
    average: "Average",
    min: "Min",
    max: "Max",
    percentChecked: "Percent checked",
  }[fn];
}

function valueEmpty(type: FilterTarget["type"], v: unknown): boolean {
  if (type === "checkbox") return v !== true;
  if (isFormulaResult(v)) return formulaEmpty(v);
  return isEmptyValue(v) || (type === "relation" && v === 0);
}

const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 1000) / 10}%` : "0%");

/**
 * A column's summary over the rows the view shows, as text ("12", "€1,234.50", "50%", "Oct 3, 2026"), or ""
 * when there's nothing to sum (no numbers in the column). Numbers take the property's number format.
 */
export function summarize(rows: readonly ViewRow[], target: { id: string; type: FilterTarget["type"]; numberFormat?: CollectionNumberFormat | null }, fn: SummaryFn, locale = "en-US"): string {
  const values = rows.map((r) => (target.id === TITLE_ID ? r.title : r.values[target.id]));
  const empty = values.filter((v) => valueEmpty(target.type, v)).length;
  switch (fn) {
    case "count":
      return String(rows.length);
    case "countEmpty":
      return String(empty);
    case "countNotEmpty":
      return String(rows.length - empty);
    case "percentEmpty":
      return percent(empty, rows.length);
    case "percentNotEmpty":
      return percent(rows.length - empty, rows.length);
    case "percentChecked": {
      const checked = values.filter((v) => v === true || (isFormulaResult(v) && v.kind === "boolean" && v.value === true)).length;
      return percent(checked, rows.length);
    }
  }
  // Dates (a date property, or a formula's dates when it gives no numbers) for min and max.
  const days: number[] = [];
  const nums: number[] = [];
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) nums.push(v);
    else if (target.type === "date" && typeof v === "string") {
      const d = parseTableDate(v);
      if (d !== null) days.push(d);
    } else if (isFormulaResult(v)) {
      if (v.kind === "number") nums.push(v.value as number);
      else if (v.kind === "date") {
        const d = parseTableDate(String(v.value));
        if (d !== null) days.push(d);
      }
    }
  }
  if ((fn === "min" || fn === "max") && !nums.length && days.length) return formatTableDate(fn === "min" ? Math.min(...days) : Math.max(...days), locale);
  if (!nums.length) return "";
  const n = fn === "sum" ? nums.reduce((a, b) => a + b, 0) : fn === "average" ? nums.reduce((a, b) => a + b, 0) / nums.length : fn === "min" ? Math.min(...nums) : Math.max(...nums);
  return formatTableNumber(n, target.numberFormat ?? { format: "number" }, locale);
}

// --------------------------------------------------------------------------------------------- exports

/** A number in a property's format (a plain number when it has none). */
export function formatPropertyNumber(n: number, format: CollectionNumberFormat | null | undefined, locale = "en-US"): string {
  return format ? formatTableNumber(n, format, locale) : formatTableNumber(n, null, locale);
}

export interface ExportOptions {
  people?: readonly { id: string; name: string }[];
  /** Linked pages' titles (relations), by page id. */
  titles?: Readonly<Record<string, string>>;
  /** "csv": numbers plain, dates as YYYY-MM-DD, checkboxes TRUE/FALSE. "markdown": what the view shows. */
  as: "csv" | "markdown";
  locale?: string;
}

/** A value as text in an export. */
export function exportValue(prop: ViewProperty, value: unknown, opts: ExportOptions): string {
  const md = opts.as === "markdown";
  if (prop.type === "checkbox") return value === true ? (md ? "Yes" : "TRUE") : md ? "No" : "FALSE";
  if (isFormulaResult(value)) {
    if (value.kind === "empty") return "";
    if (md || value.kind === "error" || value.kind === "text") return value.display;
    if (value.kind === "boolean") return value.value ? "TRUE" : "FALSE";
    return String(value.value);
  }
  if (isEmptyValue(value)) return "";
  const option = (id: unknown) => prop.options.find((o) => o.id === id)?.name ?? "";
  switch (prop.type) {
    case "number":
      return typeof value === "number" ? (md ? formatPropertyNumber(value, prop.numberFormat, opts.locale) : String(value)) : "";
    case "date":
      return typeof value === "string" ? (md && /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatTableDate(parseTableDate(value)!, opts.locale) : value) : "";
    case "select":
      return option(value);
    case "multiSelect":
      return Array.isArray(value) ? value.map(option).filter(Boolean).join(", ") : "";
    case "person":
      return typeof value === "string" ? (opts.people?.find((p) => p.id === value)?.name ?? (opts.people ? "Someone" : value)) : "";
    case "relation":
      if (typeof value === "number") return String(value);
      return Array.isArray(value) ? value.map((id) => opts.titles?.[String(id)] || "Untitled").join(", ") : "";
    default:
      return String(value);
  }
}

/** The view as a table of text: a Name column and one per visible property, a line per row. */
export function exportTable(rows: readonly ViewRow[], visible: readonly ViewProperty[], opts: ExportOptions): string[][] {
  return [["Name", ...visible.map((p) => p.name)], ...rows.map((r) => [r.title, ...visible.map((p) => exportValue(p, r.values[p.id], opts))])];
}

/** A table as CSV (RFC 4180: commas, quotes doubled, CRLF line ends). */
export function toCsv(table: readonly (readonly string[])[]): string {
  const field = (s: string) => (/[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  // A cell a spreadsheet would run as a formula (=, +, -, @) starts with a quote mark, as spreadsheets advise.
  const safe = (s: string) => (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s);
  return table.map((r) => r.map((c) => field(safe(c))).join(",")).join("\r\n") + "\r\n";
}

/** A table as a Markdown table (pipes escaped, line breaks as spaces). */
export function toMarkdownTable(table: readonly (readonly string[])[]): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
  const [head = [], ...body] = table;
  const lines = [`| ${head.map(cell).join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...body.map((r) => `| ${r.map(cell).join(" | ")} |`)];
  return lines.join("\n") + "\n";
}

// -------------------------------------------------------------------------------------------- grouping

export interface FormulaGroup {
  /** The same for every row with the same result. */
  key: string;
  result: CollectionFormulaResult;
}

/** A formula result's group key: its kind and value (every empty result together, every error together). */
export function formulaGroupKey(r: CollectionFormulaResult | undefined): string {
  if (!r || formulaEmpty(r)) return "empty";
  if (r.kind === "error") return "error";
  return `${r.kind}:${String(r.value)}`;
}

const KIND_ORDER: Record<CollectionFormulaResult["kind"], number> = { number: 0, date: 1, text: 2, boolean: 3, empty: 4, error: 5 };

/**
 * The groups a board grouped by a formula shows: one per distinct result among `rows`, numbers and dates in
 * order, text alphabetically, TRUE before FALSE, then the empty results, then the errors.
 */
export function formulaGroups(rows: readonly ViewRow[], propertyId: string): FormulaGroup[] {
  const seen = new Map<string, CollectionFormulaResult>();
  for (const r of rows) {
    const v = r.values[propertyId];
    const result: CollectionFormulaResult = isFormulaResult(v) ? v : { kind: "empty", value: null, display: "" };
    const key = formulaGroupKey(result);
    if (!seen.has(key)) seen.set(key, key === "empty" ? { kind: "empty", value: null, display: "" } : result);
  }
  return [...seen.entries()]
    .map(([key, result]) => ({ key, result }))
    .sort((a, b) => {
      const ka = KIND_ORDER[a.result.kind];
      const kb = KIND_ORDER[b.result.kind];
      if (ka !== kb) return ka - kb;
      const x = a.result.value;
      const y = b.result.value;
      if (typeof x === "number" && typeof y === "number") return x - y;
      if (typeof x === "boolean" && typeof y === "boolean") return Number(y) - Number(x);
      return String(x ?? "").localeCompare(String(y ?? ""), undefined, { numeric: true, sensitivity: "base" });
    });
}
