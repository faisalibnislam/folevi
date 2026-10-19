// The chart block (components/editor/chart): what each kind reads from the table, the drawing (to scale,
// inside its room, bars capped and rounded at the data end, a tooltip per mark, a summary for screen
// readers), the export SVG, live sources (table blocks with formulas, collections), CSV, number formats,
// Foli AI patches that never touch a value, and the palette kept in step with chart.css.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizeChart, type ChartData } from "@folevi/editor-schema";
import { categoryModel, colorTargets, orgModel, sliceModel, vennModel } from "@/components/editor/chart/model";
import { distanceFor, drawChart, lensArea } from "@/components/editor/chart/draw";
import { chartSvg, exportScene } from "@/components/editor/chart/svg";
import { columnUnit, fitText, formatCompact, formatValue, niceTicks } from "@/components/editor/chart/format";
import { aggregateCollection, sameRows, tableBlockRows, tableToChartRows, textToChartRows, type CollectionLike } from "@/components/editor/chart/sources";
import { applyPatch } from "@/components/editor/chart/ChartAi";
import { kindFor } from "@/components/editor/chart/fromTable";
import { sampleChart } from "@/components/editor/chart/samples";
import { PALETTE, paintCss, paintHex } from "@/components/editor/chart/palette";
import { ChartStatic, Takeaway } from "@/components/editor/chart/render";
import { CHART_KINDS } from "@folevi/editor-schema";

const chart = (o: Record<string, unknown>): ChartData => normalizeChart(o);
const SALES = chart({ kind: "bar", title: "Sign ups", columns: ["Month", "Web", "iPhone"], rows: [["Jan", 120, 40], ["Feb", 150, 62], ["Mar", 310, 90]] });
const text = (o: unknown[]) => o.map((c) => [{ type: "text", text: String(c) }]);

describe("what each kind reads", () => {
  test("categories and series: number columns only, sorted on request, colours by name", () => {
    const c = chart({ ...SALES, columns: ["Month", "Note", "Web"], rows: [["Jan", "ok", "$1,200"], ["Feb", "hm", "$900"], ["Mar", "", "$3,000"]], sort: "desc", colors: { Web: "red" } });
    const m = categoryModel(c);
    expect(m.series.map((s) => [s.name, s.color, s.unit.prefix])).toEqual([["Web", "red", "$"]]);
    expect(m.labels).toEqual(["Mar", "Jan", "Feb"]);
    expect(m.series[0]!.values).toEqual([3000, 1200, 900]);
    expect(categoryModel({ ...c, sort: "label" }).labels).toEqual(["Feb", "Jan", "Mar"]);
  });

  test("slices: only values above zero; past seven, the smallest fold into Other and colours never repeat", () => {
    const many = chart({ kind: "pie", columns: ["x", "y"], rows: "abcdefghij".split("").map((c, i) => [c, i + 1]).concat([["neg", -4]]) });
    const { slices, total } = sliceModel(many);
    expect(slices).toHaveLength(7);
    expect(slices[6]).toMatchObject({ label: "Other (4)", value: 10, color: "gray" });
    expect(new Set(slices.slice(0, 6).map((s) => s.color)).size).toBe(6);
    expect(total).toBe(55);
  });

  test("org charts: unknown managers and loops go to the top; teams take colours", () => {
    const { people, roots } = orgModel(chart({ kind: "org", columns: ["Name", "Reports to", "Role"], rows: [["Ada", "", "CEO"], ["Bo", "Ada", ""], ["Cy", "Bo", ""], ["Di", "Ed", ""], ["Ed", "Di", ""], ["Fi", "Nobody", ""], ["Ada", "Bo", "again"]] }));
    expect(people.map((p) => p.name)).toEqual(["Ada", "Bo", "Cy", "Di", "Ed", "Fi"]);
    expect(roots.map((i) => people[i]!.name)).toEqual(["Ada", "Di", "Fi"]);
    expect(people[2]!.color).toBe(people[1]!.color);
    expect(colorTargets(chart({ kind: "org", columns: ["Name", "Reports to"], rows: [["Ada", ""], ["Bo", "Ada"], ["Cy", "Ada"]] })).map((t) => t.name)).toEqual(["Bo", "Cy"]);
  });

  test("Venn: sets, and overlaps named with & or ∩ (names with “and” are sets)", () => {
    const v = vennModel(chart({ kind: "venn", columns: ["Set", "Size"], rows: [["Research and development", 10], ["Sales", 8], ["Research and development ∩ Sales", 3], ["Sales & Ops", 2]] }));
    expect(v.sets.map((s) => s.name)).toEqual(["Research and development", "Sales", "Ops"]);
    // A set named only in an overlap still gets its circle.
    expect([...v.overlaps.entries()]).toEqual([["0,1", 3], ["1,2", 2]]);
    expect(v.sized).toBe(false);
  });

  test("circles share the area their overlap asks for", () => {
    const d = distanceFor(5, 4, 12);
    expect(lensArea(5, 4, d)).toBeCloseTo(12, 3);
    expect(distanceFor(5, 4, 0)).toBeGreaterThan(9);
    expect(distanceFor(5, 4, 1000)).toBe(1);
  });
});

