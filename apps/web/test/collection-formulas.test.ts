// Formula properties in collection views (components/views/collectionView.ts): results in rows, filters,
// sorts, board groups, summaries and exports; and the formula editor's suggestions (collection/formulaAssist.ts).
import { describe, expect, test } from "vitest";
import {
  applyView,
  exportTable,
  formulaGroups,
  summarize,
  summaryFns,
  toCsv,
  toMarkdownTable,
  withFormulaValues,
  type ViewProperty,
} from "@/components/views/collectionView";
import { applySuggestion, formulaFromAi, formulaSuggestions } from "@/components/editor/collection/formulaAssist";

const props: ViewProperty[] = [
  { id: "price", name: "Price", type: "number", options: [], numberFormat: { format: "currency", currency: "USD" } },
  { id: "qty", name: "Qty", type: "number", options: [] },
  { id: "due", name: "Due", type: "date", options: [] },
  { id: "done", name: "Done", type: "checkbox", options: [] },
  { id: "who", name: "Owner", type: "person", options: [] },
  { id: "total", name: "Total", type: "formula", options: [], formula: "Price * Qty", numberFormat: { format: "number", decimals: 2 } },
  { id: "big", name: "Big", type: "formula", options: [], formula: "Total > 10" },
  { id: "label", name: "Label", type: "formula", options: [], formula: 'IF(Done, "Shipped", "Open")' },
  { id: "when", name: "When", type: "formula", options: [], formula: 'IF(Due, Due + 1, "")' },
  { id: "bad", name: "Bad", type: "formula", options: [], formula: "Price / Qty" },
  { id: "hi", name: "Hi", type: "formula", options: [], formula: 'CONCAT("Hi ", Owner)' },
];
const raw: { id: string; title: string; values: Record<string, unknown> }[] = [
  { id: "a", title: "Apples", values: { price: 2, qty: 3, due: "2026-10-05", done: true, who: "p1" } },
  { id: "b", title: "Pears", values: { price: 5, qty: 4, due: "2026-09-01" } },
  { id: "c", title: "Plums", values: { price: 1, qty: 0 } },
];
const people = [{ id: "p1", name: "Ada" }];
const rows = withFormulaValues(raw, props, { people, today: "2026-10-20" });
const titles = (list: { title: string }[]) => list.map((r) => r.title);
const config = (extra: Partial<Parameters<typeof applyView>[1]> = {}) => ({ filters: [], sorts: [], ...extra });

describe("formula results in a view", () => {
  test("each row gets its result, worked out with the row's own values", () => {
    expect(rows.map((r) => (r.values.total as { display: string }).display)).toEqual(["6.00", "20.00", "0.00"]);
    expect(rows.map((r) => (r.values.label as { value: string }).value)).toEqual(["Shipped", "Open", "Open"]);
    expect((rows[0]!.values.hi as { value: string }).value).toBe("Hi Ada");
    expect((rows[2]!.values.bad as { display: string }).display).toBe("#DIV/0!");
    // The stored values aren't touched.
    expect(raw[0]!.values).not.toHaveProperty("total");
  });

  test("a collection without formulas keeps its rows as they are", () => {
    expect(withFormulaValues(raw, props.filter((p) => p.type !== "formula"))).toBe(raw);
  });

  test("filters compare a formula's result as a number, a date, true/false or text", () => {
    expect(titles(applyView(rows, config({ filters: [{ propertyId: "total", op: "gt", value: "5" }] }), props))).toEqual(["Apples", "Pears"]);
    expect(titles(applyView(rows, config({ filters: [{ propertyId: "total", op: "is", value: 20 }] }), props))).toEqual(["Pears"]);
    expect(titles(applyView(rows, config({ filters: [{ propertyId: "big", op: "checked" }] }), props))).toEqual(["Pears"]);
    expect(titles(applyView(rows, config({ filters: [{ propertyId: "big", op: "unchecked" }] }), props))).toEqual(["Apples", "Plums"]);
    expect(titles(applyView(rows, config({ filters: [{ propertyId: "label", op: "contains", value: "ship" }] }), props))).toEqual(["Apples"]);
    expect(titles(applyView(rows, config({ filters: [{ propertyId: "label", op: "isNot", value: "open" }] }), props))).toEqual(["Apples"]);
    expect(titles(applyView(rows, config({ filters: [{ propertyId: "when", op: "lt", value: "2026-10-01" }] }), props))).toEqual(["Pears"]);
    expect(titles(applyView(rows, config({ filters: [{ propertyId: "when", op: "isEmpty" }] }), props))).toEqual(["Plums"]);
    expect(titles(applyView(rows, config({ filters: [{ propertyId: "big", op: "is", value: "yes" }] }), props))).toEqual(["Pears"]);
  });

  test("sorts go by the result (numbers by value, empty and errors last)", () => {
    expect(titles(applyView(rows, config({ sorts: [{ propertyId: "total", direction: "desc" }] }), props))).toEqual(["Pears", "Apples", "Plums"]);
    expect(titles(applyView(rows, config({ sorts: [{ propertyId: "when", direction: "asc" }] }), props))).toEqual(["Pears", "Apples", "Plums"]);
    expect(titles(applyView(rows, config({ sorts: [{ propertyId: "bad", direction: "asc" }] }), props))).toEqual(["Apples", "Pears", "Plums"]);
  });

  test("a board grouped by a formula has a column per result, in order, errors last", () => {
    expect(formulaGroups(rows, "label").map((g) => g.result.display)).toEqual(["Open", "Shipped"]);
    expect(formulaGroups(rows, "big").map((g) => g.result.display)).toEqual(["TRUE", "FALSE"]);
    expect(formulaGroups(rows, "bad").map((g) => g.key)).toEqual(["number:0.6666666666666666", "number:1.25", "error"]);
    expect(formulaGroups(rows, "when").map((g) => g.key)).toEqual(["date:2026-09-02", "date:2026-10-06", "empty"]);
  });
});

