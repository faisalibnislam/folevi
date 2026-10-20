// Connector routing for flowcharts: where each connector attaches, and the path it takes.
//
//   Ends     an attached end sits on a side of its shape: the side it names, or one chosen from where the
//            other end is (a decision's extra branches go out sideways, "Yes" keeps the main direction).
//            Several connectors on one side spread evenly along it, ordered by where they go, so they never
//            stack and don't cross each other on the way out. A free end is a point on the canvas.
//   Elbow    (the default) right angles only: a short straight run out of each shape, then the cheapest path
//            by length plus a cost per bend that keeps a padding margin around every shape. The few shapes a
//            person would draw (L, Z and U routes) are tried first; when all of them are blocked, A* runs over
//            a sparse grid made from the shapes' padded edges and the gaps between them. Bend points are
//            visited in order.
//   Curved   a smooth curve: one S-curve along the ends' directions when nothing is in the way, otherwise
//            the elbow route with its corners smoothed. Straight: straight lines through the bend points.
//   Tidying  segments of different connectors that would run on top of each other are moved apart, and
//            crossings are found so lines can draw a small hop where they cross.
//
// Every connector's route is a pure function of its own ends, bends and the shapes near it, and is cached
// by exactly those inputs, so re-routing while something is dragged only does the work for connectors whose
// surroundings changed (see the benchmarks in flowchart-routing.test.ts).
import type { FlowchartData, FlowEdge, FlowNode, FlowRoute } from "./flowchart";
import { outlinePoint, shapeOutline, shapeSpread, type FlowSide, type Pt, type Rect } from "./flowchartShapes";

export interface RouteOptions {
  /** Clearance kept around shapes. */
  padding?: number;
  /** The straight run out of a shape before a connector may turn. */
  stub?: number;
  /** How much length one fewer bend is worth. */
  bendCost?: number;
  /** Space between connectors that would otherwise overlap. */
  separation?: number;
  /** Find crossings for line hops (on by default). */
  hops?: boolean;
  /** Hop radius (crossings closer than this to a corner get no hop). */
  hopRadius?: number;
}

const DEFAULTS: Required<RouteOptions> = { padding: 12, stub: 18, bendCost: 30, separation: 8, hops: true, hopRadius: 4.5 };

export interface Hop {
  /** Index of the segment (points[i] → points[i + 1]) the hop is on. */
  segment: number;
  at: Pt;
  /** The connector it hops over. */
  over: string;
}

export interface EdgeRoute {
  edge: FlowEdge;
  route: FlowRoute;
  /** The path as a polyline (a curve is sampled). */
  points: Pt[];
  /** A curved route as curve pieces from `points[0]` (null for elbow and straight routes). */
  curve: CurveSeg[] | null;
  fromSide: FlowSide | null;
  toSide: FlowSide | null;
  hops: Hop[];
}

export interface RoutingResult {
  routes: EdgeRoute[];
  byId: Map<string, EdgeRoute>;
  /** Number of crossings between connectors. */
  crossings: number;
  stats: { routed: number; cached: number; searched: number };
}

type Dir = 0 | 1 | 2 | 3; // right, down, left, up
const DIR_OF: Record<FlowSide, Dir> = { right: 0, bottom: 1, left: 2, top: 3 };
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const opposite = (d: Dir) => ((d + 2) % 4) as Dir;
export const OPPOSITE: Record<FlowSide, FlowSide> = { top: "bottom", bottom: "top", left: "right", right: "left" };

const center = (n: Rect): Pt => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
const inflate = (r: Rect, p: number): Rect => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p });
const EPS = 0.01;

// ------------------------------------------------------------------------------------------ sides

