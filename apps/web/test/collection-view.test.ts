import { describe, expect, test } from "vitest";
import { applyView, matchesFilter, type ViewProperty } from "@/components/views/collectionView";

const props: ViewProperty[] = [
  { id: "status", name: "Status", type: "select", options: [{ id: "opt-todo", name: "Not started", color: "muted" }, { id: "opt-doing", name: "In progress", color: "marigold" }] },
  { id: "tags", name: "Tags", type: "multiSelect", options: [{ id: "t1", name: "Fiction", color: "plum" }, { id: "t2", name: "Classic", color: "moss" }] },
  { id: "due", name: "Due", type: "date", options: [] },
  { id: "pages", name: "Pages", type: "number", options: [] },
  { id: "done", name: "Done", type: "checkbox", options: [] },
];
const rows = [
  { title: "Middlemarch", values: { status: "opt-doing", tags: ["t2"], due: "2026-10-05", pages: 880 } },
  { title: "Dune", values: { status: "opt-todo", tags: ["t1"], due: "2026-09-01", pages: 412, done: true } },
  { title: "Untitled draft", values: {} },
];

describe("collection filters", () => {
  test("select and multi-select filters compare option ids (and understand legacy option names)", () => {
    expect(rows.filter((r) => matchesFilter(r, { propertyId: "status", op: "is", value: "opt-doing" }, props)).map((r) => r.title)).toEqual(["Middlemarch"]);
    expect(rows.filter((r) => matchesFilter(r, { propertyId: "status", op: "is", value: "in progress" }, props)).map((r) => r.title)).toEqual(["Middlemarch"]);
    expect(rows.filter((r) => matchesFilter(r, { propertyId: "tags", op: "is", value: "t1" }, props)).map((r) => r.title)).toEqual(["Dune"]);
    expect(rows.filter((r) => matchesFilter(r, { propertyId: "tags", op: "isNot", value: "Fiction" }, props)).map((r) => r.title)).toEqual(["Middlemarch", "Untitled draft"]);
  });

  test("date filters compare ISO dates, never numbers; empty dates never match before/after", () => {
    expect(rows.filter((r) => matchesFilter(r, { propertyId: "due", op: "gt", value: "2026-09-15" }, props)).map((r) => r.title)).toEqual(["Middlemarch"]);
    expect(rows.filter((r) => matchesFilter(r, { propertyId: "due", op: "lt", value: "2026-09-15" }, props)).map((r) => r.title)).toEqual(["Dune"]);
    expect(rows.filter((r) => matchesFilter(r, { propertyId: "due", op: "is", value: "2026-10-05" }, props)).map((r) => r.title)).toEqual(["Middlemarch"]);
  });

  test("numbers, checkboxes, emptiness, names, and filters without a value", () => {
    expect(rows.filter((r) => matchesFilter(r, { propertyId: "pages", op: "gt", value: 500 }, props)).map((r) => r.title)).toEqual(["Middlemarch"]);
    expect(rows.filter((r) => matchesFilter(r, { propertyId: "pages", op: "lt", value: "500" }, props)).map((r) => r.title)).toEqual(["Dune"]);
    expect(rows.filter((r) => matchesFilter(r, { propertyId: "done", op: "checked" }, props)).map((r) => r.title)).toEqual(["Dune"]);
    expect(rows.filter((r) => matchesFilter(r, { propertyId: "status", op: "isEmpty" }, props)).map((r) => r.title)).toEqual(["Untitled draft"]);
    expect(rows.filter((r) => matchesFilter(r, { propertyId: "title", op: "contains", value: "mid" }, props)).map((r) => r.title)).toEqual(["Middlemarch"]);
    expect(rows.filter((r) => matchesFilter(r, { propertyId: "status", op: "is" }, props))).toHaveLength(3);
    expect(rows.filter((r) => matchesFilter(r, { propertyId: "deleted-prop", op: "is", value: "x" }, props))).toHaveLength(3);
  });

  test("views filter then sort", () => {
    const out = applyView(rows, { filters: [{ propertyId: "pages", op: "isNotEmpty" }], sorts: [{ propertyId: "title", direction: "asc" }] }, props);
    expect(out.map((r) => r.title)).toEqual(["Dune", "Middlemarch"]);
  });
});
