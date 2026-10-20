// Columns (src/columns.ts): a `columns` row holding `column` blocks that hold the column's blocks. The
// server's checks, the readers, the repairs the editor runs after an edit, and the exports.
import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  LIMITS,
  blocksToHtml,
  blocksToMarkdown,
  columnGroupAt,
  columnShares,
  columnsFromFence,
  columnsIssues,
  documentSearchText,
  flattenTree,
  liftColumns,
  markdownToBlocks,
  repairColumnLines,
  repairWireBlock,
  validateWireBlock,
  type ColumnLine,
  type WireBlock,
} from "../src";

let n = 0;
const id = () => `01JACOLS0000000000000000${String(++n).padStart(2, "0")}`;
function b(type: string, parentId: string | null, rank: string, text = "", props: Record<string, unknown> = {}): WireBlock {
  return { id: id(), type, parentId, rank, schemaVersion: 1, text: text ? [{ type: "text", text }] : [], props };
}

/** A note: an intro, a row of two columns (a heading and a list on the left, a line on the right), an outro. */
function note() {
  const intro = b("paragraph", null, "A", "Intro");
  const row = b("columns", null, "B");
  const left = b("column", row.id, "A", "", { width: 0.6 });
  const heading = b("heading", left.id, "A", "Plan", { level: 2 });
  const item = b("bulleted", left.id, "B", "Book flights");
  const sub = b("bulleted", item.id, "A", "Window seat");
  const right = b("column", row.id, "B", "", { width: 0.4 });
  const aside = b("paragraph", right.id, "A", "Budget 900");
  const outro = b("paragraph", null, "C", "After the columns");
  return { blocks: [intro, row, left, heading, item, sub, right, aside, outro], row, left, right, heading, item, sub, aside };
}

const lines = (spec: string): ColumnLine[] =>
  spec
    .trim()
    .split("\n")
    .map((l) => {
      const depth = (/^ */.exec(l)![0].length / 2) | 0;
      return { type: l.trim(), depth };
    });

/** Applies a repair to lines for reading in a test: "type@depth", new columns as "column*@depth". */
function repaired(spec: string, touched?: (s: number, e: number) => boolean): string[] | null {
  const src = lines(spec);
  const out = repairColumnLines(src, touched);
  return out && out.map((l) => (l.from === null ? `column*@${l.depth}` : `${src[l.from]!.type}@${l.depth}`));
}

describe("columns schema", () => {
  it("knows both block types and the limits", () => {
    expect(BLOCK_TYPES).toContain("columns");
    expect(BLOCK_TYPES).toContain("column");
    expect(LIMITS.maxColumns).toBe(4);
    expect(LIMITS.minColumnWidth).toBeGreaterThan(0);
  });

  it("accepts rows and columns, with or without a width", () => {
    const { row, left } = note();
    expect(validateWireBlock(row)).toEqual([]);
    expect(validateWireBlock(left)).toEqual([]);
    expect(validateWireBlock(b("column", row.id, "C"))).toEqual([]);
  });

  it("refuses a width out of range and text on either, and repairs both", () => {
    for (const width of [0, 0.01, 1.5, -1]) {
      const bad = b("column", null, "A", "", { width });
      expect(validateWireBlock(bad).map((i) => i.path)).toContain("props.width");
      const { block } = repairWireBlock(bad);
      expect(validateWireBlock(block)).toEqual([]);
      expect((block.props as { width: number }).width).toBe(width > 1 ? 1 : LIMITS.minColumnWidth);
    }
    const nan = repairWireBlock(b("column", null, "A", "", { width: Number.NaN })).block;
    expect(validateWireBlock(nan)).toEqual([]);
    const texted = { ...b("columns", null, "A"), text: [{ type: "text" as const, text: "nope" }] };
    expect(validateWireBlock(texted).length).toBeGreaterThan(0);
    expect(repairWireBlock(texted).block.text).toEqual([]);
    const stray = b("columns", null, "A", "", { widths: [1, 2] });
    expect(repairWireBlock(stray).block.props).toEqual({});
  });

  it("shares the row by widths, an equal share for a column without one", () => {
    expect(columnShares([undefined, undefined])).toEqual([0.5, 0.5]);
    expect(columnShares([0.6, 0.4])).toEqual([0.6, 0.4]);
    const s = columnShares([0.2, undefined, undefined]);
    expect(s.reduce((a, x) => a + x, 0)).toBeCloseTo(1);
    expect(s[0]).toBeLessThan(s[1]!);
    // Widths that don't add up (a column was removed) still fill the row.
    expect(columnShares([0.3, 0.3])).toEqual([0.5, 0.5]);
    expect(columnShares([5, "x", null])).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(columnShares([])).toEqual([]);
  });
});

