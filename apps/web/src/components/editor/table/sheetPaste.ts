// Cells pasted from Google Sheets, Excel and Numbers: rows, columns and simple formulas.
//
// Google Sheets puts each formula on its cell as R1C1, relative to the cell (data-sheets-formula
// "=R[0]C[-2]*R[0]C[-1]"), which becomes A1 here relative to where the cell lands. Excel writes its formulas
// in A1 (x:fmla) as they are in the sheet, which may not start at A1: the copied block's place in the sheet is
// worked out from the values Excel shows next to them, and the formulas are kept only when they give those
// values back. Anything else (or a formula that can't be placed) keeps the value it showed.
import { LIMITS, columnLetter, evaluateTableCells, isFormula, normalizeInline, parseDelimited, parseTableNumber, plainText, remapFormulaReferences, sanitizeHref, validateInline, type InlineNode } from "@folevi/editor-schema";
import { OWN_CELL_ATTR, OWN_ORIGIN_ATTR } from "./tableClipboard";

export interface SheetGrid {
  rows: InlineNode[][][];
  /** The first row reads as column names (text over numbers). */
  headerRow: boolean;
  /**
   * Cells copied from a Folevi table: the row and column the first one was at. Their formulas are as they
   * were written there, so whoever pastes them elsewhere moves the references by how far the cells moved.
   */
  origin?: { r: number; c: number };
  /** Rows and columns of what was copied that are past what a table holds (200 by 20) and were left out. */
  cut?: { rows: number; columns: number };
}

/** The most rows of a paste that are counted (past a table's own limit, to say how many were left out). */
const COUNT_ROWS = 20_000;
const cutOf = (rows: number, columns: number) => {
  const cut = { rows: Math.max(0, rows - LIMITS.maxTableRows), columns: Math.max(0, columns - LIMITS.maxTableColumns) };
  return cut.rows || cut.columns ? { cut } : {};
};

const text = (t: string): InlineNode[] => (t ? [{ type: "text", text: t }] : []);

/** A Google Sheets R1C1 formula in A1, for the cell at (row, column) of the pasted block; null if it reaches outside. */
export function r1c1ToA1(formula: string, row: number, column: number): string | null {
  let outside = false;
  // Not inside quoted text.
  const parts = formula.split(/("(?:[^"]|"")*")/);
  const out = parts
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(/(^|[^A-Za-z0-9_.])R(\[-?\d+\]|\d+)?C(\[-?\d+\]|\d+)?(?![A-Za-z0-9_(])/g, (_m, lead: string, r?: string, c?: string) => {
            const at = (spec: string | undefined, here: number) => (spec === undefined ? here : spec.startsWith("[") ? here + Number(spec.slice(1, -1)) : Number(spec) - 1);
            const rr = at(r, row);
            const cc = at(c, column);
            if (rr < 0 || cc < 0 || rr >= LIMITS.maxTableRows || cc >= LIMITS.maxTableColumns) {
              outside = true;
              return lead;
            }
            const abs = (spec: string | undefined) => (spec !== undefined && !spec.startsWith("[") ? "$" : "");
            return `${lead}${abs(c)}${columnLetter(cc)}${abs(r)}${rr + 1}`;
          }),
    )
    .join("");
  return outside ? null : out;
}

/** The A1 references a formula uses, as row and column numbers from 0. */
function referencedCells(formula: string): { r: number; c: number }[] {
  const out: { r: number; c: number }[] = [];
  const parts = formula.split(/("(?:[^"]|"")*")/);
  parts.forEach((part, i) => {
    if (i % 2) return;
    for (const m of part.matchAll(/(?:^|[^A-Za-z0-9_.])\$?([A-Za-z]{1,3})\$?(\d+)(?![A-Za-z0-9_(])/g)) {
      const letters = m[1]!.toUpperCase();
      let c = 0;
      for (const ch of letters) c = c * 26 + ch.charCodeAt(0) - 64;
      out.push({ r: Number(m[2]) - 1, c: c - 1 });
    }
  });
  return out;
}

const sameShown = (a: string, b: string) => {
  if (a.trim() === b.trim()) return true;
  const x = parseTableNumber(a);
  const y = parseTableNumber(b);
  return x !== null && y !== null && Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(y));
};

/**
 * How many formula cells may be worked out, over all the places tried, to find where a pasted block came
 * from. A small paste is far under it and every place is tried, as before there was a limit. A block of
 * hundreds of formulas tried in each of some 1,600 places froze the page for seconds (ten on an iPad).
 */
const PLACE_WORK = 40_000;

/**
 * Excel's formulas (in the sheet's own A1 terms) placed in the pasted block: tries where the block could
 * have started and keeps the place where the formulas give back the most of the values shown, if that's
 * at least half of them. Returns the formulas moved there, or null to keep the values.
 *
 * The places tried: every start up to 60 rows down and 26 columns across, and the ones the formulas point
 * at themselves (one that reads its own row, =B100*C100, says how far down the sheet the block began, however
 * far that is). A large block tries those first and stops when the work allowed is spent (PLACE_WORK).
 * `stats` counts the places tried, for tests.
 */
