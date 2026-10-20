// Flowchart drawing geometry shared by the editor canvas, read-only pages and exports: connector paths
// (rounded corners, line hops, curves), line ends (arrow, open arrow, circle, diamond, bar), label boxes
// along a connector, and the chart's bounds. Pure functions of the chart data (routing lives in
// flowchartRouting.ts, shape outlines in flowchartShapes.ts), so every surface draws the same picture.
import { FLOWCHART_EDGE_WIDTH, FLOWCHART_LABEL_FONT_SIZE, measureFlowText, poolRect, type FlowchartData, type FlowEdge, type FlowHead } from "./flowchart";
import { routeFlowchart, type CurveSeg, type EdgeRoute, type Hop, type RouteOptions } from "./flowchartRouting";
import type { FlowSide, Pt, Rect } from "./flowchartShapes";

const r1 = (n: number) => Math.round(n * 10) / 10;

function toward(from: Pt, to: Pt, dist: number): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const d = Math.min(dist, len / 2);
  return { x: from.x + (dx / len) * d, y: from.y + (dy / len) * d };
}

function unit(from: Pt, to: Pt): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** SVG path through the points with rounded corners. */
export function roundedPolyline(pts: readonly Pt[], radius = 10): string {
  return polylinePath(pts, radius, []);
}

/**
 * SVG path through the points with rounded corners and a small semicircular hop at each crossing (hops on
 * segment `i` sit between points[i] and points[i + 1]; crossings too close to a corner get none).
 */
export function polylinePath(pts: readonly Pt[], radius = 10, hops: readonly Hop[] = [], hopRadius = 4.5): string {
  if (!pts.length) return "";
  let d = `M${r1(pts[0]!.x)} ${r1(pts[0]!.y)}`;
  const bySeg = new Map<number, Hop[]>();
  for (const h of hops) bySeg.set(h.segment, [...(bySeg.get(h.segment) ?? []), h]);
  // Where each segment's straight part starts and ends (after and before the rounded corners).
  const cornerR: number[] = pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return 0;
    const prev = pts[i - 1]!;
    const next = pts[i + 1]!;
    return Math.min(radius, Math.hypot(p.x - prev.x, p.y - prev.y) / 2, Math.hypot(next.x - p.x, next.y - p.y) / 2);
  });
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const dir = unit(a, b);
    const start = cornerR[i]!;
    const end = len - cornerR[i + 1]!;
    const list = (bySeg.get(i) ?? [])
      .map((h) => ({ h, t: (h.at.x - a.x) * dir.x + (h.at.y - a.y) * dir.y }))
      .filter((x) => x.t > start + hopRadius + 1 && x.t < end - hopRadius - 1)
      .sort((x, y) => x.t - y.t);
    let last = -Infinity;
    for (const { t } of list) {
      if (t - last < hopRadius * 2 + 2) continue;
      last = t;
      const p0 = { x: a.x + dir.x * (t - hopRadius), y: a.y + dir.y * (t - hopRadius) };
      const p1 = { x: a.x + dir.x * (t + hopRadius), y: a.y + dir.y * (t + hopRadius) };
      // The bump rises above a horizontal line (and to the left of a vertical one) whichever way it runs.
      const sweep = Math.abs(dir.y) < 0.5 ? (dir.x > 0 ? 1 : 0) : dir.y > 0 ? 1 : 0;
      d += `L${r1(p0.x)} ${r1(p0.y)}A${hopRadius} ${hopRadius} 0 0 ${sweep} ${r1(p1.x)} ${r1(p1.y)}`;
    }
    if (i + 1 < pts.length - 1) {
      const next = pts[i + 2]!;
      const rr = cornerR[i + 1]!;
      const q0 = toward(b, a, rr);
      const q1 = toward(b, next, rr);
      d += `L${r1(q0.x)} ${r1(q0.y)}Q${r1(b.x)} ${r1(b.y)} ${r1(q1.x)} ${r1(q1.y)}`;
    } else d += `L${r1(b.x)} ${r1(b.y)}`;
  }
  return d;
}

// ------------------------------------------------------------------------------------------ line ends

export interface HeadShape {
  d: string;
  /** Filled with the line's colour (otherwise only stroked). */
  filled: boolean;
  /** How far the line stops short of the tip so it doesn't show through the head. */
  inset: number;
}

