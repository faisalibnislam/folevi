import { describe, expect, test } from "vitest";
import { SCHEMA_VERSION, type WireBlock } from "@folevi/editor-schema";
import { diffVersions, diffWords } from "@/lib/history/diff";

const block = (id: string, text: string, extra: Partial<WireBlock> = {}): WireBlock => ({
  id,
  type: "paragraph",
  parentId: null,
  rank: id,
  schemaVersion: SCHEMA_VERSION,
  text: text ? [{ type: "text", text }] : [],
  props: {},
  ...extra,
});

describe("diffWords", () => {
  test("marks the words that changed, keeping the rest", () => {
    expect(diffWords("The quick brown fox", "The slow brown fox jumps")).toEqual([
      { kind: "same", text: "The " },
      { kind: "removed", text: "quick" },
      { kind: "added", text: "slow" },
      { kind: "same", text: " brown fox" },
      { kind: "added", text: " jumps" },
    ]);
  });

  test("handles empty sides and unchanged text", () => {
    expect(diffWords("", "New line")).toEqual([{ kind: "added", text: "New line" }]);
    expect(diffWords("Gone", "")).toEqual([{ kind: "removed", text: "Gone" }]);
    expect(diffWords("Same", "Same")).toEqual([{ kind: "same", text: "Same" }]);
  });

  test("works on any script and keeps every character", () => {
    const parts = diffWords("Café au lait, s’il vous plaît", "Café noir, s’il vous plaît");
    expect(parts.filter((p) => p.kind !== "removed").map((p) => p.text).join("")).toBe("Café noir, s’il vous plaît");
    expect(parts.filter((p) => p.kind !== "added").map((p) => p.text).join("")).toBe("Café au lait, s’il vous plaît");
  });

  test("a very long rewrite is shown replaced whole rather than diffed word by word", () => {
    const a = Array.from({ length: 800 }, (_, i) => `a${i}`).join(" ");
    const b = Array.from({ length: 800 }, (_, i) => `b${i}`).join(" ");
    expect(diffWords(a, b).map((p) => p.kind)).toEqual(["removed", "added"]);
  });
});

describe("diffVersions", () => {
  test("added, edited, restyled and removed blocks, each with its author; moves are not changes", () => {
    const before = [block("a", "Keep me"), block("b", "Edit me"), block("c", "Style me"), block("d", "Delete me"), block("e", "Move me", { rank: "e" })];
    const after = [block("a", "Keep me"), block("b", "Edited me"), block("c", "Style me", { type: "heading", props: { level: 2 } }), block("f", "New"), block("e", "Move me", { rank: "0" })];
    const diff = diffVersions(
      before,
      after,
      [
        ["b", "ann", 2],
        ["c", "ben", 3],
        ["f", "ann", 4],
        ["a", "ann", 1],
        ["e", "ben", 5],
      ],
      [["d", "ben", 6]],
    );
    expect(diff.changes.get("a")).toBeUndefined();
    expect(diff.changes.get("e")).toBeUndefined();
    expect(diff.changes.get("b")).toMatchObject({ kind: "edited", author: "ann", at: 2 });
    expect(diff.changes.get("b")!.parts!.map((p) => p.kind)).toEqual(["removed", "added", "same"]);
    expect(diff.changes.get("c")).toEqual({ kind: "styled", author: "ben", at: 3 });
    expect(diff.changes.get("f")).toEqual({ kind: "added", author: "ann", at: 4 });
    expect(diff.changes.get("d")).toEqual({ kind: "removed", author: "ben", at: 6 });
    // The removed block is kept in the page, where it was.
    expect(diff.blocks.map((b) => b.id)).toContain("d");
    // Ann and Ben made two changes each: both listed.
    expect(diff.authors.sort()).toEqual(["ann", "ben"]);
  });

  test("the first version marks nothing; versions without attribution show changes without an author", () => {
    const blocks = [block("a", "Hello")];
    expect(diffVersions(null, blocks, null, null).changes.size).toBe(0);
    const diff = diffVersions([block("a", "Hi")], blocks, null, null);
    expect(diff.changes.get("a")).toMatchObject({ kind: "edited", author: null });
    expect(diff.authors).toEqual([]);
  });

  test("opening a toggle isn't a change; code, formulas and tables that changed read as edited", () => {
    const toggle = (collapsed: boolean) => block("t", "Details", { type: "toggle", props: { collapsed } });
    const code = (text: string) => block("c", "", { type: "code", props: { language: "js", code: text } });
    const table = (cell: string) => block("x", "", { type: "table", props: { rows: [[[{ type: "text", text: cell }]]] } });
    const diff = diffVersions([toggle(true), code("a()"), table("one")], [toggle(false), code("b()"), table("two")], null, null);
    expect(diff.changes.get("t")).toBeUndefined();
    expect(diff.changes.get("c")).toEqual({ kind: "edited", author: null, at: null });
    expect(diff.changes.get("x")).toEqual({ kind: "edited", author: null, at: null });
  });
});