/** Natural sides for a connector between two boxes (vertical flow preferred). */
export function autoSides(a: Rect, b: Rect): [FlowSide, FlowSide] {
  const ca = center(a);
  const cb = center(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const gy = Math.abs(dy) - (a.h + b.h) / 2;
  const gx = Math.abs(dx) - (a.w + b.w) / 2;
  const vertical = gy >= 0 ? gx < 0 || gy >= gx * 0.6 : gx < 0;
  if (vertical) return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
  return dx >= 0 ? ["right", "left"] : ["left", "right"];
}

/** The side of a box closest to a point (for dropping a connector on a shape). */
export function nearestSide(n: Rect, p: Pt): FlowSide {
  const d: [FlowSide, number][] = [
    ["top", Math.abs(p.y - n.y)],
    ["bottom", Math.abs(p.y - (n.y + n.h))],
    ["left", Math.abs(p.x - n.x)],
    ["right", Math.abs(p.x - (n.x + n.w))],
  ];
  return d.sort((a, b) => a[1] - b[1])[0]![0];
}

/** The position (0…1) along a side closest to a point, for snapping a dragged end to a spot on a side. */
export function sidePosition(n: Rect, side: FlowSide, p: Pt): number {
  const t = side === "top" || side === "bottom" ? (p.x - n.x) / Math.max(1, n.w) : (p.y - n.y) / Math.max(1, n.h);
  return Math.round(Math.max(0, Math.min(1, t)) * 1000) / 1000;
}

const YES = /^(yes|y|true|ok|pass|valid|approved?)$/i;
const NO = /^(no|n|false|fail|invalid|rejected?)$/i;

/** A free end's box (a point) or an attached end's node. */
function endBox(fc: FlowchartData, byId: ReadonlyMap<string, FlowNode>, e: FlowEdge, end: "from" | "to"): Rect | null {
  const id = end === "from" ? e.from : e.to;
  if (id) return byId.get(id) ?? null;
  const p = end === "from" ? e.fromPoint : e.toPoint;
  return p ? { x: p.x, y: p.y, w: 0, h: 0 } : null;
}

/** Where the far end of `e` is seen from `end` (its nearest bend, or the other end). */
function farRef(e: FlowEdge, end: "from" | "to", other: Rect): Pt {
  if (e.bends.length) return end === "from" ? e.bends[0]! : e.bends[e.bends.length - 1]!;
  return center(other);
}

/**
 * Resolved sides for every connector: explicit ones kept, the rest chosen from where the other end is.
 * Free ends, and the automatic ends of straight connectors, have no side (null).
 */
export function edgeSides(fc: FlowchartData, byId: ReadonlyMap<string, FlowNode> = new Map(fc.nodes.map((n) => [n.id, n]))): Map<string, [FlowSide | null, FlowSide | null]> {
  const sides = new Map<string, [FlowSide | null, FlowSide | null]>();
  for (const e of fc.edges) {
    const a = endBox(fc, byId, e, "from");
    const b = endBox(fc, byId, e, "to");
    if (!a || !b) continue;
    const refA = e.bends.length ? { ...e.bends[0]!, w: 0, h: 0 } : b;
    const refB = e.bends.length ? { ...e.bends[e.bends.length - 1]!, w: 0, h: 0 } : a;
    const fa = e.from ? (e.fromSide ?? (e.route === "straight" ? null : autoSides(a, refA)[0])) : null;
    const fb = e.to ? (e.toSide ?? (e.route === "straight" ? null : autoSides(refB, b)[1])) : null;
    sides.set(e.id, [fa, fb]);
  }
  // A decision with several automatic branches leaving the same tip: the "Yes" branch (or the one most in
  // line) keeps the tip, the others go out sideways toward their targets (Yes down, No to the side).
  const bySource = new Map<string, FlowEdge[]>();
  for (const e of fc.edges) {
    const s = sides.get(e.id);
    const src = byId.get(e.from);
    if (e.fromSide || !s?.[0] || !src || e.route === "straight" || e.bends.length) continue;
    if (src.shape !== "decision" && src.shape !== "diamond" && src.shape !== "sort") continue;
    const key = `${e.from}:${s[0]}`;
    bySource.set(key, [...(bySource.get(key) ?? []), e]);
  }
  for (const list of bySource.values()) {
    if (list.length < 2) continue;
    const src = byId.get(list[0]!.from)!;
    const c = center(src);
    const first = sides.get(list[0]!.id)![0]!;
    const vertical = first === "top" || first === "bottom";
    const off = (e: FlowEdge) => {
      const t = center(endBox(fc, byId, e, "to")!);
      return vertical ? t.x - c.x : t.y - c.y;
    };
    const label = (e: FlowEdge) => e.labels[0]?.text.trim() ?? "";
    const rank = (e: FlowEdge) => (YES.test(label(e)) ? 0 : NO.test(label(e)) ? 2 : 1);
    const sorted = [...list].sort((x, y) => rank(x) - rank(y) || Math.abs(off(x)) - Math.abs(off(y)) || (x.id < y.id ? -1 : 1));
    const taken = new Set<FlowSide>();
    for (const e of sorted.slice(1)) {
      const o = off(e);
      let side: FlowSide = vertical ? (o >= 0 ? "right" : "left") : o >= 0 ? "bottom" : "top";
      if (NO.test(label(e)) && Math.abs(o) < 8) side = vertical ? "right" : "bottom";
      if (taken.has(side)) side = OPPOSITE[side];
      if (taken.has(side) || side === OPPOSITE[first]) continue;
      taken.add(side);
      const cur = sides.get(e.id)!;
      const target = endBox(fc, byId, e, "to")!;
      // The branch arrives from the side facing the decision when that reads better.
      let toSide = cur[1];
      if (!e.toSide && target.w) {
        const tc = center(target);
        if (vertical && Math.abs(tc.y - c.y) < src.h / 2 + target.h / 2) toSide = side === "right" ? "left" : "right";
      }
      sides.set(e.id, [side, toSide]);
    }
  }
  return sides;
}

// ------------------------------------------------------------------------------------------ ports

export interface ResolvedEnd {
  node: FlowNode | null;
  side: FlowSide | null;
  /** Where the line meets the shape (or the free point). */
  point: Pt;
  /** Position along the side (attached ends with a side). */
  at: number | null;
}

/** Where a connector meets a node side; `t` (0…1 along the side) spreads several connectors along one side. */
export function portPoint(n: FlowNode, side: FlowSide, t = 0.5): Pt {
  return outlinePoint(n, side, t);
}

/** Where the line from the node's centre toward `toward` leaves its outline (straight connectors). */
function boundaryToward(n: FlowNode, toward: Pt): Pt {
  const c = center(n);
  const poly = shapeOutline(n);
  let best: Pt | null = null;
  let bestT = Infinity;
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return c;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[j]!;
    const q = poly[i]!;
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((p.x - c.x) * ey - (p.y - c.y) * ex) / den;
    const u = ((p.x - c.x) * dy - (p.y - c.y) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && t < bestT) {
      bestT = t;
      best = { x: c.x + dx * t, y: c.y + dy * t };
    }
  }
  return best ?? c;
}

