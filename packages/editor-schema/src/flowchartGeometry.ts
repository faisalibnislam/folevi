// Flowchart geometry shared by the editor canvas, read-only pages and exports: shape outlines, connection
// points, orthogonal connector routing (with rounded corners), arrowheads, label placement and bounds.
// Pure functions of the chart data, so every surface draws exactly the same picture.
import {
  FLOWCHART_LABEL_FONT_SIZE,
  ioSkew,
  measureFlowText,
  type FlowchartData,
  type FlowEdge,
  type FlowNode,
  type FlowSide,
} from "./flowchart";

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const NORMAL: Record<FlowSide, Pt> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
export const OPPOSITE: Record<FlowSide, FlowSide> = { top: "bottom", bottom: "top", left: "right", right: "left" };
const CORNER = 10;
const STUB = 18;
const ARROW_LEN = 9;
const ARROW_HALF = 4.6;

/** SVG path for a node's outline. */
export function shapePath(n: Pick<FlowNode, "shape" | "x" | "y" | "w" | "h">): string {
  const { x, y, w, h } = n;
  switch (n.shape) {
    case "decision": {
      // A diamond with softened corners.
      const cx = x + w / 2;
      const cy = y + h / 2;
      const pts: Pt[] = [
        { x: cx, y },
        { x: x + w, y: cy },
        { x: cx, y: y + h },
        { x, y: cy },
      ];
      return roundedPolygon(pts, Math.min(8, w / 10, h / 10));
    }
    case "io": {
      const s = ioSkew(n);
      return roundedPolygon(
        [
          { x: x + s, y },
          { x: x + w, y },
          { x: x + w - s, y: y + h },
          { x, y: y + h },
        ],
        6,
      );
    }
    case "circle":
      return `M${r1(x)} ${r1(y + h / 2)}A${r1(w / 2)} ${r1(h / 2)} 0 1 0 ${r1(x + w)} ${r1(y + h / 2)}A${r1(w / 2)} ${r1(h / 2)} 0 1 0 ${r1(x)} ${r1(y + h / 2)}Z`;
    case "terminator":
      return roundedRect(x, y, w, h, Math.min(h, w) / 2);
    case "note":
      return roundedRect(x, y, w, h, 4);
    case "text":
      return roundedRect(x, y, w, h, 6);
    default:
      return roundedRect(x, y, w, h, CORNER);
  }
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return `M${r1(x + rr)} ${r1(y)}H${r1(x + w - rr)}A${r1(rr)} ${r1(rr)} 0 0 1 ${r1(x + w)} ${r1(y + rr)}V${r1(y + h - rr)}A${r1(rr)} ${r1(rr)} 0 0 1 ${r1(x + w - rr)} ${r1(y + h)}H${r1(x + rr)}A${r1(rr)} ${r1(rr)} 0 0 1 ${r1(x)} ${r1(y + h - rr)}V${r1(y + rr)}A${r1(rr)} ${r1(rr)} 0 0 1 ${r1(x + rr)} ${r1(y)}Z`;
}

function roundedPolygon(pts: Pt[], r: number): string {
  let d = "";
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const prev = pts[(i + pts.length - 1) % pts.length]!;
    const next = pts[(i + 1) % pts.length]!;
    const a = toward(p, prev, r);
    const b = toward(p, next, r);
    d += `${i === 0 ? "M" : "L"}${r1(a.x)} ${r1(a.y)}Q${r1(p.x)} ${r1(p.y)} ${r1(b.x)} ${r1(b.y)}`;
  }
  return `${d}Z`;
}

function toward(from: Pt, to: Pt, dist: number): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const d = Math.min(dist, len / 2);
  return { x: from.x + (dx / len) * d, y: from.y + (dy / len) * d };
}

/** Where a connector meets a node side; `t` (0…1) spreads several connectors along one side. */
export function portPoint(n: FlowNode, side: FlowSide, t = 0.5): Pt {
  const { x, y, w, h } = n;
  // Diamonds, circles and pill ends connect at the tips only.
  const spread = n.shape === "decision" || n.shape === "circle" || (n.shape === "terminator" && (side === "left" || side === "right")) ? 0.5 : t;
  if (n.shape === "io") {
    const s = ioSkew(n);
    switch (side) {
      case "top":
        return { x: x + s + (w - s) * spread, y };
      case "bottom":
        return { x: x + (w - s) * spread, y: y + h };
      case "left":
        return { x: x + s * (1 - spread), y: y + h * spread };
      case "right":
        return { x: x + w - s * spread, y: y + h * spread };
    }
  }
  if (n.shape === "terminator" && (side === "top" || side === "bottom")) {
    const r = Math.min(h, w) / 2;
    const px = x + r + (w - 2 * r) * spread;
    return { x: px, y: side === "top" ? y : y + h };
  }
  switch (side) {
    case "top":
      return { x: x + w * spread, y };
    case "bottom":
      return { x: x + w * spread, y: y + h };
    case "left":
      return { x, y: y + h * spread };
    case "right":
      return { x: x + w, y: y + h * spread };
  }
}

