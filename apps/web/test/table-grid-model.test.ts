// The table block as a grid, the parts that are plain data (components/editor/table/tableModel.ts and
// tableClipboard.ts): rows and columns moved by a drag, column widths, a range of cells cleared, filled,
// pasted over and copied, and the open cell finding its row again after a change it didn't make.
import { describe, expect, it } from "vitest";
import { LIMITS, TABLE_LIMITS, evaluateTable, tableCellText, tableDataBytes, tableFormulaParses, validateWireBlock, type InlineNode } from "@folevi/editor-schema";
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

describe("how much a table holds", () => {
  it("a cell takes as much text as a paragraph may, and no more; one already longer can still be shortened", () => {
    const most = "x".repeat(TABLE_LIMITS.cellLength);
    expect(model.setCellIfRoom(base, 1, 0, txt(most))).not.toBeNull();
    expect(model.setCellIfRoom(base, 1, 0, txt(`${most}y`))).toBeNull();
    expect(model.tableFull(base, model.setCell(base, 1, 0, txt(`${most}y`)))).toBe("cell");
    expect(model.tableFullMessage("cell")).toBe("A cell holds up to 20,000 characters. The text wasn't added.");
    // Made before there was a limit: it can be edited shorter, not longer.
    const long = model.setCell(base, 1, 0, txt(`${most}yyyy`));
    expect(model.setCellIfRoom(long, 1, 0, txt(`${most}yy`))).not.toBeNull();
    expect(model.setCellIfRoom(long, 1, 0, txt(`${most}yyyyy`))).toBeNull();
    // Another cell of the same table is not held back by it.
    expect(model.setCellIfRoom(long, 2, 0, txt("Scone"))).not.toBeNull();
  });
  it("a table takes 400,000 bytes of rows; typing or pasting past that is refused, removing text is not", () => {
    // 200 rows by 20 columns of 70 characters: just under.
    const cell = "y".repeat(70);
    const nearly = table(Array.from({ length: LIMITS.maxTableRows }, () => Array.from({ length: LIMITS.maxTableColumns }, () => cell)));
    expect(model.tableBytes(nearly.rows)).toBe(tableDataBytes(nearly.rows));
    expect(model.tableBytes(nearly.rows)).toBeLessThanOrEqual(TABLE_LIMITS.dataBytes);
    expect(model.setCellIfRoom(nearly, 5, 5, txt(`${cell}!`))).not.toBeNull();
    const grown = model.setCell(nearly, 5, 5, txt(cell.repeat(200)));
    expect(model.tableBytes(grown.rows)).toBeGreaterThan(TABLE_LIMITS.dataBytes);
    expect(model.tableFull(nearly, grown)).toBe("table");
    expect(model.tableFullMessage("table")).toBe("This table is full. Remove some text to make room.");
    // Bytes, not characters: text in three-byte characters fills it three times as fast.
    expect(model.tableFull(nearly, model.setCell(nearly, 5, 5, txt("表".repeat(5000))))).toBe("table");
    // From a table already over (an older one): less text is always allowed, more never.
    expect(model.setCellIfRoom(grown, 9, 9, txt(""))).not.toBeNull();
    expect(model.setCellIfRoom(grown, 9, 9, txt(`${cell}!`))).toBeNull();
    // A paste that would fill it is refused whole, and says why.
    const pasted = model.pasteCells(nearly, [1, 2, 3], 0, [[txt(cell.repeat(200))]]);
    expect(pasted).toMatchObject({ table: null, full: "table" });
    // What the editor refuses is far from what the server does: the table as it is stays valid.
    expect(validateWireBlock({ id: "01HZX7Y6J8K9M0N1P2Q3R4S5T6", type: "table", parentId: null, rank: "a", schemaVersion: 1, text: [], props: { rows: grown.rows, headerRow: true } })).toEqual([]);
  });
});

