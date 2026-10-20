// Frames and swimlanes as edits: membership by where a shape is dropped, frames growing to hold their shapes,
// lanes keeping theirs inside, moving containers with their contents, nesting limits, adding, removing,
// reordering and resizing lanes; and every result passes the server's strict check.
import { describe, expect, it } from "vitest";
import {
  FLOWCHART_LANE_PAD,
  FLOWCHART_LIMITS,
  addFrame,
  addLane,
  addPool,
  boxAt,
  boxContents,
  boxKind,
  canNest,
  flowchart,
  flowchartDataIssue,
  frameSelection,
  laneBoxes,
  layoutFlowchart,
  minLaneSize,
  moveBoxes,
  moveLane,
  newEdge,
  removeBoxes,
  removeFrame,
  removeLane,
  removePool,
  renameBox,
  resizeFrame,
  resizeLane,
  resizePool,
  routeEdges,
  serializeFlowchart,
  setBoxColor,
  settleContainers,
  type FlowchartData,
  type FlowFrame,
  type FlowNode,
  type FlowPool,
  type Rect,
} from "../src";

const node = (id: string, x = 0, y = 0, extra: Partial<FlowNode> = {}): FlowNode => ({ id, shape: "process", x, y, w: 160, h: 64, text: id, color: "neutral", ...extra });
const frame = (id: string, x: number, y: number, w: number, h: number, extra: Partial<FlowFrame> = {}): FlowFrame => ({ id, x, y, w, h, title: id, color: "neutral", ...extra });
const pool = (id: string, x: number, y: number, orient: "rows" | "columns" = "rows", lanes = 2, size = 160, length = 880): FlowPool => ({
  id,
  x,
  y,
  orient,
  title: id,
  length,
  lanes: Array.from({ length: lanes }, (_, i) => ({ id: `${id}l${i}`, title: `Lane ${i + 1}`, size, color: "neutral" as const })),
});
const valid = (fc: FlowchartData) => expect(flowchartDataIssue(serializeFlowchart(fc))).toBeNull();
const n = (fc: FlowchartData, id: string) => fc.nodes.find((x) => x.id === id)!;
const f = (fc: FlowchartData, id: string) => fc.frames.find((x) => x.id === id)!;
const contains = (outer: Rect, inner: Rect) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const lane = (fc: FlowchartData, poolId: string, i: number) => laneBoxes(fc.pools.find((p) => p.id === poolId)!)[i]!;
const move = (fc: FlowchartData, id: string, dx: number, dy: number): FlowchartData => ({ ...fc, nodes: fc.nodes.map((x) => (x.id === id ? { ...x, x: x.x + dx, y: x.y + dy } : x)) });

