// Table formulas, number formats and views (sort and filter), like a small spreadsheet.
//
// A cell whose text starts with "=" is a formula; the text is stored in the cell as it was typed and the
// result is worked out wherever the table is shown (the editor, read-only pages, exports, search, charts).
// Everything here is pure: no DOM, no clock unless `today` isn't given.
//
//   evaluateTable(rows, options)  every cell's value and what it shows (formula results, column formats)
//   tableDisplayRows(rows, opts)  the rows with formula results and formatted numbers in place of their text
//   tableRowOrder(evaluated, ...) the order rows show in under a saved sort and filter
//   remapFormulaReferences(...)   rewrites A1 references after rows or columns move or are deleted
//
// References: A1 cells (B2, $B$2), ranges (B2:C5), whole columns (B:B, B:D) and column names from the header
// row (Price, [Unit price], Unit_price). Row 1 is the first row (the header row when there is one), as in
// Google Sheets. A whole column or a column name used as a range means the column's data rows: without the
// header row and without the totals row, so a total never counts itself. A column name used as a single
// value (=Price * Quantity) means that column's cell in the formula's own row.
import { TableColumnFormatValues, TableFilterOpValues, type InlineNode, type Mark, type TableColumnFormat, type TableFilterOp } from "./generated/schema";

// ------------------------------------------------------------------------------------------------ types

export const TABLE_COLUMN_FORMATS: readonly TableColumnFormat[] = TableColumnFormatValues;
/** Currencies a column can show (ISO 4217 codes). */
export const TABLE_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "INR", "BDT", "CAD", "AUD", "CHF", "CNY", "HKD", "SGD", "NZD", "SEK", "NOK", "DKK", "PLN", "BRL", "MXN", "ZAR", "KRW", "AED", "SAR", "PKR", "TRY"] as const;

/** A column's settings as stored in the table's `columns` prop (every field optional). */
export interface TableColumnSettings {
  format?: TableColumnFormat | string | null;
  currency?: string | null;
  decimals?: number | null;
}

export const TABLE_FILTER_OPS: readonly TableFilterOp[] = TableFilterOpValues;

/** The table's saved view (its `view` prop): the rows stay where they are, this is how they're shown. */
export interface TableViewInput {
  sort?: { column: number; desc?: boolean | null } | null;
  filters?: readonly { column: number; op: TableFilterOp | string; value?: string | null }[] | null;
}

export interface TableOptions {
  /** The first row names the columns (and isn't data). */
  headerRow?: boolean;
  /** The last row is the totals row (and isn't data). */
  totalsRow?: boolean;
  columns?: readonly (TableColumnSettings | null | undefined)[] | null;
  /** The date TODAY() gives: a Date or "YYYY-MM-DD" (default: today where this runs). */
  today?: Date | string;
  /** For number and date formats (default "en-US"). */
  locale?: string;
}

export type FormulaErrorCode = "#DIV/0!" | "#REF!" | "#NAME?" | "#VALUE!" | "#N/A" | "#NUM!" | "#CYCLE!" | "#ERROR!";

export interface FormulaError {
  code: FormulaErrorCode;
  /** A plain explanation, shown on hover. */
  message: string;
}

export type TableValueKind = "empty" | "number" | "date" | "text" | "boolean" | "error";

export interface EvaluatedCell {
  /** The cell's own text (a formula's source). */
  raw: string;
  /** What the cell shows: a formula's result, a number in the column's format, or the text as written. */
  display: string;
  /** The value, for charts, sorting and filters: a number (a date is its day number), text, true/false, or null. */
  value: number | string | boolean | null;
  kind: TableValueKind;
  formula: boolean;
  error?: FormulaError;
  /** Shown right-aligned (a number or a date). */
  numeric: boolean;
  /** What it shows differs from its text (a formula, or a number the column formats). */
  changed: boolean;
}

export interface EvaluatedTable {
  cells: EvaluatedCell[][];
  /** Each cell's `display`. */
  display: string[][];
  /** The rows that are data (not the header or totals row), by index. */
  bodyRows: number[];
  /** Column names (from the header row), "" where there's none. */
  names: string[];
}

/** A cell as the table holds it: inline content, or plain text (charts and tests). */
export type TableCellInput = readonly InlineNode[] | string;

// ----------------------------------------------------------------------------------------- small helpers

const DAY_MS = 86_400_000;

/** A column's letter: 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** A column's index from its letters ("A" → 0, "AA" → 26), or -1. */
export function columnIndex(letters: string): number {
  if (!/^[A-Za-z]{1,3}$/.test(letters)) return -1;
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** "B3" for row 2, column 1 (both from 0). */
export function cellReference(row: number, column: number): string {
  return `${columnLetter(column)}${row + 1}`;
}

/** A cell's plain text: mentions as "@name", dates as YYYY-MM-DD, page links by their title. */
export function tableCellText(cell: TableCellInput | null | undefined): string {
  if (cell == null) return "";
  if (typeof cell === "string") return cell;
  let out = "";
  for (const n of cell) {
    if (n.type === "text") out += n.text;
    else if (n.type === "mention") out += `@${n.label}`;
    else if (n.type === "date") out += n.date;
    else if (n.type === "pageLink") out += n.label;
  }
  return out;
}

/** Whether a cell's text is a formula. */
export function isFormula(text: string): boolean {
  return /^\s*=/.test(text) && text.trim().length > 1;
}

const ERROR_MESSAGES: Record<FormulaErrorCode, string> = {
  "#DIV/0!": "This divides by zero (or by an empty cell).",
  "#REF!": "This refers to a cell that isn't in the table.",
  "#NAME?": "Folevi doesn't know a name in this formula.",
  "#VALUE!": "A value here is the wrong kind, like text where a number should be.",
  "#N/A": "The value wasn't found.",
  "#NUM!": "The result isn't a number Folevi can show.",
  "#CYCLE!": "This formula depends on itself, directly or through other cells.",
  "#ERROR!": "Folevi couldn't read this formula.",
};

/** The plain explanation of an error code. */
export function formulaErrorMessage(code: FormulaErrorCode): string {
  return ERROR_MESSAGES[code];
}

// ------------------------------------------------------------------------------------------------ values

type V =
  | { k: "empty" }
  | { k: "num"; n: number; date?: boolean }
  | { k: "str"; s: string }
  | { k: "bool"; b: boolean }
  | { k: "err"; code: FormulaErrorCode; msg: string };

type Grid = V[][];

const EMPTY: V = { k: "empty" };
const err = (code: FormulaErrorCode, msg = ERROR_MESSAGES[code]): V => ({ k: "err", code, msg });
const num = (n: number, date = false): V => (Number.isFinite(n) ? (date ? { k: "num", n, date } : { k: "num", n }) : err("#NUM!", "The result is too large, or isn't a number."));
const str = (s: string): V => ({ k: "str", s });
const bool = (b: boolean): V => ({ k: "bool", b });

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function dayNumber(y: number, m: number, d: number): number | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1 || y > 9999) return null;
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / DAY_MS);
}

/** A date written as YYYY-MM-DD, YYYY/MM/DD, "Oct 19, 2026" or "19 Oct 2026", as a day number. */
export function parseTableDate(text: string): number | null {
  const t = text.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t);
  if (m) return dayNumber(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t);
  if (m) {
    const mi = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase());
    return mi < 0 ? null : dayNumber(Number(m[3]), mi + 1, Number(m[2]));
  }
  m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(t);
  if (m) {
    const mi = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase());
    return mi < 0 ? null : dayNumber(Number(m[3]), mi + 1, Number(m[1]));
  }
  return null;
}

