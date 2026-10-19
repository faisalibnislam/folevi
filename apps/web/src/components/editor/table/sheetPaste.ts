// Cells pasted from Google Sheets, Excel and Numbers: rows, columns and simple formulas.
//
// Google Sheets puts each formula on its cell as R1C1, relative to the cell (data-sheets-formula
// "=R[0]C[-2]*R[0]C[-1]"), which becomes A1 here relative to where the cell lands. Excel writes its formulas
// in A1 (x:fmla) as they are in the sheet, which may not start at A1: the copied block's place in the sheet is
// worked out from the values Excel shows next to them, and the formulas are kept only when they give those
// values back. Anything else (or a formula that can't be placed) keeps the value it showed.
import { LIMITS, columnLetter, evaluateTable, isFormula, parseDelimited, parseTableNumber, remapFormulaReferences, type InlineNode } from "@folevi/editor-schema";

export interface SheetGrid {
  rows: InlineNode[][][];
  /** The first row reads as column names (text over numbers). */
  headerRow: boolean;
}

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
 * Excel's formulas (in the sheet's own A1 terms) placed in the pasted block: tries where the block could
 * have started and keeps the place where the formulas give back the most of the values shown, if that's
 * at least half of them. Returns the formulas moved there, or null to keep the values.
 */
export function placeExcelFormulas(shown: string[][], formulas: (string | null)[][]): (string | null)[][] | null {
  const cells = formulas.flatMap((row, r) => row.flatMap((f, c) => (f ? [{ r, c, f }] : [])));
  if (!cells.length) return null;
  const refs = cells.flatMap((x) => referencedCells(x.f));
  // The block can't start below or right of a cell its formulas use, or of a formula cell itself.
  const maxDr = refs.length ? Math.min(60, ...refs.map((x) => x.r)) : 0;
  const maxDc = refs.length ? Math.min(26, ...refs.map((x) => x.c)) : 0;
  let best: { score: number; out: (string | null)[][] } | null = null;
  for (let dr = 0; dr <= maxDr; dr++) {
    for (let dc = 0; dc <= maxDc; dc++) {
      const moved = formulas.map((row) => row.map((f) => (f ? remapFormulaReferences(f, { rows: (r) => r - dr, cols: (c) => c - dc }) : null)));
      const grid = shown.map((row, r) => row.map((s, c) => moved[r]?.[c] ?? s));
      const result = evaluateTable(grid, { headerRow: false });
      let score = 0;
      for (const x of cells) if (sameShown(result.display[x.r]?.[x.c] ?? "", shown[x.r]?.[x.c] ?? "")) score++;
      if (!best || score > best.score) best = { score, out: moved };
      if (score === cells.length) return moved;
    }
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
 * A pasted HTML table as cells: each cell's formatting (from `cellInline`), and formulas from Google
 * Sheets or Excel where they can be kept.
 */
export function gridFromHtmlTable(table: HTMLTableElement, cellInline: (el: Element) => InlineNode[]): SheetGrid {
  const trs = [...table.rows].slice(0, LIMITS.maxTableRows);
  const width = Math.min(LIMITS.maxTableColumns, Math.max(1, ...trs.map((tr) => [...tr.cells].reduce((n, c) => n + Math.max(1, c.colSpan || 1), 0))));
  const rows: InlineNode[][][] = [];
  const shown: string[][] = [];
  const excel: (string | null)[][] = [];
  trs.forEach((tr, r) => {
    const row: InlineNode[][] = [];
    const shownRow: string[] = [];
    const excelRow: (string | null)[] = [];
    for (const td of tr.cells) {
      if (row.length >= width) break;
      const inline = cellInline(td);
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
  return { rows, headerRow: th || looksLikeHeader(rows) };
}

/** Whether HTML came from a spreadsheet (Google Sheets, Excel, Numbers, LibreOffice). */
export function isSpreadsheetHtml(html: string): boolean {
  return /google-sheets-html-origin|data-sheets-|urn:schemas-microsoft-com:office:excel|x:str|x:num|ProgId" content="Excel|Numbers|LibreOffice/i.test(html);
}

/** Rows and columns from pasted text: tab-separated (a spreadsheet's plain copy). Null when it isn't. */
export function gridFromText(value: string): SheetGrid | null {
  if (!value.includes("\t")) return null;
  const cells = parseDelimited(value, LIMITS.maxTableRows, LIMITS.maxTableColumns);
  if (!cells.length) return null;
  const rows = cells.map((r) => r.map(text));
  return { rows, headerRow: looksLikeHeader(rows) };
}

/** A spreadsheet's cells on the clipboard (its HTML table, or its tab-separated text), or null. */
export function clipboardGrid(data: DataTransfer, cellInline: (el: Element) => InlineNode[]): SheetGrid | null {
  const html = data.getData("text/html");
  if (html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const table = doc.querySelector("table");
    if (table && (isSpreadsheetHtml(html) || doc.body.textContent?.trim() === table.textContent?.trim())) return gridFromHtmlTable(table, cellInline);
    if (table) return null;
  }
  return gridFromText(data.getData("text/plain"));
}
