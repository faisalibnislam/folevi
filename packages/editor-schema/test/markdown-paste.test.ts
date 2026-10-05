import { describe, expect, it } from "vitest";
import { LIMITS, SCHEMA_VERSION, blocksToMarkdown, markdownToBlocks, plainText, rankSequence, sanitizeHref, splitInline, validateWireBlock } from "../src";
import type { InlineNode, WireBlock } from "../src";

let n = 0;
const newId = () => `id${String(++n).padStart(4, "0")}`;
const block = (type: string, text: InlineNode[], props: Record<string, unknown> = {}, parentId: string | null = null): WireBlock => ({
  id: newId(),
  type,
  parentId,
  rank: rankSequence(1)[0]!,
  schemaVersion: SCHEMA_VERSION,
  text,
  props,
});
const md = (src: string, lineBreaks = false) => markdownToBlocks(src, { newId, titleFromHeading: false, lineBreaks });
const roundTrip = (blocks: WireBlock[]) => md(blocksToMarkdown(blocks)).blocks;

describe("links to another host", () => {
  it("rejects two leading slashes or backslashes in any mix", () => {
    for (const href of ["//evil.com", "/\\evil.com", "\\/evil.com", "\\\\evil.com", "/\t/evil.com"]) expect(sanitizeHref(href)).toBeNull();
    expect(sanitizeHref("/docs/a")).toBe("/docs/a");
    expect(sanitizeHref("#top")).toBe("#top");
  });
});

describe("limits", () => {
  it("splitInline cuts long text at spaces, keeping marks", () => {
    const word = "abcd ";
    const long = word.repeat(9000);
    const parts = splitInline([{ type: "text", text: long, marks: [{ type: "bold" }] }], LIMITS.maxTextLength);
    expect(parts.length).toBe(3);
    for (const p of parts) {
      expect(plainText(p).length).toBeLessThanOrEqual(LIMITS.maxTextLength);
      expect(p[0]).toMatchObject({ marks: [{ type: "bold" }] });
    }
    expect(parts.map(plainText).join(" ")).toBe(long);
    expect(splitInline([{ type: "text", text: "x".repeat(25) }], 10).map(plainText)).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
  });

  it("a paragraph over the text limit becomes several valid paragraphs", () => {
    const { blocks } = md("word ".repeat(5000));
    expect(blocks.length).toBe(2);
    for (const b of blocks) expect(validateWireBlock(b)).toEqual([]);
  });

  it("a Markdown table is cut to the allowed rows and columns", () => {
    const cols = 25;
    const row = (v: string) => `| ${Array.from({ length: cols }, () => v).join(" | ")} |`;
    const src = [row("h"), `|${" --- |".repeat(cols)}`, ...Array.from({ length: 210 }, () => row("c")), "", "after"].join("\n");
    const { blocks, warnings } = md(src);
    const table = blocks[0]!;
    const rows = table.props.rows as unknown[][];
    expect(rows.length).toBe(LIMITS.maxTableRows);
    expect(rows[0]!.length).toBe(LIMITS.maxTableColumns);
    expect(validateWireBlock(table)).toEqual([]);
    expect(blocks.map((b) => b.type)).toEqual(["table", "paragraph"]);
    expect(warnings.some((w) => /cut/.test(w.message))).toBe(true);
  });
});

describe("blocks inside list items", () => {
  it("a fence under a numbered item nests under it, without the item's indent", () => {
    const { blocks } = md("1. Step\n\n   ```bash\n   npm i\n     --save\n   ```\n2. Step two");
    expect(blocks.map((b) => b.type)).toEqual(["numbered", "code", "numbered"]);
    expect(blocks[1]!.parentId).toBe(blocks[0]!.id);
    expect(blocks[1]!.props).toMatchObject({ language: "bash", code: "npm i\n  --save" });
    expect(blocks[2]!.parentId).toBeNull();
  });

  it("a fence at the margin ends the list", () => {
    const { blocks } = md("- a\n\n```\nx\n```\n  - b");
    expect(blocks.map((b) => b.parentId)).toEqual([null, null, null]);
  });

  it("a table and a formula under an item nest under it", () => {
    const { blocks } = md("- a\n  | x | y |\n  | --- | --- |\n  | 1 | 2 |\n  $$x^2$$");
    expect(blocks.map((b) => b.type)).toEqual(["bulleted", "table", "formula"]);
    expect(blocks.slice(1).every((b) => b.parentId === blocks[0]!.id)).toBe(true);
  });
});

