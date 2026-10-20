// Formula properties of collections (src/collectionFormulas.ts), on top of the table evaluator.
import { describe, expect, it } from "vitest";
import {
  collectionFormulaLoop,
  collectionFormulaProblem,
  collectionFormulaReferences,
  collectionFormulaSource,
  collectionFormulaSyntaxError,
  collectionFormulaTable,
  evaluateCollectionFormulas,
  evaluateTable,
  formulaReference,
  renameInCollectionFormula,
  type FormulaPropertyInput,
} from "../src";

const STATUS = { id: "status", name: "Status", type: "select", options: [{ id: "o1", name: "Done" }, { id: "o2", name: "Doing" }] };
const props = (extra: FormulaPropertyInput[] = []): FormulaPropertyInput[] => [
  { id: "price", name: "Price", type: "number" },
  { id: "qty", name: "Qty", type: "number" },
  { id: "unit", name: "Unit price", type: "number" },
  { id: "due", name: "Due", type: "date" },
  { id: "done", name: "Done", type: "checkbox" },
  STATUS,
  { id: "tags", name: "Tags", type: "multiSelect", options: [{ id: "t1", name: "red" }, { id: "t2", name: "blue" }] },
  { id: "who", name: "Owner", type: "person" },
  { id: "rel", name: "Related", type: "relation" },
  { id: "note", name: "Note", type: "text" },
  ...extra,
];
const ROWS = [
  { title: "Apples", values: { price: 1.5, qty: 4, unit: 2, due: "2026-10-25", done: true, status: "o1", tags: ["t1", "t2"], who: "p1", rel: ["a", "b"], note: "=not a formula" } },
  { title: "Pears", values: { price: 2, qty: 0 } },
];
const f = (formula: string, extra: Partial<FormulaPropertyInput> = {}) => ({ id: "f", name: "Result", type: "formula", formula, ...extra });
const run = (formula: string, extra: Partial<FormulaPropertyInput> = {}, rows = ROWS) =>
  evaluateCollectionFormulas(props([f(formula, extra)]), rows, { today: "2026-10-20", personName: (id) => (id === "p1" ? "Ada" : "Someone") }).map((r) => r.f!);

describe("evaluation", () => {
  it("multiplies properties named bare, bracketed or Notion-style", () => {
    expect(run("Price * Qty").map((r) => r.value)).toEqual([6, 0]);
    expect(run('prop("Price") * prop("Qty")').map((r) => r.value)).toEqual([6, 0]);
    expect(run("[Unit price] * 2")[0]!.value).toBe(4);
    expect(run("Unit price * 2")[0]!.value).toBe(4);
    expect(run("=Price*Qty")[0]!.value).toBe(6);
  });

  it("gives numbers, text, dates and booleans, each with its kind", () => {
    expect(run('CONCAT(Name, " x", Qty)')[0]).toMatchObject({ kind: "text", value: "Apples x4" });
    expect(run("Due + 7")[0]).toMatchObject({ kind: "date", value: "2026-11-01", display: "Nov 1, 2026" });
    expect(run("Price > 1")[0]).toMatchObject({ kind: "boolean", value: true, display: "TRUE" });
    expect(run('IF(Done, "yes", "no")').map((r) => r.value)).toEqual(["yes", "no"]);
    expect(run("ROUND(Price / 3, 2)")[0]!.value).toBe(0.5);
    expect(run("DAYS(Due, TODAY())")[0]!.value).toBe(5);
    expect(run('DATEDIF(TODAY(), Due, "D")')[0]!.value).toBe(5);
    expect(run("Status")[0]!.value).toBe("Done");
    expect(run("Tags")[0]!.value).toBe("red, blue");
    expect(run("Owner")[0]!.value).toBe("Ada");
    expect(run("Related")[0]!.value).toBe(2);
    expect(run("LEN(Name)")[1]!.value).toBe(5);
    expect(run("Note")[1]).toMatchObject({ kind: "empty", display: "" });
  });

  it("reads a text value as text, never as a formula", () => {
    expect(run("Note")[0]).toMatchObject({ kind: "text", value: "=not a formula" });
  });

  it("an unchecked checkbox is FALSE, not empty", () => {
    expect(run("NOT(Done)").map((r) => r.value)).toEqual([false, true]);
  });

  it("supports == and != from other apps, outside strings only", () => {
    expect(collectionFormulaSource('Price == 2 & "a==b" & (Qty != 1)')).toBe('Price = 2 & "a==b" & (Qty <> 1)');
    expect(run("Price == 2").map((r) => r.value)).toEqual([false, true]);
  });

  it("shows Sheets-style errors with a plain explanation in collection words", () => {
    const [div] = run("Price / Qty", {}, [ROWS[1]!]);
    expect(div).toMatchObject({ kind: "error", display: "#DIV/0!", value: null });
    expect(div!.error!.message).toMatch(/empty value/);
    const [name] = run("Cost * 2");
    expect(name!.display).toBe("#NAME?");
    expect(name!.error!.message).toBe(`There's no property called "Cost". Use a property's name, like Price, or prop("Unit price").`);
    expect(run('Name + 1')[0]!.display).toBe("#VALUE!");
    expect(run("(Price")[0]!.display).toBe("#ERROR!");
  });

  it("uses the property's number format", () => {
    expect(run("Price * Qty", { numberFormat: { format: "currency", currency: "EUR" } })[0]!.display).toBe("€6.00");
    expect(run("Qty / 8", { numberFormat: { format: "percent" } })[0]!.display).toBe("50%");
    expect(run("Price * 1000", { numberFormat: { format: "number", decimals: 1 } })[0]!.display).toBe("1,500.0");
    expect(run("Price * Qty")[0]!.display).toBe("6");
  });

  it("formulas can use other formulas; a loop shows #CYCLE! in every formula in it", () => {
    const list = props([
      { id: "sub", name: "Subtotal", type: "formula", formula: "Price * Qty" },
      { id: "tax", name: "Tax", type: "formula", formula: "Subtotal * 0.25" },
      { id: "a", name: "A", type: "formula", formula: "B + 1" },
      { id: "b", name: "B", type: "formula", formula: "A + 1" },
      { id: "self", name: "Self", type: "formula", formula: "Self * 2" },
    ]);
    const [r] = evaluateCollectionFormulas(list, ROWS);
    expect(r!.tax!.value).toBe(1.5);
    expect(r!.a!.display).toBe("#CYCLE!");
    expect(r!.b!.display).toBe("#CYCLE!");
    expect(r!.self!.display).toBe("#CYCLE!");
    expect(r!.a!.error!.message).toMatch(/other formulas/);
  });

  it("gives nothing for collections without formulas and handles no rows", () => {
    expect(evaluateCollectionFormulas(props(), ROWS)).toEqual([{}, {}]);
    expect(evaluateCollectionFormulas(props([f("1")]), [])).toEqual([]);
  });

  it("a property called Name wins over the title", () => {
    const list: FormulaPropertyInput[] = [{ id: "n", name: "Name", type: "text" }, f("Name")];
    expect(evaluateCollectionFormulas(list, [{ title: "Title", values: { n: "Own" } }])[0]!.f!.value).toBe("Own");
  });
});

