// Pure connector edits for the canvas (tested in test/flowchart-connectors.test.ts): where a dragged end
// snaps (a side, a point on the outline, the shape as a whole, or a free spot), reconnecting and detaching
// ends, bend points, labels along the line, styling several connectors at once, and keeping the drawing of
// unchanged connectors identical between frames so the connector layer only redraws what moved.
//
//   Snapping a dragged end, in screen distances (divided by the zoom):
//     on a connection point (a side's middle)      that side; connectors on one side spread evenly
//     on the outline elsewhere                     that exact spot on that side
//     inside the shape                             the shape as a whole: the router picks the side
//     anywhere else                                a free end at that point
import {
  FLOWCHART_COLOR_LABEL,
  FLOWCHART_GRID,
  FLOWCHART_HEAD_LABEL,
  FLOWCHART_LIMITS,
  FLOWCHART_SHAPE_LABEL,
  nearestAlong,
  newEdge,
  outlinePoint,
  pointAlong,
  routeFlowchart,
  sidePosition,
  type FlowchartData,
  type FlowEdge,
  type FlowHead,
  type FlowLineStyle,
  type FlowNode,
  type FlowRoute,
  type FlowSide,
  type Pt,
  type RoutedEdge,
} from "./schema";

export const SIDES: readonly FlowSide[] = ["top", "right", "bottom", "left"];
export type End = "from" | "to";

/** Where a dragged connector end would attach. */
export type EndTarget =
  | {
      kind: "node";
      node: string;
      /** No side: the router picks one (and keeps picking as shapes move). */
      side?: FlowSide;
      /** An exact spot along the side (0…1); without one, connectors on that side spread evenly. */
      at?: number;
      /** Where the end will meet the shape (for the indicator). */
      point: Pt;
    }
  | { kind: "free"; point: Pt };

