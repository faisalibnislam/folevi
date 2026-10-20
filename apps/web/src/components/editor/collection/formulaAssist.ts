// The formula editor's helpers (pure, unit-tested): suggestions while typing (property names and functions)
// and a Foli AI table formula turned into a collection formula.
import { COLLECTION_TITLE_NAME, columnIndex, formulaReference } from "@folevi/editor-schema";

export interface FormulaFunction {
  name: string;
  /** How it's called: "ROUND(number, places)". */
  signature: string;
  /** What it does, in a few words. */
  description: string;
}

/** The functions a collection formula can use (the table formula set, without those that read ranges). */
export const FORMULA_FUNCTIONS: readonly FormulaFunction[] = [
  { name: "IF", signature: "IF(condition, then, else)", description: "One value or another" },
  { name: "AND", signature: "AND(a, b, ...)", description: "TRUE when all are true" },
  { name: "OR", signature: "OR(a, b, ...)", description: "TRUE when any is true" },
  { name: "NOT", signature: "NOT(value)", description: "The opposite of TRUE or FALSE" },
  { name: "IFERROR", signature: "IFERROR(value, otherwise)", description: "A fallback when there's an error" },
  { name: "ROUND", signature: "ROUND(number, places)", description: "Rounds to a number of decimals" },
  { name: "ROUNDUP", signature: "ROUNDUP(number, places)", description: "Rounds away from zero" },
  { name: "ROUNDDOWN", signature: "ROUNDDOWN(number, places)", description: "Rounds toward zero" },
  { name: "ABS", signature: "ABS(number)", description: "The number without its sign" },
  { name: "SUM", signature: "SUM(a, b, ...)", description: "Adds numbers" },
  { name: "AVERAGE", signature: "AVERAGE(a, b, ...)", description: "The average of numbers" },
  { name: "MIN", signature: "MIN(a, b, ...)", description: "The smallest number" },
  { name: "MAX", signature: "MAX(a, b, ...)", description: "The largest number" },
  { name: "PRODUCT", signature: "PRODUCT(a, b, ...)", description: "Multiplies numbers" },
  { name: "MEDIAN", signature: "MEDIAN(a, b, ...)", description: "The middle number" },
  { name: "CONCAT", signature: "CONCAT(a, b, ...)", description: "Joins text" },
  { name: "LEFT", signature: "LEFT(text, count)", description: "The first characters" },
  { name: "RIGHT", signature: "RIGHT(text, count)", description: "The last characters" },
  { name: "MID", signature: "MID(text, start, count)", description: "Characters from the middle" },
  { name: "LEN", signature: "LEN(text)", description: "How many characters" },
  { name: "UPPER", signature: "UPPER(text)", description: "Text in capitals" },
  { name: "LOWER", signature: "LOWER(text)", description: "Text in lower case" },
  { name: "TRIM", signature: "TRIM(text)", description: "Text without extra spaces" },
  { name: "TODAY", signature: "TODAY()", description: "Today's date" },
  { name: "DATE", signature: "DATE(year, month, day)", description: "A date from its parts" },
  { name: "DAYS", signature: "DAYS(end, start)", description: "Days between two dates" },
  { name: "DATEDIF", signature: 'DATEDIF(start, end, "D")', description: 'Days, months ("M") or years ("Y") between dates' },
  { name: "YEAR", signature: "YEAR(date)", description: "A date's year" },
  { name: "MONTH", signature: "MONTH(date)", description: "A date's month (1 to 12)" },
  { name: "DAY", signature: "DAY(date)", description: "A date's day of the month" },
];

export interface Suggestion {
  kind: "property" | "function";
  label: string;
  /** Quiet text after the label: a property's type, a function's signature. */
  detail: string;
  /** What replaces the text from `from` to `to`. */
  insert: string;
}

export interface Suggestions {
  from: number;
  to: number;
  items: Suggestion[];
}

const WORD_END = /[A-Za-z_À-￿][A-Za-z0-9_À-￿]*$/;

/**
 * What after the caret a completed name replaces: the rest of the name and its closing ") or ] when they're
 * right there (no operator, comma or bracket on the way), else just the rest of the word.
 */
function closingRest(after: string, closing: RegExp): string {
  const m = closing.exec(after);
  if (m && !/[-(),*+/^&=<>]/.test(m[1]!)) return m[0];
  return /^[A-Za-z0-9_À-￿]*/.exec(after)![0];
}

