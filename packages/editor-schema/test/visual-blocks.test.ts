// The mind map, sticky notes, chart and wireframe blocks: strict checks on the server, forgiving readers on
// clients, repairs before sending, and the text exports (src/mindmap.ts, stickies.ts, chart.ts, wireframe.ts).
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  LIMITS,
  blockSearchText,
  blocksToHtml,
  blocksToMarkdown,
  chartDataIssue,
  markdownToBlocks,
  mindmapDataIssue,
  normalizeChart,
  normalizeMindmap,
  normalizeStickies,
  normalizeWireframe,
  parseChart,
  parseMindmap,
  parseStickies,
  parseWireframe,
  repairWireBlock,
  serializeChart,
  serializeMindmap,
  serializeStickies,
  serializeWireframe,
  stickiesDataIssue,
  validateWireBlock,
  wireframeDataIssue,
  type WireBlock,
} from "../src";

let n = 0;
const block = (type: string, props: Record<string, unknown>, rank = "V"): WireBlock => ({
  id: `01JAVISUAL00000000000000${String(++n).padStart(2, "0")}`,
  type,
  parentId: null,
  rank,
  schemaVersion: 1,
  text: [],
  props,
});
const codes = (b: WireBlock) => validateWireBlock(b).map((i) => i.code);

const MINDMAP = JSON.stringify({
  v: 1,
  nodes: [
    { id: "root", parent: null, text: "Launch plan" },
    { id: "a", parent: "root", text: "Marketing", color: "blue", side: "left" },
    { id: "a1", parent: "a", text: "Blog post" },
    { id: "b", parent: "root", text: "Product", collapsed: true },
  ],
});
const STICKIES = JSON.stringify({
  v: 1,
  notes: [
    { id: "s1", x: 20, y: 20, text: "Faster sign up", color: "pink", tags: ["ux"], author: "k17abc" },
    { id: "s2", x: 220, y: 20, text: "Dark mode" },
    { id: "s3", x: 900, y: 600, text: "Loose idea" },
  ],
  groups: [{ id: "g1", label: "Ideas", x: 0, y: 0, w: 600, h: 400 }],
});
const CHART = JSON.stringify({
  v: 1,
  kind: "bar",
  title: "Sign ups",
  takeaway: "March doubled February.",
  columns: ["Month", "Web", "iPhone"],
  rows: [
    ["Jan", 120, 40],
    ["Feb", 150, null],
    ["Mar", 310, 90],
  ],
});
const WIREFRAME = JSON.stringify({
  v: 1,
  style: "sketch",
  screens: [
    { id: "s1", name: "Sign in", frame: "phone", x: 0, y: 0, w: 390, h: 844 },
    { id: "s2", name: "Home", frame: "phone", x: 480, y: 0, w: 390, h: 844 },
  ],
  items: [
    { id: "i1", screen: "s1", kind: "heading", x: 24, y: 96, w: 342, h: 40, text: "Welcome back" },
    { id: "i2", screen: "s1", kind: "button", x: 24, y: 700, w: 342, h: 48, text: "Sign in" },
    { id: "i3", screen: "s2", kind: "navBar", x: 0, y: 0, w: 390, h: 56 },
  ],
  links: [{ id: "l1", from: "i2", to: "s2" }],
});

const SAMPLES = { mindmap: MINDMAP, stickies: STICKIES, chart: CHART, wireframe: WIREFRAME } as const;
const HEIGHTS = {
  mindmap: [LIMITS.minMindmapHeight, LIMITS.maxMindmapHeight],
  stickies: [LIMITS.minStickiesHeight, LIMITS.maxStickiesHeight],
  chart: [LIMITS.minChartHeight, LIMITS.maxChartHeight],
  wireframe: [LIMITS.minWireframeHeight, LIMITS.maxWireframeHeight],
} as const;
const MAX_DATA = { mindmap: LIMITS.maxMindmapDataLength, stickies: LIMITS.maxStickiesDataLength, chart: LIMITS.maxChartDataLength, wireframe: LIMITS.maxWireframeDataLength } as const;
const TYPES = Object.keys(SAMPLES) as (keyof typeof SAMPLES)[];

