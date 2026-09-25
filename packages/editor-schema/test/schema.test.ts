import { describe, expect, it } from "vitest";
import golden from "../fixtures/document-golden.json";
import {
  BLOCK_TYPES,
  canonicalJson,
  migrateWireBlock,
  parseBlock,
  serializeBlock,
  validateWireBlock,
  type WireBlock,
} from "../src";

const blocks = golden.blocks as unknown as WireBlock[];

describe("canonical schema", () => {
  it("golden fixture covers every known block type", () => {
    const types = new Set(blocks.map((b) => b.type));
    for (const t of BLOCK_TYPES) expect(types.has(t)).toBe(true);
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
});
