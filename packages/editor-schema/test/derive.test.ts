import { describe, expect, it } from "vitest";
import {
  BUILT_IN_TEMPLATES,
  SCHEMA_VERSION,
  WELCOME_TITLE,
  atlasBriefBlocks,
  blockLinkTargets,
  buildPreview,
  builtInTemplateBlocks,
  cloneBlocks,
  deriveDocumentText,
  documentSearchText,
  fieldNotesBlocks,
  flattenTree,
  hasLinkTargets,
  mindmapFromMarkdown,
  newDocumentRank,
  normalizeChart,
  pageLinkLabelPatch,
  rankBetween,
  sanitizeTitle,
  serializeChart,
  serializeMindmap,
  specsToWireBlocks,
  tripSketchBlocks,
  validateWireBlock,
  weeklyResetBlocks,
  welcomeBlocks,
  type InlineNode,
  type WireBlock,
} from "../src";

const text = (t: string): InlineNode[] => [{ type: "text", text: t }];
const link = (documentId: string, label = "Old"): InlineNode => ({ type: "pageLink", documentId, label });
let n = 0;
const block = (type: string, over: Partial<WireBlock> = {}): WireBlock => ({ id: `b${++n}`, type, parentId: null, rank: `a${n}`, schemaVersion: SCHEMA_VERSION, text: [], props: {}, ...over });

describe("buildPreview", () => {
  it("draws the first blocks with their shape", () => {
    const blocks = [
      block("heading", { text: text("Plan"), props: { level: 2 } }),
      block("todo", { text: text("Book"), props: { checked: true } }),
      block("table", { props: { headerRow: true, rows: [[text("A"), text("B")], [text("1"), text("2")]] } }),
      block("file", { props: { name: "report.pdf" } }),
      block("page", { props: { documentId: "p1", titleCache: "Child" } }),
    ];
    const preview = buildPreview(flattenTree(blocks));
    expect(preview).toEqual([
      { t: "heading", x: "Plan", l: 2 },
      { t: "todo", x: "Book", c: true },
      { t: "table", x: "", rows: [["A", "B"], ["1", "2"]] },
      { t: "file", x: "report.pdf" },
      { t: "page", x: "Child" },
    ]);
  });

  it("stops at 14 lines, nests at most 4 deep and skips column rows", () => {
    const many = Array.from({ length: 20 }, (_, i) => block("paragraph", { text: text(`Line ${i}`) }));
    expect(buildPreview(flattenTree(many))).toHaveLength(14);
    const deep = buildPreview([{ block: block("paragraph", { text: text("x") }), depth: 7 }]);
    expect(deep[0]!.d).toBe(4);
    const cols = block("columns");
    const col = block("column", { parentId: cols.id });
    const inside = block("paragraph", { parentId: col.id, text: text("In a column") });
    expect(buildPreview(flattenTree([cols, col, inside])).map((l) => l.x)).toEqual(["In a column"]);
  });

  it("shows a mind map's central idea and a chart's title", () => {
    const map = serializeMindmap(mindmapFromMarkdown("- Central\n  - Branch"));
    const chart = serializeChart(normalizeChart({ kind: "bar", title: "Sales", columns: ["Month", "Total"], rows: [["Jan", 3]] }));
    const preview = buildPreview(flattenTree([block("mindmap", { props: { data: map, height: 300 } }), block("chart", { props: { data: chart, height: 300 } })]));
    expect(preview.map((l) => l.x)).toEqual(["Central", "Sales"]);
  });
});

describe("deriveDocumentText", () => {
  it("counts the body, keeps an excerpt and finds the title", () => {
    const blocks = [block("paragraph", { text: text("Pack  the\nbag") }), block("paragraph", { text: text("Ferry") })];
    const d = deriveDocumentText("Trip", blocks);
    expect(d.wordCount).toBe(4);
    expect(d.charCount).toBe("Pack  the\nbag\nFerry".length);
    expect(d.excerpt).toBe("Pack the bag Ferry");
    expect(d.searchText).toBe(documentSearchText("Trip", [blocks[0]!, blocks[1]!]));
    expect(d.preview).toHaveLength(2);
  });

  it("leaves a synced block's own content out of search", () => {
    expect(deriveDocumentText("Shared", [block("paragraph", { text: text("Hello") })], { synced: true }).searchText).toBe("");
  });
});

describe("titles and ranks", () => {
  it("replaces control characters and caps the length", () => {
    expect(sanitizeTitle("a\u0000b\nc\u007F")).toBe("a b c ");
    expect(sanitizeTitle("x".repeat(400))).toHaveLength(300);
  });

  it("ranks a new note after the latest one, or first when that rank is unusable", () => {
    const first = newDocumentRank(null);
    expect(first).toBe(rankBetween(null, null));
    expect(newDocumentRank(first) > first).toBe(true);
    expect(newDocumentRank("")).toBe(rankBetween(null, null));
  });
});

