// The table block as a grid, the parts that are plain data (components/editor/table/tableModel.ts and
// tableClipboard.ts): rows and columns moved by a drag, column widths, a range of cells cleared, filled,
// pasted over and copied, and the open cell finding its row again after a change it didn't make.
import { describe, expect, it } from "vitest";
import { evaluateTable, tableCellText, validateWireBlock, type InlineNode } from "@folevi/editor-schema";
import * as model from "@/components/editor/table/tableModel";
import { rangeClipboard } from "@/components/editor/table/tableClipboard";
import { clipboardGrid } from "@/components/editor/table/sheetPaste";
import { cellInline } from "@/components/editor/paste";

const txt = (t: string): InlineNode[] => (t ? [{ type: "text", text: t }] : []);
const table = (rows: string[][], extra: Partial<model.TableData> = {}): model.TableData => ({ rows: rows.map((r) => r.map(txt)), headerRow: true, totalsRow: false, columns: [], view: null, ...extra });
const texts = (t: model.TableData) => t.rows.map((r) => r.map((c) => tableCellText(c)));
const grid = (rows: InlineNode[][][]) => rows.map((r) => r.map((c) => tableCellText(c)));
/** A clipboard holding what a copy put on it. */
const clipboard = (data: Record<string, string>) => ({ getData: (type: string) => data[type] ?? "" }) as unknown as DataTransfer;

const base = table([
  ["Item", "Price", "Qty", "Total"],
  ["Tea", "3", "2", "=B2*C2"],
  ["Cake", "4", "5", "=B3*C3"],
  ["Jam", "6", "1", "=B4*C4"],
]);

describe("rows and columns dragged to another place", () => {
  it("moves a row several places in one step, its formulas and the ones pointing at it following", () => {
    const moved = model.moveRowTo(base, 1, 3)!;
    expect(texts(moved)).toEqual([
      ["Item", "Price", "Qty", "Total"],
      ["Cake", "4", "5", "=B2*C2"],
      ["Jam", "6", "1", "=B3*C3"],
      ["Tea", "3", "2", "=B4*C4"],
    ]);
    expect(texts(model.moveRowTo(base, 3, 1)!)[1]).toEqual(["Jam", "6", "1", "=B2*C2"]);
    // One step is the same move the arrow buttons make.
    expect(model.moveRowTo(base, 2, 1)).toEqual(model.moveRow(base, 2, -1));
  });
  it("leaves the totals row last, and does nothing for a move that changes nothing", () => {
    const totals = model.setTotalsRow(base, true)!;
    expect(model.moveRowTo(totals, 4, 1)).toBeNull();
    expect(model.moveRowTo(totals, 1, 4)).toBeNull();
    expect(texts(model.moveRowTo(totals, 1, 3)!)[4]![0]).toBe("Total");
    expect(model.moveRowTo(base, 2, 2)).toBeNull();
    expect(model.moveRowTo(base, 2, 9)).toBeNull();
    expect(model.moveRowTo(base, -1, 1)).toBeNull();
  });
  it("moves a column several places with its settings, the view and the formulas", () => {
    const t = { ...base, columns: [{ width: 220 }, { format: "currency" as const, currency: "EUR", width: 90 }], view: { sort: { column: 1 }, filters: [{ column: 3, op: "gt" as const, value: "5" }] } };
    const moved = model.moveColumnTo(t, 1, 3)!;
    expect(texts(moved)[1]).toEqual(["Tea", "2", "=D2*B2", "3"]);
    expect(moved.columns).toEqual([{ width: 220 }, {}, {}, { format: "currency", currency: "EUR", width: 90 }]);
    expect(moved.view).toEqual({ sort: { column: 3 }, filters: [{ column: 2, op: "gt", value: "5" }] });
    expect(model.moveColumnTo(t, 3, 0)!.columns[1]).toEqual({ width: 220 });
    expect(model.moveColumnTo(t, 1, 1)).toBeNull();
    expect(model.moveColumnTo(t, 1, 4)).toBeNull();
  });
});