describe("line breaks", () => {
  it("two trailing spaces are a line break, and don't leak at the end", () => {
    const [b] = md("first  \nsecond  ").blocks;
    expect(plainText(b!.text)).toBe("first\nsecond");
  });

  it("with lineBreaks, single newlines inside a paragraph stay breaks", () => {
    const { blocks } = md("Dear John,\nHere are the items:\n- a", true);
    expect(blocks.map((b) => [b.type, plainText(b.text)])).toEqual([
      ["paragraph", "Dear John,\nHere are the items:"],
      ["bulleted", "a"],
    ]);
    expect(plainText(md("one\ntwo").blocks[0]!.text)).toBe("one two");
  });
});

describe("Markdown export round trip", () => {
  const link = (href: string, text = "x"): InlineNode => ({ type: "text", text, marks: [{ type: "link", href }] });

  it("links with parentheses or spaces keep their whole target", () => {
    const href = "https://en.wikipedia.org/wiki/Foo_(bar)";
    const out = blocksToMarkdown([block("paragraph", [link(href)])]);
    expect(out).toContain(`(<${href}>)`);
    expect(roundTrip([block("paragraph", [link(href)])])[0]!.text).toEqual([link(href)]);
    // A bare target with balanced parentheses, as other apps write it.
    expect(md(`[x](${href})`).blocks[0]!.text).toEqual([link(href)]);
  });

  it("image paths with parentheses are encoded", () => {
    const out = blocksToMarkdown([block("image", [], { url: "https://a.com/photo (1).png", alt: "a [b] c_d", caption: "" })]);
    expect(out).toContain("(https://a.com/photo%20%281%29.png)");
    const [img] = md(out).blocks;
    expect(img!.props).toMatchObject({ url: "https://a.com/photo%20%281%29.png", alt: "a [b] c_d" });
  });

  it("code that is also a link keeps the link", () => {
    const node: InlineNode = { type: "text", text: "npm", marks: [{ type: "code" }, { type: "link", href: "https://npmjs.com" }] };
    expect(blocksToMarkdown([block("paragraph", [node])])).toContain("[`npm`](https://npmjs.com)");
    expect(roundTrip([block("paragraph", [node])])[0]!.text).toEqual([node]);
  });

  it("paragraphs that look like other blocks stay paragraphs", () => {
    for (const text of ["- not a list", "+ plus", "1. not numbered", "2) nor this", "---", "~~not struck~~", "~~~", "$$x$$", "a\n- second line"]) {
      const [b, ...rest] = roundTrip([block("paragraph", [{ type: "text", text }])]);
      expect(rest).toEqual([]);
      expect([b!.type, plainText(b!.text)]).toEqual(["paragraph", text]);
      expect(b!.text.every((t) => t.type !== "text" || !t.marks)).toBe(true);
    }
  });

  it("mid-word italic is written with asterisks", () => {
    const text: InlineNode[] = [
      { type: "text", text: "un" },
      { type: "text", text: "believ", marks: [{ type: "italic" }] },
      { type: "text", text: "able" },
    ];
    expect(blocksToMarkdown([block("paragraph", text)])).toBe("un*believ*able\n");
    expect(roundTrip([block("paragraph", text)])[0]!.text).toEqual(text);
    const both: InlineNode[] = [{ type: "text", text: "a" }, { type: "text", text: "b", marks: [{ type: "bold" }, { type: "italic" }] }];
    expect(roundTrip([block("paragraph", both)])[0]!.text).toEqual(both);
  });

  it("link text with brackets imports as a link", () => {
    const node = link("https://example.com/ref", "[1]");
    expect(blocksToMarkdown([block("paragraph", [node])])).toContain("[\\[1\\]](https://example.com/ref)");
    expect(roundTrip([block("paragraph", [node])])[0]!.text).toEqual([node]);
  });
});
