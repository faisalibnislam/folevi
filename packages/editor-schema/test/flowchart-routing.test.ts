// Connector routing: routes keep clear of shapes, ends spread along sides in order, crossings are found for
// hops, results are deterministic, and re-routing while dragging only redoes what changed (benchmarks).
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRouteCache,
  edgeSides,
  flowchart,
  newEdge,
  orthogonalRoute,
  polylinePath,
  resolveEnds,
  routeEdges,
  routeFlowchart,
  type FlowchartData,
  type FlowEdge,
  type FlowNode,
  type Pt,
  type Rect,
} from "../src";

const node = (id: string, x = 0, y = 0, extra: Partial<FlowNode> = {}): FlowNode => ({
  id,
  shape: "process",
  x,
  y,
  w: 160,
  h: 64,
  text: id,
  color: "neutral",
  ...extra,
});

/** A seeded random number generator (mulberry32), so property tests are repeatable. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A chart of `n` shapes scattered on a loose grid (no overlaps) and `m` random connectors. */
function scattered(
  seed: number,
  n: number,
  m: number,
  cols = Math.ceil(Math.sqrt(n)),
): FlowchartData {
  const r = rng(seed);
  const shapes = [
    "process",
    "decision",
    "terminator",
    "io",
    "document",
    "database",
    "rounded",
    "circle",
  ] as const;
  const nodes: FlowNode[] = Array.from({ length: n }, (_, i) => {
    const shape = shapes[Math.floor(r() * shapes.length)]!;
    const w = shape === "circle" ? 96 : 120 + Math.floor(r() * 5) * 16;
    const h = shape === "circle" ? 96 : 56 + Math.floor(r() * 3) * 16;
    return node(
      `n${i}`,
      (i % cols) * 260 + Math.floor(r() * 40),
      Math.floor(i / cols) * 200 + Math.floor(r() * 40),
      { shape, w, h },
    );
  });
  const edges: FlowEdge[] = [];
  for (let k = 0; edges.length < m && k < m * 4; k++) {
    const a = Math.floor(r() * n);
    // Mostly near neighbours, sometimes far across the chart.
    const b =
      r() < 0.8
        ? Math.min(
            n - 1,
            Math.max(0, a + [1, -1, cols, -cols, cols + 1, cols - 1][Math.floor(r() * 6)]!),
          )
        : Math.floor(r() * n);
    if (a === b) continue;
    edges.push(newEdge(`n${a}`, `n${b}`, { id: `e${edges.length}` }));
  }
  return flowchart({ nodes, edges });
}

const hits = (a: Pt, b: Pt, r: Rect, inset: number) => {
  const x0 = r.x + inset;
  const x1 = r.x + r.w - inset;
  const y0 = r.y + inset;
  const y1 = r.y + r.h - inset;
  if (Math.abs(a.y - b.y) < 0.01)
    return a.y > y0 && a.y < y1 && Math.max(a.x, b.x) > x0 && Math.min(a.x, b.x) < x1;
  if (Math.abs(a.x - b.x) < 0.01)
    return a.x > x0 && a.x < x1 && Math.max(a.y, b.y) > y0 && Math.min(a.y, b.y) < y1;
  return false;
};

beforeEach(() => clearRouteCache());

