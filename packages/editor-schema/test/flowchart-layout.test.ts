// Tidy up and the placement helpers: no overlaps, fewer crossings than the v1 layout on the same charts,
// containers and swimlanes respected, decisions read Yes-down / No-aside, the arrangement kept when asked;
// align, distribute, smart guides and quick add.
import { beforeEach, describe, expect, it } from "vitest";
import {
  alignNodes,
  clearRouteCache,
  distributeNodes,
  flowchart,
  laneBoxes,
  layoutFlowchart,
  newEdge,
  quickAddPosition,
  quickAddSibling,
  rectsOverlap,
  routeFlowchart,
  smartGuides,
  type FlowchartData,
  type FlowNode,
  type Rect,
} from "../src";
import { fedge as edge, fnode as node, processChart } from "./support/flowchartFixtures";
import { layoutFlowchartV1 } from "./support/flowchartLayoutV1";

/** Charts that tangle easily: crossing-prone orders, a fork and join, a ladder. */
const handmade: Record<string, () => FlowchartData> = {
  "crossed pairs": () =>
    flowchart({
      nodes: ["a", "b", "c", "d", "w", "x", "y", "z"].map((id) => node(id)),
      edges: [edge("a", "z"), edge("b", "y"), edge("c", "x"), edge("d", "w"), edge("a", "w")],
    }),
  "fork and join": () =>
    flowchart({
      nodes: [
        node("s", "terminator"),
        ...["p1", "p2", "p3", "p4"].map((id) => node(id)),
        node("j", "process", "Join"),
        node("e", "terminator"),
      ],
      edges: [
        edge("s", "p3"),
        edge("s", "p1"),
        edge("s", "p4"),
        edge("s", "p2"),
        edge("p1", "j"),
        edge("p2", "j"),
        edge("p3", "j"),
        edge("p4", "j"),
        edge("j", "e"),
      ],
    }),
  ladder: () =>
    flowchart({
      nodes: ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4"].map((id) => node(id)),
      edges: [
        edge("a1", "a2"),
        edge("a2", "a3"),
        edge("a3", "a4"),
        edge("b1", "b2"),
        edge("b2", "b3"),
        edge("b3", "b4"),
        edge("a1", "b2"),
        edge("b1", "a2"),
        edge("a2", "b3"),
        edge("b2", "a3"),
        edge("a3", "b4"),
        edge("b3", "a4"),
      ],
    }),
};

const noOverlaps = (nodes: readonly Rect[]) => {
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) if (rectsOverlap(nodes[i]!, nodes[j]!)) return false;
  return true;
};
const centre = (n: Rect) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

beforeEach(() => clearRouteCache());