describe("membership", () => {
  it("a shape dropped inside a frame joins it, and dragged out leaves it", () => {
    const start = flowchart({ nodes: [node("a", -400, 0)], frames: [frame("f", 0, 0, 400, 300)] });
    const inFrame = settleContainers(start, move(start, "a", 480, 100));
    expect(n(inFrame, "a").parent).toBe("f");
    valid(inFrame);
    const out = settleContainers(inFrame, move(inFrame, "a", 600, 0));
    expect(n(out, "a").parent).toBeUndefined();
    valid(out);
  });

  it("the innermost frame wins, and a frame grows to hold a shape that pokes out", () => {
    const start = flowchart({ nodes: [node("a", -400, 0)], frames: [frame("outer", 0, 0, 600, 400), frame("inner", 40, 60, 240, 200, { parent: "outer" })] });
    // Centre over the inner frame, but the shape pokes out of its right edge.
    const next = settleContainers(start, move(start, "a", 600, 100));
    expect(n(next, "a").parent).toBe("inner");
    expect(contains(f(next, "inner"), n(next, "a"))).toBe(true);
    expect(contains(f(next, "outer"), f(next, "inner"))).toBe(true);
    valid(next);
  });

  it("a new shape added over a lane joins it and is pulled fully inside", () => {
    const start = flowchart({ pools: [pool("p", 0, 0)] });
    const l1 = lane(start, "p", 1).content;
    // Half over the lane's lower edge.
    const added = { ...start, nodes: [node("a", l1.x + 40, l1.y + l1.h - 40)] };
    const next = settleContainers(start, added);
    expect(n(next, "a").parent).toBe("pl1");
    const box = lane(next, "p", 1).content;
    expect(contains(box, n(next, "a"))).toBe(true);
    valid(next);
  });

  it("a shape too tall for its lane grows the lane, and the lanes after it move along with their shapes", () => {
    const start = flowchart({ pools: [pool("p", 0, 0, "rows", 3, 96)], nodes: [node("b", 200, 36 + 96 * 2 + 16, { parent: "pl2", h: 64 })] });
    const l0 = lane(start, "p", 0).content;
    const added = { ...start, nodes: [...start.nodes, node("a", l0.x + 40, l0.y - 60, { h: 200 })] };
    const next = settleContainers(start, added);
    expect(next.pools[0]!.lanes[0]!.size).toBeGreaterThanOrEqual(200 + 2 * FLOWCHART_LANE_PAD);
    const grew = next.pools[0]!.lanes[0]!.size - 96;
    expect(n(next, "b").y).toBe(n(start, "b").y + grew);
    expect(contains(lane(next, "p", 2).content, n(next, "b"))).toBe(true);
    valid(next);
  });

  it("a shape past the end of a pool makes the pool longer", () => {
    const start = flowchart({ pools: [pool("p", 0, 0, "rows", 2, 160, 480)] });
    const added = { ...start, nodes: [node("a", 400, 36 + 40)] };
    const next = settleContainers(start, added);
    expect(next.pools[0]!.length).toBeGreaterThanOrEqual(400 + 160 + FLOWCHART_LANE_PAD);
    expect(contains(lane(next, "p", 0).content, n(next, "a"))).toBe(true);
  });

  it("moving with the keyboard steps a shape across a lane's edge into the next lane", () => {
    const start = flowchart({ pools: [pool("p", 0, 0, "rows", 2, 160)] });
    const c0 = lane(start, "p", 0).content;
    const at = { ...start, nodes: [node("a", c0.x + 40, c0.y + c0.h - FLOWCHART_LANE_PAD - 64, { parent: "pl0" })] };
    const pushed = move(at, "a", 0, 8);
    // A drag that lands against the edge stays in its lane, snapped back inside.
    expect(n(settleContainers(at, pushed), "a").parent).toBe("pl0");
    expect(n(settleContainers(at, pushed), "a").y).toBe(n(at, "a").y);
    // The same push from the keyboard steps into the lane below, just inside its top edge.
    const stepped = settleContainers(at, pushed, { stepAcross: true });
    expect(n(stepped, "a").parent).toBe("pl1");
    expect(n(stepped, "a").y).toBe(lane(stepped, "p", 1).content.y + FLOWCHART_LANE_PAD);
    // And back up again.
    const back = settleContainers(stepped, move(stepped, "a", 0, -8), { stepAcross: true });
    expect(n(back, "a").parent).toBe("pl0");
    expect(contains(lane(back, "p", 0).content, n(back, "a"))).toBe(true);
    valid(stepped);
  });

  it("dropping a shape on a lane's header puts it in that lane", () => {
    const start = flowchart({ pools: [pool("p", 0, 0)], nodes: [node("a", -500, 0)] });
    const h = lane(start, "p", 1).header;
    const next = settleContainers(start, { ...start, nodes: [node("a", h.x, h.y + 40)] });
    expect(n(next, "a").parent).toBe("pl1");
    expect(n(next, "a").x).toBeGreaterThanOrEqual(lane(next, "p", 1).content.x);
  });

  it("shapes that move with their frame keep their place in it, and edits that move nothing change nothing", () => {
    const start = flowchart({ nodes: [node("a", 40, 60, { parent: "f" })], frames: [frame("f", 0, 0, 400, 300)] });
    const moved = moveBoxes(start, ["f"], 1000, 0);
    expect(settleContainers(start, moved)).toBe(moved);
    expect(n(moved, "a").x).toBe(1040);
    const same = { ...start, nodes: start.nodes.map((x) => ({ ...x, text: "renamed" })) };
    expect(settleContainers(start, same)).toBe(same);
  });

  it("a frame dropped inside another nests, but never deeper than the limit", () => {
    const deep = FLOWCHART_LIMITS.maxFrameDepth;
    const frames: FlowFrame[] = [];
    for (let i = 0; i <= deep; i++) frames.push(frame(`f${i}`, i * 10, i * 10, 2000 - i * 20, 2000 - i * 20, i ? { parent: `f${i - 1}` } : {}));
    frames.push(frame("loose", 5000, 5000, 120, 80));
    const start = flowchart({ frames });
    expect(canNest(start, "loose", `f${deep}`)).toBe(false);
    expect(canNest(start, "loose", `f${deep - 1}`)).toBe(true);
    const dropped: FlowchartData = { ...start, frames: start.frames.map((x) => (x.id === "loose" ? { ...x, x: 900, y: 900 } : x)) };
    const next = settleContainers(start, dropped);
    expect(f(next, "loose").parent).toBe(`f${deep - 1}`);
    valid(next);
    // A frame can't go inside itself.
    expect(boxAt(start, f(start, "f1"), "f0")).toBeNull();
  });

  it("parents that no longer exist are forgotten, so the server accepts the write", () => {
    const start = flowchart({ nodes: [node("a")] });
    const broken = { ...start, nodes: [{ ...node("a"), parent: "gone" }] };
    const next = settleContainers(start, broken);
    expect(n(next, "a").parent).toBeUndefined();
    valid(next);
  });
});

