// The connector editing logic behind the flowchart canvas (components/editor/flowchart/connectors.ts):
// snapping a dragged end, reconnecting and detaching, bend points, labels, styling many connectors at
// once, carrying bends along when shapes move, and keeping unchanged drawings identical between frames
// (with a frame budget for dragging a shape in a 200-shape chart).
import { describe, expect, test } from "vitest";
import { flowchart, flowchartDataIssue, newEdge, parseFlowchart, routeEdges, serializeFlowchart, type FlowchartData, type FlowEdge, type FlowNode } from "@folevi/editor-schema";

const C = await import("@/components/editor/flowchart/connectors");
const ops = await import("@/components/editor/flowchart/ops");

const node = (id: string, x = 0, y = 0, extra: Partial<FlowNode> = {}): FlowNode => ({ id, shape: "process", x, y, w: 160, h: 64, text: id, color: "neutral", ...extra });
const edge = (id: string, from: string, to: string, extra: Partial<FlowEdge> = {}): FlowEdge => newEdge(from, to, { id, ...extra });
const chart = (nodes: FlowNode[], edges: FlowEdge[] = []): FlowchartData => flowchart({ nodes, edges });

describe("snapping a dragged end", () => {
  const fc = chart([node("a", 0, 0), node("b", 0, 240)]);

  test("onto a connection point: that side, spread with the side's others", () => {
    expect(C.snapEnd(fc, { x: 84, y: 236 }, 1)).toEqual({ kind: "node", node: "b", side: "top", point: { x: 80, y: 240 } });
    // The points are screen-sized: zoomed out, a point further away (in chart units) still counts.
    expect(C.snapEnd(fc, { x: 100, y: 236 }, 0.5)).toMatchObject({ side: "top" });
    expect(C.snapEnd(fc, { x: 100, y: 236 }, 1)).toMatchObject({ side: "top", at: 0.625 });
  });

  test("onto the outline: that exact spot, pulled to quarter points", () => {
    const spot = C.snapEnd(fc, { x: 130, y: 242 }, 1);
    expect(spot).toMatchObject({ kind: "node", node: "b", side: "top", at: 0.813 });
    expect(spot.point.x).toBeCloseTo(130, 0);
    expect(spot.point.y).toBe(240);
    expect(C.snapEnd(fc, { x: 43, y: 241 }, 1)).toMatchObject({ side: "top", at: 0.25, point: { x: 40, y: 240 } });
    expect(C.snapEnd(fc, { x: 161, y: 292 }, 1)).toMatchObject({ side: "right", at: 0.813 });
  });

  test("inside the shape: the shape as a whole (the router picks the side)", () => {
    const t = C.snapEnd(fc, { x: 60, y: 270 }, 1);
    expect(t).toEqual({ kind: "node", node: "b", point: { x: 80, y: 272 } });
  });

  test("nowhere near a shape: a free end; the connector's other shape is skipped", () => {
    expect(C.snapEnd(fc, { x: 400.4, y: 100.6 }, 1)).toEqual({ kind: "free", point: { x: 400, y: 101 } });
    expect(C.snapEnd(fc, { x: 80, y: 30 }, 1, { exclude: "a" })).toEqual({ kind: "free", point: { x: 80, y: 30 } });
  });

  test("fingers get bigger targets", () => {
    expect(C.snapEnd(fc, { x: 104, y: 236 }, 1)).toMatchObject({ at: expect.any(Number) });
    expect(C.snapEnd(fc, { x: 104, y: 236 }, 1, { coarse: true })).toEqual({ kind: "node", node: "b", side: "top", point: { x: 80, y: 240 } });
  });
});