describe("columns structure", () => {
  it("finds a row's columns and where each one's blocks are", () => {
    const { blocks, row, left, right } = note();
    const flat = flattenTree(blocks);
    const group = columnGroupAt(flat, flat.findIndex((e) => e.block.id === row.id))!;
    expect(group.columns.map((c) => c.block?.id)).toEqual([left.id, right.id]);
    expect(flat.slice(group.columns[0]!.start, group.columns[0]!.end).map((e) => plain(e.block))).toEqual(["Plan", "Book flights", "Window seat"]);
    expect(flat.slice(group.columns[1]!.start, group.columns[1]!.end).map((e) => plain(e.block))).toEqual(["Budget 900"]);
    expect(flat[group.end]!.block.id).toBe(blocks[blocks.length - 1]!.id);
    expect(columnGroupAt(flat, 0)).toBeNull();
  });

  it("lifts a column's blocks to the row's level", () => {
    const { blocks } = note();
    const lifted = liftColumns(flattenTree(blocks)).map((e) => `${e.block.type}:${e.depth}`);
    expect(lifted).toEqual(["paragraph:0", "columns:0", "column:0", "heading:0", "bulleted:0", "bulleted:1", "column:0", "paragraph:0", "paragraph:0"]);
  });

  it("reports what's out of shape", () => {
    const row = b("columns", null, "A");
    const only = b("column", row.id, "A");
    const empty = b("column", row.id, "B");
    const loose = b("column", null, "B");
    const text = b("paragraph", loose.id, "A", "x");
    const codes = columnsIssues(flattenTree([row, only, empty, loose, text])).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["empty_column", "column_outside_row"]));
    const good = note();
    expect(columnsIssues(flattenTree(good.blocks))).toEqual([]);
  });
});

describe("repairColumnLines", () => {
  it("leaves a row in shape alone", () => {
    expect(repaired("paragraph\ncolumns\n  column\n    paragraph\n  column\n    paragraph\n      bulleted\nparagraph")).toBeNull();
  });

  it("removes an empty column, and a row left with one column becomes its blocks", () => {
    expect(repaired("columns\n  column\n    paragraph\n  column\n  column\n    todo")).toEqual(["columns@0", "column@1", "paragraph@2", "column@1", "todo@2"]);
    expect(repaired("columns\n  column\n    paragraph\n      bulleted\n  column\nparagraph")).toEqual(["paragraph@0", "bulleted@1", "paragraph@0"]);
    expect(repaired("columns\n  column\n  column\nparagraph")).toEqual(["paragraph@0"]);
    expect(repaired("paragraph\ncolumns")).toEqual(["paragraph@0"]);
  });

  it("moves a block directly in a row into a column", () => {
    // After a column: into it. Before any column: a new first column.
    expect(repaired("columns\n  column\n    paragraph\n  heading\n  column\n    paragraph")).toEqual(["columns@0", "column@1", "paragraph@2", "heading@2", "column@1", "paragraph@2"]);
    expect(repaired("columns\n  heading\n  column\n    paragraph")).toEqual(["columns@0", "column*@1", "heading@2", "column@1", "paragraph@2"]);
  });

  it("keeps at most four columns, the rest joining the last", () => {
    const five = "columns\n" + "  column\n    paragraph\n".repeat(5);
    const out = repaired(five)!;
    expect(out.filter((l) => l.startsWith("column@")).length).toBe(LIMITS.maxColumns);
    expect(out.filter((l) => l.startsWith("paragraph")).length).toBe(5);
    expect(out.slice(-3)).toEqual(["column@1", "paragraph@2", "paragraph@2"]);
  });

  it("dissolves a row inside a column into its blocks", () => {
    expect(repaired("columns\n  column\n    columns\n      column\n        paragraph\n      column\n        quote\n  column\n    paragraph")).toEqual([
      "columns@0",
      "column@1",
      "paragraph@2",
      "quote@2",
      "column@1",
      "paragraph@2",
    ]);
  });

  it("removes a column outside a row, its blocks one level out", () => {
    expect(repaired("paragraph\ncolumn\n  paragraph\n    bulleted")).toEqual(["paragraph@0", "paragraph@0", "bulleted@1"]);
  });

  it("only repairs the rows an edit touched", () => {
    const spec = "columns\n  column\n    paragraph\n  column\nparagraph\ncolumns\n  column\n    paragraph\n  column";
    // Only the second row (lines 5 to 8) was edited: the first, still being filled in by someone else, stays.
    const out = repaired(spec, (s, e) => s < 9 && e > 5)!;
    expect(out).toEqual(["columns@0", "column@1", "paragraph@2", "column@1", "paragraph@0", "paragraph@0"]);
  });

  it("never drops a written block", () => {
    const specs = [
      "columns\n  paragraph\n  paragraph\n  column\n    paragraph",
      "column\n  column\n    paragraph",
      "columns\n  column\n    columns\n      paragraph\n      column\n        paragraph",
      "columns\n  columns\n    column\n      paragraph\n  column\n    paragraph",
    ];
    for (const spec of specs) {
      const src = lines(spec);
      const out = repairColumnLines(src) ?? src.map((l, i) => ({ from: i, depth: l.depth }));
      const kept = out.filter((l) => l.from !== null).map((l) => src[l.from!]!.type);
      expect(kept.filter((t) => t === "paragraph").length).toBe(src.filter((l) => l.type === "paragraph").length);
      // And the result is in shape.
      const again = out.map((l) => ({ type: l.from === null ? "column" : src[l.from]!.type, depth: l.depth }));
      expect(repairColumnLines(again)).toBeNull();
    }
  });
});

