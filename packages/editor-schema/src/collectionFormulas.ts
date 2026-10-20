// Formula properties of a collection (Folevi's databases), worked out with the table formula evaluator
// (tableFormulas.ts), so they have the same functions, operators and Sheets-style errors.
//
// A formula names other properties of its row: bare (Price * Qty, [Unit price]) like a table's column names,
// or Notion-style (prop("Price") * prop("Qty")). The row's title is "Name". The server stores only the
// formula's text (checked here: its length, and that it never depends on itself); results are worked out
// wherever the collection is shown (the person's device, a share page), never stored.
//
//   evaluateCollectionFormulas(properties, rows)  every formula property's result for every row
//   collectionFormulaProblem(properties, id, text) why a formula can't be saved (too long, a loop), or null
//   collectionFormulaReferences(text, properties)  the properties a formula uses
//   renameInCollectionFormula(text, properties, id, name)  the formula after a property it uses is renamed
//   collectionFormulaTable(properties, rows)        the collection as a table's text cells (for Foli AI)
import { evaluateTable, formulaNameReferences, type FormulaError, type TableColumnSettings, type TableLiteral } from "./tableFormulas";

/** The longest formula a property can hold. */
export const COLLECTION_FORMULA_MAX = 1000;
/** The row's title as formulas name it. */
export const COLLECTION_TITLE_NAME = "Name";
/** The row's title as a reference (formulaReferences and the view's "title" target). */
export const COLLECTION_TITLE_ID = "title";

/** How a number (or a formula's number) shows: like a table column's format. */
export interface CollectionNumberFormat {
  format: "number" | "currency" | "percent";
  currency?: string;
  decimals?: number;
}

export interface FormulaPropertyInput {
  id: string;
  name: string;
  type: string;
  options?: readonly { id: string; name: string }[];
  formula?: string | null;
  numberFormat?: CollectionNumberFormat | null;
}

export interface FormulaRowInput {
  title: string;
  values: Record<string, unknown>;
}

export type CollectionFormulaKind = "number" | "text" | "date" | "boolean" | "empty" | "error";

/** A formula's result for one row. */
export interface CollectionFormulaResult {
  kind: CollectionFormulaKind;
  /** A number, text, a date (YYYY-MM-DD), true/false, or null (empty or an error). */
  value: number | string | boolean | null;
  /** What it shows: a number in the property's format, a date as "Oct 19, 2026", TRUE/FALSE, an error's code. */
  display: string;
  error?: FormulaError;
}

export interface CollectionFormulaOptions {
  /** A person value (a profile id) as the name formulas see. */
  personName?: (value: string) => string;
  /** The date TODAY() gives (default: today where this runs). */
  today?: Date | string;
  locale?: string;
}

// ------------------------------------------------------------------------------------------------ text

/** Characters of `text` that are inside a string literal ("..." with "" for a quote). */
function stringSpans(text: string): boolean[] {
  const inside = new Array<boolean>(text.length).fill(false);
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '"') {
      i++;
      continue;
    }
    const start = i++;
    while (i < text.length) {
      if (text[i] === '"') {
        if (text[i + 1] === '"') {
          i += 2;
          continue;
        }
        i++;
        break;
      }
      i++;
    }
    for (let k = start; k < i; k++) inside[k] = true;
  }
  return inside;
}

const PROP_RE = /^prop\s*\(\s*"((?:[^"]|"")*)"\s*\)/i;

/** Each prop("Name") in a formula (outside strings): where it is and the name it gives. */
function propCalls(text: string): { at: number; end: number; name: string }[] {
  const inside = stringSpans(text);
  const out: { at: number; end: number; name: string }[] = [];
  for (let i = 0; i < text.length; i++) {
    if (inside[i] || (text[i] !== "p" && text[i] !== "P")) continue;
    if (i > 0 && /[A-Za-z0-9_.$]/.test(text[i - 1]!)) continue;
    const m = PROP_RE.exec(text.slice(i));
    if (!m) continue;
    out.push({ at: i, end: i + m[0].length, name: m[1]!.replace(/""/g, '"') });
    i += m[0].length - 1;
  }
  return out;
}