describe("a paste that doesn't fit", () => {
  const full = (totalsRow: boolean) => {
    const rows = Array.from({ length: LIMITS.maxTableRows - (totalsRow ? 1 : 0) }, (_, r) => [r === 0 ? "n" : String(r), ""]);
    return totalsRow ? model.setTotalsRow(table(rows), true)! : table(rows);
  };
  it("at the row limit the totals row is left alone, and the rows that didn't fit are counted", () => {
    const t = full(true);
    expect(t.rows.length).toBe(LIMITS.maxTableRows);
    expect(texts(t)[199]).toEqual(["=SUM(A:A)", ""]);
    // The audit's case: four rows pasted at row 198 of a full table with totals.
    const four = [[txt("a")], [txt("b")], [txt("c")], [txt("d")]];
    const pasted = model.pasteCells(t, [197, 198, 199], 0, four);
    expect(pasted).toMatchObject({ rows: 2, cutRows: 2, columns: 1, cutColumns: 0, full: null });
    expect(texts(pasted.table!).slice(197).map((r) => r[0])).toEqual(["a", "b", "=SUM(A:A)"]);
    expect(model.pasteCutMessage(pasted)).toBe("Pasted 2 of 4 rows. A table holds up to 200 rows and 20 columns.");
    // The plain paste the same: the third row used to replace the totals formula.
    expect(texts(model.pasteGrid(t, 197, 0, four))[199]).toEqual(["=SUM(A:A)", ""]);
    // With the caret in the totals row itself and no room above it: nothing is written at all.
    const none = model.pasteCells(t, [199], 0, four);
    expect(none).toMatchObject({ table: null, rows: 0, cutRows: 4 });
    expect(model.pasteCutMessage(none)).toBe("Pasted 0 of 4 rows. A table holds up to 200 rows and 20 columns.");
  });
  it("counts the columns past the twentieth, and says nothing when everything went in", () => {
    const wide = [Array.from({ length: 25 }, (_, c) => txt(String(c)))];
    const pasted = model.pasteCells(base, [1, 2, 3], 2, wide);
    expect(pasted).toMatchObject({ rows: 1, columns: 18, cutColumns: 7, cutRows: 0 });
    expect(model.width(pasted.table!)).toBe(LIMITS.maxTableColumns);
    expect(model.pasteCutMessage(pasted)).toBe("Pasted 18 of 25 columns. A table holds up to 200 rows and 20 columns.");
    const fits = model.pasteCells(base, [1, 2, 3], 0, [[txt("a"), txt("b")]]);
    expect(model.pasteCutMessage(fits)).toBeNull();
    expect(fits.table).toEqual(model.pasteGridShown(base, [1, 2, 3], 0, [[txt("a"), txt("b")]]));
    // Both at once, in a table without totals.
    const both = model.pasteCells(full(false), [199], 1, [Array.from({ length: 21 }, () => txt("z")), [txt("z")]]);
    expect(model.pasteCutMessage(both)).toBe("Pasted 1 of 2 rows and 19 of 21 columns. A table holds up to 200 rows and 20 columns.");
  });
});

describe("where rows and columns went", () => {
  it("followAxes finds each row and column once, and followCell agrees with it", () => {
    const row = model.addRow(base, 1)!;
    const rows = model.followAxes(base.rows, row.rows);
    expect([0, 1, 2, 3].map(rows.row)).toEqual([0, 2, 3, 4]);
    expect([0, 1, 2, 3].map(rows.col)).toEqual([0, 1, 2, 3]);
    expect(rows.row(9)).toBeNull();
    const column = model.addColumn(base, 0)!;
    const cols = model.followAxes(base.rows, column.rows);
    expect([0, 1, 2, 3].map(cols.col)).toEqual([1, 2, 3, 4]);
    for (const next of [row, column]) {
      const to = model.followAxes(base.rows, next.rows);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) expect(model.followCell(base.rows, next.rows, r, c)).toEqual({ r: to.row(r), c: to.col(c) });
    }
    const gone = model.deleteColumn(base, 1)!;
    expect([0, 1, 2, 3].map(model.followAxes(base.rows, gone.rows).col)).toEqual([0, null, 1, 2]);
  });
});