describe("reconnecting and detaching ends", () => {
  const e = edge("e", "a", "b", { fromSide: "bottom", toSide: "top", toAt: 0.25 });

  test("an end moves to another shape, side or spot, and old settings go", () => {
    expect(C.setEnd(e, "to", { kind: "node", node: "c", side: "left", point: { x: 0, y: 0 } })).toMatchObject({ to: "c", toSide: "left" });
    expect(C.setEnd(e, "to", { kind: "node", node: "c", side: "left", point: { x: 0, y: 0 } })!.toAt).toBeUndefined();
    const whole = C.setEnd(e, "to", { kind: "node", node: "c", point: { x: 0, y: 0 } })!;
    expect(whole.toSide).toBeUndefined();
    expect(whole.toAt).toBeUndefined();
    expect(C.setEnd(e, "from", { kind: "node", node: "c", side: "right", at: 0.3, point: { x: 0, y: 0 } })).toMatchObject({ from: "c", fromSide: "right", fromAt: 0.3, to: "b" });
  });

  test("an end let go in empty space floats free; attaching it again clears the point", () => {
    const free = C.setEnd(e, "to", { kind: "free", point: { x: 300.6, y: -20 } })!;
    expect(free).toMatchObject({ to: "", toPoint: { x: 301, y: -20 } });
    expect(free.toSide).toBeUndefined();
    const back = C.setEnd(free, "to", { kind: "node", node: "b", side: "top", point: { x: 0, y: 0 } })!;
    expect(back.toPoint).toBeUndefined();
    expect(back).toMatchObject({ to: "b", toSide: "top" });
    // Free ends survive saving.
    const fc = chart([node("a"), node("b", 0, 200)], [free]);
    const wire = serializeFlowchart(fc);
    expect(flowchartDataIssue(wire)).toBeNull();
    expect(parseFlowchart(wire).edges[0]).toMatchObject({ to: "", toPoint: { x: 301, y: -20 } });
  });

  test("never onto the shape at the other end", () => {
    expect(C.setEnd(e, "to", { kind: "node", node: "a", side: "top", point: { x: 0, y: 0 } })).toBeNull();
  });

  test("a new connector: to a shape or a point; the same connection twice is the existing one", () => {
    const fc = chart([node("a"), node("b", 0, 200)]);
    const one = C.newConnector(fc, "a", "bottom", { kind: "node", node: "b", side: "top", point: { x: 0, y: 0 } })!;
    expect(one.doc.edges[0]).toMatchObject({ from: "a", to: "b", fromSide: "bottom", toSide: "top" });
    expect(C.newConnector(one.doc, "a", "bottom", { kind: "node", node: "b", side: "top", point: { x: 0, y: 0 } })!.id).toBe(one.id);
    // A second one to another spot on the same side is a new connector (any number per side).
    expect(C.newConnector(one.doc, "a", "bottom", { kind: "node", node: "b", side: "top", at: 0.25, point: { x: 0, y: 0 } })!.doc.edges).toHaveLength(2);
    expect(C.newConnector(fc, "a", "right", { kind: "free", point: { x: 400, y: 0 } })!.doc.edges[0]).toMatchObject({ to: "", toPoint: { x: 400, y: 0 } });
    expect(C.newConnector(fc, "a", "right", { kind: "node", node: "a", point: { x: 0, y: 0 } })).toBeNull();
  });

  test("connectors on one side spread evenly along it", () => {
    const fc = chart([node("a", 0, 0), node("b", -200, 240), node("c", 0, 240), node("d", 200, 240)], [edge("1", "a", "b", { fromSide: "bottom" }), edge("2", "a", "c", { fromSide: "bottom" }), edge("3", "a", "d", { fromSide: "bottom" })]);
    const starts = routeEdges(fc).map((r) => r.points[0]!);
    expect(new Set(starts.map((p) => p.y))).toEqual(new Set([64]));
    const xs = starts.map((p) => p.x).sort((x, y) => x - y);
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!, 0);
    expect(xs[1]! - xs[0]!).toBeGreaterThan(20);
  });
});