describe("column widths", () => {
  it("sets a width in whole pixels within the limits, beside the column's other settings", () => {
    const t = { ...base, columns: [{}, { format: "percent" as const }] };
    expect(model.setColumnWidth(t, 1, 141.6)!.columns[1]).toEqual({ format: "percent", width: 142 });
    expect(model.setColumnWidth(t, 3, 5)!.columns).toEqual([{}, { format: "percent" }, {}, { width: 60 }]);
    expect(model.setColumnWidth(t, 0, 5000)!.columns[0]).toEqual({ width: 800 });
    expect(model.setColumnWidth(t, 9, 100)).toBeNull();
  });
  it("goes back to automatic, and says when nothing changed (no empty undo step)", () => {
    const t = model.setColumnWidth({ ...base, columns: [{}, { format: "percent" as const }] }, 1, 150)!;
    expect(model.setColumnWidth(t, 1, null)!.columns[1]).toEqual({ format: "percent" });
    expect(model.setColumnWidth(t, 1, 150)).toBeNull();
    expect(model.setColumnWidth(t, 0, null)).toBeNull();
  });
  it("rides with its column when columns are added or deleted, and is saved in the block", () => {
    const t = model.setColumnWidth(model.setColumnWidth(base, 1, 90)!, 3, 300)!;
    expect(model.addColumn(t, 0)!.columns.map((c) => c.width)).toEqual([undefined, undefined, 90, undefined, 300]);
    expect(model.deleteColumn(t, 0)!.columns.map((c) => c.width)).toEqual([90, undefined, 300]);
    expect(model.deleteColumn(t, 1)!.columns.map((c) => c.width)).toEqual([undefined, undefined, 300]);
    const attrs = model.tableAttrs(t);
    expect(attrs.columns).toEqual([{}, { width: 90 }, {}, { width: 300 }]);
    expect(validateWireBlock({ id: "01HZX7Y6J8K9M0N1P2Q3R4S5T6", type: "table", parentId: null, rank: "a", schemaVersion: 1, text: [], props: Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== null)) })).toEqual([]);
    // A table whose only setting was a width that's gone has no settings again.
    expect(model.tableAttrs(model.setColumnWidth(model.setColumnWidth(base, 1, 90)!, 1, null)!).columns).toBeNull();
    expect(model.tableData(attrs).columns[3]).toEqual({ width: 300 });
  });
});

describe("a range of cells", () => {
  it("clears the cells of the rows it is given, and says when they were empty already", () => {
    const cleared = model.clearCells(base, [1, 3], 1, 2)!;
    expect(texts(cleared)).toEqual([
      ["Item", "Price", "Qty", "Total"],
      ["Tea", "", "", "=B2*C2"],
      ["Cake", "4", "5", "=B3*C3"],
      ["Jam", "", "", "=B4*C4"],
    ]);
    expect(model.clearCells(cleared, [1, 3], 1, 2)).toBeNull();
  });
  it("fills every cell with one value", () => {
    expect(texts(model.fillCells(base, [1, 2], 0, 1, () => txt("x"))).slice(1, 3)).toEqual([["x", "x", "2", "=B2*C2"], ["x", "x", "5", "=B3*C3"]]);
  });
  it("moves copied formulas by as far as their cells moved", () => {
    expect(grid(model.shiftGridFormulas([[txt("=B2*C2"), txt("plain")]], 1, 0))).toEqual([["=B3*C3", "plain"]]);
    expect(grid(model.shiftGridFormulas([[txt("=SUM(B2:B4)")]], 0, 1))).toEqual([["=SUM(C2:C4)"]]);
    // Off the top of the sheet.
    expect(grid(model.shiftGridFormulas([[txt("=B1")]], -1, 0))).toEqual([["=#REF!"]]);
  });
  it("pastes a grid over the rows as they show, in a sorted or filtered table too", () => {
    // Shown as rows 0, 3, 1 (sorted; row 2 filtered out): two pasted rows land on 3 and 1, not on 3 and 4.
    const pasted = model.pasteGridShown(base, [3, 1], 0, [[txt("a"), txt("b")], [txt("c"), txt("d")]]);
    expect(texts(pasted).map((r) => r.slice(0, 2))).toEqual([["Item", "Price"], ["c", "d"], ["Cake", "4"], ["a", "b"]]);
    // More rows than show: the rest are added at the end, and the table grows sideways as far as it must.
    const more = model.pasteGridShown(base, [3, 1], 3, [[txt("1"), txt("2")], [txt("3")], [txt("5"), txt("6")]]);
    expect(texts(more).map((r) => r.slice(3))).toEqual([["Total", ""], ["3", ""], ["=B3*C3", ""], ["1", "2"], ["5", "6"]]);
    // Rows one after another as stored: the same as the plain paste.
    expect(model.pasteGridShown(base, [2, 3], 1, [[txt("9")], [txt("8")], [txt("7")]])).toEqual(model.pasteGrid(base, 2, 1, [[txt("9")], [txt("8")], [txt("7")]]));
  });
  it("never writes over the totals row: what doesn't fit above it is added above it", () => {
    const totals = model.setTotalsRow(base, true)!;
    const pasted = model.pasteGridShown(totals, [3, 1, 4], 0, [[txt("a")], [txt("b")], [txt("c")]]);
    expect(texts(pasted).map((r) => r[0])).toEqual(["Item", "b", "Cake", "a", "c", "Total"]);
  });
});

