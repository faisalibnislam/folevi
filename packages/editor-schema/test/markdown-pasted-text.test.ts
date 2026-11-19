// Markdown read from pasted text (the editor's paste, apps/web paste.ts): a "---" first line, tabs inside
// text, and code longer than a code block holds.
import { describe, expect, it } from "vitest";
import { LIMITS, flattenTree, markdownToBlocks, plainText, splitCode, tableCutWarning, validateWireBlock } from "../src";

const outline = (src: string, opts: Parameters<typeof markdownToBlocks>[1] = {}) =>
  flattenTree(markdownToBlocks(src, { titleFromHeading: false, ...opts }).blocks).map((e) => `${"  ".repeat(e.depth)}${e.block.type}:${plainText(e.block.text)}`);

describe("front matter", () => {
  const text = "---\nFoo bar\n- item\n---\nAfter";

  it("frontMatter: false reads a --- first line as a divider and keeps what follows it", () => {
    expect(outline(text, { frontMatter: false, lineBreaks: true })).toEqual(["divider:", "paragraph:Foo bar", "bulleted:item", "divider:", "paragraph:After"]);
    const read = markdownToBlocks("---\ntitle: Plan\n---\nBody", { frontMatter: false });
    expect(read.title).toBeNull();
    expect(read.frontMatter).toEqual({});
    expect(read.warnings).toEqual([]);
  });

  it("a file's front matter is still read by default", () => {
    const read = markdownToBlocks("---\ntitle: Plan\ntags: a\n---\nBody");
    expect(read.title).toBe("Plan");
    expect(read.frontMatter).toEqual({ title: "Plan", tags: "a" });
    expect(read.blocks.map((b) => plainText(b.text))).toEqual(["Body"]);
    expect(outline(text)).toEqual(["paragraph:After"]);
  });
});

describe("tabs", () => {
  it("a tab inside a line's text stays a tab", () => {
    expect(outline("- item\twith tab\n\nName:\tAnn")).toEqual(["bulleted:item\twith tab", "paragraph:Name:\tAnn"]);
  });

  it("a tab that indents still counts as four spaces", () => {
    expect(outline("- one\n\t- two\n\t\t- three\n- four")).toEqual(["bulleted:one", "  bulleted:two", "    bulleted:three", "bulleted:four"]);
  });
});

describe("code over a code block's length", () => {
  it("splitCode cuts at line breaks, loses nothing but the break it cut at, and leaves short code alone", () => {
    expect(splitCode("abc", 10)).toEqual(["abc"]);
    expect(splitCode("aaaa\nbbbb\ncccc", 10)).toEqual(["aaaa\nbbbb", "cccc"]);
    expect(splitCode("abcdefghijkl", 5)).toEqual(["abcde", "fghij", "kl"]);
    // Never between the two halves of an emoji.
    expect(splitCode("abcd😀efg", 5)).toEqual(["abcd", "😀efg"]);
    const code = Array.from({ length: 30000 }, (_, i) => `line ${i}`).join("\n");
    const parts = splitCode(code, LIMITS.maxCodeLength);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= LIMITS.maxCodeLength)).toBe(true);
    expect(parts.join("\n")).toBe(code);
  });

  it("a fence over the limit continues in more code blocks the schema accepts, under the same list item", () => {
    const code = Array.from({ length: 30000 }, (_, i) => `line ${i}`).join("\n");
    const blocks = flattenTree(markdownToBlocks("- item\n  ```python\n" + code.replace(/^/gm, "  ") + "\n  ```\nafter", { titleFromHeading: false }).blocks);
    const codes = blocks.filter((e) => e.block.type === "code");
    expect(codes.length).toBeGreaterThan(1);
    for (const e of codes) {
      expect(e.depth).toBe(1);
      expect((e.block.props as { language: string }).language).toBe("python");
      expect(validateWireBlock(e.block)).toEqual([]);
    }
    expect(codes.map((e) => (e.block.props as { code: string }).code).join("\n")).toBe(code);
    expect(blocks[blocks.length - 1]!.block.type).toBe("paragraph");
  });
});

describe("a table larger than the schema allows", () => {
  it("warns with tableCutWarning, which a paste reads to say so", () => {
    const rows = Array.from({ length: LIMITS.maxTableRows + 3 }, (_, i) => `| ${i} | x |`).join("\n");
    const read = markdownToBlocks(`| a | b |\n| --- | --- |\n${rows}`);
    expect(read.warnings.map((w) => w.message)).toEqual([tableCutWarning()]);
    expect(tableCutWarning()).toBe("A table was cut to 200 rows and 20 columns");
  });
});
