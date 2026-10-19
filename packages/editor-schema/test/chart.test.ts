// The chart block's data (src/chart.ts): the options beyond columns and rows (sources, colours, axes,
// legend, sort), numbers as people write them, CSV and pasted rows, and ```chart fences in Markdown.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  CHART_COLORS,
  chartDataIssue,
  chartFromFence,
  chartFromGrid,
  chartNumber,
  emptyChart,
  markdownToBlocks,
  normalizeChart,
  parseChart,
  parseChartNumber,
  parseDelimited,
  serializeChart,
} from "../src";

const base = { v: 1, kind: "bar", columns: ["Month", "Web"], rows: [["Jan", 120]] };
const issue = (extra: Record<string, unknown>) => chartDataIssue(JSON.stringify({ ...base, ...extra }));

describe("chart options", () => {
  it("accept sources, colours, axes, legend, value labels, sort and direction", () => {
    expect(
      issue({
        source: { type: "table", blockId: "01JABCDEF" },
        colors: { Web: "teal", Jan: "gray" },
        xLabel: "Month",
        yLabel: "Sign ups",
        yMin: 0,
        yMax: 500,
        legend: "right",
        values: true,
        sort: "desc",
        horizontal: true,
      }),
    ).toBeNull();
    expect(issue({ source: { type: "collection", collectionId: "c1", groupBy: "status", aggregate: "count" } })).toBeNull();
    expect(issue({ source: { type: "collection", collectionId: "c1", groupBy: "status", aggregate: "sum", field: "price" } })).toBeNull();
  });

  it("refuse anything that doesn't fit", () => {
    expect(issue({ source: { type: "table" } })).toBe("invalid source");
    expect(issue({ source: { type: "table", blockId: "a b" } })).toBe("invalid source");
    expect(issue({ source: { type: "table", blockId: "a", extra: 1 } })).toBe("invalid source");
    expect(issue({ source: { type: "collection", collectionId: "c1", groupBy: "x", aggregate: "sum" } })).toBe("invalid source");
    expect(issue({ source: { type: "web", url: "https://x" } })).toBe("invalid source");
    expect(issue({ colors: { Web: "#ff0000" } })).toBe("invalid colors");
    expect(issue({ colors: ["blue"] })).toBe("invalid colors");
    expect(issue({ xLabel: "x".repeat(81) })).toBe("invalid xLabel");
    expect(issue({ yMin: "0" })).toBe("invalid yMin");
    expect(issue({ yMin: 10, yMax: 5 })).toBe("invalid range");
    expect(issue({ legend: "left" })).toBe("invalid legend");
    expect(issue({ sort: "random" })).toBe("invalid sort");
    expect(issue({ values: "yes" })).toBe("invalid values");
    expect(issue({ script: "x" })).toBe("unexpected field script");
  });

  it("the reader keeps good options, drops bad ones, and serialising omits the defaults", () => {
    const c = normalizeChart({ ...base, colors: { Web: "teal", Bad: "neon" }, legend: "sideways", sort: "desc", yMin: 50, yMax: 10, source: { type: "collection", collectionId: "c1", groupBy: "g", aggregate: "sum" } });
    expect(c.colors).toEqual({ Web: "teal" });
    expect(c.legend).toBe("auto");
    expect(c.sort).toBe("desc");
    expect([c.yMin, c.yMax]).toEqual([null, null]);
    // A sum needs a field: read as a count instead.
    expect(c.source).toEqual({ type: "collection", collectionId: "c1", groupBy: "g", aggregate: "count" });
    const wire = JSON.parse(serializeChart(c));
    expect(wire).toEqual({ v: 1, kind: "bar", columns: ["Month", "Web"], rows: [["Jan", 120]], source: c.source, colors: { Web: "teal" }, sort: "desc" });
    expect(serializeChart({ ...emptyChart(), columns: ["a"], rows: [] })).toBe('{"v":1,"kind":"bar","columns":["a"],"rows":[]}');
  });

  it("a chart that takes its rows from a table is kept even before it has any", () => {
    const c = { ...emptyChart(), source: { type: "table" as const, blockId: "T1" } };
    const wire = serializeChart(c);
    expect(wire).not.toBe("");
    expect(chartDataIssue(wire)).toBeNull();
    expect(parseChart(wire).source).toEqual({ type: "table", blockId: "T1" });
  });

  it("whatever the reader returns passes the strict check (options included)", () => {
    const anyValue = fc.anything({ maxDepth: 2 });
    const shaped = fc.record({
      kind: fc.constantFrom("bar", "pie", "venn", "nope"),
      columns: fc.array(fc.string(), { maxLength: 4 }),
      rows: fc.array(fc.array(fc.oneof(fc.string(), fc.double(), fc.constant(null)), { maxLength: 5 }), { maxLength: 4 }),
      source: fc.oneof(anyValue, fc.record({ type: fc.constantFrom("table", "collection"), blockId: fc.string({ maxLength: 70 }), collectionId: fc.string({ maxLength: 8 }), groupBy: fc.string({ maxLength: 8 }), aggregate: fc.constantFrom("count", "sum", "max"), field: anyValue })),
      colors: fc.oneof(anyValue, fc.dictionary(fc.string({ maxLength: 300 }), fc.constantFrom(...CHART_COLORS, "neon"))),
      xLabel: anyValue,
      yMin: fc.oneof(fc.double(), anyValue),
      yMax: fc.oneof(fc.double(), anyValue),
      legend: fc.constantFrom("auto", "top", "left", 3),
      sort: fc.constantFrom("asc", "desc", "x"),
      values: anyValue,
      horizontal: anyValue,
    });
    fc.assert(
      fc.property(fc.oneof(anyValue, shaped), (input) => {
        const out = serializeChart(normalizeChart(input));
        expect(chartDataIssue(out)).toBeNull();
        expect(serializeChart(parseChart(out))).toBe(out);
      }),
      { numRuns: 400 },
    );
  });
});