describe("a range on the clipboard", () => {
  const t = { ...base, columns: [{}, { format: "currency" as const, currency: "USD" }] };
  const evaluated = evaluateTable(t.rows, model.tableOptions(t));
  it("is tab-separated text and an HTML table of what the cells show", () => {
    const { text, html } = rangeClipboard(t, evaluated, [1, 2], 1, 3);
    expect(text).toBe("$3.00\t2\t6\n$4.00\t5\t20");
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect([...doc.querySelectorAll("tr")].map((tr) => [...tr.cells].map((td) => td.textContent))).toEqual([["$3.00", "2", "6"], ["$4.00", "5", "20"]]);
  });
  it("quotes cells with a tab, a line break or a quote, and keeps bold, italics and links for other apps", () => {
    const rich: model.TableData = { ...table([["x"]]), rows: [[[{ type: "text", text: 'say "hi"\nthere', marks: [{ type: "bold" }] }], [{ type: "text", text: "site", marks: [{ type: "link", href: "https://example.com/?a=1&b=2" }] }]]] };
    const { text, html } = rangeClipboard(rich, evaluateTable(rich.rows, model.tableOptions(rich)), [0], 0, 1);
    expect(text).toBe('"say ""hi""\nthere"\tsite');
    expect(html).toContain("<strong>say &quot;hi&quot;<br>there</strong>");
    expect(html).toContain('<a href="https://example.com/?a=1&amp;b=2">site</a>');
  });
  it("comes back into a table as what the cells held (formulas too), saying where they were", () => {
    const { text, html } = rangeClipboard(t, evaluated, [1, 2], 1, 3);
    const back = clipboardGrid(clipboard({ "text/html": html, "text/plain": text }), cellInline, true)!;
    expect(grid(back.rows)).toEqual([["3", "2", "=B2*C2"], ["4", "5", "=B3*C3"]]);
    expect(back.origin).toEqual({ r: 1, c: 1 });
    // Pasted one row lower, the formulas point one row lower.
    expect(grid(model.shiftGridFormulas(back.rows, 1, 0))[0]).toEqual(["3", "2", "=B3*C3"]);
  });
  it("is what the cells showed anywhere else (a new table in a note, another app)", () => {
    const { text, html } = rangeClipboard(t, evaluated, [1, 2], 1, 3);
    const shown = clipboardGrid(clipboard({ "text/html": html, "text/plain": text }), cellInline)!;
    expect(grid(shown.rows)).toEqual([["$3.00", "2", "6"], ["$4.00", "5", "20"]]);
    expect(shown.origin).toBeUndefined();
    expect(grid(clipboardGrid(clipboard({ "text/plain": text }), cellInline, true)!.rows)).toEqual([["$3.00", "2", "6"], ["$4.00", "5", "20"]]);
  });
  it("takes nothing on trust from a clipboard another page wrote", () => {
    const cell = (json: string) => `<table><tr><td data-folevi-cell='${json}'>shown</td><td>b</td></tr></table>`;
    const read = (json: string) => grid(clipboardGrid(clipboard({ "text/html": cell(json) }), cellInline, true)!.rows)[0]![0];
    expect(read('[{"type":"text","text":"kept"}]')).toBe("kept");
    expect(read('[{"type":"text","text":"x","marks":[{"type":"link","href":"javascript:alert(1)"}]}]')).toBe("shown");
    expect(read('[{"type":"script","text":"x"}]')).toBe("shown");
    expect(read("{not json")).toBe("shown");
  });
});

