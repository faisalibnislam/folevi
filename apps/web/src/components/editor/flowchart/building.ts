// Building a flow faster, as pure edits (tested on their own, test/flowchart-building.test.ts): the next
// connected shape from a side (the + arrows, Tab), a sibling branch (Shift+Tab), a shape created where a
// connector was dropped (the shape picker), and the neighbour an arrow key moves the selection to.
import {
  FLOWCHART_LIMITS,
  FLOWCHART_SHAPE_SIZE,
  OPPOSITE,
  flowId,
  flowchartDirection,
  newEdge,
  quickAddPosition,
  quickAddSibling,
  FLOWCHART_FRAME_TITLE,
  FLOWCHART_POOL_TITLE,
  laneBoxes,
  poolRect,
  portPoint,
  type FlowchartData,
  type Rect,
  type FlowNode,
  type FlowShape,
  type FlowSide,
  type Pt,
} from "./schema";
import { snap } from "./ops";

export interface Added {
  doc: FlowchartData;
  /** The new shape. */
  id: string;
  /** The connector to it, when there is one. */
  edge: string | null;
}

/**
 * The kind of shape that follows `shape`: the same kind, except after a start or end pill or bare text,
 * where the next step is a process (a second Start or a loose label is never the next step).
 */
export function nextShapeKind(shape: FlowShape): FlowShape {
  return shape === "terminator" || shape === "text" || shape === "annotation" ? "process" : shape;
}

/** The side a flow grows from: down in a top-down chart, right in a left-to-right one. */
export function flowSide(fc: FlowchartData): FlowSide {
  return flowchartDirection(fc) === "LR" ? "right" : "bottom";
}

/** A new shape's size: the source's own when it's the same kind (so a row of steps lines up). */
function sizeFor(src: FlowNode, shape: FlowShape): { w: number; h: number } {
  return src.shape === shape ? { w: src.w, h: src.h } : { ...FLOWCHART_SHAPE_SIZE[shape] };
}

function withNode(fc: FlowchartData, src: FlowNode, shape: FlowShape, at: { x: number; y: number }, size: { w: number; h: number }): { doc: FlowchartData; node: FlowNode } | null {
  if (fc.nodes.length >= FLOWCHART_LIMITS.maxNodes) return null;
  const L = FLOWCHART_LIMITS.maxCoord;
  const node: FlowNode = { id: flowId("n"), shape, x: Math.max(-L, Math.min(L, at.x)), y: Math.max(-L, Math.min(L, at.y)), w: size.w, h: size.h, text: "", color: src.color };
  if (src.parent) node.parent = src.parent;
  return { doc: { ...fc, nodes: [...fc.nodes, node] }, node };
}

function withEdge(fc: FlowchartData, from: string, to: string, fromSide: FlowSide, toSide: FlowSide): { doc: FlowchartData; id: string | null } {
  if (fc.edges.length >= FLOWCHART_LIMITS.maxEdges) return { doc: fc, id: null };
  const edge = newEdge(from, to, { fromSide, toSide });
  return { doc: { ...fc, edges: [...fc.edges, edge] }, id: edge.id };
}

/**
 * The next shape out of `side` of `sourceId`, connected to it and placed clear of every other shape
 * (quickAddPosition: one step out, beside the shape's other children on that side). `shape` defaults to
 * nextShapeKind of the source.
 */
export function quickAdd(fc: FlowchartData, sourceId: string, side: FlowSide, shape?: FlowShape): Added | null {
  const src = fc.nodes.find((n) => n.id === sourceId);
  if (!src) return null;
  const kind = shape ?? nextShapeKind(src.shape);
  const size = sizeFor(src, kind);
  const at = quickAddPosition(fc, sourceId, side, size);
  const added = withNode(fc, src, kind, at, size);
  if (!added) return null;
  const e = withEdge(added.doc, sourceId, added.node.id, side, OPPOSITE[side]);
  return { doc: e.doc, id: added.node.id, edge: e.id };
}

/**
 * A sibling branch of `nodeId` (Shift+Tab): another child of the shape that leads to it, beside it across
 * the flow; a loose shape beside it when nothing leads to it.
 */
export function quickBranch(fc: FlowchartData, nodeId: string, shape?: FlowShape): Added | null {
  const node = fc.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const kind = shape ?? nextShapeKind(node.shape);
  const size = sizeFor(node, kind);
  const direction = flowchartDirection(fc);
  const pos = quickAddSibling(fc, nodeId, size, direction);
  const added = withNode(fc, node, kind, pos, size);
  if (!added) return null;
  if (!pos.parent) return { doc: added.doc, id: added.node.id, edge: null };
  const out: FlowSide = direction === "LR" ? "right" : "bottom";
  const e = withEdge(added.doc, pos.parent, added.node.id, out, OPPOSITE[out]);
  return { doc: e.doc, id: added.node.id, edge: e.id };
}

