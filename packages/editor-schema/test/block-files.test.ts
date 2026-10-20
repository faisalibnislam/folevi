// The files a block shows, and pointing a block at other files (copies, pastes, moving a library).
import { describe, expect, it } from "vitest";
import { blockFileIds, flowchart, flowchartDataIssue, parseFlowchart, remapBlockFiles, remapFlowchartFiles, serializeFlowchart, type FlowNode } from "../src";

const node = (id: string, extra: Partial<FlowNode> = {}): FlowNode => ({ id, shape: "process", x: 0, y: 0, w: 160, h: 64, text: id, color: "neutral", ...extra });
const data = serializeFlowchart(flowchart({ nodes: [node("a1", { image: { fileId: "f_one" } }), node("b2", { image: { fileId: "f_two", fit: "contain" } }), node("c3")] }));

describe("remapping a block's files", () => {
  it("swaps the images inside a flowchart's shapes, keeping everything else", () => {
    const next = remapFlowchartFiles(data, (id) => (id === "f_one" ? "f_new" : null));
    expect(flowchartDataIssue(next)).toBeNull();
    const fc = parseFlowchart(next);
    expect(fc.nodes.map((n) => n.image?.fileId)).toEqual(["f_new", "f_two", undefined]);
    expect(fc.nodes[1]!.image?.fit).toBe("contain");
    expect(remapFlowchartFiles(data, () => null)).toBe(data);
    expect(remapFlowchartFiles("not json fileId", () => "x")).toBe("not json fileId");
  });

  it("drops images whose files didn't come along", () => {
    const next = remapFlowchartFiles(data, (id) => `${id}_x`, (id) => id === "f_two");
    const fc = parseFlowchart(next);
    expect(fc.nodes.map((n) => n.image?.fileId)).toEqual(["f_one_x", undefined, undefined]);
  });

  it("swaps a file block's own file, and a flowchart block's shapes", () => {
    const img = { type: "image", props: { fileId: "f_one", alt: "x" } };
    expect(remapBlockFiles(img, () => "f_new").props).toEqual({ fileId: "f_new", alt: "x" });
    expect(remapBlockFiles(img, () => null)).toBe(img);
    const chart = { type: "flowchart", props: { data, height: 440 } };
    const out = remapBlockFiles(chart, (id) => `${id}_copy`);
    expect(blockFileIds(out)).toEqual(["f_one_copy", "f_two_copy"]);
    expect(out.props.height).toBe(440);
    const para = { type: "paragraph", props: {} };
    expect(remapBlockFiles(para, () => "x")).toBe(para);
  });
});