const center = (n: Rect): Pt => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

/** Natural sides for a connector between two nodes (vertical flow preferred). */
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

/** The side of a node closest to a point (for dropping a connector on a node). */
export function nearestSide(n: Rect, p: Pt): FlowSide {
  const d: [FlowSide, number][] = [
    ["top", Math.abs(p.y - n.y)],
    ["bottom", Math.abs(p.y - (n.y + n.h))],
    ["left", Math.abs(p.x - n.x)],
    ["right", Math.abs(p.x - (n.x + n.w))],
  ];
  return d.sort((a, b) => a[1] - b[1])[0]![0];
}

// ------------------------------------------------------------------------------------------ routing

function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push(p);
    // Drop the middle of three points on one line.
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3) as [Pt, Pt, Pt];
      const colinear = (Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01);
      if (!colinear) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

/** Whether an axis-aligned segment passes through a rectangle's interior. */
function segmentHitsRect(a: Pt, b: Pt, r: Rect, inset = 2): boolean {
  const x0 = r.x + inset;
  const x1 = r.x + r.w - inset;
  const y0 = r.y + inset;
  const y1 = r.y + r.h - inset;
  if (Math.abs(a.y - b.y) < 0.01) {
    if (a.y <= y0 || a.y >= y1) return false;
    return Math.max(a.x, b.x) > x0 && Math.min(a.x, b.x) < x1;
  }
  if (a.x <= x0 || a.x >= x1) return false;
  return Math.max(a.y, b.y) > y0 && Math.min(a.y, b.y) < y1;
}

function pathScore(pts: Pt[], ra: Rect, rb: Rect): number {
  let len = 0;
  let penalty = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    len += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    // The first and last segments leave and enter their own node by construction.
    if (i > 1 && segmentHitsRect(a, b, ra)) penalty += 1000;
    if (i < pts.length - 1 && segmentHitsRect(a, b, rb)) penalty += 1000;
    if (i >= 2) {
      const p = pts[i - 2]!;
      const d1 = { x: Math.sign(a.x - p.x), y: Math.sign(a.y - p.y) };
      const d2 = { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) };
      if (d1.x === -d2.x && d1.y === -d2.y) penalty += 2000; // doubling back
    }
  }
  return len + (pts.length - 2) * 14 + penalty;
}

/**
 * An orthogonal route from `a` (leaving through side `sa`) to `b` (entering through `sb`): short stubs
 * straight out of each node, then the cheapest of a few elbow shapes that doesn't cut through either node.
 */
export function orthogonalRoute(a: Pt, sa: FlowSide, b: Pt, sb: FlowSide, ra: Rect, rb: Rect): Pt[] {
  const na = NORMAL[sa];
  const nb = NORMAL[sb];
  const p1 = { x: a.x + na.x * STUB, y: a.y + na.y * STUB };
  const p2 = { x: b.x + nb.x * STUB, y: b.y + nb.y * STUB };
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const top = Math.min(ra.y, rb.y) - STUB;
  const bottom = Math.max(ra.y + ra.h, rb.y + rb.h) + STUB;
  const left = Math.min(ra.x, rb.x) - STUB;
  const right = Math.max(ra.x + ra.w, rb.x + rb.w) + STUB;
  const middles: Pt[][] = [
    [{ x: p1.x, y: p2.y }],
    [{ x: p2.x, y: p1.y }],
    [
      { x: p1.x, y: my },
      { x: p2.x, y: my },
    ],
    [
      { x: mx, y: p1.y },
      { x: mx, y: p2.y },
    ],
    [
      { x: p1.x, y: top },
      { x: p2.x, y: top },
    ],
    [
      { x: p1.x, y: bottom },
      { x: p2.x, y: bottom },
    ],
    [
      { x: left, y: p1.y },
      { x: left, y: p2.y },
    ],
    [
      { x: right, y: p1.y },
      { x: right, y: p2.y },
    ],
  ];
  let best: Pt[] | null = null;
  let bestScore = Infinity;
  for (const mid of middles) {
    const pts = simplify([a, p1, ...mid, p2, b]);
    const s = pathScore(pts, ra, rb);
    if (s < bestScore) {
      bestScore = s;
      best = pts;
    }
  }
  return best!;
}