describe("references, renames and checks", () => {
  it("lists the properties a formula uses", () => {
    expect(collectionFormulaReferences('prop("Price") * Qty + [Unit price] + LEN(Name) + LEN("Qty")', props())).toEqual(["price", "qty", "unit", "title"]);
    expect(collectionFormulaReferences("SUM(1, 2)", props())).toEqual([]);
  });

  it("renames references and keeps how they were written", () => {
    const list = props();
    expect(renameInCollectionFormula('Price * Qty + prop("Price") + [Price] + LEN("Price")', list, "price", "Cost")).toBe('Cost * Qty + prop("Cost") + [Cost] + LEN("Price")');
    expect(renameInCollectionFormula("Price * Qty", list, "price", "Unit cost")).toBe("[Unit cost] * Qty");
    expect(renameInCollectionFormula("[Unit price] * 2", list, "unit", "Each")).toBe("[Each] * 2");
    expect(renameInCollectionFormula("Qty * 2", list, "price", "Cost")).toBe("Qty * 2");
  });

  it("names a property bare when it can, else with prop()", () => {
    expect(formulaReference("Price")).toBe("Price");
    expect(formulaReference("Unit price")).toBe('prop("Unit price")');
    expect(formulaReference("Q1")).toBe('prop("Q1")');
    expect(formulaReference('Say "hi"')).toBe('prop("Say ""hi""")');
    expect(formulaReference("True")).toBe('prop("True")');
  });

  it("refuses formulas that are too long, use their own property, or make a loop", () => {
    const list = props([
      { id: "a", name: "A", type: "formula", formula: "Price * 2" },
      { id: "b", name: "B", type: "formula", formula: "A + 1" },
    ]);
    expect(collectionFormulaProblem(list, "a", "Price * Qty")).toBeNull();
    expect(collectionFormulaProblem(list, "a", "x".repeat(1001))).toMatch(/up to 1,000 characters/);
    expect(collectionFormulaProblem(list, "a", "A * 2")).toMatch(/its own property/);
    expect(collectionFormulaProblem(list, "a", 'prop("A")')).toMatch(/its own property/);
    expect(collectionFormulaProblem(list, "a", "B * 2")).toBe("This would make formulas depend on each other in a loop: “A” → “B” → “A”.");
    expect(collectionFormulaProblem(list, "b", "Price")).toBeNull();
    expect(collectionFormulaLoop(list)).toBeNull();
    expect(collectionFormulaLoop(list.map((p) => (p.id === "a" ? { ...p, formula: "B" } : p)))).toEqual(["A", "B", "A"]);
  });

  it("tells a formula that doesn't read from one that only names something unknown", () => {
    expect(collectionFormulaSyntaxError("Price * (Qty", props())).toMatch(/brackets/);
    expect(collectionFormulaSyntaxError("Cost * 2", props())).toBeNull();
    expect(collectionFormulaSyntaxError("", props())).toBeNull();
  });

  it("gives the collection as a table Foli AI can read and the evaluator agrees with", () => {
    const list = props([f("Price * Qty")]);
    const table = collectionFormulaTable(list, ROWS);
    expect(table.rows[0]).toEqual(["Price", "Qty", "Unit price", "Due", "Done", "Status", "Tags", "Owner", "Related", "Note", "Result", "Name"]);
    expect(table.rows[1]!.slice(0, 6)).toEqual(["1.5", "4", "2", "2026-10-25", "TRUE", "Done"]);
    expect(table.rows[1]![10]).toBe("=Price * Qty");
    expect(evaluateTable(table.rows, { headerRow: true }).display[1]![10]).toBe("6");
  });
});