describe("Tidy up", () => {
  const fixtures: [string, FlowchartData][] = [
    ...Object.entries(handmade).map(([k, f]) => [k, f()] as [string, FlowchartData]),
    ...Array.from(
      { length: 16 },
      (_, i) =>
        [`process ${i + 1}`, processChart(i + 1, 14 + (i % 4) * 4)] as [string, FlowchartData],
    ),
  ];

  it("never overlaps shapes, in either direction", () => {
    for (const [name, fc] of fixtures) {
      for (const direction of ["TD", "LR"] as const) {
        const out = layoutFlowchart(fc, { direction });
        expect(noOverlaps(out.nodes), `${name} ${direction}`).toBe(true);
        expect(
          out.nodes.every(
            (n, i) =>
              n.w === fc.nodes[i]!.w && n.h === fc.nodes[i]!.h && n.x % 8 === 0 && n.y % 8 === 0,
          ),
        ).toBe(true);
      }
    }
  });

  it("crosses connectors less than the v1 layout did on the same charts", () => {
    let v1Total = 0;
    let v2Total = 0;
    let worse = 0;
    const rows: string[] = [];
    for (const [name, fc] of fixtures) {
      const v1 = routeFlowchart(layoutFlowchartV1(fc)).crossings;
      const v2 = routeFlowchart(layoutFlowchart(fc)).crossings;
      v1Total += v1;
      v2Total += v2;
      if (v2 > v1) worse++;
      rows.push(`${name}: v1 ${v1}, v2 ${v2}`);
    }
    console.info(`[layout] crossings v1 ${v1Total} → v2 ${v2Total}\n${rows.join("\n")}`);
    expect(v2Total).toBeLessThan(v1Total * 0.7);
    expect(worse).toBeLessThanOrEqual(Math.floor(fixtures.length / 8));
    for (const name of Object.keys(handmade)) {
      const fc = handmade[name]!();
      expect(routeFlowchart(layoutFlowchart(fc)).crossings, name).toBeLessThanOrEqual(
        routeFlowchart(layoutFlowchartV1(fc)).crossings,
      );
    }
  });

  it("keeps the main line straight and reads decisions Yes-down, No-aside", () => {
    const fc = flowchart({
      nodes: [
        node("start", "terminator"),
        node("collect"),
        node("ok", "decision", "In stock?"),
        node("ship"),
        node("order"),
        node("db", "database"),
        node("end", "terminator"),
      ],
      edges: [
        edge("start", "collect"),
        edge("collect", "ok"),
        edge("collect", "db"),
        edge("ok", "order", "No"),
        edge("ok", "ship", "Yes"),
        edge("order", "ok"),
        edge("ship", "end"),
      ],
    });
    const td = layoutFlowchart(fc);
    const at = (id: string) => centre(td.nodes.find((n) => n.id === id)!);
    for (const id of ["collect", "ok", "ship", "end"]) expect(at(id).x, id).toBe(at("start").x);
    expect(at("order").x).toBeGreaterThan(at("ship").x);
    expect(at("order").y).toBe(at("ship").y);
    const lr = layoutFlowchart(fc, { direction: "LR" });
    const lat = (id: string) => centre(lr.nodes.find((n) => n.id === id)!);
    expect(lat("ship").y).toBe(lat("ok").y);
    expect(lat("order").y).toBeGreaterThan(lat("ship").y);
    const routes = routeFlowchart(td);
    expect(routes.byId.get("ok-ship")!.fromSide).toBe("bottom");
    expect(routes.byId.get("ok-order")!.fromSide).toBe("right");
    expect(routes.byId.get("ok-ship")!.points).toHaveLength(2); // straight down
  });

  it("balances a fork between its branches", () => {
    const out = layoutFlowchart(handmade["fork and join"]!());
    const at = (id: string) => centre(out.nodes.find((n) => n.id === id)!);
    const branches = ["p1", "p2", "p3", "p4"].map((id) => at(id).x).sort((a, b) => a - b);
    expect(Math.abs(at("s").x - (branches[0]! + branches[3]!) / 2)).toBeLessThan(24);
    expect(Math.abs(at("j").x - at("s").x)).toBeLessThan(24);
    expect(new Set(["p1", "p2", "p3", "p4"].map((id) => at(id).y)).size).toBe(1);
  });

  it("lays shapes out inside their frames, frames clear of other shapes", () => {
    const fc = flowchart({
      nodes: [
        node("a"),
        node("b", "process", "b", { parent: "f1" }),
        node("c", "process", "c", { parent: "f1" }),
        node("d", "process", "d", { parent: "f2" }),
        node("e"),
      ],
      edges: [edge("a", "b"), edge("b", "c"), edge("c", "d"), edge("d", "e")],
      frames: [
        { id: "f1", x: 0, y: 0, w: 50, h: 50, title: "Outer", color: "green" },
        { id: "f2", x: 0, y: 0, w: 50, h: 50, title: "Inner", color: "blue", parent: "f1" },
      ],
    });
    for (const direction of ["TD", "LR"] as const) {
      const out = layoutFlowchart(fc, { direction });
      const f1 = out.frames.find((f) => f.id === "f1")!;
      const f2 = out.frames.find((f) => f.id === "f2")!;
      for (const id of ["b", "c"])
        expect(
          rectContains(
            f1,
            out.nodes.find((n) => n.id === id)!,
          ),
          `${direction} ${id}`,
        ).toBe(true);
      expect(
        rectContains(
          f2,
          out.nodes.find((n) => n.id === "d")!,
        ),
      ).toBe(true);
      expect(rectContains(f1, f2)).toBe(true);
      for (const id of ["a", "e"])
        expect(
          rectsOverlap(
            f1,
            out.nodes.find((n) => n.id === id)!,
          ),
          `${direction} ${id}`,
        ).toBe(false);
      expect(noOverlaps(out.nodes)).toBe(true);
      // Members don't sit under the title.
      for (const id of ["b", "c"])
        expect(out.nodes.find((n) => n.id === id)!.y).toBeGreaterThanOrEqual(f1.y + 32);
    }
  });

  it("keeps every shape in its swimlane, for rows and columns, in both directions", () => {
    for (const orient of ["rows", "columns"] as const) {
      for (const direction of ["TD", "LR"] as const) {
        const fc = flowchart({
          pools: [
            {
              id: "p",
              x: 100,
              y: 100,
              orient,
              title: "Teams",
              length: 600,
              lanes: [
                { id: "l1", title: "Customer", size: 120, color: "neutral" },
                { id: "l2", title: "Shop", size: 120, color: "blue" },
                { id: "l3", title: "Warehouse", size: 120, color: "neutral" },
              ],
            },
          ],
          nodes: [
            node("order", "terminator", "Order", { parent: "l1" }),
            node("pay", "process", "Pay", { parent: "l2" }),
            node("paid", "decision", "Paid?", { parent: "l2" }),
            node("pick", "process", "Pick", { parent: "l3" }),
            node("pack", "process", "Pack", { parent: "l3" }),
            node("get", "terminator", "Receive", { parent: "l1" }),
            node("note", "note", "Outside the pool"),
          ],
          edges: [
            edge("order", "pay"),
            edge("pay", "paid"),
            edge("paid", "pick", "Yes"),
            edge("paid", "order", "No"),
            edge("pick", "pack"),
            edge("pack", "get"),
            edge("note", "order"),
          ],
        });
        const out = layoutFlowchart(fc, { direction });
        const lanes = new Map(laneBoxes(out.pools[0]!).map((l) => [l.lane.id, l]));
        for (const n of out.nodes) {
          if (!n.parent) continue;
          const lane = lanes.get(n.parent)!;
          expect(rectContains(lane.content, n), `${orient} ${direction} ${n.id}`).toBe(true);
        }
        expect(noOverlaps(out.nodes), `${orient} ${direction}`).toBe(true);
        const pool = out.pools[0]!;
        const free = out.nodes.find((n) => n.id === "note")!;
        const pr = {
          x: pool.x,
          y: pool.y,
          w: orient === "rows" ? pool.length : pool.lanes.reduce((s, l) => s + l.size, 0),
          h: orient === "rows" ? 36 + pool.lanes.reduce((s, l) => s + l.size, 0) : 36 + pool.length,
        };
        expect(rectsOverlap(pr, free), `${orient} ${direction} free shape`).toBe(false);
      }
    }
  });

  it("keeps the current arrangement where it can", () => {
    // Already tidy, with branches in a chosen order: keepPlacement keeps the order.
    const fc = flowchart({
      nodes: [
        node("s", "process", "s", { x: 200, y: 0 }),
        node("right", "process", "r", { x: 400, y: 160 }),
        node("left", "process", "l", { x: 0, y: 160 }),
      ],
      edges: [edge("s", "left"), edge("s", "right")],
    });
    const kept = layoutFlowchart(fc, { keepPlacement: true });
    const x = (id: string) => kept.nodes.find((n) => n.id === id)!.x;
    expect(x("left")).toBeLessThan(x("right"));
    const flipped = layoutFlowchart(
      {
        ...fc,
        nodes: fc.nodes.map((n) =>
          n.id === "left" ? { ...n, x: 600 } : n.id === "right" ? { ...n, x: 0 } : n,
        ),
      },
      { keepPlacement: true },
    );
    const fx = (id: string) => flipped.nodes.find((n) => n.id === id)!.x;
    expect(fx("right")).toBeLessThan(fx("left"));
    // Stays where the chart was.
    expect(Math.min(...kept.nodes.map((n) => n.x))).toBe(0);
    expect(Math.min(...kept.nodes.map((n) => n.y))).toBe(0);
  });

  it("is deterministic and fast", () => {
    const fc = processChart(99, 200);
    const t0 = performance.now();
    const a = layoutFlowchart(fc);
    const ms = performance.now() - t0;
    expect(JSON.stringify(layoutFlowchart(fc))).toBe(JSON.stringify(a));
    expect(noOverlaps(a.nodes)).toBe(true);
    expect(ms).toBeLessThan(2000);
    console.info(
      `[bench] layout ${fc.nodes.length} shapes / ${fc.edges.length} connectors: ${ms.toFixed(1)} ms`,
    );
  });

  it("resets connector sides and bends of moved shapes, and leaves loose lines alone", () => {
    const fc = flowchart({
      nodes: [node("a"), node("b")],
      edges: [
        newEdge("a", "b", {
          id: "e",
          fromSide: "left",
          fromAt: 0.2,
          toSide: "right",
          bends: [{ x: 1, y: 2 }],
        }),
        newEdge("", "", { id: "loose", fromPoint: { x: 0, y: 0 }, toPoint: { x: 50, y: 50 } }),
      ],
    });
    const out = layoutFlowchart(fc);
    expect(out.edges[0]).toMatchObject({ bends: [] });
    expect(out.edges[0]!.fromSide).toBeUndefined();
    expect(out.edges[0]!.fromAt).toBeUndefined();
    expect(out.edges[1]).toEqual(fc.edges[1]);
  });
});

