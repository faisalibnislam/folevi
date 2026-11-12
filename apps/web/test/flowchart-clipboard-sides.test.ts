// Copying and pasting shapes (flowchart/ops.ts: copySelection, pasteChart) and connectors that turn to face
// shapes after a move (flowchart/connectors.ts: resideAfterMove, used by ops.moveNodes).
import { describe, expect, test } from "vitest";
import { flowchart, flowchartDataIssue, newEdge, serializeFlowchart, type FlowchartData, type FlowEdge, type FlowNode } from "@folevi/editor-schema";

const ops = await import("@/components/editor/flowchart/ops");

const node = (id: string, x = 0, y = 0, extra: Partial<FlowNode> = {}): FlowNode => ({ id, shape: "process", x, y, w: 160, h: 64, text: id, color: "neutral", ...extra });
const edge = (id: string, from: string, to: string, extra: Partial<FlowEdge> = {}): FlowEdge => newEdge(from, to, { id, ...extra });
const chart = (nodes: FlowNode[], edges: FlowEdge[] = []): FlowchartData => flowchart({ nodes, edges });

describe("copy and paste", () => {
  const fc = chart([node("a", 0, 0, { parent: "frame1" }), node("b", 0, 240), node("c", 400, 0)], [edge("ab", "a", "b", { bends: [{ x: 40, y: 120 }] }), edge("bc", "b", "c")]);

  test("Copy takes the selected shapes and the connectors between them, out of their frame", () => {
    const clip = ops.copySelection(fc, { nodes: ["a", "b"], edges: [] })!;
    expect(clip.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(clip.nodes[0]!.parent).toBeUndefined();
    expect(clip.edges.map((e) => e.id)).toEqual(["ab"]);
    expect(ops.copySelection(fc, { nodes: [], edges: ["ab"] })).toBeNull();
  });

  test("Paste adds them with new ids, moved together, connectors and bends included", () => {
    const clip = ops.copySelection(fc, { nodes: ["a", "b"], edges: [] })!;
    const res = ops.pasteChart(fc, clip, 24, 24)!;
    expect(res.doc.nodes).toHaveLength(5);
    expect(res.ids).toHaveLength(2);
    expect(new Set(res.doc.nodes.map((n) => n.id)).size).toBe(5);
    const [a2, b2] = res.ids.map((id) => res.doc.nodes.find((n) => n.id === id)!);
    expect([a2!.x, a2!.y, b2!.x, b2!.y]).toEqual([24, 24, 24, 264]);
    const added = res.doc.edges.filter((e) => !fc.edges.some((o) => o.id === e.id));
    expect(added).toHaveLength(1);
    expect([added[0]!.from, added[0]!.to]).toEqual(res.ids);
    expect(added[0]!.bends).toEqual([{ x: 64, y: 144 }]);
    // What was there is untouched, and the result is a chart the schema accepts.
    expect(res.doc.nodes.slice(0, 3)).toEqual(fc.nodes);
    // (The fixture's frame doesn't exist, so the original shape's place in it is set aside for this check.)
    expect(flowchartDataIssue(serializeFlowchart({ ...res.doc, nodes: res.doc.nodes.map(({ parent: _parent, ...n }) => n) }))).toBeNull();
  });

  test("a full chart takes nothing more", () => {
    const many = chart(Array.from({ length: 500 }, (_, i) => node(`n${i}`, i * 10, 0)));
    expect(ops.pasteChart(many, chart([node("x")]), 0, 0)).toBeNull();
  });
});

describe("connectors after a move", () => {
  const down = chart([node("a", 0, 0), node("b", 0, 240)], [edge("ab", "a", "b", { fromSide: "bottom", toSide: "top" })]);
  const move = (fc: FlowchartData, id: string, dx: number, dy: number) => {
    const n = fc.nodes.find((x) => x.id === id)!;
    return ops.moveNodes(fc, new Map([[id, { x: n.x, y: n.y }]]), dx, dy);
  };
  const sides = (fc: FlowchartData) => [fc.edges[0]!.fromSide, fc.edges[0]!.toSide];

  test("a shape nudged about keeps its connector's sides", () => {
    expect(sides(move(down, "b", 60, 20))).toEqual(["bottom", "top"]);
  });

  test("moved up beside the other shape, the connector faces it instead of going round", () => {
    expect(sides(move(down, "b", 400, -220))).toEqual(["right", "left"]);
    expect(sides(move(down, "b", 0, -480))).toEqual(["top", "bottom"]);
  });

  test("a connector that already doubled back (a loop drawn on purpose) is left alone", () => {
    const loop = chart([node("a", 0, 240), node("b", 0, 0)], [edge("ab", "a", "b", { fromSide: "bottom", toSide: "top" })]);
    expect(sides(move(loop, "b", 300, 0))).toEqual(["bottom", "top"]);
  });

  test("so is one with bend points of its own", () => {
    const bent = chart(down.nodes, [edge("ab", "a", "b", { fromSide: "bottom", toSide: "top", bends: [{ x: 300, y: 100 }] })]);
    expect(sides(move(bent, "b", 400, -220))).toEqual(["bottom", "top"]);
  });
});