describe("page links", () => {
  it("finds the pages a block links to", () => {
    expect([...blockLinkTargets(block("page", { props: { documentId: "p1" } }))]).toEqual(["p1"]);
    expect([...blockLinkTargets(block("synced", { props: { sourceId: "s1" } }))]).toEqual(["s1"]);
    expect([...blockLinkTargets(block("paragraph", { text: [...text("see "), link("p2"), link("p2"), link("p3")] }))]).toEqual(["p2", "p3"]);
    const table = block("table", { props: { headerRow: false, rows: [[[link("p4")], text("x")], [[], [link("p5")]]] } });
    expect([...blockLinkTargets(table)]).toEqual(["p4", "p5"]);
    expect(blockLinkTargets(block("paragraph", { text: text("nothing") })).size).toBe(0);
  });

  it("tells which blocks can link at all", () => {
    expect(hasLinkTargets(block("page"))).toBe(true);
    expect(hasLinkTargets(block("synced"))).toBe(true);
    expect(hasLinkTargets(block("paragraph", { text: [link("p1")] }))).toBe(true);
    expect(hasLinkTargets(block("table", { props: { rows: [[[link("p1")]]] } }))).toBe(true);
    expect(hasLinkTargets(block("paragraph", { text: text("plain") }))).toBe(false);
  });

  it("relabels links to a renamed page and refreshes a page card's caches", () => {
    const para = block("paragraph", { text: [...text("see "), link("p1"), link("p2")] });
    const patch = pageLinkLabelPatch(para, "p1", "New", null);
    expect(patch.props).toBeUndefined();
    expect(patch.text).toEqual([...text("see "), link("p1", "New"), link("p2")]);

    const card = block("page", { props: { documentId: "p1", titleCache: "Old", iconCache: "star" } });
    expect(pageLinkLabelPatch(card, "p1", "New", null).props).toEqual({ documentId: "p1", titleCache: "New" });
    expect(pageLinkLabelPatch(card, "p1", "Old", "star")).toEqual({});

    const table = block("table", { props: { headerRow: true, rows: [[[link("p1")], text("x")]] } });
    expect(pageLinkLabelPatch(table, "p1", "New", null).props).toEqual({ headerRow: true, rows: [[[link("p1", "New")], text("x")]] });
    expect(pageLinkLabelPatch(block("paragraph", { text: [link("p1", "Same")] }), "p1", "Same", null)).toEqual({});
  });
});

describe("authoring and copying blocks", () => {
  it("turns specs into valid wire blocks, children after their parent", () => {
    const blocks = specsToWireBlocks([{ type: "paragraph", md: "**Hi**" }, { type: "toggle", props: { collapsed: false }, md: "More", children: [{ type: "bulleted", md: "Inside" }] }]);
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "toggle", "bulleted"]);
    expect(blocks[0]!.text).toEqual([{ type: "text", text: "Hi", marks: [{ type: "bold" }] }]);
    expect(blocks[2]!.parentId).toBe(blocks[1]!.id);
    expect(blocks[0]!.rank < blocks[1]!.rank).toBe(true);
    for (const b of blocks) expect(validateWireBlock(b)).toEqual([]);
  });

  it("copies blocks with fresh ids and the same tree", () => {
    const [parent, child] = specsToWireBlocks([{ type: "toggle", props: { collapsed: false }, md: "A", children: [{ type: "paragraph", md: "B" }] }]);
    const copy = cloneBlocks([{ ...parent!, revision: 3 }, child!]);
    expect(copy[0]!.id).not.toBe(parent!.id);
    expect(copy[1]!.parentId).toBe(copy[0]!.id);
    expect(copy[0]!.revision).toBeUndefined();
    expect(copy[0]!.text).toEqual(parent!.text);
    // A parent outside the copied blocks isn't kept.
    expect(cloneBlocks([child!])[0]!.parentId).toBeNull();
  });
});

describe("templates and seed content", () => {
  it("makes valid blocks for every built-in template", () => {
    for (const t of BUILT_IN_TEMPLATES) {
      const blocks = builtInTemplateBlocks(t.key)!;
      expect(blocks.length, t.key).toBeGreaterThan(0);
      for (const b of blocks) expect(validateWireBlock(b), `${t.key} ${b.type}`).toEqual([]);
    }
    expect(builtInTemplateBlocks("no-such-template")).toBeNull();
  });

  it("seeds valid notes dated from the given day", () => {
    expect(WELCOME_TITLE).toBe("Welcome to Folevi");
    const today = "2026-10-20";
    for (const specs of [welcomeBlocks(today), fieldNotesBlocks(), atlasBriefBlocks(today), tripSketchBlocks(today), weeklyResetBlocks()]) {
      for (const b of specsToWireBlocks(specs)) expect(validateWireBlock(b)).toEqual([]);
    }
    expect(welcomeBlocks(today).find((s) => s.props?.dueDate)?.props?.dueDate).toBe(today);
    expect(JSON.stringify(tripSketchBlocks(today))).toContain('"2026-11-01"');
  });
});
