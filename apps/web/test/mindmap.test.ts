// The mind map block's edits (mindmap/ops.ts), its exported picture (svg.ts), and the note around it
// (noteConvert.ts): a bulleted list into a mind map and back, Foli AI's to-dos below it, and
// the block menu's entries.
import { describe, expect, test, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mindmapDataIssue, mindmapToOutline, normalizeMindmap, parseMindmap, serializeMindmap, type MindmapData, type WireBlock } from "@folevi/editor-schema";

vi.mock("@/components/editor/richRender", () => ({
  renderMermaid: vi.fn(),
  svgDataUrl: (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  onThemeChange: () => () => {},
  loadKatex: vi.fn(),
  renderLatex: vi.fn(),
  appFontFamily: () => null,
  embeddedFontFace: async () => null,
}));

const ops = await import("@/components/editor/mindmap/ops");
const { mindmapSvg } = await import("@/components/editor/mindmap/svg");
const { MindmapStatic } = await import("@/components/editor/mindmap/render");
const { listToMindmap, mindmapToList, insertAfterMindmap, tasksMarkdown, mindmapMenuItems } = await import("@/components/editor/mindmap/noteConvert");
const { ALL_MARKS, ALL_NODES } = await import("@/components/editor/extensions");
const { blocksToDoc, docToBlocks } = await import("@/components/editor/convert");

const base = (): MindmapData =>
  normalizeMindmap({
    nodes: [
      { id: "r", parent: null, text: "Launch" },
      { id: "a", parent: "r", text: "Marketing", side: "right" },
      { id: "a1", parent: "a", text: "Blog" },
      { id: "a2", parent: "a", text: "Podcast" },
      { id: "b", parent: "r", text: "Product", side: "left" },
    ],
  });
const outline = (m: MindmapData) => mindmapToOutline(m).map((o) => `${"-".repeat(o.depth)}${o.text}`);
const valid = (m: MindmapData) => expect(mindmapDataIssue(serializeMindmap(m))).toBeNull();

describe("mind map edits", () => {
  test("adding inside and next to ideas keeps the outline order; the centre gets children", () => {
    let m = base();
    const c = ops.addChild(m, "a", "Video")!;
    m = c.map;
    expect(outline(m)).toEqual(["Launch", "-Marketing", "--Blog", "--Podcast", "--Video", "-Product"]);
    const s = ops.addSibling(m, "a1", false, "Guest post")!;
    expect(outline(s.map)).toEqual(["Launch", "-Marketing", "--Blog", "--Guest post", "--Podcast", "--Video", "-Product"]);
    const before = ops.addSibling(m, "a1", true, "First")!;
    expect(outline(before.map)[2]).toBe("--First");
    // A sibling of the centre is a child; a new main branch takes a side.
    const main = ops.addSibling(m, "r", false, "Sales")!;
    expect(ops.byId(main.map, main.id)!.parent).toBe("r");
    expect(ops.byId(main.map, main.id)!.side).toBeDefined();
    // Adding inside a folded idea opens it.
    const folded = ops.setCollapsed(m, "a", true);
    expect(ops.byId(ops.addChild(folded, "a")!.map, "a")!.collapsed).toBeUndefined();
    valid(s.map);
  });

  test("deleting takes the branch and selects a neighbour; the centre stays", () => {
    const r = ops.removeIdeas(base(), ["a"]);
    expect(outline(r.map)).toEqual(["Launch", "-Product"]);
    expect(r.select).toBe("b");
    expect(ops.removeIdeas(base(), ["r"]).map.nodes).toHaveLength(5);
    expect(ops.removeIdeas(base(), ["a2"]).select).toBe("a1");
  });

  test("moving: under another idea, never into its own branch; up a level; indent; reorder", () => {
    const m = base();
    expect(outline(ops.moveIdea(m, "a", "b"))).toEqual(["Launch", "-Product", "--Marketing", "---Blog", "---Podcast"]);
    expect(ops.moveIdea(m, "a", "a1")).toBe(m);
    expect(ops.byId(ops.moveIdea(m, "a", "b"), "a")!.side).toBeUndefined();
    expect(outline(ops.outdent(m, "a2"))).toEqual(["Launch", "-Marketing", "--Blog", "-Podcast", "-Product"]);
    expect(ops.outdent(m, "a")).toBe(m);
    expect(outline(ops.indent(m, "a2"))).toEqual(["Launch", "-Marketing", "--Blog", "---Podcast", "-Product"]);
    expect(outline(ops.reorder(m, "a2", -1))).toEqual(["Launch", "-Marketing", "--Podcast", "--Blog", "-Product"]);
    expect(outline(ops.reorder(m, "a1", 1))).toEqual(["Launch", "-Marketing", "--Podcast", "--Blog", "-Product"]);
    expect(ops.reorder(m, "a2", 1)).toBe(m);
    // Moving next to an idea (before it).
    expect(outline(ops.moveIdea(m, "b", "a", "a2"))).toEqual(["Launch", "-Marketing", "--Blog", "--Product", "--Podcast"]);
    valid(ops.moveIdea(m, "a", "b"));
  });

  test("tidy balances main branches and pins their sides; folding, colours and layout", () => {
    const m = normalizeMindmap({ nodes: [{ id: "r", parent: null, text: "R" }, ...["a", "b", "c", "d"].map((id) => ({ id, parent: "r", text: id, side: "left" as const }))] });
    const t = ops.tidy(m);
    expect(t.nodes.filter((n) => n.side === "right").map((n) => n.id)).toEqual(["a", "b"]);
    expect(t.nodes.filter((n) => n.side === "left").map((n) => n.id)).toEqual(["c", "d"]);
    expect(ops.tidy(t)).toBe(t);
    const all = ops.setAllCollapsed(base(), true);
    expect(ops.byId(all, "a")!.collapsed).toBe(true);
    expect(ops.byId(all, "b")!.collapsed).toBeUndefined();
    expect(ops.setAllCollapsed(all, false).nodes.some((n) => n.collapsed)).toBe(false);
    expect(ops.byId(ops.setColor(base(), ["a"], "green"), "a")!.color).toBe("green");
    expect(ops.byId(ops.setColor(ops.setColor(base(), ["a"], "green"), ["a"], undefined), "a")!.color).toBeUndefined();
    expect(ops.setLayout(base(), "down").layout).toBe("down");
  });

  test("Foli AI's ideas go in nested; the path to an idea", () => {
    const r = ops.addIdeas(base(), "b", [{ text: "Beta", children: [{ text: "Invite list" }] }, { text: "Pricing" }]);
    expect(outline(r.map).slice(-4)).toEqual(["-Product", "--Beta", "---Invite list", "--Pricing"]);
    expect(r.ids).toHaveLength(2);
    expect(ops.pathTo(base(), "a1")).toEqual(["Launch", "Marketing", "Blog"]);
  });

  test("history merges quick runs of typing, and undoes and redoes", () => {
    const h = new ops.MindHistory();
    const a = base();
    const b = ops.setText(a, "a", "M");
    const c = ops.setText(b, "a", "Ma");
    h.push(a, "text:a", 1000);
    h.push(b, "text:a", 1200);
    expect(h.undo(c)).toBe(a);
    expect(h.redo(a)).toBe(c);
    expect(h.canUndo).toBe(true);
  });
});

describe("the picture", () => {
  test("an exported SVG draws every shown idea, escaped, with collapsed counts; nothing for an empty map", () => {
    const m = base();
    m.nodes.push({ id: "x", parent: "b", text: "<script>" });
    const svg = mindmapSvg(serializeMindmap(m), 440)!;
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    for (const t of ["Launch", "Marketing", "Blog", "Product", "&lt;script&gt;"]) expect(svg).toContain(t);
    expect(svg).not.toContain("<script>");
    const folded = mindmapSvg(serializeMindmap(ops.setCollapsed(m, "a", true)), 440)!;
    expect(folded).not.toContain(">Blog<");
    expect(folded).toContain(">2</text>");
    expect(mindmapSvg("", 440)).toBeNull();
  });

  test("the read-only map draws the real map with its text, and a list for screen readers", () => {
    const html = renderToStaticMarkup(createElement(MindmapStatic, { data: serializeMindmap(base()) }));
    expect(html).toContain('class="mm-root mm-static-svg"');
    expect(html).toContain("Marketing");
    expect(html).toContain('aria-label="Zoom in"');
    expect(html).toMatch(/<ul class="sr-only">/);
  });
});

// jsdom draws nothing: ProseMirror's scroll-into-view needs rectangles.
const noRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
const rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
Element.prototype.getClientRects ??= noRects;
Range.prototype.getClientRects ??= noRects;
Range.prototype.getBoundingClientRect ??= rect;

function makeEditor(blocks: WireBlock[]) {
  const element = document.createElement("div");
  document.body.append(element);
  return new Editor({ element, extensions: [...ALL_NODES, ...ALL_MARKS], content: blocksToDoc(blocks) });
}
const block = (id: string, type: string, text: string, parentId: string | null = null, rank = "V", props: Record<string, unknown> = {}): WireBlock => ({ id, type, parentId, rank, schemaVersion: 1, text: text ? [{ type: "text", text }] : [], props });

describe("the note around it", () => {
  test("a bulleted list becomes a mind map and back", () => {
    const editor = makeEditor([
      block("01JAMMNOTE0000000000000H01", "heading", "Trip", null, "A", { level: 2 }),
      block("01JAMMNOTE0000000000000L01", "bulleted", "Food", null, "B"),
      block("01JAMMNOTE0000000000000L02", "bulleted", "Tapas", "01JAMMNOTE0000000000000L01", "B"),
      block("01JAMMNOTE0000000000000L03", "bulleted", "Hotel", null, "C"),
    ]);
    const items = mindmapMenuItems(editor, 1, 3, { aiOn: true, close: () => {} });
    expect(items.map((i) => i.label)).toEqual(["Turn into mind map", "Mind map with Foli AI"]);
    expect(listToMindmap(editor, 1, 3)).toBe(true);
    const blocks = docToBlocks(editor.state.doc, new Map());
    expect(blocks.map((b) => b.type)).toEqual(["heading", "mindmap"]);
    const map = parseMindmap(String(blocks[1]!.props.data));
    // Two top-level items: the heading above names the centre.
    expect(outline(map)).toEqual(["Trip", "-Food", "--Tapas", "-Hotel"]);
    expect(mindmapMenuItems(editor, 1, 1, { aiOn: true, close: () => {} }).map((i) => i.label)).toEqual(["Turn into bulleted list"]);
    let pos = -1;
    editor.state.doc.forEach((n, off) => {
      if (n.type.name === "mindmap") pos = off;
    });
    expect(mindmapToList(editor, pos)).toBe(true);
    const back = docToBlocks(editor.state.doc, new Map());
    expect(back.map((b) => b.type)).toEqual(["heading", "bulleted", "bulleted", "bulleted", "bulleted"]);
    expect(back.map((b) => (b.text[0] as { text?: string } | undefined)?.text)).toEqual(["Trip", "Trip", "Food", "Tapas", "Hotel"]);
    // Paragraphs aren't a list (only Foli AI can map them).
    expect(mindmapMenuItems(editor, 0, 0, { aiOn: false, close: () => {} })).toEqual([]);
    editor.destroy();
  });

  test("Foli AI's tasks go in below the block as to-dos, their text kept as text", () => {
    const data = serializeMindmap(base());
    const editor = makeEditor([block("01JAMMNOTE0000000000000M01", "mindmap", "", null, "A", { data, height: 440 }), block("01JAMMNOTE0000000000000P01", "paragraph", "After", null, "B")]);
    expect(insertAfterMindmap(editor, 0, tasksMarkdown(["Write the *blog* post", "Book [venue]"]))).toBe(true);
    const blocks = docToBlocks(editor.state.doc, new Map());
    expect(blocks.map((b) => b.type)).toEqual(["mindmap", "todo", "todo", "paragraph"]);
    expect((blocks[1]!.text[0] as { text: string }).text).toBe("Write the *blog* post");
    expect((blocks[2]!.text[0] as { text: string }).text).toBe("Book [venue]");
    editor.destroy();
  });
});