/** Resolves both ends of every connector: sides, spread positions along sides, and points. */
export function resolveEnds(fc: FlowchartData, byId: ReadonlyMap<string, FlowNode> = new Map(fc.nodes.map((n) => [n.id, n]))): Map<string, [ResolvedEnd, ResolvedEnd]> {
  const sides = edgeSides(fc, byId);
  // Several connectors on one side of a node spread out along it, ordered by where their other end is.
  const groups = new Map<string, { edge: FlowEdge; end: "from" | "to"; key: number; tie: number }[]>();
  for (const e of fc.edges) {
    const s = sides.get(e.id);
    if (!s) continue;
    for (const end of ["from", "to"] as const) {
      const id = end === "from" ? e.from : e.to;
      const side = end === "from" ? s[0] : s[1];
      const explicitAt = end === "from" ? e.fromAt : e.toAt;
      if (!id || !side || explicitAt !== undefined) continue;
      const other = endBox(fc, byId, e, end === "from" ? "to" : "from")!;
      const ref = farRef(e, end, other);
      const horizontal = side === "top" || side === "bottom";
      const k = `${id}:${side}`;
      const list = groups.get(k) ?? [];
      list.push({ edge: e, end, key: horizontal ? ref.x : ref.y, tie: horizontal ? ref.y : ref.x });
      groups.set(k, list);
    }
  }
  const spread = new Map<string, number>();
  for (const [k, list] of groups) {
    const [id, side] = k.split(":") as [string, FlowSide];
    const node = byId.get(id)!;
    // Connectors heading away on the far side of the shape go to the outside, so their turns nest.
    const flip = side === "top" || side === "left" ? -1 : 1;
    list.sort((a, b) => a.key - b.key || (a.tie - b.tie) * flip || (a.edge.id < b.edge.id ? -1 : a.edge.id > b.edge.id ? 1 : a.end < b.end ? -1 : 1));
    const n = list.length;
    const range = shapeSpread(node.shape, side);
    const step = n > 1 ? Math.min(range / n, 0.25) : 0;
    list.forEach((item, i) => spread.set(`${item.edge.id}:${item.end}`, 0.5 + (i - (n - 1) / 2) * step));
  }
  const out = new Map<string, [ResolvedEnd, ResolvedEnd]>();
  for (const e of fc.edges) {
    const s = sides.get(e.id);
    if (!s) continue;
    const ends: ResolvedEnd[] = [];
    for (const end of ["from", "to"] as const) {
      const id = end === "from" ? e.from : e.to;
      const node = id ? (byId.get(id) ?? null) : null;
      const side = end === "from" ? s[0] : s[1];
      if (!node) {
        ends.push({ node: null, side: null, point: (end === "from" ? e.fromPoint : e.toPoint)!, at: null });
        continue;
      }
      if (side) {
        const at = (end === "from" ? e.fromAt : e.toAt) ?? spread.get(`${e.id}:${end}`) ?? 0.5;
        ends.push({ node, side, point: outlinePoint(node, side, at), at });
      } else {
        // Straight connectors aim at the other end (its nearest bend, centre or point).
        const other = endBox(fc, byId, e, end === "from" ? "to" : "from")!;
        ends.push({ node, side: null, point: boundaryToward(node, farRef(e, end, other)), at: null });
      }
    }
    out.set(e.id, ends as [ResolvedEnd, ResolvedEnd]);
  }
  return out;
}

// ------------------------------------------------------------------------------------------ orthogonal legs

function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue;
    out.push(p);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3) as [Pt, Pt, Pt];
      const colinear = (Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS) || (Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS);
      if (!colinear) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

/** Whether an axis-aligned segment passes through a rectangle's interior. */
function segHits(ax: number, ay: number, bx: number, by: number, r: Rect): boolean {
  const x0 = r.x + EPS;
  const x1 = r.x + r.w - EPS;
  const y0 = r.y + EPS;
  const y1 = r.y + r.h - EPS;
  if (Math.abs(ay - by) < EPS) {
    if (ay <= y0 || ay >= y1) return false;
    return Math.max(ax, bx) > x0 && Math.min(ax, bx) < x1;
  }
  if (Math.abs(ax - bx) < EPS) {
    if (ax <= x0 || ax >= x1) return false;
    return Math.max(ay, by) > y0 && Math.min(ay, by) < y1;
  }
  // A diagonal (only for straight routes): sampled.
  for (let i = 1; i < 16; i++) {
    const x = ax + ((bx - ax) * i) / 16;
    const y = ay + ((by - ay) * i) / 16;
    if (x > x0 && x < x1 && y > y0 && y < y1) return true;
  }
  return false;
}

const inside = (p: Pt, r: Rect) => p.x > r.x + EPS && p.x < r.x + r.w - EPS && p.y > r.y + EPS && p.y < r.y + r.h - EPS;

function dirOf(a: Pt, b: Pt): Dir {
  if (Math.abs(a.y - b.y) < EPS) return b.x >= a.x ? 0 : 2;
  return b.y >= a.y ? 1 : 3;
}

/** Cost of a polyline leg: length, bends (including turning off the start direction and into the end one). */
function legCost(pts: Pt[], ds: Dir | null, de: Dir | null, bendCost: number): number {
  let len = 0;
  let bends = 0;
  let prev: Dir | null = ds;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    len += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    const d = dirOf(a, b);
    if (prev !== null && d !== prev) {
      if (d === opposite(prev)) return Infinity;
      bends++;
    }
    prev = d;
  }
  if (de !== null && prev !== null && prev !== de) {
    if (prev === opposite(de)) return Infinity;
    bends++;
  }
  return len + bends * bendCost;
}

function legClear(pts: Pt[], obstacles: readonly Rect[]): boolean {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    for (const r of obstacles) if (segHits(a.x, a.y, b.x, b.y, r)) return false;
  }
  return true;
}

