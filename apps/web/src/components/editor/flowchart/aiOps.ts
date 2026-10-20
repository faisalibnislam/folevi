// Foli AI's results and Tidy up as chart edits, pure and tested (apps/web/test/flowchart-ai.test.ts):
//
//   draftChart        a drawn chart (from a description, a note or a list), with its frames and swimlanes,
//                     sized to its labels and laid out where the current chart starts
//   placeExtension    new shapes from "Add next steps" / "Fill in missing branches", laid out by the layout
//                     engine next to the selection (the first selected shape stays put) and moved clear of
//                     what's already there; each joins the frame or lane it lands in
//   applyLabels       the label suggestions the person took
//   arrangeChart      "Tidy up with Foli AI": the model's rank-by-rank order seeds layoutFlowchart
//   tidyChart         Tidy up: top-down or left to right, keeping the person's placement when asked
//   tweenCharts       the frames of Tidy up's animated move from one arrangement to the other
//
// The caller shows each result as a preview first and applies it as one change (one undo step).
import {
  FLOWCHART_COLORS,
  FLOWCHART_LIMITS,
  FLOWCHART_SHAPES,
  FLOWCHART_SHAPE_SIZE,
  containerAt,
  fitNodeToText,
  flowId,
  flowchart,
  flowchartDirection,
  layoutFlowchart,
  newEdge,
  normalizeFlowchart,
  withArrow,
  withLabel,
  type FlowArrow,
  type FlowchartData,
  type FlowColor,
  type FlowDirection,
  type FlowEdge,
  type FlowFrame,
  type FlowNode,
  type FlowPool,
  type FlowShape,
  type Rect,
} from "./schema";
import { boxOf, snap } from "./ops";

// ------------------------------------------------------------------------------------------ replies

/** A drawn chart as the server returns it (ai.flowchart, flowchartAi.fromText). */
export interface AiDraft {
  nodes: { id: string; shape: string; text: string; color?: string; parent?: string }[];
  edges: { from: string; to: string; label?: string; style?: string; arrow?: string }[];
  direction?: string;
  frames?: { id: string; title: string; color?: string }[];
  lanes?: { id: string; title: string }[];
  laneOrient?: string;
}
/** What "Add next steps" / "Fill in missing branches" returns (flowchartAi.extend). */
export interface AiExtension {
  nodes: AiDraft["nodes"];
  edges: AiDraft["edges"];
  labels: { id: string; label: string }[];
}
export interface AiLabelSuggestions {
  shapes: { id: string; text: string; before: string; why: string }[];
  connectors: { id: string; label: string; before: string; why: string }[];
}
export interface AiArrangement {
  direction: string;
  rows: string[][];
}
export interface AiExplanation {
  summary: string;
  steps: string[];
  decisions: string[];
  gaps: string[];
  markdown: string;
}

const shapeOf = (s: string): FlowShape => ((FLOWCHART_SHAPES as readonly string[]).includes(s) ? (s as FlowShape) : "process");
const colorOf = (c: string | undefined): FlowColor => ((FLOWCHART_COLORS as readonly string[]).includes(c ?? "") ? (c as FlowColor) : "neutral");
const dirOf = (d: string | undefined): FlowDirection => (d === "LR" ? "LR" : "TD");

/** The chart's top-left corner (shapes and frames), on the grid. */
function cornerOf(fc: FlowchartData): { x: number; y: number } {
  const b = boxOf([...fc.nodes, ...fc.frames]);
  return b ? { x: snap(b.x), y: snap(b.y) } : { x: 0, y: 0 };
}

// ------------------------------------------------------------------------------------------ drawn charts

/**
 * A drawn chart, checked again here (never trust the network), sized to its labels and laid out where the
 * current chart starts. "update" keeps the size and colour of shapes the model kept (same id), and the
 * chart's frames and lanes when the reply names none.
 */