/**
 * A formula as the table evaluator reads it: without a leading "=", prop("X") as [X], and the comparisons
 * people bring from other apps (== and !=) as = and <>.
 */
export function collectionFormulaSource(text: string): string {
  let src = text.trim().replace(/^=\s*/, "");
  const calls = propCalls(src);
  for (const c of [...calls].reverse()) src = `${src.slice(0, c.at)}[${c.name}]${src.slice(c.end)}`;
  const inside = stringSpans(src);
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const two = src.slice(i, i + 2);
    if (!inside[i] && two === "==") {
      out += "=";
      i++;
    } else if (!inside[i] && two === "!=") {
      out += "<>";
      i++;
    } else out += src[i];
  }
  return out;
}

/** The names formulas use, in table column order: every property, then the title. */
function columnNames(properties: readonly FormulaPropertyInput[]): string[] {
  return [...properties.map((p) => p.name), COLLECTION_TITLE_NAME];
}

const columnId = (properties: readonly FormulaPropertyInput[], c: number) => (c < properties.length ? properties[c]!.id : COLLECTION_TITLE_ID);

/** The properties (ids; the title is "title") a formula uses, each once, in the order it names them. */
export function collectionFormulaReferences(text: string, properties: readonly FormulaPropertyInput[]): string[] {
  const refs = formulaNameReferences(collectionFormulaSource(text), columnNames(properties));
  return [...new Set(refs.map((r) => columnId(properties, r.column)))];
}

const normName = (s: string) => s.replace(/[\s_]+/g, " ").trim().toLowerCase();
const SIMPLE_NAME = /^[A-Za-z_À-￿][A-Za-z0-9_À-￿]*$/;

/** How a formula names a property: the bare name when it's one word, else prop("Name"). */
export function formulaReference(name: string): string {
  return SIMPLE_NAME.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) && !/^(true|false)$/i.test(name) ? name : `prop("${name.replace(/"/g, '""')}")`;
}

/**
 * The formula after property `propertyId` is renamed to `name`: every reference to it (bare, [bracketed] or
 * prop("...")) names it the new way; everything else stays as written.
 */
export function renameInCollectionFormula(text: string, properties: readonly FormulaPropertyInput[], propertyId: string, name: string): string {
  const old = properties.find((p) => p.id === propertyId);
  if (!old || !text) return text;
  const calls = propCalls(text);
  const edits: { at: number; end: number; text: string }[] = [];
  const names = columnNames(properties);
  const index = properties.indexOf(old);
  // prop("Old"): the property the evaluator would find for that name.
  for (const c of calls) {
    const target = names.findIndex((n) => normName(n) === normName(c.name));
    if (target === index) edits.push({ at: c.at, end: c.end, text: `prop("${name.replace(/"/g, '""')}")` });
  }
  // Bare and [bracketed] names, read with the prop() calls blanked out (same length, so places match).
  let masked = text;
  for (const c of calls) masked = masked.slice(0, c.at) + " ".repeat(c.end - c.at) + masked.slice(c.end);
  for (const r of formulaNameReferences(masked, names)) {
    if (r.column !== index) continue;
    const bracketed = text[r.at] === "[";
    edits.push({ at: r.at, end: r.end, text: bracketed || !SIMPLE_NAME.test(name) ? `[${name}]` : name });
  }
  if (!edits.length) return text;
  let out = text;
  for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.end);
  return out;
}

// --------------------------------------------------------------------------------------------- checks

/**
 * The formula properties a formula property depends on, through other formulas, that lead back to it: the
 * names on the way round (["Total", "Tax", "Total"]), or null when there's no loop.
 */
function loopFrom(properties: readonly FormulaPropertyInput[], startId: string): string[] | null {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const deps = (p: FormulaPropertyInput) => (p.type === "formula" && p.formula ? collectionFormulaReferences(p.formula, properties).filter((id) => byId.get(id)?.type === "formula") : []);
  const path: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string): boolean => {
    const p = byId.get(id);
    if (!p) return false;
    path.push(p.name);
    for (const next of deps(p)) {
      if (next === startId) {
        path.push(byId.get(startId)!.name);
        return true;
      }
      if (seen.has(next)) continue;
      seen.add(next);
      if (walk(next)) return true;
    }
    path.pop();
    return false;
  };
  return walk(startId) ? path : null;
}