/** A number written in a cell: "1,234.5", "$12", "-3", "12%" (0.12), "€ 9.99". Null when it isn't one. */
export function parseTableNumber(text: string): number | null {
  const t = text.trim();
  const m = /^([-+])?\s*([$€£¥₹৳])?\s*([-+])?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)\s*(%)?$/.exec(t);
  if (!m) return null;
  if (m[1] && m[3]) return null;
  let n = Number(m[4]!.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  if ((m[1] ?? m[3]) === "-") n = -n;
  if (m[5]) n /= 100;
  return n;
}

/** A cell that isn't a formula: what its text is worth. */
function literal(cell: TableCellInput | null | undefined): V {
  if (cell != null && typeof cell !== "string") {
    const parts = cell.filter((n) => !(n.type === "text" && !n.text.trim()));
    // A cell that is just a date (a Folevi date chip) is that date.
    if (parts.length === 1 && parts[0]!.type === "date") {
      const d = parseTableDate(parts[0]!.date);
      if (d !== null) return num(d, true);
    }
  }
  const text = tableCellText(cell);
  if (!text.trim()) return EMPTY;
  const n = parseTableNumber(text);
  if (n !== null) return num(n);
  const d = parseTableDate(text);
  if (d !== null) return num(d, true);
  if (/^\s*(true|false)\s*$/i.test(text)) return bool(/true/i.test(text));
  return str(text);
}

/** A number shown without a column format: at most 12 significant digits, so 0.1 + 0.2 shows 0.3. */
function plainNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  return String(Number(n.toPrecision(12)));
}

function isoDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function textOf(v: V): string {
  switch (v.k) {
    case "empty":
      return "";
    case "num":
      return v.date ? isoDate(v.n) : plainNumber(v.n);
    case "str":
      return v.s;
    case "bool":
      return v.b ? "TRUE" : "FALSE";
    case "err":
      return v.code;
  }
}

function toNum(v: V): V {
  switch (v.k) {
    case "num":
    case "err":
      return v;
    case "empty":
      return num(0);
    case "bool":
      return num(v.b ? 1 : 0);
    case "str": {
      if (!v.s.trim()) return num(0);
      const n = parseTableNumber(v.s);
      if (n !== null) return num(n);
      const d = parseTableDate(v.s);
      if (d !== null) return num(d, true);
      return err("#VALUE!", `"${v.s.length > 24 ? `${v.s.slice(0, 24)}…` : v.s}" isn't a number.`);
    }
  }
}

function toBool(v: V): V {
  switch (v.k) {
    case "bool":
    case "err":
      return v;
    case "empty":
      return bool(false);
    case "num":
      return bool(v.n !== 0);
    case "str":
      if (/^\s*true\s*$/i.test(v.s)) return bool(true);
      if (/^\s*false\s*$/i.test(v.s)) return bool(false);
      return err("#VALUE!", `"${v.s}" isn't TRUE or FALSE.`);
  }
}

// ------------------------------------------------------------------------------------------------ tokens

type Tok =
  | { t: "num"; v: number; at: number; end: number }
  | { t: "str"; v: string; at: number; end: number }
  | { t: "id"; v: string; at: number; end: number }
  | { t: "col"; c: number; at: number; end: number }
  | { t: "op"; v: string; at: number; end: number }
  | { t: "err"; v: FormulaErrorCode; at: number; end: number }
  | { t: "bad"; at: number; end: number };

const ERROR_LITERALS: FormulaErrorCode[] = ["#DIV/0!", "#REF!", "#NAME?", "#VALUE!", "#N/A", "#NUM!", "#CYCLE!", "#ERROR!"];

/** Header text as a name formulas can use: trimmed, spaces collapsed, lower case. */
function normName(s: string): string {
  return s.replace(/[\s_]+/g, " ").trim().toLowerCase();
}

const isIdStart = (ch: string | undefined) => !!ch && /[A-Za-z_$À-￿]/.test(ch);
const isIdChar = (ch: string | undefined) => !!ch && /[A-Za-z0-9_.$À-￿]/.test(ch);

function tokenize(src: string, names: readonly string[]): Tok[] {
  const out: Tok[] = [];
  // Longest names first, so "Unit price" wins over "Unit".
  const byLength = names
    .map((n, c) => ({ n: normName(n), c }))
    .filter((x) => x.n)
    .sort((a, b) => b.n.length - a.n.length);
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const at = i;
    if (/[0-9.]/.test(ch) && /[0-9]/.test(src[ch === "." ? i + 1 : i] ?? "")) {
      const m = /^(\d*\.?\d+(?:[eE][-+]?\d+)?)/.exec(src.slice(i))!;
      // "2:2" style row ranges aren't supported; a number is just a number.
      i += m[1]!.length;
      out.push({ t: "num", v: Number(m[1]), at, end: i });
      continue;
    }
    if (ch === '"') {
      let s = "";
      i++;
      let closed = false;
      while (i < src.length) {
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            s += '"';
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        s += src[i++];
      }
      out.push(closed ? { t: "str", v: s, at, end: i } : { t: "bad", at, end: i });
      continue;
    }
    if (ch === "[") {
      const close = src.indexOf("]", i);
      if (close < 0) {
        out.push({ t: "bad", at, end: src.length });
        break;
      }
      const name = normName(src.slice(i + 1, close));
      i = close + 1;
      const found = byLength.find((x) => x.n === name);
      out.push(found ? { t: "col", c: found.c, at, end: i } : { t: "id", v: `[${src.slice(at + 1, close)}]`, at, end: i });
      continue;
    }
    if (ch === "#") {
      const lit = ERROR_LITERALS.find((e) => src.slice(i, i + e.length).toUpperCase() === e);
      if (lit) {
        i += lit.length;
        out.push({ t: "err", v: lit, at, end: i });
        continue;
      }
    }
    if (isIdStart(ch)) {
      // A column's name (one word or several), unless it's a function being called.
      const lower = src.toLowerCase();
      let named: { c: number; len: number } | null = null;
      for (const x of byLength) {
        const len = matchName(lower, i, x.n);
        // Not a function being called, and not a column's letters in a range (A:A).
        if (len && !isIdChar(src[i + len]) && !/^\s*\(/.test(src.slice(i + len)) && !(/^[A-Za-z]{1,3}$/.test(src.slice(i, i + len)) && (/^\s*:/.test(src.slice(i + len)) || /:\s*$/.test(src.slice(0, i))))) {
          named = { c: x.c, len };
          break;
        }
      }
      let j = i;
      while (j < src.length && isIdChar(src[j])) j++;
      const word = src.slice(i, j);
      // An A1 reference always means the cell (a column called "Q1" is reached as [Q1]).
      if (named && !/^\$?[A-Za-z]{1,3}\$?\d+$/.test(word)) {
        i += named.len;
        out.push({ t: "col", c: named.c, at, end: i });
        continue;
      }
      i = j;
      out.push({ t: "id", v: word, at, end: i });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      i += 2;
      out.push({ t: "op", v: two, at, end: i });
      continue;
    }
    if ("+-*/^&%=<>(),;:".includes(ch)) {
      i++;
      out.push({ t: "op", v: ch === ";" ? "," : ch, at, end: i });
      continue;
    }
    i++;
    out.push({ t: "bad", at, end: i });
  }
  return out;
}

