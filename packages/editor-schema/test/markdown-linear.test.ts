// Markdown reaches the parser from a paste, an imported file, an email turned into a note and connected apps: text
// nobody here wrote. No pattern in it may take more than a pass or two over a line, however the line is made.
// (The heading pattern used to be cubic in a run of spaces: about 10,000 of them froze a tab for minutes.)
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { blocksToMarkdown, markdownToBlocks, parseInlineMarkdown, plainText, type WireBlock } from "../src";

const ms = (run: () => unknown): number => {
  const t = performance.now();
  run();
  return performance.now() - t;
};
const parse = (md: string) => markdownToBlocks(md, { titleFromHeading: false, frontMatter: false }).blocks;
const shape = (md: string) => parse(md).map((b) => [b.type, plainText(b.text), JSON.stringify(b.props)]);

describe("a heading", () => {
  it("with 20,000 spaces inside it parses in well under 100 ms", () => {
    const line = `# a${" ".repeat(20_000)}b`;
    let blocks: WireBlock[] = [];
    const took = ms(() => (blocks = parse(line)));
    expect(took).toBeLessThan(100);
    // (Longer than a block's text may be, so what is over goes on in the next block, nothing lost.)
    expect(blocks[0]!.type).toBe("heading");
    const text = blocks.map((b) => plainText(b.text)).join("");
    expect(text.startsWith("a ")).toBe(true);
    expect(text.endsWith("b")).toBe(true);
    expect(text.length).toBeGreaterThan(19_000);
  });

  it("and so do the other shapes that made the old pattern try every split", () => {
    const lines = [`# a${" ".repeat(20_000)}`, `# a${" #".repeat(10_000)} b`, `# ${"#".repeat(20_000)} b`, `#${" ".repeat(20_000)}a${"#".repeat(20_000)}${" ".repeat(20_000)}b`, `   ###### ${"\t".repeat(20_000)}x`];
    for (const line of lines) expect(ms(() => parse(line))).toBeLessThan(100);
  });

  it("reads exactly what the old pattern read", () => {
    const old = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
    const now = (line: string) => {
      const h = parse(`x\n\n${line}`).find((x) => x.type === "heading");
      return h ? [(h.props as { level: number }).level, plainText(h.text)] : null;
    };
    const was = (raw: string) => {
      // (The parser counts a tab that indents as four spaces before any pattern sees the line.)
      const line = raw.replace(/^[ \t]+/, (lead) => lead.replace(/\t/g, "    "));
      const m = old.exec(line);
      return m ? [Math.min(3, m[1]!.length), plainText(parseInlineMarkdown(m[2]!))] : null;
    };
    const samples = ["# Title", "## Title ##", "### Title ###   ", "# foo#", "# foo # bar", "# a ## #", "# foo  # #  ", "####### seven", "#nospace", "#", "# ", "#  ##  ", "   # indented", "    # four spaces", "#\ttab", "# ###", "## a#b ##c"];
    for (const line of samples) expect(now(line), JSON.stringify(line)).toEqual(was(line));
    fc.assert(
      fc.property(fc.array(fc.constantFrom("#", " ", "a", "b", "\t"), { minLength: 1, maxLength: 24 }), (chars) => {
        const line = chars.join("");
        // (A line of nothing but spaces is a paragraph break.)
        if (!line.trim()) return;
        expect(now(line), JSON.stringify(line)).toEqual(was(line));
      }),
      { numRuns: 3000 },
    );
  });
});

describe("the other line patterns", () => {
  it("a table's separator row is the same rows as before, read in one pass", () => {
    const old = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
    const now = (sep: string) => parse(`a | b\n${sep}\n1 | 2`).some((b) => b.type === "table");
    const samples = ["---|---", "| --- | --- |", "|:--|--:|", " :-: | :-: ", "--|", "|--", "-- --", "--|--|x", "| - | - |", "---", "--- |   ", "|---|---|  |"];
    for (const sep of samples) expect(now(sep), sep).toBe(old.test(sep));
    fc.assert(
      fc.property(fc.array(fc.constantFrom("|", "-", "-", ":", " ", "a"), { minLength: 1, maxLength: 20 }), (chars) => {
        const sep = chars.join("");
        expect(now(sep), JSON.stringify(sep)).toBe(old.test(sep));
      }),
      { numRuns: 3000 },
    );
    expect(ms(() => parse(`a | b\n--${" ".repeat(50_000)}x\n1 | 2`))).toBeLessThan(200);
    expect(ms(() => parse(`a | b\n--${" |".repeat(25_000)}x\n1 | 2`))).toBeLessThan(200);
  });

  it("a toggle on one line is read as before", () => {
    expect(shape("<details><summary>Q</summary>")).toEqual([["toggle", "Q", '{"collapsed":true}']]);
    expect(shape('<details data-study="card"><summary>Q</summary>A</details>  ')).toEqual([["toggle", "Q", '{"collapsed":true,"study":"card"}']]);
    // Not closed on its line: what follows goes inside it.
    const nested = (md: string) => parse(md).map((b) => [b.type, b.parentId !== null]);
    expect(nested("<details><summary>Q</summary>\n\ninside\n\n</details>\n\nafter")).toEqual([["toggle", false], ["paragraph", true], ["paragraph", false]]);
    expect(nested("<details><summary>Q</summary></details>\n\nafter")).toEqual([["toggle", false], ["paragraph", false]]);
    const long = `<details><summary>a</summary>${" ".repeat(50_000)}x${"</summary>".repeat(2000)}y`;
    expect(ms(() => parse(long))).toBeLessThan(200);
  });

  it("a divider, a quote, a list item and a paragraph that only look like one", () => {
    const space = " ".repeat(50_000);
    const lines = [`${"- ".repeat(20_000)}x`, `-${space}-${space}-${space}x`, `>${space}x`, `${space}- x`, `1.${space}x`, `a${space}b\nnext`, `$$${space}x`, `<div style="${space}x`];
    for (const line of lines) expect(ms(() => parse(line)), JSON.stringify(line.slice(0, 12))).toBeLessThan(300);
  });
});