/**
 * Why `formula` can't be saved as property `propertyId`'s formula, in plain words, or null when it can: too
 * long, it uses its own property, or it would depend on itself through other formulas.
 */
export function collectionFormulaProblem(properties: readonly FormulaPropertyInput[], propertyId: string, formula: string): string | null {
  if (formula.length > COLLECTION_FORMULA_MAX) return `A formula can be up to ${COLLECTION_FORMULA_MAX.toLocaleString("en-US")} characters.`;
  const self = properties.find((p) => p.id === propertyId);
  if (!self) return "Property not found.";
  const next = properties.map((p) => (p.id === propertyId ? { ...p, type: "formula", formula } : p));
  if (collectionFormulaReferences(formula, next).includes(propertyId)) return `A formula can't use its own property (“${self.name}”).`;
  const loop = loopFrom(next, propertyId);
  if (loop) return `This would make formulas depend on each other in a loop: ${loop.map((n) => `“${n}”`).join(" → ")}.`;
  return null;
}

/** A loop among the formulas as they are (after a rename, say): the names on the way round, or null. */
export function collectionFormulaLoop(properties: readonly FormulaPropertyInput[]): string[] | null {
  for (const p of properties) {
    if (p.type !== "formula") continue;
    const loop = loopFrom(properties, p.id);
    if (loop) return loop;
  }
  return null;
}

// --------------------------------------------------------------------------------------------- values

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A property's value as formulas see it (null is empty; a checkbox is always TRUE or FALSE). */
function literalOf(p: FormulaPropertyInput, value: unknown, opts: CollectionFormulaOptions): TableLiteral {
  if (p.type === "checkbox") return { boolean: value === true };
  if (value === null || value === undefined || value === "") return null;
  const option = (id: unknown) => p.options?.find((o) => o.id === id)?.name ?? "";
  switch (p.type) {
    case "number":
      return typeof value === "number" ? { number: value } : null;
    case "date":
      return typeof value === "string" && DATE_RE.test(value) ? { date: value } : null;
    case "select":
      return { text: option(value) };
    case "multiSelect":
      return Array.isArray(value) ? { text: value.map(option).filter(Boolean).join(", ") } : null;
    case "person":
      return typeof value === "string" ? { text: opts.personName ? opts.personName(value) : value } : null;
    case "relation":
      // A relation counts its linked pages (share pages send the count itself).
      return { number: Array.isArray(value) ? value.length : typeof value === "number" ? value : 0 };
    default:
      return typeof value === "string" ? { text: value } : typeof value === "number" ? { number: value } : null;
  }
}

/** A literal as a table cell's text (what Foli AI reads). */
function literalText(l: TableLiteral): string {
  if (l === null) return "";
  if ("number" in l) return String(l.number);
  if ("boolean" in l) return l.boolean ? "TRUE" : "FALSE";
  if ("date" in l) return l.date;
  return l.text;
}

const isFormulaProperty = (p: FormulaPropertyInput) => p.type === "formula";

/** Table error messages in collection words (properties, not cells and columns). */
function collectionError(e: FormulaError): FormulaError {
  let message = e.message;
  const missing = /^There's no column called "(.*)"\./.exec(message);
  if (missing) message = `There's no property called "${missing[1]}". Use a property's name, like Price, or prop("Unit price").`;
  else
    message = message
      .replace("through other cells", "through other formulas")
      .replace("(or by an empty cell)", "(or by an empty value)")
      .replace(/\bcells\b/g, "values")
      .replace(/\ba cell\b/g, "a value")
      .replace(/\bthe table\b/g, "this collection");
  return { code: e.code, message };
}

