// Walking a flowchart (flowchartPaths.ts): connector direction, where a walkthrough starts, branch order,
// paths between shapes and from a shape to its ends, the files a chart shows, and the SVG options the
// read-only views and exports use.
import { describe, expect, it } from "vitest";
import {
  blockFileIds,
  blocksFileIds,
  blocksToHtml,
  edgeDirection,
  flowGraph,
  flowStart,
  flowchart,
  flowchartDataToSvg,
  flowchartFileIds,
  newEdge,
  nextSteps,
  pathsBetween,
  pathsFrom,
  pathsUnion,
  serializeFlowchart,
  type FlowNode,
  type FlowShape,
} from "../src";

const node = (id: string, x: number, y: number, shape: FlowShape = "process", extra: Partial<FlowNode> = {}): FlowNode => ({ id, shape, x, y, w: 120, h: 56, text: id, color: "neutral", ...extra });
const edge = (id: string, from: string, to: string, label = "", extra = {}) => ({ ...newEdge(from, to, extra), id, labels: label ? [{ text: label, at: 0.5 }] : [] });

/**
 *   start
 *     |
 *   check? --No--> fix --(back to check)
 *     | Yes
 *   ship
 *     |
 *   done
 */
const branching = () =>
  flowchart({
    nodes: [node("start", 200, 0, "terminator"), node("check", 200, 120, "decision"), node("fix", 420, 120), node("ship", 200, 240), node("done", 200, 360, "terminator")],
    edges: [edge("e1", "start", "check"), edge("e2", "check", "ship", "Yes"), edge("e3", "check", "fix", "No"), edge("e4", "fix", "check"), edge("e5", "ship", "done")],
  });

describe("connector direction", () => {
  const byId = new Map([
    ["a", 1],
    ["b", 1],
  ]);
  it("leads from start to end, or backwards when only the start has a head", () => {
    expect(edgeDirection(edge("x", "a", "b"), byId)).toEqual({ from: "a", to: "b" });
    expect(edgeDirection(edge("x", "a", "b", "", { start: "arrow", end: "none" }), byId)).toEqual({ from: "b", to: "a" });
    expect(edgeDirection(edge("x", "a", "b", "", { start: "arrow", end: "arrow" }), byId)).toEqual({ from: "a", to: "b" });
    expect(edgeDirection(edge("x", "a", "b", "", { start: "none", end: "none" }), byId)).toEqual({ from: "a", to: "b" });
  });
  it("leads nowhere with a loose end, a missing shape or to itself", () => {
    expect(edgeDirection(edge("x", "a", ""), byId)).toBeNull();
    expect(edgeDirection(edge("x", "a", "zz"), byId)).toBeNull();
    expect(edgeDirection(edge("x", "a", "a"), byId)).toBeNull();
  });
});

describe("where a walkthrough starts", () => {
  it("prefers the shape asked for, then a start terminator nothing leads into", () => {
    const fc = branching();
    expect(flowStart(fc)).toBe("start");
    expect(flowStart(fc, "ship")).toBe("ship");
    expect(flowStart(fc, "nope")).toBe("start");
  });
  it("falls back to any source, then reading order; null when empty", () => {
    const fc = flowchart({ nodes: [node("b", 0, 200), node("a", 0, 0)], edges: [edge("e", "b", "a")] });
    expect(flowStart(fc)).toBe("b");
    const loop = flowchart({ nodes: [node("b", 0, 200), node("a", 0, 0)], edges: [edge("e1", "b", "a"), edge("e2", "a", "b")] });
    expect(flowStart(loop)).toBe("a");
    expect(flowStart(flowchart())).toBeNull();
  });
  it("skips notes and free text when choosing", () => {
    const fc = flowchart({ nodes: [node("n", 0, 0, "note"), node("p", 0, 200)] });
    expect(flowStart(fc)).toBe("p");
  });
});

describe("next steps", () => {
  it("lists a decision's branches in reading order with their labels", () => {
    const fc = branching();
    // Top-down chart: left to right across the flow (ship is under the decision, fix to its right).
    expect(nextSteps(fc, "check").map((s) => [s.to, s.label])).toEqual([
      ["ship", "Yes"],
      ["fix", "No"],
    ]);
    expect(nextSteps(fc, "done")).toEqual([]);
    expect(nextSteps(fc, "missing")).toEqual([]);
  });
  it("orders top to bottom in a sideways chart", () => {
    const fc = flowchart({
      nodes: [node("a", 0, 100), node("low", 300, 300), node("high", 300, 0), node("z", 600, 100)],
      edges: [edge("e1", "a", "low"), edge("e2", "a", "high"), edge("e3", "high", "z"), edge("e4", "low", "z")],
    });
    expect(nextSteps(fc, "a").map((s) => s.to)).toEqual(["high", "low"]);
  });
  it("follows reversed connectors and records both directions", () => {
    const fc = flowchart({ nodes: [node("a", 0, 0), node("b", 0, 200)], edges: [edge("e", "b", "a", "", { start: "arrow", end: "none" })] });
    const g = flowGraph(fc);
    expect(g.out.get("a")!.map((s) => s.to)).toEqual(["b"]);
    expect(g.in.get("b")!.map((s) => s.from)).toEqual(["a"]);
  });
});