describe("the drawing", () => {
  const inside = (s: ReturnType<typeof drawChart>) =>
    s.marks.every((m) => {
      if (m.t === "rect") return m.x >= -1 && m.y >= -1 && m.x + m.w <= s.width + 1 && m.y + m.h <= s.height + 1;
      if (m.t === "circle") return m.cx >= 0 && m.cx <= s.width && m.cy >= 0 && m.cy <= s.height;
      if (m.t === "line") return Math.max(m.x1, m.x2) <= s.width + 1 && Math.max(m.y1, m.y2) <= s.height + 1;
      return true;
    });

  test.each(CHART_KINDS)("%s: its example draws inside its room, with tooltips and a summary", (kind) => {
    const scene = drawChart(sampleChart(kind), { width: 640, height: 320 });
    expect(scene.empty).toBe(false);
    expect(scene.hits.length).toBeGreaterThan(0);
    expect(scene.summary.length).toBeGreaterThan(20);
    expect(scene.hits.every((h) => h.tip.title && h.tip.rows.length)).toBe(true);
    if (kind !== "org") expect(inside(scene)).toBe(true);
    // Narrow (a phone) and tall still draw.
    expect(drawChart(sampleChart(kind), { width: 300, height: 260 }).empty).toBe(false);
  });

  test("bars: at most 24 px thick, rounded at the data end only, a band per category", () => {
    const scene = drawChart(SALES, { width: 800, height: 360 });
    const bars = scene.marks.filter((m) => m.t === "path" && m.fill?.startsWith("c:")) as { d: string }[];
    expect(bars).toHaveLength(6);
    for (const b of bars) {
      const xs = [...b.d.matchAll(/[MH](-?[\d.]+)/g)].map((m) => Number(m[1]));
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(24.01);
      // Two arcs: the top corners.
      expect(b.d.match(/A/g)).toHaveLength(2);
    }
    expect(scene.hits).toHaveLength(3);
    expect(scene.hits[1]!.tip).toEqual({ title: "Feb", rows: [{ label: "Web", value: "150", paint: "c:blue", key: "rect" }, { label: "iPhone", value: "62", paint: "c:orange", key: "rect" }] });
    expect(scene.summary).toBe("Bar: Sign ups. 3 categories from Jan to Mar; 2 series: Web, iPhone. Highest Web in Mar (310), lowest iPhone in Jan (40).");
  });

  test("a legend for two series or more, none for one; value labels only when asked", () => {
    const legend = (c: ChartData) => drawChart(c, { width: 600, height: 300 }).marks.filter((m) => m.t === "text" && (m.text === "Web" || m.text === "iPhone")).length;
    expect(legend(SALES)).toBe(2);
    expect(legend(chart({ ...SALES, columns: ["Month", "Web"], rows: [["Jan", 1], ["Feb", 2]] }))).toBe(0);
    expect(legend({ ...SALES, legend: "none" })).toBe(0);
    const labels = (c: ChartData) => drawChart(c, { width: 600, height: 300 }).marks.filter((m) => m.t === "text" && m.text === "310").length;
    expect(labels(SALES)).toBe(0);
    expect(labels({ ...SALES, values: true })).toBe(1);
  });

  test("a value range set by hand is kept; stacked bars hold each total", () => {
    const fixed = drawChart({ ...SALES, yMin: 0, yMax: 1000 }, { width: 600, height: 300 });
    const ticks = fixed.marks.filter((m) => m.t === "text" && m.tabular && m.anchor === "end").map((m) => (m as { text: string }).text);
    expect(ticks[0]).toBe("0");
    expect(ticks[ticks.length - 1]).toBe("1,000");
    const stacked = drawChart({ ...SALES, kind: "stackedBar" }, { width: 600, height: 300 });
    expect(stacked.hits[2]!.tip.rows.at(-1)).toMatchObject({ label: "Total", value: "400" });
  });

  test("what's missing is said, not drawn", () => {
    expect(drawChart(chart({ kind: "bar", columns: ["a", "b"], rows: [["x", "y"]] }), { width: 400, height: 300 })).toMatchObject({ empty: true, summary: expect.stringMatching(/No numbers/) });
    expect(drawChart(chart({ ...SALES, kind: "org" }), { width: 400, height: 300 }).empty).toBe(true);
    expect(drawChart(chart({ kind: "venn", columns: ["Set"], rows: [["A"]] }), { width: 400, height: 300 }).empty).toBe(true);
  });

  test("a big org chart keeps a readable size and grows the drawing (it scrolls)", () => {
    const rows = [["Boss", ""], ...Array.from({ length: 12 }, (_, i) => [`Lead ${i}`, "Boss"]), ...Array.from({ length: 24 }, (_, i) => [`Dev ${i}`, `Lead ${i % 12}`])];
    const scene = drawChart(chart({ kind: "org", columns: ["Name", "Reports to"], rows }), { width: 600, height: 300 });
    expect(scene.width).toBeGreaterThan(600);
    expect(scene.hits).toHaveLength(37);
  });
});