/** How many characters of `lower` from `at` spell `name` (spaces and underscores between words match any run of either). */
function matchName(lower: string, at: number, name: string): number {
  let i = at;
  for (let k = 0; k < name.length; k++) {
    const ch = name[k]!;
    if (ch === " ") {
      if (!/[\s_]/.test(lower[i] ?? "")) return 0;
      while (/[\s_]/.test(lower[i] ?? "")) i++;
      continue;
    }
    if (lower[i] !== ch) return 0;
    i++;
  }
  return i - at;
}

// ------------------------------------------------------------------------------------------------ parser

type Ast =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "cell"; r: number; c: number }
  | { t: "range"; r1: number; c1: number; r2: number; c2: number }
  | { t: "cols"; c1: number; c2: number }
  | { t: "name"; c: number }
  | { t: "call"; name: string; args: Ast[] }
  | { t: "un"; op: string; a: Ast }
  | { t: "bin"; op: string; a: Ast; b: Ast }
  | { t: "pct"; a: Ast }
  | { t: "err"; code: FormulaErrorCode; msg: string };

class ParseError extends Error {}

const CELL_RE = /^\$?([A-Za-z]{1,3})\$?(\d+)$/;
const COL_RE = /^\$?([A-Za-z]{1,3})$/;

function parseFormula(src: string, names: readonly string[]): Ast {
  const toks = tokenize(src, names);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => {
    const t = toks[p];
    return t?.t === "op" && t.v === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) throw new ParseError(`Expected "${v}"`);
    p++;
  };
  const comparison = (): Ast => {
    let a = concat();
    for (;;) {
      const t = peek();
      if (t?.t === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(t.v)) {
        p++;
        a = { t: "bin", op: t.v, a, b: concat() };
      } else return a;
    }
  };
  const concat = (): Ast => {
    let a = additive();
    while (isOp("&")) {
      p++;
      a = { t: "bin", op: "&", a, b: additive() };
    }
    return a;
  };
  const additive = (): Ast => {
    let a = term();
    for (;;) {
      if (isOp("+") || isOp("-")) {
        const op = (toks[p++] as { v: string }).v;
        a = { t: "bin", op, a, b: term() };
      } else return a;
    }
  };
  const term = (): Ast => {
    let a = power();
    for (;;) {
      if (isOp("*") || isOp("/")) {
        const op = (toks[p++] as { v: string }).v;
        a = { t: "bin", op, a, b: power() };
      } else return a;
    }
  };
  // As in spreadsheets: a minus sign binds tighter than ^ (-2^2 is 4), and ^ reads left to right.
  const power = (): Ast => {
    let a = unary();
    while (isOp("^")) {
      p++;
      a = { t: "bin", op: "^", a, b: unary() };
    }
    return a;
  };
  const unary = (): Ast => {
    if (isOp("-") || isOp("+")) {
      const op = (toks[p++] as { v: string }).v;
      return { t: "un", op, a: unary() };
    }
    return postfix();
  };
  const postfix = (): Ast => {
    let a = primary();
    while (isOp("%")) {
      p++;
      a = { t: "pct", a };
    }
    return a;
  };
  const primary = (): Ast => {
    const t = toks[p];
    if (!t) throw new ParseError("Unexpected end");
    p++;
    switch (t.t) {
      case "num":
        return { t: "num", v: t.v };
      case "str":
        return { t: "str", v: t.v };
      case "err":
        return { t: "err", code: t.v, msg: t.v === "#REF!" ? "This refers to a row or column that was deleted." : ERROR_MESSAGES[t.v] };
      case "col":
        return { t: "name", c: t.c };
      case "bad":
        throw new ParseError("Unexpected character");
      case "op":
        if (t.v === "(") {
          const inner = comparison();
          expect(")");
          return inner;
        }
        throw new ParseError(`Unexpected "${t.v}"`);
      case "id": {
        const word = t.v;
        if (isOp("(")) {
          p++;
          const args: Ast[] = [];
          if (!isOp(")")) {
            for (;;) {
              args.push(comparison());
              if (isOp(",")) {
                p++;
                continue;
              }
              break;
            }
          }
          expect(")");
          return { t: "call", name: word.toUpperCase(), args };
        }
        const cell = CELL_RE.exec(word);
        if (cell) {
          const r1 = Number(cell[2]) - 1;
          const c1 = columnIndex(cell[1]!);
          if (isOp(":")) {
            p++;
            const next = toks[p++];
            const end = next?.t === "id" ? CELL_RE.exec(next.v) : null;
            if (!end) throw new ParseError("Expected a cell after ':'");
            const r2 = Number(end[2]) - 1;
            const c2 = columnIndex(end[1]!);
            return { t: "range", r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
          }
          return { t: "cell", r: r1, c: c1 };
        }
        const col = COL_RE.exec(word);
        if (col && isOp(":")) {
          const next = toks[p + 1];
          const end = next?.t === "id" ? COL_RE.exec(next.v) : null;
          if (end) {
            p += 2;
            const a = columnIndex(col[1]!);
            const b = columnIndex(end[1]!);
            return { t: "cols", c1: Math.min(a, b), c2: Math.max(a, b) };
          }
        }
        if (/^true$/i.test(word)) return { t: "bool", v: true };
        if (/^false$/i.test(word)) return { t: "bool", v: false };
        return { t: "err", code: "#NAME?", msg: `There's no column called "${word.replace(/^\[|\]$/g, "")}". Use a column's name from the header row, or a cell like B2.` };
      }
    }
  };
  if (!toks.length) throw new ParseError("Empty");
  const ast = comparison();
  if (p < toks.length) throw new ParseError("Unexpected text after the formula");
  return ast;
}

// ------------------------------------------------------------------------------------------- evaluation

interface Ctx {
  rows: readonly (readonly (TableCellInput | null | undefined)[])[];
  height: number;
  width: number;
  names: string[];
  body: { first: number; last: number };
  today: number;
  values: Map<number, V>;
  visiting: Set<number>;
  depth: number;
}

const MAX_DEPTH = 400;

function evalCell(ctx: Ctx, r: number, c: number): V {
  if (r < 0 || c < 0 || r >= ctx.height || c >= ctx.width) return err("#REF!", `${cellReference(Math.max(0, r), Math.max(0, c))} is outside the table.`);
  const key = r * (ctx.width + 1) + c;
  const known = ctx.values.get(key);
  if (known) return known;
  if (ctx.visiting.has(key)) return err("#CYCLE!");
  const raw = ctx.rows[r]?.[c];
  const text = tableCellText(raw);
  if (!isFormula(text)) {
    const v = literal(raw);
    ctx.values.set(key, v);
    return v;
  }
  if (ctx.depth > MAX_DEPTH) return err("#CYCLE!", "Too many formulas depend on each other in a chain.");
  ctx.visiting.add(key);
  ctx.depth++;
  let v: V;
  try {
    const ast = parseFormula(text.trim().slice(1), ctx.names);
    v = scalar(ctx, ast, r);
  } catch (e) {
    v = e instanceof ParseError ? err("#ERROR!", "Folevi couldn't read this formula. Check its brackets, commas and quotes.") : err("#ERROR!");
  }
  ctx.depth--;
  ctx.visiting.delete(key);
  // A cycle found further down leaves every cell in it with the cycle error.
  ctx.values.set(key, v);
  return v;
}