function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.w <= outer.x + outer.w + 0.5 &&
    inner.y + inner.h <= outer.y + outer.h + 0.5
  );
}

describe("align and distribute", () => {
  const fc = flowchart({
    nodes: [
      node("a", "process", "a", { x: 0, y: 10 }),
      node("b", "process", "b", { x: 300, y: 50, w: 200 }),
      node("c", "process", "c", { x: 900, y: 0, h: 100 }),
    ],
  });

  it("aligns edges and centres", () => {
    expect(alignNodes(fc, ["a", "b", "c"], "left").nodes.map((n) => n.x)).toEqual([0, 0, 0]);
    expect(alignNodes(fc, ["a", "b", "c"], "right").nodes.map((n) => n.x + n.w)).toEqual([
      1060, 1060, 1060,
    ]);
    expect(alignNodes(fc, ["a", "b", "c"], "middle").nodes.map((n) => n.y + n.h / 2)).toEqual([
      57, 57, 57,
    ]);
    expect(alignNodes(fc, ["a", "b"], "top").nodes.map((n) => n.y)).toEqual([10, 10, 0]);
    expect(alignNodes(fc, ["a"], "top")).toBe(fc);
  });

  it("distributes with equal gaps", () => {
    const out = distributeNodes(fc, ["a", "b", "c"], "horizontal");
    const [a, b, c] = out.nodes as [FlowNode, FlowNode, FlowNode];
    expect(b.x - (a.x + a.w)).toBe(c.x - (b.x + b.w));
    expect([a.x, c.x]).toEqual([0, 900]);
  });
});