describe("frames", () => {
  it("frames a selection with room and a title band, inside the frame the shapes shared", () => {
    const start = flowchart({ nodes: [node("a", 100, 100, { parent: "outer" }), node("b", 400, 100, { parent: "outer" }), node("c", 2000, 0)], frames: [frame("outer", 0, 0, 800, 400)] });
    const res = frameSelection(start, ["a", "b"], { title: "Checkout" })!;
    const fr = f(res.doc, res.id);
    expect(fr.parent).toBe("outer");
    expect(fr.title).toBe("Checkout");
    expect(n(res.doc, "a").parent).toBe(res.id);
    expect(n(res.doc, "b").parent).toBe(res.id);
    expect(contains(fr, n(res.doc, "a"))).toBe(true);
    expect(contains(fr, n(res.doc, "b"))).toBe(true);
    expect(n(res.doc, "a").y - fr.y).toBeGreaterThanOrEqual(32);
    // Committing it keeps the shapes where they are; the frame around grows to give the new one room.
    const settled = settleContainers(start, res.doc);
    expect(settled.nodes).toEqual(res.doc.nodes);
    expect(contains(f(settled, "outer"), f(settled, res.id))).toBe(true);
    valid(res.doc);
    valid(settled);
  });

  it("framing shapes from different places makes a top-level frame; framing a frame brings its contents", () => {
    const start = flowchart({ nodes: [node("a", 40, 60, { parent: "f" }), node("b", 1000, 0)], frames: [frame("f", 0, 0, 400, 300)] });
    const res = frameSelection(start, ["f", "a", "b"])!;
    expect(f(res.doc, res.id).parent).toBeUndefined();
    expect(f(res.doc, "f").parent).toBe(res.id);
    expect(n(res.doc, "a").parent).toBe("f");
    expect(n(res.doc, "b").parent).toBe(res.id);
    valid(res.doc);
  });

  it("moving a frame moves everything in it, nested frames and connector bends too", () => {
    const start = flowchart({
      nodes: [node("a", 40, 60, { parent: "inner" }), node("b", 40, 260, { parent: "f" }), node("c", 900, 0)],
      frames: [frame("f", 0, 0, 500, 400), frame("inner", 20, 40, 300, 160, { parent: "f" })],
      edges: [newEdge("a", "b", { id: "e1", bends: [{ x: 300, y: 200 }] }), newEdge("b", "c", { id: "e2", bends: [{ x: 600, y: 100 }] })],
    });
    const next = moveBoxes(start, ["f"], 100, 50);
    expect(n(next, "a")).toMatchObject({ x: 140, y: 110 });
    expect(n(next, "b")).toMatchObject({ x: 140, y: 310 });
    expect(n(next, "c")).toMatchObject({ x: 900, y: 0 });
    expect(f(next, "inner")).toMatchObject({ x: 120, y: 90 });
    expect(next.edges[0]!.bends).toEqual([{ x: 400, y: 250 }]);
    expect(next.edges[1]!.bends).toEqual([{ x: 600, y: 100 }]);
  });

  it("resizing a frame lets shapes out and takes shapes in", () => {
    const start = flowchart({ nodes: [node("in", 40, 60, { parent: "f" }), node("far", 300, 60, { parent: "f" }), node("beside", 600, 60)], frames: [frame("f", 0, 0, 500, 300)] });
    const smaller = resizeFrame(start, "f", { x: 0, y: 0, w: 240, h: 300 });
    expect(n(smaller, "in").parent).toBe("f");
    expect(n(smaller, "far").parent).toBeUndefined();
    const bigger = resizeFrame(start, "f", { x: 0, y: 0, w: 900, h: 300 });
    expect(n(bigger, "beside").parent).toBe("f");
    valid(smaller);
    valid(bigger);
  });

  it("deleting a frame keeps its contents (in the frame around it) or removes them with their connectors", () => {
    const start = flowchart({
      nodes: [node("a", 40, 60, { parent: "inner" }), node("b", 900, 0)],
      frames: [frame("outer", 0, 0, 800, 600), frame("inner", 20, 40, 300, 160, { parent: "outer" })],
      edges: [newEdge("a", "b", { id: "e1" })],
    });
    const kept = removeFrame(start, "inner", true);
    expect(kept.frames.map((x) => x.id)).toEqual(["outer"]);
    expect(n(kept, "a").parent).toBe("outer");
    expect(kept.edges).toHaveLength(1);
    valid(kept);
    const gone = removeFrame(start, "outer", false);
    expect(gone.frames).toEqual([]);
    expect(gone.nodes.map((x) => x.id)).toEqual(["b"]);
    expect(gone.edges).toEqual([]);
    valid(gone);
  });

  it("a new frame lands in the lane it is added over", () => {
    const start = flowchart({ pools: [pool("p", 0, 0, "rows", 2, 400)] });
    const c = lane(start, "p", 0).content;
    const res = addFrame(start, { x: c.x + 200, y: c.y + 150 }, { w: 240, h: 160 })!;
    expect(f(res.doc, res.id).parent).toBe("pl0");
    valid(res.doc);
  });

  it("titles and colours", () => {
    const start = flowchart({ frames: [frame("f", 0, 0, 400, 300)], pools: [pool("p", 0, 600)] });
    let fc = renameBox(start, "f", "  Checkout\nflow ");
    fc = renameBox(fc, "pl1", "Ops");
    fc = renameBox(fc, "p", "Teams");
    fc = setBoxColor(fc, "f", "green");
    fc = setBoxColor(fc, "pl0", "blue");
    expect(f(fc, "f")).toMatchObject({ title: "Checkout flow", color: "green" });
    expect(fc.pools[0]!.title).toBe("Teams");
    expect(fc.pools[0]!.lanes.map((l) => [l.title, l.color])).toEqual([
      ["Lane 1", "blue"],
      ["Ops", "neutral"],
    ]);
    expect(boxKind(fc, "pl1")).toBe("lane");
    valid(fc);
  });
});