/** SVG path through the points with rounded corners. */
export function roundedPolyline(pts: readonly Pt[], radius = 10): string {
  if (!pts.length) return "";
  let d = `M${r1(pts[0]!.x)} ${r1(pts[0]!.y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const prev = pts[i - 1]!;
    const next = pts[i + 1]!;
    const lin = Math.hypot(p.x - prev.x, p.y - prev.y);
    const lout = Math.hypot(next.x - p.x, next.y - p.y);
    const r = Math.min(radius, lin / 2, lout / 2);
    const a = toward(p, prev, r);
    const b = toward(p, next, r);
    d += `L${r1(a.x)} ${r1(a.y)}Q${r1(p.x)} ${r1(p.y)} ${r1(b.x)} ${r1(b.y)}`;
  }
  const last = pts[pts.length - 1]!;
  return `${d}L${r1(last.x)} ${r1(last.y)}`;
}

/** A small swept arrowhead with its tip at `tip`, pointing along `dir` (a unit vector). */
function arrowHead(tip: Pt, dir: Pt): string {
  const base = { x: tip.x - dir.x * ARROW_LEN, y: tip.y - dir.y * ARROW_LEN };
  const notch = { x: tip.x - dir.x * ARROW_LEN * 0.72, y: tip.y - dir.y * ARROW_LEN * 0.72 };
  const perp = { x: -dir.y, y: dir.x };
  const l = { x: base.x + perp.x * ARROW_HALF, y: base.y + perp.y * ARROW_HALF };
  const r = { x: base.x - perp.x * ARROW_HALF, y: base.y - perp.y * ARROW_HALF };
  return `M${r1(tip.x)} ${r1(tip.y)}L${r1(l.x)} ${r1(l.y)}Q${r1(notch.x)} ${r1(notch.y)} ${r1(r.x)} ${r1(r.y)}Z`;
}

function unit(from: Pt, to: Pt): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** The point halfway along a polyline. */
function midpoint(pts: readonly Pt[]): Pt {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg >= left && seg > 0) return { x: a.x + ((b.x - a.x) * left) / seg, y: a.y + ((b.y - a.y) * left) / seg };
    left -= seg;
  }
  return pts[0] ?? { x: 0, y: 0 };
}

export interface RoutedEdge {
  edge: FlowEdge;
  points: Pt[];
  /** The line (shortened under its arrowheads). */
  d: string;
  /** Arrowhead outlines (filled). */
  heads: string[];
  fromSide: FlowSide;
  toSide: FlowSide;
  /** Label box, when the edge has a label. */
  label: (Rect & { cx: number; cy: number }) | null;
}

/** Resolved sides for every edge: explicit ones kept, the rest chosen from the nodes' positions. */
export function edgeSides(fc: FlowchartData, byId: ReadonlyMap<string, FlowNode>): Map<string, [FlowSide, FlowSide]> {
  const sides = new Map<string, [FlowSide, FlowSide]>();
  for (const e of fc.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const [fa, fb] = autoSides(a, b);
    sides.set(e.id, [e.fromSide ?? fa, e.toSide ?? fb]);
  }
  // A decision with several automatic branches leaving the same tip: send the extra ones out sideways,
  // toward their targets (the classic Yes-down / No-right shape).
  const bySource = new Map<string, FlowEdge[]>();
  for (const e of fc.edges) {
    const s = sides.get(e.id);
    if (e.fromSide || !s || byId.get(e.from)?.shape !== "decision") continue;
    const key = `${e.from}:${s[0]}`;
    bySource.set(key, [...(bySource.get(key) ?? []), e]);
  }
  for (const list of bySource.values()) {
    if (list.length < 2) continue;
    const src = byId.get(list[0]!.from)!;
    const c = center(src);
    const vertical = sides.get(list[0]!.id)![0] === "top" || sides.get(list[0]!.id)![0] === "bottom";
    const off = (e: FlowEdge) => {
      const t = center(byId.get(e.to)!);
      return vertical ? t.x - c.x : t.y - c.y;
    };
    const sorted = [...list].sort((x, y) => Math.abs(off(x)) - Math.abs(off(y)));
    const taken = new Set<FlowSide>();
    for (const e of sorted.slice(1)) {
      const o = off(e);
      let side: FlowSide = vertical ? (o >= 0 ? "right" : "left") : o >= 0 ? "bottom" : "top";
      if (taken.has(side)) side = OPPOSITE[side];
      if (taken.has(side)) continue;
      taken.add(side);
      const cur = sides.get(e.id)!;
      sides.set(e.id, [side, e.toSide ?? cur[1]]);
    }
  }
  return sides;
}

/** Routes every connector of the chart (edges whose nodes are missing are skipped). */
export function routeEdges(fc: FlowchartData): RoutedEdge[] {
  const byId = new Map(fc.nodes.map((n) => [n.id, n]));
  const sides = edgeSides(fc, byId);
  // Several connectors on one side of a node spread out along it, ordered by where their other end is.
  const groups = new Map<string, { edge: FlowEdge; end: "from" | "to"; key: number }[]>();
  for (const e of fc.edges) {
    const s = sides.get(e.id);
    if (!s) continue;
    for (const end of ["from", "to"] as const) {
      const self = byId.get(end === "from" ? e.from : e.to)!;
      const other = byId.get(end === "from" ? e.to : e.from)!;
      const side = end === "from" ? s[0] : s[1];
      const oc = center(other);
      const key = side === "top" || side === "bottom" ? oc.x : oc.y;
      const k = `${self.id}:${side}`;
      const list = groups.get(k) ?? [];
      list.push({ edge: e, end, key });
      groups.set(k, list);
    }
  }
  const spread = new Map<string, number>();
  for (const list of groups.values()) {
    list.sort((a, b) => a.key - b.key);
    const n = list.length;
    const step = n > 1 ? Math.min(0.22, 0.64 / (n - 1)) : 0;
    list.forEach((item, i) => spread.set(`${item.edge.id}:${item.end}`, 0.5 + (i - (n - 1) / 2) * step));
  }
  const out: RoutedEdge[] = [];
  for (const e of fc.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    const s = sides.get(e.id);
    if (!a || !b || !s) continue;
    const pa = portPoint(a, s[0], spread.get(`${e.id}:from`) ?? 0.5);
    const pb = portPoint(b, s[1], spread.get(`${e.id}:to`) ?? 0.5);
    const points = orthogonalRoute(pa, s[0], pb, s[1], a, b);
    out.push(routedFromPoints(e, points, s[0], s[1]));
  }
  return out;
}

/** Line, arrowheads and label box for a connector drawn through `points`. */
export function routedFromPoints(e: FlowEdge, points: Pt[], fromSide: FlowSide, toSide: FlowSide): RoutedEdge {
  const line = points.map((p) => ({ ...p }));
  const heads: string[] = [];
  if (line.length >= 2 && (e.arrow === "end" || e.arrow === "both")) {
    const tip = points[points.length - 1]!;
    const dir = unit(points[points.length - 2]!, tip);
    heads.push(arrowHead(tip, dir));
    line[line.length - 1] = { x: tip.x - dir.x * (ARROW_LEN - 2), y: tip.y - dir.y * (ARROW_LEN - 2) };
  }
  if (line.length >= 2 && e.arrow === "both") {
    const tip = points[0]!;
    const dir = unit(points[1]!, tip);
    heads.push(arrowHead(tip, dir));
    line[0] = { x: tip.x - dir.x * (ARROW_LEN - 2), y: tip.y - dir.y * (ARROW_LEN - 2) };
  }
  let label: RoutedEdge["label"] = null;
  if (e.label) {
    const m = midpoint(points);
    const w = Math.min(220, measureFlowText(e.label, FLOWCHART_LABEL_FONT_SIZE)) + 12;
    const h = 20;
    label = { x: m.x - w / 2, y: m.y - h / 2, w, h, cx: m.x, cy: m.y };
  }
  return { edge: e, points, d: roundedPolyline(line), heads, fromSide, toSide, label };
}

/** Bounding box of every node, connector and label (null for an empty chart). */
export function flowchartBounds(fc: FlowchartData, routed: readonly RoutedEdge[] = routeEdges(fc)): Rect | null {
  if (!fc.nodes.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const n of fc.nodes) {
    add(n.x, n.y);
    add(n.x + n.w, n.y + n.h);
  }
  for (const r of routed) {
    for (const p of r.points) add(p.x, p.y);
    if (r.label) {
      add(r.label.x, r.label.y);
      add(r.label.x + r.label.w, r.label.y + r.label.h);
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
