// Frames and swimlanes in the flowchart editor: the layer draws pools, lanes and frames under the shapes with
// the attributes the interaction looks for, names each for screen readers and keeps them focusable; the
// editor's commits settle membership (a shape added over a lane joins it) and produce data the server accepts.
import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { addPool, flowchart, flowchartDataIssue, frameSelection, laneBoxes, serializeFlowchart, settleContainers, type FlowNode } from "@folevi/editor-schema";
import { ContainerLayer } from "@/components/editor/flowchart/layers/Containers";
import { addNode } from "@/components/editor/flowchart/ops";

const node = (id: string, x = 0, y = 0, extra: Partial<FlowNode> = {}): FlowNode => ({ id, shape: "process", x, y, w: 160, h: 64, text: id, color: "neutral", ...extra });

describe("the containers layer", () => {
  const base = flowchart({ nodes: [node("a", 40, 80), node("b", 300, 80)] });
  const framed = frameSelection(base, ["a", "b"], { title: "Checkout" })!;
  const pooled = addPool(framed.doc, { x: 0, y: 900 }, "rows", 2, { title: "Teams" })!;
  const fc = pooled.doc;

  test("draws pools, lanes and frames with their handles, names and focus", () => {
    const html = renderToStaticMarkup(createElement("svg", null, createElement(ContainerLayer, { fc, selected: [framed.id], renaming: null, onFocusBox: () => {} })));
    expect(html).toContain(`data-fc-box="${framed.id}"`);
    expect(html).toContain(`data-fc-grab="${framed.id}"`);
    expect(html).toContain('aria-label="Frame: Checkout, 2 shapes"');
    expect(html).toContain('aria-label="Swimlanes: Teams, 2 rows, empty"');
    expect(html).toContain('aria-label="Lane: Lane 1, empty, lane 1 of 2 in Teams"');
    expect(html.match(/tabindex="0"/g)).toHaveLength(4);
    expect(html).toContain('aria-pressed="true"');
    // Pools under frames: the pool comes first.
    expect(html.indexOf("fc-pool")).toBeLessThan(html.indexOf("fc-frame"));
  });

  test("hides the title being renamed and cuts long titles to fit", () => {
    const long = { ...fc, frames: fc.frames.map((f) => ({ ...f, w: 160, title: "A very long frame title that will not fit" })) };
    const html = renderToStaticMarkup(createElement("svg", null, createElement(ContainerLayer, { fc: long, selected: [], renaming: pooled.id, onFocusBox: () => {} })));
    expect(html).toMatch(/A very long[^<]*…<\/text>/);
    expect(html).not.toContain(">Teams</text>");
  });

  test("nothing at all for a chart without containers", () => {
    expect(renderToStaticMarkup(createElement("svg", null, createElement(ContainerLayer, { fc: base, selected: [], renaming: null, onFocusBox: () => {} })))).toBe("<svg></svg>");
  });
});

describe("committing edits with containers", () => {
  test("a shape added in a lane joins it and the result is valid", () => {
    const { doc } = addPool(flowchart(), { x: 0, y: 0 }, "columns", 3)!;
    const lane = laneBoxes(doc.pools[0]!)[1]!;
    const added = addNode(doc, "process", { x: lane.content.x + lane.content.w / 2, y: lane.content.y + 80 })!;
    const settled = settleContainers(doc, added.doc);
    expect(settled.nodes[0]!.parent).toBe(lane.lane.id);
    expect(flowchartDataIssue(serializeFlowchart(settled))).toBeNull();
  });
});
