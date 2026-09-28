import { describe, expect, test } from "vitest";
import { SCHEMA_VERSION, ulid, validateWireBlock, type WireBlock } from "../src";

const block = (type: string, props: Record<string, unknown>, text = [{ type: "text", text: "Hello" }]): WireBlock =>
  ({ id: ulid(), type, parentId: null, rank: "V", schemaVersion: SCHEMA_VERSION, text, props }) as WireBlock;

describe("Format panel block props", () => {
  test("text blocks accept decoration, colour, alignment, font and card group", () => {
    const fmt = { decoration: "focus", color: "blue", align: "center", font: "rounded", group: "card" };
    for (const [type, base] of [
      ["paragraph", {}],
      ["heading", { level: 2 }],
      ["bulleted", {}],
      ["numbered", {}],
      ["todo", { checked: false }],
      ["toggle", { collapsed: false }],
      ["quote", {}],
    ] as const) {
      expect(validateWireBlock(block(type, { ...base, ...fmt })), type).toEqual([]);
    }
  });

  test("paragraphs take a text style (Strong / Caption)", () => {
    expect(validateWireBlock(block("paragraph", { textStyle: "strong" }))).toEqual([]);
    expect(validateWireBlock(block("paragraph", { textStyle: "caption" }))).toEqual([]);
    expect(validateWireBlock(block("heading", { level: 1, textStyle: "strong" })).map((i) => i.code)).toContain("unexpected");
  });

  test("unknown values are rejected", () => {
    const codes = (props: Record<string, unknown>) => validateWireBlock(block("paragraph", props)).map((i) => i.code);
    expect(codes({ decoration: "glow" })).not.toEqual([]);
    expect(codes({ color: "#ff0000" })).not.toEqual([]);
    expect(codes({ align: "middle" })).not.toEqual([]);
    expect(codes({ font: "comic" })).not.toEqual([]);
    expect(codes({ group: "folder" })).not.toEqual([]);
  });

  test("callouts and code blocks don't take block styling", () => {
    expect(validateWireBlock(block("callout", { tone: "note", color: "red" })).map((i) => i.code)).toContain("unexpected");
  });
});