export interface SnapOptions {
  /** A node the end may not attach to (the connector's other end: no loops onto one shape). */
  exclude?: string;
  /** Larger targets for fingers. */
  coarse?: boolean;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const L = FLOWCHART_LIMITS;
const clampCoord = (n: number) => Math.max(-L.maxCoord, Math.min(L.maxCoord, Math.round(n)));

/** A side's connection point (its middle on the outline). */
export function connectionPoint(n: FlowNode, side: FlowSide): Pt {
  return outlinePoint(n, side, 0.5);
}

/** The top-most node whose box (grown by `pad`) holds `p`, skipping `exclude`. */
export function nodeUnder(fc: FlowchartData, p: Pt, pad: number, exclude?: string): FlowNode | null {
  for (let i = fc.nodes.length - 1; i >= 0; i--) {
    const n = fc.nodes[i]!;
    if (n.id === exclude) continue;
    if (p.x >= n.x - pad && p.x <= n.x + n.w + pad && p.y >= n.y - pad && p.y <= n.y + n.h + pad) return n;
  }
  return null;
}

/** Where an end dragged to `p` (world) would attach, at zoom `k`. */
export function snapEnd(fc: FlowchartData, p: Pt, k: number, opts: SnapOptions = {}): EndTarget {
  const scale = (opts.coarse ? 1.8 : 1) / Math.max(0.05, k);
  const n = nodeUnder(fc, p, 12 * scale, opts.exclude);
  if (!n) return { kind: "free", point: { x: Math.round(p.x), y: Math.round(p.y) } };
  // A connection point.
  let best: { side: FlowSide; d: number; point: Pt } | null = null;
  for (const side of SIDES) {
    const c = connectionPoint(n, side);
    const d = dist(c, p);
    if (d <= 14 * scale && (!best || d < best.d)) best = { side, d, point: c };
  }
  if (best) return { kind: "node", node: n.id, side: best.side, point: best.point };
  // The outline: the nearest spot on any side.
  let edge: { side: FlowSide; d: number; point: Pt; at: number } | null = null;
  for (const side of SIDES) {
    const at = sidePosition(n, side, p);
    const q = outlinePoint(n, side, at);
    const d = dist(q, p);
    if (!edge || d < edge.d) edge = { side, d, point: q, at };
  }
  if (edge && edge.d <= 8 * scale) {
    // Quarter points pull the spot to them, so ends line up easily.
    const at = [0.25, 0.75].find((q) => Math.abs(q - edge.at) < 0.04) ?? edge.at;
    return { kind: "node", node: n.id, side: edge.side, at: round3(at), point: at === edge.at ? edge.point : outlinePoint(n, edge.side, at) };
  }
  return { kind: "node", node: n.id, point: { x: n.x + n.w / 2, y: n.y + n.h / 2 } };
}

/** The node an end is attached to ("" when it floats free). */
export const endNode = (e: FlowEdge, end: End) => (end === "from" ? e.from : e.to);
const other = (end: End): End => (end === "from" ? "to" : "from");

/**
 * The connector with one end moved to `t`: attached to a node (with its side and spot, or neither), or
 * floating free at a point. Null when that would join a shape to itself.
 */
export function setEnd(e: FlowEdge, end: End, t: EndTarget): FlowEdge | null {
  const next: FlowEdge = { ...e };
  const [nodeKey, sideKey, atKey, pointKey] = end === "from" ? (["from", "fromSide", "fromAt", "fromPoint"] as const) : (["to", "toSide", "toAt", "toPoint"] as const);
  delete next[sideKey];
  delete next[atKey];
  delete next[pointKey];
  if (t.kind === "node") {
    if (t.node === endNode(e, other(end))) return null;
    next[nodeKey] = t.node;
    if (t.side) next[sideKey] = t.side;
    if (t.side && t.at !== undefined) next[atKey] = round3(Math.max(0, Math.min(1, t.at)));
  } else {
    next[nodeKey] = "";
    next[pointKey] = { x: clampCoord(t.point.x), y: clampCoord(t.point.y) };
  }
  return next;
}

/** A new connector from a side of `from` to wherever `to` points (null at the connector limit or a loop). */
export function newConnector(fc: FlowchartData, from: string, side: FlowSide, to: EndTarget): { doc: FlowchartData; id: string } | null {
  if (fc.edges.length >= L.maxEdges) return null;
  const base = newEdge(from, "", { fromSide: side });
  const edge = setEnd(base, "to", to);
  if (!edge) return null;
  // The very same connection already exists: keep that one.
  const dup = fc.edges.find((x) => x.from === edge.from && x.to === edge.to && edge.to && x.fromSide === edge.fromSide && x.toSide === edge.toSide && x.fromAt === edge.fromAt && x.toAt === edge.toAt && !x.bends.length);
  if (dup) return { doc: fc, id: dup.id };
  return { doc: { ...fc, edges: [...fc.edges, edge] }, id: edge.id };
}

export function patchEdges(fc: FlowchartData, ids: readonly string[], patch: (e: FlowEdge) => FlowEdge): FlowchartData {
  const set = new Set(ids);
  let changed = false;
  const edges = fc.edges.map((e) => {
    if (!set.has(e.id)) return e;
    const n = patch(e);
    if (n !== e) changed = true;
    return n;
  });
  return changed ? { ...fc, edges } : fc;
}

// ------------------------------------------------------------------------------------------ bend points

/** Where the route passes each stop: start (0), each bend, end (1), as fractions along the path. */
export function stopPositions(e: FlowEdge, points: readonly Pt[]): number[] {
  const ts = [0, ...e.bends.map((b) => nearestAlong(points, b).t), 1];
  // Keep them in order even where the route passes a bend loosely.
  for (let i = 1; i < ts.length; i++) ts[i] = Math.max(ts[i]!, ts[i - 1]!);
  return ts;
}

/** Where a new bend dragged out at `p` goes in the connector's list (bends are visited in order). */
export function bendInsertIndex(e: FlowEdge, points: readonly Pt[], p: Pt): number {
  const t = nearestAlong(points, p).t;
  const stops = stopPositions(e, points);
  let i = 0;
  while (i < e.bends.length && stops[i + 1]! <= t) i++;
  return i;
}

/** The "drag to add a bend" handles: the middle of each stretch between stops, with its insert index. */
export function bendAddHandles(e: FlowEdge, points: readonly Pt[]): { index: number; at: Pt }[] {
  if (points.length < 2 || e.bends.length >= L.maxBends) return [];
  const stops = stopPositions(e, points);
  const out: { index: number; at: Pt }[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    if (stops[i + 1]! - stops[i]! < 0.04) continue;
    out.push({ index: i, at: pointAlong(points, (stops[i]! + stops[i + 1]!) / 2) });
  }
  return out;
}

const pt = (p: Pt): Pt => ({ x: clampCoord(p.x), y: clampCoord(p.y) });

export function insertBend(e: FlowEdge, index: number, p: Pt): FlowEdge {
  if (e.bends.length >= L.maxBends) return e;
  const bends = [...e.bends];
  bends.splice(Math.max(0, Math.min(bends.length, index)), 0, pt(p));
  return { ...e, bends };
}

export function moveBend(e: FlowEdge, index: number, p: Pt): FlowEdge {
  if (!e.bends[index]) return e;
  return { ...e, bends: e.bends.map((b, i) => (i === index ? pt(p) : b)) };
}

export function removeBend(e: FlowEdge, index: number): FlowEdge {
  if (!e.bends[index]) return e;
  return { ...e, bends: e.bends.filter((_, i) => i !== index) };
}

/**
 * A dragged bend: lined up with the stop before or after it when within `threshold` (so a leg runs straight),
 * otherwise on the grid. `free` turns snapping off (⌥).
 */
export function snapBend(p: Pt, neighbours: readonly Pt[], threshold: number, free = false): Pt {
  if (free) return { x: Math.round(p.x), y: Math.round(p.y) };
  const axis = (key: "x" | "y") => {
    let best: number | null = null;
    for (const q of neighbours) if (Math.abs(q[key] - p[key]) <= threshold && (best === null || Math.abs(q[key] - p[key]) < Math.abs(best - p[key]))) best = q[key];
    return best ?? Math.round(p[key] / FLOWCHART_GRID) * FLOWCHART_GRID;
  };
  return { x: Math.round(axis("x")), y: Math.round(axis("y")) };
}

/** The stops on either side of bend `index` (an end's point, or the neighbouring bends). */
export function bendNeighbours(e: FlowEdge, points: readonly Pt[], index: number): Pt[] {
  const first = points[0];
  const last = points[points.length - 1];
  const before = index > 0 ? e.bends[index - 1] : first;
  const after = index < e.bends.length - 1 ? e.bends[index + 1] : last;
  return [before, after].filter((p): p is Pt => !!p);
}

// ------------------------------------------------------------------------------------------ labels

// One line of text: new lines and control characters become spaces.
const cleanLabel = (s: string) => s.replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, L.maxLabel);