describe("numbers as people write them", () => {
  it.each([
    ["1,200", 1200, "", ""],
    ["1 200 300", 1200300, "", ""],
    ["1.234.567", 1234567, "", ""],
    ["1.234,5", 1234.5, "", ""],
    ["3,5", 3.5, "", ""],
    ["$4.2k", 4200, "$", ""],
    ["$1,200.50", 1200.5, "$", ""],
    ["US$ 99", 99, "US$", ""],
    ["12 €", 12, "", "€"],
    ["42%", 42, "", "%"],
    ["(300)", -300, "", ""],
    ["−12", -12, "", ""],
    ["-$5", -5, "$", ""],
    ["2.5M", 2_500_000, "", ""],
    [".5", 0.5, "", ""],
  ])("%s", (text, value, prefix, suffix) => {
    expect(parseChartNumber(text)).toEqual({ value, prefix, suffix });
  });

  it("isn't fooled by text", () => {
    for (const s of ["", "Jan", "1-2", "12abc", "1.2.3,4,5", "v1.2", "$", "%", "1,2,3"]) expect(parseChartNumber(s), s).toBeNull();
    expect(chartNumber(null)).toBeNull();
    expect(chartNumber(7)).toBe(7);
    expect(chartNumber("7.5%")).toBe(7.5);
  });

  it("plain numeric text becomes a number when read; text with a sign stays text", () => {
    const c = normalizeChart({ kind: "bar", columns: ["a", "b"], rows: [["x", "1,200"], ["y", "$300"], ["z", "15%"]] });
    expect(c.rows).toEqual([["x", 1200], ["y", "$300"], ["z", "15%"]]);
  });
});

describe("CSV and pasted rows", () => {
  it("reads commas, semicolons and tabs, quotes and new lines in cells", () => {
    expect(parseDelimited('Month,"Sales, net",Note\nJan,"1,200","He said ""hi"""\n\nFeb,900,"two\nlines"')).toEqual([
      ["Month", "Sales, net", "Note"],
      ["Jan", "1,200", 'He said "hi"'],
      ["Feb", "900", "two\nlines"],
    ]);
    expect(parseDelimited("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseDelimited("a\tb\tc\n1\t2")).toEqual([["a", "b", "c"], ["1", "2", ""]]);
  });

  it("the first row names the columns", () => {
    expect(chartFromGrid([["", "Web", ""], ["Jan", "1,200", "x"]])).toEqual({ columns: ["Label", "Web", "Column 3"], rows: [["Jan", 1200, "x"]] });
    expect(chartFromGrid([])).toEqual({ columns: [], rows: [] });
  });
});

describe("```chart fences", () => {
  it("become chart blocks; anything else stays code", () => {
    const md = ['Before', '', '```chart', JSON.stringify({ kind: "pie", title: "Share", columns: ["Team", "People"], rows: [["Design", 4], ["Code", 9]], source: { type: "table", blockId: "x" } }), '```', '', '```chart', 'not json', '```'].join("\n");
    const { blocks } = markdownToBlocks(md, { titleFromHeading: false });
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "chart", "code"]);
    const chart = parseChart(String((blocks[1]!.props as { data: string }).data));
    expect(chart.kind).toBe("pie");
    expect(chart.rows).toEqual([["Design", 4], ["Code", 9]]);
    // A chart from Markdown never claims a live source.
    expect(chart.source).toBeNull();
    expect(chartFromFence(JSON.stringify({ kind: "bar", columns: [], rows: [] }))).toBeNull();
    expect(chartFromFence("[1,2]")).toBeNull();
  });
});