/** The few routes a person would draw between two points: straight, L, Z and U shapes. */
function candidates(s: Pt, e: Pt, around: Rect | null, stub: number): Pt[][] {
  const mx = (s.x + e.x) / 2;
  const my = (s.y + e.y) / 2;
  const list: Pt[][] = [
    [s, e],
    [s, { x: s.x, y: e.y }, e],
    [s, { x: e.x, y: s.y }, e],
    [s, { x: s.x, y: my }, { x: e.x, y: my }, e],
    [s, { x: mx, y: s.y }, { x: mx, y: e.y }, e],
  ];
  if (around) {
    const top = Math.min(around.y, s.y, e.y) - stub;
    const bottom = Math.max(around.y + around.h, s.y, e.y) + stub;
    const left = Math.min(around.x, s.x, e.x) - stub;
    const right = Math.max(around.x + around.w, s.x, e.x) + stub;
    list.push(
      [s, { x: s.x, y: top }, { x: e.x, y: top }, e],
      [s, { x: s.x, y: bottom }, { x: e.x, y: bottom }, e],
      [s, { x: left, y: s.y }, { x: left, y: e.y }, e],
      [s, { x: right, y: s.y }, { x: right, y: e.y }, e],
    );
  }
  return list.map(simplify).filter((p) => p.length === 1 || p.slice(1).every((q, i) => Math.abs(q.x - p[i]!.x) < EPS || Math.abs(q.y - p[i]!.y) < EPS));
}

/** A binary min-heap of state indices keyed by a float priority. */
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    const ids = this.ids;
    const keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      ids[i] = ids[p]!;
      keys[i] = keys[p]!;
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  peekKey() {
    return this.keys[0]!;
  }
  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0]!;
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r]! < keys[l]! ? r : l;
        if (keys[c]! >= lastKey) break;
        ids[i] = ids[c]!;
        keys[i] = keys[c]!;
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

function uniqSorted(values: number[]): number[] {
  values.sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of values) if (!out.length || v - out[out.length - 1]! > 0.5) out.push(v);
  return out;
}

function lowerIndex(arr: readonly number[], v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m]! < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/**
 * A* over the sparse orthogonal grid made of the obstacles' edges, the gaps between them, the window and
 * the two end points. Returns the cheapest path (length + bends) or null when the window is blocked.
 */
function gridSearch(s: Pt, ds: Dir | null, e: Pt, de: Dir | null, obstacles: readonly Rect[], win: Rect, bendCost: number): Pt[] | null {
  const xsRaw = [s.x, e.x, win.x, win.x + win.w];
  const ysRaw = [s.y, e.y, win.y, win.y + win.h];
  for (const r of obstacles) {
    xsRaw.push(r.x, r.x + r.w);
    ysRaw.push(r.y, r.y + r.h);
  }
  let xs = uniqSorted(xsRaw.filter((x) => x >= win.x - EPS && x <= win.x + win.w + EPS));
  let ys = uniqSorted(ysRaw.filter((y) => y >= win.y - EPS && y <= win.y + win.h + EPS));
  // Channel centres between neighbouring lines, so routes run down the middle of gaps.
  if (obstacles.length <= 60) {
    const mid = (arr: number[]) => {
      const extra: number[] = [];
      for (let i = 1; i < arr.length; i++) if (arr[i]! - arr[i - 1]! > 36) extra.push((arr[i]! + arr[i - 1]!) / 2);
      return uniqSorted([...arr, ...extra]);
    };
    xs = mid(xs);
    ys = mid(ys);
  }
  const nx = xs.length;
  const ny = ys.length;
  const N = nx * ny;
  const blockedPt = new Uint8Array(N);
  const blockedH = new Uint8Array(N); // segment (i, j) → (i + 1, j)
  const blockedV = new Uint8Array(N); // segment (i, j) → (i, j + 1)
  for (const r of obstacles) {
    const i0 = lowerIndex(xs, r.x + EPS);
    const i1 = lowerIndex(xs, r.x + r.w - EPS); // first index ≥ x1 - eps
    const j0 = lowerIndex(ys, r.y + EPS);
    const j1 = lowerIndex(ys, r.y + r.h - EPS);
    // Points strictly inside.
    for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) blockedPt[i * ny + j] = 1;
    // Horizontal segments at rows strictly inside, spanning columns from the left edge to the right edge.
    const ia = lowerIndex(xs, r.x - EPS);
    const ib = lowerIndex(xs, r.x + r.w - EPS);
    for (let i = ia; i < ib && i < nx - 1; i++) for (let j = j0; j < j1; j++) blockedH[i * ny + j] = 1;
    const ja = lowerIndex(ys, r.y - EPS);
    const jb = lowerIndex(ys, r.y + r.h - EPS);
    for (let i = i0; i < i1; i++) for (let j = ja; j < jb && j < ny - 1; j++) blockedV[i * ny + j] = 1;
  }
  const si = lowerIndex(xs, s.x - 0.25);
  const sj = lowerIndex(ys, s.y - 0.25);
  const ei = lowerIndex(xs, e.x - 0.25);
  const ej = lowerIndex(ys, e.y - 0.25);
  if (si >= nx || sj >= ny || ei >= nx || ej >= ny) return null;
  const goal = ei * ny + ej;
  const g = new Float64Array(N * 4).fill(Infinity);
  const parent = new Int32Array(N * 4).fill(-1);
  const heap = new Heap();
  const ex = xs[ei]!;
  const ey = ys[ej]!;
  const hOf = (i: number, j: number) => Math.abs(xs[i]! - ex) + Math.abs(ys[j]! - ey);
  const start = si * ny + sj;
  for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
    if (ds !== null && d !== ds) continue;
    g[start * 4 + d] = 0;
    heap.push(start * 4 + d, hOf(si, sj));
  }
  let best = Infinity;
  let bestState = -1;
  const arrival = (d: number) => (de === null || d === de ? 0 : d === opposite(de) ? 2 * bendCost + 1 : bendCost);
  let pops = 0;
  while (heap.size) {
    if (heap.peekKey() >= best) break;
    const st = heap.pop();
    if (++pops > 400_000) break;
    const p = st >> 2;
    const d = st & 3;
    const gc = g[st]!;
    if (p === goal) {
      const total = gc + arrival(d);
      if (total < best) {
        best = total;
        bestState = st;
      }
      continue;
    }
    const i = (p / ny) | 0;
    const j = p - i * ny;
    for (let d2 = 0; d2 < 4; d2++) {
      if (d2 === ((d + 2) & 3) && !(p === start && ds === null)) continue;
      let ni = i;
      let nj = j;
      if (d2 === 0) {
        if (i + 1 >= nx || blockedH[p]) continue;
        ni = i + 1;
      } else if (d2 === 2) {
        if (i === 0 || blockedH[(i - 1) * ny + j]) continue;
        ni = i - 1;
      } else if (d2 === 1) {
        if (j + 1 >= ny || blockedV[p]) continue;
        nj = j + 1;
      } else {
        if (j === 0 || blockedV[i * ny + j - 1]) continue;
        nj = j - 1;
      }
      const np = ni * ny + nj;
      if (blockedPt[np] && np !== goal) continue;
      const cost = gc + Math.abs(xs[ni]! - xs[i]!) + Math.abs(ys[nj]! - ys[j]!) + (d2 !== d && !(p === start && ds === null) ? bendCost : 0);
      const ns = np * 4 + d2;
      if (cost < g[ns]!) {
        g[ns] = cost;
        parent[ns] = st;
        heap.push(ns, cost + hOf(ni, nj));
      }
    }
  }
  if (bestState < 0) return null;
  const path: Pt[] = [];
  for (let st = bestState; st >= 0; st = parent[st]!) {
    const p = st >> 2;
    const i = (p / ny) | 0;
    path.push({ x: xs[i]!, y: ys[p - i * ny]! });
  }
  path.reverse();
  path[0] = { ...s };
  path[path.length - 1] = { ...e };
  return simplify(path);
}

