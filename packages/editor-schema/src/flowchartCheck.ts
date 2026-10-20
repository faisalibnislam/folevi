// Flowchart checks: the deterministic reading Foli AI's "Check" starts from (no model involved), and the layout
// numbers that decide whether "Tidy up with Foli AI" is worth offering.
//
//   checkFlowchart   dead ends, decisions with unlabelled branches or only one way out, shapes nothing leads to
//                    (or that aren't connected at all), loops with no way out, and shapes with no text. Each
//                    issue names the shapes and connectors it is about, so the editor can jump to them.
//   layoutStats      connector crossings (from the router) and shapes lying on top of each other.
//
// Connectors lead from their start to their end, unless only the start carries a head (a connector drawn
// backwards), the same reading as flowchartPaths.ts. Side remarks (sticky notes, text, annotations,
// callouts) take no part in the flow and are never reported.
import type { FlowchartData, FlowEdge, FlowNode } from "./flowchart";
import type { FlowShape } from "./flowchartShapes";
import { routeFlowchart } from "./flowchartRouting";

export type FlowIssueKind = "unreachable" | "unconnected" | "deadEnd" | "loopNoExit" | "oneWayDecision" | "unlabelledBranch" | "noText";

export interface FlowIssue {
  kind: FlowIssueKind;
  /** The shapes the issue is about (the first is where to jump). */
  nodes: string[];
  /** The connectors it is about (unlabelled branches, a loop's connectors). */
  edges: string[];
  /** One plain sentence for the list. */
  message: string;
}

/** Shapes that are remarks beside the flow, not steps in it. */
const REMARKS: ReadonlySet<FlowShape> = new Set<FlowShape>(["note", "text", "annotation", "callout"]);
/** Shapes that ask a question (their ways out are its answers). */
const DECISIONS: ReadonlySet<FlowShape> = new Set<FlowShape>(["decision", "diamond"]);
/** Shapes where a flow may stop (an end, or it carries on elsewhere). */
const STOPS: ReadonlySet<FlowShape> = new Set<FlowShape>(["terminator", "offPage", "connector"]);
/** Small symbols that usually carry no words. */
const WORDLESS: ReadonlySet<FlowShape> = new Set<FlowShape>(["connector", "or", "summingJunction", "merge", "extract", "collate"]);
/** A step whose words say the flow ends there. */
const END_WORDS = /\b(end|ends|ended|done|finish|finished|stop|stops|stopped|complete|completed|exit|close|closed|cancel|cancelled|canceled)\b/i;
const START_WORDS = /\b(start|begin|begins|starts)\b/i;

/** A short, quoted name for a shape in a sentence. */
function nameOf(n: FlowNode, fallback = "A shape"): string {
  const t = n.text.replace(/\s+/g, " ").trim();
  if (!t) return fallback;
  return `“${t.length > 40 ? `${t.slice(0, 38).trimEnd()}…` : t}”`;
}

/** Which way a connector leads, or null when it doesn't join two shapes of the flow. */
function direction(e: FlowEdge, flow: ReadonlyMap<string, FlowNode>): { from: string; to: string } | null {
  if (!e.from || !e.to || !flow.has(e.from) || !flow.has(e.to)) return null;
  return e.start !== "none" && e.end === "none" ? { from: e.to, to: e.from } : { from: e.from, to: e.to };
}

/** Strongly connected components (Tarjan), iteratively so a long chain can't overflow the stack. */
function components(ids: readonly string[], out: ReadonlyMap<string, string[]>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  for (const root of ids) {
    if (idx.has(root)) continue;
    const work: { id: string; next: number }[] = [{ id: root, next: 0 }];
    idx.set(root, index);
    low.set(root, index++);
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const top = work[work.length - 1]!;
      const succ = out.get(top.id) ?? [];
      if (top.next < succ.length) {
        const w = succ[top.next++]!;
        if (!idx.has(w)) {
          idx.set(w, index);
          low.set(w, index++);
          stack.push(w);
          onStack.add(w);
          work.push({ id: w, next: 0 });
        } else if (onStack.has(w)) low.set(top.id, Math.min(low.get(top.id)!, idx.get(w)!));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1]!.id;
        low.set(parent, Math.min(low.get(parent)!, low.get(top.id)!));
      }
      if (low.get(top.id) === idx.get(top.id)) {
        const comp: string[] = [];
        for (;;) {
          const w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
          if (w === top.id) break;
        }
        result.push(comp);
      }
    }
  }
  return result;
}