/** A rectangle of cells, clipped to the table (a reference past its edge is an error). */
function grid(ctx: Ctx, r1: number, c1: number, r2: number, c2: number): Grid | V {
  if (r1 < 0 || c1 < 0 || r2 >= ctx.height || c2 >= ctx.width) return err("#REF!", "This range goes past the edge of the table.");
  const out: Grid = [];
  for (let r = r1; r <= r2; r++) {
    const row: V[] = [];
    for (let c = c1; c <= c2; c++) row.push(evalCell(ctx, r, c));
    out.push(row);
  }
  return out;
}

function bodyColumns(ctx: Ctx, c1: number, c2: number): Grid | V {
  if (c2 >= ctx.width) return err("#REF!", `Column ${columnLetter(c2)} isn't in the table.`);
  if (ctx.body.last < ctx.body.first) return [];
  return grid(ctx, ctx.body.first, c1, ctx.body.last, c2);
}

/** A reference or expression as cells. */
function range(ctx: Ctx, ast: Ast, row: number): Grid | V {
  switch (ast.t) {
    case "cell":
      return grid(ctx, ast.r, ast.c, ast.r, ast.c);
    case "range":
      return grid(ctx, ast.r1, ast.c1, ast.r2, ast.c2);
    case "cols":
      return bodyColumns(ctx, ast.c1, ast.c2);
    case "name":
      return bodyColumns(ctx, ast.c, ast.c);
    default:
      return [[scalar(ctx, ast, row)]];
  }
}

const isGrid = (g: Grid | V): g is Grid => Array.isArray(g);

function scalar(ctx: Ctx, ast: Ast, row: number): V {
  switch (ast.t) {
    case "num":
      return num(ast.v);
    case "str":
      return str(ast.v);
    case "bool":
      return bool(ast.v);
    case "err":
      return err(ast.code, ast.msg);
    case "cell":
      return evalCell(ctx, ast.r, ast.c);
    case "range":
    case "cols": {
      const g = range(ctx, ast, row);
      if (!isGrid(g)) return g;
      if (g.length === 1 && g[0]!.length === 1) return g[0]![0]!;
      return err("#VALUE!", "This needs one value, not a range of cells. Wrap the range in a function like SUM.");
    }
    case "name":
      if (row < ctx.body.first || row > ctx.body.last) return err("#VALUE!", `A column name means the cell in the formula's own row, and this row isn't a data row. Use SUM(${ctx.names[ast.c] || columnLetter(ast.c)}) or a cell like ${cellReference(ctx.body.first, ast.c)}.`);
      return evalCell(ctx, row, ast.c);
    case "pct": {
      const a = toNum(scalar(ctx, ast.a, row));
      return a.k === "err" ? a : num((a as { n: number }).n / 100);
    }
    case "un": {
      const a = toNum(scalar(ctx, ast.a, row));
      if (a.k === "err") return a;
      const n = (a as { n: number; date?: boolean }).n;
      return ast.op === "-" ? num(-n) : a;
    }
    case "bin":
      return binary(ctx, ast.op, scalar(ctx, ast.a, row), scalar(ctx, ast.b, row));
    case "call":
      return call(ctx, ast.name, ast.args, row);
  }
}

/** Order for comparisons: numbers, then text, then true/false (as in spreadsheets). */
function compare(a: V, b: V): number {
  const rank = (v: V) => (v.k === "num" || v.k === "empty" ? 0 : v.k === "str" ? 1 : 2);
  // An empty cell compares as 0 with a number and as "" with text.
  if (a.k === "empty" && b.k === "str") a = str("");
  if (b.k === "empty" && a.k === "str") b = str("");
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) {
    const x = a.k === "num" ? a.n : 0;
    const y = b.k === "num" ? b.n : 0;
    return x === y ? 0 : x < y ? -1 : 1;
  }
  if (ra === 1) {
    const x = (a as { s: string }).s.toLowerCase();
    const y = (b as { s: string }).s.toLowerCase();
    return x === y ? 0 : x < y ? -1 : 1;
  }
  return Number((a as { b: boolean }).b) - Number((b as { b: boolean }).b);
}

function binary(_ctx: Ctx, op: string, a: V, b: V): V {
  if (a.k === "err") return a;
  if (b.k === "err") return b;
  if (op === "&") return str(textOf(a) + textOf(b));
  if (["=", "<>", "<", ">", "<=", ">="].includes(op)) {
    const c = compare(a, b);
    return bool(op === "=" ? c === 0 : op === "<>" ? c !== 0 : op === "<" ? c < 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c >= 0);
  }
  const x = toNum(a);
  if (x.k === "err") return x;
  const y = toNum(b);
  if (y.k === "err") return y;
  const p = x as { n: number; date?: boolean };
  const q = y as { n: number; date?: boolean };
  switch (op) {
    case "+":
      return num(p.n + q.n, Boolean(p.date) !== Boolean(q.date));
    case "-":
      // Two dates: the days between them. A date minus days: a date.
      return num(p.n - q.n, Boolean(p.date) && !q.date);
    case "*":
      return num(p.n * q.n);
    case "/":
      return q.n === 0 ? err("#DIV/0!") : num(p.n / q.n);
    case "^":
      return num(p.n ** q.n);
  }
  return err("#ERROR!");
}

/** Every value in the arguments, ranges flattened; `fromRange` tells which came from a range. */
function values(ctx: Ctx, args: Ast[], row: number): { v: V; fromRange: boolean }[] | V {
  const out: { v: V; fromRange: boolean }[] = [];
  for (const a of args) {
    if (a.t === "cell" || a.t === "range" || a.t === "cols" || a.t === "name") {
      const g = range(ctx, a, row);
      if (!isGrid(g)) return g;
      for (const r of g) for (const v of r) out.push({ v, fromRange: true });
    } else out.push({ v: scalar(ctx, a, row), fromRange: false });
  }
  return out;
}

/** The numbers in the arguments, as SUM reads them: text and true/false in ranges are skipped. */
function numbers(ctx: Ctx, args: Ast[], row: number): number[] | V {
  const vs = values(ctx, args, row);
  if (!Array.isArray(vs)) return vs;
  const out: number[] = [];
  for (const { v, fromRange } of vs) {
    if (v.k === "err") return v;
    if (fromRange) {
      if (v.k === "num") out.push(v.n);
      continue;
    }
    if (v.k === "empty") continue;
    const n = toNum(v);
    if (n.k === "err") return n;
    out.push((n as { n: number }).n);
  }
  return out;
}

function argCount(name: string, args: Ast[], min: number, max: number): V | null {
  if (args.length >= min && args.length <= max) return null;
  const want = min === max ? `${min}` : max === Infinity ? `at least ${min}` : `${min} to ${max}`;
  return err("#N/A", `${name} takes ${want} value${want === "1" ? "" : "s"}, and this gives it ${args.length}.`);
}

