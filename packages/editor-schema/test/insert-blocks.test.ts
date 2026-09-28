import { describe, expect, it } from "vitest";
import {
  LIMITS,
  blocksToHtml,
  blocksToMarkdown,
  markdownToBlocks,
  parseWhiteboard,
  strokeHit,
  strokePath,
  validateWireBlock,
  whiteboardDataIssue,
  whiteboardToSvg,
  type WireBlock,
} from "../src";

let n = 0;
const newId = () => `id${String(++n).padStart(4, "0")}`;
const block = (type: string, props: Record<string, unknown>, rank = "V"): WireBlock => ({
  id: `01JAINSERT0000000000000${String(++n).padStart(3, "0")}`,
  type,
  parentId: null,
  rank,
  schemaVersion: 1,
  text: [],
  props,
});
const codes = (b: WireBlock) => validateWireBlock(b).map((i) => i.code);
const strokes = (s: unknown[]) => JSON.stringify({ v: 1, strokes: s });

describe("divider styles", () => {
  it("accepts every style and no style, and rejects unknown ones", () => {
    for (const style of ["extralight", "light", "regular", "strong"]) expect(codes(block("divider", { style }))).toEqual([]);
    expect(codes(block("divider", {}))).toEqual([]);
    expect(codes(block("divider", { style: "bold" }))).toEqual(["enum"]);
  });

  it("exports a style class to HTML and a plain rule to Markdown", () => {
    const b = [block("divider", { style: "strong" })];
    expect(blocksToHtml(b, { title: "T" })).toContain('<hr class="divider-strong">');
    expect(blocksToMarkdown(b)).toBe("---\n");
  });
});

describe("page break", () => {
  it("validates with no props and no text", () => {
    expect(codes(block("pageBreak", {}))).toEqual([]);
    expect(codes(block("pageBreak", { x: 1 }))).toEqual(["unexpected"]);
    expect(codes({ ...block("pageBreak", {}), text: [{ type: "text", text: "no" }] })).toEqual(["unexpected"]);
  });

  it("breaks the printed page in HTML and round-trips through Markdown", () => {
    const blocks = [block("paragraph", {}, "U"), block("pageBreak", {}, "V"), block("paragraph", {}, "W")];
    blocks[0]!.text = [{ type: "text", text: "One" }];
    blocks[2]!.text = [{ type: "text", text: "Two" }];
    const html = blocksToHtml(blocks, { title: "T" });
    expect(html).toContain('class="page-break"');
    expect(html).toContain("break-after:page");
    const md = blocksToMarkdown(blocks);
    expect(md).toBe('One\n\n<div style="page-break-after: always"></div>\n\nTwo\n');
    expect(markdownToBlocks(md, { newId }).blocks.map((b) => b.type)).toEqual(["paragraph", "pageBreak", "paragraph"]);
  });
});

describe("formula", () => {
  it("validates LaTeX length", () => {
    expect(codes(block("formula", { latex: "a^2 + b^2 = c^2" }))).toEqual([]);
    expect(codes(block("formula", { latex: "" }))).toEqual([]);
    expect(codes(block("formula", {}))).toEqual(["required"]);
    expect(codes(block("formula", { latex: "x".repeat(LIMITS.maxFormulaLength + 1) }))).toEqual(["too_long"]);
  });

  it("exports $$…$$ to Markdown (and back), and uses renderMath or the escaped source in HTML", () => {
    const b = [block("formula", { latex: "\\frac{a}{b} < c" })];
    const md = blocksToMarkdown(b);
    expect(md).toBe("$$\n\\frac{a}{b} < c\n$$\n");
    expect(markdownToBlocks(md, { newId }).blocks[0]).toMatchObject({ type: "formula", props: { latex: "\\frac{a}{b} < c" } });
    expect(blocksToHtml(b, { title: "T" })).toContain('<pre><code class="language-latex">\\frac{a}{b} &lt; c</code></pre>');
    expect(blocksToHtml(b, { title: "T", renderMath: () => "<math><mi>x</mi></math>" })).toContain('<div class="formula"><math><mi>x</mi></math></div>');
  });
});