describe("summaries", () => {
  const target = (id: string) => {
    const p = props.find((x) => x.id === id)!;
    return { id, type: p.type, numberFormat: p.numberFormat };
  };
  test("sum, average, min and max use the property's number format", () => {
    expect(summarize(rows, target("price"), "sum")).toBe("$8.00");
    expect(summarize(rows, target("qty"), "average")).toBe("2.33");
    expect(summarize(rows, target("total"), "sum")).toBe("26.00");
    expect(summarize(rows, target("total"), "max")).toBe("20.00");
    // Errors aren't numbers: the average is of the two that are.
    expect(summarize(rows, target("bad"), "average")).toBe("0.96");
  });
  test("dates give the earliest and latest", () => {
    expect(summarize(rows, target("due"), "min")).toBe("Sep 1, 2026");
    expect(summarize(rows, target("when"), "max")).toBe("Oct 6, 2026");
  });
  test("counts, empties and percentages", () => {
    expect(summarize(rows, { id: "title", type: "title" }, "count")).toBe("3");
    expect(summarize(rows, target("due"), "countEmpty")).toBe("1");
    expect(summarize(rows, target("due"), "percentNotEmpty")).toBe("66.7%");
    expect(summarize(rows, target("done"), "percentChecked")).toBe("33.3%");
    expect(summarize(rows, target("big"), "percentChecked")).toBe("33.3%");
    expect(summarize(rows, target("done"), "countEmpty")).toBe("2");
    expect(summarize([], target("done"), "percentChecked")).toBe("0%");
    expect(summarize(rows, target("who"), "sum")).toBe("");
  });
  test("each type offers the summaries that make sense", () => {
    expect(summaryFns("title")).not.toContain("sum");
    expect(summaryFns("checkbox")).toContain("percentChecked");
    expect(summaryFns("formula")).toEqual(expect.arrayContaining(["sum", "average", "min", "max", "percentChecked"]));
    expect(summaryFns("date")).toEqual(expect.arrayContaining(["min", "max"]));
  });
});

