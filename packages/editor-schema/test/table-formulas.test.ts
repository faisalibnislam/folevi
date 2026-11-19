// Table formulas, number formats and views (src/tableFormulas.ts).
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  cellReference,
  columnIndex,
  columnLetter,
  deleteIndexMap,
  evaluateTable,
  formatTableNumber,
  moveIndexMap,
  parseTableDate,
  parseTableNumber,
  remapFormulaReferences,
  tableDisplayRows,
  tableFormulaParses,
  tableRowOrder,
  totalsFormula,
  totalsFunctionOf,
  blockSearchText,
  blocksToHtml,
  blocksToMarkdown,
  repairWireBlock,
  validateWireBlock,
  type InlineNode,
  type WireBlock,
} from "../src";

const show = (rows: string[][], opts = {}) => evaluateTable(rows, { headerRow: true, today: "2026-10-19", ...opts }).display;
const cell = (rows: string[][], r: number, c: number, opts = {}) => evaluateTable(rows, { headerRow: true, today: "2026-10-19", ...opts }).cells[r]![c]!;

const ITEMS = [
  ["Item", "Price", "Quantity", "Total"],
  ["Apples", "1.50", "4", "=B2*C2"],
  ["Pears", "$2", "3", "=Price * Quantity"],
  ["Plums", "1,000", "2", "=B4*C4"],
];

describe("references", () => {
  it("names columns like a spreadsheet", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLetter)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
    for (const i of [0, 5, 25, 26, 300, 702]) expect(columnIndex(columnLetter(i))).toBe(i);
    expect(cellReference(1, 2)).toBe("C2");
  });

  it("works out A1 references, ranges and whole columns", () => {
    const d = show(ITEMS);
    expect(d[1]![3]).toBe("6");
    expect(d[3]![3]).toBe("2000");
    expect(show([["A", "B"], ["1", "=SUM(A2:A4)"], ["2", ""], ["3", "=AVERAGE(A:A)"]])[1]![1]).toBe("6");
    expect(show([["A", "B"], ["1", "=SUM(A2:A4)"], ["2", ""], ["3", "=AVERAGE(A:A)"]])[3]![1]).toBe("2");
    // $ anchors read the same.
    expect(show([["A"], ["2"], ["=$A$2*3"]])[2]![0]).toBe("6");
  });

  it("uses column names for the row's cell or the whole column", () => {
    const d = show(ITEMS);
    expect(d[2]![3]).toBe("6");
    expect(show([["Unit price", "Qty", "x"], ["2", "3", "=[Unit price] * Qty"], ["4", "5", "=unit_price*qty"], ["", "", "=sum(Unit price)"]])).toEqual([
      ["Unit price", "Qty", "x"],
      ["2", "3", "6"],
      ["4", "5", "20"],
      ["", "", "6"],
    ]);
    // A name in the header row itself has no row to take.
    expect(cell([["Price", "=Price"], ["1", ""]], 0, 1).kind).toBe("error");
    expect(cell([["Price", "x"], ["1", "=Cost"]], 1, 1).error?.code).toBe("#NAME?");
  });

  it("never counts the totals row in a whole column", () => {
    const rows = [["Name", "Price"], ["a", "10"], ["b", "5"], ["Total", totalsFormula("SUM", 1)]];
    const e = evaluateTable(rows, { headerRow: true, totalsRow: true });
    expect(e.display[3]![1]).toBe("15");
    expect(e.bodyRows).toEqual([1, 2]);
    expect(totalsFunctionOf("=SUM(B:B)", 1)).toBe("SUM");
    expect(totalsFunctionOf("=average( b : b )", 1)).toBe("AVERAGE");
    expect(totalsFunctionOf("=SUM(B:B)", 2)).toBeNull();
    expect(totalsFunctionOf("=SUM(B2:B4)", 1)).toBeNull();
    // Without the totals row flag, the same total counts itself: a cycle.
    expect(evaluateTable(rows, { headerRow: true }).cells[3]![1]!.error?.code).toBe("#CYCLE!");
  });
});