describe("whiteboard", () => {
  const ok = strokes([{ points: [[10, 10], [20, 30], [40, 35]], color: "ink", width: 3 }, { d: "M0 0L10 10", color: "#ff0000", width: 12, opacity: 0.35 }]);

  it("validates data shape, size and height", () => {
    expect(codes(block("whiteboard", { data: ok, height: 400 }))).toEqual([]);
    expect(codes(block("whiteboard", { data: "", height: 400 }))).toEqual([]);
    expect(codes(block("whiteboard", { data: "not json", height: 400 }))).toEqual(["shape"]);
    expect(codes(block("whiteboard", { data: strokes([{ points: [[1, 2]], color: "ink" }]), height: 400 }))).toEqual(["shape"]);
    expect(codes(block("whiteboard", { data: strokes([{ points: [[1, 2]], d: "M0 0", color: "ink", width: 2 }]), height: 400 }))).toEqual(["shape"]);
    expect(codes(block("whiteboard", { data: strokes([{ points: [[1, "2"]], color: "ink", width: 2 }]), height: 400 }))).toEqual(["shape"]);
    expect(codes(block("whiteboard", { data: strokes([{ points: [[1, 2]], color: "url(#x)", width: 2 }]), height: 400 }))).toEqual(["shape"]);
    expect(codes(block("whiteboard", { data: strokes([{ d: "M0 0 <script>", color: "ink", width: 2 }]), height: 400 }))).toEqual(["shape"]);
    expect(codes(block("whiteboard", { data: JSON.stringify({ strokes: [], extra: 1 }), height: 400 }))).toEqual(["shape"]);
    expect(codes(block("whiteboard", { data: ok, height: 50 }))).toEqual(["range"]);
    expect(codes(block("whiteboard", { data: ok, height: LIMITS.maxWhiteboardHeight + 1 }))).toEqual(["range"]);
    expect(codes(block("whiteboard", { data: ok }))).toEqual(["required"]);
    // Up to 200k characters is fine (more than the general string limit); beyond that it's too long.
    const big = strokes(Array.from({ length: 1500 }, () => ({ points: Array.from({ length: 9 }, (_, i) => [i * 10.5, i * 3.25]), color: "blue", width: 2 })));
    expect(big.length).toBeGreaterThan(LIMITS.maxCodeLength);
    expect(big.length).toBeLessThan(LIMITS.maxWhiteboardDataLength);
    expect(codes(block("whiteboard", { data: big, height: 400 }))).toEqual([]);
    expect(codes(block("whiteboard", { data: " ".repeat(LIMITS.maxWhiteboardDataLength + 1), height: 400 }))).toEqual(["too_long"]);
  });

  it("parses leniently and smooths strokes", () => {
    expect(parseWhiteboard("garbage").strokes).toEqual([]);
    expect(parseWhiteboard(ok).strokes).toHaveLength(2);
    expect(whiteboardDataIssue(ok)).toBeNull();
    expect(strokePath([[0, 0]])).toBe("M0 0L0.1 0");
    expect(strokePath([[0, 0], [10, 10], [20, 0]])).toBe("M0 0Q10 10 15 5L20 0");
    expect(strokeHit({ points: [[0, 0], [100, 0]], color: "ink", width: 2 }, [50, 4], 3)).toBe(true);
    expect(strokeHit({ points: [[0, 0], [100, 0]], color: "ink", width: 2 }, [50, 20], 3)).toBe(false);
  });

  it("exports an SVG drawing to HTML and an image to Markdown", () => {
    const svg = whiteboardToSvg(ok, 300);
    expect(svg).toContain('viewBox="0 0 1000 300"');
    expect(svg).toContain('stroke="#ff0000"');
    const b = [block("whiteboard", { data: ok, height: 300 })];
    expect(blocksToHtml(b, { title: "T" })).toContain('<figure class="whiteboard"><svg');
    const md = blocksToMarkdown(b);
    expect(md).toMatch(/^!\[Whiteboard\]\(data:image\/svg\+xml;utf8,[^()\s]+\)\n$/);
  });
});