/** A COUNTIF/SUMIF condition: ">5", "<=10", "<>done", "=x", "app*" (wildcards), or a value to match. */
function criterion(c: V): (v: V) => boolean {
  if (c.k === "num" || c.k === "bool" || c.k === "empty") return (v) => compare(v.k === "str" ? toNumOrSelf(v) : v, c) === 0 && v.k !== "empty";
  const s = c.k === "str" ? c.s : "";
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/s.exec(s)!;
  const op = m[1] ?? "=";
  const rest = m[2]!;
  const target = rest === "" ? EMPTY : literal(rest);
  if (target.k === "str" && (op === "=" || op === "<>")) {
    const re = new RegExp(`^${rest.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
    return (v) => (op === "=") === re.test(textOf(v));
  }
  if (target.k === "empty") return (v) => (op === "<>" ? v.k !== "empty" : v.k === "empty" || (v.k === "str" && !v.s));
  return (v) => {
    const x = v.k === "str" ? toNumOrSelf(v) : v;
    if (x.k !== target.k && op !== "<>") return false;
    const cmp = compare(x, target);
    return op === "=" ? cmp === 0 : op === "<>" ? cmp !== 0 : op === "<" ? cmp < 0 : op === ">" ? cmp > 0 : op === "<=" ? cmp <= 0 : cmp >= 0;
  };
}

function toNumOrSelf(v: V): V {
  const n = toNum(v);
  return n.k === "err" ? v : n;
}

function same(a: V, b: V): boolean {
  if (a.k === "err" || b.k === "err") return false;
  const x = a.k === "str" ? toNumOrSelf(a) : a;
  const y = b.k === "str" ? toNumOrSelf(b) : b;
  return compare(x, y) === 0 && (x.k === "empty") === (y.k === "empty");
}

const toDay = (v: V): V => {
  const n = toNum(v);
  return n.k === "err" ? n : num(Math.floor((n as { n: number }).n), true);
};

function call(ctx: Ctx, name: string, args: Ast[], row: number): V {
  const one = (i: number) => scalar(ctx, args[i]!, row);
  const n = (i: number): V => toNum(one(i));
  switch (name) {
    case "SUM":
    case "AVERAGE":
    case "MIN":
    case "MAX":
    case "PRODUCT":
    case "MEDIAN": {
      const bad = argCount(name, args, 1, Infinity);
      if (bad) return bad;
      const ns = numbers(ctx, args, row);
      if (!Array.isArray(ns)) return ns;
      if (name === "SUM") return num(ns.reduce((s, x) => s + x, 0));
      if (name === "PRODUCT") return num(ns.reduce((s, x) => s * x, 1));
      if (!ns.length) return name === "AVERAGE" || name === "MEDIAN" ? err("#DIV/0!", `There are no numbers to take the ${name === "AVERAGE" ? "average" : "median"} of.`) : num(0);
      if (name === "AVERAGE") return num(ns.reduce((s, x) => s + x, 0) / ns.length);
      if (name === "MIN") return num(Math.min(...ns));
      if (name === "MAX") return num(Math.max(...ns));
      const sorted = [...ns].sort((a, b) => a - b);
      const mid = sorted.length >> 1;
      return num(sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
    }
    case "COUNT":
    case "COUNTA":
    case "COUNTBLANK": {
      const bad = argCount(name, args, 1, Infinity);
      if (bad) return bad;
      const vs = values(ctx, args, row);
      if (!Array.isArray(vs)) return vs;
      if (name === "COUNT") return num(vs.filter(({ v, fromRange }) => v.k === "num" || (!fromRange && toNum(v).k === "num" && v.k !== "empty")).length);
      if (name === "COUNTA") return num(vs.filter(({ v }) => v.k !== "empty").length);
      return num(vs.filter(({ v }) => v.k === "empty" || (v.k === "str" && !v.s)).length);
    }
    case "ROUND":
    case "ROUNDUP":
    case "ROUNDDOWN": {
      const bad = argCount(name, args, 1, 2);
      if (bad) return bad;
      const x = n(0);
      if (x.k === "err") return x;
      const d = args.length > 1 ? n(1) : num(0);
      if (d.k === "err") return d;
      const f = 10 ** Math.trunc((d as { n: number }).n);
      const v = (x as { n: number }).n * f;
      const rounded = name === "ROUND" ? Math.sign(v) * Math.round(Math.abs(v) + 1e-9) : name === "ROUNDUP" ? Math.sign(v) * Math.ceil(Math.abs(v) - 1e-9) : Math.trunc(v);
      return num(rounded / f, Boolean((x as { date?: boolean }).date));
    }
    case "ABS": {
      const bad = argCount(name, args, 1, 1);
      if (bad) return bad;
      const x = n(0);
      return x.k === "err" ? x : num(Math.abs((x as { n: number }).n));
    }
    case "IF": {
      const bad = argCount(name, args, 2, 3);
      if (bad) return bad;
      const c = toBool(one(0));
      if (c.k === "err") return c;
      return (c as { b: boolean }).b ? one(1) : args.length > 2 ? one(2) : bool(false);
    }
    case "AND":
    case "OR": {
      const bad = argCount(name, args, 1, Infinity);
      if (bad) return bad;
      const vs = values(ctx, args, row);
      if (!Array.isArray(vs)) return vs;
      const bs: boolean[] = [];
      for (const { v, fromRange } of vs) {
        if (fromRange && (v.k === "empty" || v.k === "str")) continue;
        const b = toBool(v);
        if (b.k === "err") return b;
        bs.push((b as { b: boolean }).b);
      }
      if (!bs.length) return err("#VALUE!", `${name} has no TRUE or FALSE values to check.`);
      return bool(name === "AND" ? bs.every(Boolean) : bs.some(Boolean));
    }
    case "NOT": {
      const bad = argCount(name, args, 1, 1);
      if (bad) return bad;
      const b = toBool(one(0));
      return b.k === "err" ? b : bool(!(b as { b: boolean }).b);
    }
    case "IFERROR": {
      const bad = argCount(name, args, 1, 2);
      if (bad) return bad;
      const v = one(0);
      return v.k === "err" ? (args.length > 1 ? one(1) : EMPTY) : v;
    }
    case "CONCAT":
    case "CONCATENATE": {
      const vs = values(ctx, args, row);
      if (!Array.isArray(vs)) return vs;
      const e = vs.find(({ v }) => v.k === "err");
      if (e) return e.v;
      return str(vs.map(({ v }) => textOf(v)).join(""));
    }
    case "LEFT":
    case "RIGHT": {
      const bad = argCount(name, args, 1, 2);
      if (bad) return bad;
      const s = one(0);
      if (s.k === "err") return s;
      const k = args.length > 1 ? n(1) : num(1);
      if (k.k === "err") return k;
      const count = Math.trunc((k as { n: number }).n);
      if (count < 0) return err("#VALUE!", `${name} can't take a negative number of characters.`);
      const t = [...textOf(s)];
      return str(name === "LEFT" ? t.slice(0, count).join("") : t.slice(Math.max(0, t.length - count)).join(""));
    }
    case "MID": {
      const bad = argCount(name, args, 3, 3);
      if (bad) return bad;
      const s = one(0);
      if (s.k === "err") return s;
      const a = n(1);
      const b = n(2);
      if (a.k === "err") return a;
      if (b.k === "err") return b;
      const start = Math.trunc((a as { n: number }).n);
      const len = Math.trunc((b as { n: number }).n);
      if (start < 1 || len < 0) return err("#VALUE!", "MID needs a start of 1 or more and a length of 0 or more.");
      return str([...textOf(s)].slice(start - 1, start - 1 + len).join(""));
    }
    case "LEN":
    case "UPPER":
    case "LOWER":
    case "TRIM": {
      const bad = argCount(name, args, 1, 1);
      if (bad) return bad;
      const s = one(0);
      if (s.k === "err") return s;
      const t = textOf(s);
      return name === "LEN" ? num([...t].length) : str(name === "UPPER" ? t.toUpperCase() : name === "LOWER" ? t.toLowerCase() : t.replace(/\s+/g, " ").trim());
    }
    case "TODAY": {
      const bad = argCount(name, args, 0, 0);
      return bad ?? num(ctx.today, true);
    }
    case "DATE": {
      const bad = argCount(name, args, 3, 3);
      if (bad) return bad;
      const parts: number[] = [];
      for (let i = 0; i < 3; i++) {
        const x = n(i);
        if (x.k === "err") return x;
        parts.push(Math.trunc((x as { n: number }).n));
      }
      // Months and days past their end roll over, as in spreadsheets (DATE(2026, 13, 1) is January 2027).
      return num(Math.round(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!) / DAY_MS), true);
    }
    case "DAYS": {
      const bad = argCount(name, args, 2, 2);
      if (bad) return bad;
      const end = toDay(one(0));
      const start = toDay(one(1));
      if (end.k === "err") return end;
      if (start.k === "err") return start;
      return num((end as { n: number }).n - (start as { n: number }).n);
    }
    case "DATEDIF": {
      const bad = argCount(name, args, 3, 3);
      if (bad) return bad;
      const a = toDay(one(0));
      const b = toDay(one(1));
      if (a.k === "err") return a;
      if (b.k === "err") return b;
      const unit = textOf(one(2)).toUpperCase();
      const x = (a as { n: number }).n;
      const y = (b as { n: number }).n;
      if (y < x) return err("#NUM!", "DATEDIF needs the start date before the end date.");
      if (unit === "D") return num(y - x);
      const da = new Date(x * DAY_MS);
      const db = new Date(y * DAY_MS);
      let months = (db.getUTCFullYear() - da.getUTCFullYear()) * 12 + (db.getUTCMonth() - da.getUTCMonth());
      if (db.getUTCDate() < da.getUTCDate()) months--;
      if (unit === "M") return num(months);
      if (unit === "Y") return num(Math.floor(months / 12));
      return err("#NUM!", 'DATEDIF counts in "D" (days), "M" (months) or "Y" (years).');
    }
    case "YEAR":
    case "MONTH":
    case "DAY": {
      const bad = argCount(name, args, 1, 1);
      if (bad) return bad;
      const d = toDay(one(0));
      if (d.k === "err") return d;
      const date = new Date((d as { n: number }).n * DAY_MS);
      return num(name === "YEAR" ? date.getUTCFullYear() : name === "MONTH" ? date.getUTCMonth() + 1 : date.getUTCDate());
    }
    case "COUNTIF":
    case "SUMIF":
    case "AVERAGEIF": {
      const bad = argCount(name, args, 2, name === "COUNTIF" ? 2 : 3);
      if (bad) return bad;
      const where = range(ctx, args[0]!, row);
      if (!isGrid(where)) return where;
      const test = one(1);
      if (test.k === "err") return test;
      const match = criterion(test);
      const pick = name !== "COUNTIF" && args.length > 2 ? range(ctx, args[2]!, row) : where;
      if (!isGrid(pick)) return pick;
      let count = 0;
      let sum = 0;
      where.forEach((r, i) =>
        r.forEach((v, j) => {
          if (!match(v)) return;
          count++;
          const s = pick[i]?.[j];
          if (s?.k === "num") sum += s.n;
        }),
      );
      if (name === "COUNTIF") return num(count);
      if (name === "SUMIF") return num(sum);
      return count ? num(sum / count) : err("#DIV/0!", "No cells match, so there's nothing to average.");
    }
    case "VLOOKUP": {
      const bad = argCount(name, args, 3, 4);
      if (bad) return bad;
      const key = one(0);
      if (key.k === "err") return key;
      const g = range(ctx, args[1]!, row);
      if (!isGrid(g)) return g;
      const idx = n(2);
      if (idx.k === "err") return idx;
      const col = Math.trunc((idx as { n: number }).n) - 1;
      if (col < 0 || col >= (g[0]?.length ?? 0)) return err("#REF!", `VLOOKUP's column number ${col + 1} is outside the range it looks in.`);
      const sorted = args.length > 3 ? toBool(one(3)) : bool(true);
      if (sorted.k === "err") return sorted;
      let found = -1;
      if ((sorted as { b: boolean }).b) {
        // Sorted: the last row whose first value isn't past the key.
        for (let i = 0; i < g.length; i++) {
          const v = g[i]![0]!;
          if (v.k === "empty" || v.k === "err") continue;
          if (compare(v.k === "str" ? toNumOrSelf(v) : v, key.k === "str" ? toNumOrSelf(key) : key) <= 0) found = i;
          else break;
        }
      } else found = g.findIndex((r) => same(r[0]!, key));
      return found < 0 ? err("#N/A", `VLOOKUP didn't find "${textOf(key)}" in the first column of its range.`) : g[found]![col]!;
    }
    case "XLOOKUP": {
      const bad = argCount(name, args, 3, 4);
      if (bad) return bad;
      const key = one(0);
      if (key.k === "err") return key;
      const look = range(ctx, args[1]!, row);
      const give = range(ctx, args[2]!, row);
      if (!isGrid(look)) return look;
      if (!isGrid(give)) return give;
      // A column (or a row) to look in, and one the same length to take the answer from.
      const vertical = look.length > 1 || (look[0]?.length ?? 0) <= 1;
      const keys = vertical ? look.map((r) => r[0]!) : look[0]!;
      const answers = vertical ? give.map((r) => r[0]!) : (give[0] ?? []);
      if (keys.length !== answers.length) return err("#VALUE!", "XLOOKUP's two ranges need to be the same size.");
      const i = keys.findIndex((v) => same(v, key));
      if (i >= 0) return answers[i]!;
      return args.length > 3 ? one(3) : err("#N/A", `XLOOKUP didn't find "${textOf(key)}".`);
    }
    default:
      return err("#NAME?", `Folevi doesn't know a function called ${name}.`);
  }
}