describe("bend points", () => {
  const fc = chart([node("a", 0, 0), node("b", 400, 300)], [edge("e", "a", "b", { fromSide: "right", toSide: "top" })]);
  const route = routeEdges(fc)[0]!;

  test("a bend dragged out of the line goes in order among the others", () => {
    const e = { ...fc.edges[0]!, bends: [{ x: 300, y: 32 }] };
    expect(C.bendInsertIndex(e, route.points, { x: 200, y: 32 })).toBe(0);
    expect(C.bendInsertIndex(e, route.points, { x: 480, y: 200 })).toBe(1);
    expect(C.insertBend(e, 0, { x: 200.4, y: 31.6 }).bends).toEqual([{ x: 200, y: 32 }, { x: 300, y: 32 }]);
  });

  test("moving and removing bends", () => {
    const e = { ...fc.edges[0]!, bends: [{ x: 1, y: 2 }, { x: 3, y: 4 }] };
    expect(C.moveBend(e, 1, { x: 9, y: 9 }).bends).toEqual([{ x: 1, y: 2 }, { x: 9, y: 9 }]);
    expect(C.removeBend(e, 0).bends).toEqual([{ x: 3, y: 4 }]);
    expect(C.removeBend(e, 5)).toBe(e);
    expect(C.clearBends(chart([], [e]), ["e"]).edges[0]!.bends).toEqual([]);
  });

  test("a hollow add point in the middle of each stretch between stops", () => {
    expect(C.bendAddHandles(fc.edges[0]!, route.points)).toHaveLength(1);
    const bent = { ...fc.edges[0]!, bends: [{ x: 480, y: 32 }] };
    const r = routeEdges({ ...fc, edges: [bent] })[0]!;
    const handles = C.bendAddHandles(bent, r.points);
    expect(handles.map((h) => h.index)).toEqual([0, 1]);
  });

  test("a dragged bend lines up with its neighbours, or sits on the grid; ⌥ leaves it where it is", () => {
    expect(C.snapBend({ x: 203, y: 37 }, [{ x: 160, y: 32 }, { x: 480, y: 300 }], 8)).toEqual({ x: 200, y: 32 });
    expect(C.snapBend({ x: 477, y: 150 }, [{ x: 160, y: 32 }, { x: 480, y: 300 }], 8)).toEqual({ x: 480, y: 152 });
    expect(C.snapBend({ x: 203.4, y: 37.6 }, [{ x: 160, y: 32 }], 8, true)).toEqual({ x: 203, y: 38 });
  });

  test("routes pass through the bends, in order", () => {
    const bent = { ...fc.edges[0]!, bends: [{ x: 240, y: -80 }] };
    const r = routeEdges({ ...fc, edges: [bent] })[0]!;
    expect(r.points.some((p) => p.x === 240 && p.y === -80)).toBe(true);
  });

  test("moving shapes carries the bends and free ends of connectors that move with them", () => {
    const bent = chart([node("a", 0, 0), node("b", 400, 300), node("c", 800, 0)], [
      edge("both", "a", "b", { bends: [{ x: 240, y: 32 }] }),
      edge("one", "a", "c", { bends: [{ x: 600, y: -40 }] }),
      edge("free", "a", "", { toPoint: { x: -100, y: 200 } }),
    ]);
    const origin = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 400, y: 300 }],
    ]);
    const moved = ops.moveNodes(bent, origin, 40, 16);
    expect(moved.edges[0]!.bends).toEqual([{ x: 280, y: 48 }]);
    // Only one of its shapes moved: its bends stay.
    expect(moved.edges[1]).toBe(bent.edges[1]);
    expect(moved.edges[2]!.toPoint).toEqual({ x: -60, y: 216 });
    // Duplicating carries bends along with the copies.
    const dup = ops.duplicate(bent, ["a", "b"]);
    expect(dup.doc.edges.at(-1)!.bends).toEqual([{ x: 264, y: 56 }]);
  });
});