describe("the open cell keeping its row (rows have no ids: it is found by its content)", () => {
  const rows = base.rows;
  const at = (next: model.TableData | null, r: number, c: number) => model.followCell(rows, next!.rows, r, c);
  it("stays where it is when only cells' content changed", () => {
    expect(at(model.setCell(base, 2, 1, txt("40")), 2, 1)).toEqual({ r: 2, c: 1 });
    expect(at(model.setCell(base, 1, 0, txt("Green tea")), 2, 3)).toEqual({ r: 2, c: 3 });
    expect(model.followCell(rows, rows, 3, 3)).toEqual({ r: 3, c: 3 });
  });
  it("follows its row when one is added or removed above it (formulas renumbered on the way)", () => {
    expect(at(model.addRow(base, 1), 2, 1)).toEqual({ r: 3, c: 1 });
    expect(at(model.addRow(base, 3), 2, 1)).toEqual({ r: 2, c: 1 });
    expect(at(model.deleteRow(base, 1), 3, 0)).toEqual({ r: 2, c: 0 });
    expect(at(model.deleteRow(base, 3), 1, 2)).toEqual({ r: 1, c: 2 });
    expect(at(model.addRow(base), 3, 2)).toEqual({ r: 3, c: 2 });
  });
  it("closes when its own row is gone", () => {
    expect(at(model.deleteRow(base, 2), 2, 1)).toBeNull();
  });
  it("follows a row that was moved", () => {
    expect(at(model.moveRowTo(base, 1, 3), 1, 0)).toEqual({ r: 3, c: 0 });
    expect(at(model.moveRowTo(base, 1, 3), 3, 0)).toEqual({ r: 2, c: 0 });
    expect(at(model.moveRow(base, 2, -1), 2, 2)).toEqual({ r: 1, c: 2 });
  });
  it("follows its column the same way", () => {
    expect(at(model.addColumn(base, 0), 2, 1)).toEqual({ r: 2, c: 2 });
    expect(at(model.addColumn(base, 3), 2, 1)).toEqual({ r: 2, c: 1 });
    expect(at(model.deleteColumn(base, 0), 2, 2)).toEqual({ r: 2, c: 1 });
    expect(at(model.deleteColumn(base, 2), 2, 2)).toBeNull();
    expect(at(model.moveColumnTo(base, 0, 2), 1, 0)).toEqual({ r: 1, c: 2 });
  });
  it("tells equal rows apart by where they are among the others", () => {
    const blank = table([["Name"], [""], [""], ["x"], [""]]);
    // A row added above the "x" row: the empty row under it is still the one under it.
    expect(model.followCell(blank.rows, model.addRow(blank, 3)!.rows, 4, 0)).toEqual({ r: 5, c: 0 });
    expect(model.followCell(blank.rows, model.addRow(blank, 3)!.rows, 1, 0)).toEqual({ r: 1, c: 0 });
    expect(model.followCell(blank.rows, model.deleteRow(blank, 3)!.rows, 4, 0)).toEqual({ r: 3, c: 0 });
  });
  it("gives no cell for one that was never there", () => {
    expect(model.followCell(rows, rows, 9, 0)).toBeNull();
    expect(model.followCell(rows, model.addRow(base, 1)!.rows, 0, 7)).toBeNull();
  });
});