// ------------------------------------------------------------------------------------------- formatting

const DATE_FORMAT_CACHE = new Map<string, Intl.DateTimeFormat>();
function dateFormatter(locale: string): Intl.DateTimeFormat {
  let f = DATE_FORMAT_CACHE.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
    DATE_FORMAT_CACHE.set(locale, f);
  }
  return f;
}

/** A day number as a date: "Oct 19, 2026". */
export function formatTableDate(day: number, locale = "en-US"): string {
  try {
    return dateFormatter(locale).format(new Date(day * DAY_MS));
  } catch {
    return isoDate(day);
  }
}

const clampDecimals = (d: unknown): number | undefined => (typeof d === "number" && Number.isFinite(d) ? Math.min(6, Math.max(0, Math.round(d))) : undefined);

/** A number in a column's format (thousands separators, a currency, a percentage or a date). */
export function formatTableNumber(n: number, column: TableColumnSettings | null | undefined, locale = "en-US", isDate = false): string {
  const format = column?.format;
  const decimals = clampDecimals(column?.decimals);
  try {
    switch (format) {
      case "number":
        return new Intl.NumberFormat(locale, { minimumFractionDigits: decimals ?? 0, maximumFractionDigits: decimals ?? 2 }).format(n);
      case "currency": {
        const code = (TABLE_CURRENCIES as readonly string[]).includes(String(column?.currency)) ? String(column!.currency) : "USD";
        return new Intl.NumberFormat(locale, { style: "currency", currency: code, ...(decimals !== undefined ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals } : {}) }).format(n);
      }
      case "percent":
        return new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: decimals ?? 0, maximumFractionDigits: decimals ?? 2 }).format(n);
      case "date":
        return formatTableDate(Math.floor(n), locale);
    }
  } catch {
    /* an unusual locale: shown plain */
  }
  return isDate ? formatTableDate(n, locale) : plainNumber(n);
}

