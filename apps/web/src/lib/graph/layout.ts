// The graph view's layout (components/views/GraphView.tsx): a small force-directed simulation written here
// (no chart library), plus the view's pan and zoom maths, search matching and the list fallback. Pure
// functions and one small class, so they're tested directly.

export interface Point {
  x: number;
  y: number;
}

export interface LayoutNode extends Point {
  id: string;
  vx: number;
  vy: number;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

/** Pan and zoom: a world point p shows at (p.x * k + x, p.y * k + y). */
export interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 4;

/** A stable number from a string (FNV-1a), for positions that don't jump between renders. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Where a node starts: on a sunflower spiral by its place in the list, nudged by its id. Always the same. */
export function seedPosition(id: string, index: number): Point {
  const angle = index * 2.399963 + (hash(id) % 360) * 0.0005;
  const r = 18 * Math.sqrt(index + 1);
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
}

/** The most steps one layout takes, however large the graph: the work is bounded (see GraphView's frames). */
export const LAYOUT_MAX_TICKS = 300;

export interface SimulationOptions {
  /** Positions from an earlier layout, kept so a refreshed graph doesn't reshuffle. */
  previous?: ReadonlyMap<string, Point>;
  /** Stop after this many steps even if it hasn't cooled (default LAYOUT_MAX_TICKS). */
  maxTicks?: number;
  /** How far apart linked nodes settle. */
  linkDistance?: number;
  /** How strongly nodes push each other apart. */
  repulsion?: number;
}

/**
 * A force-directed layout: nodes repel each other, edges pull their ends together, and a light pull keeps
 * everything near the middle. Each `tick` moves the nodes a little and cools the simulation (`alpha`);
 * it's settled once alpha is below `MIN_ALPHA`. Deterministic: the same graph lays out the same way.
 */
export class Simulation {
  static readonly MIN_ALPHA = 0.005;
  readonly nodes: LayoutNode[];
  private readonly index = new Map<string, number>();
  private readonly links: [number, number][] = [];
  alpha: number;
  /** Steps taken so far. */
  ticks = 0;
  private readonly maxTicks: number;
  private readonly linkDistance: number;
  private readonly repulsion: number;

  constructor(ids: readonly string[], edges: readonly LayoutEdge[], opts: SimulationOptions = {}) {
    this.maxTicks = opts.maxTicks ?? LAYOUT_MAX_TICKS;
    this.linkDistance = opts.linkDistance ?? 70;
    this.repulsion = opts.repulsion ?? 900;
    let kept = 0;
    this.nodes = ids.map((id, i) => {
      this.index.set(id, i);
      const before = opts.previous?.get(id);
      if (before) kept++;
      const p = before ?? seedPosition(id, i);
      return { id, x: p.x, y: p.y, vx: 0, vy: 0 };
    });
    for (const e of edges) {
      const a = this.index.get(e.source);
      const b = this.index.get(e.target);
      if (a !== undefined && b !== undefined && a !== b) this.links.push([a, b]);
    }
    // Mostly laid out already: a gentle settle instead of a full one.
    this.alpha = ids.length && kept / ids.length > 0.8 ? 0.3 : 1;
  }

  get settled(): boolean {
    return this.alpha < Simulation.MIN_ALPHA || this.ticks >= this.maxTicks;
  }

