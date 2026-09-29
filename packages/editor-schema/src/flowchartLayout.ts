// "Tidy up": a compact layered (Sugiyama-style) layout for flowcharts, top-down or left-to-right.
//
//   1. connected components are laid out separately, side by side;
//   2. cycles are broken by reversing DFS back edges (loops keep their direction when drawn);
//   3. layers come from the longest path from the sources;
//   4. node order within a layer is improved with a few barycenter sweeps (fewer crossings);
//   5. positions: layers stacked with a fixed gap, nodes pulled toward their neighbours' centres
//      without overlapping, everything snapped to the grid.
// Small and dependency-free; fine for the few hundred nodes a note's flowchart holds.
import { FLOWCHART_GRID, type FlowchartData, type FlowNode } from "./flowchart";

export type FlowDirection = "TD" | "LR";

export interface LayoutOptions {
  direction?: FlowDirection;
  /** Where the laid-out chart's top-left corner goes (default: where the chart's top-left was). */
  origin?: { x: number; y: number };
  /** Gap between nodes in a layer / between layers. */
  nodeGap?: number;
  layerGap?: number;
}

const snap = (n: number) => Math.round(n / FLOWCHART_GRID) * FLOWCHART_GRID;

interface Item {
  id: string;
  /** Size across the flow (width for TD) and along it (height for TD). */
  cross: number;
  main: number;
}

function components(ids: string[], adj: Map<string, Set<string>>): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const comp: string[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const v = stack.pop()!;
      comp.push(v);
      for (const w of adj.get(v) ?? []) {
        if (!seen.has(w)) {
          seen.add(w);
          stack.push(w);
        }
      }
    }
    const order = new Map(ids.map((x, i) => [x, i]));
    out.push(comp.sort((a, b) => order.get(a)! - order.get(b)!));
  }
  return out;
}

/** Lays out one connected component; returns positions relative to (0, 0) along cross/main axes. */
function layoutComponent(ids: string[], items: Map<string, Item>, edges: [string, string][], nodeGap: number, layerGap: number) {
  const idSet = new Set(ids);
  const own = edges.filter(([a, b]) => idSet.has(a) && idSet.has(b) && a !== b);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const [a, b] of own) {
    out.get(a)!.push(b);
    indeg.set(b, indeg.get(b)! + 1);
  }

  // Break cycles: DFS from sources (then anything left), reversing edges that point back up the stack.
  const state = new Map<string, 0 | 1 | 2>();
  const dag: [string, string][] = [];
  const visitOrder: string[] = [];
  const starts = [...ids.filter((id) => indeg.get(id) === 0), ...ids];
  for (const s of starts) {
    if (state.get(s)) continue;
    const stack: { v: string; i: number }[] = [{ v: s, i: 0 }];
    state.set(s, 1);
    visitOrder.push(s);
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const next = out.get(top.v)![top.i++];
      if (next === undefined) {
        state.set(top.v, 2);
        stack.pop();
        continue;
      }
      const st = state.get(next);
      if (st === 1) dag.push([next, top.v]);
      else {
        dag.push([top.v, next]);
        if (!st) {
          state.set(next, 1);
          visitOrder.push(next);
          stack.push({ v: next, i: 0 });
        }
      }
    }
  }

  // Longest-path layering over the DAG (Kahn's order).
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  const succs = new Map<string, string[]>(ids.map((id) => [id, []]));
  const deg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const [a, b] of dag) {
    succs.get(a)!.push(b);
    preds.get(b)!.push(a);
    deg.set(b, deg.get(b)! + 1);
  }
  const layerOf = new Map<string, number>();
  const queue = visitOrder.filter((id) => deg.get(id) === 0);
  for (const id of queue) layerOf.set(id, 0);
  while (queue.length) {
    const v = queue.shift()!;
    for (const w of succs.get(v)!) {
      layerOf.set(w, Math.max(layerOf.get(w) ?? 0, layerOf.get(v)! + 1));
      deg.set(w, deg.get(w)! - 1);
      if (deg.get(w) === 0) queue.push(w);
    }
  }
  for (const id of ids) if (!layerOf.has(id)) layerOf.set(id, 0);

  const layerCount = Math.max(...ids.map((id) => layerOf.get(id)!)) + 1;
  const layers: string[][] = Array.from({ length: layerCount }, () => []);
  for (const id of visitOrder) layers[layerOf.get(id)!]!.push(id);

  // Crossing reduction: barycenter sweeps down and up.
  const pos = new Map<string, number>();
  const index = () => layers.forEach((l) => l.forEach((id, i) => pos.set(id, i)));
  index();
  for (let iter = 0; iter < 8; iter++) {
    const down = iter % 2 === 0;
    const range = down ? layers.map((_, i) => i).slice(1) : layers.map((_, i) => i).slice(0, -1).reverse();
    for (const li of range) {
      const ref = down ? preds : succs;
      const layer = layers[li]!;
      const bary = new Map<string, number>();
      for (const id of layer) {
        const ns = ref.get(id)!.filter((n) => layerOf.get(n) === li + (down ? -1 : 1));
        bary.set(id, ns.length ? ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length : pos.get(id)!);
      }
      layer.sort((a, b) => bary.get(a)! - bary.get(b)! || pos.get(a)! - pos.get(b)!);
      layer.forEach((id, i) => pos.set(id, i));
    }
  }

  // Coordinates across the flow: pack, then pull toward neighbours' centres a few times.
  const cross = new Map<string, number>();
  for (const layer of layers) {
    let c = 0;
    for (const id of layer) {
      cross.set(id, c);
      c += items.get(id)!.cross + nodeGap;
    }
  }
  const centerOf = (id: string) => cross.get(id)! + items.get(id)!.cross / 2;
  const place = (layer: string[], desired: Map<string, number>) => {
    // Forward pass keeps the left order, backward pass keeps the right order; average both.
    const fwd: number[] = [];
    let edge = -Infinity;
    layer.forEach((id, i) => {
      const w = items.get(id)!.cross;
      fwd[i] = Math.max(desired.get(id)! - w / 2, edge);
      edge = fwd[i]! + w + nodeGap;
    });
    const bwd: number[] = [];
    edge = Infinity;
    for (let i = layer.length - 1; i >= 0; i--) {
      const w = items.get(layer[i]!)!.cross;
      bwd[i] = Math.min(desired.get(layer[i]!)! - w / 2, edge - w);
      edge = bwd[i]! - nodeGap;
    }
    edge = -Infinity;
    layer.forEach((id, i) => {
      const w = items.get(id)!.cross;
      const x = Math.max((fwd[i]! + bwd[i]!) / 2, edge);
      cross.set(id, x);
      edge = x + w + nodeGap;
    });
  };
  for (let iter = 0; iter < 6; iter++) {
    const down = iter % 2 === 0;
    const order = down ? layers : [...layers].reverse();
    for (const layer of order) {
      const desired = new Map<string, number>();
      for (const id of layer) {
        const ns = [...preds.get(id)!, ...succs.get(id)!];
        desired.set(id, ns.length ? ns.reduce((s, n) => s + centerOf(n), 0) / ns.length : centerOf(id));
      }
      place(layer, desired);
    }
  }

  // Along the flow: each layer as tall as its tallest node, nodes centred in their band.
  const main = new Map<string, number>();
  let m = 0;
  for (const layer of layers) {
    const band = Math.max(...layer.map((id) => items.get(id)!.main));
    for (const id of layer) main.set(id, m + (band - items.get(id)!.main) / 2);
    m += band + layerGap;
  }
  const minCross = Math.min(...ids.map((id) => cross.get(id)!));
  const width = Math.max(...ids.map((id) => cross.get(id)! + items.get(id)!.cross)) - minCross;
  const result = new Map<string, { c: number; m: number }>();
  for (const id of ids) result.set(id, { c: cross.get(id)! - minCross, m: main.get(id)! });
  return { result, width, height: m - layerGap };
}