describe("export", () => {
  test("a standalone SVG with the title and takeaway, light colours, everything escaped", () => {
    const svg = chartSvg(JSON.stringify({ v: 1, kind: "bar", title: "<script>x</script>", takeaway: "A & B", columns: ["M", "V"], rows: [["<b>", 3]] }), 360)!;
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="880"/);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(svg).toContain("A &amp; B");
    expect(svg).toContain(PALETTE.blue.light);
    expect(svg).not.toContain("var(--");
    expect(chartSvg("", 360)).toBeNull();
    expect(chartSvg(JSON.stringify({ v: 1, kind: "bar", columns: ["a", "b"], rows: [["x", "y"]] }), 360)).toBeNull();
    expect(exportScene(SALES, 360).height).toBeGreaterThan(360);
  });

  test("the read-only chart draws the picture, the takeaway and its data as a table", () => {
    const html = renderToStaticMarkup(createElement(ChartStatic, { data: JSON.stringify({ ...SALES, v: 1, takeaway: "Up\n- Down" }), height: 360 }));
    expect(html).toContain('role="img"');
    expect(html).toContain("Show data");
    expect(html).toContain('<th scope="row">Jan</th>');
    expect(html).toContain("<li>Down</li>");
    expect(renderToStaticMarkup(createElement(Takeaway, { text: "Just one" }))).toBe("<p>Just one</p>");
  });
});

describe("sources", () => {
  test("a table block reads as the table shows it: formulas worked out, units kept, its view, no totals row", () => {
    const rows = [text(["Team", "Budget"]), text(["Design", "$1,200"]), text(["Code", "=B2*2"]), text(["Ops", "#oops"]), text(["Total", "=SUM(B2:B4)"])];
    const data = tableBlockRows({ rows, headerRow: true, totalsRow: true, view: { sort: { column: 1, desc: true } } });
    expect(data.columns).toEqual(["Team", "Budget"]);
    // The table's own order: text after numbers, so first when sorted high to low.
    expect(data.rows.map((r) => r[0])).toEqual(["Ops", "Code", "Design"]);
    expect(data.rows[1]![1]).toBe(2400);
    expect(data.rows[2]![1]).toBe("$1,200");
    // Without a header row every row is data.
    expect(tableToChartRows([text(["a", "1"]), text(["b", "2"])], false)).toEqual({ columns: ["Label", "Column 2"], rows: [["a", 1], ["b", 2]] });
    expect(tableBlockRows({ rows: [] })).toEqual({ columns: [], rows: [] });
  });

  test("a collection grouped by a field: counted, added up or averaged, in the field's order", () => {
    const c: CollectionLike = {
      name: "Deals",
      properties: [
        { id: "stage", name: "Stage", type: "select", options: [{ id: "o1", name: "Lead" }, { id: "o2", name: "Won" }] },
        { id: "amount", name: "Amount", type: "number", options: [] },
        { id: "tags", name: "Tags", type: "multiSelect", options: [{ id: "t1", name: "Big" }, { id: "t2", name: "New" }] },
        { id: "closed", name: "Closed", type: "date", options: [] },
        { id: "done", name: "Done", type: "checkbox", options: [] },
      ],
      rows: [
        { title: "A", values: { stage: "o2", amount: 100, tags: ["t1", "t2"], closed: "2026-10-03", done: true } },
        { title: "B", values: { stage: "o1", amount: 50, tags: ["t2"], closed: "2026-09-20" } },
        { title: "C", values: { stage: "o2", amount: 30, closed: "2026-10-30" } },
        { title: "D", values: { amount: 7 } },
      ],
      people: [],
    };
    expect(aggregateCollection(c, "stage", "count")).toEqual({ columns: ["Stage", "Count"], rows: [["Lead", 1], ["Won", 2], ["No value", 1]] });
    expect(aggregateCollection(c, "stage", "sum", "amount").rows).toEqual([["Lead", 50], ["Won", 130], ["No value", 7]]);
    expect(aggregateCollection(c, "stage", "average", "amount").columns).toEqual(["Stage", "Average Amount"]);
    expect(aggregateCollection(c, "tags", "count").rows).toEqual([["Big", 1], ["New", 2], ["No value", 2]]);
    expect(aggregateCollection(c, "closed", "count").rows).toEqual([["Sep 2026", 1], ["Oct 2026", 2], ["No value", 1]]);
    expect(aggregateCollection(c, "done", "count").rows).toEqual([["Yes", 1], ["No", 3]]);
    expect(aggregateCollection(c, "title", "sum", "amount").rows).toEqual([["A", 100], ["B", 50], ["C", 30], ["D", 7]]);
  });

  test("CSV and pasted rows; unchanged rows aren't written again", () => {
    const rows = textToChartRows("Month\tSales\nJan\t1,200\nFeb\t$900");
    expect(rows).toEqual({ columns: ["Month", "Sales"], rows: [["Jan", 1200], ["Feb", "$900"]] });
    expect(sameRows(rows, textToChartRows("Month,Sales\nJan,\"1,200\"\nFeb,$900"))).toBe(true);
  });

  test("a table turned into a chart: a line over time, bars otherwise", () => {
    expect(kindFor({ columns: ["Month", "Sales"], rows: [["Jan", 1], ["Feb", 2], ["Mar", 3]] })).toBe("line");
    expect(kindFor({ columns: ["Team", "Sales"], rows: [["Design", 1], ["Code", 2], ["Ops", 3]] })).toBe("bar");
    expect(kindFor({ columns: ["Name", "Manager"], rows: [["Ada", ""], ["Bo", "Ada"]] })).toBe("org");
  });
});