  /** One step. Returns false once settled. */
  tick(): boolean {
    if (this.settled) return false;
    const n = this.nodes;
    const a = this.alpha;
    // Repulsion between every pair (fine for the few hundred nodes the view gets).
    for (let i = 0; i < n.length; i++) {
      const p = n[i]!;
      for (let j = i + 1; j < n.length; j++) {
        const q = n[j]!;
        let dx = p.x - q.x;
        let dy = p.y - q.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          // On top of each other: pushed apart in a direction fixed by their places.
          dx = ((i * 7 + j * 13) % 11) - 5 || 1;
          dy = ((i * 11 + j * 3) % 7) - 3 || 1;
          d2 = dx * dx + dy * dy;
        }
        if (d2 > 250_000) continue;
        const f = (this.repulsion * a) / d2;
        p.vx += dx * f;
        p.vy += dy * f;
        q.vx -= dx * f;
        q.vy -= dy * f;
      }
    }
    // Springs along edges.
    for (const [i, j] of this.links) {
      const p = n[i]!;
      const q = n[j]!;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - this.linkDistance) / d) * 0.08 * a;
      p.vx += dx * f;
      p.vy += dy * f;
      q.vx -= dx * f;
      q.vy -= dy * f;
    }
    // A light pull to the middle, then move (with friction, and a speed limit so nothing flies off).
    for (const p of n) {
      p.vx -= p.x * 0.01 * a;
      p.vy -= p.y * 0.01 * a;
      p.vx *= 0.6;
      p.vy *= 0.6;
      const speed = Math.hypot(p.vx, p.vy);
      if (speed > 40) {
        p.vx = (p.vx / speed) * 40;
        p.vy = (p.vy / speed) * 40;
      }
      p.x += p.vx;
      p.y += p.vy;
    }
    this.alpha *= 0.97;
    this.ticks++;
    return !this.settled;
  }

  /** Runs until settled (or `maxTicks`), e.g. when motion is reduced. */
  run(maxTicks = 400): void {
    for (let i = 0; i < maxTicks && this.tick(); i++);
  }

  positions(): Map<string, Point> {
    return new Map(this.nodes.map((p) => [p.id, { x: p.x, y: p.y }]));
  }
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: Iterable<Point>): Bounds | null {
  let b: Bounds | null = null;
  for (const p of points) {
    if (!b) b = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    else {
      b.minX = Math.min(b.minX, p.x);
      b.minY = Math.min(b.minY, p.y);
      b.maxX = Math.max(b.maxX, p.x);
      b.maxY = Math.max(b.maxY, p.y);
    }
  }
  return b;
}

export const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** The transform that shows all of `b` inside a width × height view, with `padding` around it. */
export function fitTransform(b: Bounds | null, width: number, height: number, padding = 40): ViewTransform {
  if (!b || width <= 0 || height <= 0) return { x: width / 2, y: height / 2, k: 1 };
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const k = clampZoom(Math.min((width - padding * 2) / w, (height - padding * 2) / h, 1.6));
  return { k, x: width / 2 - ((b.minX + b.maxX) / 2) * k, y: height / 2 - ((b.minY + b.maxY) / 2) * k };
}

/** Zooms by `factor` keeping the screen point (px, py) where it is. */
export function zoomAround(t: ViewTransform, factor: number, px: number, py: number): ViewTransform {
  const k = clampZoom(t.k * factor);
  const f = k / t.k;
  return { k, x: px - (px - t.x) * f, y: py - (py - t.y) * f };
}

export const toScreen = (t: ViewTransform, p: Point): Point => ({ x: p.x * t.k + t.x, y: p.y * t.k + t.y });

/** Each node's number of edges. */
export function degrees(edges: readonly LayoutEdge[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of edges) {
    out.set(e.source, (out.get(e.source) ?? 0) + 1);
    out.set(e.target, (out.get(e.target) ?? 0) + 1);
  }
  return out;
}

/** A node's radius (world units): bigger with more connections, within limits, entities a little larger. */
export const radiusFor = (degree: number, entity: boolean) => Math.min(entity ? 20 : 18, (entity ? 7 : 6) + Math.sqrt(degree) * 2.4);

/** However far you zoom out, a node is drawn at least this many pixels across its radius. */
export const MIN_DRAWN_PX = 4.5;
/** And can be hit within this many pixels of its centre (a 24 px target, WCAG 2.5.8). */
export const MIN_HIT_PX = 12;

/** The radius to draw at zoom `k` (world units), so a node never shrinks to a speck. */
export const drawnRadius = (r: number, k: number) => Math.max(r, MIN_DRAWN_PX / k);
/** The radius that takes clicks and taps at zoom `k` (world units). */
export const hitRadius = (r: number, k: number) => Math.max(r, MIN_HIT_PX / k);

/** The `count` best-connected nodes (ties by id, so it's stable): they're always labelled. */
export function topConnected(deg: ReadonlyMap<string, number>, count: number): Set<string> {
  return new Set(
    [...deg.entries()]
      .filter(([, d]) => d > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, count)
      .map(([id]) => id),
  );
}

/**
 * Each kind's shape, so entities differ from notes (and from each other) by shape as well as colour: notes
 * are circles, people diamonds, projects squares, organizations hexagons, topics triangles, decisions
 * pentagons.
 */
export const KIND_SHAPE: Record<string, "circle" | "diamond" | "square" | "hexagon" | "triangle" | "pentagon"> = {
  note: "circle",
  person: "diamond",
  project: "square",
  organization: "hexagon",
  topic: "triangle",
  decision: "pentagon",
};