describe("smart guides", () => {
  const others: Rect[] = [
    { x: 0, y: 0, w: 100, h: 50 },
    { x: 200, y: 0, w: 100, h: 50 },
    { x: 0, y: 200, w: 100, h: 50 },
  ];

  it("snaps to edges and centres within the threshold, with a guide over everything on the line", () => {
    const s = smartGuides({ x: 403, y: 197, w: 100, h: 50 }, others, 6);
    expect(s.dy).toBe(3);
    const g = s.guides.find((x) => x.kind === "align" && x.axis === "y")!;
    expect(g).toMatchObject({ at: 200 });
    if (g.kind === "align") expect([g.from, g.to]).toEqual([0, 503]);
  });

  it("snaps to equal spacing with neighbours in the same row", () => {
    // The gap between the first two is 100: dragging a third to the right of them snaps at 400.
    const s = smartGuides({ x: 396, y: 0, w: 100, h: 50 }, others, 6);
    expect(s.dx).toBe(4);
    const gap = s.guides.find((x) => x.kind === "gap");
    expect(gap).toBeTruthy();
    if (gap?.kind === "gap")
      expect(gap.gaps).toEqual([
        { from: 100, to: 200, at: 25 },
        { from: 300, to: 400, at: 25 },
      ]);
    // Centred between two.
    const mid = smartGuides(
      { x: 127, y: 0, w: 60, h: 50 },
      [others[0]!, { x: 220, y: 0, w: 100, h: 50 }],
      6,
    );
    expect(mid.dx).toBe(3); // centred: 130 is 30 from both
  });

  it("falls back to the grid", () => {
    expect(smartGuides({ x: 1003, y: 1013, w: 10, h: 10 }, others, 6)).toEqual({
      dx: -3,
      dy: 3,
      guides: [],
    });
    expect(smartGuides({ x: 1003, y: 1013, w: 10, h: 10 }, others, 6, { grid: 0 })).toEqual({
      dx: 0,
      dy: 0,
      guides: [],
    });
  });
});

