// Walking a flowchart: which way each connector leads, where a walkthrough starts, the next steps from a
// shape (in reading order, so "1" and "2" at a decision are always the same branches), and the paths
// between two shapes or from one shape to every end. Used by the editor's Present and Follow a path, and
// pure so it can be tested and reused (Foli AI's checks, exports).
import type { FlowchartData, FlowEdge, FlowNode } from "./flowchart";
import { flowchartDirection } from "./flowchartMermaid";

/** One way out of a shape: the connector, the shape it leads to, and the connector's first label. */
export interface FlowStep {
  edge: FlowEdge;
  /** The shape the step arrives at. */
  to: string;
  /** The shape the step leaves (the other end of the connector). */
  from: string;
  label: string;
}

/** A path through the chart: its shapes in order, and the connectors between them (one fewer). */
export interface FlowPath {
  nodes: string[];
  edges: string[];
  /** The connector at the end that leads back to a shape already on the path (a loop), when it ends so. */
  loop?: { edge: string; to: string };
}

export interface FlowGraph {
  /** Ways out of each shape, in reading order. */
  out: Map<string, FlowStep[]>;
  /** Ways into each shape. */
  in: Map<string, FlowStep[]>;
  byId: Map<string, FlowNode>;
}

/**
 * Which way a connector leads: from its start to its end, unless only its start carries a head (an arrow
 * drawn backwards). Connectors with a loose end, or to a shape that isn't there, lead nowhere.
 */
export function edgeDirection(e: FlowEdge, byId: ReadonlyMap<string, unknown>): { from: string; to: string } | null {
  if (!e.from || !e.to || !byId.has(e.from) || !byId.has(e.to) || e.from === e.to) return null;
  return e.start !== "none" && e.end === "none" ? { from: e.to, to: e.from } : { from: e.from, to: e.to };
}

const cx = (n: FlowNode) => n.x + n.w / 2;
const cy = (n: FlowNode) => n.y + n.h / 2;

/** The chart as a directed graph, each shape's ways out ordered across the flow (left to right, or top down). */
export function flowGraph(fc: FlowchartData): FlowGraph {
  const byId = new Map(fc.nodes.map((n) => [n.id, n]));
  const out = new Map<string, FlowStep[]>();
  const into = new Map<string, FlowStep[]>();
  for (const n of fc.nodes) {
    out.set(n.id, []);
    into.set(n.id, []);
  }
  for (const e of fc.edges) {
    const d = edgeDirection(e, byId);
    if (!d) continue;
    const step: FlowStep = { edge: e, from: d.from, to: d.to, label: e.labels[0]?.text.trim() ?? "" };
    out.get(d.from)!.push(step);
    into.get(d.to)!.push(step);
  }
  const lr = flowchartDirection(fc) === "LR";
  const across = (id: string) => {
    const n = byId.get(id)!;
    return lr ? [cy(n), cx(n)] : [cx(n), cy(n)];
  };
  const order = (a: string, b: string) => {
    const [a1, a2] = across(a);
    const [b1, b2] = across(b);
    return a1! - b1! || a2! - b2!;
  };
  for (const list of out.values()) list.sort((a, b) => order(a.to, b.to) || a.edge.id.localeCompare(b.edge.id));
  for (const list of into.values()) list.sort((a, b) => order(a.from, b.from) || a.edge.id.localeCompare(b.edge.id));
  return { out, in: into, byId };
}

/** Shapes in reading order: top to bottom, then left to right (left to right first in a sideways chart). */
function readingOrder(fc: FlowchartData): FlowNode[] {
  const lr = flowchartDirection(fc) === "LR";
  return [...fc.nodes].sort((a, b) => (lr ? cx(a) - cx(b) || cy(a) - cy(b) : cy(a) - cy(b) || cx(a) - cx(b)));
}

/**
 * Where a walkthrough starts: the shape asked for (the selected one) when it exists; otherwise a start
 * terminator nothing leads into, then any shape nothing leads into that leads somewhere, then the first
 * shape in reading order. Null for an empty chart.
 */