describe("text inside a line", () => {
  it("openers nobody closes are each read once, not each to the end", () => {
    const texts = [
      "*a ".repeat(40_000),
      "**a ".repeat(30_000),
      "_a ".repeat(40_000),
      "~~a ".repeat(30_000),
      "[a".repeat(40_000),
      `${"[a".repeat(40_000)}]`,
      `${"[a".repeat(40_000)}]( )`,
      "[a] ".repeat(30_000),
      "<http://a".repeat(15_000),
    ];
    for (const text of texts) expect(ms(() => parseInlineMarkdown(text)), JSON.stringify(text.slice(0, 10))).toBeLessThan(1000);
  });

  it("links are read as before", () => {
    const link = (text: string, href: string) => ({ type: "text", text, marks: [{ type: "link", href }] });
    expect(parseInlineMarkdown("[a](https://x.example)")).toEqual([link("a", "https://x.example")]);
    expect(parseInlineMarkdown('see [a b](<https://x.example/a-b> "t") now')).toEqual([{ type: "text", text: "see " }, link("a b", "https://x.example/a-b"), { type: "text", text: " now" }]);
    expect(parseInlineMarkdown("[a](https://x.example/w_(b))")).toEqual([link("a", "https://x.example/w_(b)")]);
    expect(parseInlineMarkdown("[\\[1\\]](https://x.example)")).toEqual([link("[1]", "https://x.example")]);
    // A "[" with no target after its "]" is text, and a link after it is still a link.
    expect(parseInlineMarkdown("[x] and [a](https://x.example)")).toEqual([{ type: "text", text: "[x] and " }, link("a", "https://x.example")]);
    expect(parseInlineMarkdown("[x] [y]( ) [a](https://x.example) [z")).toEqual([{ type: "text", text: "[x] [y]( ) " }, link("a", "https://x.example"), { type: "text", text: " [z" }]);
    expect(parseInlineMarkdown("<https://x.example/p>")).toEqual([link("https://x.example/p", "https://x.example/p")]);
  });

  it("emphasis is read as before, with an unclosed opener earlier in the line", () => {
    expect(parseInlineMarkdown("*a* and _b_ and ~~c~~")).toEqual([
      { type: "text", text: "a", marks: [{ type: "italic" }] },
      { type: "text", text: " and " },
      { type: "text", text: "b", marks: [{ type: "italic" }] },
      { type: "text", text: " and " },
      { type: "text", text: "c", marks: [{ type: "strike" }] },
    ]);
    // An opener nobody closes stays text, and what is closed after it still counts.
    const nodes = parseInlineMarkdown("a ~~b c **d** and `e`");
    expect(plainText(nodes)).toBe("a ~~b c d and e");
    expect(nodes.filter((n) => n.type === "text" && n.marks?.length).map((n) => (n.type === "text" ? [n.text, n.marks![0]!.type] : null))).toEqual([["d", "bold"], ["e", "code"]]);
  });

  it("writing a note out as Markdown doesn't read a run of spaces more than once either", () => {
    const text = `a${" ".repeat(20_000)}b`;
    const block: WireBlock = { id: "b1", type: "paragraph", parentId: null, rank: "V", schemaVersion: 1, text: [{ type: "text", text, marks: [{ type: "bold" }] }], props: {} };
    let out = "";
    expect(ms(() => (out = blocksToMarkdown([block])))).toBeLessThan(100);
    expect(out.trim()).toBe(`**${text}**`);
    const padded: WireBlock = { ...block, text: [{ type: "text", text: "  hi  ", marks: [{ type: "bold" }] }] };
    expect(blocksToMarkdown([padded]).trimEnd()).toBe("  **hi**");
  });
});