describe("functions", () => {
  const t = (f: string, rows: string[][] = [["A", "B", "C"], ["1", "x", "2026-10-01"], ["2", "y", "2026-10-19"], ["3", "x", ""]]) => {
    // The formula goes in a column of its own, so whole-column ranges never include it.
    const width = rows[0]!.length;
    const all = [...rows.map((r) => [...r, ""]), [...Array.from({ length: width }, () => ""), f]];
    return evaluateTable(all, { headerRow: true, today: "2026-10-19" }).cells[all.length - 1]![width]!;
  };
  it("does arithmetic, percentages and comparisons", () => {
    expect(t("=1+2*3").display).toBe("7");
    expect(t("=(1+2)*3").display).toBe("9");
    expect(t("=2^3^2").display).toBe("64");
    expect(t("=-2^2").display).toBe("4");
    expect(t("=50%*10").display).toBe("5");
    expect(t("=0.1+0.2").display).toBe("0.3");
    expect(t("=7/2").display).toBe("3.5");
    expect(t("=A2<A3").display).toBe("TRUE");
    expect(t('="a"="A"').display).toBe("TRUE");
    expect(t('=B2<>"x"').display).toBe("FALSE");
    expect(t('="n"&A2&B2').display).toBe("n1x");
  });
  it("has the maths functions", () => {
    expect(t("=SUM(A2:A4)").display).toBe("6");
    expect(t("=SUM(A2:A4, 10)").display).toBe("16");
    expect(t("=AVERAGE(A2:A4)").display).toBe("2");
    expect(t("=MIN(A:A)").display).toBe("1");
    expect(t("=MAX(A:A)").display).toBe("3");
    expect(t("=COUNT(A2:C4)").display).toBe("5");
    expect(t("=COUNTA(B:B)").display).toBe("3");
    expect(t("=ROUND(2.345, 2)").display).toBe("2.35");
    expect(t("=ROUND(-2.5)").display).toBe("-3");
    expect(t("=ABS(-4)").display).toBe("4");
  });
  it("has the logic functions", () => {
    expect(t('=IF(A2>1, "big", "small")').display).toBe("small");
    expect(t("=IF(A3>1, 1)").display).toBe("1");
    expect(t("=AND(A2>0, A3>0)").display).toBe("TRUE");
    expect(t("=OR(A2>5, A3>5)").display).toBe("FALSE");
    expect(t("=NOT(TRUE)").display).toBe("FALSE");
    expect(t('=IFERROR(1/0, "none")').display).toBe("none");
  });
  it("has the text and date functions", () => {
    expect(t('=CONCAT(B2, "-", A2)').display).toBe("x-1");
    expect(t('=CONCATENATE(B2:B4)').display).toBe("xyx");
    expect(t('=LEFT("Folevi", 3)').display).toBe("Fol");
    expect(t('=RIGHT("Folevi", 2)').display).toBe("vi");
    expect(t('=LEN("Folevi")').display).toBe("6");
    expect(t('=UPPER("a")&LOWER("B")').display).toBe("Ab");
    expect(t("=TODAY()").display).toBe("Oct 19, 2026");
    expect(t("=C3-C2").display).toBe("18");
    expect(t("=TODAY()-C2").display).toBe("18");
    expect(t("=C2+7").display).toBe("Oct 8, 2026");
    expect(t("=DAYS(C3, C2)").display).toBe("18");
    expect(t('=DATEDIF("2025-01-15", "2026-10-19", "M")').display).toBe("21");
    expect(t("=YEAR(C2)").display).toBe("2026");
  });
  it("has the lookups", () => {
    expect(t('=COUNTIF(B:B, "x")').display).toBe("2");
    expect(t('=COUNTIF(A:A, ">1")').display).toBe("2");
    // Like spreadsheets, "<>x" counts empty cells too.
    expect(t('=COUNTIF(B:B, "<>x")').display).toBe("2");
    expect(t('=SUMIF(B:B, "x", A:A)').display).toBe("4");
    expect(t('=SUMIF(A:A, ">=2")').display).toBe("5");
    expect(t('=VLOOKUP("y", A2:B4, 1, FALSE)').display).toBe("#N/A");
    const lookups = [["Name", "Score"], ["Ana", "9"], ["Ben", "7"], ["Cy", "8"]];
    expect(t('=VLOOKUP("ben", A2:B4, 2, FALSE)', lookups).display).toBe("7");
    expect(t('=XLOOKUP("Cy", A:A, B:B)', lookups).display).toBe("8");
    expect(t('=XLOOKUP("Zed", Name, Score, "none")', lookups).display).toBe("none");
    expect(t("=VLOOKUP(8, B2:B4, 1)", [["a", "b"], ["", "1"], ["", "5"], ["", "9"]]).display).toBe("5");
  });
});