describe("quick add", () => {
  it("puts the next shape one step out, then beside earlier branches, never on top of anything", () => {
    let fc = flowchart({ nodes: [node("a", "process", "a", { x: 0, y: 0 })] });
    const size = { w: 160, h: 64 };
    const p1 = quickAddPosition(fc, "a", "bottom", size);
    expect(p1).toEqual({ x: 0, y: 128 });
    fc = {
      ...fc,
      nodes: [...fc.nodes, node("b", "process", "b", { ...p1 })],
      edges: [edge("a", "b")],
    };
    const p2 = quickAddPosition(fc, "a", "bottom", size);
    expect(p2.y).toBe(128);
    expect(p2.x).toBeGreaterThanOrEqual(160 + 40);
    fc = {
      ...fc,
      nodes: [...fc.nodes, node("c", "process", "c", { ...p2 })],
      edges: [...fc.edges, edge("a", "c")],
    };
    const p3 = quickAddPosition(fc, "a", "right", size);
    expect(p3.y).toBe(0);
    expect(p3.x).toBeGreaterThan(160);
    // Something already where the shape would go: it moves along.
    const blocked = flowchart({
      nodes: [
        node("a", "process", "a", { x: 0, y: 0 }),
        node("x", "process", "x", { x: 0, y: 128 }),
      ],
    });
    const p4 = quickAddPosition(blocked, "a", "bottom", size);
    expect(rectsOverlap({ ...p4, ...size }, blocked.nodes[1]!)).toBe(false);
    for (const side of ["top", "left"] as const) {
      const p = quickAddPosition(fc, "a", side, size);
      expect(fc.nodes.some((n) => rectsOverlap(n, { ...p, ...size }))).toBe(false);
    }
  });

  it("adds a sibling branch beside a shape, from the shape before it", () => {
    const fc = flowchart({
      nodes: [
        node("a", "process", "a", { x: 0, y: 0 }),
        node("b", "process", "b", { x: 0, y: 128 }),
      ],
      edges: [edge("a", "b")],
    });
    const s = quickAddSibling(fc, "b", { w: 160, h: 64 });
    expect(s.parent).toBe("a");
    expect(s.y).toBe(128);
    expect(s.x).toBeGreaterThan(160);
    expect(quickAddSibling(fc, "a", { w: 160, h: 64 }).parent).toBeNull();
  });
});