/** Labels snap to the middle of the line when dragged close to it. */
export function snapLabelAt(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return Math.abs(c - 0.5) < 0.03 ? 0.5 : round3(c);
}

/** A new empty label at `at` (null when the connector has as many labels as it can hold). */
export function addLabel(e: FlowEdge, at: number): { edge: FlowEdge; index: number } | null {
  if (e.labels.length >= L.maxLabels) return null;
  return { edge: { ...e, labels: [...e.labels, { text: "", at: snapLabelAt(at) }] }, index: e.labels.length };
}

/** Sets label `index`'s text (the first label of a connector without any is added halfway along). */
export function setLabelText(e: FlowEdge, index: number, text: string): FlowEdge {
  const clean = cleanLabel(text);
  if (index >= e.labels.length) {
    if (!clean || e.labels.length >= L.maxLabels) return e;
    return { ...e, labels: [...e.labels, { text: clean, at: 0.5 }] };
  }
  return { ...e, labels: e.labels.map((l, i) => (i === index ? { ...l, text: clean } : l)) };
}

export function moveLabel(e: FlowEdge, index: number, at: number): FlowEdge {
  const l = e.labels[index];
  if (!l) return e;
  const next = snapLabelAt(at);
  if (next === l.at) return e;
  return { ...e, labels: e.labels.map((x, i) => (i === index ? { ...x, at: next } : x)) };
}

export function removeLabel(e: FlowEdge, index: number): FlowEdge {
  if (!e.labels[index]) return e;
  return { ...e, labels: e.labels.filter((_, i) => i !== index) };
}

/** Labels left empty (or only spaces) after writing are removed; text is trimmed. */
export function tidyLabels(e: FlowEdge): FlowEdge {
  if (e.labels.every((l) => l.text && l.text === l.text.trim())) return e;
  return { ...e, labels: e.labels.map((l) => ({ ...l, text: l.text.trim() })).filter((l) => l.text) };
}

/**
 * The chart after writing on connector `id`: its empty labels removed. When nothing really changed from
 * `before` it returns `before` itself, so finishing an edit that added nothing records no undo step.
 */
export function finishLabelEdit(fc: FlowchartData, before: FlowchartData, id: string): FlowchartData {
  const next = patchEdges(fc, [id], tidyLabels);
  const a = next.edges.find((e) => e.id === id);
  const b = before.edges.find((e) => e.id === id);
  if (next.nodes === before.nodes && a && b && JSON.stringify(a) === JSON.stringify(b) && next.edges.length === before.edges.length) return before;
  return next;
}

// ------------------------------------------------------------------------------------------ styling

export type EdgeStyle = { route: FlowRoute; start: FlowHead; end: FlowHead; style: FlowLineStyle; width: number; color: string };
export type EdgeStylePatch = Partial<EdgeStyle>;