describe("numbers and text", () => {
  test("values written the way their column is", () => {
    expect(formatValue(1200.5, columnUnit(["$1,200.50", "$3"]))).toBe("$1,200.5");
    expect(formatValue(42, columnUnit(["42%", "7%"]))).toBe("42%");
    expect(formatValue(-300, columnUnit(["12 €"]))).toBe("-12 €".replace("12", "300"));
    expect(formatCompact(1_250_000)).toBe("1.3M");
    expect(formatCompact(12_000, columnUnit(["$1"]))).toBe("$12K");
    expect(niceTicks(0, 310, 5)).toEqual({ lo: 0, hi: 400, ticks: [0, 100, 200, 300, 400] });
    expect(niceTicks(-5, 35, 4).ticks).toEqual([-10, 0, 10, 20, 30, 40]);
    expect(fitText("A very long country name", 12, 60)).toMatch(/…$/);
  });
});

describe("Foli AI changes", () => {
  test("a patch renames and restyles, never changes a value", () => {
    const next = applyPatch(SALES, { title: "Sign ups by month", columns: ["Month", "Web", "iOS"], rowLabels: ["January", "February", "March"], kind: "line", colors: { Web: "teal" }, values: true });
    expect(next.rows.map((r) => r.slice(1))).toEqual(SALES.rows.map((r) => r.slice(1)));
    expect(next.rows.map((r) => r[0])).toEqual(["January", "February", "March"]);
    expect([next.kind, next.title, next.columns[2], next.colors.Web, next.values]).toEqual(["line", "Sign ups by month", "iOS", "teal", true]);
    // A patch that doesn't fit the table is ignored.
    expect(applyPatch(SALES, { columns: ["Only one"] }).columns).toEqual(SALES.columns);
  });
});

describe("colours", () => {
  test("chart.css has the palette's light and dark shades, and paints resolve to them", () => {
    const css = readFileSync(join(__dirname, "../src/components/editor/chart/chart.css"), "utf8");
    for (const [name, p] of Object.entries(PALETTE)) {
      expect(css).toContain(`--chart-${name}: ${p.light}`);
      expect(css).toContain(`--chart-${name}: ${p.dark}`);
      expect(css).toContain(`--chart-on-${name}: ${p.onLight}`);
    }
    expect(paintCss("c:teal")).toBe("var(--chart-teal)");
    expect(paintHex("c:teal")).toBe(PALETTE.teal.light);
    expect(paintHex("ink")).toMatch(/^#/);
  });
});
