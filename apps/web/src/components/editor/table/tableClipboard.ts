// A range of table cells on the clipboard (TableView's copy and cut).
//
// Two forms, as a spreadsheet writes them. Plain text: the cells as they show, tab-separated, one row a
// line. HTML: a <table> other apps read as cells (Google Sheets, Excel, Numbers, Mail), each cell as it
// shows, with its bold, italics and links. A formula shows its result there, since "=B2*C2" means nothing in
// another sheet; what the cell really holds rides along in an attribute only a Folevi table reads back
// (sheetPaste.ts), so cells copied and pasted inside Folevi keep their formulas, mentions and dates.
import { sanitizeHref, tableCellText, type EvaluatedTable, type InlineNode, type Mark } from "@folevi/editor-schema";
import type { TableData } from "./tableModel";

/** The attribute holding a cell's stored content, and the one on the table saying where the cells came from. */
export const OWN_CELL_ATTR = "data-folevi-cell";
export const OWN_ORIGIN_ATTR = "data-folevi-origin";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Text in the marks other apps understand (colours stay Folevi's own: they come back from the attribute). */
function markedHtml(text: string, marks: readonly Mark[] | undefined): string {
  let out = escapeHtml(text).replace(/\n/g, "<br>");
  for (const m of marks ?? []) {
    if (m.type === "bold") out = `<strong>${out}</strong>`;
    else if (m.type === "italic") out = `<em>${out}</em>`;
    else if (m.type === "underline") out = `<u>${out}</u>`;
    else if (m.type === "strike") out = `<s>${out}</s>`;
    else if (m.type === "code") out = `<code>${out}</code>`;
    else if (m.type === "link") {
      const href = sanitizeHref(m.href);
      if (href) out = `<a href="${escapeHtml(href)}">${out}</a>`;
    }
  }
  return out;
}

function cellHtml(cell: InlineNode[], shown: EvaluatedTable["cells"][number][number] | undefined): string {
  // A formula's result, or a number in its column's format, in the cell's own formatting (as it is drawn).
  if (shown?.changed) return markedHtml(shown.display, (cell.find((n) => n.type === "text") as { marks?: Mark[] } | undefined)?.marks);
  return cell.map((n) => (n.type === "text" ? markedHtml(n.text, n.marks) : escapeHtml(tableCellText([n])))).join("");
}

/** A cell for tab-separated text: quoted when it holds a tab, a line break or a quote (as spreadsheets do). */
const tsvCell = (s: string) => (/["\t\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * The cells of `rows` (stored row numbers, in the order they show) from column `c0` to `c1`, as the two
 * clipboard forms.
 */
export function rangeClipboard(t: TableData, evaluated: EvaluatedTable, rows: readonly number[], c0: number, c1: number): { text: string; html: string } {
  const lines: string[] = [];
  const trs: string[] = [];
  for (const r of rows) {
    const texts: string[] = [];
    const tds: string[] = [];
    for (let c = c0; c <= c1; c++) {
      const cell = t.rows[r]?.[c] ?? [];
      const shown = evaluated.cells[r]?.[c];
      texts.push(tsvCell(shown?.changed ? shown.display : tableCellText(cell)));
      const own = cell.length ? ` ${OWN_CELL_ATTR}="${escapeHtml(JSON.stringify(cell))}"` : "";
      tds.push(`<td${own}>${cellHtml(cell, shown)}</td>`);
    }
    lines.push(texts.join("\t"));
    trs.push(`<tr>${tds.join("")}</tr>`);
  }
  const origin = rows.length ? ` ${OWN_ORIGIN_ATTR}="${rows[0]}:${c0}"` : "";
  return { text: lines.join("\n"), html: `<meta charset="utf-8"><table${origin}><tbody>${trs.join("")}</tbody></table>` };
}