/** Thicknesses offered in the connector bar. */
export const EDGE_WIDTHS: { value: number; label: string }[] = [
  { value: 1, label: "Thin" },
  { value: 1.5, label: "Regular" },
  { value: 2.5, label: "Medium" },
  { value: 4, label: "Thick" },
  { value: 6, label: "Heavy" },
];

/** Applies a style to every listed connector (colour "neutral" is the default grey, stored as none). */
export function styleEdges(fc: FlowchartData, ids: readonly string[], patch: EdgeStylePatch): FlowchartData {
  return patchEdges(fc, ids, (e) => {
    const next: FlowEdge = { ...e };
    if (patch.route) next.route = patch.route;
    if (patch.start) next.start = patch.start;
    if (patch.end) next.end = patch.end;
    if (patch.style) next.style = patch.style;
    if (patch.width !== undefined) next.width = Math.max(L.minEdgeWidth, Math.min(L.maxEdgeWidth, patch.width));
    if (patch.color !== undefined) {
      if (patch.color === "neutral" || !patch.color) delete next.color;
      else next.color = patch.color;
    }
    return JSON.stringify(next) === JSON.stringify(e) ? e : next;
  });
}

/** The value every connector shares, or null when they differ. */
export function shared<T>(edges: readonly FlowEdge[], get: (e: FlowEdge) => T): T | null {
  if (!edges.length) return null;
  const first = get(edges[0]!);
  return edges.every((e) => get(e) === first) ? first : null;
}

/**
 * Turns connectors around: the ends swap (shapes, sides, spots, free points), and so do the bends (in
 * reverse order) and the labels (each keeps its place on the line). The line ends stay as they are, at the
 * start and the end, so the arrow now points the other way.
 */
export function reverseEdges(fc: FlowchartData, ids: readonly string[]): FlowchartData {
  return patchEdges(fc, ids, (e) => {
    const next: FlowEdge = { ...e, from: e.to, to: e.from, bends: [...e.bends].reverse(), labels: e.labels.map((l) => ({ ...l, at: round3(1 - l.at) })) };
    for (const [a, b] of [["fromSide", "toSide"], ["fromAt", "toAt"], ["fromPoint", "toPoint"]] as const) {
      const va = e[a];
      const vb = e[b];
      delete next[a];
      delete next[b];
      if (vb !== undefined) (next as unknown as Record<string, unknown>)[a] = vb;
      if (va !== undefined) (next as unknown as Record<string, unknown>)[b] = va;
    }
    return next;
  });
}

export function clearBends(fc: FlowchartData, ids: readonly string[]): FlowchartData {
  return patchEdges(fc, ids, (e) => (e.bends.length ? { ...e, bends: [] } : e));
}

/**
 * The chart without the bend points its routes leave out (the router's `dropped`: repeats, points on a
 * straight run, and bends left behind where shapes used to be, whose route would double back). Every
 * finished edit goes through this, so what is stored is what is drawn. The same chart when none are.
 */
export function dropIdleBends(fc: FlowchartData): FlowchartData {
  if (!fc.edges.some((e) => e.bends.length)) return fc;
  const dropped = new Map<string, Set<number>>();
  for (const r of routeFlowchart(fc, { hops: false }).routes) if (r.dropped.length) dropped.set(r.edge.id, new Set(r.dropped));
  if (!dropped.size) return fc;
  return patchEdges(fc, [...dropped.keys()], (e) => ({ ...e, bends: e.bends.filter((_, i) => !dropped.get(e.id)!.has(i)) }));
}

/**
 * Moving shapes by (dx, dy): connectors whose attached ends all move with them carry their bend points and
 * free ends along, so their shape stays as drawn (`moving` is the set of moved shapes; `fc` the chart
 * before the move).
 */
export function carryEdges(fc: FlowchartData, moving: ReadonlySet<string>, dx: number, dy: number): FlowEdge[] {
  if (!dx && !dy) return fc.edges;
  return fc.edges.map((e) => {
    const attached = [e.from, e.to].filter(Boolean);
    if (!attached.length || !attached.every((id) => moving.has(id))) return e;
    if (!e.bends.length && !e.fromPoint && !e.toPoint) return e;
    const shift = (p: Pt) => ({ x: clampCoord(p.x + dx), y: clampCoord(p.y + dy) });
    const next: FlowEdge = { ...e, bends: e.bends.map(shift) };
    if (e.fromPoint) next.fromPoint = shift(e.fromPoint);
    if (e.toPoint) next.toPoint = shift(e.toPoint);
    return next;
  });
}

// ------------------------------------------------------------------------------------------ drawing

/** The stroke for a connector colour: a palette name (CSS variable) or "#rrggbb". */
export function edgeStroke(color: string | undefined): string | undefined {
  if (!color || color === "neutral") return undefined;
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  return `var(--fc-${color})`;
}