// --------------------------------------------------------------------------------------------- the table

function todayNumber(today: Date | string | undefined): number {
  if (typeof today === "string") {
    const d = parseTableDate(today);
    if (d !== null) return d;
  }
  const t = today instanceof Date ? today : new Date();
  return Math.round(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / DAY_MS);
}

/** The column names formulas can use: the header row's text (when the table has one). */
export function tableColumnNames(rows: readonly (readonly (TableCellInput | null | undefined)[])[], headerRow: boolean | undefined): string[] {
  const width = rows[0]?.length ?? 0;
  return Array.from({ length: width }, (_, c) => (headerRow ? tableCellText(rows[0]?.[c]).replace(/\s+/g, " ").trim() : ""));
}

/** The rows that are data: after the header row, before the totals row. */
function bodyRange(height: number, headerRow: boolean | undefined, totalsRow: boolean | undefined): { first: number; last: number } {
  const first = headerRow && height > 0 ? 1 : 0;
  const last = totalsRow && height - 1 >= first ? height - 2 : height - 1;
  return { first, last };
}

/**
 * Every cell's value and what it shows. Formulas are worked out (in any order: each cell once, cycles
 * found), numbers take their column's format, and everything else shows its text. Never throws.
 */
export function evaluateTable(rows: readonly (readonly (TableCellInput | null | undefined)[])[], options: TableOptions = {}): EvaluatedTable {
  const height = rows.length;
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const names = tableColumnNames(rows, options.headerRow);
  const body = bodyRange(height, options.headerRow, options.totalsRow);
  const locale = options.locale ?? "en-US";
  const ctx: Ctx = { rows, height, width, names, body, today: todayNumber(options.today), values: new Map(), visiting: new Set(), depth: 0 };
  const cells: EvaluatedCell[][] = [];
  for (let r = 0; r < height; r++) {
    const out: EvaluatedCell[] = [];
    for (let c = 0; c < width; c++) {
      const raw = tableCellText(rows[r]?.[c]);
      const formula = isFormula(raw);
      const v = evalCell(ctx, r, c);
      const column = options.columns?.[c] ?? null;
      // The header row is names, never formatted.
      const header = Boolean(options.headerRow) && r === 0;
      out.push(describe(v, raw, formula, header ? null : column, locale));
    }
    cells.push(out);
  }
  return { cells, display: cells.map((r) => r.map((c) => c.display)), bodyRows: Array.from({ length: Math.max(0, body.last - body.first + 1) }, (_, i) => body.first + i), names };
}

function describe(v: V, raw: string, formula: boolean, column: TableColumnSettings | null, locale: string): EvaluatedCell {
  switch (v.k) {
    case "err":
      return { raw, display: v.code, value: null, kind: "error", formula, error: { code: v.code, message: v.msg }, numeric: false, changed: true };
    case "empty":
      return { raw, display: formula ? "" : raw, value: null, kind: "empty", formula, numeric: false, changed: formula };
    case "bool": {
      const display = v.b ? "TRUE" : "FALSE";
      return { raw, display: formula ? display : raw, value: v.b, kind: "boolean", formula, numeric: false, changed: formula };
    }
    case "str":
      return { raw, display: v.s, value: v.s, kind: "text", formula, numeric: false, changed: formula };
    case "num": {
      const formatted = column?.format || v.date ? formatTableNumber(v.n, column, locale, Boolean(v.date)) : plainNumber(v.n);
      // A number typed in a column without a format shows as it was typed ("1,000" stays "1,000").
      const display = formula || column?.format ? formatted : raw.trim();
      return { raw, display, value: v.n, kind: v.date ? "date" : "number", formula, numeric: true, changed: display !== raw };
    }
  }
}

/**
 * The rows as they read in exports, search and other apps: a formula's result (or a formatted number) in place
 * of its text, keeping the cell's formatting (its first run's marks); every other cell as it is.
 */
export function tableDisplayRows(rows: readonly (readonly InlineNode[])[][] | InlineNode[][][], options: TableOptions = {}): InlineNode[][][] {
  const evaluated = evaluateTable(rows, options);
  return (rows as InlineNode[][][]).map((row, r) =>
    row.map((cell, c) => {
      const e = evaluated.cells[r]?.[c];
      if (!e?.changed) return cell;
      if (!e.display) return [];
      const marks = (cell.find((n) => n.type === "text") as { marks?: Mark[] } | undefined)?.marks;
      return [marks?.length ? { type: "text", text: e.display, marks } : { type: "text", text: e.display }];
    }),
  );
}

/** The table's options read from its block props (headerRow, totalsRow, columns). */
export function tableOptionsFromProps(props: Record<string, unknown>, extra: Pick<TableOptions, "today" | "locale"> = {}): TableOptions {
  return {
    headerRow: props.headerRow !== false,
    totalsRow: props.totalsRow === true,
    columns: Array.isArray(props.columns) ? (props.columns as TableColumnSettings[]) : null,
    ...extra,
  };
}

// -------------------------------------------------------------------------------------------- the view

function filterMatches(cell: EvaluatedCell | undefined, op: string, value: string): boolean {
  const shown = (cell?.display ?? "").trim();
  const v = value.trim();
  const isEmpty = !shown;
  switch (op) {
    case "empty":
      return isEmpty;
    case "notEmpty":
      return !isEmpty;
    case "contains":
      return shown.toLowerCase().includes(v.toLowerCase());
    case "notContains":
      return !shown.toLowerCase().includes(v.toLowerCase());
  }
  const target = parseTableNumber(v) ?? parseTableDate(v);
  const own = typeof cell?.value === "number" ? cell.value : null;
  const cmp = target !== null && own !== null ? Math.sign(own - target) : shown.toLowerCase().localeCompare(v.toLowerCase());
  switch (op) {
    case "equals":
      return cmp === 0;
    case "notEquals":
      return cmp !== 0;
    case "gt":
      return !isEmpty && cmp > 0;
    case "gte":
      return !isEmpty && cmp >= 0;
    case "lt":
      return !isEmpty && cmp < 0;
    case "lte":
      return !isEmpty && cmp <= 0;
  }
  return true;
}

/**
 * The rows in the order they show under the table's saved view: the header row first, then the data rows
 * that pass every filter, sorted (numbers by value, text alphabetically, empty cells last; ties keep their
 * order), then the totals row. Rows are indices into the stored rows, which never move.
 */