describe("labels", () => {
  const e = edge("e", "a", "b");

  test("several labels, each at its own place; the middle catches a dragged one", () => {
    const one = C.addLabel(e, 0.3)!;
    expect(one.index).toBe(0);
    const two = C.addLabel(C.setLabelText(one.edge, 0, "Yes"), 0.8)!;
    const labelled = C.setLabelText(two.edge, 1, "Later");
    expect(labelled.labels).toEqual([
      { text: "Yes", at: 0.3 },
      { text: "Later", at: 0.8 },
    ]);
    expect(C.moveLabel(labelled, 0, 0.52).labels[0]!.at).toBe(0.5);
    expect(C.moveLabel(labelled, 0, 0.66).labels[0]!.at).toBe(0.66);
    expect(C.moveLabel(labelled, 0, 0.3)).toBe(labelled);
    expect(C.removeLabel(labelled, 0).labels).toEqual([{ text: "Later", at: 0.8 }]);
  });

  test("writing on a connector without labels adds one halfway along; text stays one line", () => {
    expect(C.setLabelText(e, 0, "No").labels).toEqual([{ text: "No", at: 0.5 }]);
    expect(C.setLabelText(e, 0, "")).toBe(e);
    expect(C.setLabelText(C.setLabelText(e, 0, "a"), 0, "two\nlines").labels[0]!.text).toBe("two lines");
  });

  test("at most eight labels", () => {
    let x = e;
    for (let i = 0; i < 8; i++) x = C.setLabelText(C.addLabel(x, i / 10)!.edge, i, `L${i}`);
    expect(C.addLabel(x, 0.9)).toBeNull();
    expect(C.setLabelText(x, 8, "more")).toBe(x);
  });

  test("labels left empty go when writing ends; writing nothing records no change", () => {
    const before = chart([node("a"), node("b", 0, 200)], [e]);
    const added = C.addLabel(e, 0.4)!;
    const during = { ...before, edges: [added.edge] };
    expect(C.finishLabelEdit(during, before, "e")).toBe(before);
    const written = { ...before, edges: [C.setLabelText(added.edge, 0, "  Yes ")] };
    expect(C.finishLabelEdit(written, before, "e").edges[0]!.labels).toEqual([{ text: "Yes", at: 0.4 }]);
  });
});