interface LegResult {
  pts: Pt[];
  searched: boolean;
  clear: boolean;
  /** The search had to look further than the nearby shapes. */
  wide: boolean;
}

/** An orthogonal path from `s` (leaving along `ds`) to `e` (arriving along `de`) around `obstacles`. */
function routeLeg(s: Pt, ds: Dir | null, e: Pt, de: Dir | null, obstacles: readonly Rect[], around: Rect | null, o: Required<RouteOptions>, all: readonly Rect[] = obstacles): LegResult {
  let best: Pt[] | null = null;
  let bestCost = Infinity;
  let fallback: Pt[] | null = null;
  let fallbackCost = Infinity;
  for (const c of candidates(s, e, around, o.stub)) {
    const cost = legCost(c, ds, de, o.bendCost);
    if (!Number.isFinite(cost)) continue;
    if (legClear(c, obstacles)) {
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    } else if (cost < fallbackCost) {
      fallbackCost = cost;
      fallback = c;
    }
  }
  // Two bends or fewer and clear: as good as a search would find in practice.
  if (best && best.length <= 4) return { pts: best, searched: false, clear: true, wide: false };
  const box = (pad: number): Rect => {
    let x0 = Math.min(s.x, e.x);
    let y0 = Math.min(s.y, e.y);
    let x1 = Math.max(s.x, e.x);
    let y1 = Math.max(s.y, e.y);
    if (around) {
      x0 = Math.min(x0, around.x);
      y0 = Math.min(y0, around.y);
      x1 = Math.max(x1, around.x + around.w);
      y1 = Math.max(y1, around.y + around.h);
    }
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
  };
  for (const pad of [120, 480]) {
    const win = box(pad);
    const wide = pad > 120;
    const near = (wide ? all : obstacles).filter((r) => r.x < win.x + win.w && r.x + r.w > win.x && r.y < win.y + win.h && r.y + r.h > win.y);
    const found = gridSearch(s, ds, e, de, near, win, o.bendCost);
    if (found) {
      const cost = legCost(found, ds, de, o.bendCost);
      if (best && bestCost <= cost) return { pts: best, searched: true, clear: true, wide };
      return { pts: found, searched: true, clear: true, wide };
    }
  }
  if (best) return { pts: best, searched: true, clear: true, wide: true };
  return { pts: fallback ?? simplify([s, { x: s.x, y: e.y }, e]), searched: true, clear: false, wide: true };
}

// ------------------------------------------------------------------------------------------ curves

const r1 = (n: number) => Math.round(n * 10) / 10;

function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** One cubic piece of a curved connector (it starts where the previous piece ended). */
export interface CurveSeg {
  c1: Pt;
  c2: Pt;
  to: Pt;
}

/** A smooth path through a polyline's corners: a spline through the segments' midpoints. */
function smoothPolyline(pts: readonly Pt[]): { segs: CurveSeg[]; samples: Pt[] } {
  if (pts.length <= 2) {
    const [a, b] = [pts[0]!, pts[pts.length - 1]!];
    const third = (k: number) => ({ x: a.x + ((b.x - a.x) * k) / 3, y: a.y + ((b.y - a.y) * k) / 3 });
    return { segs: [{ c1: third(1), c2: third(2), to: b }], samples: [a, b] };
  }
  const mids = pts.slice(1, -2).map((p, i) => ({ x: (p.x + pts[i + 2]!.x) / 2, y: (p.y + pts[i + 2]!.y) / 2 }));
  const anchors = [pts[0]!, ...mids, pts[pts.length - 1]!];
  const segs: CurveSeg[] = [];
  const samples: Pt[] = [anchors[0]!];
  for (let i = 1; i < anchors.length; i++) {
    const c = pts[i]!;
    const a = anchors[i - 1]!;
    const b = anchors[i]!;
    // The quadratic through the corner, as a cubic.
    segs.push({ c1: { x: a.x + ((c.x - a.x) * 2) / 3, y: a.y + ((c.y - a.y) * 2) / 3 }, c2: { x: b.x + ((c.x - b.x) * 2) / 3, y: b.y + ((c.y - b.y) * 2) / 3 }, to: b });
    for (let k = 1; k <= 12; k++) {
      const t = k / 12;
      const u = 1 - t;
      samples.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y });
    }
  }
  return { segs, samples };
}