describe("what the cells show, from one key to the next", () => {
  const plain = table([["Item", "Price"], ["Tea", "3"], ["Cake", "4"], ["Jam", "6"]], { columns: [{}, { format: "currency", currency: "USD" }] });
  it("gives what evaluateTable gives, in a table without formulas and in one with", () => {
    for (const t of [plain, base]) {
      let last = model.evaluateFrom(null, t, "2026-10-19");
      for (const next of [model.setCell(t, 2, 1, txt("40")), model.setCell(t, 0, 1, txt("Cost")), model.setCell(t, 1, 0, txt("=1+1")), model.addRow(t)!, model.setColumn(t, 1, { format: "percent" })]) {
        last = model.evaluateFrom(last, next, "2026-10-19");
        expect(last.evaluated).toEqual(evaluateTable(next.rows, model.tableOptions(next, "2026-10-19")));
      }
    }
  });
  it("a key in a table without formulas works out that row alone, and reads no formula", () => {
    const first = model.evaluateFrom(null, plain, "2026-10-19");
    const parses = tableFormulaParses();
    const next = model.evaluateFrom(first, model.setCell(plain, 2, 1, txt("40")), "2026-10-19");
    expect(tableFormulaParses()).toBe(parses);
    expect(next.evaluated.display[2]).toEqual(["Cake", "$40.00"]);
    // Every other row is the object it was, so its row of the table isn't drawn again.
    expect([0, 1, 3].every((r) => next.evaluated.cells[r] === first.evaluated.cells[r])).toBe(true);
    expect(next.evaluated.cells[2]).not.toBe(first.evaluated.cells[2]);
  });
  it("in a table with formulas, only the rows whose cells show something new are new objects", () => {
    const first = model.evaluateFrom(null, base, "2026-10-19");
    const next = model.evaluateFrom(first, model.setCell(base, 2, 1, txt("40")), "2026-10-19");
    expect(next.evaluated.display[2]).toEqual(["Cake", "40", "5", "200"]);
    expect([0, 1, 3].every((r) => next.evaluated.cells[r] === first.evaluated.cells[r])).toBe(true);
    // The same table again is the same answer, not worked out twice.
    expect(model.evaluateFrom(next, next.table, "2026-10-19")).toBe(next);
  });
});

describe("a change made from a copy of the table (Foli AI's)", () => {
  // What Foli AI was sent, and its answer: the price of Cake changed.
  const change = (t: model.TableData, rows: string[][], changed: string[], from = rows.map((_, r) => r)): model.TableChange => ({ base: t, table: { ...t, rows: rows.map((r) => r.map(txt)) }, changed: new Set(changed), from });
  const priced = change(base, [["Item", "Price", "Qty", "Total"], ["Tea", "3", "2", "=B2*C2"], ["Cake", "4.50", "5", "=B3*C3"], ["Jam", "6", "1", "=B4*C4"]], ["2:1"]);
  it("nothing typed since: the table is its version", () => {
    expect(texts(model.applyChange(base, priced)!.table)).toEqual(texts(priced.table));
  });
  it("cells typed while it worked stay, with its change beside them", () => {
    const typed = model.setCell(model.setCell(base, 1, 2, txt("20")), 3, 0, txt("Marmalade"));
    const out = model.applyChange(typed, priced)!;
    expect(texts(out.table)).toEqual([["Item", "Price", "Qty", "Total"], ["Tea", "3", "20", "=B2*C2"], ["Cake", "4.50", "5", "=B3*C3"], ["Marmalade", "6", "1", "=B4*C4"]]);
    expect([...out.changed]).toEqual(["2:1"]);
    // A row nobody changed is the very row it was.
    expect(out.table.rows[0]).toBe(typed.rows[0]);
  });
  it("its rows' new order is kept, each row with what was typed in it; a row added since comes after", () => {
    // It sorted the rows by price, highest first, and changed nothing in them.
    const sorted = change(base, [texts(base)[0]!, texts(base)[3]!, texts(base)[2]!, texts(base)[1]!], [], [0, 3, 2, 1]);
    const typed = model.addRow(model.setCell(base, 1, 0, txt("Green tea")))!;
    const out = model.applyChange(model.setCell(typed, 4, 0, txt("Scone")), sorted)!;
    expect(texts(out.table).map((r) => r[0])).toEqual(["Item", "Jam", "Cake", "Green tea", "Scone"]);
  });
  it("a row above was added by another device: its change still lands on the row it was made for", () => {
    const out = model.applyChange(model.addRow(base, 1)!, priced)!;
    expect(texts(out.table).map((r) => r[1])).toEqual(["Price", "3", "4.50", "6", ""]);
  });
  it("a row deleted since stays deleted, unless the change was in that row", () => {
    expect(texts(model.applyChange(model.deleteRow(base, 1)!, priced)!.table).map((r) => r[0])).toEqual(["Item", "Cake", "Jam"]);
    expect(texts(model.applyChange(model.deleteRow(base, 2)!, priced)!.table).map((r) => r.slice(0, 2))).toEqual([["Item", "Price"], ["Tea", "3"], ["Cake", "4.50"], ["Jam", "6"]]);
  });
  it("columns changed since: the two no longer line up, and nothing is applied", () => {
    expect(model.applyChange(model.addColumn(base, 0)!, priced)).toBeNull();
    expect(model.applyChange(model.setTotalsRow(base, true)!, priced)).toBeNull();
  });
});