describe("orthogonal routes", () => {
  it("never pass through a shape (property test over random charts)", () => {
    let checked = 0;
    let blocked = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const fc = scattered(seed, 30, 45);
      const res = routeFlowchart(fc);
      for (const r of res.routes) {
        const p = r.points;
        for (let i = 1; i < p.length; i++) {
          const a = p[i - 1]!;
          const b = p[i]!;
          // Right angles only.
          expect(
            Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01,
            `${seed}/${r.edge.id}`,
          ).toBe(true);
          for (const n of fc.nodes) {
            // A connector's own shapes are only touched by the run straight out of their side.
            const own = n.id === r.edge.from || n.id === r.edge.to;
            if (own && (i === 1 || i === p.length - 1)) continue;
            checked++;
            if (hits(a, b, n, 1)) blocked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
    expect(blocked).toBe(0);
  });

  it("go around a shape in the way with few bends, and leave and enter straight through their sides", () => {
    const fc = flowchart({
      nodes: [node("a", 0, 0), node("wall", -40, 140, { w: 240 }), node("b", 0, 300)],
      edges: [newEdge("a", "b", { id: "e" })],
    });
    const [r] = routeFlowchart(fc).routes;
    const p = r!.points;
    expect(p[0]).toEqual({ x: 80, y: 64 });
    expect(p[p.length - 1]).toEqual({ x: 80, y: 300 });
    expect(p[1]!.x).toBe(80); // straight out of the bottom
    expect(p[p.length - 2]!.x).toBe(80); // straight into the top
    expect(p.length - 2).toBeLessThanOrEqual(4); // at most four bends around the wall
    for (let i = 1; i < p.length; i++) expect(hits(p[i - 1]!, p[i]!, fc.nodes[1]!, 0)).toBe(false);
  });

  it("go straight between shapes that line up, even when their centres are a few pixels apart", () => {
    const fc = flowchart({
      nodes: [node("a", 0, 0, { shape: "terminator", h: 56 }), node("b", 240, -4)],
      edges: [newEdge("a", "b", { id: "e" })],
    });
    const [r] = routeFlowchart(fc).routes;
    expect(r!.points).toHaveLength(2);
    expect(r!.points[0]!.y).toBe(r!.points[1]!.y);
  });

  it("pass through bend points in order", () => {
    const bends = [
      { x: 400, y: 40 },
      { x: 400, y: 400 },
    ];
    const fc = flowchart({
      nodes: [node("a"), node("b", 0, 300)],
      edges: [newEdge("a", "b", { id: "e", bends })],
    });
    const [r] = routeFlowchart(fc).routes;
    // Where along the route each bend point is (it may sit in the middle of a straight run).
    const along = (q: Pt) => {
      let walked = 0;
      const p = r!.points;
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1]!;
        const b = p[i]!;
        const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
        const onSeg =
          (Math.abs(a.x - b.x) < 0.01 &&
            Math.abs(q.x - a.x) < 0.01 &&
            q.y >= Math.min(a.y, b.y) &&
            q.y <= Math.max(a.y, b.y)) ||
          (Math.abs(a.y - b.y) < 0.01 &&
            Math.abs(q.y - a.y) < 0.01 &&
            q.x >= Math.min(a.x, b.x) &&
            q.x <= Math.max(a.x, b.x));
        if (onSeg) return walked + Math.abs(q.x - a.x) + Math.abs(q.y - a.y);
        walked += len;
      }
      return -1;
    };
    expect(along(bends[0]!)).toBeGreaterThan(0);
    expect(along(bends[1]!)).toBeGreaterThan(along(bends[0]!));
  });

  it("end at free points", () => {
    const fc = flowchart({
      nodes: [node("a")],
      edges: [
        newEdge("a", "", { id: "e", toPoint: { x: 500, y: 300 } }),
        newEdge("", "", { id: "f", fromPoint: { x: -100, y: 0 }, toPoint: { x: -100, y: 200 } }),
      ],
    });
    const res = routeFlowchart(fc);
    expect(res.byId.get("e")!.points.at(-1)).toEqual({ x: 500, y: 300 });
    expect(res.byId.get("e")!.toSide).toBeNull();
    expect(res.byId.get("f")!.points).toEqual([
      { x: -100, y: 0 },
      { x: -100, y: 200 },
    ]);
  });

  it("keeps the editor's preview route clear of both shapes", () => {
    const a = node("a");
    const b = node("b", 300, 200);
    const pts = orthogonalRoute({ x: 80, y: 64 }, "bottom", { x: 300, y: 232 }, "left", a, b);
    expect(pts[0]).toEqual({ x: 80, y: 64 });
    expect(pts.at(-1)).toEqual({ x: 300, y: 232 });
    for (let i = 2; i < pts.length - 1; i++)
      expect(hits(pts[i - 1]!, pts[i]!, a, 0) || hits(pts[i - 1]!, pts[i]!, b, 0)).toBe(false);
  });
});

describe("curved and straight routes", () => {
  it("curves smoothly between ends, around shapes in the way", () => {
    const open = routeFlowchart(
      flowchart({
        nodes: [node("a"), node("b", 300, 200)],
        edges: [newEdge("a", "b", { id: "e", route: "curved" })],
      }),
    ).routes[0]!;
    expect(open.curve).toHaveLength(1);
    expect(open.points.length).toBeGreaterThan(10);
    const blocked = routeFlowchart(
      flowchart({
        nodes: [node("a"), node("wall", -40, 140, { w: 240 }), node("b", 0, 300)],
        edges: [newEdge("a", "b", { id: "e", route: "curved" })],
      }),
    ).routes[0]!;
    expect(blocked.curve!.length).toBeGreaterThan(1);
    const wall = { x: -40, y: 140, w: 240, h: 64 };
    expect(
      blocked.points.every(
        (p) =>
          !(
            p.x > wall.x + 2 &&
            p.x < wall.x + wall.w - 2 &&
            p.y > wall.y + 2 &&
            p.y < wall.y + wall.h - 2
          ),
      ),
    ).toBe(true);
    const drawn = routeEdges(
      flowchart({
        nodes: [node("a"), node("b", 300, 200)],
        edges: [newEdge("a", "b", { id: "e", route: "curved" })],
      }),
    )[0]!;
    expect(drawn.d).toMatch(/^M[\d.]+ [\d.]+C/);
  });

  it("draws straight connectors aimed at each other's centres when no side is set", () => {
    const fc = flowchart({
      nodes: [node("a"), node("b", 400, 300)],
      edges: [newEdge("a", "b", { id: "e", route: "straight" })],
    });
    const r = routeFlowchart(fc).routes[0]!;
    expect(r.points).toHaveLength(2);
    expect(r.fromSide).toBeNull();
    // On the outline, on the line between the centres.
    const [p, q] = r.points as [Pt, Pt];
    const slope = (q.y - p.y) / (q.x - p.x);
    expect(slope).toBeCloseTo((332 - 32) / (480 - 80), 1);
  });
});

describe("ends on sides", () => {
  it("spread several connectors evenly along one side, ordered by where they go (no crossings near the shape)", () => {
    const hub = node("hub", 400, 0);
    const targets = [0, 200, 400, 600, 800].map((x, i) => node(`t${i}`, x, 300));
    const fc = flowchart({
      nodes: [hub, ...targets],
      edges: targets.map((t, i) => newEdge("hub", t.id, { id: `e${i}` })),
    });
    const ends = resolveEnds(fc);
    const xs = targets.map((_, i) => ends.get(`e${i}`)![0].point.x);
    expect(new Set(xs).size).toBe(5);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs); // ordered like their targets
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 5); // evenly
    expect(xs[2]).toBe(480); // the one straight below keeps the middle
    expect(routeFlowchart(fc).crossings).toBe(0);
  });

  it("keep explicit sides and positions", () => {
    const fc = flowchart({
      nodes: [node("a"), node("b", 400, 0)],
      edges: [
        newEdge("a", "b", { id: "e", fromSide: "bottom", fromAt: 0.25, toSide: "top", toAt: 0.75 }),
      ],
    });
    const [a, b] = resolveEnds(fc).get("e")!;
    expect(a.point).toEqual({ x: 40, y: 64 });
    expect(b.point).toEqual({ x: 520, y: 0 });
    expect([a.side, b.side]).toEqual(["bottom", "top"]);
  });

  it("send a decision's branches out of different tips: Yes keeps the flow, No goes to the side", () => {
    const fc = flowchart({
      nodes: [
        node("d", 200, 0, { shape: "decision" }),
        node("y", 200, 200),
        node("n", 500, 200),
        node("prev", 200, -200),
      ],
      edges: [
        newEdge("prev", "d", { id: "in" }),
        newEdge("d", "n", { id: "no", labels: [{ text: "No", at: 0.5 }] }),
        newEdge("d", "y", { id: "yes", labels: [{ text: "Yes", at: 0.5 }] }),
      ],
    });
    const sides = edgeSides(fc);
    expect(sides.get("yes")![0]).toBe("bottom");
    expect(sides.get("no")![0]).toBe("right");
    expect(sides.get("in")![1]).toBe("top");
  });
});

