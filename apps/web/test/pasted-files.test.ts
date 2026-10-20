// Blocks pasted from another note get file rows of this note (files.shareForPaste): an image block's own file
// and the images inside a pasted flowchart's shapes (components/editor/pastedFiles.ts).
import { describe, expect, test, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { blockFileIds, flowchart, serializeFlowchart, type WireBlock } from "@folevi/editor-schema";

vi.mock("@/components/editor/richRender", () => ({ renderMermaid: vi.fn(), svgDataUrl: (s: string) => s, onThemeChange: () => () => {}, loadKatex: vi.fn(), renderLatex: vi.fn() }));

const { ALL_MARKS, ALL_NODES } = await import("@/components/editor/extensions");
const { blocksToDoc } = await import("@/components/editor/convert");
const { adoptedAttrs, pastedFiles } = await import("@/components/editor/pastedFiles");

const block = (id: string, type: string, props: Record<string, unknown>, rank: string): WireBlock => ({ id, type, parentId: null, rank, schemaVersion: 1, text: [], props });
const chart = serializeFlowchart(flowchart({ nodes: [{ id: "a1", shape: "process", x: 0, y: 0, w: 160, h: 120, text: "Photo", color: "neutral", image: { fileId: "f_shape" } }] }));

describe("pasted files", () => {
  test("lists the files of blocks that weren't there before, flowchart shapes included, and points them at this note's copies", () => {
    const blocks = [
      block("01JAPASTE00000000000000001", "paragraph", {}, "a"),
      block("01JAPASTE00000000000000002", "image", { fileId: "f_image", alt: "", caption: "" }, "b"),
      block("01JAPASTE00000000000000003", "flowchart", { data: chart, height: 440 }, "c"),
    ];
    const ed = new Editor({ element: document.createElement("div"), extensions: [...ALL_NODES, ...ALL_MARKS], content: blocksToDoc(blocks) });
    const found = pastedFiles(ed.state.doc, new Set(["01JAPASTE00000000000000001"]));
    expect([...found.entries()]).toEqual([
      ["01JAPASTE00000000000000002", ["f_image"]],
      ["01JAPASTE00000000000000003", ["f_shape"]],
    ]);
    expect(pastedFiles(ed.state.doc, new Set(blocks.map((b) => b.id))).size).toBe(0);

    const map = { f_image: "f_image_here", f_shape: "f_shape_here" };
    const nodes: Record<string, unknown>[] = [];
    ed.state.doc.forEach((n) => {
      const attrs = adoptedAttrs(n, map);
      if (attrs) nodes.push({ type: n.type.name, ...attrs });
    });
    expect(nodes.map((n) => n.type)).toEqual(["image", "flowchart"]);
    expect(nodes[0]!.fileId).toBe("f_image_here");
    expect(blockFileIds({ type: "flowchart", props: nodes[1]! })).toEqual(["f_shape_here"]);
    // Nothing to change when the server kept the files as they were.
    ed.state.doc.forEach((n) => expect(adoptedAttrs(n, {})).toBeNull());
    ed.destroy();
  });
});