/** Whether the caret is inside a string literal ("..."), outside prop("..."). */
function inString(before: string): boolean {
  let inside = false;
  for (let i = 0; i < before.length; i++) if (before[i] === '"') inside = !inside;
  return inside;
}

const matches = (name: string, prefix: string) => {
  const n = name.toLowerCase();
  const p = prefix.toLowerCase();
  return n.startsWith(p) || n.split(/[\s_]+/).some((w) => w.startsWith(p));
};

/**
 * What to suggest at the caret: inside prop("...") or [...], property names; after a word, the properties
 * and functions it starts. Null when there's nothing to suggest (an empty word, inside a string).
 */
export function formulaSuggestions(text: string, caret: number, properties: readonly { name: string; type: string }[], typeLabel: (type: string) => string): Suggestions | null {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const props = [...properties, { name: COLLECTION_TITLE_NAME, type: "title" }];
  const label = (t: string) => (t === "title" ? "Title" : typeLabel(t));
  const prop = /prop\s*\(\s*"((?:[^"]|"")*)$/i.exec(before);
  if (prop) {
    const prefix = prop[1]!.replace(/""/g, '"');
    const rest = closingRest(after, /^((?:[^"]|"")*)"\s*\)?/);
    const items = props.filter((p) => !prefix || matches(p.name, prefix)).map((p) => ({ kind: "property" as const, label: p.name, detail: label(p.type), insert: `${p.name.replace(/"/g, '""')}")` }));
    return items.length ? { from: caret - prop[1]!.length, to: caret + rest.length, items: items.slice(0, 8) } : null;
  }
  if (inString(before)) return null;
  const bracket = /\[([^\]]*)$/.exec(before);
  if (bracket) {
    const rest = closingRest(after, /^([^\]]*)\]/);
    const items = props.filter((p) => !bracket[1] || matches(p.name, bracket[1])).map((p) => ({ kind: "property" as const, label: p.name, detail: label(p.type), insert: `${p.name}]` }));
    return items.length ? { from: caret - bracket[1]!.length, to: caret + rest.length, items: items.slice(0, 8) } : null;
  }
  const word = WORD_END.exec(before);
  if (!word) return null;
  const prefix = word[0];
  // The rest of a word the caret is in the middle of is replaced too.
  const tail = /^[A-Za-z0-9_À-￿]*/.exec(after)![0];
  const items: Suggestion[] = [
    ...props.filter((p) => matches(p.name, prefix) && p.name.toLowerCase() !== prefix.toLowerCase()).map((p) => ({ kind: "property" as const, label: p.name, detail: label(p.type), insert: formulaReference(p.name) })),
    ...FORMULA_FUNCTIONS.filter((f) => f.name.startsWith(prefix.toUpperCase())).map((f) => ({ kind: "function" as const, label: f.name, detail: f.signature, insert: `${f.name}(` })),
  ];
  return items.length ? { from: caret - prefix.length, to: caret + tail.length, items: items.slice(0, 8) } : null;
}

/** The text with a suggestion put in, and where the caret goes (after it). */
export function applySuggestion(text: string, s: Suggestions, item: Suggestion): { text: string; caret: number } {
  const next = text.slice(0, s.from) + item.insert + text.slice(s.to);
  return { text: next, caret: s.from + item.insert.length };
}

/**
 * Foli AI's table formula ("=B2 * Price") as a collection formula: without the "=", and a reference to a
 * cell of the row it was written for (`row`, counted from 1 as in A1) as that column's property. `columns`
 * are the table's column names in order.
 */
export function formulaFromAi(formula: string, columns: readonly string[], row: number): string {
  const src = formula.trim().replace(/^=\s*/, "");
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    // Strings, [names] and prop("...") are kept as they are.
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length && !(src[j] === '"' && src[j + 1] !== '"')) j += src[j] === '"' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "[") {
      const close = src.indexOf("]", i);
      const end = close < 0 ? src.length : close + 1;
      out += src.slice(i, end);
      i = end;
      continue;
    }
    const m = /^\$?([A-Za-z]{1,3})\$?(\d+)(?![A-Za-z0-9_(])/.exec(src.slice(i));
    const prev = i > 0 ? src[i - 1]! : "";
    if (m && !/[A-Za-z0-9_.$]/.test(prev)) {
      const c = columnIndex(m[1]!);
      if (Number(m[2]) === row && c >= 0 && c < columns.length) {
        out += formulaReference(columns[c]!);
        i += m[0].length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}
