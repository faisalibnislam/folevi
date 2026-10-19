// Blocks the server would refuse are repaired before they're sent, keeping what the person wrote
// (src/validate.ts repairWireBlock), so an edit isn't refused and lost.
import { describe, expect, test } from "vitest";
import { repairWireBlock, safeHref, validateWireBlock, SCHEMA_VERSION, type WireBlock } from "../src";

const block = (type: string, props: Record<string, unknown>, text: unknown[] = []): WireBlock =>
  ({ id: "01JAZ3XQ5V8K2M4N6P7R9S0T1U", type, parentId: null, rank: "V", schemaVersion: SCHEMA_VERSION, props, text }) as WireBlock;

describe("repairWireBlock", () => {
  test("a valid block comes back untouched", () => {
    const b = block("paragraph", {}, [{ type: "text", text: "hello", marks: [{ type: "link", href: "https://folevi.com" }] }]);
    const r = repairWireBlock(b);
    expect(r).toEqual({ block: b, repaired: false, issues: [] });
  });

  test("links: a bare address gets https://, anything else is unlinked, and the words stay", () => {
    const b = block("paragraph", {}, [
      { type: "text", text: "Google", marks: [{ type: "link", href: "www.google.com" }] },
      { type: "text", text: " and " },
      { type: "text", text: "call", marks: [{ type: "bold" }, { type: "link", href: "tel:+123" }] },
    ]);
    expect(validateWireBlock(b).length).toBeGreaterThan(0);
    const r = repairWireBlock(b);
    expect(r.issues).toEqual([]);
    expect(r.block.text).toEqual([
      { type: "text", text: "Google", marks: [{ type: "link", href: "https://www.google.com" }] },
      { type: "text", text: " and " },
      { type: "text", text: "call", marks: [{ type: "bold" }] },
    ]);
    expect(safeHref("example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeHref("javascript:alert(1)")).toBeNull();
  });

  test("tables: uneven rows are padded, cells' marks fixed", () => {
    const b = block("table", { headerRow: true, rows: [[[{ type: "text", text: "a" }], [{ type: "text", text: "b" }]], [[{ type: "text", text: "c", marks: [{ type: "color", value: "rainbow" }] }]]] });
    const r = repairWireBlock(b);
    expect(r.issues).toEqual([]);
    expect(r.block.props.rows).toEqual([[[{ type: "text", text: "a" }], [{ type: "text", text: "b" }]], [[{ type: "text", text: "c" }], []]]);
  });

  test("props: a heading level, a wrong optional prop and an unknown one", () => {
    const r = repairWireBlock(block("heading", { level: 5, color: "magenta", sparkle: true }, [{ type: "text", text: "Title" }]));
    expect(r.issues).toEqual([]);
    expect(r.block.props).toEqual({ level: 3 });
    const todo = repairWireBlock(block("todo", { checked: "yes", dueDate: "tomorrow", dueTime: "09:00" }, [{ type: "text", text: "Do it" }]));
    expect(todo.issues).toEqual([]);
    expect(todo.block.props).toEqual({ checked: false });
  });

  test("what can't be repaired without losing words is left, and said", () => {
    const r = repairWireBlock(block("paragraph", {}, [{ type: "text", text: "x".repeat(20_001) }]));
    expect(r.issues.map((i) => i.code)).toEqual(["too_long"]);
  });

  test("a block type from a newer app is never changed", () => {
    const b = { ...block("hologram", { beam: 1 }), schemaVersion: SCHEMA_VERSION + 1 };
    expect(repairWireBlock(b).block).toBe(b);
  });
});