/** Dash pattern for a line style at a width (dots rely on round caps). */
export function edgeDash(style: FlowLineStyle, width: number): string | undefined {
  if (style === "dashed") return `${Math.round(4 * width * 10) / 10 + 1} ${Math.round(3.4 * width * 10) / 10 + 1}`;
  if (style === "dotted") return `0.1 ${Math.round((2.6 * width + 1.5) * 10) / 10}`;
  return undefined;
}

const sameLabels = (a: RoutedEdge, b: RoutedEdge) => a.labels.length === b.labels.length && a.labels.every((l, i) => {
  const m = b.labels[i]!;
  return l.text === m.text && l.cx === m.cx && l.cy === m.cy && l.w === m.w;
});

/** Whether two drawings of a connector look the same (same data, path, heads and labels). */
export function sameDrawing(a: RoutedEdge, b: RoutedEdge): boolean {
  return a.edge === b.edge && a.d === b.d && a.fromSide === b.fromSide && a.toSide === b.toSide && a.heads.length === b.heads.length && a.heads.every((h, i) => h === b.heads[i]) && sameLabels(a, b) && a.dropped.join() === b.dropped.join();
}

/**
 * This frame's connectors, reusing last frame's object for every connector that looks the same: memoised
 * connector items then skip drawing them again, so a drag only redraws the connectors that moved.
 */
export function stableRouted(prev: ReadonlyMap<string, RoutedEdge>, next: readonly RoutedEdge[]): RoutedEdge[] {
  return next.map((r) => {
    const old = prev.get(r.edge.id);
    return old && sameDrawing(old, r) ? old : r;
  });
}

// ------------------------------------------------------------------------------------------ keyboard

/** A shape as a connector's name gives it: its text, or its kind when it has none. */
function shapeName(n: FlowNode | undefined): string {
  if (!n) return "a missing shape";
  return n.text.trim().replace(/\s+/g, " ") || `an empty ${FLOWCHART_SHAPE_LABEL[n.shape].toLowerCase()}`;
}

/** What a screen reader says for a connector: "Connector from Start to Check, Yes". */
export function connectorName(e: FlowEdge, byId: ReadonlyMap<string, FlowNode>): string {
  const from = e.from ? shapeName(byId.get(e.from)) : "a point";
  const to = e.to ? shapeName(byId.get(e.to)) : "a point";
  const labels = e.labels.map((l) => l.text.trim()).filter(Boolean);
  return `Connector from ${from} to ${to}${labels.length ? `, ${labels.join(", ")}` : ""}`;
}

/** The connectors at shape `id`, in the order ] steps through them: the ones leaving it, then the ones arriving. */
export function connectorsOf(fc: FlowchartData, id: string): string[] {
  const out = fc.edges.filter((e) => e.from === id).map((e) => e.id);
  for (const e of fc.edges) if (e.to === id && e.from !== id) out.push(e.id);
  return out;
}

/** The next (`step` 1) or previous (-1) connector in `list` after `current` (the first or last without one), wrapping. */
export function stepConnector(list: readonly string[], current: string | null, step: 1 | -1): string | null {
  if (!list.length) return null;
  const i = current ? list.indexOf(current) : -1;
  if (i < 0) return step === 1 ? list[0]! : list[list.length - 1]!;
  return list[(i + step + list.length) % list.length]!;
}

/** What changed, said after a choice in the connector bar ("Route: curved, 2 connectors."). */
export function describeEdgeStyle(patch: EdgeStylePatch, count: number): string {
  const parts: string[] = [];
  if (patch.route) parts.push(`route ${patch.route}`);
  if (patch.start) parts.push(`start ${FLOWCHART_HEAD_LABEL[patch.start].toLowerCase()}`);
  if (patch.end) parts.push(`end ${FLOWCHART_HEAD_LABEL[patch.end].toLowerCase()}`);
  if (patch.style) parts.push(`${patch.style} line`);
  if (patch.width !== undefined) parts.push(`${(EDGE_WIDTHS.find((w) => w.value === patch.width)?.label ?? `${patch.width} point`).toLowerCase()} line`);
  if (patch.color !== undefined) parts.push(`colour ${patch.color === "neutral" || !patch.color ? "grey" : (FLOWCHART_COLOR_LABEL[patch.color as keyof typeof FLOWCHART_COLOR_LABEL] ?? "custom").toLowerCase()}`);
  const what = parts.join(", ") || "unchanged";
  return `${what.charAt(0).toUpperCase()}${what.slice(1)}${count > 1 ? `, ${count} connectors` : ""}.`;
}