describe("every visual block on the wire", () => {
  for (const type of TYPES) {
    it(`${type}: valid data and an empty block pass; bad data, sizes and extra props don't`, () => {
      const [lo, hi] = HEIGHTS[type];
      expect(codes(block(type, { data: SAMPLES[type], height: 440 > hi ? hi : 440 }))).toEqual([]);
      expect(codes(block(type, { data: "", height: lo }))).toEqual([]);
      expect(codes(block(type, { data: "{nope", height: lo }))).toEqual(["shape"]);
      expect(codes(block(type, { data: JSON.stringify({ v: 2 }), height: lo }))).toEqual(["shape"]);
      expect(codes(block(type, { data: JSON.stringify({ v: 1, script: "x" }), height: lo }))).toEqual(["shape"]);
      expect(codes(block(type, { data: "", height: lo - 1 }))).toEqual(["range"]);
      expect(codes(block(type, { data: "", height: hi + 1 }))).toEqual(["range"]);
      expect(codes(block(type, { data: "", height: lo, extra: 1 }))).toEqual(["unexpected"]);
      expect(codes(block(type, { height: lo }))).toEqual(["required"]);
      expect(codes(block(type, { data: " ".repeat(MAX_DATA[type] + 1), height: lo }))).toContain("too_long");
      expect(codes({ ...block(type, { data: "", height: lo }), text: [{ type: "text", text: "no" }] })).toEqual(["unexpected"]);
    });

    it(`${type}: parse then serialize keeps the content, and anything the reader returns passes the strict check`, () => {
      const parse = { mindmap: parseMindmap, stickies: parseStickies, chart: parseChart, wireframe: parseWireframe }[type];
      const serialize = { mindmap: serializeMindmap, stickies: serializeStickies, chart: serializeChart, wireframe: serializeWireframe }[type] as (d: unknown) => string;
      const once = serialize(parse(SAMPLES[type]));
      expect(JSON.parse(once)).toEqual(JSON.parse(SAMPLES[type]));
      expect(serialize(parse(once))).toBe(once);
      expect(serialize(parse(""))).toBe("");
      expect(serialize(parse("not json"))).toBe("");
    });
  }

  it("the forgiving readers never throw and always give data the server accepts", () => {
    const readers = [
      [normalizeMindmap, serializeMindmap, mindmapDataIssue],
      [normalizeStickies, serializeStickies, stickiesDataIssue],
      [normalizeChart, serializeChart, chartDataIssue],
      [normalizeWireframe, serializeWireframe, wireframeDataIssue],
    ] as const;
    const anyValue = fc.anything({ maxDepth: 3 });
    const shaped = fc.record({
      layout: anyValue,
      kind: fc.constantFrom("bar", "pie", "nope", 3),
      columns: fc.array(fc.oneof(fc.string(), fc.integer()), { maxLength: 4 }),
      rows: fc.array(fc.array(fc.oneof(fc.string(), fc.double(), fc.constant(null)), { maxLength: 5 }), { maxLength: 5 }),
      nodes: fc.array(fc.record({ id: fc.oneof(fc.string({ maxLength: 4 }), fc.integer()), parent: fc.oneof(fc.constant(null), fc.string({ maxLength: 4 })), text: anyValue, color: fc.constantFrom("blue", "nope") }), { maxLength: 8 }),
      notes: fc.array(fc.record({ id: anyValue, x: fc.oneof(fc.double(), fc.integer()), y: fc.integer(), text: fc.string(), tags: fc.array(fc.string(), { maxLength: 10 }) }), { maxLength: 6 }),
      groups: fc.array(fc.record({ id: anyValue, x: fc.integer(), y: fc.integer(), w: fc.integer(), h: fc.integer(), label: fc.string() }), { maxLength: 3 }),
      screens: fc.array(fc.record({ id: fc.string({ maxLength: 3 }), name: fc.string(), frame: fc.constantFrom("phone", "watch"), x: fc.integer(), w: fc.integer() }), { maxLength: 3 }),
      items: fc.array(fc.record({ id: fc.string({ maxLength: 3 }), screen: fc.string({ maxLength: 3 }), kind: fc.constantFrom("button", "laser"), x: fc.integer(), y: fc.integer(), w: fc.integer(), h: fc.integer() }), { maxLength: 6 }),
      links: fc.array(fc.record({ id: fc.string({ maxLength: 3 }), from: fc.string({ maxLength: 3 }), to: fc.string({ maxLength: 3 }) }), { maxLength: 4 }),
    });
    fc.assert(
      fc.property(fc.oneof(anyValue, shaped), (input) => {
        for (const [normalize, serialize, issue] of readers) {
          const out = serialize(normalize(input) as never);
          expect(issue(out)).toBeNull();
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("mind map shape", () => {
  const map = (nodes: unknown[]) => JSON.stringify({ v: 1, nodes });
  it("needs exactly one central idea, known parents and no loops", () => {
    expect(mindmapDataIssue(map([{ id: "a", parent: null, text: "A" }, { id: "b", parent: null, text: "B" }]))).toBe("needs exactly one central idea");
    expect(mindmapDataIssue(map([{ id: "a", parent: null, text: "A" }, { id: "b", parent: "zz", text: "B" }]))).toMatch(/unknown parent/);
    expect(mindmapDataIssue(map([{ id: "r", parent: null, text: "R" }, { id: "a", parent: "b", text: "A" }, { id: "b", parent: "a", text: "B" }]))).toMatch(/loop/);
    expect(mindmapDataIssue(map([{ id: "r", parent: null, text: "R" }, { id: "r", parent: "r", text: "again" }]))).toMatch(/invalid id/);
    expect(mindmapDataIssue(JSON.stringify({ v: 1, layout: "spiral", nodes: [] }))).toBe("invalid layout");
    expect(mindmapDataIssue(map([]))).toBeNull();
  });

  it("the reader hangs lost ideas from the centre and puts the centre first", () => {
    const read = parseMindmap(map([{ id: "a", parent: "r", text: "A" }, { id: "r", parent: null, text: "R" }, { id: "x", parent: "gone", text: "X" }, { id: "p", parent: "q", text: "P" }, { id: "q", parent: "p", text: "Q" }]));
    expect(read.nodes.map((n) => [n.id, n.parent])).toEqual([["r", null], ["a", "r"], ["x", "r"], ["p", "r"], ["q", "p"]]);
  });
});

describe("chart and wireframe shape", () => {
  it("chart rows must match the columns; the reader pads them and reads numbers in text", () => {
    expect(chartDataIssue(JSON.stringify({ v: 1, kind: "bar", columns: ["a", "b"], rows: [["x"]] }))).toMatch(/expected 2 cells/);
    expect(chartDataIssue(JSON.stringify({ v: 1, kind: "radar", columns: [], rows: [] }))).toBe("invalid kind");
    const c = normalizeChart({ kind: "line", columns: ["Month", "Sales"], rows: [["Jan", "1,200"], ["Feb"], ["Mar", "42%", "extra"]] });
    expect(c.rows).toEqual([["Jan", 1200], ["Feb", null], ["Mar", "42%"]]);
  });

  it("wireframe items need their screen, links need a screen to point at", () => {
    const wf = JSON.parse(WIREFRAME);
    expect(wireframeDataIssue(JSON.stringify({ ...wf, items: [{ ...wf.items[0], screen: "nope" }] }))).toMatch(/unknown screen/);
    expect(wireframeDataIssue(JSON.stringify({ ...wf, links: [{ id: "l1", from: "i2", to: "i1" }] }))).toMatch(/unknown screen/);
    expect(wireframeDataIssue(JSON.stringify({ ...wf, items: [{ ...wf.items[0], kind: "laser" }] }))).toMatch(/invalid kind/);
    const read = normalizeWireframe({ ...wf, items: [...wf.items, { id: "lost", screen: "gone", kind: "button" }], links: [...wf.links, { id: "l2", from: "lost", to: "s2" }] });
    expect(read.items.map((i) => i.id)).toEqual(["i1", "i2", "i3"]);
    expect(read.links.map((l) => l.id)).toEqual(["l1"]);
  });
});

describe("repairs before sending", () => {
  it("keeps what's usable of a refused mind map and brings its height into range", () => {
    const bad = JSON.stringify({ v: 1, nodes: [{ id: "r", parent: null, text: "R" }, { id: "a", parent: "gone", text: "A" }] });
    const r = repairWireBlock(block("mindmap", { data: bad, height: 99_999 }));
    expect(r.issues).toEqual([]);
    expect(r.repaired).toBe(true);
    expect(parseMindmap(String(r.block.props.data)).nodes.map((x) => x.parent)).toEqual([null, "r"]);
    expect(r.block.props.height).toBe(LIMITS.maxMindmapHeight);
  });

  it("leaves data over the size limit alone (rewriting it would lose it all)", () => {
    const huge = JSON.stringify({ v: 1, kind: "bar", columns: ["a"], rows: [], title: "x".repeat(LIMITS.maxChartDataLength) });
    const r = repairWireBlock(block("chart", { data: huge, height: 300 }));
    expect(r.block.props.data).toBe(huge);
    expect(r.issues.map((i) => i.code)).toEqual(["too_long"]);
  });

  it("a valid block comes back untouched", () => {
    const b = block("wireframe", { data: WIREFRAME, height: 520 });
    expect(repairWireBlock(b)).toEqual({ block: b, repaired: false, issues: [] });
  });
});

describe("exports and search", () => {
  const blocks = [block("mindmap", { data: MINDMAP, height: 440 }, "A"), block("chart", { data: CHART, height: 360 }, "B"), block("stickies", { data: STICKIES, height: 440 }, "C"), block("wireframe", { data: WIREFRAME, height: 520 }, "D")];

  it("Markdown: a nested list, a table, and labelled lists", () => {
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("- Launch plan\n  - Marketing\n    - Blog post\n  - Product\n");
    expect(md).toContain("**Sign ups**\n\n| Month | Web | iPhone |\n| --- | --- | --- |\n| Jan | 120 | 40 |\n| Feb | 150 |   |\n| Mar | 310 | 90 |\n\n_March doubled February._");
    expect(md).toContain("**Ideas**\n\n- Faster sign up (ux)\n- Dark mode\n\n- Loose idea");
    expect(md).toContain("**Sign in (Phone)**\n\n");
    expect(md).toContain("- Heading: Welcome back\n- Button: Sign in, goes to Home");
    expect(md).toContain("**Home (Phone)**\n\n- Navigation bar");
    expect(md).not.toContain("unsupported-block");
  });

  it("a mind map's Markdown imports back as the same outline", () => {
    const back = markdownToBlocks(blocksToMarkdown([blocks[0]!]), { titleFromHeading: false }).blocks;
    expect(back.map((b) => b.type)).toEqual(["bulleted", "bulleted", "bulleted", "bulleted"]);
    expect(back.map((b) => (b.text[0] as { text: string }).text)).toEqual(["Launch plan", "Marketing", "Blog post", "Product"]);
  });

  it("HTML: readable lists and tables, everything escaped", () => {
    const html = blocksToHtml([...blocks, block("chart", { data: JSON.stringify({ v: 1, kind: "pie", title: "<b>x</b>", columns: ["<i>"], rows: [] }), height: 360 }, "E")], { title: "T" });
    expect(html).toContain('<figure class="mindmap"><ul><li>Launch plan<ul><li>Marketing<ul><li>Blog post</li></ul></li><li>Product</li></ul></li></ul></figure>');
    expect(html).toContain("<th>Month</th><th>Web</th><th>iPhone</th>");
    expect(html).toContain("<li>Faster sign up (ux)</li>");
    expect(html).toContain("<li>Button: Sign in, goes to Home</li>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<i>");
  });

  it("search finds their words", () => {
    expect(blockSearchText(blocks[0]!)).toBe("Launch plan Marketing Blog post Product");
    expect(blockSearchText(blocks[1]!)).toContain("March doubled February.");
    expect(blockSearchText(blocks[2]!)).toContain("Ideas");
    expect(blockSearchText(blocks[2]!)).toContain("ux");
    expect(blockSearchText(blocks[3]!)).toContain("Welcome back");
  });
});
