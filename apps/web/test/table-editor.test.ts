// The table block's tools (components/editor/table): row and column changes carry formulas and settings
// along, spreadsheet paste keeps formulas, Foli AI's rows keep the formatting of what they didn't change, and
// copied blocks come back from the clipboard safely.
import { describe, expect, it } from "vitest";
import { tableCellText, validateWireBlock, type InlineNode } from "@folevi/editor-schema";
import * as model from "@/components/editor/table/tableModel";
import { gridFromHtmlTable, gridFromText, placeExcelFormulas, r1c1ToA1 } from "@/components/editor/table/sheetPaste";
import { mergeAiRows } from "@/components/editor/table/TableAi";
import { FOLEVI_BLOCKS_MIME, readBlockClip } from "@/components/editor/blockClipboard";

const txt = (t: string): InlineNode[] => (t ? [{ type: "text", text: t }] : []);
const table = (rows: string[][], extra: Partial<model.TableData> = {}): model.TableData => ({ rows: rows.map((r) => r.map(txt)), headerRow: true, totalsRow: false, columns: [], view: null, ...extra });
const texts = (t: model.TableData) => t.rows.map((r) => r.map((c) => tableCellText(c)));

describe("table tools", () => {
  const base = table([
    ["Item", "Price", "Qty", "Total"],
    ["Tea", "3", "2", "=B2*C2"],
    ["Cake", "4", "5", "=B3*C3"],
  ]);
  it("moves formulas with the rows and columns they point at", () => {
    expect(texts(model.moveRow(base, 2, -1)!)[1]).toEqual(["Cake", "4", "5", "=B2*C2"]);
    expect(texts(model.moveColumn(base, 1, 1)!)[1]).toEqual(["Tea", "2", "3", "=C2*B2"]);
    expect(texts(model.deleteColumn(base, 2)!)[1]).toEqual(["Tea", "3", "=B2*#REF!"]);
    expect(texts(model.addColumn(base, 1)!)[1]).toEqual(["Tea", "", "3", "2", "=C2*D2"]);
  });
  it("keeps the totals row last and adds up numeric columns", () => {
    const totals = model.setTotalsRow(base, true)!;
    expect(totals.totalsRow).toBe(true);
    expect(texts(totals)[3]).toEqual(["Total", "=SUM(B:B)", "=SUM(C:C)", "=SUM(D:D)"]);
    const more = model.addRow(totals)!;
    expect(texts(more)[3]).toEqual(["", "", "", ""]);
    expect(texts(more)[4]![0]).toBe("Total");
    expect(model.moveRow(totals, 3, -1)).toBeNull();
    expect(model.deleteRow(totals, 3)!.totalsRow).toBe(false);
    expect(model.setTotalsRow(totals, false)!.rows.length).toBe(3);
  });
  it("keeps settings and the view on their columns, and only valid ones", () => {
    const t = { ...base, columns: [{}, { format: "currency" as const, currency: "EUR" }], view: { sort: { column: 2, desc: true }, filters: [{ column: 1, op: "gt" as const, value: "3" }] } };
    const moved = model.moveColumn(t, 1, 1)!;
    expect(moved.columns[2]).toEqual({ format: "currency", currency: "EUR" });
    expect(moved.view).toEqual({ sort: { column: 1, desc: true }, filters: [{ column: 2, op: "gt", value: "3" }] });
    const gone = model.deleteColumn(t, 2)!;
    expect(gone.view).toEqual({ filters: [{ column: 1, op: "gt", value: "3" }] });
    const attrs = model.tableAttrs(gone);
    expect(validateWireBlock({ id: "01HZX7Y6J8K9M0N1P2Q3R4S5T6", type: "table", parentId: null, rank: "a", schemaVersion: 1, text: [], props: Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== null)) })).toEqual([]);
    expect(model.tableAttrs(base)).toMatchObject({ totalsRow: null, columns: null, view: null });
  });
  it("pastes a grid from a cell on, growing the table", () => {
    const pasted = model.pasteGrid(base, 2, 3, [[txt("9"), txt("x")], [txt("1"), txt("y")]]);
    expect(texts(pasted).map((r) => r.slice(3))).toEqual([["Total", ""], ["=B2*C2", ""], ["9", "x"], ["1", "y"]]);
  });
});

