import { describe, expect, test } from "vitest";
import { applyView, matchesFilter, type ViewProperty } from "@/components/views/collectionView";
import { boardColumnOf, entriesOfCollection, numberFieldChange, sameEntries, shareStructure } from "@/components/editor/collection/collectionData";

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

describe("a board's columns", () => {
  const options = [{ id: "opt-todo" }, { id: "opt-doing" }];
  test("a row whose option is gone goes with the rows that have none, not in no column at all", () => {
    expect(boardColumnOf("opt-doing", options)).toBe("opt-doing");
    expect(boardColumnOf(undefined, options)).toBeNull();
    expect(boardColumnOf(null, options)).toBeNull();
    // The option was deleted (or, before renames kept their ids, renamed): the card used to vanish.
    expect(boardColumnOf("opt-deleted", options)).toBeNull();
    const cards = [{ title: "a", status: "opt-todo" }, { title: "b", status: "opt-deleted" }, { title: "c", status: undefined }];
    const columns = [...options.map((o) => o.id as string | null), null];
    const placed = columns.map((id) => cards.filter((r) => boardColumnOf(r.status, options) === id).map((r) => r.title));
    expect(placed).toEqual([["a"], [], ["b", "c"]]);
    expect(placed.flat().length).toBe(cards.length);
  });
});

describe("leaving a number field", () => {
  test("text the browser can't read as a number keeps the number there was", () => {
    // What a number field reports for "1 500", "12-" or letters is an empty text and badInput.
    expect(numberFieldChange("", 1200, true)).toBe("unread");
    expect(numberFieldChange("abc", 1200, false)).toBe("unread");
    // Really emptied: the number is cleared.
    expect(numberFieldChange("", 1200, false)).toEqual({ value: null });
    expect(numberFieldChange("1500", 1200, false)).toEqual({ value: 1500 });
    expect(numberFieldChange(" 12.5 ", undefined, false)).toEqual({ value: 12.5 });
    // Nothing changed: nothing is saved.
    expect(numberFieldChange("1200", 1200, false)).toBeNull();
    expect(numberFieldChange("", undefined, false)).toBeNull();
  });
});

describe("a collection worked out again only when it changed", () => {
  const entry = (collectionId: string | undefined, n: number) => ({ id: `e${n}`, args: collectionId ? { collectionId } : { folderId: "f" } });
  test("waiting changes for other things are none of a collection's", () => {
    const mine = [entry("A", 1), entry("A", 3)];
    const before = entriesOfCollection([mine[0]!, entry("B", 2), mine[1]!], "A");
    expect(before).toEqual(mine);
    // A comment, a folder or another collection's value queued, sent or removed: the same entries as before,
    // so nothing that depends on them is worked out again.
    const after = entriesOfCollection([mine[0]!, entry(undefined, 4), mine[1]!, entry("B", 5)], "A");
    expect(sameEntries(before, after)).toBe(true);
    expect(sameEntries(before, entriesOfCollection([mine[0]!], "A"))).toBe(false);
    // None of its own: always the same empty list.
    expect(entriesOfCollection([entry("B", 1)], "A")).toBe(entriesOfCollection([entry(undefined, 2)], "A"));
    expect(entriesOfCollection(mine, null)).toEqual([]);
  });

  test("an answer that says the same as the last keeps the last one's objects, part by part", () => {
    const answer = (pages: number) => ({
      name: "Books",
      properties: [{ id: "pages", name: "Pages", type: "number", options: [] }],
      rows: [
        { id: "r1", title: "Dune", values: { pages: 412, tags: ["t1"], sum: { kind: "number", value: 412, display: "412" } } },
        { id: "r2", title: "Middlemarch", values: { pages } },
      ],
    });
    const first = answer(880);
    // The server's next answer: all new objects, saying the same.
    expect(shareStructure(first, answer(880))).toBe(first);
    // One value changed: that row is new, the other row and the properties are the objects they were.
    const next = shareStructure(first, answer(900));
    expect(next).toEqual(answer(900));
    expect(next).not.toBe(first);
    expect(next.rows[0]).toBe(first.rows[0]);
    expect(next.rows[1]).not.toBe(first.rows[1]);
    expect(next.properties).toBe(first.properties);
    // A row added, a key removed: nothing is taken for the same when it isn't.
    const more = shareStructure(first, { ...answer(880), rows: [...answer(880).rows, { id: "r3", title: "", values: {} }] });
    expect(more.rows.length).toBe(3);
    expect(more.rows[1]).toBe(first.rows[1]);
    expect(shareStructure({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 });
    expect(shareStructure({ a: 1 }, { a: 1, b: undefined })).toEqual({ a: 1, b: undefined });
    expect(shareStructure(undefined, first)).toBe(first);
  });
});