const ORDER: Record<FlowIssueKind, number> = { unreachable: 0, unconnected: 1, deadEnd: 2, loopNoExit: 3, oneWayDecision: 4, unlabelledBranch: 5, noText: 6 };

/** Everything the deterministic check finds, most serious first, in reading order within each kind. */
export function checkFlowchart(fc: FlowchartData): FlowIssue[] {
  const flowNodes = fc.nodes.filter((n) => !REMARKS.has(n.shape));
  if (!flowNodes.length) return [];
  const flow = new Map(flowNodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>(flowNodes.map((n) => [n.id, []]));
  const inc = new Map<string, string[]>(flowNodes.map((n) => [n.id, []]));
  const outEdges = new Map<string, FlowEdge[]>(flowNodes.map((n) => [n.id, []]));
  const touched = new Set<string>();
  let joined = 0;
  for (const e of fc.edges) {
    const d = direction(e, flow);
    if (!d) {
      // A connector from a shape to a loose point still counts as a way out (it is drawn going somewhere).
      if (e.from && flow.has(e.from) && !e.to) touched.add(e.from);
      if (e.to && flow.has(e.to) && !e.from) touched.add(e.to);
      continue;
    }
    joined++;
    out.get(d.from)!.push(d.to);
    inc.get(d.to)!.push(d.from);
    outEdges.get(d.from)!.push(e);
    touched.add(d.from);
    touched.add(d.to);
  }
  const reading = [...flowNodes].sort((a, b) => a.y - b.y || a.x - b.x);
  const issues: FlowIssue[] = [];
  const isStop = (n: FlowNode) => STOPS.has(n.shape) || END_WORDS.test(n.text);

  // Not connected: only once the chart has any connectors (a list of shapes being drawn isn't a mistake).
  if (joined && flowNodes.length > 1) {
    for (const n of reading) {
      if (touched.has(n.id)) continue;
      issues.push({ kind: "unconnected", nodes: [n.id], edges: [], message: `${nameOf(n)} isn't connected to the rest of the flowchart.` });
    }
  }

  // Unreachable: from the starts (start shapes nothing leads into; otherwise every shape nothing leads into).
  const connected = reading.filter((n) => touched.has(n.id));
  if (joined) {
    const sources = connected.filter((n) => !inc.get(n.id)!.length);
    const starts = sources.filter((n) => n.shape === "terminator" || START_WORDS.test(n.text));
    const roots = starts.length ? starts : sources.length ? sources : connected.slice(0, 1);
    const seen = new Set<string>();
    const queue = roots.map((n) => n.id);
    for (const id of queue) seen.add(id);
    while (queue.length) {
      const id = queue.shift()!;
      for (const w of out.get(id) ?? []) {
        if (seen.has(w)) continue;
        seen.add(w);
        queue.push(w);
      }
    }
    // Shapes that can't be reached, grouped into the pieces they form (one issue per piece).
    const lost = connected.filter((n) => !seen.has(n.id));
    const lostSet = new Set(lost.map((n) => n.id));
    const done = new Set<string>();
    for (const n of lost) {
      if (done.has(n.id)) continue;
      const piece: string[] = [];
      const stack = [n.id];
      done.add(n.id);
      while (stack.length) {
        const id = stack.pop()!;
        piece.push(id);
        for (const w of [...(out.get(id) ?? []), ...(inc.get(id) ?? [])]) {
          if (!lostSet.has(w) || done.has(w)) continue;
          done.add(w);
          stack.push(w);
        }
      }
      const ordered = connected.filter((x) => piece.includes(x.id)).map((x) => x.id);
      const first = flow.get(ordered[0]!)!;
      issues.push({
        kind: "unreachable",
        nodes: ordered,
        edges: [],
        message: ordered.length === 1 ? `Nothing leads to ${nameOf(first, "a shape")}, so the flow never reaches it.` : `Nothing leads to ${nameOf(first, "a group of shapes")} and the ${ordered.length - 1} shape${ordered.length === 2 ? "" : "s"} after it.`,
      });
    }
  }

  // Dead ends: a step something leads to, with no way out, that isn't an end.
  for (const n of connected) {
    if (out.get(n.id)!.length || !inc.get(n.id)!.length || isStop(n)) continue;
    if (fc.edges.some((e) => e.from === n.id && !e.to)) continue;
    issues.push({ kind: "deadEnd", nodes: [n.id], edges: [], message: `${nameOf(n)} is a dead end: nothing comes after it. Connect it to the next step, or make it an end.` });
  }

  // Loops with no way out: a cycle no connector leaves, with no end inside it.
  for (const comp of components(connected.map((n) => n.id), out)) {
    const set = new Set(comp);
    const cyclic = comp.length > 1 || (out.get(comp[0]!) ?? []).includes(comp[0]!);
    if (!cyclic) continue;
    const leaves = comp.some((id) => (out.get(id) ?? []).some((w) => !set.has(w)));
    if (leaves || comp.some((id) => isStop(flow.get(id)!))) continue;
    const ordered = connected.filter((x) => set.has(x.id)).map((x) => x.id);
    const edges = fc.edges.filter((e) => set.has(e.from) && set.has(e.to)).map((e) => e.id);
    issues.push({ kind: "loopNoExit", nodes: ordered, edges, message: `The loop through ${nameOf(flow.get(ordered[0]!)!, "these shapes")} has no way out. Add a decision that leaves it.` });
  }

  // Decisions: every way out labelled, and more than one way out.
  for (const n of connected) {
    if (!DECISIONS.has(n.shape)) continue;
    const ways = outEdges.get(n.id)!;
    const named = n.text.trim() ? ` ${nameOf(n)}` : "";
    if (ways.length === 1) {
      issues.push({ kind: "oneWayDecision", nodes: [n.id], edges: ways.map((e) => e.id), message: `The decision${named} has only one way out. Add the other answer.` });
      continue;
    }
    const bare = ways.filter((e) => !e.labels.some((l) => l.text.trim()));
    if (ways.length > 1 && bare.length) {
      issues.push({
        kind: "unlabelledBranch",
        nodes: [n.id],
        edges: bare.map((e) => e.id),
        message: `${bare.length === 1 ? "A branch" : `${bare.length} branches`} out of the decision${named} ${bare.length === 1 ? "has" : "have"} no label (such as Yes or No).`,
      });
    }
  }

  // Shapes with no words (images and icons speak for themselves; small symbols usually have none).
  for (const n of reading) {
    if (n.text.trim() || n.image || n.icon || WORDLESS.has(n.shape)) continue;
    issues.push({ kind: "noText", nodes: [n.id], edges: [], message: "A shape has no text. Say what happens at this step." });
  }

  return issues.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
}

export interface FlowLayoutStats {
  /** Places where two connectors cross. */
  crossings: number;
  /** Pairs of shapes lying on top of each other. */
  overlaps: number;
}

/** How readable the arrangement is: connector crossings and overlapping shapes. */
export function layoutStats(fc: FlowchartData): FlowLayoutStats {
  const crossings = fc.edges.length > 1 ? routeFlowchart(fc).crossings : 0;
  let overlaps = 0;
  const nodes = fc.nodes;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]!;
      // A few points of touching isn't an overlap.
      if (a.x + 4 < b.x + b.w && a.x + a.w > b.x + 4 && a.y + 4 < b.y + b.h && a.y + a.h > b.y + 4) overlaps++;
    }
  }
  return { crossings, overlaps };
}

/** Whether a laid-out chart is still hard to read: worth offering "Tidy up with Foli AI". */
export function layoutNeedsHelp(stats: FlowLayoutStats, edgeCount: number): boolean {
  return stats.overlaps > 0 || stats.crossings >= Math.max(3, Math.ceil(edgeCount * 0.15));
}