function curveClear(samples: readonly Pt[], obstacles: readonly Rect[]): boolean {
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    for (const r of obstacles) if (inside(b, r) || inside(m, r)) return false;
  }
  return true;
}

// ------------------------------------------------------------------------------------------ one connector

interface Raw {
  points: Pt[];
  curve: CurveSeg[] | null;
  searched: boolean;
  /** Signature of the shapes further out that a wide search went around (checked on reuse). */
  wideSig?: string;
}

const NEAR = 140;
const FAR = 520;

function windowAround(pts: readonly Pt[], nodes: readonly (FlowNode | null)[], m: number): Rect {
  let x0 = Math.min(...pts.map((p) => p.x));
  let y0 = Math.min(...pts.map((p) => p.y));
  let x1 = Math.max(...pts.map((p) => p.x));
  let y1 = Math.max(...pts.map((p) => p.y));
  for (const n of nodes) {
    if (!n) continue;
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.w);
    y1 = Math.max(y1, n.y + n.h);
  }
  return { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
}

const touches = (r: Rect, w: Rect) => r.x < w.x + w.w && r.x + r.w > w.x && r.y < w.y + w.h && r.y + r.h > w.y;
const rectSig = (list: readonly Rect[]) => list.map((r) => `${r1(r.x)},${r1(r.y)},${r1(r.w)},${r1(r.h)}`).join(";");

/** A cache of single-connector routes keyed by everything a route depends on. */
const cache = new Map<string, Raw>();
const CACHE_MAX = 6000;

/** Forgets cached routes (tests and benchmarks). */
export function clearRouteCache(): void {
  cache.clear();
}

function stubEnd(end: ResolvedEnd, len: number): Pt {
  const n = end.node!;
  switch (end.side!) {
    case "top":
      return { x: end.point.x, y: n.y - len };
    case "bottom":
      return { x: end.point.x, y: n.y + n.h + len };
    case "left":
      return { x: n.x - len, y: end.point.y };
    case "right":
      return { x: n.x + n.w + len, y: end.point.y };
  }
}