describe("spreadsheet paste", () => {
  it("turns Google Sheets' R1C1 formulas into A1 where the cell lands", () => {
    expect(r1c1ToA1("=R[0]C[-2]*R[0]C[-1]", 1, 3)).toBe("=B2*C2");
    expect(r1c1ToA1("=SUM(R[-3]C[0]:R[-1]C[0])", 4, 1)).toBe("=SUM(B2:B4)");
    expect(r1c1ToA1('=R2C3&"RC"', 0, 0)).toBe('=$C$2&"RC"');
    expect(r1c1ToA1("=COUNT(R[-5]C)", 1, 0)).toBeNull();
  });
  it("places Excel's sheet formulas in the pasted block from the values shown", () => {
    // Copied from C5:E6 of a sheet: E5 is =C5*D5.
    const shown = [["3", "2", "6"], ["4", "5", "20"]];
    const formulas = [[null, null, "=C5*D5"], [null, null, "=C6*D6"]];
    expect(placeExcelFormulas(shown, formulas)).toEqual([[null, null, "=A1*B1"], [null, null, "=A2*B2"]]);
    // Formulas that can't give back what's shown are dropped.
    expect(placeExcelFormulas([["1", "9"]], [[null, "=A1*100"]])).toBeNull();
  });
  it("reads an HTML table with its header and formulas, and tab-separated text", () => {
    const doc = new DOMParser().parseFromString('<table><tr><td>Item</td><td>Total</td></tr><tr><td>Tea</td><td data-sheets-formula="=1+1">2</td></tr></table>', "text/html");
    const grid = gridFromHtmlTable(doc.querySelector("table")!, (el) => txt(el.textContent ?? ""));
    expect(grid.headerRow).toBe(true);
    expect(grid.rows.map((r) => r.map((c) => tableCellText(c)))).toEqual([["Item", "Total"], ["Tea", "=1+1"]]);
    expect(gridFromText("a\tb\n1\t2")!.rows.length).toBe(2);
    expect(gridFromText("no tabs here")).toBeNull();
  });
});

describe("Foli AI's rows", () => {
  it("keeps unchanged rows whole (formatting too) and marks only the cells it changed", () => {
    const t = table([["Item", "Price"], ["Tea", "3"], ["Tea", "3"], ["Cake", "4"]]);
    t.rows[3]![0] = [{ type: "text", text: "Cake", marks: [{ type: "bold" }] }];
    const merged = mergeAiRows(t, [["Item", "Price"], ["Tea", "3"], ["Cake", "4.00"]]);
    expect([...merged.changed]).toEqual(["2:1"]);
    expect(merged.table.rows[2]![0]).toEqual([{ type: "text", text: "Cake", marks: [{ type: "bold" }] }]);
    expect(merged.table.rows.length).toBe(3);
  });
});

describe("copied blocks on the clipboard", () => {
  const data = (types: Record<string, string>) => ({ getData: (t: string) => types[t] ?? "" }) as unknown as DataTransfer;
  it("reads Folevi's own type, or the copy carried in HTML, repairing what it can and dropping the rest", () => {
    const blocks = [
      { id: "01HZX7Y6J8K9M0N1P2Q3R4S5T6", type: "table", parentId: null, rank: "V", schemaVersion: 1, text: [], props: { rows: [[txt("a")], [txt("b"), txt("c")]], headerRow: true, view: { sort: { column: 9 } } } },
      { id: "01HZX7Y6J8K9M0N1P2Q3R4S5T7", type: "script", parentId: null, rank: "W", schemaVersion: 1, text: [], props: {} },
    ];
    const clip = readBlockClip(data({ [FOLEVI_BLOCKS_MIME]: JSON.stringify({ v: 1, documentId: "D", blocks }) }))!;
    expect(clip.documentId).toBe("D");
    expect(clip.blocks.map((b) => b.type)).toEqual(["table"]);
    expect(clip.blocks[0]!.props.view).toBeUndefined();
    expect((clip.blocks[0]!.props.rows as unknown[][])[0]!.length).toBe(2);
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ v: 1, documentId: null, blocks: blocks.slice(0, 1) }))));
    expect(readBlockClip(data({ "text/html": `<span data-folevi-blocks="${b64}"></span><table></table>` }))!.blocks.length).toBe(1);
    expect(readBlockClip(data({ "text/html": "<p>hi</p>" }))).toBeNull();
    expect(readBlockClip(data({ [FOLEVI_BLOCKS_MIME]: "{nope" }))).toBeNull();
  });
});
