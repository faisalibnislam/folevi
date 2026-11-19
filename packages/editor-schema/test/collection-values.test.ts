import { describe, expect, it } from "vitest";
import { clampCollectionViewConfig, cleanCollectionFormula, normalizeCollectionNumberFormat, normalizeCollectionOptions, normalizeCollectionValue, renamedCollectionOptions } from "../src";

const options = [{ id: "a" }, { id: "b" }];

describe("collection values (shared by the server and local mode)", () => {
  it("normalizes each type, and an empty value clears the cell", () => {
    expect(normalizeCollectionValue({ type: "text", options: [] }, "")).toEqual({ value: null });
    expect(normalizeCollectionValue({ type: "number", options: [] }, null)).toEqual({ value: null });
    expect(normalizeCollectionValue({ type: "text", options: [] }, "x".repeat(2100))).toEqual({ value: "x".repeat(2000) });
    expect(normalizeCollectionValue({ type: "number", options: [] }, "12.5")).toEqual({ value: 12.5 });
    expect(normalizeCollectionValue({ type: "checkbox", options: [] }, false)).toEqual({ value: false });
    expect(normalizeCollectionValue({ type: "date", options: [] }, "2026-10-20")).toEqual({ value: "2026-10-20" });
    expect(normalizeCollectionValue({ type: "select", options }, "b")).toEqual({ value: "b" });
    expect(normalizeCollectionValue({ type: "multiSelect", options }, ["a", "a", 3, "b"])).toEqual({ value: ["a", "b"] });
    expect(normalizeCollectionValue({ type: "url", options: [] }, "https://example.com")).toEqual({ value: "https://example.com" });
    expect(normalizeCollectionValue({ type: "relation", options: [] }, ["x", "x", 1, "y"])).toEqual({ value: ["x", "y"] });
  });

  it("says why a value can't be set", () => {
    expect(normalizeCollectionValue({ type: "text", options: [] }, 5)).toEqual({ problem: "Expected text." });
    expect(normalizeCollectionValue({ type: "number", options: [] }, "abc")).toEqual({ problem: "Expected a number." });
    expect(normalizeCollectionValue({ type: "checkbox", options: [] }, "yes")).toEqual({ problem: "Expected true or false." });
    expect(normalizeCollectionValue({ type: "date", options: [] }, "2026/10/20")).toEqual({ problem: "Expected a date (YYYY-MM-DD)." });
    expect(normalizeCollectionValue({ type: "select", options }, "c")).toEqual({ problem: "Unknown option." });
    expect(normalizeCollectionValue({ type: "multiSelect", options }, ["a", "c"])).toEqual({ problem: "Unknown option." });
    expect(normalizeCollectionValue({ type: "url", options: [] }, "ftp://example.com")).toEqual({ problem: "Expected a web address." });
    expect(normalizeCollectionValue({ type: "formula", options: [] }, 1)).toEqual({ problem: "A formula's values come from its formula and can't be set." });
  });

  it("keeps number formats, formulas, options and view configs within bounds", () => {
    expect(normalizeCollectionNumberFormat({ format: "currency", currency: "XYZ", decimals: 9.4 })).toEqual({ format: "currency", currency: "USD", decimals: 6 });
    expect(normalizeCollectionNumberFormat({ format: "percent", decimals: -1 })).toEqual({ format: "percent", decimals: 0 });
    expect(cleanCollectionFormula("  Price\u0001* Qty ")).toBe("Price * Qty");
    const opts = normalizeCollectionOptions([{ id: "keep", name: "  High  " }, { name: "", color: "bogus" }, { name: "Low", color: "plum" }]);
    expect(opts[0]).toEqual({ id: "keep", name: "High", color: "accent" });
    expect(opts[1]).toMatchObject({ name: "Option", color: "moss" });
    expect(opts[2]).toMatchObject({ name: "Low", color: "plum" });
    const config = clampCollectionViewConfig({ filters: Array(25).fill({}), sorts: Array(7).fill({}), summaries: [{ propertyId: "a", fn: "count" }, { propertyId: "a", fn: "sum" }] });
    expect([config.filters.length, config.sorts.length, config.summaries]).toEqual([20, 5, [{ propertyId: "a", fn: "sum" }]]);
    expect("summaries" in clampCollectionViewConfig({ filters: [], sorts: [] })).toBe(false);
  });

  it("a renamed option keeps its id, so the rows that hold it keep their value", () => {
    const had = [
      { id: "a", name: "Todo", color: "muted" },
      { id: "b", name: "Doing", color: "marigold" },
      { id: "c", name: "Done", color: "moss" },
    ];
    let n = 0;
    const edit = (text: string) => renamedCollectionOptions(had, text.split(",").map((s) => s.trim()).filter(Boolean), () => `new${++n}`);
    const ids = (text: string) => edit(text).map((o) => o.id);
    // The audit's case: one name edited in place.
    expect(edit("To do, Doing, Done")).toEqual([
      { id: "a", name: "To do", color: "muted" },
      { id: "b", name: "Doing", color: "marigold" },
      { id: "c", name: "Done", color: "moss" },
    ]);
    // Typing the old name back is the same option again, not a third one.
    expect(ids("Todo, Doing, Done")).toEqual(["a", "b", "c"]);
    // Only capitals or spaces changed; every name changed at once; a new order.
    expect(ids("todo, DOING, Done")).toEqual(["a", "b", "c"]);
    expect(ids("Later, Now, Finished")).toEqual(["a", "b", "c"]);
    expect(ids("Done, Todo, Doing")).toEqual(["c", "a", "b"]);
    // A rename next to a new option, and next to a deleted one.
    expect(ids("To do, Doing, Done, Blocked")).toEqual(["a", "b", "c", "new1"]);
    expect(ids("Doing, Finished")).toEqual(["b", "c"]);
    // Added and removed: a new option keeps the next colour round, the rest keep theirs.
    expect(edit("Todo, Waiting, Doing, Done")[1]).toEqual({ id: "new2", name: "Waiting", color: "moss" });
    expect(ids("Doing")).toEqual(["b"]);
    // Not told apart (two options became one name): nothing is guessed, the name is a new option.
    expect(ids("Either, Done")).toEqual(["new3", "c"]);
    // The same name twice is two options, never one id twice.
    expect(new Set(ids("Todo, Todo, Doing, Done")).size).toBe(4);
  });
});