describe("swimlanes", () => {
  it("adds a pool of rows or columns away from existing shapes", () => {
    const start = flowchart({ nodes: [node("a", 0, 0)] });
    const rows = addPool(start, { x: 80, y: 32 }, "rows", 3)!;
    const p = rows.doc.pools[0]!;
    expect(p.lanes).toHaveLength(3);
    expect(p.y).toBeGreaterThan(64);
    const cols = addPool(start, { x: 3000, y: 3000 }, "columns", 4)!;
    expect(cols.doc.pools[0]!.orient).toBe("columns");
    expect(cols.doc.pools[0]!.lanes).toHaveLength(4);
    valid(rows.doc);
    valid(cols.doc);
  });

  it("moving a pool moves every lane's shapes", () => {
    const start = flowchart({ pools: [pool("p", 0, 0)], nodes: [node("a", 150, 60, { parent: "pl0" }), node("b", 150, 220, { parent: "pl1" })] });
    const next = moveBoxes(start, ["pl1"], 40, 80);
    expect(next.pools[0]).toMatchObject({ x: 40, y: 80 });
    expect(n(next, "a")).toMatchObject({ x: 190, y: 140 });
    expect(n(next, "b")).toMatchObject({ x: 190, y: 300 });
    expect(settleContainers(start, next)).toBe(next);
  });

  it("adds a lane in the middle and the lanes after it move down with their shapes", () => {
    const start = flowchart({ pools: [pool("p", 0, 0)], nodes: [node("b", 150, 36 + 160 + 40, { parent: "pl1" })] });
    const res = addLane(start, "p", 1)!;
    expect(res.doc.pools[0]!.lanes.map((l) => l.id)).toEqual(["pl0", res.id, "pl1"]);
    expect(n(res.doc, "b").y).toBe(n(start, "b").y + 160);
    expect(res.doc.pools[0]!.lanes[1]!.title).toBe("Lane 3");
    valid(res.doc);
  });

  it("removes a lane keeping its shapes in the lane before it, or with them", () => {
    const start = flowchart({
      pools: [pool("p", 0, 0, "rows", 3)],
      nodes: [node("a", 200, 36 + 40, { parent: "pl0" }), node("b", 200, 36 + 160 + 40, { parent: "pl1" }), node("c", 200, 36 + 320 + 40, { parent: "pl2" })],
      edges: [newEdge("a", "b", { id: "e1" })],
    });
    const kept = removeLane(start, "pl1", true);
    expect(kept.pools[0]!.lanes.map((l) => l.id)).toEqual(["pl0", "pl2"]);
    expect(n(kept, "b").parent).toBe("pl0");
    expect(contains(lane(kept, "p", 0).content, n(kept, "b"))).toBe(true);
    expect(n(kept, "c").y).toBe(n(start, "c").y - 160);
    expect(kept.edges).toHaveLength(1);
    valid(kept);
    const first = removeLane(start, "pl0", true);
    expect(n(first, "a").parent).toBe("pl1");
    expect(contains(lane(first, "p", 0).content, n(first, "a"))).toBe(true);
    valid(first);
    const gone = removeLane(start, "pl1", false);
    expect(gone.nodes.map((x) => x.id)).toEqual(["a", "c"]);
    expect(gone.edges).toEqual([]);
    valid(gone);
    // The last lane takes the pool with it.
    const single = flowchart({ pools: [pool("q", 0, 0, "rows", 1)], nodes: [node("z", 200, 60, { parent: "ql0" })] });
    const none = removeLane(single, "ql0", true);
    expect(none.pools).toEqual([]);
    expect(n(none, "z").parent).toBeUndefined();
    valid(none);
  });

  it("reorders lanes, their shapes going with them", () => {
    const start = flowchart({ pools: [pool("p", 0, 0, "columns", 3, 240, 480)], nodes: [node("a", 40, 100, { parent: "pl0" }), node("c", 520, 100, { parent: "pl2" })] });
    const next = moveLane(start, "pl0", 1);
    expect(next.pools[0]!.lanes.map((l) => l.id)).toEqual(["pl1", "pl0", "pl2"]);
    expect(n(next, "a").x).toBe(280);
    expect(n(next, "c").x).toBe(520);
    expect(moveLane(next, "pl1", -1)).toBe(next);
    valid(next);
  });

  it("resizing a lane reflows its shapes to stay inside, and never cuts a shape", () => {
    const start = flowchart({ pools: [pool("p", 0, 0, "rows", 2, 240)], nodes: [node("a", 200, 36 + 160, { parent: "pl0" }), node("b", 200, 36 + 240 + 40, { parent: "pl1" })] });
    const next = resizeLane(start, "pl0", 120);
    expect(next.pools[0]!.lanes[0]!.size).toBe(120);
    expect(contains(lane(next, "p", 0).content, n(next, "a"))).toBe(true);
    expect(n(next, "b").y).toBe(n(start, "b").y - 120);
    const tiny = resizeLane(start, "pl0", 10);
    expect(tiny.pools[0]!.lanes[0]!.size).toBe(minLaneSize(start, "pl0"));
    expect(contains(lane(tiny, "p", 0).content, n(tiny, "a"))).toBe(true);
    valid(next);
    valid(tiny);
  });

  it("shortening a pool pulls shapes in from the end", () => {
    const start = flowchart({ pools: [pool("p", 0, 0, "rows", 2, 160, 1200)], nodes: [node("a", 900, 60, { parent: "pl0" })] });
    const next = resizePool(start, "p", 600);
    expect(next.pools[0]!.length).toBe(600);
    expect(contains(lane(next, "p", 0).content, n(next, "a"))).toBe(true);
    valid(next);
  });

  it("removing a pool keeps or deletes its shapes", () => {
    const start = flowchart({ pools: [pool("p", 0, 0)], nodes: [node("a", 200, 60, { parent: "pl0" })], frames: [frame("f", 200, 200, 240, 100, { parent: "pl1" })] });
    const kept = removePool(start, "p", true);
    expect(n(kept, "a").parent).toBeUndefined();
    expect(f(kept, "f").parent).toBeUndefined();
    valid(kept);
    const gone = removeBoxes(start, ["p"], false);
    expect(gone.nodes).toEqual([]);
    expect(gone.frames).toEqual([]);
    expect(boxContents(start, "p").nodes.has("a")).toBe(true);
    valid(gone);
  });

  it("Tidy up keeps every shape in its lane, and settling its result changes nothing", () => {
    const start = flowchart({
      pools: [pool("p", 0, 0, "rows", 3)],
      nodes: [node("a", 900, 900, { parent: "pl0" }), node("b", -200, 50, { parent: "pl1" }), node("c", 30, 400, { parent: "pl2" }), node("d", 400, 40, { parent: "pl1" })],
      edges: [newEdge("a", "b", { id: "e1" }), newEdge("b", "c", { id: "e2" }), newEdge("a", "d", { id: "e3" })],
    });
    const tidy = layoutFlowchart(start, { direction: "LR" });
    for (const [id, i] of [["a", 0], ["b", 1], ["c", 2], ["d", 1]] as const) {
      expect(n(tidy, id).parent).toBe(`pl${i}`);
      expect(contains(lane(tidy, "p", i).content, n(tidy, id))).toBe(true);
    }
    const settled = settleContainers(start, tidy);
    expect(settled.nodes.map((x) => [x.id, x.parent, x.x, x.y])).toEqual(tidy.nodes.map((x) => [x.id, x.parent, x.x, x.y]));
    valid(settled);
  });

  it("connectors between lanes and in and out of frames route through the container borders", () => {
    const fc = flowchart({
      pools: [pool("p", 0, 0, "rows", 2)],
      frames: [frame("f", 1200, 0, 400, 300)],
      nodes: [node("a", 200, 60, { parent: "pl0" }), node("b", 500, 36 + 160 + 40, { parent: "pl1" }), node("c", 1300, 120, { parent: "f" })],
      edges: [newEdge("a", "b", { id: "e1" }), newEdge("b", "c", { id: "e2" })],
    });
    const routed = routeEdges(fc);
    expect(routed).toHaveLength(2);
    for (const r of routed) {
      expect(r.points.length).toBeGreaterThanOrEqual(2);
      for (const p of r.points) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });
});