/**
 * The collection as a table: a header row of names (every property, then "Name" for the title) and a row
 * per row, with each formula property's formula ("=..." as the evaluator reads it) and every other value as
 * text. For Foli AI, which writes table formulas; `literals` gives the typed values for evaluating.
 */
export function collectionFormulaTable(properties: readonly FormulaPropertyInput[], rows: readonly FormulaRowInput[], opts: CollectionFormulaOptions = {}): { rows: string[][]; literals: (row: number, column: number) => TableLiteral | undefined } {
  const names = columnNames(properties);
  const typed: (TableLiteral | undefined)[][] = [names.map((n) => ({ text: n }))];
  const text: string[][] = [names];
  for (const r of rows) {
    const line: string[] = [];
    const lits: (TableLiteral | undefined)[] = [];
    for (const p of properties) {
      if (isFormulaProperty(p)) {
        const src = p.formula ? collectionFormulaSource(p.formula) : "";
        line.push(src ? `=${src}` : "");
        lits.push(src ? undefined : null);
      } else {
        const l = literalOf(p, r.values[p.id], opts);
        line.push(literalText(l));
        lits.push(l);
      }
    }
    line.push(r.title);
    lits.push(r.title ? { text: r.title } : null);
    text.push(line);
    typed.push(lits);
  }
  return { rows: text, literals: (row, column) => typed[row]?.[column] };
}

/**
 * Every formula property's result for every row (in the order given): `out[i][propertyId]`. Formulas can use
 * other formulas; a loop shows #CYCLE! in every formula in it. Numbers take the property's number format.
 * Never throws.
 */
export function evaluateCollectionFormulas(properties: readonly FormulaPropertyInput[], rows: readonly FormulaRowInput[], opts: CollectionFormulaOptions = {}): Record<string, CollectionFormulaResult>[] {
  const formulas = properties.map((p, c) => ({ p, c })).filter((x) => isFormulaProperty(x.p));
  if (!formulas.length) return rows.map(() => ({}));
  const table = collectionFormulaTable(properties, rows, opts);
  const columns: (TableColumnSettings | null)[] = properties.map((p) => (p.numberFormat ? { format: p.numberFormat.format, currency: p.numberFormat.currency, decimals: p.numberFormat.decimals } : null));
  const evaluated = evaluateTable(table.rows, { headerRow: true, columns, literals: table.literals, rowNames: true, today: opts.today, locale: opts.locale });
  return rows.map((_, i) => {
    const out: Record<string, CollectionFormulaResult> = {};
    for (const { p, c } of formulas) {
      const cell = evaluated.cells[i + 1]?.[c];
      if (!cell || cell.kind === "empty") out[p.id] = { kind: "empty", value: null, display: "" };
      else if (cell.kind === "error") {
        const error = collectionError(cell.error!);
        out[p.id] = { kind: "error", value: null, display: error.code, error };
      } else if (cell.kind === "date") {
        const day = cell.value as number;
        out[p.id] = { kind: "date", value: new Date(day * 86_400_000).toISOString().slice(0, 10), display: cell.display };
      } else if (cell.kind === "number") out[p.id] = { kind: "number", value: cell.value as number, display: cell.display };
      else if (cell.kind === "boolean") out[p.id] = { kind: "boolean", value: cell.value as boolean, display: cell.display };
      else out[p.id] = { kind: "text", value: String(cell.value ?? ""), display: cell.display };
    }
    return out;
  });
}

/**
 * Whether a formula reads (brackets, commas and quotes in place): the plain explanation when it doesn't, else
 * null. Unknown names aren't counted here (they show #NAME? on each row).
 */
export function collectionFormulaSyntaxError(text: string, properties: readonly FormulaPropertyInput[]): string | null {
  if (!collectionFormulaSource(text)) return null;
  const probe = properties.map((p) => (p.type === "formula" ? { ...p, formula: null } : p));
  const id = "\u0000probe";
  const result = evaluateCollectionFormulas([...probe, { id, name: "\u0000", type: "formula", formula: text }], [{ title: "", values: {} }])[0]![id]!;
  return result.kind === "error" && result.error?.code === "#ERROR!" ? result.error.message : null;
}