export function draftChart(draft: AiDraft, current: FlowchartData, mode: "create" | "update"): FlowchartData {
  const prev = new Map(current.nodes.map((n) => [n.id, n]));
  const corner = cornerOf(current);
  const keepGroups = mode === "update" && !draft.frames?.length && !draft.lanes?.length;
  const frames: FlowFrame[] = keepGroups
    ? current.frames
    : (draft.frames ?? []).map((f) => ({ id: f.id, x: corner.x, y: corner.y, w: 480, h: 320, title: f.title, color: colorOf(f.color ?? current.frames.find((x) => x.id === f.id)?.color) }));
  const pools: FlowPool[] = keepGroups
    ? current.pools
    : draft.lanes?.length
      ? [{ id: "pool", x: corner.x, y: corner.y, orient: draft.laneOrient === "columns" ? "columns" : "rows", title: "", length: 960, lanes: draft.lanes.map((l) => ({ id: l.id, title: l.title, size: 200, color: "neutral" as FlowColor })) }]
      : [];
  const safe = normalizeFlowchart({
    frames,
    pools,
    nodes: draft.nodes.map((n) => ({ id: n.id, shape: n.shape, text: n.text, color: n.color, parent: n.parent ?? (keepGroups ? prev.get(n.id)?.parent : undefined) })),
    edges: draft.edges,
  });
  const nodes = safe.nodes.map((n) => {
    const old = mode === "update" ? prev.get(n.id) : undefined;
    const size = old && old.shape === n.shape ? { w: old.w, h: old.h } : FLOWCHART_SHAPE_SIZE[n.shape];
    const color = old && n.color === "neutral" ? old.color : n.color;
    return fitNodeToText({ ...n, ...size, color }, { maxWidth: 240 });
  });
  return layoutFlowchart(flowchart({ nodes, edges: safe.edges, frames: safe.frames, pools: safe.pools }), { direction: dirOf(draft.direction), origin: corner });
}

// ------------------------------------------------------------------------------------------ extending

export interface PlacedExtension {
  doc: FlowchartData;
  /** The new shapes and connectors, and the connectors that got a label. */
  nodes: string[];
  edges: string[];
  labelled: string[];
}

const GAP = 24;
const padded = (r: Rect, p: number): Rect => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p });
const hits = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Adds an extension beside the selected shapes (`anchors`): the new shapes and the selected ones are laid
 * out together by the layout engine (the first selected shape stays where it is), then the new group moves
 * to the nearest spot where nothing overlaps (downstream first). New ids never clash; connectors that
 * repeat one the chart has, or that join something missing, are dropped; labels only fill bare connectors.
 */