export function flowStart(fc: FlowchartData, prefer?: string | null, graph: FlowGraph = flowGraph(fc)): string | null {
  if (prefer && graph.byId.has(prefer)) return prefer;
  const nodes = readingOrder(fc).filter((n) => n.shape !== "text" && n.shape !== "note");
  const sources = nodes.filter((n) => !graph.in.get(n.id)!.length);
  return (
    sources.find((n) => n.shape === "terminator" && graph.out.get(n.id)!.length)?.id ??
    sources.find((n) => n.shape === "terminator")?.id ??
    sources.find((n) => graph.out.get(n.id)!.length)?.id ??
    nodes[0]?.id ??
    readingOrder(fc)[0]?.id ??
    null
  );
}

/** The ways out of a shape, in reading order. */
export function nextSteps(fc: FlowchartData, id: string, graph: FlowGraph = flowGraph(fc)): FlowStep[] {
  return graph.out.get(id) ?? [];
}

export interface PathOptions {
  /** At most this many paths (default 50). */
  limit?: number;
  /** Paths longer than this many shapes are left out (default 200). */
  maxLength?: number;
}

/** The simple paths from `from` (depth first, in branch order), each ending where `stop` says. */
function walk(graph: FlowGraph, from: string, stop: (id: string, ways: FlowStep[]) => boolean, opts: PathOptions): FlowPath[] {
  const limit = opts.limit ?? 50;
  const maxLength = opts.maxLength ?? 200;
  const found: FlowPath[] = [];
  if (!graph.byId.has(from)) return found;
  const nodes = [from];
  const edges: string[] = [];
  const on = new Set([from]);
  // A budget on the steps taken, so a dense chart with many routes answers quickly with what it found.
  let budget = 50_000;
  const visit = (id: string) => {
    if (found.length >= limit || --budget < 0) return;
    const all = graph.out.get(id) ?? [];
    const ways = all.filter((s) => !on.has(s.to));
    if (stop(id, ways)) {
      const back = !ways.length ? all.find((s) => on.has(s.to)) : undefined;
      found.push({ nodes: [...nodes], edges: [...edges], ...(back ? { loop: { edge: back.edge.id, to: back.to } } : {}) });
      return;
    }
    if (nodes.length >= maxLength) return;
    for (const s of ways) {
      nodes.push(s.to);
      edges.push(s.edge.id);
      on.add(s.to);
      visit(s.to);
      on.delete(s.to);
      nodes.pop();
      edges.pop();
      if (found.length >= limit) return;
    }
  };
  visit(from);
  return found;
}

/** Every simple path from one shape to another, in branch order (empty when `to` can't be reached). */
export function pathsBetween(fc: FlowchartData, from: string, to: string, opts: PathOptions = {}, graph: FlowGraph = flowGraph(fc)): FlowPath[] {
  if (!graph.byId.has(to)) return [];
  if (from === to) return graph.byId.has(from) ? [{ nodes: [from], edges: [] }] : [];
  return walk(graph, from, (id) => id === to, opts);
}

/**
 * The paths from a shape to every end it can reach: each one stops at a shape with no way out, or where
 * going on would only come back round to a shape already on it (a loop; `loop` names that connector).
 */
export function pathsFrom(fc: FlowchartData, from: string, opts: PathOptions = {}, graph: FlowGraph = flowGraph(fc)): FlowPath[] {
  return walk(graph, from, (_id, ways) => !ways.length, opts);
}

/** The shapes and connectors on any of the paths. */
export function pathsUnion(paths: readonly FlowPath[]): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  for (const p of paths) {
    for (const n of p.nodes) nodes.add(n);
    for (const e of p.edges) edges.add(e);
    if (p.loop) edges.add(p.loop.edge);
  }
  return { nodes, edges };
}

/** Ids of the files a chart's shapes show (their images), each once. */
export function flowchartFileIds(fc: FlowchartData): string[] {
  return [...new Set(fc.nodes.flatMap((n) => (n.image?.fileId ? [n.image.fileId] : [])))];
}
