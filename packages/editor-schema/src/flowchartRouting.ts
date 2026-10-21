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
//            the elbow route with its corners smoothed. With bend points, a spline through every bend (each
//            stretch a cubic piece, leaving and reaching the shapes square to their sides); a stretch that
//            would cut through a shape also passes the corners of the elbow route around it.
//   Straight straight lines through the bend points.
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
    // The branch most in line keeps the tip (Yes first when they are about as straight), the others go out
    // sideways toward their targets.
    const inLine = (e: FlowEdge) => Math.round(Math.abs(off(e)) / 32);
    const sorted = [...list].sort((x, y) => inLine(x) - inLine(y) || rank(x) - rank(y) || Math.abs(off(x)) - Math.abs(off(y)) || (x.id < y.id ? -1 : 1));
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
  // Pointed shapes (diamonds, circles) take one automatic connector per tip where they can: extra ones
  // move to a free neighbouring tip facing their other end (outgoing connectors keep theirs first).
  const occupied = new Map<string, number>();
  const ends: { e: FlowEdge; end: 0 | 1; node: FlowNode; side: FlowSide; auto: boolean }[] = [];
  for (const e of fc.edges) {
    const s = sides.get(e.id);
    if (!s) continue;
    for (const end of [0, 1] as const) {
      const id = end === 0 ? e.from : e.to;
      const side = s[end];
      const node = id ? byId.get(id) : undefined;
      if (!node || !side) continue;
      occupied.set(`${id}:${side}`, (occupied.get(`${id}:${side}`) ?? 0) + 1);
      ends.push({ e, end, node, side, auto: !(end === 0 ? e.fromSide : e.toSide) && !e.bends.length });
    }
  }
  // Who keeps a crowded tip: the connector that flows naturally through it (arriving at the top or left,
  // leaving at the bottom or right) and lines up with its other end; the others are offered a free tip.
  const keepScore = (x: (typeof ends)[number]) => {
    const natural = (x.side === "top" || x.side === "left") === (x.end === 1);
    const other = endBox(fc, byId, x.e, x.end === 0 ? "to" : "from");
    const c = center(x.node);
    const oc = other ? center(other) : c;
    const inLine = x.side === "top" || x.side === "bottom" ? Math.abs(oc.x - c.x) < x.node.w / 4 : Math.abs(oc.y - c.y) < x.node.h / 4;
    return (natural ? 2 : 0) + (inLine ? 1 : 0);
  };
  const crowdedGroups = new Map<string, (typeof ends)[number][]>();
  for (const x of ends) {
    const key = `${x.node.id}:${x.side}`;
    if (!x.auto || shapeSpread(x.node.shape, x.side) > 0.4 || occupied.get(key)! <= 1) continue;
    crowdedGroups.set(key, [...(crowdedGroups.get(key) ?? []), x]);
  }
  const crowded: (typeof ends)[number][] = [];
  for (const list of crowdedGroups.values()) {
    list.sort((a, b) => keepScore(b) - keepScore(a) || a.end - b.end || (a.e.id < b.e.id ? -1 : 1));
    // Every automatic end but the keeper may move (explicit ends never do).
    const fixed = occupied.get(`${list[0]!.node.id}:${list[0]!.side}`)! - list.length;
    crowded.push(...(fixed > 0 ? list : list.slice(1)));
  }
  for (const x of crowded) {
    const key = `${x.node.id}:${x.side}`;
    if (occupied.get(key)! <= 1) continue;
    const other = endBox(fc, byId, x.e, x.end === 0 ? "to" : "from");
    if (!other) continue;
    const c = center(x.node);
    const oc = center(other);
    const vertical = x.side === "top" || x.side === "bottom";
    const toward: FlowSide = vertical ? (oc.x >= c.x ? "right" : "left") : oc.y >= c.y ? "bottom" : "top";
    const choice = [toward, OPPOSITE[toward]].find((sd) => !occupied.get(`${x.node.id}:${sd}`) && sd === toward);
    if (!choice) continue;
    occupied.set(key, occupied.get(key)! - 1);
    occupied.set(`${x.node.id}:${choice}`, 1);
    const cur = sides.get(x.e.id)!;
    sides.set(x.e.id, x.end === 0 ? [choice, cur[1]] : [cur[0], choice]);
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

/**
 * Positions for items kept in order and at least `step` apart, each as close as possible to where it wants
 * to be (least squares, by pooling adjacent violators), all within lo…hi.
 */
function placeInOrder(want: readonly number[], step: number, lo: number, hi: number): number[] {
  const n = want.length;
  // Shifted so the spacing constraint becomes "non-decreasing".
  const y = want.map((w, i) => w - i * step);
  const blocks: { sum: number; count: number }[] = [];
  for (const v of y) {
    blocks.push({ sum: v, count: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2]!.sum / blocks[blocks.length - 2]!.count > blocks[blocks.length - 1]!.sum / blocks[blocks.length - 1]!.count) {
      const b = blocks.pop()!;
      blocks[blocks.length - 1]!.sum += b.sum;
      blocks[blocks.length - 1]!.count += b.count;
    }
  }
  const out: number[] = [];
  for (const b of blocks) for (let k = 0; k < b.count; k++) out.push(b.sum / b.count + out.length * step);
  // Keep the run inside the side.
  const shift = out[0]! < lo ? lo - out[0]! : out[n - 1]! > hi ? hi - out[n - 1]! : 0;
  return out.map((t) => Math.max(lo, Math.min(hi, t + shift)));
}

/** Resolves both ends of every connector: sides, spread positions along sides, and points. */
export function resolveEnds(fc: FlowchartData, byId: ReadonlyMap<string, FlowNode> = new Map(fc.nodes.map((n) => [n.id, n]))): Map<string, [ResolvedEnd, ResolvedEnd]> {
  const sides = edgeSides(fc, byId);
  // Several connectors on one side of a node spread out along it, ordered by where their other end is.
  const groups = new Map<string, { edge: FlowEdge; end: "from" | "to"; key: number; tie: number; facing: boolean }[]>();
  for (const e of fc.edges) {
    const s = sides.get(e.id);
    if (!s) continue;
    for (const end of ["from", "to"] as const) {
      const id = end === "from" ? e.from : e.to;
      const side = end === "from" ? s[0] : s[1];
      const explicitAt = end === "from" ? e.fromAt : e.toAt;
      if (!id || !side || explicitAt !== undefined) continue;
      // Where the other end attaches (the middle of its side), or its nearest bend, centre or point.
      const otherEnd = end === "from" ? "to" : "from";
      const other = endBox(fc, byId, e, otherEnd)!;
      const otherNode = byId.get(end === "from" ? e.to : e.from);
      const otherSide = end === "from" ? s[1] : s[0];
      const ref = !e.bends.length && otherNode && otherSide ? outlinePoint(otherNode, otherSide, (end === "from" ? e.toAt : e.fromAt) ?? 0.5) : farRef(e, end, other);
      const horizontal = side === "top" || side === "bottom";
      const node = byId.get(id)!;
      const facing = side === "bottom" ? ref.y >= node.y + node.h : side === "top" ? ref.y <= node.y : side === "right" ? ref.x >= node.x + node.w : ref.x <= node.x;
      const k = `${id}:${side}`;
      const list = groups.get(k) ?? [];
      list.push({ edge: e, end, key: horizontal ? ref.x : ref.y, tie: horizontal ? ref.y : ref.x, facing });
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
    if (n === 1) {
      spread.set(`${list[0]!.edge.id}:${list[0]!.end}`, 0.5);
      continue;
    }
    const range = shapeSpread(node.shape, side);
    if (range <= 0.4) {
      // A pointed side: the tip goes to one connector (a "Yes", or one leaving), the others sit along the
      // slopes on the side their other end is.
      const label = (e: FlowEdge) => e.labels[0]?.text.trim() ?? "";
      const owner = list.find((x) => x.end === "from" && YES.test(label(x.edge))) ?? list.find((x) => x.end === "from") ?? list[Math.floor((n - 1) / 2)]!;
      spread.set(`${owner.edge.id}:${owner.end}`, 0.5);
      const rest = list.filter((x) => x !== owner);
      const before = rest.filter((x) => x.key < owner.key).sort((a, b) => b.key - a.key);
      const after = rest.filter((x) => x.key >= owner.key).sort((a, b) => a.key - b.key);
      before.forEach((x, i) => spread.set(`${x.edge.id}:${x.end}`, Math.max(0.08, 0.5 - (i + 1) * 0.2)));
      after.forEach((x, i) => spread.set(`${x.edge.id}:${x.end}`, Math.min(0.92, 0.5 + (i + 1) * 0.2)));
      continue;
    }
    // Evenly spaced, in order, each as close as it can be to where its other end is (so a connector to a
    // shape straight across stays straight while the others make room).
    const step = Math.min(range / n, 0.25);
    const lo = 0.5 - range / 2 + step / 2;
    const hi = 0.5 + range / 2 - step / 2;
    const horizontal = side === "top" || side === "bottom";
    const start = horizontal ? node.x : node.y;
    const len = (horizontal ? node.w : node.h) || 1;
    const raw = list.map((item) => (item.key - start) / len);
    const want = raw.map((t) => Math.max(lo, Math.min(hi, t)));
    // One connector whose other end is straight across keeps that exact line; the rest space evenly from it.
    let anchor = -1;
    list.forEach((item, i) => {
      if (item.facing && raw[i]! >= lo && raw[i]! <= hi && (anchor < 0 || Math.abs(raw[i]! - 0.5) < Math.abs(raw[anchor]! - 0.5))) anchor = i;
    });
    let placed: number[] | null = null;
    if (anchor >= 0) {
      let st = step;
      if (anchor > 0) st = Math.min(st, (want[anchor]! - lo + step / 2) / anchor);
      if (anchor < n - 1) st = Math.min(st, (hi + step / 2 - want[anchor]!) / (n - 1 - anchor));
      if (st * len >= 12) placed = list.map((_, i) => want[anchor]! + (i - anchor) * st);
    }
    for (const [i, t] of (placed ?? placeInOrder(want, step, lo, hi)).entries()) spread.set(`${list[i]!.edge.id}:${list[i]!.end}`, t);
  }
  // Two shapes facing each other, nearly in line, each with only this connector on that side: line the
  // ends up so the connector runs straight instead of making a tiny jog.
  for (const e of fc.edges) {
    const s = sides.get(e.id);
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!s || !a || !b || !s[0] || !s[1] || s[1] !== OPPOSITE[s[0]] || e.fromAt !== undefined || e.toAt !== undefined || e.bends.length) continue;
    if (groups.get(`${a.id}:${s[0]}`)?.length !== 1 || groups.get(`${b.id}:${s[1]}`)?.length !== 1) continue;
    const horizontal = s[0] === "left" || s[0] === "right";
    const facing = s[0] === "right" ? b.x >= a.x + a.w : s[0] === "left" ? b.x + b.w <= a.x : s[0] === "bottom" ? b.y >= a.y + a.h : b.y + b.h <= a.y;
    if (!facing) continue;
    const range = (n: FlowNode, side: FlowSide): [number, number] => {
      const sp = shapeSpread(n.shape, side);
      const start = horizontal ? n.y : n.x;
      const len = horizontal ? n.h : n.w;
      return [start + len * (0.5 - sp / 2), start + len * (0.5 + sp / 2)];
    };
    const [a0, a1] = range(a, s[0]);
    const [b0, b1] = range(b, s[1]);
    const lo = Math.max(a0, b0);
    const hi = Math.min(a1, b1);
    const ca = horizontal ? a.y + a.h / 2 : a.x + a.w / 2;
    const cb = horizontal ? b.y + b.h / 2 : b.x + b.w / 2;
    if (lo > hi || Math.abs(ca - cb) > 16) continue;
    const v = Math.max(lo, Math.min(hi, (ca + cb) / 2));
    spread.set(`${e.id}:from`, horizontal ? (v - a.y) / a.h : (v - a.x) / a.w);
    spread.set(`${e.id}:to`, horizontal ? (v - b.y) / b.h : (v - b.x) / b.w);
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

/** The middles of the gaps between obstacles along one axis (and just outside them), nearest `mid` first. */
function channels(intervals: [number, number][], mid: number, max = 16): number[] {
  if (!intervals.length) return [];
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [[...intervals[0]!]];
  for (const [a, b] of intervals.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  const out = [merged[0]![0] - 8, merged[merged.length - 1]![1] + 8];
  for (let i = 1; i < merged.length; i++) out.push((merged[i - 1]![1] + merged[i]![0]) / 2);
  return out.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid)).slice(0, max);
}

/** Z routes whose middle runs down a gap between the obstacles near a leg. */
function channelCandidates(s: Pt, e: Pt, obstacles: readonly Rect[]): Pt[][] {
  const y0 = Math.min(s.y, e.y);
  const y1 = Math.max(s.y, e.y);
  const x0 = Math.min(s.x, e.x);
  const x1 = Math.max(s.x, e.x);
  const out: Pt[][] = [];
  // Vertical middles: obstacles spanning the rows between the ends.
  for (const x of channels(obstacles.filter((r) => r.y < y1 && r.y + r.h > y0).map((r) => [r.x, r.x + r.w]), (x0 + x1) / 2)) out.push(simplify([s, { x, y: s.y }, { x, y: e.y }, e]));
  for (const y of channels(obstacles.filter((r) => r.x < x1 && r.x + r.w > x0).map((r) => [r.y, r.y + r.h]), (y0 + y1) / 2)) out.push(simplify([s, { x: s.x, y }, { x: e.x, y }, e]));
  return out;
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
  for (const v of values) if (!out.length || v - out[out.length - 1]! > 1e-6) out.push(v);
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
  if (obstacles.length <= 40) {
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
  const si = lowerIndex(xs, s.x - 1e-7);
  const sj = lowerIndex(ys, s.y - 1e-7);
  const ei = lowerIndex(xs, e.x - 1e-7);
  const ej = lowerIndex(ys, e.y - 1e-7);
  if (si >= nx || sj >= ny || ei >= nx || ej >= ny) return null;
  const goal = ei * ny + ej;
  const g = new Float64Array(N * 4).fill(Infinity);
  const parent = new Int32Array(N * 4).fill(-1);
  const heap = new Heap();
  const ex = xs[ei]!;
  const ey = ys[ej]!;
  // Distance plus the turns still needed from this direction (never more than the real cost).
  const hOf = (i: number, j: number, d: number) => {
    const dx = ex - xs[i]!;
    const dy = ey - ys[j]!;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    let turns = 0;
    if (adx > EPS && ady > EPS) turns = (d === 0 && dx > 0) || (d === 2 && dx < 0) || (d === 1 && dy > 0) || (d === 3 && dy < 0) ? 1 : 2;
    else if (adx > EPS) turns = (d === 0 && dx > 0) || (d === 2 && dx < 0) ? 0 : d === 1 || d === 3 ? 1 : 2;
    else if (ady > EPS) turns = (d === 1 && dy > 0) || (d === 3 && dy < 0) ? 0 : d === 0 || d === 2 ? 1 : 2;
    return adx + ady + turns * bendCost;
  };
  const start = si * ny + sj;
  for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
    if (ds !== null && d !== ds) continue;
    g[start * 4 + d] = 0;
    heap.push(start * 4 + d, hOf(si, sj, d));
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
        heap.push(ns, cost + hOf(ni, nj, d2));
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
  // Z routes through the gaps between nearby shapes (cheap, and usually what a search would find).
  if (!best) {
    for (const c of channelCandidates(s, e, obstacles)) {
      const cost = legCost(c, ds, de, o.bendCost);
      if (Number.isFinite(cost) && cost < bestCost && legClear(c, obstacles)) {
        bestCost = cost;
        best = c;
      }
    }
    if (best && best.length <= 4) return { pts: best, searched: false, clear: true, wide: false };
  }
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
  for (const pad of [64, 480]) {
    const win = box(pad);
    const wide = pad > 64;
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

const unitV = (x: number, y: number): Pt => {
  const len = Math.hypot(x, y);
  return len > EPS ? { x: x / len, y: y / len } : { x: 0, y: 0 };
};

/**
 * A smooth curve through every point in order (a Catmull-Rom style spline as cubic pieces). `d0` and `dn`
 * are the directions leaving the first point and arriving at the last (unit vectors; zero to let the
 * neighbours decide). Each piece's handles are a third of its own length, so short stretches don't
 * overshoot, and the ends leave along their directions a little further, like the S-curve.
 */
export function splineThrough(pts: readonly Pt[], d0: Pt = { x: 0, y: 0 }, dn: Pt = { x: 0, y: 0 }): CurveSeg[] {
  const n = pts.length;
  if (n < 2) return [];
  const tan: Pt[] = pts.map((p, i) => {
    if (i === 0 && (d0.x || d0.y)) return d0;
    if (i === n - 1 && (dn.x || dn.y)) return dn;
    const prev = pts[Math.max(0, i - 1)]!;
    const next = pts[Math.min(n - 1, i + 1)]!;
    const t = unitV(next.x - prev.x, next.y - prev.y);
    return t.x || t.y ? t : unitV(next.x - p.x, next.y - p.y);
  });
  const segs: CurveSeg[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const endHandle = Math.min(160, Math.max(Math.min(30, len), len / 2));
    const ha = i === 0 && (d0.x || d0.y) ? endHandle : len / 3;
    const hb = i === n - 2 && (dn.x || dn.y) ? endHandle : len / 3;
    segs.push({
      c1: { x: a.x + tan[i]!.x * ha, y: a.y + tan[i]!.y * ha },
      c2: { x: b.x - tan[i + 1]!.x * hb, y: b.y - tan[i + 1]!.y * hb },
      to: { ...b },
    });
  }
  return segs;
}

/** Samples of cubic pieces starting at `start` (`per` samples each, the start included once). */
function sampleSegs(start: Pt, segs: readonly CurveSeg[], per = 16): Pt[] {
  const out: Pt[] = [{ ...start }];
  let from = start;
  for (const s of segs) {
    for (let k = 1; k <= per; k++) out.push(k === per ? { ...s.to } : cubicAt(from, s.c1, s.c2, s.to, k / per));
    from = s.to;
  }
  return out;
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

const NEAR = 72;
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

function routeOne(e: FlowEdge, a: ResolvedEnd, b: ResolvedEnd, nodes: readonly FlowNode[], padded: readonly Rect[], o: Required<RouteOptions>): { raw: Raw; cached: boolean } {
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
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    let r = padded[i]!;
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
  if (!raw && kind === "curved" && e.bends.length) raw = curveThroughBends(e, a, b, s, t, ds, de, obstacles, o, all);
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

/**
 * A curved connector with bend points: a spline through the ends and every bend. A stretch between two of
 * them that would cut through a shape also passes the corners of the elbow route around it (its own ends
 * stay fixed), so the curve still goes through each bend exactly.
 */
function curveThroughBends(e: FlowEdge, a: ResolvedEnd, b: ResolvedEnd, s: Pt, t: Pt, ds: Dir | null, de: Dir | null, obstacles: readonly Rect[], o: Required<RouteOptions>, all: readonly Rect[]): Raw {
  const keys = [a.point, ...e.bends, b.point];
  const d0 = ds !== null ? { x: DX[ds]!, y: DY[ds]! } : { x: 0, y: 0 };
  const dn = de !== null ? { x: DX[de]!, y: DY[de]! } : { x: 0, y: 0 };
  const others = obstacles.filter((r) => !sameRect(r, a.node, o.padding) && !sameRect(r, b.node, o.padding));
  const PER = 16;
  const build = (vias: Pt[][]) => {
    const pts: Pt[] = [keys[0]!];
    const legOf: number[] = [];
    for (let i = 1; i < keys.length; i++) {
      for (const v of vias[i - 1]!) {
        pts.push(v);
        legOf.push(i - 1);
      }
      pts.push(keys[i]!);
      legOf.push(i - 1);
    }
    const segs = splineThrough(pts, d0, dn);
    return { segs, legOf, samples: sampleSegs(pts[0]!, segs, PER) };
  };
  const vias: Pt[][] = keys.slice(1).map(() => []);
  let built = build(vias);
  let searched = false;
  for (let leg = 0; leg < keys.length - 1; leg++) {
    // The samples of this stretch, less a little at a shape end (the curve leaves the shape's margin there).
    const idx = built.legOf.flatMap((l, k) => (l === leg ? [k] : []));
    const from = idx[0]! * PER;
    const to = (idx[idx.length - 1]! + 1) * PER;
    const lo = leg === 0 && a.node ? from + 3 : from;
    const hi = leg === keys.length - 2 && b.node ? to - 3 : to;
    if (curveClear(built.samples.slice(lo, hi + 1), others)) continue;
    const first = leg === 0;
    const last = leg === keys.length - 2;
    const route = routeLeg(first ? s : keys[leg]!, first ? ds : null, last ? t : keys[leg + 1]!, last ? de : null, obstacles, null, o, all);
    searched ||= route.searched;
    // The elbow route's corners (not its ends, nor the stub points straight out of a shape).
    vias[leg] = route.pts.slice(1, -1);
    built = build(vias);
  }
  return { points: built.samples, curve: built.segs, searched };
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
        // Order the lines so that, once apart, none crosses another's turns: try both orders of each pair
        // and keep the one with fewer crossings.
        const along = (p: Pt) => (horizontal ? p.x : p.y);
        const across = (p: Pt) => (horizontal ? p.y : p.x);
        const shape = (c: Seg, at: number) => {
          const p = routes[c.route]!.points;
          const a = p[c.index]!;
          const b = p[c.index + 1]!;
          const turns = [
            { at: along(a), lo: Math.min(across(p[c.index - 1]!), at), hi: Math.max(across(p[c.index - 1]!), at) },
            { at: along(b), lo: Math.min(across(p[c.index + 2]!), at), hi: Math.max(across(p[c.index + 2]!), at) },
          ];
          return { at, lo: Math.min(along(a), along(b)), hi: Math.max(along(a), along(b)), turns };
        };
        const crossingsIf = (first: Seg, second: Seg) => {
          const A = shape(first, first.at - 1);
          const B = shape(second, second.at + 1);
          let n = 0;
          for (const t of B.turns) if (t.at > A.lo + EPS && t.at < A.hi - EPS && A.at > t.lo && A.at < t.hi) n++;
          for (const t of A.turns) if (t.at > B.lo + EPS && t.at < B.hi - EPS && B.at > t.lo && B.at < t.hi) n++;
          return n;
        };
        cluster.sort((s1, s2) => crossingsIf(s1, s2) - crossingsIf(s2, s1) || (routes[s1.route]!.id < routes[s2.route]!.id ? -1 : 1));
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

/** Every connector's straight segments, by line, for counting crossings quickly; owners can be re-routed. */
class SegmentIndex {
  /** Horizontal segments sorted by y, vertical ones sorted by x: [fixed, lo, hi, owner, generation]. */
  private hs: [number, number, number, number, number][] = [];
  private vs: [number, number, number, number, number][] = [];
  private extra: [boolean, number, number, number, number, number][] = [];
  private gen: number[];
  constructor(owners: readonly (readonly Pt[])[]) {
    this.gen = owners.map(() => 0);
    owners.forEach((pts, k) => {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        if (Math.abs(a.y - b.y) < EPS) this.hs.push([a.y, Math.min(a.x, b.x), Math.max(a.x, b.x), k, 0]);
        else if (Math.abs(a.x - b.x) < EPS) this.vs.push([a.x, Math.min(a.y, b.y), Math.max(a.y, b.y), k, 0]);
      }
    });
    this.hs.sort((p, q) => p[0] - q[0]);
    this.vs.sort((p, q) => p[0] - q[0]);
  }
  /** Replaces an owner's segments. */
  replace(owner: number, pts: readonly Pt[]): void {
    const g = ++this.gen[owner]!;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const h = Math.abs(a.y - b.y) < EPS;
      this.extra.push(h ? [true, a.y, Math.min(a.x, b.x), Math.max(a.x, b.x), owner, g] : [false, a.x, Math.min(a.y, b.y), Math.max(a.y, b.y), owner, g]);
    }
  }
  /** How many times `pts` crosses the other owners' segments. */
  count(pts: readonly Pt[], self: number): number {
    let n = 0;
    const lowerBound = (arr: readonly [number, ...number[]][], v: number) => {
      let lo = 0;
      let hi = arr.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (arr[m]![0] < v) lo = m + 1;
        else hi = m;
      }
      return lo;
    };
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const h = Math.abs(a.y - b.y) < EPS;
      const fixed = h ? a.y : a.x;
      const lo = h ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
      const hi = h ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
      const cross = h ? this.vs : this.hs;
      for (let k = lowerBound(cross, lo + 1); k < cross.length && cross[k]![0] < hi - 1; k++) {
        const s = cross[k]!;
        if (s[3] === self || s[4] !== this.gen[s[3]]) continue;
        if (fixed > s[1] + 1 && fixed < s[2] - 1) n++;
      }
      for (const s of this.extra) {
        if (s[0] === h || s[4] === self || s[5] !== this.gen[s[4]]) continue;
        if (s[1] > lo + 1 && s[1] < hi - 1 && fixed > s[2] + 1 && fixed < s[3] - 1) n++;
      }
    }
    return n;
  }
}

/**
 * Connectors that cut across many others (loops back to an earlier step, long jumps) are offered a detour
 * around the outside of the shapes they pass: out of one side of each shape, along the outside, and in.
 * The detour is taken when it crosses fewer connectors and isn't much longer.
 */
function detourCrossers(work: { edge: FlowEdge; points: Pt[]; orthogonal: boolean; a: ResolvedEnd; b: ResolvedEnd }[], nodes: readonly FlowNode[], padded: readonly Rect[], o: Required<RouteOptions>): void {
  const index = new SegmentIndex(work.map((w) => (w.orthogonal ? w.points : [])));
  const order = work
    .map((w, k) => ({ k, w }))
    .filter(({ w }) => w.orthogonal && w.a.node && w.b.node && !w.edge.bends.length && !w.edge.fromSide && !w.edge.toSide)
    .map(({ k, w }) => ({ k, w, c: index.count(w.points, k) }))
    .filter((x) => x.c >= 1)
    .sort((x, y) => y.c - x.c || (x.w.edge.id < y.w.edge.id ? -1 : 1));
  const len = (pts: readonly Pt[]) => pts.slice(1).reduce((s, q, i) => s + Math.abs(q.x - pts[i]!.x) + Math.abs(q.y - pts[i]!.y), 0);
  for (const { k, w } of order.slice(0, 24)) {
    const A = w.a.node!;
    const B = w.b.node!;
    const current = index.count(w.points, k);
    if (current < 1) continue;
    const y0 = Math.min(A.y, B.y);
    const y1 = Math.max(A.y + A.h, B.y + B.h);
    const x0 = Math.min(A.x, B.x);
    const x1 = Math.max(A.x + A.w, B.x + B.w);
    const rowSpan = nodes.filter((n) => n.y < y1 && n.y + n.h > y0);
    const colSpan = nodes.filter((n) => n.x < x1 && n.x + n.w > x0);
    const gap = 2 * o.padding + o.separation;
    const cands: { pts: Pt[]; sa: FlowSide; sb: FlowSide }[] = [];
    const via = (side: FlowSide): Pt[] => {
      const pa = outlinePoint(A, side, 0.5);
      const pb = outlinePoint(B, side, 0.5);
      switch (side) {
        case "left": {
          const x = Math.min(...rowSpan.map((n) => n.x)) - gap;
          return [pa, { x, y: pa.y }, { x, y: pb.y }, pb];
        }
        case "right": {
          const x = Math.max(...rowSpan.map((n) => n.x + n.w)) + gap;
          return [pa, { x, y: pa.y }, { x, y: pb.y }, pb];
        }
        case "top": {
          const y = Math.min(...colSpan.map((n) => n.y)) - gap;
          return [pa, { x: pa.x, y }, { x: pb.x, y }, pb];
        }
        case "bottom": {
          const y = Math.max(...colSpan.map((n) => n.y + n.h)) + gap;
          return [pa, { x: pa.x, y }, { x: pb.x, y }, pb];
        }
      }
    };
    for (const side of ["left", "right", "top", "bottom"] as const) cands.push({ pts: via(side), sa: side, sb: side });
    const base = len(w.points);
    let best: { pts: Pt[]; sa: FlowSide; sb: FlowSide; c: number; l: number } | null = null;
    for (const c of cands) {
      const pts = simplify(c.pts);
      // Clear of every shape (the first and last runs leave and enter the connector's own shapes).
      let clear = true;
      for (let i = 1; i < pts.length && clear; i++) {
        for (let j = 0; j < nodes.length; j++) {
          const own = nodes[j] === A || nodes[j] === B;
          if (own && (i === 1 || i === pts.length - 1)) continue;
          if (segHits(pts[i - 1]!.x, pts[i - 1]!.y, pts[i]!.x, pts[i]!.y, own ? nodes[j]! : padded[j]!)) {
            clear = false;
            break;
          }
        }
      }
      if (!clear) continue;
      const cc = index.count(pts, k);
      const l = len(pts);
      if (cc < current && l <= base * 2.5 + 300 && (!best || cc < best.c || (cc === best.c && l < best.l))) best = { pts, sa: c.sa, sb: c.sb, c: cc, l };
    }
    if (!best) continue;
    w.points = best.pts;
    w.a = { ...w.a, side: best.sa, point: best.pts[0]!, at: 0.5 };
    w.b = { ...w.b, side: best.sb, point: best.pts[best.pts.length - 1]!, at: 0.5 };
    index.replace(k, best.pts);
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
  const padded = fc.nodes.map((n) => inflate(n, o.padding));
  const work: { edge: FlowEdge; points: Pt[]; curve: CurveSeg[] | null; orthogonal: boolean; curved: boolean; id: string; hops: Hop[]; a: ResolvedEnd; b: ResolvedEnd }[] = [];
  let cached = 0;
  let searched = 0;
  for (const e of fc.edges) {
    const pair = ends.get(e.id);
    if (!pair) continue;
    const [a, b] = pair;
    const { raw, cached: hit } = routeOne(e, a, b, fc.nodes, padded, o);
    if (hit) cached++;
    if (raw.searched && !hit) searched++;
    work.push({ edge: e, points: raw.points.map((p) => ({ ...p })), curve: raw.curve, orthogonal: e.route === "elbow", curved: raw.curve !== null, id: e.id, hops: [], a, b });
  }
  const obstacles = fc.nodes.map((n) => n as Rect);
  detourCrossers(work, fc.nodes, padded, o);
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