describe("paths", () => {
  it("finds every path between two shapes, without going round loops", () => {
    const fc = branching();
    expect(pathsBetween(fc, "start", "done")).toEqual([{ nodes: ["start", "check", "ship", "done"], edges: ["e1", "e2", "e5"] }]);
    const two = flowchart({
      nodes: [node("a", 0, 0), node("b", -200, 150), node("c", 200, 150), node("d", 0, 300)],
      edges: [edge("1", "a", "b"), edge("2", "a", "c"), edge("3", "b", "d"), edge("4", "c", "d")],
    });
    expect(pathsBetween(two, "a", "d").map((p) => p.nodes)).toEqual([
      ["a", "b", "d"],
      ["a", "c", "d"],
    ]);
    expect(pathsBetween(two, "d", "a")).toEqual([]);
    expect(pathsBetween(two, "a", "a")).toEqual([{ nodes: ["a"], edges: [] }]);
    expect(pathsBetween(two, "a", "zz")).toEqual([]);
  });
  it("finds the paths from a shape to each end, stopping where a loop would come back", () => {
    const fc = branching();
    expect(pathsFrom(fc, "start")).toEqual([
      { nodes: ["start", "check", "ship", "done"], edges: ["e1", "e2", "e5"] },
      // The No branch ends where it would go back round to the check.
      { nodes: ["start", "check", "fix"], edges: ["e1", "e3"], loop: { edge: "e4", to: "check" } },
    ]);
    // From the fix step: back to the check, then on to the end (the loop isn't walked twice).
    expect(pathsFrom(fc, "fix").map((p) => p.nodes)).toEqual([["fix", "check", "ship", "done"]]);
    expect(pathsFrom(fc, "done")).toEqual([{ nodes: ["done"], edges: [] }]);
    const u = pathsUnion(pathsFrom(fc, "check"));
    expect([...u.nodes].sort()).toEqual(["check", "done", "fix", "ship"]);
    expect([...u.edges].sort()).toEqual(["e2", "e3", "e4", "e5"]);
  });
  it("stops at the limit on a chart with very many routes", () => {
    // A ladder of 12 diamonds: 2^12 routes from top to bottom.
    const nodes: FlowNode[] = [node("s0", 0, 0)];
    const edges = [];
    for (let i = 0; i < 12; i++) {
      nodes.push(node(`l${i}`, -150, 100 + i * 200), node(`r${i}`, 150, 100 + i * 200), node(`s${i + 1}`, 0, 200 + i * 200));
      edges.push(edge(`a${i}`, `s${i}`, `l${i}`), edge(`b${i}`, `s${i}`, `r${i}`), edge(`c${i}`, `l${i}`, `s${i + 1}`), edge(`d${i}`, `r${i}`, `s${i + 1}`));
    }
    const fc = flowchart({ nodes, edges });
    expect(pathsBetween(fc, "s0", "s12", { limit: 10 })).toHaveLength(10);
    expect(pathsFrom(fc, "s0").length).toBe(50);
  });
});

describe("files a chart shows", () => {
  const fc = flowchart({ nodes: [node("a", 0, 0, "process", { image: { fileId: "f1" } }), node("b", 0, 100, "process", { image: { fileId: "f1" } }), node("c", 0, 200, "process", { image: { fileId: "f2" } })] });
  it("lists each image's file once", () => {
    expect(flowchartFileIds(fc)).toEqual(["f1", "f2"]);
  });
  it("adds them to a block's own file", () => {
    expect(blockFileIds({ type: "flowchart", props: { data: serializeFlowchart(fc), height: 440 } })).toEqual(["f1", "f2"]);
    expect(blockFileIds({ type: "image", props: { fileId: "img" } })).toEqual(["img"]);
    expect(blockFileIds({ type: "paragraph", props: {} })).toEqual([]);
    expect(blockFileIds({ type: "flowchart", props: { data: "not json fileId" } })).toEqual([]);
    expect(blocksFileIds([{ type: "image", props: { fileId: "f2" } }, { type: "flowchart", props: { data: serializeFlowchart(fc) } }])).toEqual(["f2", "f1"]);
  });
});

describe("SVG options for read-only views and exports", () => {
  const fc = flowchart({ nodes: [node("a", 0, 0, "process", { image: { fileId: "f1" } })] });
  it("prefixes its ids", () => {
    const svg = flowchartDataToSvg(fc, { imageUrl: () => "https://x.test/a.png", idPrefix: "p7" });
    expect(svg).toContain('id="p7-clip-a"');
    expect(svg).toContain("url(#p7-clip-a)");
    expect(flowchartDataToSvg(fc, { imageUrl: () => "https://x.test/a.png", idPrefix: '"><script>' })).not.toContain("<script>");
  });
  it("loads images from the Mac library, object URLs and relative asset paths, never other schemes", () => {
    for (const url of ["app://folevi/_files/abc?type=image%2Fpng", "blob:https://app.folevi.com/1", "assets/f1-photo.png", "/files/f1", "data:image/png;base64,AAAA"]) {
      expect(flowchartDataToSvg(fc, { imageUrl: () => url })).toContain("<image ");
    }
    for (const url of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "app://other/x"]) {
      expect(flowchartDataToSvg(fc, { imageUrl: () => url })).not.toContain("<image ");
    }
  });
  it("exports a light and a dark picture in HTML, with the images", () => {
    const html = blocksToHtml([{ id: "b", type: "flowchart", parentId: null, rank: "a", schemaVersion: 1, text: [], props: { data: serializeFlowchart(fc), height: 440 } }], { title: "T", resolveFile: (id) => `assets/${id}.png` });
    expect(html).toContain('<figure class="flowchart"><svg class="fc-light"');
    expect(html).toContain('<svg class="fc-dark"');
    expect(html).toContain('href="assets/f1.png"');
    expect(html).toMatch(/prefers-color-scheme:dark\)\{[^}]*\.flowchart \.fc-light\{display:none\}/);
  });
});
