import { describe, expect, test, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FLOWCHART_LIMITS, edgeLabel, flowchart, newEdge, parseFlowchart, serializeFlowchart, validateWireBlock, type FlowchartData, type FlowNode, type WireBlock } from "@folevi/editor-schema";

vi.mock("@/components/editor/richRender", () => ({
  renderMermaid: vi.fn(async (code: string) => (code.includes("oops") ? { error: "Parse error on line 2" } : { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"></svg>', width: 120, height: 80 })),
  svgDataUrl: (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  onThemeChange: () => () => {},
  loadKatex: vi.fn(),
  renderLatex: vi.fn(),
}));

const { ALL_MARKS, ALL_NODES } = await import("@/components/editor/extensions");
const { blocksToDoc, docToBlocks } = await import("@/components/editor/convert");
const { insertBlockAfterCurrent } = await import("@/components/editor/commands");
const ops = await import("@/components/editor/flowchart/ops");
const { FlowchartStatic } = await import("@/components/editor/flowchart/render");

function makeEditor(extra: WireBlock[] = []) {
  const start: WireBlock[] = [{ id: "01JAFLOWWEB0000000000000A1", type: "paragraph", parentId: null, rank: "V", schemaVersion: 1, text: [{ type: "text", text: "Intro" }], props: {} }, ...extra];
  const element = document.createElement("div");
  document.body.append(element);
  return new Editor({ element, extensions: [...ALL_NODES, ...ALL_MARKS], content: blocksToDoc(start) });
}
const canonical = (editor: Editor) => docToBlocks(editor.state.doc, new Map());
const node = (id: string, x = 0, y = 0, extra: Partial<FlowNode> = {}): FlowNode => ({ id, shape: "process", x, y, w: 160, h: 64, text: id, color: "neutral", ...extra });
const chart = (nodes: FlowNode[], edges: [string, string][] = []): FlowchartData => flowchart({ nodes, edges: edges.map(([from, to], i) => newEdge(from, to, { id: `e${i}` })) });

describe("flowchart blocks in the editor", () => {
  test("insert, keep and round-trip as a valid canonical block", () => {
    const editor = makeEditor();
    editor.commands.setTextSelection(3);
    insertBlockAfterCurrent(editor, "flowchart", { data: "", height: 440 });
    const data = serializeFlowchart(chart([node("a"), node("b", 0, 120)], [["a", "b"]]));
    let pos = -1;
    editor.state.doc.forEach((n, off) => {
      if (n.type.name === "flowchart") pos = off;
    });
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...editor.state.doc.nodeAt(pos)!.attrs, data }));
    const fc = canonical(editor).find((b) => b.type === "flowchart")!;
    expect(fc.props).toEqual({ data, height: 440 });
    expect(validateWireBlock(fc)).toEqual([]);
    // Back into an editor and out again, unchanged.
    const again = makeEditor([{ ...fc, rank: "W" }]);
    expect(canonical(again).find((b) => b.type === "flowchart")!.props).toEqual({ data, height: 440 });
    editor.destroy();
    again.destroy();
  });
});

describe("Mermaid diagram card", () => {
  function mermaidEditor(source: string) {
    const editor = makeEditor();
    editor.commands.setTextSelection(3);
    insertBlockAfterCurrent(editor, "code", { language: "mermaid" }, source);
    // Put the caret back in the intro paragraph (outside the diagram).
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
    return { editor, pre: editor.view.dom.querySelector("pre.fb-code-mermaid") as HTMLElement };
  }

  test("folds the source away unless the caret is in it; Edit diagram opens it", async () => {
    const { editor, pre } = mermaidEditor("flowchart TD\n  A --> B");
    expect(pre.dataset.editing).toBe("false");
    const edit = [...pre.querySelectorAll("button")].find((b) => b.textContent === "Edit diagram")!;
    edit.click();
    expect(pre.dataset.editing).toBe("true");
    expect(edit.textContent).toBe("Done");
    expect(editor.state.selection.$from.parent.type.name).toBe("codeBlock");
    edit.click();
    expect(pre.dataset.editing).toBe("false");
    editor.destroy();
  });

  test("a syntax error keeps the last good drawing, faded, with the message", async () => {
    const { editor, pre } = mermaidEditor("flowchart TD\n  A --> B");
    await vi.waitFor(() => expect(pre.querySelector("img.fb-mermaid-svg")).toBeTruthy());
    let pos = -1;
    editor.state.doc.forEach((n, off) => {
      if (n.type.name === "codeBlock") pos = off;
    });
    editor.view.dispatch(editor.state.tr.insertText("\n  oops", pos + 1 + editor.state.doc.nodeAt(pos)!.content.size));
    await vi.waitFor(() => expect(pre.querySelector(".fb-mermaid-error")?.textContent).toContain("Parse error"));
    expect(pre.querySelector(".fb-mermaid-preview")!.getAttribute("data-stale")).toBe("true");
    expect(pre.querySelector("img.fb-mermaid-svg")).toBeTruthy();
    editor.destroy();
  });

  test("Convert to flowchart replaces the block with an equivalent flowchart", () => {
    const { editor, pre } = mermaidEditor("flowchart LR\n  A[Draft] -->|send| B{Approved?}\n  B -- Yes --> C([Publish])");
    const convert = [...pre.querySelectorAll("button")].find((b) => b.textContent === "Convert to flowchart")!;
    expect(convert.hidden).toBe(false);
    convert.click();
    const blocks = canonical(editor);
    expect(blocks.some((b) => b.type === "code")).toBe(false);
    const fc = blocks.find((b) => b.type === "flowchart")!;
    expect(validateWireBlock(fc)).toEqual([]);
    const data = parseFlowchart(String(fc.props.data));
    expect(data.nodes.map((n) => [n.shape, n.text])).toEqual([
      ["process", "Draft"],
      ["decision", "Approved?"],
      ["terminator", "Publish"],
    ]);
    expect(data.edges.map((e) => edgeLabel(e))).toEqual(["send", "Yes"]);
    editor.destroy();
  });

  test("other diagram types can't be converted (the button stays hidden)", () => {
    const { editor, pre } = mermaidEditor("sequenceDiagram\n  A->>B: hi");
    const convert = [...pre.querySelectorAll("button")].find((b) => b.textContent === "Convert to flowchart")!;
    expect(convert.hidden).toBe(true);
    editor.destroy();
  });
});

describe("flowchart edits", () => {
  test("history: undo/redo, coalescing rapid edits with the same key", () => {
    const h = new ops.FlowHistory();
    const a = chart([node("a")]);
    const b = chart([node("a", 8)]);
    const c = chart([node("a", 16)]);
    h.push(a, "nudge", 1000);
    h.push(b, "nudge", 1300); // same gesture: not a new step
    expect(h.undo(c)).toBe(a);
    expect(h.canUndo).toBe(false);
    expect(h.redo(a)).toBe(c);
    h.push(c, undefined, 5000);
    h.clear();
    expect(h.canUndo || h.canRedo).toBe(false);
  });

  test("snapping: to other shapes' edges and centres within the threshold, else to the grid", () => {
    const other = { x: 200, y: 0, w: 160, h: 64 };
    const near = ops.snapGroup({ x: 203, y: 150, w: 160, h: 64 }, [other], 6);
    expect(near.dx).toBe(-3);
    expect(near.guides[0]).toMatchObject({ axis: "x", at: 200 });
    const far = ops.snapGroup({ x: 1003, y: 150, w: 160, h: 64 }, [other], 6);
    expect(far.dx).toBe(-3); // to the 8px grid
    expect(far.guides).toEqual([]);
  });

  test("resize keeps a minimum size, snaps, and keeps circles round", () => {
    const n = node("a", 0, 0);
    expect(ops.resizeNode(n, "se", 45, -100, false)).toMatchObject({ x: 0, y: 0, w: 208, h: 40 });
    expect(ops.resizeNode(n, "nw", 21, 3, false)).toMatchObject({ x: 24, y: 0, w: 136, h: 64 });
    const c = ops.resizeNode({ ...n, shape: "circle", w: 104, h: 104 }, "e", 52, 0, false);
    expect(c.w).toBe(c.h);
  });

  test("delete removes connectors of removed shapes; duplicate copies inner connectors", () => {
    const fc = chart([node("a"), node("b", 0, 120), node("c", 0, 240)], [["a", "b"], ["b", "c"]]);
    const del = ops.deleteSelection(fc, { nodes: ["b"], edges: [] });
    expect(del.nodes.map((n) => n.id)).toEqual(["a", "c"]);
    expect(del.edges).toEqual([]);
    const dup = ops.duplicate(fc, ["a", "b"]);
    expect(dup.doc.nodes).toHaveLength(5);
    expect(dup.doc.edges).toHaveLength(3);
    const copy = dup.doc.nodes.find((n) => n.id === dup.ids[0])!;
    expect([copy.x, copy.y]).toEqual([24, 24]);
  });

  test("connect refuses loops and reuses an existing connector", () => {
    const fc = chart([node("a"), node("b", 0, 120)], [["a", "b"]]);
    expect(ops.connect(fc, "a", "a")).toBeNull();
    expect(ops.connect(fc, "a", "b")).toEqual({ doc: fc, id: "e0" });
    expect(ops.connect(fc, "b", "a", "top", "bottom")!.doc.edges[1]).toMatchObject({ from: "b", to: "a", fromSide: "top", toSide: "bottom" });
  });

  test("a new shape goes beside the selection in the flow's direction, at the + arrows' gap", () => {
    const fc = chart([node("a", 0, 0), node("b", 200, 0)]);
    const size = { w: 160, h: 64 };
    expect(ops.besideNodes(fc, ["a", "b"], size, "TD")).toEqual({ x: 180, y: 64 + ops.ADD_GAP.TD + 32 });
    expect(ops.besideNodes(fc, ["a"], size, "LR")).toEqual({ x: 160 + ops.ADD_GAP.LR + 80, y: 32 });
    expect(ops.besideNodes(fc, ["gone"], size, "TD")).toBeNull();
    expect(ops.freeNodeSpot(fc, ops.besideNodes(fc, ["a"], size, "TD")!, size)).toEqual({ x: 0, y: 128 });
  });

  test("free spot: kept when clear, else the nearest grid spot that overlaps nothing (with the margin)", () => {
    const size = { w: 160, h: 64 };
    const overlaps = (fc: FlowchartData, p: { x: number; y: number }, m = 16) => fc.nodes.some((n) => p.x < n.x + n.w + m && p.x + size.w + m > n.x && p.y < n.y + n.h + m && p.y + size.h + m > n.y);
    // An empty chart: centred on the point, snapped to the grid.
    expect(ops.freeNodeSpot(chart([]), { x: 83, y: 35 }, size)).toEqual({ x: 0, y: 0 });
    // A process then a decision at the same centre no longer stack.
    const one = chart([node("a", -80, -32)]);
    const p = ops.freeNodeSpot(one, { x: 0, y: 0 }, size);
    expect(overlaps(one, p)).toBe(false);
    expect([Math.abs(p.x % 8), Math.abs(p.y % 8)]).toEqual([0, 0]);
    // Nearest: straight above or below (a short hop), not off to the side.
    expect(p.x).toBe(-80);
    expect(Math.abs(p.y + 32)).toBe(64 + 16);
    // Hemmed in by a row of shapes: still clear of all of them.
    const row = chart([node("a", -80, -32), node("b", -260, -32), node("c", 100, -32), node("d", -80, -132), node("e", -80, 68)]);
    const q = ops.freeNodeSpot(row, { x: 0, y: 0 }, size);
    expect(overlaps(row, q)).toBe(false);
  });

  test("AI drafts are validated again, sized to their labels and laid out", () => {
    const current = chart([node("keep", 400, 400, { w: 240, h: 80, color: "blue" })]);
    const draft = {
      direction: "TD",
      nodes: [
        { id: "keep", shape: "process", text: "Keep me" },
        { id: "new", shape: "decision", text: "A rather long question that needs wrapping?" },
        { id: "bad", shape: "<svg>", text: "x".repeat(1900) },
      ],
      edges: [{ from: "keep", to: "new", label: "then" }, { from: "new", to: "ghost" }],
    };
    const out = ops.chartFromDraft(draft, current, "update");
    const keep = out.nodes.find((n) => n.id === "keep")!;
    expect([keep.w, keep.h, keep.color]).toEqual([240, 80, "blue"]);
    const q = out.nodes.find((n) => n.id === "new")!;
    expect(q.y).toBeGreaterThan(keep.y);
    expect(out.nodes.find((n) => n.id === "bad")!.text.length).toBe(FLOWCHART_LIMITS.maxText);
    expect(out.edges).toHaveLength(1);
    expect(Math.min(...out.nodes.map((n) => n.x))).toBe(400);
  });
});

describe("read-only flowchart", () => {
  test("renders a static, escaped SVG with a readable summary", () => {
    const data = serializeFlowchart(chart([node("a", 0, 0, { text: "<script>alert(1)</script>" }), node("b", 0, 120, { text: "Done" })], [["a", "b"]]));
    const html = renderToStaticMarkup(createElement(FlowchartStatic, { data, height: 440 }));
    expect(html).toContain("<svg");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toMatch(/aria-label="Flowchart with 2 shapes: [^"]*Done"/);
    expect(renderToStaticMarkup(createElement(FlowchartStatic, { data: "garbage", height: 440 }))).toContain("Empty flowchart");
  });
});