function routeOne(e: FlowEdge, a: ResolvedEnd, b: ResolvedEnd, nodes: readonly FlowNode[], o: Required<RouteOptions>): { raw: Raw; cached: boolean } {
  const kind: FlowRoute = e.route;
  if (kind === "straight") {
    return { raw: { points: [a.point, ...e.bends, b.point], curve: null, searched: false }, cached: false };
  }
  const sa = a.side && a.node ? stubEnd(a, o.stub) : null;
  const sb = b.side && b.node ? stubEnd(b, o.stub) : null;
  const s = sa ?? a.point;
  const t = sb ?? b.point;
  const keyPts = [s, t, ...e.bends];
  // Every shape is in the way (with its margin), except where an end or a bend sits in another shape's
  // margin: that shape keeps no margin for this connector, and is ignored if the end is inside it.
  const all: Rect[] = [];
  for (const n of nodes) {
    let r = inflate(n, o.padding);
    if (n !== a.node && n !== b.node && keyPts.some((p) => inside(p, r))) {
      r = n;
      if (keyPts.some((p) => inside(p, r))) continue;
    }
    all.push(r);
  }
  // The shapes near the connector decide its route (and its cache key); a search that had to go further
  // out also remembers the shapes there.
  const near = windowAround(keyPts, [a.node, b.node], NEAR);
  const obstacles = all.filter((r) => touches(r, near));
  const farSig = () => rectSig(all.filter((r) => touches(r, windowAround(keyPts, [a.node, b.node], FAR))));
  const key = `${kind}|${r1(a.point.x)},${r1(a.point.y)},${a.side ?? ""}|${r1(b.point.x)},${r1(b.point.y)},${b.side ?? ""}|${e.bends.map((p) => `${p.x},${p.y}`).join(";")}|${o.padding},${o.stub},${o.bendCost}|${rectSig(obstacles)}`;
  const hit = cache.get(key);
  if (hit && (hit.wideSig === undefined || hit.wideSig === farSig())) {
    cache.delete(key);
    cache.set(key, hit);
    return { raw: hit, cached: true };
  }
  const ds = a.side ? DIR_OF[a.side] : null;
  const de = b.side ? opposite(DIR_OF[b.side]) : null;
  const around = a.node && b.node ? unionRect(inflate(a.node, o.padding), inflate(b.node, o.padding)) : a.node ? inflate(a.node, o.padding) : b.node ? inflate(b.node, o.padding) : null;

  let raw: Raw | null = null;
  if (kind === "curved" && !e.bends.length && a.side && b.side) {
    // One S-curve along the ends' directions, when it clears every shape.
    const dist = Math.hypot(b.point.x - a.point.x, b.point.y - a.point.y);
    const k = Math.max(30, Math.min(160, dist / 2));
    const na = DIR_OF[a.side];
    const nb = DIR_OF[b.side];
    const c1 = { x: a.point.x + DX[na]! * k, y: a.point.y + DY[na]! * k };
    const c2 = { x: b.point.x + DX[nb]! * k, y: b.point.y + DY[nb]! * k };
    const samples: Pt[] = [];
    for (let i = 0; i <= 24; i++) samples.push(cubicAt(a.point, c1, c2, b.point, i / 24));
    const others = obstacles.filter((r) => !sameRect(r, a.node, o.padding) && !sameRect(r, b.node, o.padding));
    if (curveClear(samples.slice(3, -3), others)) {
      raw = { points: samples, curve: [{ c1, c2, to: b.point }], searched: false };
    }
  }
  if (!raw) {
    // Elbow legs: start → each bend → end.
    const stops = [s, ...e.bends, t];
    let pts: Pt[] = [s];
    let dir: Dir | null = ds;
    let searched = false;
    let wide = false;
    for (let i = 1; i < stops.length; i++) {
      const last = i === stops.length - 1;
      const leg = routeLeg(stops[i - 1]!, dir, stops[i]!, last ? de : null, obstacles, i === 1 && last ? around : null, o, all);
      searched ||= leg.searched;
      wide ||= leg.wide;
      pts = pts.concat(leg.pts.slice(1));
      dir = leg.pts.length > 1 ? dirOf(leg.pts[leg.pts.length - 2]!, leg.pts[leg.pts.length - 1]!) : dir;
    }
    const full = simplify([...(sa ? [a.point] : []), ...pts, ...(sb ? [b.point] : [])]);
    if (kind === "curved") {
      const sm = smoothPolyline(full);
      raw = { points: sm.samples, curve: sm.segs, searched };
    } else raw = { points: full, curve: null, searched };
    if (wide) raw.wideSig = farSig();
  }
  cache.set(key, raw);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return { raw, cached: false };
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function sameRect(r: Rect, n: FlowNode | null, pad: number): boolean {
  return !!n && Math.abs(r.x - (n.x - pad)) < EPS && Math.abs(r.y - (n.y - pad)) < EPS && Math.abs(r.w - (n.w + 2 * pad)) < EPS;
}

// ------------------------------------------------------------------------------------------ tidying

interface Seg {
  route: number;
  index: number;
  /** The fixed coordinate (y of a horizontal segment, x of a vertical one) and the span along it. */
  at: number;
  lo: number;
  hi: number;
}

/**
 * Moves apart segments of different connectors that would run on top of each other (same line, overlapping
 * spans), keeping each one clear of shapes and never folding a neighbouring segment back on itself.
 */
function separate(routes: { points: Pt[]; orthogonal: boolean; id: string }[], obstacles: readonly Rect[], sep: number): void {
  for (const horizontal of [true, false]) {
    const segs: Seg[] = [];
    routes.forEach((r, ri) => {
      if (!r.orthogonal) return;
      const p = r.points;
      // Only inner segments move: the first and last leave and enter shapes at their ports.
      for (let i = 1; i < p.length - 2; i++) {
        const a = p[i]!;
        const b = p[i + 1]!;
        if (horizontal ? Math.abs(a.y - b.y) > EPS : Math.abs(a.x - b.x) > EPS) continue;
        const at = horizontal ? a.y : a.x;
        const lo = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
        const hi = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
        if (hi - lo > 1) segs.push({ route: ri, index: i, at, lo, hi });
      }
    });
    segs.sort((s1, s2) => s1.at - s2.at || s1.lo - s2.lo || s1.route - s2.route);
    let i = 0;
    while (i < segs.length) {
      let j = i + 1;
      while (j < segs.length && Math.abs(segs[j]!.at - segs[i]!.at) < 0.5) j++;
      // Overlapping clusters on this line.
      const line = segs.slice(i, j).sort((s1, s2) => s1.lo - s2.lo);
      let k = 0;
      while (k < line.length) {
        const cluster = [line[k]!];
        let hi = line[k]!.hi;
        let m = k + 1;
        while (m < line.length && line[m]!.lo < hi - 1) {
          cluster.push(line[m]!);
          hi = Math.max(hi, line[m]!.hi);
          m++;
        }
        k = m;
        const distinct = new Set(cluster.map((c) => c.route));
        if (distinct.size < 2) continue;
        // Order by where the neighbouring segments go, so the moved lines don't cross each other.
        const lean = (c: Seg) => {
          const p = routes[c.route]!.points;
          const before = p[c.index - 1]!;
          const after = p[c.index + 2]!;
          return horizontal ? before.y + after.y : before.x + after.x;
        };
        cluster.sort((s1, s2) => lean(s1) - lean(s2) || (routes[s1.route]!.id < routes[s2.route]!.id ? -1 : 1));
        cluster.forEach((c, idx) => {
          const off = (idx - (cluster.length - 1) / 2) * sep;
          if (Math.abs(off) < EPS) return;
          const p = routes[c.route]!.points;
          const a = p[c.index]!;
          const b = p[c.index + 1]!;
          const na = horizontal ? { x: a.x, y: a.y + off } : { x: a.x + off, y: a.y };
          const nb = horizontal ? { x: b.x, y: b.y + off } : { x: b.x + off, y: b.y };
          // Neighbours keep their direction (no folding back) and stay clear of shapes.
          const before = p[c.index - 1]!;
          const after = p[c.index + 2]!;
          const flips = horizontal
            ? Math.sign(na.y - before.y) !== Math.sign(a.y - before.y) || Math.sign(after.y - nb.y) !== Math.sign(after.y - b.y)
            : Math.sign(na.x - before.x) !== Math.sign(a.x - before.x) || Math.sign(after.x - nb.x) !== Math.sign(after.x - b.x);
          if (flips) return;
          for (const r of obstacles) {
            if (segHits(na.x, na.y, nb.x, nb.y, r) || segHits(before.x, before.y, na.x, na.y, r) || segHits(nb.x, nb.y, after.x, after.y, r)) return;
          }
          p[c.index] = na;
          p[c.index + 1] = nb;
        });
      }
      i = j;
    }
  }
}

/** Crossings between connectors; each is given to one of the two lines as a hop. */
function findCrossings(routes: { points: Pt[]; curved: boolean; id: string; hops: Hop[] }[], hopRadius: number): number {
  interface S {
    r: number;
    i: number;
    a: Pt;
    b: Pt;
  }
  const hs: S[] = [];
  const vs: S[] = [];
  const ds: S[] = [];
  routes.forEach((route, r) => {
    const p = route.points;
    if (route.curved) return; // curves draw no hops
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i]!;
      const b = p[i + 1]!;
      if (Math.abs(a.y - b.y) < EPS) hs.push({ r, i, a, b });
      else if (Math.abs(a.x - b.x) < EPS) vs.push({ r, i, a, b });
      else ds.push({ r, i, a, b });
    }
  });
  let count = 0;
  const margin = hopRadius + 3;
  vs.sort((s1, s2) => s1.a.x - s2.a.x);
  const vx = vs.map((v) => v.a.x);
  for (const h of hs) {
    const x0 = Math.min(h.a.x, h.b.x);
    const x1 = Math.max(h.a.x, h.b.x);
    for (let k = lowerIndex(vx, x0 + margin); k < vs.length && vx[k]! < x1 - margin; k++) {
      const v = vs[k]!;
      if (v.r === h.r) continue;
      const y0 = Math.min(v.a.y, v.b.y);
      const y1 = Math.max(v.a.y, v.b.y);
      if (h.a.y <= y0 + margin || h.a.y >= y1 - margin) continue;
      count++;
      // The horizontal line hops over the vertical one.
      routes[h.r]!.hops.push({ segment: h.i, at: { x: v.a.x, y: h.a.y }, over: routes[v.r]!.id });
    }
  }
  // Straight (diagonal) segments: general intersection; the later connector hops.
  if (ds.length) {
    const all = [...hs, ...vs, ...ds];
    for (const d of ds) {
      for (const s of all) {
        if (s.r === d.r || (ds.includes(s) && s.r < d.r)) continue;
        const p = intersect(d.a, d.b, s.a, s.b);
        if (!p) continue;
        const near = (q: Pt, u: Pt, v: Pt) => Math.hypot(q.x - u.x, q.y - u.y) < margin || Math.hypot(q.x - v.x, q.y - v.y) < margin;
        if (near(p, d.a, d.b) || near(p, s.a, s.b)) continue;
        count++;
        const [hopper, seg, other] = d.r > s.r ? [d.r, d.i, s.r] : [s.r, s.i, d.r];
        routes[hopper]!.hops.push({ segment: seg, at: p, over: routes[other]!.id });
      }
    }
  }
  for (const r of routes) r.hops.sort((h1, h2) => h1.segment - h2.segment || Math.hypot(h1.at.x - r.points[h1.segment]!.x, h1.at.y - r.points[h1.segment]!.y) - Math.hypot(h2.at.x - r.points[h2.segment]!.x, h2.at.y - r.points[h2.segment]!.y));
  return count;
}