describe("columns in exports and search", () => {
  it("writes the blocks in order in Markdown", () => {
    const md = blocksToMarkdown(note().blocks);
    expect(md).toContain("Intro\n\n## Plan\n\n- Book flights\n  - Window seat\n\nBudget 900\n\nAfter the columns");
  });

  it("draws the columns side by side in HTML, each its share of the row", () => {
    const html = blocksToHtml(note().blocks, { title: "Trip" });
    expect(html.replace(/\n/g, "")).toMatch(/<div class="columns"><div class="column" style="flex:0.6 1 0"><h3>Plan<\/h3><ul><li>Book flights<ul><li>Window seat<\/li><\/ul><\/li><\/ul><\/div><div class="column" style="flex:0.4 1 0"><p>Budget 900<\/p><\/div><\/div>/);
    // In order around it, each block once.
    expect(html.indexOf("Intro")).toBeLessThan(html.indexOf('class="columns"'));
    expect(html.indexOf("After the columns")).toBeGreaterThan(html.indexOf("Budget 900"));
    expect(html.match(/Budget 900/g)).toHaveLength(1);
    // Narrow screens stack them.
    expect(html).toMatch(/@media \(max-width:640px\)\{\.columns\{display:block\}/);
  });

  it("finds what's written in columns", () => {
    expect(documentSearchText("Trip", note().blocks)).toContain("Budget 900");
  });
});

describe("columns from Markdown (Foli AI, MCP)", () => {
  it("splits a columns fence at +++ lines", () => {
    expect(columnsFromFence("a\n+++\nb")).toEqual(["a", "b"]);
    expect(columnsFromFence("only one")).toBeNull();
    expect(columnsFromFence("a\n+++\n\n+++\nb")).toEqual(["a", "b"]);
    const five = columnsFromFence("1\n+++\n2\n+++\n3\n+++\n4\n+++\n5")!;
    expect(five).toHaveLength(4);
    expect(five[3]).toContain("5");
  });

  it("imports a fence as a row of columns holding real blocks", () => {
    const { blocks } = markdownToBlocks("Before\n\n````columns\n## Left\n- one\n- two\n+++\nRight side\n\n```js\nx()\n```\n````\n\nAfter");
    const flat = flattenTree(blocks).map((e) => `${e.block.type}:${e.depth}`);
    expect(flat).toEqual(["paragraph:0", "columns:0", "column:1", "heading:2", "bulleted:2", "bulleted:2", "column:1", "paragraph:2", "code:2", "paragraph:0"]);
    for (const block of blocks) expect(validateWireBlock(block)).toEqual([]);
    expect(columnsIssues(flattenTree(blocks))).toEqual([]);
  });

  it("imports a fence with one part as plain blocks", () => {
    const { blocks } = markdownToBlocks("```columns\nJust text\n- and a list\n```");
    expect(blocks.map((x) => x.type)).toEqual(["paragraph", "bulleted"]);
  });
});

function plain(block: WireBlock): string {
  return block.text.map((t) => ("text" in t ? t.text : "")).join("");
}
