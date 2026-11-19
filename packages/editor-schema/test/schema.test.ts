import { describe, expect, it } from "vitest";
import golden from "../fixtures/document-golden.json";
import {
  BLOCK_TYPES,
  LIMITS,
  MAX_BLOCK_BYTES,
  SPEC,
  TABLE_LIMITS,
  canonicalJson,
  jsonBytes,
  migrateWireBlock,
  parseBlock,
  repairWireBlock,
  serializeBlock,
  tableDataBytes,
  utf8Length,
  validateWireBlock,
  type WireBlock,
} from "../src";

const blocks = golden.blocks as unknown as WireBlock[];

describe("canonical schema", () => {
  it("golden fixture covers every known block type", () => {
    const types = new Set(blocks.map((b) => b.type));
    // The fixture is shared with the native apps' tests; web-only blocks (not yet in the Swift schema) are
    // covered by their own tests (flowchart.test.ts).
    const webOnly = (t: string) => Boolean((SPEC.blocks as Record<string, { webOnly?: boolean }>)[t]?.webOnly);
    for (const t of BLOCK_TYPES) if (!webOnly(t)) expect(types.has(t), t).toBe(true);
  });

  it("every known golden block validates", () => {
    for (const b of blocks.filter((x) => x.schemaVersion === 1)) {
      expect(validateWireBlock(b), b.type).toEqual([]);
    }
  });

  it("round-trips every block, including unknown future types, without loss", () => {
    for (const b of blocks) {
      const parsed = parseBlock(b);
      if (b.type === "timeline") expect(parsed.type).toBe("unknown");
      expect(canonicalJson(serializeBlock(parsed))).toBe(canonicalJson(b));
    }
  });

  it("rejects malformed blocks with stable codes", () => {
    const base = blocks[1]!;
    expect(validateWireBlock({ ...base, id: "has space" })[0]?.code).toBe("id");
    expect(validateWireBlock({ ...base, rank: "a0" })[0]?.code).toBe("rank");
    expect(validateWireBlock({ ...base, parentId: base.id })[0]?.code).toBe("cycle");
    expect(validateWireBlock({ ...base, type: "heading", props: { level: 4 } })[0]?.code).toBe("enum");
    expect(validateWireBlock({ ...base, props: { extra: 1 } })[0]?.code).toBe("unexpected");
    expect(validateWireBlock({ ...base, type: "made_up", schemaVersion: 1 })[0]?.code).toBe("unknown_type");
    expect(validateWireBlock({ ...base, text: [{ type: "text", text: "x", marks: [{ type: "link", href: "javascript:alert(1)" }] }] })[0]?.code).toBe(
      "href",
    );
    expect(validateWireBlock({ ...base, type: "divider", props: {} })[0]?.code).toBe("unexpected");
    expect(
      validateWireBlock({ ...base, type: "todo", props: { checked: false, dueTime: "09:00" } }).map((i) => i.code),
    ).toContain("format");
    expect(validateWireBlock({ ...base, type: "code", text: [], props: { language: "cobol", code: "" } })[0]?.code).toBe("enum");
    expect(
      validateWireBlock({ ...base, type: "table", text: [], props: { headerRow: false, rows: [[[]], [[], []]] } })[0]?.code,
    ).toBe("shape");
  });

  it("migrates pre-release v0 blocks", () => {
    const v0 = { id: "a1", type: "h2", parentId: null, rank: "V", schemaVersion: 0, text: "Title", props: {} } as unknown as WireBlock;
    const m = migrateWireBlock(v0);
    expect(m).toMatchObject({ type: "heading", schemaVersion: 1, props: { level: 2 }, text: [{ type: "text", text: "Title" }] });
    const todo = migrateWireBlock({ ...v0, type: "checklist", props: { done: true } } as unknown as WireBlock);
    expect(todo).toMatchObject({ type: "todo", props: { checked: true } });
    expect(validateWireBlock(todo)).toEqual([]);
  });

  // A block the backend cannot store (its document is at most 1 MiB) used to fail the whole batch it was
  // sent in, with no code, for ever. It is now refused on its own.
  describe("size limits", () => {
    const base = blocks[1]!;
    const table = (rows: unknown, props: Record<string, unknown> = {}) => ({ ...base, type: "table", text: [], props: { headerRow: false, rows, ...props } });
    const grid = (height: number, width: number, cell: string) => Array.from({ length: height }, () => Array.from({ length: width }, () => [{ type: "text", text: cell }]));

    it("counts bytes as the backend does", () => {
      for (const text of ["", "plain", "é", "日本語のセル", "😀 and \ud83d alone", "half \ud83d日", "mixed é 日本 😀"]) expect(utf8Length(text)).toBe(new TextEncoder().encode(text).length);
      expect(jsonBytes({ a: "日" })).toBe(new TextEncoder().encode('{"a":"日"}').length);
    });

    it("the limits sit above anything that can be stored today, and the editor's below those", () => {
      expect(MAX_BLOCK_BYTES).toBeLessThan(1024 * 1024);
      expect(TABLE_LIMITS.maxDataBytes).toBeLessThan(MAX_BLOCK_BYTES);
      expect(TABLE_LIMITS.dataBytes).toBeLessThan(TABLE_LIMITS.maxDataBytes);
      expect(TABLE_LIMITS.cellLength).toBe(LIMITS.maxTextLength);
      expect(TABLE_LIMITS.maxCellLength).toBeGreaterThanOrEqual(LIMITS.maxCodeLength);
    });

    it("a table too large to store is refused with a code: too_long on its rows", () => {
      // The audit's case: every cell of the largest table holding 300 characters, 1.3 MB of JSON.
      const big = table(grid(LIMITS.maxTableRows, LIMITS.maxTableColumns, "x".repeat(300)));
      expect(tableDataBytes(big.props.rows)).toBeGreaterThan(1_000_000);
      expect(validateWireBlock(big)).toEqual([{ path: "props.rows", code: "too_long", message: "table too large" }]);
      // Characters that take three bytes each: far fewer of them fill it.
      const wide = table(grid(LIMITS.maxTableRows, LIMITS.maxTableColumns, "表".repeat(70)));
      expect(JSON.stringify(wide.props.rows).length).toBeLessThan(TABLE_LIMITS.maxDataBytes);
      expect(validateWireBlock(wide)[0]).toMatchObject({ path: "props.rows", code: "too_long" });
      // Repair doesn't cut what someone wrote: the table is left as it is, with the issue.
      const repaired = repairWireBlock(big as unknown as WireBlock);
      expect(repaired.repaired).toBe(false);
      expect(repaired.issues[0]?.code).toBe("too_long");
    });

    it("a cell's text has a limit of its own", () => {
      const half = "y".repeat(TABLE_LIMITS.maxCellLength / 2 + 1);
      const cell = [{ type: "text", text: half }, { type: "text", text: half, marks: [{ type: "bold" }] }];
      expect(validateWireBlock(table([[cell, []]]))).toEqual([{ path: "props.rows[0][0]", code: "too_long", message: "cell text too long" }]);
      expect(validateWireBlock(table([[[{ type: "text", text: "y".repeat(TABLE_LIMITS.maxCellLength) }], []]]))).toEqual([]);
    });

    it("tables as large as the editor lets them grow, and a good deal larger, are still valid", () => {
      // A full table of 90-character cells is about the editor's limit; twice that is still stored.
      expect(validateWireBlock(table(grid(LIMITS.maxTableRows, LIMITS.maxTableColumns, "x".repeat(90))))).toEqual([]);
      const large = table(grid(LIMITS.maxTableRows, LIMITS.maxTableColumns, "x".repeat(170)));
      expect(tableDataBytes(large.props.rows)).toBeGreaterThan(TABLE_LIMITS.dataBytes);
      expect(validateWireBlock(large)).toEqual([]);
    });

    it("any block too large to store is refused with a code, a newer app's block included", () => {
      const marks = [{ type: "bold" }, { type: "italic" }, { type: "underline" }, { type: "strike" }, { type: "highlight", value: "yellow" }];
      const text = Array.from({ length: 12_000 }, (_, i) => ({ type: "text", text: "a", marks: i % 2 ? marks : marks.slice(1) }));
      const heavy = { ...base, type: "paragraph", props: {}, text };
      expect(jsonBytes(heavy)).toBeGreaterThan(MAX_BLOCK_BYTES);
      expect(validateWireBlock(heavy)).toEqual([{ path: "", code: "too_long", message: "block too large" }]);
      const future = { ...base, type: "hologram", schemaVersion: 99, props: { data: "z".repeat(MAX_BLOCK_BYTES) } };
      expect(validateWireBlock(future)).toEqual([{ path: "", code: "too_long", message: "block too large" }]);
      expect(validateWireBlock({ ...future, props: { data: "z".repeat(1000) } })).toEqual([]);
      // The largest drawing a whiteboard may hold is well inside it.
      expect(LIMITS.maxFlowchartDataLength * 2).toBeLessThan(MAX_BLOCK_BYTES);
    });
  });
});