export function tableRowOrder(evaluated: EvaluatedTable, options: TableOptions, view: TableViewInput | null | undefined): number[] {
  const height = evaluated.cells.length;
  const head = options.headerRow && height > 0 ? [0] : [];
  const tail = options.totalsRow && height > head.length ? [height - 1] : [];
  let body = evaluated.bodyRows.filter((r) => !head.includes(r) && !tail.includes(r));
  const width = evaluated.cells[0]?.length ?? 0;
  for (const f of view?.filters ?? []) {
    if (!f || f.column < 0 || f.column >= width) continue;
    body = body.filter((r) => filterMatches(evaluated.cells[r]?.[f.column], f.op, f.value ?? ""));
  }
  const sort = view?.sort;
  if (sort && sort.column >= 0 && sort.column < width) {
    const dir = sort.desc ? -1 : 1;
    const collator = new Intl.Collator(options.locale ?? "en-US", { numeric: true, sensitivity: "base" });
    body = body
      .map((r, i) => ({ r, i, cell: evaluated.cells[r]?.[sort.column] }))
      .sort((a, b) => {
        const ea = !a.cell?.display.trim();
        const eb = !b.cell?.display.trim();
        if (ea !== eb) return ea ? 1 : -1;
        if (ea && eb) return a.i - b.i;
        const na = typeof a.cell?.value === "number";
        const nb = typeof b.cell?.value === "number";
        let cmp: number;
        if (na && nb) cmp = (a.cell!.value as number) - (b.cell!.value as number);
        else if (na !== nb) cmp = na ? -1 : 1;
        else cmp = collator.compare(a.cell!.display, b.cell!.display);
        return cmp * dir || a.i - b.i;
      })
      .map((x) => x.r);
  }
  return [...head, ...body, ...tail];
}

// ------------------------------------------------------------------------------- totals and references

export type TotalsFunction = "SUM" | "AVERAGE" | "COUNT" | "COUNTA" | "MIN" | "MAX";
export const TOTALS_FUNCTIONS: readonly TotalsFunction[] = ["SUM", "AVERAGE", "COUNT", "COUNTA", "MIN", "MAX"];

/** A totals cell's formula: =SUM(B:B) (a whole column means its data rows, never the totals row). */
export function totalsFormula(fn: TotalsFunction, column: number): string {
  const l = columnLetter(column);
  return `=${fn}(${l}:${l})`;
}

/** Which total a totals cell holds (=SUM(B:B) → "SUM"), or null for anything else. */
export function totalsFunctionOf(text: string, column: number): TotalsFunction | null {
  const m = /^\s*=\s*([A-Za-z]+)\(\s*\$?([A-Za-z]{1,3})\s*:\s*\$?([A-Za-z]{1,3})\s*\)\s*$/.exec(text);
  if (!m) return null;
  const fn = m[1]!.toUpperCase() as TotalsFunction;
  if (!TOTALS_FUNCTIONS.includes(fn)) return null;
  return columnIndex(m[2]!) === column && columnIndex(m[3]!) === column ? fn : null;
}

/**
 * A formula with its A1 references moved after rows or columns move or are deleted: `rows(r)` and `cols(c)`
 * give an old index's new one, or null when it was deleted. A deleted cell becomes #REF!; a range loses the
 * deleted rows or columns at its ends (and is #REF! when nothing is left). Column names are left alone (they
 * follow their column). Text that isn't a formula comes back as it is.
 */
export function remapFormulaReferences(text: string, maps: { rows?: (r: number) => number | null; cols?: (c: number) => number | null }): string {
  if (!isFormula(text)) return text;
  const lead = text.indexOf("=") + 1;
  const src = text.slice(lead);
  const rowMap = maps.rows ?? ((r: number) => r);
  const colMap = maps.cols ?? ((c: number) => c);
  // Names aren't known here: a bracketed name is skipped as a whole, a bare word that isn't A1 is left.
  const toks = tokenize(src, []);
  const edits: { at: number; end: number; text: string }[] = [];
  const span = (lo: number, hi: number, map: (i: number) => number | null): [number, number] | null => {
    const kept: number[] = [];
    for (let i = lo; i <= hi; i++) {
      const m = map(i);
      if (m !== null) kept.push(m);
    }
    return kept.length ? [Math.min(...kept), Math.max(...kept)] : null;
  };
  const ref = (word: string, r: number, c: number) => {
    const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(word)!;
    return `${m[1]}${columnLetter(c)}${m[3]}${r + 1}`;
  };
  const colWord = (word: string, c: number) => `${word.startsWith("$") ? "$" : ""}${columnLetter(c)}`;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.t !== "id") continue;
    if (toks[i + 1]?.t === "op" && (toks[i + 1] as { v: string }).v === "(") continue;
    const next = toks[i + 1];
    const after = toks[i + 2];
    const colon = next?.t === "op" && next.v === ":" && after?.t === "id";
    const cell = CELL_RE.exec(t.v);
    if (cell && colon && CELL_RE.test((after as { v: string }).v)) {
      const end = CELL_RE.exec((after as { v: string }).v)!;
      const r1 = Number(cell[2]) - 1;
      const r2 = Number(end[2]) - 1;
      const c1 = columnIndex(cell[1]!);
      const c2 = columnIndex(end[1]!);
      const rs = span(Math.min(r1, r2), Math.max(r1, r2), rowMap);
      const cs = span(Math.min(c1, c2), Math.max(c1, c2), colMap);
      edits.push({ at: t.at, end: after!.end, text: rs && cs ? `${ref(t.v, rs[0], cs[0])}:${ref((after as { v: string }).v, rs[1], cs[1])}` : "#REF!" });
      i += 2;
      continue;
    }
    if (cell) {
      const r = rowMap(Number(cell[2]) - 1);
      const c = colMap(columnIndex(cell[1]!));
      edits.push({ at: t.at, end: t.end, text: r === null || c === null ? "#REF!" : ref(t.v, r, c) });
      continue;
    }
    const col = COL_RE.exec(t.v);
    if (col && colon && COL_RE.test((after as { v: string }).v)) {
      const a = columnIndex(col[1]!);
      const b = columnIndex(COL_RE.exec((after as { v: string }).v)![1]!);
      const cs = span(Math.min(a, b), Math.max(a, b), colMap);
      edits.push({ at: t.at, end: after!.end, text: cs ? `${colWord(t.v, cs[0])}:${colWord((after as { v: string }).v, cs[1])}` : "#REF!" });
      i += 2;
    }
  }
  if (!edits.length) return text;
  let out = src;
  for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.end);
  return text.slice(0, lead) + out;
}

/** Every formula cell of a table remapped (see remapFormulaReferences); other cells are kept as they are. */
export function remapTableFormulas(rows: InlineNode[][][], maps: { rows?: (r: number) => number | null; cols?: (c: number) => number | null }): InlineNode[][][] {
  let changed = false;
  const out = rows.map((row) =>
    row.map((cell) => {
      const text = tableCellText(cell);
      if (!isFormula(text)) return cell;
      const next = remapFormulaReferences(text, maps);
      if (next === text) return cell;
      changed = true;
      const marks = (cell.find((n) => n.type === "text") as { marks?: Mark[] } | undefined)?.marks;
      return [marks?.length ? { type: "text" as const, text: next, marks } : { type: "text" as const, text: next }];
    }),
  );
  return changed ? out : rows;
}

/** Index maps for a move of one row or column from `from` to `to` (the rest shift to make room). */
export function moveIndexMap(from: number, to: number): (i: number) => number {
  return (i) => {
    if (i === from) return to;
    if (from < to && i > from && i <= to) return i - 1;
    if (from > to && i >= to && i < from) return i + 1;
    return i;
  };
}

/** Index maps for deleting index `at` (it's gone; later ones move up). */
export function deleteIndexMap(at: number): (i: number) => number | null {
  return (i) => (i === at ? null : i > at ? i - 1 : i);
}

/** Index maps for inserting a new index at `at` (later ones move down). */
export function insertIndexMap(at: number): (i: number) => number {
  return (i) => (i >= at ? i + 1 : i);
}