describe("tidying", () => {
  it("moves apart connectors that would run on top of each other", () => {
    // Two connectors from the left column to the right one, both forced through the same gap.
    const fc = flowchart({
      nodes: [
        node("a1", 0, 0),
        node("a2", 0, 400),
        node("wall", 260, -200, { w: 120, h: 300 }),
        node("wall2", 260, 300, { w: 120, h: 300 }),
        node("b1", 600, 0),
        node("b2", 600, 400),
      ],
      edges: [
        newEdge("a1", "b2", { id: "x", fromSide: "right", toSide: "left" }),
        newEdge("a2", "b1", { id: "y", fromSide: "right", toSide: "left" }),
      ],
    });
    const res = routeFlowchart(fc);
    const segs = (r: (typeof res.routes)[number]) =>
      r.points.slice(1).map((q, i) => [r.points[i]!, q] as const);
    for (const [a, b] of segs(res.byId.get("x")!)) {
      for (const [c, d] of segs(res.byId.get("y")!)) {
        // No two collinear segments overlap.
        const horiz =
          Math.abs(a.y - b.y) < 0.01 && Math.abs(c.y - d.y) < 0.01 && Math.abs(a.y - c.y) < 0.5;
        const vert =
          Math.abs(a.x - b.x) < 0.01 && Math.abs(c.x - d.x) < 0.01 && Math.abs(a.x - c.x) < 0.5;
        const overlap = horiz
          ? Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
            Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))
          : vert
            ? Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
              Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
            : 0;
        expect(overlap).toBeLessThanOrEqual(1);
      }
    }
  });

  it("finds crossings and draws a hop where lines cross", () => {
    const fc = flowchart({
      nodes: [node("l", 0, 200), node("r", 600, 200), node("t", 300, 0), node("b", 300, 420)],
      // Explicit sides: these two must cross (no detour around).
      edges: [
        newEdge("l", "r", { id: "h", fromSide: "right", toSide: "left" }),
        newEdge("t", "b", { id: "v", fromSide: "bottom", toSide: "top" }),
      ],
    });
    const res = routeFlowchart(fc);
    expect(res.crossings).toBe(1);
    const h = res.byId.get("h")!;
    expect(h.hops).toHaveLength(1);
    expect(h.hops[0]!.over).toBe("v");
    expect(h.hops[0]!.at.x).toBe(380);
    expect(res.byId.get("v")!.hops).toHaveLength(0);
    const d = routeEdges(fc).find((r) => r.edge.id === "h")!.d;
    expect(d).toMatch(/A4\.5 4\.5 0 0 1/);
    expect(
      polylinePath(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        10,
        [{ segment: 0, at: { x: 50, y: 0 }, over: "z" }],
      ),
    ).toBe("M0 0L45.5 0A4.5 4.5 0 0 1 54.5 0L100 0");
    // Without hops asked for, none are found.
    expect(routeFlowchart(fc, { hops: false }).crossings).toBe(0);
  });

  it("is deterministic", () => {
    const fc = scattered(7, 40, 70);
    const a = JSON.stringify(routeFlowchart(fc).routes.map((r) => [r.points, r.hops]));
    clearRouteCache();
    const b = JSON.stringify(routeFlowchart(fc).routes.map((r) => [r.points, r.hops]));
    expect(b).toBe(a);
    // Cached and fresh results agree.
    const c = JSON.stringify(routeFlowchart(fc).routes.map((r) => [r.points, r.hops]));
    expect(c).toBe(a);
  });
});