export function placeExtension(fc: FlowchartData, ext: AiExtension, anchors: readonly string[], direction: FlowDirection = flowchartDirection(fc)): PlacedExtension | null {
  const byId = new Map(fc.nodes.map((n) => [n.id, n]));
  const used = new Set<string>([...fc.nodes.map((n) => n.id), ...fc.frames.map((f) => f.id), ...fc.pools.flatMap((p) => [p.id, ...p.lanes.map((l) => l.id)])]);
  const rename = new Map<string, string>();
  const fresh: FlowNode[] = [];
  for (const n of ext.nodes.slice(0, Math.max(0, FLOWCHART_LIMITS.maxNodes - fc.nodes.length))) {
    let id = n.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
    while (!id || used.has(id)) id = flowId("n");
    used.add(id);
    rename.set(n.id, id);
    const shape = shapeOf(n.shape);
    fresh.push(fitNodeToText({ id, shape, x: 0, y: 0, ...FLOWCHART_SHAPE_SIZE[shape], text: n.text.slice(0, FLOWCHART_LIMITS.maxText), color: colorOf(n.color) }, { maxWidth: 240 }));
  }
  const resolve = (id: string) => rename.get(id) ?? (byId.has(id) ? id : null);
  const pairs = new Set(fc.edges.map((e) => `${e.from}>${e.to}`));
  const edges: FlowEdge[] = [];
  for (const e of ext.edges) {
    if (fc.edges.length + edges.length >= FLOWCHART_LIMITS.maxEdges) break;
    const from = resolve(e.from);
    const to = resolve(e.to);
    if (!from || !to || from === to || pairs.has(`${from}>${to}`)) continue;
    pairs.add(`${from}>${to}`);
    const arrow: FlowArrow = e.arrow === "both" || e.arrow === "none" ? e.arrow : "end";
    let edge = withArrow(withLabel(newEdge(from, to), e.label ?? ""), arrow);
    if (e.style === "dashed" || e.style === "dotted") edge = { ...edge, style: e.style };
    edges.push(edge);
  }
  const joined = new Set(edges.flatMap((e) => [e.from, e.to]));
  const nodes = fresh.filter((n) => joined.has(n.id));
  const kept = new Set(nodes.map((n) => n.id));
  const newEdges = edges.filter((e) => (byId.has(e.from) || kept.has(e.from)) && (byId.has(e.to) || kept.has(e.to)));
  const bare = new Set(fc.edges.filter((e) => !e.labels.some((l) => l.text.trim())).map((e) => e.id));
  const labels = ext.labels.filter((l) => bare.has(l.id) && l.label.trim());
  if (!nodes.length && !newEdges.length && !labels.length) return null;

  // Lay the new shapes out with what leads into them, the first selected shape pinned in place.
  const sources = new Set<string>(anchors.filter((id) => byId.has(id)));
  for (const e of newEdges) if (byId.has(e.from) && kept.has(e.to)) sources.add(e.from);
  const pin = [...sources][0] ?? newEdges.map((e) => (byId.has(e.from) ? e.from : e.to)).find((id) => byId.has(id));
  let placed: FlowNode[] = nodes;
  if (nodes.length && pin) {
    const pinned = byId.get(pin)!;
    const lr = direction === "LR";
    const seed = (n: FlowNode, i: number): FlowNode => ({ ...n, x: pinned.x + (lr ? 260 : i * 200), y: pinned.y + (lr ? i * 120 : 160) });
    const mini = flowchart({
      nodes: [...[...sources].map((id) => ({ ...byId.get(id)!, parent: undefined })), ...nodes.map(seed)],
      edges: [...fc.edges.filter((e) => sources.has(e.from) && sources.has(e.to)), ...newEdges.filter((e) => (sources.has(e.from) || kept.has(e.from)) && kept.has(e.to))],
    });
    const laid = layoutFlowchart(mini, { direction, keepPlacement: true });
    const at = laid.nodes.find((n) => n.id === pin)!;
    const dx = pinned.x - at.x;
    const dy = pinned.y - at.y;
    const group = laid.nodes.filter((n) => kept.has(n.id)).map((n) => ({ ...n, x: n.x + dx, y: n.y + dy }));
    // The nearest offset (downstream first) where the new group overlaps nothing.
    const obstacles = [...fc.nodes.map((n) => padded(n, GAP / 2)), ...fc.frames.filter((f) => !fc.nodes.some((n) => n.parent === f.id && sources.has(n.id))).map((f) => padded(f, GAP / 2))];
    const clear = (ox: number, oy: number) => group.every((n) => obstacles.every((o) => !hits({ x: n.x + ox, y: n.y + oy, w: n.w, h: n.h }, o)));
    // Beside the flow costs less than further down it (a new branch sits next to what's already there).
    const candidates: { along: number; across: number; cost: number }[] = [];
    for (let along = 0; along <= 30; along++) for (let across = -30; across <= 30; across++) candidates.push({ along, across, cost: Math.abs(across) + 2 * along + (across < 0 ? 0.5 : 0) });
    candidates.sort((a, b) => a.cost - b.cost);
    const hit = candidates.find((c) => clear(lr ? c.along * GAP : c.across * GAP, lr ? c.across * GAP : c.along * GAP));
    const off = hit ? { ox: lr ? hit.along * GAP : hit.across * GAP, oy: lr ? hit.across * GAP : hit.along * GAP } : { ox: 0, oy: 0 };
    placed = group.map((n) => ({ ...n, x: snap(n.x + off.ox), y: snap(n.y + off.oy) }));
  } else if (nodes.length) {
    const b = boxOf(fc.nodes) ?? { x: 0, y: 0, w: 0, h: 0 };
    placed = nodes.map((n, i) => ({ ...n, x: snap(b.x + b.w + 80), y: snap(b.y + i * (n.h + GAP)) }));
  }
  // Each new shape joins the frame or lane it landed in.
  const withNodes: FlowchartData = { ...fc, nodes: [...fc.nodes, ...placed] };
  const homed = placed.map((n) => {
    const parent = containerAt(withNodes, n);
    return parent ? { ...n, parent } : n;
  });
  const labelled = new Map(labels.map((l) => [l.id, l.label]));
  const doc: FlowchartData = {
    ...fc,
    nodes: [...fc.nodes, ...homed],
    edges: [...fc.edges.map((e) => (labelled.has(e.id) ? withLabel(e, labelled.get(e.id)!) : e)), ...newEdges],
  };
  return { doc, nodes: homed.map((n) => n.id), edges: newEdges.map((e) => e.id), labelled: [...labelled.keys()] };
}

// ------------------------------------------------------------------------------------------ labels

/** The chart with the label changes the person took (a shape's new text drops its old formatting). */
export function applyLabels(fc: FlowchartData, shapes: readonly { id: string; text: string }[], connectors: readonly { id: string; label: string }[]): FlowchartData {
  const s = new Map(shapes.map((x) => [x.id, x.text]));
  const c = new Map(connectors.map((x) => [x.id, x.label]));
  return {
    ...fc,
    nodes: fc.nodes.map((n) => {
      const text = s.get(n.id);
      if (text === undefined) return n;
      const { rich: _rich, ...rest } = n;
      return fitNodeToText({ ...rest, text: text.slice(0, FLOWCHART_LIMITS.maxText) });
    }),
    edges: fc.edges.map((e) => (c.has(e.id) ? withLabel(e, c.get(e.id)!) : e)),
  };
}

// ------------------------------------------------------------------------------------------ arranging