describe("exports", () => {
  const visible = props.filter((p) => ["price", "done", "who", "total", "big", "when", "bad"].includes(p.id));
  test("CSV has plain values (formula results included); Markdown has what the view shows", () => {
    const csv = toCsv(exportTable(rows, visible, { as: "csv", people }));
    expect(csv.split("\r\n")[0]).toBe("Name,Price,Done,Owner,Total,Big,When,Bad");
    expect(csv.split("\r\n")[1]).toBe("Apples,2,TRUE,Ada,6,FALSE,2026-10-06,0.6666666666666666");
    expect(csv.split("\r\n")[3]).toBe("Plums,1,FALSE,,0,FALSE,,#DIV/0!");
    const md = toMarkdownTable(exportTable(rows, visible, { as: "markdown", people }));
    expect(md.split("\n")[0]).toBe("| Name | Price | Done | Owner | Total | Big | When | Bad |");
    expect(md.split("\n")[1]).toBe("| --- | --- | --- | --- | --- | --- | --- | --- |");
    expect(md.split("\n")[2]).toBe("| Apples | $2.00 | Yes | Ada | 6.00 | FALSE | Oct 6, 2026 | 0.666666666667 |");
  });
  test("CSV quotes what needs quoting and defuses cells a spreadsheet would run", () => {
    expect(toCsv([["a,b", 'say "hi"', "=SUM(A1)", "-3", "line\nbreak"]])).toBe('"a,b","say ""hi""",\'=SUM(A1),-3,"line\nbreak"\r\n');
    expect(toMarkdownTable([["A|B"], ["x\ny"]])).toBe("| A\\|B |\n| --- |\n| x y |\n");
  });
});

describe("formula suggestions", () => {
  const list = [
    { name: "Price", type: "number" },
    { name: "Unit price", type: "number" },
    { name: "Due", type: "date" },
  ];
  const label = (t: string) => t;
  test("a word suggests properties (by any word of their name) and functions", () => {
    const s = formulaSuggestions("Pri", 3, list, label)!;
    expect(s.items.map((i) => [i.kind, i.label, i.insert])).toEqual([
      ["property", "Price", "Price"],
      ["property", "Unit price", 'prop("Unit price")'],
    ]);
    expect(formulaSuggestions("ro", 2, list, label)!.items.map((i) => [i.kind, i.label, i.insert])).toEqual([
      ["function", "ROUND", "ROUND("],
      ["function", "ROUNDUP", "ROUNDUP("],
      ["function", "ROUNDDOWN", "ROUNDDOWN("],
    ]);
    expect(applySuggestion("Pri * 2", s, s.items[1]!)).toEqual({ text: 'prop("Unit price") * 2', caret: 18 });
    expect(formulaSuggestions("da", 2, list, label)!.items.map((i) => i.label)).toEqual(["DATE", "DAYS", "DATEDIF", "DAY"]);
    expect(formulaSuggestions("na", 2, list, label)!.items.map((i) => [i.label, i.detail])).toEqual([["Name", "Title"]]);
  });
  test("inside prop(\"...\") and [...] only properties, completing the call", () => {
    const s = formulaSuggestions('prop("un', 8, list, label)!;
    expect(s.items.map((i) => i.label)).toEqual(["Unit price"]);
    expect(applySuggestion('prop("un', s, s.items[0]!).text).toBe('prop("Unit price")');
    // Text after the caret that isn't the rest of the name stays.
    const mid = formulaSuggestions('prop("Pr * 2', 8, list, label)!;
    expect(applySuggestion('prop("Pr * 2', mid, mid.items[0]!).text).toBe('prop("Price") * 2');
    const done = formulaSuggestions('prop("Pr") * 2', 8, list, label)!;
    expect(applySuggestion('prop("Pr") * 2', done, done.items[0]!).text).toBe('prop("Price") * 2');
    const b = formulaSuggestions("[du", 3, list, label)!;
    expect(applySuggestion("[du", b, b.items[0]!).text).toBe("[Due]");
  });
  test("nothing inside a string, after an operator, or for a word already complete", () => {
    expect(formulaSuggestions('"Pri', 4, list, label)).toBeNull();
    expect(formulaSuggestions("Price * ", 8, list, label)).toBeNull();
    expect(formulaSuggestions("Due", 3, list, label)).toBeNull();
  });
  test("Foli AI's table formula becomes a collection formula", () => {
    const cols = ["Price", "Unit price", "Total", "Name"];
    expect(formulaFromAi("=A2 * B2", cols, 2)).toBe('Price * prop("Unit price")');
    expect(formulaFromAi('=IF([Unit price] > 2, "A2", D2)', cols, 2)).toBe('IF([Unit price] > 2, "A2", Name)');
    expect(formulaFromAi("=Price * 2", cols, 2)).toBe("Price * 2");
  });
});