/** A line end of `kind` with its tip at `tip`, pointing along `dir` (a unit vector), for a line `width` wide. */
export function headShape(kind: FlowHead, tip: Pt, dir: Pt, width = FLOWCHART_EDGE_WIDTH): HeadShape | null {
  if (kind === "none") return null;
  const s = Math.max(1, Math.pow(width / FLOWCHART_EDGE_WIDTH, 0.6));
  const perp = { x: -dir.y, y: dir.x };
  const at = (back: number, side: number) => ({ x: tip.x - dir.x * back + perp.x * side, y: tip.y - dir.y * back + perp.y * side });
  const P = (p: Pt) => `${r1(p.x)} ${r1(p.y)}`;
  switch (kind) {
    case "arrow": {
      const len = 9 * s;
      const half = 4.6 * s;
      const notch = at(len * 0.72, 0);
      return { d: `M${P(tip)}L${P(at(len, half))}Q${P(notch)} ${P(at(len, -half))}Z`, filled: true, inset: len - 2 };
    }
    case "open": {
      const len = 9 * s;
      const half = 5 * s;
      return { d: `M${P(at(len, half))}L${P(tip)}L${P(at(len, -half))}`, filled: false, inset: width / 2 };
    }
    case "circle": {
      const r = 4 * s;
      return { d: `M${P(at(2 * r, 0))}A${r1(r)} ${r1(r)} 0 1 0 ${P(tip)}A${r1(r)} ${r1(r)} 0 1 0 ${P(at(2 * r, 0))}Z`, filled: true, inset: 2 * r - 1 };
    }
    case "diamond": {
      const len = 12 * s;
      const half = 4.8 * s;
      return { d: `M${P(tip)}L${P(at(len / 2, half))}L${P(at(len, 0))}L${P(at(len / 2, -half))}Z`, filled: true, inset: len - 1 };
    }
    case "bar": {
      const half = 6 * s;
      return { d: `M${P(at(0, half))}L${P(at(0, -half))}`, filled: false, inset: 0 };
    }
  }
}

// ------------------------------------------------------------------------------------------ along a path

/** Total length of a polyline. */
export function pathLength(pts: readonly Pt[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return total;
}

/** The point a fraction `t` (0…1) of the way along a polyline. */
export function pointAlong(pts: readonly Pt[], t: number): Pt {
  const total = pathLength(pts);
  let left = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg >= left && seg > 0) return { x: a.x + ((b.x - a.x) * left) / seg, y: a.y + ((b.y - a.y) * left) / seg };
    left -= seg;
  }
  return pts[pts.length - 1] ?? { x: 0, y: 0 };
}

/** The fraction (0…1) along a polyline closest to `p`, and how far `p` is from the line (dragging labels). */
export function nearestAlong(pts: readonly Pt[], p: Pt): { t: number; distance: number } {
  const total = pathLength(pts) || 1;
  let best = { t: 0, distance: Infinity };
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    const u = seg ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (seg * seg))) : 0;
    const q = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    const dist = Math.hypot(p.x - q.x, p.y - q.y);
    if (dist < best.distance) best = { t: (walked + u * seg) / total, distance: dist };
    walked += seg;
  }
  return { t: Math.round(best.t * 1000) / 1000, distance: best.distance };
}

// ------------------------------------------------------------------------------------------ routed connectors

export interface LabelBox extends Rect {
  cx: number;
  cy: number;
  text: string;
  /** Index in the connector's labels. */
  index: number;
}

export interface RoutedEdge {
  edge: FlowEdge;
  /** The path as a polyline (curves sampled); for hit tests, label placement and bounds. */
  points: Pt[];
  /** The line to draw (shortened under its line ends, with hops). */
  d: string;
  /** Line end outlines (v1 name: all of them; `markers` says which are filled). */
  heads: string[];
  markers: HeadShape[];
  fromSide: FlowSide | null;
  toSide: FlowSide | null;
  /** The first label's box (v1), null without labels. */
  label: LabelBox | null;
  labels: LabelBox[];
  hops: Hop[];
}

function curvePath(start: Pt, segs: readonly CurveSeg[]): string {
  let d = `M${r1(start.x)} ${r1(start.y)}`;
  for (const s of segs) d += `C${r1(s.c1.x)} ${r1(s.c1.y)} ${r1(s.c2.x)} ${r1(s.c2.y)} ${r1(s.to.x)} ${r1(s.to.y)}`;
  return d;
}

