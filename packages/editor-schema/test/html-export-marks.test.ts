import { describe, expect, it } from "vitest";
import { blocksToHtml, type WireBlock } from "../src";

// A colour or highlight mark's value becomes a class name in the exported HTML. A Standard note's marks are
// checked by the server; an end-to-end encrypted note's are whatever its writer sealed, so the export itself
// must only ever write the colours Folevi has.
const block = (text: unknown, extra: Partial<WireBlock> = {}): WireBlock => ({ id: "b1", type: "paragraph", parentId: null, rank: "a", schemaVersion: 1, text: text as WireBlock["text"], props: {}, ...extra });
const HOSTILE = 'x"><img src=x onerror=alert(origin)>';

describe("HTML export: colour and highlight marks", () => {
  it("writes the class for a colour Folevi has", () => {
    const html = blocksToHtml([block([{ type: "text", text: "hi", marks: [{ type: "color", value: "moss" }, { type: "highlight", value: "yellow" }] }])], { title: "T" });
    expect(html).toContain('<span class="text-moss">hi</span>');
    expect(html).toContain('<mark class="highlight-yellow">');
  });

  it("leaves out a colour mark whose value is anything else, and keeps the words", () => {
    const html = blocksToHtml([block([{ type: "text", text: "words", marks: [{ type: "color", value: HOSTILE }] }])], { title: "T" });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("text-x");
    expect(html).toContain("<p>words</p>");
  });

  it("leaves out a highlight mark whose value is anything else", () => {
    const html = blocksToHtml([block([{ type: "text", text: "words", marks: [{ type: "highlight", value: HOSTILE }] }])], { title: "T" });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<mark");
    expect(html).toContain("<p>words</p>");
  });

  it("does the same inside a table cell", () => {
    const rows = [[[{ type: "text", text: "cell", marks: [{ type: "color", value: HOSTILE }, { type: "highlight", value: 7 }] }]]];
    const html = blocksToHtml([block([], { type: "table", props: { rows, headerRow: false } })], { title: "T" });
    expect(html).not.toContain("<img");
    expect(html).toContain("<td>cell</td>");
  });

  it("keeps a heading's tag a real one whatever its level says", () => {
    for (const level of [-5, 2.5, 99, "x"]) {
      const html = blocksToHtml([block([{ type: "text", text: "h" }], { type: "heading", props: { level } })], { title: "T" });
      expect(html).toMatch(/<h[234]>h<\/h[234]>/);
    }
  });
});