describe("performance", () => {
  // 200 shapes and 300 connectors, the size of a big flowchart in a note.
  const big = () => scattered(42, 200, 300, 16);

  it("routes 200 shapes and 300 connectors from scratch quickly", () => {
    const fc = big();
    const t0 = performance.now();
    const res = routeFlowchart(fc);
    const cold = performance.now() - t0;
    expect(res.routes).toHaveLength(300);
    // Generous for slow CI machines; typically well under 100 ms.
    expect(cold).toBeLessThan(1500);
    console.info(
      `[bench] cold route 200 shapes / 300 connectors: ${cold.toFixed(1)} ms (${res.stats.searched} searched)`,
    );
  });

  it("re-routes live while a shape is dragged within a frame budget", () => {
    let fc = big();
    routeFlowchart(fc);
    const moving = "n37";
    const frames: number[] = [];
    let routed = 0;
    for (let f = 1; f <= 30; f++) {
      fc = {
        ...fc,
        nodes: fc.nodes.map((n) => (n.id === moving ? { ...n, x: n.x + 6, y: n.y + 3 } : n)),
      };
      const t0 = performance.now();
      const res = routeFlowchart(fc);
      frames.push(performance.now() - t0);
      routed += res.stats.routed;
    }
    frames.sort((a, b) => a - b);
    const median = frames[Math.floor(frames.length / 2)]!;
    // Only connectors near the dragged shape are routed again.
    expect(routed / frames.length).toBeLessThan(40);
    expect(median).toBeLessThan(16);
    console.info(
      `[bench] drag frame: median ${median.toFixed(2)} ms, worst ${frames.at(-1)!.toFixed(2)} ms, ${(routed / frames.length).toFixed(1)} connectors routed per frame`,
    );
  });
});