const LABEL_H = 20;

/** Boxes for a connector's labels, each at its place along the path. */
export function edgeLabelBoxes(e: FlowEdge, points: readonly Pt[]): LabelBox[] {
  return e.labels.map((l, index) => {
    const m = pointAlong(points, l.at);
    const w = Math.min(220, measureFlowText(l.text, FLOWCHART_LABEL_FONT_SIZE)) + 12;
    return { x: m.x - w / 2, y: m.y - LABEL_H / 2, w, h: LABEL_H, cx: m.x, cy: m.y, text: l.text, index };
  });
}

/** Line, line ends and label boxes for a connector drawn through `points` (and `curve`, when curved). */
export function routedFromPoints(e: FlowEdge, points: Pt[], fromSide: FlowSide | null, toSide: FlowSide | null, extra: { curve?: CurveSeg[] | null; hops?: Hop[] } = {}): RoutedEdge {
  const markers: HeadShape[] = [];
  const width = e.width ?? FLOWCHART_EDGE_WIDTH;
  const curve = extra.curve ? extra.curve.map((s) => ({ ...s })) : null;
  let start = points[0] ? { ...points[0] } : { x: 0, y: 0 };
  const line = points.map((p) => ({ ...p }));
  if (points.length >= 2) {
    for (const end of ["end", "start"] as const) {
      const kind = end === "end" ? e.end : e.start;
      const tip = end === "end" ? points[points.length - 1]! : points[0]!;
      // Direction into the tip: from the last control point of a curve, or the previous point.
      const from = curve ? (end === "end" ? curve[curve.length - 1]!.c2 : curve[0]!.c1) : end === "end" ? points[points.length - 2]! : points[1]!;
      const dir = unit(Math.hypot(from.x - tip.x, from.y - tip.y) > 0.5 ? from : end === "end" ? points[points.length - 2]! : points[1]!, tip);
      const head = headShape(kind, tip, dir, width);
      if (!head) continue;
      markers.push(head);
      const moved = { x: tip.x - dir.x * head.inset, y: tip.y - dir.y * head.inset };
      if (end === "end") {
        line[line.length - 1] = moved;
        if (curve) {
          const last = curve[curve.length - 1]!;
          last.c2 = { x: last.c2.x - dir.x * head.inset, y: last.c2.y - dir.y * head.inset };
          last.to = moved;
        }
      } else {
        line[0] = moved;
        start = moved;
        if (curve) curve[0]!.c1 = { x: curve[0]!.c1.x - dir.x * head.inset, y: curve[0]!.c1.y - dir.y * head.inset };
      }
    }
  }
  const hops = extra.hops ?? [];
  const d = curve ? curvePath(start, curve) : e.route === "straight" ? polylinePath(line, 0, hops) : polylinePath(line, 10, hops);
  const labels = edgeLabelBoxes(e, points);
  return { edge: e, points, d, heads: markers.map((m) => m.d), markers, fromSide, toSide, label: labels[0] ?? null, labels, hops };
}

/** The drawing of a routed connector. */
export function routedEdge(r: EdgeRoute): RoutedEdge {
  return routedFromPoints(r.edge, r.points, r.fromSide, r.toSide, { curve: r.curve, hops: r.hops });
}

/** Routes and draws every connector of the chart (connectors whose shapes are missing are skipped). */
export function routeEdges(fc: FlowchartData, opts: RouteOptions = {}): RoutedEdge[] {
  return routeFlowchart(fc, opts).routes.map(routedEdge);
}

// ------------------------------------------------------------------------------------------ bounds

/** Bounding box of every shape, frame, pool, connector and label (null for an empty chart). */
export function flowchartBounds(fc: FlowchartData, routed: readonly RoutedEdge[] = routeEdges(fc)): Rect | null {
  const frames = fc.frames ?? [];
  const pools = fc.pools ?? [];
  if (!fc.nodes.length && !frames.length && !pools.length && !routed.length) return null;
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
  const addRect = (r: Rect) => {
    add(r.x, r.y);
    add(r.x + r.w, r.y + r.h);
  };
  fc.nodes.forEach(addRect);
  frames.forEach(addRect);
  pools.forEach((p) => addRect(poolRect(p)));
  for (const r of routed) {
    for (const p of r.points) add(p.x, p.y);
    for (const l of r.labels) addRect(l);
  }
  if (!Number.isFinite(x0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