/**
 * "Tidy up with Foli AI": the model's ranks (each listing shapes in order across the flow) become the
 * starting arrangement the layout engine keeps (keepPlacement), so its order wins wherever it doesn't cost
 * readability; shapes the model left out come after. The chart stays where it was.
 */
export function arrangeChart(fc: FlowchartData, arrangement: AiArrangement): FlowchartData {
  const direction = dirOf(arrangement.direction);
  const lr = direction === "LR";
  const at = new Map<string, { r: number; c: number }>();
  arrangement.rows.forEach((row, r) => row.forEach((id, c) => at.set(id, { r, c: c - (row.length - 1) / 2 })));
  let extra = 0;
  const centre = (id: string) => at.get(id) ?? { r: arrangement.rows.length, c: extra++ };
  const hinted = new Map<string, { cx: number; cy: number }>();
  const nodes = fc.nodes.map((n) => {
    const p = centre(n.id);
    const main = p.r * 200;
    const cross = p.c * 240;
    const cx = lr ? main : cross;
    const cy = lr ? cross : main;
    hinted.set(n.id, { cx, cy });
    return { ...n, x: cx - n.w / 2, y: cy - n.h / 2 };
  });
  // A frame sits where its shapes were put (it is ordered as one box with them).
  const frames = fc.frames.map((f) => {
    const members = fc.nodes.filter((n) => n.parent === f.id).map((n) => hinted.get(n.id)!);
    if (!members.length) return f;
    const cx = members.reduce((s, m) => s + m.cx, 0) / members.length;
    const cy = members.reduce((s, m) => s + m.cy, 0) / members.length;
    return { ...f, x: cx - f.w / 2, y: cy - f.h / 2 };
  });
  return layoutFlowchart({ ...fc, nodes, frames }, { direction, keepPlacement: true, origin: cornerOf(fc) });
}

// ------------------------------------------------------------------------------------------ tidy up

export interface TidyOptions {
  direction: FlowDirection;
  /** Keep the current arrangement where it doesn't hurt (order, where groups sit). */
  keepPlacement: boolean;
}

/** Tidy up: the layered layout in the chosen direction, frames and swimlanes included, where the chart was. */
export function tidyChart(fc: FlowchartData, opts: TidyOptions): FlowchartData {
  return layoutFlowchart(fc, { direction: opts.direction, keepPlacement: opts.keepPlacement, origin: cornerOf(fc) });
}

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/** A frame of the move from `a` to `b` (t from 0 to 1): shapes, frames and lanes in between, `b`'s connectors. */
export function tweenCharts(a: FlowchartData, b: FlowchartData, t: number): FlowchartData {
  if (t >= 1) return b;
  const an = new Map(a.nodes.map((n) => [n.id, n]));
  const af = new Map(a.frames.map((f) => [f.id, f]));
  const ap = new Map(a.pools.map((p) => [p.id, p]));
  return {
    ...b,
    nodes: b.nodes.map((n) => {
      const o = an.get(n.id);
      return o ? { ...n, x: lerp(o.x, n.x, t), y: lerp(o.y, n.y, t), w: lerp(o.w, n.w, t), h: lerp(o.h, n.h, t) } : n;
    }),
    frames: b.frames.map((f) => {
      const o = af.get(f.id);
      return o ? { ...f, x: lerp(o.x, f.x, t), y: lerp(o.y, f.y, t), w: lerp(o.w, f.w, t), h: lerp(o.h, f.h, t) } : f;
    }),
    pools: b.pools.map((p) => {
      const o = ap.get(p.id);
      if (!o) return p;
      const sizes = new Map(o.lanes.map((l) => [l.id, l.size]));
      return { ...p, x: lerp(o.x, p.x, t), y: lerp(o.y, p.y, t), length: lerp(o.length, p.length, t), lanes: p.lanes.map((l) => ({ ...l, size: lerp(sizes.get(l.id) ?? l.size, l.size, t) })) };
    }),
  };
}

/** Whether anything moved between two arrangements (shapes, frames or lanes). */
export function arrangementChanged(a: FlowchartData, b: FlowchartData): boolean {
  const an = new Map(a.nodes.map((n) => [n.id, n]));
  if (b.nodes.some((n) => {
    const o = an.get(n.id);
    return !o || o.x !== n.x || o.y !== n.y || o.w !== n.w || o.h !== n.h;
  }))
    return true;
  const af = new Map(a.frames.map((f) => [f.id, f]));
  if (b.frames.some((f) => {
    const o = af.get(f.id);
    return !o || o.x !== f.x || o.y !== f.y || o.w !== f.w || o.h !== f.h;
  }))
    return true;
  return JSON.stringify(a.pools) !== JSON.stringify(b.pools);
}
