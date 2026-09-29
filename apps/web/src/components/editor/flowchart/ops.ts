// Pure flowchart edits used by the canvas: adding, moving, resizing, deleting and duplicating shapes,
// connecting them, snapping (grid and alignment guides), the undo history, and turning an AI draft into
// a laid-out chart. Kept free of React so it can be tested on its own.
import {
  FLOWCHART_GRID,
  FLOWCHART_LIMITS,
  FLOWCHART_SHAPE_SIZE,
  fitNodeToText,
  flowId,
  layoutFlowchart,
  normalizeFlowchart,
  type FlowchartData,
  type FlowColor,
  type FlowDirection,
  type FlowEdge,
  type FlowNode,
  type FlowShape,
  type FlowSide,
  type Rect,
} from "@folevi/editor-schema";

export interface Selection {
  nodes: string[];
  edges: string[];
}
export const NO_SELECTION: Selection = { nodes: [], edges: [] };

export const snap = (n: number, step = FLOWCHART_GRID) => Math.round(n / step) * step;

export function boxOf(nodes: readonly Rect[]): Rect | null {
  if (!nodes.length) return null;
  const x0 = Math.min(...nodes.map((n) => n.x));
  const y0 = Math.min(...nodes.map((n) => n.y));
  const x1 = Math.max(...nodes.map((n) => n.x + n.w));
  const y1 = Math.max(...nodes.map((n) => n.y + n.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The top-most node under a point. */
export function nodeAt(fc: FlowchartData, p: { x: number; y: number }, pad = 0): FlowNode | null {
  for (let i = fc.nodes.length - 1; i >= 0; i--) {
    const n = fc.nodes[i]!;
    if (p.x >= n.x - pad && p.x <= n.x + n.w + pad && p.y >= n.y - pad && p.y <= n.y + n.h + pad) return n;
  }
  return null;
}

/** A new node of `shape` centred on `at` (snapped), nudged along if that spot is taken. */
export function addNode(fc: FlowchartData, shape: FlowShape, at: { x: number; y: number }, extra: Partial<FlowNode> = {}): { doc: FlowchartData; id: string } | null {
  if (fc.nodes.length >= FLOWCHART_LIMITS.maxNodes) return null;
  const { w, h } = FLOWCHART_SHAPE_SIZE[shape];
  let x = snap(at.x - w / 2);
  let y = snap(at.y - h / 2);
  for (let i = 0; i < 20 && fc.nodes.some((n) => Math.abs(n.x - x) < 8 && Math.abs(n.y - y) < 8); i++) {
    x += 24;
    y += 24;
  }
  const node: FlowNode = { id: flowId("n"), shape, x, y, w, h, text: "", color: "neutral", ...extra };
  return { doc: { ...fc, nodes: [...fc.nodes, node] }, id: node.id };
}

export function connect(fc: FlowchartData, from: string, to: string, fromSide?: FlowSide, toSide?: FlowSide): { doc: FlowchartData; id: string } | null {
  if (from === to || fc.edges.length >= FLOWCHART_LIMITS.maxEdges) return null;
  const dup = fc.edges.find((e) => e.from === from && e.to === to);
  if (dup) return { doc: fc, id: dup.id };
  const edge: FlowEdge = { id: flowId("e"), from, to, label: "", style: "solid", arrow: "end" };
  if (fromSide) edge.fromSide = fromSide;
  if (toSide) edge.toSide = toSide;
  return { doc: { ...fc, edges: [...fc.edges, edge] }, id: edge.id };
}

export function updateNodes(fc: FlowchartData, ids: ReadonlySet<string> | readonly string[], patch: (n: FlowNode) => FlowNode): FlowchartData {
  const set = ids instanceof Set ? ids : new Set(ids as readonly string[]);
  return { ...fc, nodes: fc.nodes.map((n) => (set.has(n.id) ? patch(n) : n)) };
}

export function updateEdges(fc: FlowchartData, ids: readonly string[], patch: (e: FlowEdge) => FlowEdge): FlowchartData {
  const set = new Set(ids);
  return { ...fc, edges: fc.edges.map((e) => (set.has(e.id) ? patch(e) : e)) };
}

/** Moves nodes by (dx, dy) from their original positions. */
export function moveNodes(fc: FlowchartData, origin: ReadonlyMap<string, { x: number; y: number }>, dx: number, dy: number): FlowchartData {
  const L = FLOWCHART_LIMITS.maxCoord;
  return {
    ...fc,
    nodes: fc.nodes.map((n) => {
      const o = origin.get(n.id);
      return o ? { ...n, x: Math.max(-L, Math.min(L, Math.round(o.x + dx))), y: Math.max(-L, Math.min(L, Math.round(o.y + dy))) } : n;
    }),
  };
}

export function setColor(fc: FlowchartData, ids: readonly string[], color: FlowColor): FlowchartData {
  return updateNodes(fc, ids, (n) => ({ ...n, color }));
}

/** Changes shapes, keeping each node's centre and growing it to fit its label. */
export function setShape(fc: FlowchartData, ids: readonly string[], shape: FlowShape): FlowchartData {
  return updateNodes(fc, ids, (n) => {
    const size = FLOWCHART_SHAPE_SIZE[shape];
    const w = shape === "circle" ? size.w : Math.max(n.w, size.w);
    const h = shape === "circle" ? size.h : shape === "text" ? size.h : Math.max(n.h, size.h);
    return fitNodeToText({ ...n, shape, w, h, x: snap(n.x + n.w / 2 - w / 2), y: snap(n.y + n.h / 2 - h / 2) });
  });
}

/** Removes the selected nodes (with their connectors) and connectors. */
export function deleteSelection(fc: FlowchartData, sel: Selection): FlowchartData {
  const nodes = new Set(sel.nodes);
  const edges = new Set(sel.edges);
  return {
    ...fc,
    nodes: fc.nodes.filter((n) => !nodes.has(n.id)),
    edges: fc.edges.filter((e) => !edges.has(e.id) && !nodes.has(e.from) && !nodes.has(e.to)),
  };
}

/** Copies the selected nodes (and the connectors between them) a little down and to the right. */
export function duplicate(fc: FlowchartData, ids: readonly string[], offset = 24): { doc: FlowchartData; ids: string[] } {
  const room = FLOWCHART_LIMITS.maxNodes - fc.nodes.length;
  const picked = fc.nodes.filter((n) => ids.includes(n.id)).slice(0, Math.max(0, room));
  const map = new Map(picked.map((n) => [n.id, flowId("n")]));
  const nodes = picked.map((n) => ({ ...n, id: map.get(n.id)!, x: n.x + offset, y: n.y + offset }));
  const edges = fc.edges
    .filter((e) => map.has(e.from) && map.has(e.to))
    .slice(0, Math.max(0, FLOWCHART_LIMITS.maxEdges - fc.edges.length))
    .map((e) => ({ ...e, id: flowId("e"), from: map.get(e.from)!, to: map.get(e.to)! }));
  return { doc: { ...fc, nodes: [...fc.nodes, ...nodes], edges: [...fc.edges, ...edges] }, ids: nodes.map((n) => n.id) };
}

export type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

/** A node resized by dragging one of its handles by (dx, dy), snapped to the grid. */
export function resizeNode(orig: FlowNode, handle: ResizeHandle, dx: number, dy: number, keepRatio: boolean): FlowNode {
  const L = FLOWCHART_LIMITS;
  const min = orig.shape === "text" ? 32 : 40;
  let x0 = orig.x;
  let y0 = orig.y;
  let x1 = orig.x + orig.w;
  let y1 = orig.y + orig.h;
  if (handle.includes("w")) x0 = Math.min(snap(x0 + dx), x1 - min);
  if (handle.includes("e")) x1 = Math.max(snap(x1 + dx), x0 + min);
  if (handle.includes("n")) y0 = Math.min(snap(y0 + dy), y1 - min);
  if (handle.includes("s")) y1 = Math.max(snap(y1 + dy), y0 + min);
  let w = Math.min(L.maxWidth, x1 - x0);
  let h = Math.min(L.maxHeight, y1 - y0);
  if (keepRatio || orig.shape === "circle") {
    const s = Math.max(w / orig.w, h / orig.h);
    w = Math.min(L.maxWidth, snap(orig.w * s));
    h = Math.min(L.maxHeight, snap(orig.h * s));
  }
  if (handle.includes("w")) x0 = x1 - w;
  if (handle.includes("n")) y0 = y1 - h;
  return { ...orig, x: x0, y: y0, w, h };
}

export interface Guide {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

/**
 * Snaps a moving group: to another node's edges or centre when within `threshold` (showing a guide),
 * otherwise to the grid.
 */
export function snapGroup(moving: Rect, others: readonly Rect[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const guides: Guide[] = [];
  const pick = (axis: "x" | "y") => {
    const pos = axis === "x" ? moving.x : moving.y;
    const size = axis === "x" ? moving.w : moving.h;
    const lines = [pos, pos + size / 2, pos + size];
    let best: { d: number; at: number; other: Rect } | null = null;
    for (const o of others) {
      const op = axis === "x" ? o.x : o.y;
      const os = axis === "x" ? o.w : o.h;
      for (const target of [op, op + os / 2, op + os]) {
        for (const l of lines) {
          const d = target - l;
          if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: target, other: o };
        }
      }
    }
    if (!best) return snap(pos) - pos;
    const o = best.other;
    const [a0, a1] = axis === "x" ? [Math.min(moving.y, o.y), Math.max(moving.y + moving.h, o.y + o.h)] : [Math.min(moving.x, o.x), Math.max(moving.x + moving.w, o.x + o.w)];
    guides.push({ axis, at: best.at, from: a0, to: a1 });
    return best.d;
  };
  const dx = pick("x");
  const dy = pick("y");
  return { dx, dy, guides };
}

// ------------------------------------------------------------------------------------------ history

/**
 * Undo/redo for one flowchart. Separate from the editor's history (the canvas handles ⌘Z while it has
 * focus); cleared whenever the chart changes from outside (another device, the editor's own undo).
 * Rapid edits with the same key (typing, nudging) coalesce into one step.
 */
export class FlowHistory {
  private past: FlowchartData[] = [];
  private future: FlowchartData[] = [];
  private lastKey: string | null = null;
  private lastAt = 0;

  push(before: FlowchartData, key?: string, now = Date.now()): void {
    if (key && key === this.lastKey && now - this.lastAt < 800) {
      this.lastAt = now;
      return;
    }
    this.past.push(before);
    if (this.past.length > 200) this.past.shift();
    this.future = [];
    this.lastKey = key ?? null;
    this.lastAt = now;
  }
  undo(current: FlowchartData): FlowchartData | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(current);
    this.lastKey = null;
    return prev;
  }
  redo(current: FlowchartData): FlowchartData | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    this.lastKey = null;
    return next;
  }
  clear(): void {
    this.past = [];
    this.future = [];
    this.lastKey = null;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
}

// ------------------------------------------------------------------------------------------ AI drafts

export interface FlowDraft {
  nodes: { id: string; shape: string; text: string; color?: string }[];
  edges: { from: string; to: string; label?: string; style?: string; arrow?: string }[];
  direction?: string;
}

/**
 * Turns an AI draft into a chart: validated again here (never trust the network), sized to its labels,
 * laid out, and placed where the current chart starts. In "update" mode nodes the AI kept (same id) keep
 * their size and colour.
 */
export function chartFromDraft(draft: FlowDraft, current: FlowchartData, mode: "create" | "update"): FlowchartData {
  const safe = normalizeFlowchart(draft);
  const prev = new Map(current.nodes.map((n) => [n.id, n]));
  const nodes = safe.nodes.map((n) => {
    const old = mode === "update" ? prev.get(n.id) : undefined;
    const size = old && old.shape === n.shape ? { w: old.w, h: old.h } : FLOWCHART_SHAPE_SIZE[n.shape];
    const color = old && n.color === "neutral" ? old.color : n.color;
    return fitNodeToText({ ...n, ...size, color }, { maxWidth: 240 });
  });
  const origin = boxOf(current.nodes) ?? { x: 0, y: 0 };
  const direction: FlowDirection = draft.direction === "LR" ? "LR" : "TD";
  return layoutFlowchart({ v: 1, nodes, edges: safe.edges }, { direction, origin: { x: snap(origin.x), y: snap(origin.y) } });
}