export function placeExcelFormulas(shown: string[][], formulas: (string | null)[][], stats?: { trials: number }): (string | null)[][] | null {
  const cells = formulas.flatMap((row, r) => row.flatMap((f, c) => (f ? [{ r, c, f }] : [])));
  if (!cells.length) return null;
  const refsOf = cells.map((x) => referencedCells(x.f));
  const refs = refsOf.flat();
  // The block can't start below or right of a cell its formulas use, or of a formula cell itself.
  const deepest = refs.length ? Math.min(...refs.map((x) => x.r)) : 0;
  const maxDr = Math.min(60, deepest);
  const maxDc = refs.length ? Math.min(26, ...refs.map((x) => x.c)) : 0;
  // The row offsets the formulas themselves point at (a formula reading its own row), the likeliest first.
  const votes = new Map<number, number>();
  cells.forEach((x, i) => {
    for (const ref of refsOf[i]!) {
      const dr = ref.r - x.r;
      if (dr >= 0 && dr <= deepest) votes.set(dr, (votes.get(dr) ?? 0) + 1);
    }
  });
  const pointed: { dr: number; dc: number }[] = [];
  for (const [dr] of [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4)) for (let dc = 0; dc <= maxDc; dc++) pointed.push({ dr, dc });
  const every: { dr: number; dc: number }[] = [];
  for (let dr = 0; dr <= maxDr; dr++) for (let dc = 0; dc <= maxDc; dc++) every.push({ dr, dc });
  // Few enough to try them all: in the order they always were, then the pointed-at ones further down the
  // sheet than that reaches. Too many: the pointed-at ones first, then as many of the rest as the work allows.
  const all = every.length * cells.length <= PLACE_WORK;
  const seen = new Set<string>();
  const places = (all ? [...every, ...pointed] : [...pointed, ...every]).filter((x) => {
    const key = `${x.dr}:${x.dc}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  let best: { score: number; out: (string | null)[][] } | null = null;
  let work = 0;
  for (const { dr, dc } of places) {
    // (Always the first place; after that, only while there is work left to spend.)
    if (best && work + cells.length > PLACE_WORK) break;
    work += cells.length;
    if (stats) stats.trials++;
    const moved = formulas.map((row) => row.map((f) => (f ? remapFormulaReferences(f, { rows: (r) => r - dr, cols: (c) => c - dc }) : null)));
    const grid = shown.map((row, r) => row.map((s, c) => moved[r]?.[c] ?? s));
    const result = evaluateTableCells(grid, { headerRow: false }, cells);
    let score = 0;
    cells.forEach((x, i) => {
      if (sameShown(result[i]?.display ?? "", shown[x.r]?.[x.c] ?? "")) score++;
    });
    if (!best || score > best.score) best = { score, out: moved };
    if (score === cells.length) return moved;
  }
  return best && best.score * 2 >= cells.length ? best.out : null;
}

/** Whether a first row names the columns: all text, and some later row has a number. */
function looksLikeHeader(rows: InlineNode[][][]): boolean {
  if (rows.length < 2) return false;
  const plain = (cell: InlineNode[]) => cell.map((n) => (n.type === "text" ? n.text : "")).join("").trim();
  const first = rows[0]!.map(plain);
  if (!first.some(Boolean) || first.some((t) => t && (parseTableNumber(t) !== null || isFormula(t)))) return false;
  return rows.slice(1).some((r) => r.some((c) => parseTableNumber(plain(c)) !== null || isFormula(plain(c))));
}

/**
 * What a cell copied from a Folevi table really holds (tableClipboard.ts puts it on the cell), or null when
 * it isn't there or isn't content a cell may hold. It comes from the clipboard, which any page can write:
 * nothing is taken on trust.
 */
function ownCell(td: Element): InlineNode[] | null {
  const raw = td.getAttribute(OWN_CELL_ATTR);
  if (!raw || raw.length > LIMITS.maxTextLength * 4) return null;
  try {
    const nodes = JSON.parse(raw) as InlineNode[];
    if (!Array.isArray(nodes) || validateInline(nodes).length) return null;
    if (plainText(nodes).length > LIMITS.maxTextLength) return null;
    for (const n of nodes) if (n.type === "text") for (const m of n.marks ?? []) if (m.type === "link" && !sanitizeHref(m.href)) return null;
    return normalizeInline(nodes);
  } catch {
    return null;
  }
}

/**
 * A pasted HTML table as cells: each cell's formatting (from `cellInline`), and formulas from Google
 * Sheets or Excel where they can be kept. With `own`, cells copied from a Folevi table come back as they
 * were stored (their formulas, mentions and colours) and the grid says where they were (`origin`); without
 * it they are what they showed, as for any other app.
 */
export function gridFromHtmlTable(table: HTMLTableElement, cellInline: (el: Element) => InlineNode[], own = false): SheetGrid {
  const trs = [...table.rows].slice(0, LIMITS.maxTableRows);
  const fullWidth = Math.max(1, ...trs.map((tr) => [...tr.cells].reduce((n, c) => n + Math.max(1, c.colSpan || 1), 0)));
  const width = Math.min(LIMITS.maxTableColumns, fullWidth);
  const rows: InlineNode[][][] = [];
  const shown: string[][] = [];
  const excel: (string | null)[][] = [];
  trs.forEach((tr, r) => {
    const row: InlineNode[][] = [];
    const shownRow: string[] = [];
    const excelRow: (string | null)[] = [];
    for (const td of tr.cells) {
      if (row.length >= width) break;
      const inline = (own ? ownCell(td) : null) ?? cellInline(td);
      const value = inline.map((n) => (n.type === "text" ? n.text : "")).join("");
      const sheets = td.getAttribute("data-sheets-formula");
      const formula = sheets ? r1c1ToA1(sheets, r, row.length) : null;
      row.push(formula ? text(formula) : inline);
      shownRow.push(value);
      excelRow.push(!sheets ? (td.getAttribute("x:fmla") ?? null) : null);
      // A merged cell takes its columns; the extra ones stay empty.
      for (let k = 1; k < (td.colSpan || 1) && row.length < width; k++) {
        row.push([]);
        shownRow.push("");
        excelRow.push(null);
      }
    }
    while (row.length < width) {
      row.push([]);
      shownRow.push("");
      excelRow.push(null);
    }
    rows.push(row);
    shown.push(shownRow);
    excel.push(excelRow);
  });
  if (excel.some((r) => r.some(Boolean))) {
    const placed = placeExcelFormulas(shown, excel);
    if (placed) placed.forEach((row, r) => row.forEach((f, c) => f && (rows[r]![c] = text(f))));
  }
  const th = trs[0]?.cells[0]?.tagName === "TH";
  const at = own ? /^(\d{1,4}):(\d{1,4})$/.exec(table.getAttribute(OWN_ORIGIN_ATTR) ?? "") : null;
  return { rows, headerRow: th || looksLikeHeader(rows), ...(at ? { origin: { r: Number(at[1]), c: Number(at[2]) } } : {}), ...cutOf(table.rows.length, fullWidth) };
}

/** Whether HTML came from a spreadsheet (Google Sheets, Excel, Numbers, LibreOffice). */
export function isSpreadsheetHtml(html: string): boolean {
  return /google-sheets-html-origin|data-sheets-|urn:schemas-microsoft-com:office:excel|x:str|x:num|ProgId" content="Excel|Numbers|LibreOffice/i.test(html);
}

/**
 * Whether text is rows of tab-separated cells, as a spreadsheet copies them: every row with something in it
 * has the same number of cells (two or more) and none starts with a tab. Indented code, a Makefile or
 * a sentence with a tab in it are text, not a table.
 */
export function isTabSeparated(value: string): boolean {
  const rows = value.replace(/\r\n?/g, "\n").split("\n").filter((row) => row.trim() !== "");
  if (!rows.length) return false;
  const cells = rows[0]!.split("\t").length;
  return cells >= 2 && rows.every((row) => !row.startsWith("\t") && row.split("\t").length === cells);
}

/** Rows and columns from pasted text: tab-separated (a spreadsheet's plain copy). Null when it isn't. */
export function gridFromText(value: string): SheetGrid | null {
  if (!isTabSeparated(value)) return null;
  // Rows are read past a table's limit (to count what is left out), then cut to it. Every row has as many
  // cells as the first line has (isTabSeparated), which says how many columns were copied.
  const all = parseDelimited(value, COUNT_ROWS, LIMITS.maxTableColumns);
  if (!all.length) return null;
  const rows = all.slice(0, LIMITS.maxTableRows).map((r) => r.map(text));
  const copiedWidth = (value.replace(/\r\n?/g, "\n").split("\n").find((line) => line.trim() !== "") ?? "").split("\t").length;
  return { rows, headerRow: looksLikeHeader(rows), ...cutOf(all.length, copiedWidth) };
}

/**
 * A spreadsheet's cells on the clipboard (its HTML table, or its tab-separated text), or null. `own` is for
 * a paste into a table: cells copied from a Folevi table then keep what they held (see gridFromHtmlTable).
 */
export function clipboardGrid(data: DataTransfer, cellInline: (el: Element) => InlineNode[], own = false): SheetGrid | null {
  const html = data.getData("text/html");
  if (html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const table = doc.querySelector("table");
    if (table && (isSpreadsheetHtml(html) || doc.body.textContent?.trim() === table.textContent?.trim())) return gridFromHtmlTable(table, cellInline, own);
    if (table) return null;
  }
  return gridFromText(data.getData("text/plain"));
}