/** Returns the chart with every node repositioned (sizes kept) and every connector on automatic sides. */
export function layoutFlowchart(fc: FlowchartData, opts: LayoutOptions = {}): FlowchartData {
  if (!fc.nodes.length) return fc;
  const lr = opts.direction === "LR";
  const nodeGap = opts.nodeGap ?? (lr ? 40 : 56);
  const layerGap = opts.layerGap ?? (lr ? 72 : 64);
  const items = new Map<string, Item>(fc.nodes.map((n) => [n.id, { id: n.id, cross: lr ? n.h : n.w, main: lr ? n.w : n.h }]));
  const ids = fc.nodes.map((n) => n.id);
  const known = new Set(ids);
  const edges: [string, string][] = fc.edges.filter((e) => known.has(e.from) && known.has(e.to)).map((e) => [e.from, e.to]);
  const adj = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const [a, b] of edges) {
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }
  // Components side by side across the flow, the biggest first; lone nodes gather at the end.
  const comps = components(ids, adj).sort((a, b) => (b.length > 1 ? 1 : 0) - (a.length > 1 ? 1 : 0));
  const placed = new Map<string, { c: number; m: number }>();
  let offset = 0;
  for (const comp of comps) {
    const { result, width } = layoutComponent(comp, items, edges, nodeGap, layerGap);
    for (const [id, p] of result) placed.set(id, { c: p.c + offset, m: p.m });
    offset += width + nodeGap * 1.75;
  }
  const origin = opts.origin ?? { x: Math.min(...fc.nodes.map((n) => n.x)), y: Math.min(...fc.nodes.map((n) => n.y)) };
  const nodes: FlowNode[] = fc.nodes.map((n) => {
    const p = placed.get(n.id)!;
    return { ...n, x: snap(origin.x + (lr ? p.m : p.c)), y: snap(origin.y + (lr ? p.c : p.m)) };
  });
  const edgesOut = fc.edges.map((e) => {
    const { fromSide: _f, toSide: _t, ...rest } = e;
    return rest;
  });
  return { v: 1, nodes, edges: edgesOut };
}
