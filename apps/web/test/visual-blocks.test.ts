// Mind map, sticky notes, chart and wireframe blocks in the editor (extensions.ts, convert.ts), their
// read-only pictures, and the shared export helpers (editor/canvas).
import { describe, expect, test, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { validateWireBlock, type WireBlock } from "@folevi/editor-schema";

vi.mock("@/components/editor/richRender", () => ({
  renderMermaid: vi.fn(),
  svgDataUrl: (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  onThemeChange: () => () => {},
  loadKatex: vi.fn(),
  renderLatex: vi.fn(),
  appFontFamily: () => null,
  embeddedFontFace: async () => null,
}));

const { ALL_MARKS, ALL_NODES } = await import("@/components/editor/extensions");
const { blocksToDoc, docToBlocks } = await import("@/components/editor/convert");
const { insertBlockAfterCurrent } = await import("@/components/editor/commands");
const { exportFileName, jpegPdf, svgSize } = await import("@/components/editor/canvas/exportImage");
const { IMAGE_BLOCKS, blockImageSvg } = await import("@/components/editor/canvas/blockImage");
const { MindmapStatic } = await import("@/components/editor/mindmap/render");
const { ChartStatic } = await import("@/components/editor/chart/render");
const { StickiesStatic } = await import("@/components/editor/stickies/render");
const { WireframeStatic } = await import("@/components/editor/wireframe/render");

function makeEditor(extra: WireBlock[] = []) {
  const start: WireBlock[] = [{ id: "01JAVISWEB00000000000000A1", type: "paragraph", parentId: null, rank: "V", schemaVersion: 1, text: [{ type: "text", text: "Intro" }], props: {} }, ...extra];
  const element = document.createElement("div");
  document.body.append(element);
  return new Editor({ element, extensions: [...ALL_NODES, ...ALL_MARKS], content: blocksToDoc(start) });
}
const canonical = (editor: Editor) => docToBlocks(editor.state.doc, new Map());

const DATA = {
  mindmap: JSON.stringify({ v: 1, nodes: [{ id: "r", parent: null, text: "Launch" }, { id: "a", parent: "r", text: "Blog <post>" }] }),
  chart: JSON.stringify({ v: 1, kind: "bar", title: "Sign ups", columns: ["Month", "Web"], rows: [["Jan", 120]] }),
  stickies: JSON.stringify({ v: 1, notes: [{ id: "s1", x: 0, y: 0, text: "Dark mode", color: "blue" }] }),
  wireframe: JSON.stringify({ v: 1, screens: [{ id: "s1", name: "Sign in", frame: "phone", x: 0, y: 0, w: 390, h: 844 }], items: [{ id: "i1", screen: "s1", kind: "button", x: 0, y: 0, w: 100, h: 40, text: "Go" }] }),
} as const;
const TYPES = Object.keys(DATA) as (keyof typeof DATA)[];
const HEIGHT = { mindmap: 440, chart: 360, stickies: 440, wireframe: 520 } as const;

describe("visual blocks in the editor", () => {
  for (const type of TYPES) {
    test(`${type}: inserts with its default height, keeps its data and round-trips as a valid block`, () => {
      const editor = makeEditor();
      editor.commands.setTextSelection(3);
      insertBlockAfterCurrent(editor, type, { data: "" });
      expect(canonical(editor).find((b) => b.type === type)!.props).toEqual({ data: "", height: HEIGHT[type] });
      let pos = -1;
      editor.state.doc.forEach((n, off) => {
        if (n.type.name === type) pos = off;
      });
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...editor.state.doc.nodeAt(pos)!.attrs, data: DATA[type] }));
      const block = canonical(editor).find((b) => b.type === type)!;
      expect(block.props).toEqual({ data: DATA[type], height: HEIGHT[type] });
      expect(validateWireBlock(block)).toEqual([]);
      // Back into an editor and out again, unchanged; copied as HTML, the data travels in data-* attributes.
      const again = makeEditor([{ ...block, rank: "W" }]);
      expect(canonical(again).find((b) => b.type === type)!.props).toEqual(block.props);
      const html = editor.getHTML();
      expect(html).toContain(`data-block="${type}"`);
      const pasted = makeEditor();
      pasted.commands.setContent(html);
      expect(canonical(pasted).find((b) => b.type === type)!.props).toEqual(block.props);
      for (const e of [editor, again, pasted]) e.destroy();
    });
  }

  test("read-only pictures show what's in each block, escaped", () => {
    const mind = renderToStaticMarkup(createElement(MindmapStatic, { data: DATA.mindmap }));
    expect(mind).toContain("Launch");
    expect(mind).toContain("Blog &lt;post&gt;");
    expect(renderToStaticMarkup(createElement(ChartStatic, { data: DATA.chart }))).toContain("<th scope=\"col\">Month</th>");
    expect(renderToStaticMarkup(createElement(StickiesStatic, { data: DATA.stickies }))).toContain('data-color="blue"');
    expect(renderToStaticMarkup(createElement(WireframeStatic, { data: DATA.wireframe }))).toContain("Button: Go");
    for (const Static of [MindmapStatic, ChartStatic, StickiesStatic, WireframeStatic]) expect(renderToStaticMarkup(createElement(Static, { data: "" }))).toMatch(/Empty/);
  });
});

describe("export", () => {
  test("every visual block is listed; a flowchart draws, an empty one doesn't", () => {
    expect(Object.keys(IMAGE_BLOCKS)).toEqual(["flowchart", "mindmap", "stickies", "chart", "wireframe", "whiteboard"]);
    const fc = JSON.stringify({ v: 1, nodes: [{ id: "a", shape: "process", x: 0, y: 0, w: 160, h: 64, text: "Start" }], edges: [] });
    expect(blockImageSvg("flowchart", { data: fc, height: 440 })).toMatch(/^<svg/);
    expect(blockImageSvg("flowchart", { data: "", height: 440 })).toBeNull();
    expect(blockImageSvg("paragraph", {})).toBeNull();
    const wb = JSON.stringify({ v: 1, strokes: [{ points: [[10, 10], [90, 40]], color: "blue", width: 5 }] });
    expect(blockImageSvg("whiteboard", { data: wb, height: 300 })).toMatch(/^<svg[^>]*viewBox="0 0 1000 300"[\s\S]*stroke="#2563eb"/);
    expect(blockImageSvg("whiteboard", { data: "", height: 300 })).toBeNull();
  });

  test("file names and sizes", () => {
    expect(exportFileName("Mind map", "png")).toBe("Mind map.png");
    expect(exportFileName('a/b:c*"d', "pdf")).toBe("a-b-c-d.pdf");
    expect(exportFileName("", "svg")).toBe("Image.svg");
    expect(svgSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -10 640 480" width="640" height="480">')).toEqual({ w: 640, h: 480 });
    expect(svgSize('<svg viewBox="0 0 300 200">')).toEqual({ w: 300, h: 200 });
  });

  test("the PDF is one page the drawing's size, with a working cross-reference table", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const bytes = jpegPdf(jpeg, { width: 1280, height: 960 }, { w: 640, h: 480 }, "Plan (draft)");
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text).toContain("/MediaBox [0 0 480 360]");
    expect(text).toContain("/Width 1280 /Height 960");
    expect(text).toContain("/Title (Plan \\(draft\\))");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    // Each object starts exactly where the table says.
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(6);
    offsets.forEach((o, i) => expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });
});