const polygon = (sides: number, r: number, rotate: number) =>
  `${Array.from({ length: sides }, (_, i) => {
    const a = rotate + (i * 2 * Math.PI) / sides;
    return `${i ? "L" : "M"}${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
  }).join(" ")} Z`;

/** The SVG path of a kind's shape around (0, 0) with radius `r`, or null for a circle. */
export function shapePath(kind: string, r: number): string | null {
  switch (KIND_SHAPE[kind] ?? "circle") {
    case "diamond":
      return polygon(4, r * 1.2, -Math.PI / 2);
    case "square":
      return polygon(4, r * 1.15, Math.PI / 4);
    case "hexagon":
      return polygon(6, r * 1.1, 0);
    case "triangle":
      return polygon(3, r * 1.3, -Math.PI / 2);
    case "pentagon":
      return polygon(5, r * 1.15, -Math.PI / 2);
    default:
      return null;
  }
}

export type Direction = "left" | "right" | "up" | "down";

/**
 * The node to move to from `from` with an arrow key: the nearest one in that direction (within 60° of it),
 * preferring nodes straight ahead over ones off to the side. Null when there's none that way.
 */
export function nextInDirection(positions: ReadonlyMap<string, Point>, from: string, dir: Direction): string | null {
  const p = positions.get(from);
  if (!p) return null;
  const [ax, ay] = dir === "left" ? [-1, 0] : dir === "right" ? [1, 0] : dir === "up" ? [0, -1] : [0, 1];
  let best: string | null = null;
  let bestScore = Infinity;
  for (const [id, q] of positions) {
    if (id === from) continue;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const ahead = dx * ax + dy * ay;
    const side = Math.abs(dx * ay - dy * ax);
    if (ahead <= 0 || side > ahead * 1.732) continue;
    const score = ahead + side * 2;
    if (score < bestScore || (score === bestScore && best !== null && id < best)) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

/** The nodes joined to `id` by an edge. */
export function neighbours(edges: readonly LayoutEdge[], id: string): Set<string> {
  const out = new Set<string>();
  for (const e of edges) {
    if (e.source === id) out.add(e.target);
    else if (e.target === id) out.add(e.source);
  }
  return out;
}

/** Text for matching: lowercased, accents dropped, spaces collapsed. */
export const foldText = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** The ids of nodes whose label contains every word of `query` (empty query: none). */
export function matchNodes(nodes: readonly { id: string; label: string }[], query: string): Set<string> {
  const words = foldText(query).split(" ").filter(Boolean);
  if (!words.length) return new Set();
  return new Set(nodes.filter((n) => words.every((w) => foldText(n.label).includes(w))).map((n) => n.id));
}

export interface GraphNodeData {
  id: string;
  kind: string;
  label: string;
}

export interface GraphEdgeData extends LayoutEdge {
  kind: string;
  inferred: boolean;
}

export interface ListEntry {
  id: string;
  kind: string;
  label: string;
  /** What it's connected to, notes first, each once. */
  connections: { id: string; kind: string; label: string; edge: string }[];
}

/**
 * The graph as a list (for screen readers, keyboards and small screens): notes first, then entities,
 * each alphabetically with what it's connected to. Only nodes matching `query` when one is given.
 */
export function graphList(nodes: readonly GraphNodeData[], edges: readonly GraphEdgeData[], query = ""): ListEntry[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const conns = new Map<string, Map<string, ListEntry["connections"][number]>>();
  const add = (from: string, to: string, edge: string) => {
    const other = byId.get(to);
    if (!other || !byId.has(from)) return;
    const m = conns.get(from) ?? new Map();
    if (!m.has(to)) m.set(to, { id: to, kind: other.kind, label: other.label, edge });
    conns.set(from, m);
  };
  for (const e of edges) {
    add(e.source, e.target, e.kind);
    add(e.target, e.source, e.kind);
  }
  const matches = query.trim() ? matchNodes(nodes, query) : null;
  const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
  return [...nodes]
    .filter((n) => !matches || matches.has(n.id))
    .sort((a, b) => Number(a.kind !== "note") - Number(b.kind !== "note") || byLabel(a, b))
    .map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      connections: [...(conns.get(n.id)?.values() ?? [])].sort((a, b) => Number(a.kind !== "note") - Number(b.kind !== "note") || byLabel(a, b)),
    }));
}