describe("errors", () => {
  const e = (rows: string[][], r: number, c: number) => cell(rows, r, c).error;
  it("explains each one in plain words", () => {
    expect(e([["a"], ["=1/0"]], 1, 0)).toMatchObject({ code: "#DIV/0!", message: expect.stringMatching(/zero/) });
    expect(e([["a"], ["=Z9"]], 1, 0)?.code).toBe("#REF!");
    expect(e([["a"], ["=NOPE(1)"]], 1, 0)).toMatchObject({ code: "#NAME?", message: expect.stringMatching(/NOPE/) });
    expect(e([["a"], ['="x"*2']], 1, 0)?.code).toBe("#VALUE!");
    expect(e([["a"], ["=SUM("]], 1, 0)?.code).toBe("#ERROR!");
    expect(e([["a"], ["=A2"]], 1, 0)?.code).toBe("#CYCLE!");
    expect(e([["a", "b"], ["=B2", "=A2"]], 1, 0)?.code).toBe("#CYCLE!");
    expect(e([["a"], ["=SUM()"]], 1, 0)?.code).toBe("#N/A");
    // An error flows on into the formulas that use it.
    expect(e([["a", "b"], ["=1/0", "=A2+1"]], 1, 1)?.code).toBe("#DIV/0!");
  });
  it("never throws, whatever is typed", () => {
    fc.assert(
      fc.property(fc.array(fc.array(fc.oneof(fc.string(), fc.string().map((s) => `=${s}`), fc.constantFrom("=A1", "=SUM(A:A)", "=B2*2", "=A2:B3", "=((", '="')), { minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 5 }), (rows) => {
        const width = Math.max(...rows.map((r) => r.length));
        const even = rows.map((r) => [...r, ...Array.from({ length: width - r.length }, () => "")]);
        const out = evaluateTable(even, { headerRow: true, totalsRow: rows.length > 2 });
        expect(out.display.length).toBe(even.length);
      }),
    );
  });
  it("handles long chains without running out of stack", () => {
    const rows = [["n"], ["1"], ...Array.from({ length: 198 }, (_, i) => [`=A${i + 2}+1`])];
    const out = evaluateTable(rows, { headerRow: true });
    expect(out.display[199]![0]).toMatch(/^(199|#CYCLE!)$/);
  });
  it("works out a chain of any length: 600 formulas each reading the one before, across three columns", () => {
    // Column A counts down its 200 rows, B carries on from the foot of A, C from the foot of B.
    const rows = Array.from({ length: 200 }, (_, r) => [r === 0 ? "1" : `=A${r}+1`, r === 0 ? "=A200+1" : `=B${r}+1`, r === 0 ? "=B200+1" : `=C${r}+1`]);
    const out = evaluateTable(rows, { headerRow: false });
    expect(out.display[199]).toEqual(["200", "400", "600"]);
    expect(out.cells.flat().some((c) => c.kind === "error")).toBe(false);
    // The longest a table can hold: every cell of 200 rows by 20 columns reading the one before it.
    const all = Array.from({ length: 200 }, (_, r) => Array.from({ length: 20 }, (_, c) => (r === 0 && c === 0 ? "1" : r === 0 ? `=${columnLetter(c - 1)}200+1` : `=${columnLetter(c)}${r}+1`)));
    expect(evaluateTable(all, { headerRow: false }).display[199]![19]).toBe("4000");
  });
  it("shows the cycle error in every cell of a loop, whichever is worked out first and whatever IFERROR is in it", () => {
    const first = (rows: string[][]) => evaluateTable(rows, { headerRow: false }).display[0];
    expect(first([["=IFERROR(B1,0)", "=A1+1"]])).toEqual(["#CYCLE!", "#CYCLE!"]);
    expect(first([["=B1+1", "=IFERROR(A1,0)"]])).toEqual(["#CYCLE!", "#CYCLE!"]);
    expect(first([["=IFERROR(A1,0)"]])).toEqual(["#CYCLE!"]);
    // A cell outside the loop that reads into it may still catch the error.
    expect(first([["=B1+1", "=A1+1", "=IFERROR(A1,5)"]])).toEqual(["#CYCLE!", "#CYCLE!", "5"]);
    expect(first([["=IFERROR(B1,5)", "=C1+1", "=B1+1"]])).toEqual(["5", "#CYCLE!", "#CYCLE!"]);
    // A reference that is never read (the other side of an IF) is no loop.
    expect(first([["=IF(1=1,7,A1)"]])).toEqual(["7"]);
    // A loop longer than formulas may read inside one another still shows as a loop everywhere.
    const ring = Array.from({ length: 200 }, (_, r) => [r === 0 ? "=C200+1" : `=A${r}+1`, r === 0 ? "=A200+1" : `=B${r}+1`, r === 0 ? "=B200+1" : `=C${r}+1`]);
    expect(new Set(evaluateTable(ring, { headerRow: false }).display.flat())).toEqual(new Set(["#CYCLE!"]));
  });
  it("reads each distinct formula once, however many cells hold it and however often the table is worked out", () => {
    const rows = [["Price", "Qty", "Total", "Doubled"], ...Array.from({ length: 50 }, (_, i) => [String(i), "2", "=Price * Qty + 0.125", "=Total*2+0.125"])];
    const before = tableFormulaParses();
    const one = evaluateTable(rows, { headerRow: true });
    expect(tableFormulaParses() - before).toBe(2);
    // A cell that isn't a formula changes (a key typed in it): nothing is read again.
    const next = rows.map((r, i) => (i === 3 ? ["9", r[1]!, r[2]!, r[3]!] : r));
    const two = evaluateTable(next, { headerRow: true });
    expect(tableFormulaParses() - before).toBe(2);
    expect(one.display[3]).toEqual(["2", "2", "4.125", "8.375"]);
    expect(two.display[3]).toEqual(["9", "2", "18.125", "36.375"]);
    // The same text under other column names means something else, and is read for them.
    expect(evaluateTable([["Qty", "Price", "Total"], ["2", "5", "=Price * Qty + 0.125"]], { headerRow: true }).display[1]![2]).toBe("10.125");
  });
  it("gives every reader of a range the same cells, and a formula in the range its own result", () => {
    // Twenty lookups over one range that itself holds formulas.
    const rows = [["Key", "Value", "Find", "Found"], ...Array.from({ length: 20 }, (_, i) => [`k${i}`, `=${i}*10`, `k${19 - i}`, `=VLOOKUP(C${i + 2},A2:B21,2,FALSE)`])];
    const out = evaluateTable(rows, { headerRow: true });
    expect(out.display.slice(1).map((r) => r[3])).toEqual(Array.from({ length: 20 }, (_, i) => String((19 - i) * 10)));
  });
});

describe("values and formats", () => {
  it("reads numbers and dates as people write them", () => {
    expect(parseTableNumber("1,234.50")).toBe(1234.5);
    expect(parseTableNumber("$12")).toBe(12);
    expect(parseTableNumber("-$3")).toBe(-3);
    expect(parseTableNumber("12%")).toBe(0.12);
    expect(parseTableNumber("12 apples")).toBeNull();
    expect(parseTableNumber("1,23")).toBeNull();
    expect(parseTableDate("2026-10-19")).toBe(parseTableDate("Oct 19, 2026"));
    expect(parseTableDate("19 October 2026")).toBe(parseTableDate("2026/10/19"));
    expect(parseTableDate("2026-02-30")).toBeNull();
  });
  it("formats each column", () => {
    expect(formatTableNumber(1234.5, { format: "number" })).toBe("1,234.5");
    expect(formatTableNumber(1234.5, { format: "number", decimals: 2 })).toBe("1,234.50");
    expect(formatTableNumber(1234.5, { format: "currency", currency: "EUR" })).toBe("€1,234.50");
    expect(formatTableNumber(1234.5, { format: "currency", currency: "nope" })).toBe("$1,234.50");
    expect(formatTableNumber(0.125, { format: "percent" })).toBe("12.5%");
    const day = parseTableDate("2026-10-19")!;
    expect(formatTableNumber(day, { format: "date" })).toBe("Oct 19, 2026");
    const rows = [["Item", "Price"], ["a", "1234.5"], ["b", "text"], ["c", "=B2*2"]];
    const e = evaluateTable(rows, { headerRow: true, columns: [null, { format: "currency", currency: "USD" }] });
    expect(e.display.map((r) => r[1])).toEqual(["Price", "$1,234.50", "text", "$2,469.00"]);
    expect(e.cells[1]![1]!.numeric).toBe(true);
    expect(e.cells[2]![1]!.numeric).toBe(false);
    // Without a format a typed number shows as typed.
    expect(evaluateTable([["n"], ["1,000"]], { headerRow: true }).display[1]![0]).toBe("1,000");
  });
  it("puts results in place of formulas for exports, keeping the cell's formatting", () => {
    const rows: InlineNode[][][] = [
      [[{ type: "text", text: "a" }], [{ type: "text", text: "b" }]],
      [[{ type: "text", text: "2" }], [{ type: "text", text: "=A2*2", marks: [{ type: "bold" }] }]],
    ];
    const out = tableDisplayRows(rows, { headerRow: true });
    expect(out[1]![1]).toEqual([{ type: "text", text: "4", marks: [{ type: "bold" }] }]);
    expect(out[1]![0]).toBe(rows[1]![0]);
    // A date chip in a cell is a date.
    const dated: InlineNode[][][] = [[[{ type: "text", text: "d" }], [{ type: "text", text: "e" }]], [[{ type: "date", date: "2026-10-01" }], [{ type: "text", text: "=TODAY()-A2" }]]];
    expect(evaluateTable(dated, { headerRow: true, today: "2026-10-19" }).display[1]![1]).toBe("18");
  });
});

describe("views", () => {
  const rows = [["Name", "Score", "Team"], ["Cy", "8", "red"], ["Ana", "10", "blue"], ["Ben", "", "red"], ["Dee", "9", "blue"], ["Total", "=SUM(B:B)", ""]];
  const opts = { headerRow: true, totalsRow: true };
  const e = evaluateTable(rows, opts);
  it("sorts by value, empty cells last, header and totals fixed", () => {
    expect(tableRowOrder(e, opts, { sort: { column: 1 } })).toEqual([0, 1, 4, 2, 3, 5]);
    expect(tableRowOrder(e, opts, { sort: { column: 1, desc: true } })).toEqual([0, 2, 4, 1, 3, 5]);
    expect(tableRowOrder(e, opts, { sort: { column: 0 } })).toEqual([0, 2, 3, 1, 4, 5]);
    expect(tableRowOrder(e, opts, null)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("filters on what cells show", () => {
    expect(tableRowOrder(e, opts, { filters: [{ column: 2, op: "equals", value: "Red" }] })).toEqual([0, 1, 3, 5]);
    expect(tableRowOrder(e, opts, { filters: [{ column: 1, op: "gt", value: "8" }] })).toEqual([0, 2, 4, 5]);
    expect(tableRowOrder(e, opts, { filters: [{ column: 1, op: "empty" }] })).toEqual([0, 3, 5]);
    expect(tableRowOrder(e, opts, { filters: [{ column: 0, op: "contains", value: "e" }, { column: 2, op: "notEquals", value: "blue" }], sort: { column: 0, desc: true } })).toEqual([0, 3, 5]);
    // A filter on a column that's gone is ignored.
    expect(tableRowOrder(e, opts, { filters: [{ column: 9, op: "empty" }] })).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("moving references", () => {
  it("follows moved rows and columns", () => {
    expect(remapFormulaReferences("=B2*C2", { cols: moveIndexMap(1, 2) })).toBe("=C2*B2");
    expect(remapFormulaReferences("=SUM(B2:B5)", { rows: moveIndexMap(1, 3) })).toBe("=SUM(B2:B5)");
    expect(remapFormulaReferences("=A3", { rows: moveIndexMap(2, 1) })).toBe("=A2");
    expect(remapFormulaReferences("=$A$3+SUM(A:B)", { cols: moveIndexMap(0, 2) })).toBe("=$C$3+SUM(A:C)");
  });
  it("a row or column moved out of the middle of a range leaves it one shorter, not stretched to where it went", () => {
    // Row 3 dragged below row 9: the range was rows 2 to 5 and is the three that stayed.
    expect(remapFormulaReferences("=SUM(B2:B5)", { rows: moveIndexMap(2, 8) })).toBe("=SUM(B2:B4)");
    // Dragged up, above the range: the rows that stayed moved down by one.
    expect(remapFormulaReferences("=SUM(B3:B6)", { rows: moveIndexMap(3, 0) })).toBe("=SUM(B4:B6)");
    expect(remapFormulaReferences("=SUM(C1:E1)", { cols: moveIndexMap(3, 7) })).toBe("=SUM(C1:D1)");
    expect(remapFormulaReferences("=SUM(B:E)", { cols: moveIndexMap(2, 6) })).toBe("=SUM(B:D)");
    // To another place inside the range, to either end of it included: the same rows, the same range.
    expect(remapFormulaReferences("=SUM(B2:B5)", { rows: moveIndexMap(2, 4) })).toBe("=SUM(B2:B5)");
    expect(remapFormulaReferences("=SUM(B2:B5)", { rows: moveIndexMap(3, 1) })).toBe("=SUM(B2:B5)");
    // A row from outside dropped into the range is in it; dropped next to it, it isn't.
    expect(remapFormulaReferences("=SUM(B2:B5)", { rows: moveIndexMap(7, 2) })).toBe("=SUM(B2:B6)");
    expect(remapFormulaReferences("=SUM(B2:B5)", { rows: moveIndexMap(7, 5) })).toBe("=SUM(B2:B5)");
    // What the sum is worth: rows 2 to 5 hold 1, 2, 3, 4 and rows 6 and 7 hold 100 each.
    const rows = [["n", "sum"], ["1", "=SUM(A2:A5)"], ["2", ""], ["3", ""], ["4", ""], ["100", ""], ["100", ""]];
    const map = moveIndexMap(2, 6);
    const order = [0, 1, 3, 4, 5, 6, 2];
    const moved = order.map((r) => rows[r]!.map((t) => remapFormulaReferences(t, { rows: map })));
    expect(moved[1]![1]).toBe("=SUM(A2:A4)");
    expect(evaluateTable(moved, { headerRow: true }).display[1]![1]).toBe("8");
  });
  it("turns deleted cells into #REF! and shrinks ranges", () => {
    expect(remapFormulaReferences("=A2+A3", { rows: deleteIndexMap(1) })).toBe("=#REF!+A2");
    expect(remapFormulaReferences("=SUM(A2:A5)", { rows: deleteIndexMap(4) })).toBe("=SUM(A2:A4)");
    expect(remapFormulaReferences("=SUM(A2:A2)", { rows: deleteIndexMap(1) })).toBe("=SUM(#REF!)");
    expect(remapFormulaReferences("=SUM(B:C)", { cols: deleteIndexMap(1) })).toBe("=SUM(B:B)");
    expect(evaluateTable([["a"], ["=#REF!+1"]], { headerRow: true }).cells[1]![0]!.error?.code).toBe("#REF!");
  });
  it("an apostrophe before = makes the cell text: it shows without the apostrophe and is never worked out", () => {
    const out = evaluateTable([["Note", "n"], ["'=> see below", "'=1+1"], ["'90s", "=LEN(A2)"]], { headerRow: true });
    expect(out.display[1]).toEqual(["=> see below", "=1+1"]);
    expect(out.cells[1]![0]).toMatchObject({ kind: "text", formula: false, changed: true, raw: "'=> see below", value: "=> see below" });
    // Any other apostrophe is just an apostrophe.
    expect(out.cells[2]![0]).toMatchObject({ display: "'90s", changed: false });
    expect(out.display[2]![1]).toBe("12");
    // Moving rows leaves it alone, and exports read what it shows.
    expect(remapFormulaReferences("'=A2", { rows: deleteIndexMap(1) })).toBe("'=A2");
    expect(tableDisplayRows([[[{ type: "text", text: "'=A1" }]]], { headerRow: false })[0]![0]).toEqual([{ type: "text", text: "=A1" }]);
  });
  it("leaves strings, names, functions and plain text alone", () => {
    expect(remapFormulaReferences('="B2"&LOG10(B2)', { cols: deleteIndexMap(1) })).toBe('="B2"&LOG10(#REF!)');
    expect(remapFormulaReferences("B2 is text", { cols: deleteIndexMap(1) })).toBe("B2 is text");
    expect(remapFormulaReferences("=Price*2", { cols: deleteIndexMap(0) })).toBe("=Price*2");
  });
});

describe("the table block's settings", () => {
  const txt = (t: string): InlineNode[] => (t ? [{ type: "text", text: t }] : []);
  const table = (props: Record<string, unknown>): WireBlock => ({
    id: "01HZX7Y6J8K9M0N1P2Q3R4S5T6",
    type: "table",
    parentId: null,
    rank: "a",
    schemaVersion: 1,
    text: [],
    props: { rows: [[txt("Item"), txt("Price")], [txt("a"), txt("1200")], [txt("b"), txt("=B2/2")], [txt("Total"), txt("=SUM(B:B)")]], headerRow: true, ...props },
  });
  it("keeps old tables valid and accepts formats, a view and a totals row", () => {
    expect(validateWireBlock(table({}))).toEqual([]);
    expect(validateWireBlock(table({ totalsRow: true, columns: [{}, { format: "currency", currency: "EUR", decimals: 2 }], view: { sort: { column: 1, desc: true }, filters: [{ column: 0, op: "contains", value: "a" }, { column: 1, op: "notEmpty" }] } }))).toEqual([]);
  });
  it("refuses settings that don't fit the table", () => {
    const codes = (props: Record<string, unknown>) => validateWireBlock(table(props)).map((i) => i.path);
    expect(codes({ columns: [{}, {}, {}] })).toContain("props.columns");
    expect(codes({ columns: [{ format: "money" }] })).toContain("props.columns[0].format");
    expect(codes({ columns: [{ currency: "dollars" }] })).toContain("props.columns[0].currency");
    expect(codes({ columns: [{ decimals: 9 }] })).toContain("props.columns[0].decimals");
    expect(codes({ view: { sort: { column: 5 } } })).toContain("props.view.sort.column");
    expect(codes({ view: { filters: [{ column: 0, op: "like" }] } })).toContain("props.view.filters[0].op");
    expect(codes({ totalsRow: true, rows: [[txt("x")]] })).toContain("props.totalsRow");
  });
  it("repairs what it can and drops the rest", () => {
    const { block, issues } = repairWireBlock(table({ columns: [{ format: "money", decimals: 2 }, { format: "percent", currency: "usd" }, { format: "date" }], view: { sort: { column: 7 }, filters: [{ column: 1, op: "gt", value: "5" }, { column: 4, op: "empty" }, "x"] }, totalsRow: "yes" }));
    expect(issues).toEqual([]);
    expect(block.props.columns).toEqual([{ decimals: 2 }, { format: "percent", currency: "USD" }]);
    expect(block.props.view).toEqual({ filters: [{ column: 1, op: "gt", value: "5" }] });
    expect(block.props.totalsRow).toBeUndefined();
  });
  it("takes a column's width in whole pixels, within its limits", () => {
    const codes = (props: Record<string, unknown>) => validateWireBlock(table(props)).map((i) => i.path);
    expect(validateWireBlock(table({ columns: [{ width: 60 }, { format: "currency", currency: "EUR", width: 800 }] }))).toEqual([]);
    expect(codes({ columns: [{ width: 59 }] })).toContain("props.columns[0].width");
    expect(codes({ columns: [{}, { width: 801 }] })).toContain("props.columns[1].width");
    expect(codes({ columns: [{ width: 120.5 }] })).toContain("props.columns[0].width");
    // Repair keeps the column about as wide as it was: clamped and rounded, or automatic when it says nothing.
    const { block, issues } = repairWireBlock(table({ columns: [{ width: 2000, format: "number" }, { width: 12.4 }], view: { sort: { column: 9 } } }));
    expect(issues).toEqual([]);
    expect(block.props.columns).toEqual([{ format: "number", width: 800 }, { width: 60 }]);
    expect(repairWireBlock(table({ columns: [{ width: "wide" }, { decimals: 1 }] })).block.props.columns).toEqual([{}, { decimals: 1 }]);
    expect(repairWireBlock(table({ columns: [{ width: "wide" }] })).block.props.columns).toBeUndefined();
  });
  it("exports and searches what the cells show", () => {
    const b = table({ totalsRow: true, columns: [{}, { format: "currency", currency: "USD" }] });
    const md = blocksToMarkdown([b]);
    expect(md).toContain("| b | $600.00 |");
    expect(md).toContain("| Total | $1,800.00 |");
    const html = blocksToHtml([b], { title: "T" });
    expect(html).toContain('<td style="text-align:right">$1,200.00</td>');
    expect(html).toContain('<tr class="total">');
    expect(blockSearchText(b)).toContain("$600.00");
    expect(blockSearchText(b)).toContain("=B2/2");
  });
});