function intersect(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// ------------------------------------------------------------------------------------------ the chart

/** Routes every connector of the chart (connectors whose shapes are missing are skipped). */
export function routeFlowchart(fc: FlowchartData, opts: RouteOptions = {}): RoutingResult {
  const o = { ...DEFAULTS, ...opts };
  const byId = new Map(fc.nodes.map((n) => [n.id, n]));
  const ends = resolveEnds(fc, byId);
  const work: { edge: FlowEdge; points: Pt[]; curve: CurveSeg[] | null; orthogonal: boolean; curved: boolean; id: string; hops: Hop[]; a: ResolvedEnd; b: ResolvedEnd }[] = [];
  let cached = 0;
  let searched = 0;
  for (const e of fc.edges) {
    const pair = ends.get(e.id);
    if (!pair) continue;
    const [a, b] = pair;
    const { raw, cached: hit } = routeOne(e, a, b, fc.nodes, o);
    if (hit) cached++;
    if (raw.searched && !hit) searched++;
    work.push({ edge: e, points: raw.points.map((p) => ({ ...p })), curve: raw.curve, orthogonal: e.route === "elbow", curved: raw.curve !== null, id: e.id, hops: [], a, b });
  }
  const obstacles = fc.nodes.map((n) => n as Rect);
  separate(work, obstacles, o.separation);
  const crossings = o.hops ? findCrossings(work, o.hopRadius) : 0;
  const routes: EdgeRoute[] = work.map((w) => ({ edge: w.edge, route: w.edge.route, points: w.points, curve: w.curve, fromSide: w.a.side, toSide: w.b.side, hops: w.hops }));
  return { routes, byId: new Map(routes.map((r) => [r.edge.id, r])), crossings, stats: { routed: work.length - cached, cached, searched } };
}

/**
 * An orthogonal route from `a` (leaving through side `sa`) to `b` (entering through `sb`) that keeps clear
 * of the two boxes (the editor's preview while drawing a connector).
 */
export function orthogonalRoute(a: Pt, sa: FlowSide, b: Pt, sb: FlowSide, ra: Rect, rb: Rect, opts: RouteOptions = {}): Pt[] {
  const o = { ...DEFAULTS, ...opts };
  const stub = (p: Pt, side: FlowSide, r: Rect): Pt => {
    if (!r.w && !r.h) return { x: p.x + DX[DIR_OF[side]]! * o.stub, y: p.y + DY[DIR_OF[side]]! * o.stub };
    switch (side) {
      case "top":
        return { x: p.x, y: Math.min(p.y, r.y) - o.stub };
      case "bottom":
        return { x: p.x, y: Math.max(p.y, r.y + r.h) + o.stub };
      case "left":
        return { x: Math.min(p.x, r.x) - o.stub, y: p.y };
      case "right":
        return { x: Math.max(p.x, r.x + r.w) + o.stub, y: p.y };
    }
  };
  const s = stub(a, sa, ra);
  const t = stub(b, sb, rb);
  const obstacles = [ra, rb].filter((r) => r.w > 0 && r.h > 0).map((r) => inflate(r, o.padding)).filter((r) => !inside(s, r) && !inside(t, r));
  const around = obstacles.length ? obstacles.reduce(unionRect) : null;
  const leg = routeLeg(s, DIR_OF[sa], t, opposite(DIR_OF[sb]), obstacles, around, o);
  return simplify([a, ...leg.pts, b]);
}