describe("styling connectors together", () => {
  const fc = chart([node("a"), node("b", 0, 200), node("c", 300, 200)], [edge("1", "a", "b"), edge("2", "a", "c", { color: "blue" }), edge("3", "b", "c")]);

  test("route, heads, line, thickness and colour, for every listed connector", () => {
    const next = C.styleEdges(fc, ["1", "2"], { route: "curved", start: "circle", end: "diamond", style: "dotted", width: 4, color: "green" });
    for (const e of next.edges.slice(0, 2)) expect(e).toMatchObject({ route: "curved", start: "circle", end: "diamond", style: "dotted", width: 4, color: "green" });
    expect(next.edges[2]).toBe(fc.edges[2]);
    expect(C.styleEdges(fc, ["2"], { color: "neutral" }).edges[1]!.color).toBeUndefined();
    expect(C.styleEdges(fc, ["1"], { width: 40 }).edges[0]!.width).toBe(8);
    // Nothing changes: the very same chart (no undo step).
    expect(C.styleEdges(fc, ["1"], { route: "elbow" })).toBe(fc);
  });

  test("the shared value, or none when they differ", () => {
    expect(C.shared(fc.edges, (e) => e.route)).toBe("elbow");
    expect(C.shared(fc.edges, (e) => e.color ?? "neutral")).toBeNull();
    expect(C.shared([], (e) => e.route)).toBeNull();
  });

  test("turning connectors around swaps the ends; the line ends stay, so the arrow points the other way", () => {
    const e = edge("r", "a", "", { fromSide: "bottom", fromAt: 0.2, toPoint: { x: 5, y: 6 }, start: "none", end: "arrow", bends: [{ x: 1, y: 1 }, { x: 2, y: 2 }], labels: [{ text: "x", at: 0.25 }] });
    const r = C.reverseEdges(chart([node("a")], [e]), ["r"]).edges[0]!;
    expect(r).toMatchObject({ from: "", to: "a", toSide: "bottom", toAt: 0.2, fromPoint: { x: 5, y: 6 }, start: "none", end: "arrow", bends: [{ x: 2, y: 2 }, { x: 1, y: 1 }], labels: [{ text: "x", at: 0.75 }] });
    expect(r.fromSide).toBeUndefined();
    expect(r.toPoint).toBeUndefined();
  });

  test("reversing moves the arrowhead to the other shape, and twice is the original", () => {
    const fc = chart([node("a", 0, 0), node("b", 0, 240)], [edge("ab", "a", "b")]);
    const tip = (d: FlowchartData) => {
      const r = routeEdges(d)[0]!;
      return r.points[r.points.length - 1]!;
    };
    expect(tip(fc).y).toBe(240);
    const once = C.reverseEdges(fc, ["ab"]);
    expect(tip(once).y).toBe(64);
    expect(routeEdges(once)[0]!.d).not.toBe(routeEdges(fc)[0]!.d);
    expect(C.reverseEdges(once, ["ab"]).edges[0]).toEqual(fc.edges[0]);
    // It survives saving and loading.
    expect(parseFlowchart(serializeFlowchart(once)).edges[0]).toMatchObject({ from: "b", to: "a", end: "arrow" });
  });

  test("bends the route leaves out are dropped from the chart; useful ones stay", () => {
    // Left behind far to the side of two shapes now in line: the route would loop back over itself.
    const stale = chart([node("a", 0, 0), node("b", 0, 200)], [edge("e", "b", "a", { fromSide: "top", toSide: "bottom", bends: [{ x: -300, y: 82 }] })]);
    expect(C.dropIdleBends(stale).edges[0]!.bends).toEqual([]);
    // A point on the straight run and a repeat go too; a real detour stays.
    const onRun = chart([node("a", 0, 0), node("b", 0, 200)], [edge("e", "a", "b", { bends: [{ x: 80, y: 130 }] })]);
    expect(C.dropIdleBends(onRun).edges[0]!.bends).toEqual([]);
    const detour = chart([node("a", 0, 0), node("b", 400, 300)], [edge("e", "a", "b", { bends: [{ x: 300, y: 100 }] })]);
    expect(C.dropIdleBends(detour)).toBe(detour);
    const plain = chart([node("a"), node("b", 0, 200)], [edge("e", "a", "b")]);
    expect(C.dropIdleBends(plain)).toBe(plain);
  });

  test("strokes and dashes for the canvas", () => {
    expect(C.edgeStroke(undefined)).toBeUndefined();
    expect(C.edgeStroke("neutral")).toBeUndefined();
    expect(C.edgeStroke("blue")).toBe("var(--fc-blue)");
    expect(C.edgeStroke("#aa00ff")).toBe("#aa00ff");
    expect(C.edgeDash("solid", 2)).toBeUndefined();
    expect(C.edgeDash("dashed", 1.5)).toBe("7 6.1");
    expect(C.edgeDash("dotted", 4)).toMatch(/^0\.1 /);
  });
});

/** A chart of `n` shapes on a grid with `m` connectors, mostly between neighbours. */
function big(n = 200, m = 300): FlowchartData {
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const nodes = Array.from({ length: n }, (_, i) => node(`n${i}`, (i % 16) * 240, Math.floor(i / 16) * 180));
  const edges: FlowEdge[] = [];
  for (let k = 0; edges.length < m && k < m * 8; k++) {
    const a = Math.floor(rnd() * n);
    const b = rnd() < 0.85 ? a + [1, 16, 17][Math.floor(rnd() * 3)]! : Math.floor(rnd() * n);
    if (b >= n || a === b) continue;
    edges.push(edge(`e${edges.length}`, `n${a}`, `n${b}`));
  }
  return chart(nodes, edges);
}