/**
 * A shape of `shape` where a connector from `side` of `sourceId` was let go at `at`: its facing side sits
 * on that point (so the connector ends where it was dropped), connected.
 */
export function addConnectedAt(fc: FlowchartData, sourceId: string, side: FlowSide, shape: FlowShape, at: Pt): Added | null {
  const src = fc.nodes.find((n) => n.id === sourceId);
  if (!src) return null;
  const size = sizeFor(src, shape);
  const inSide = OPPOSITE[side];
  const c = { top: { x: at.x, y: at.y + size.h / 2 }, bottom: { x: at.x, y: at.y - size.h / 2 }, left: { x: at.x + size.w / 2, y: at.y }, right: { x: at.x - size.w / 2, y: at.y } }[inSide];
  const added = withNode(fc, src, shape, { x: snap(c.x - size.w / 2), y: snap(c.y - size.h / 2) }, size);
  if (!added) return null;
  const e = withEdge(added.doc, sourceId, added.node.id, side, inSide);
  return { doc: e.doc, id: added.node.id, edge: e.id };
}

const DIR: Record<FlowSide, Pt> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

/**
 * The shape an arrow key moves the selection to from `id`: the nearest one in that direction (within a
 * cone, nearer to the line counting more), preferring shapes connected to it, so following a flow
 * with the arrows walks its connectors.
 */
export function neighbourInDirection(fc: FlowchartData, id: string, dir: FlowSide): string | null {
  const from = fc.nodes.find((n) => n.id === id);
  if (!from) return null;
  const linked = new Set(fc.edges.flatMap((e) => (e.from === id ? [e.to] : e.to === id ? [e.from] : [])));
  const d = DIR[dir];
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  let best: { id: string; score: number } | null = null;
  for (const n of fc.nodes) {
    if (n.id === id) continue;
    const vx = n.x + n.w / 2 - cx;
    const vy = n.y + n.h / 2 - cy;
    const along = vx * d.x + vy * d.y;
    const across = Math.abs(vx * d.y - vy * d.x);
    const isLinked = linked.has(n.id);
    // A 45 degree cone each way; twice as wide for connected shapes (walking a flow's branches).
    if (along < 8 || across > along * (isLinked ? 2 : 1)) continue;
    const score = (along + across * 2) * (isLinked ? 0.5 : 1);
    if (!best || score < best.score) best = { id: n.id, score };
  }
  return best?.id ?? null;
}

/**
 * The parts of frames and swimlanes that are pressed to move them: frame title bands, pool title bands and
 * lane headers (layers/Containers.tsx draws them as data-fc-grab). The + arrows keep off these.
 */
export function containerGrabRects(fc: FlowchartData): Rect[] {
  const out: Rect[] = fc.frames.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.title ? FLOWCHART_FRAME_TITLE : 12 }));
  for (const p of fc.pools) {
    const r = poolRect(p);
    out.push({ x: r.x, y: r.y, w: r.w, h: FLOWCHART_POOL_TITLE });
    for (const b of laneBoxes(p)) out.push(b.header);
  }
  return out;
}

/** A circle (an arrow's touch area) overlaps a rectangle. */
export function circleHitsRect(c: Pt, r: number, rect: Rect): boolean {
  const dx = c.x - Math.max(rect.x, Math.min(c.x, rect.x + rect.w));
  const dy = c.y - Math.max(rect.y, Math.min(c.y, rect.y + rect.h));
  return dx * dx + dy * dy < r * r;
}

/**
 * Where a shape's connection points sit (interactions/connect.tsx): just outside the middle of each side,
 * `off` away. A point whose touch area (`hitR`) would cover a frame's or lane's title band (`grabs`, from
 * containerGrabRects) stays hidden, as the + arrows do, so pressing the band always moves the container.
 */
export function connectionHandles(n: FlowNode, off: number, hitR: number, grabs: readonly Rect[], sides: readonly FlowSide[] = ["top", "right", "bottom", "left"]): { side: FlowSide; at: Pt }[] {
  const out: { side: FlowSide; at: Pt }[] = [];
  for (const side of sides) {
    const p = portPoint(n, side);
    const d = { top: [0, -off], right: [off, 0], bottom: [0, off], left: [-off, 0] }[side];
    const at = { x: p.x + d[0]!, y: p.y + d[1]! };
    if (grabs.some((g) => circleHitsRect(at, hitR, g))) continue;
    out.push({ side, at });
  }
  return out;
}
