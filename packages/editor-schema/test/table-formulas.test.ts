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
  tableRowOrder,
  totalsFormula,
  totalsFunctionOf,
  type InlineNode,
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
  it("turns deleted cells into #REF! and shrinks ranges", () => {
    expect(remapFormulaReferences("=A2+A3", { rows: deleteIndexMap(1) })).toBe("=#REF!+A2");
    expect(remapFormulaReferences("=SUM(A2:A5)", { rows: deleteIndexMap(4) })).toBe("=SUM(A2:A4)");
    expect(remapFormulaReferences("=SUM(A2:A2)", { rows: deleteIndexMap(1) })).toBe("=SUM(#REF!)");
    expect(remapFormulaReferences("=SUM(B:C)", { cols: deleteIndexMap(1) })).toBe("=SUM(B:B)");
    expect(evaluateTable([["a"], ["=#REF!+1"]], { headerRow: true }).cells[1]![0]!.error?.code).toBe("#REF!");
  });
  it("leaves strings, names, functions and plain text alone", () => {
    expect(remapFormulaReferences('="B2"&LOG10(B2)', { cols: deleteIndexMap(1) })).toBe('="B2"&LOG10(#REF!)');
    expect(remapFormulaReferences("B2 is text", { cols: deleteIndexMap(1) })).toBe("B2 is text");
    expect(remapFormulaReferences("=Price*2", { cols: deleteIndexMap(0) })).toBe("=Price*2");
  });
});