describe("drawing only what changed", () => {
  test("unchanged connectors keep last frame's drawing; moved ones get a new one", () => {
    const fc = chart([node("a"), node("b", 0, 240), node("c", 600, 0), node("d", 600, 240)], [edge("ab", "a", "b"), edge("cd", "c", "d")]);
    const first = C.stableRouted(new Map(), routeEdges(fc));
    const prev = new Map(first.map((r) => [r.edge.id, r]));
    const same = C.stableRouted(prev, routeEdges({ ...fc }));
    expect(same[0]).toBe(first[0]);
    expect(same[1]).toBe(first[1]);
    const moved = ops.moveNodes(fc, new Map([["b", { x: 0, y: 240 }]]), 40, 0);
    const next = C.stableRouted(prev, routeEdges(moved));
    expect(next[0]).not.toBe(first[0]);
    expect(next[1]).toBe(first[1]);
    // A style change is a new drawing even when the path is the same.
    const styled = C.styleEdges(fc, ["cd"], { color: "pink" });
    expect(C.stableRouted(prev, routeEdges(styled))[1]).not.toBe(first[1]);
  });

  test("dragging a shape in a 200-shape chart: within a frame, redrawing only nearby connectors", () => {
    let fc = big();
    let prev = new Map(C.stableRouted(new Map(), routeEdges(fc)).map((r) => [r.edge.id, r]));
    const origin = new Map([["n37", { x: fc.nodes[37]!.x, y: fc.nodes[37]!.y }]]);
    const base = fc;
    const frames: number[] = [];
    let redrawn = 0;
    for (let f = 1; f <= 40; f++) {
      fc = ops.moveNodes(base, origin, f * 4, f * 2);
      const t0 = performance.now();
      const next = C.stableRouted(prev, routeEdges(fc));
      frames.push(performance.now() - t0);
      redrawn += next.filter((r) => prev.get(r.edge.id) !== r).length;
      prev = new Map(next.map((r) => [r.edge.id, r]));
    }
    frames.sort((a, b) => a - b);
    const median = frames[Math.floor(frames.length / 2)]!;
    console.info(`[bench] connector layer, drag in 200 shapes / 300 connectors: median ${median.toFixed(2)} ms, worst ${frames.at(-1)!.toFixed(2)} ms, ${(redrawn / frames.length).toFixed(1)} connectors redrawn per frame`);
    expect(redrawn / frames.length).toBeLessThan(40);
    // Generous for slow CI machines; typically well under 10 ms.
    expect(median).toBeLessThan(25);
  });
});

describe("connectors from the keyboard", () => {
  const fc = chart(
    [node("a", 0, 0, { text: "Start" }), node("b", 0, 240, { text: "Check" }), node("c", 300, 240, { text: "" }), node("d", 300, 0, { text: "Back" })],
    [edge("e1", "a", "b", { labels: [{ text: "Yes", at: 0.5 }] }), edge("e2", "d", "a"), edge("e3", "a", "c"), newEdge("b", "", { id: "e4", toPoint: { x: 0, y: 600 } })],
  );
  const byId = new Map(fc.nodes.map((n) => [n.id, n]));

  test("name says where a connector goes and what it says", () => {
    expect(C.connectorName(fc.edges[0]!, byId)).toBe("Connector from Start to Check, Yes");
    expect(C.connectorName(fc.edges[2]!, byId)).toBe("Connector from Start to an empty process");
    expect(C.connectorName(fc.edges[3]!, byId)).toBe("Connector from Check to a point");
  });

  test("] steps through a shape's connectors: leaving it first, then arriving, wrapping round", () => {
    const list = C.connectorsOf(fc, "a");
    expect(list).toEqual(["e1", "e3", "e2"]);
    expect(C.stepConnector(list, null, 1)).toBe("e1");
    expect(C.stepConnector(list, null, -1)).toBe("e2");
    expect(C.stepConnector(list, "e1", 1)).toBe("e3");
    expect(C.stepConnector(list, "e2", 1)).toBe("e1");
    expect(C.stepConnector(list, "e1", -1)).toBe("e2");
    expect(C.stepConnector([], null, 1)).toBeNull();
  });

  test("a change in the connector bar is said in words", () => {
    expect(C.describeEdgeStyle({ route: "curved" }, 1)).toBe("Route curved.");
    expect(C.describeEdgeStyle({ end: "open" }, 3)).toBe("End open arrow, 3 connectors.");
    expect(C.describeEdgeStyle({ width: 4 }, 1)).toBe("Thick line.");
    expect(C.describeEdgeStyle({ color: "neutral" }, 1)).toBe("Colour grey.");
  });
});
