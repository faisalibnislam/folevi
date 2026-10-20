// Flowchart layout: "Tidy up", alignment and distribution, smart guides, and where a quick-added shape goes.
//
// Tidy up is a layered (Sugiyama-style) layout, top-down or left to right:
//
//   1. frames are laid out from the inside out: each frame's members are laid out on their own, and the
//      frame then takes part in the level above as one box of that size (connectors to its members count
//      as connectors to the frame); swimlane pools lay out their members within their lanes;
//   2. connected components are laid out separately, side by side;
//   3. cycles are broken by reversing depth-first back edges (a loop back to an earlier step keeps its
//      direction when drawn); sources are pulled down next to what they feed;
//   4. layers come from the longest path; connectors spanning several layers get placeholder points, so
//      they keep a lane of their own and count in the crossing reduction;
//   5. the order within each layer comes from barycenter sweeps plus adjacent swaps, keeping the order with
//      the fewest crossings; a decision's "Yes" branch stays in line and its "No" branch goes to the side;
//   6. positions across the flow use the priority method (long connectors stay straight, a node sits over
//      the middle of what it connects to, branches balance), then layers are stacked with room for labels.
//
// With `keepPlacement` the current arrangement seeds every step (order within layers, which component
// goes first, where unconnected shapes sit), so a tidy keeps the shape a person gave the chart where it can.
import {
  FLOWCHART_FRAME_TITLE,
  FLOWCHART_GRID,
  FLOWCHART_LABEL_FONT_SIZE,
  FLOWCHART_LANE_HEADER_COLUMN,
  FLOWCHART_LANE_HEADER_ROW,
  FLOWCHART_LIMITS,
  FLOWCHART_POOL_TITLE,
  measureFlowText,
  poolRect,
  type FlowchartData,
  type FlowEdge,
  type FlowFrame,
  type FlowNode,
  type FlowPool,
} from "./flowchart";
import type { FlowSide, Pt, Rect } from "./flowchartShapes";

export type FlowDirection = "TD" | "LR";

export interface LayoutOptions {
  direction?: FlowDirection;
  /** Where the laid-out chart's top-left corner goes (default: where the chart's top-left was). */
  origin?: { x: number; y: number };
  /** Gap between shapes in a layer / between layers. */
  nodeGap?: number;
  layerGap?: number;
  /** Keep the current arrangement where it doesn't hurt (order, component placement). */
  keepPlacement?: boolean;
}

const snap = (n: number) => Math.round(n / FLOWCHART_GRID) * FLOWCHART_GRID;
const FRAME_PAD = 24;
const LANE_PAD = 28;
const DUMMY = 14;
const YES = /^(yes|y|true|ok|pass|valid|approved?)$/i;
const NO = /^(no|n|false|fail|invalid|rejected?)$/i;

interface Item {
  id: string;
  /** Size across the flow (width for TD) and along it (height for TD). */
  cross: number;
  main: number;
  /** Current centre (cross, main), for keeping the arrangement. */
  hint: { c: number; m: number };
  decision?: boolean;
  dummy?: boolean;
}

interface LEdge {
  from: string;
  to: string;
  /** Label width along the flow's cross direction (room needed between layers). */
  label: number;
  yes?: boolean;
  no?: boolean;
}

interface Placed {
  pos: Map<string, { c: number; m: number }>;
  width: number;
  height: number;
}

// ------------------------------------------------------------------------------------------ crossings

/** Crossings between two adjacent layers: inversions of the lower ends when sorted by the upper ends. */
function layerCrossings(pairs: [number, number][]): number {
  if (pairs.length < 2) return 0;
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const max = Math.max(...pairs.map((p) => p[1])) + 2;
  const tree = new Int32Array(max + 1);
  let count = 0;
  for (let i = pairs.length - 1; i >= 0; i--) {
    const v = pairs[i]![1] + 1;
    for (let j = v - 1; j > 0; j -= j & -j) count += tree[j]!;
    for (let j = v; j <= max; j += j & -j) tree[j]!++;
  }
  return count;
}

// ------------------------------------------------------------------------------------------ the core

interface CoreOpts {
  nodeGap: number;
  layerGap: number;
  keep: boolean;
  /** Lanes: each item's lane index and whether lanes run along the flow (parallel) or across it. */
  laneOf?: Map<string, number>;
  laneCount?: number;
  laneMode?: "parallel" | "perpendicular";
}

interface CoreResult extends Placed {
  /** Lane extents across the flow (parallel) or along it (perpendicular), when laid out with lanes. */
  lanes?: { start: number; size: number }[];
}

/** Lays out one group of items (a component, or a pool's members); positions are top-left in (cross, main). */
function layered(items: Item[], edges: LEdge[], o: CoreOpts): CoreResult {
  const ids = items.map((i) => i.id);
  const info = new Map(items.map((i) => [i.id, i]));
  const laneOf = (id: string) => o.laneOf?.get(id) ?? 0;
  const idSet = new Set(ids);
  const own = edges.filter((e) => idSet.has(e.from) && idSet.has(e.to) && e.from !== e.to);
  const order = o.keep ? [...ids].sort((a, b) => info.get(a)!.hint.m - info.get(b)!.hint.m || info.get(a)!.hint.c - info.get(b)!.hint.c) : ids;
  const out = new Map<string, LEdge[]>(ids.map((id) => [id, []]));
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const e of own) {
    out.get(e.from)!.push(e);
    indeg.set(e.to, indeg.get(e.to)! + 1);
  }

  // Break cycles: depth-first from the sources (then anything left), reversing edges that point back up.
  const state = new Map<string, 0 | 1 | 2>();
  const dag: LEdge[] = [];
  const visitOrder: string[] = [];
  for (const s of [...order.filter((id) => indeg.get(id) === 0), ...order]) {
    if (state.get(s)) continue;
    const stack: { v: string; i: number }[] = [{ v: s, i: 0 }];
    state.set(s, 1);
    visitOrder.push(s);
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const e = out.get(top.v)![top.i++];
      if (e === undefined) {
        state.set(top.v, 2);
        stack.pop();
        continue;
      }
      const st = state.get(e.to);
      // In perpendicular lanes an edge back to an earlier lane is a back edge too.
      const backLane = o.laneMode === "perpendicular" && laneOf(e.to) < laneOf(e.from);
      if (st === 1 || backLane) dag.push({ ...e, from: e.to, to: e.from, yes: false, no: false });
      else {
        dag.push(e);
        if (!st) {
          state.set(e.to, 1);
          visitOrder.push(e.to);
          stack.push({ v: e.to, i: 0 });
        }
      }
    }
  }

  // Layers: longest path (within each lane when lanes are stacked along the flow).
  const succ = new Map<string, string[]>(ids.map((id) => [id, []]));
  const pred = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of dag) {
    succ.get(e.from)!.push(e.to);
    pred.get(e.to)!.push(e.from);
  }
  const layerOf = new Map<string, number>();
  const longest = (subset: string[], intra: (a: string, b: string) => boolean) => {
    const deg = new Map(subset.map((id) => [id, 0]));
    for (const id of subset) for (const p of pred.get(id)!) if (deg.has(p) && intra(p, id)) deg.set(id, deg.get(id)! + 1);
    const queue = subset.filter((id) => deg.get(id) === 0);
    const local = new Map<string, number>(queue.map((id) => [id, 0]));
    for (let k = 0; k < queue.length; k++) {
      const v = queue[k]!;
      for (const w of succ.get(v)!) {
        if (!deg.has(w) || !intra(v, w)) continue;
        local.set(w, Math.max(local.get(w) ?? 0, local.get(v)! + 1));
        deg.set(w, deg.get(w)! - 1);
        if (deg.get(w) === 0) queue.push(w);
      }
    }
    for (const id of subset) if (!local.has(id)) local.set(id, 0);
    // Pull sources down next to what they feed (shorter connectors).
    for (const id of [...subset].reverse()) {
      if (pred.get(id)!.some((p) => deg.has(p) && intra(p, id))) continue;
      const s = succ.get(id)!.filter((w) => deg.has(w) && intra(id, w));
      if (s.length) local.set(id, Math.max(local.get(id)!, Math.min(...s.map((w) => local.get(w)!)) - 1));
    }
    return local;
  };
  const laneStart: number[] = [];
  if (o.laneMode === "perpendicular") {
    let at = 0;
    for (let k = 0; k < (o.laneCount ?? 1); k++) {
      const subset = ids.filter((id) => laneOf(id) === k);
      const local = longest(subset, (a, b) => laneOf(a) === laneOf(b));
      laneStart.push(at);
      for (const id of subset) layerOf.set(id, at + local.get(id)!);
      at += subset.length ? Math.max(...subset.map((id) => local.get(id)!)) + 1 : 1;
    }
    laneStart.push(at);
    // Edges inside the DAG must still point down: an edge to a node in a later lane is fine by construction.
  } else {
    const local = longest(ids, () => true);
    for (const id of ids) layerOf.set(id, local.get(id)!);
  }

  // Placeholders for connectors spanning several layers.
  const all = new Map(info);
  const up = new Map<string, string[]>(ids.map((id) => [id, []]));
  const down = new Map<string, string[]>(ids.map((id) => [id, []]));
  const link = (a: string, b: string) => {
    down.get(a)!.push(b);
    up.get(b)!.push(a);
  };
  let dummies = 0;
  const yesOf = new Map<string, string>();
  const noOf = new Map<string, string>();
  for (const e of dag) {
    let la = layerOf.get(e.from)!;
    const lb = layerOf.get(e.to)!;
    if (lb <= la) {
      // Same layer (only possible across lanes): no placeholder, no ordering influence.
      continue;
    }
    let prev = e.from;
    const span = lb - la;
    let step = 0;
    while (lb - la > 1) {
      la++;
      step++;
      const id = `\u0000d${dummies++}`;
      const mid = step === Math.ceil((span - 1) / 2);
      const lane = step < span / 2 ? laneOf(e.from) : laneOf(e.to);
      all.set(id, { id, cross: DUMMY + (mid ? e.label : 0), main: 0, hint: info.get(e.from)!.hint, dummy: true });
      layerOf.set(id, la);
      o.laneOf?.set(id, lane);
      up.set(id, []);
      down.set(id, []);
      link(prev, id);
      prev = id;
    }
    link(prev, e.to);
    if (e.yes && span === 1) yesOf.set(e.from, e.to);
    if (e.no && span === 1) noOf.set(e.from, e.to);
  }

  const layerCount = o.laneMode === "perpendicular" ? laneStart[laneStart.length - 1]! : Math.max(0, ...[...layerOf.values()]) + 1;
  const layers: string[][] = Array.from({ length: layerCount }, () => []);
  const seed = o.keep ? [...all.keys()].sort((a, b) => all.get(a)!.hint.c - all.get(b)!.hint.c) : [...visitOrder, ...[...all.keys()].filter((id) => all.get(id)!.dummy)];
  for (const id of seed) layers[layerOf.get(id)!]!.push(id);

  // Order within layers: barycenter sweeps and adjacent swaps; keep the best seen.
  const pos = new Map<string, number>();
  const index = () => layers.forEach((l) => l.forEach((id, i) => pos.set(id, i)));
  const byLane = (l: string[]) => (o.laneMode === "parallel" ? l.sort((a, b) => laneOf(a) - laneOf(b)) : l);
  layers.forEach(byLane);
  index();
  const decisionFix = () => {
    // "No" to the side of "Yes" (after it across the flow) under each decision.
    for (const [d, yes] of yesOf) {
      const no = noOf.get(d);
      if (!no || layerOf.get(no) !== layerOf.get(yes)) continue;
      const l = layers[layerOf.get(yes)!]!;
      const iy = l.indexOf(yes);
      const ino = l.indexOf(no);
      if (ino < iy && laneOf(yes) === laneOf(no)) {
        l[iy] = no;
        l[ino] = yes;
      }
    }
    index();
  };
  const crossings = () => {
    let total = 0;
    for (let li = 0; li < layers.length - 1; li++) {
      const pairs: [number, number][] = [];
      for (const id of layers[li]!) for (const w of down.get(id)!) pairs.push([pos.get(id)!, pos.get(w)!]);
      total += layerCrossings(pairs);
    }
    return total;
  };
  const pairCost = (a: string, b: string) => {
    // Crossings between a's and b's connectors with a placed before b.
    let c = 0;
    for (const nb of [up, down]) {
      const na = nb.get(a)!;
      const nbb = nb.get(b)!;
      for (const x of na) for (const y of nbb) if (pos.get(x)! > pos.get(y)!) c++;
    }
    return c;
  };
  decisionFix();
  let best = layers.map((l) => [...l]);
  let bestCount = crossings();
  let stale = 0;
  for (let iter = 0; iter < 24 && bestCount > 0 && stale < 6; iter++) {
    const downward = iter % 2 === 0;
    const range = downward ? layers.map((_, i) => i).slice(1) : layers.map((_, i) => i).slice(0, -1).reverse();
    for (const li of range) {
      const ref = downward ? up : down;
      const layer = layers[li]!;
      const bary = new Map<string, number>();
      for (const id of layer) {
        const ns = ref.get(id)!;
        bary.set(id, ns.length ? ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length : pos.get(id)!);
      }
      layer.sort((a, b) => (o.laneMode === "parallel" ? laneOf(a) - laneOf(b) : 0) || bary.get(a)! - bary.get(b)! || pos.get(a)! - pos.get(b)!);
      layer.forEach((id, i) => pos.set(id, i));
    }
    // Adjacent swaps that remove crossings.
    for (let pass = 0; pass < 4; pass++) {
      let swapped = false;
      for (const layer of layers) {
        for (let i = 0; i < layer.length - 1; i++) {
          const a = layer[i]!;
          const b = layer[i + 1]!;
          if (laneOf(a) !== laneOf(b) && o.laneMode === "parallel") continue;
          if (pairCost(b, a) < pairCost(a, b)) {
            layer[i] = b;
            layer[i + 1] = a;
            pos.set(a, i + 1);
            pos.set(b, i);
            swapped = true;
          }
        }
      }
      if (!swapped) break;
    }
    decisionFix();
    const count = crossings();
    if (count < bestCount) {
      bestCount = count;
      best = layers.map((l) => [...l]);
      stale = 0;
    } else stale++;
  }
  best.forEach((l, i) => (layers[i] = l));
  index();

  // Positions across the flow: the priority method, per lane when lanes run along the flow.
  const cross = new Map<string, number>();
  const placeLayers = (ls: string[][]) => {
    for (const l of ls) {
      let c = 0;
      for (const id of l) {
        cross.set(id, c);
        c += all.get(id)!.cross + o.nodeGap;
      }
    }
    const centre = (id: string) => cross.get(id)! + all.get(id)!.cross / 2;
    const sweep = (downward: boolean, final: boolean) => {
      const range = downward ? ls.map((_, i) => i).slice(1) : ls.map((_, i) => i).slice(0, -1).reverse();
      for (const li of range) {
        const layer = ls[li]!;
        if (!layer.length) continue;
        const ref = downward ? up : down;
        const inLayer = (n: string) => ls[downward ? li - 1 : li + 1]?.includes(n);
        const desired = new Map<string, number>();
        const priority = new Map<string, number>();
        for (const id of layer) {
          const it = all.get(id)!;
          let ns = ref.get(id)!.filter(inLayer);
          if (final) ns = [...up.get(id)!, ...down.get(id)!];
          // A decision's "Yes" child sits under it (and the decision over its "Yes" child).
          const aligned = downward ? [...yesOf].find(([, y]) => y === id)?.[0] : yesOf.get(id);
          let want = ns.length ? ns.reduce((s, n) => s + centre(n), 0) / ns.length : o.keep ? it.hint.c : centre(id);
          if (aligned && cross.has(aligned) && !final) want = centre(aligned);
          if (o.keep && ns.length) want = want * 0.85 + it.hint.c * 0.15;
          desired.set(id, want);
          priority.set(id, (it.dummy ? 1000 : 0) + (aligned ? 500 : 0) + ns.length);
        }
        const placed = new Array<boolean>(layer.length).fill(false);
        const w = layer.map((id) => all.get(id)!.cross);
        const at = layer.map((id) => cross.get(id)!);
        const orderIdx = layer.map((_, i) => i).sort((a, b) => priority.get(layer[b]!)! - priority.get(layer[a]!)! || a - b);
        for (const k of orderIdx) {
          let lo = -Infinity;
          let hi = Infinity;
          let acc = 0;
          for (let p = k - 1; p >= 0; p--) {
            if (placed[p]) {
              lo = at[p]! + w[p]! + o.nodeGap + acc;
              break;
            }
            acc += w[p]! + o.nodeGap;
          }
          acc = 0;
          for (let q = k + 1; q < layer.length; q++) {
            if (placed[q]) {
              hi = at[q]! - o.nodeGap - w[k]! - acc;
              break;
            }
            acc += w[q]! + o.nodeGap;
          }
          at[k] = Math.max(lo, Math.min(hi, desired.get(layer[k]!)! - w[k]! / 2));
          placed[k] = true;
          for (let j = k - 1; j >= 0 && !placed[j]; j--) at[j] = Math.min(at[j]!, at[j + 1]! - o.nodeGap - w[j]!);
          for (let j = k + 1; j < layer.length && !placed[j]; j++) at[j] = Math.max(at[j]!, at[j - 1]! + w[j - 1]! + o.nodeGap);
        }
        layer.forEach((id, i) => cross.set(id, at[i]!));
      }
    };
    for (let it = 0; it < 4; it++) sweep(it % 2 === 0, false);
    sweep(true, true);
    sweep(false, false);
    const ids2 = ls.flat();
    if (!ids2.length) return { min: 0, max: 0 };
    const min = Math.min(...ids2.map((id) => cross.get(id)!));
    for (const id of ids2) cross.set(id, cross.get(id)! - min);
    return { min: 0, max: Math.max(...ids2.map((id) => cross.get(id)! + all.get(id)!.cross)) };
  };

  let lanes: CoreResult["lanes"];
  if (o.laneMode === "parallel") {
    lanes = [];
    let offset = 0;
    for (let k = 0; k < (o.laneCount ?? 1); k++) {
      const ls = layers.map((l) => l.filter((id) => laneOf(id) === k));
      const { max } = placeLayers(ls);
      const size = Math.max(max, 0) + 2 * LANE_PAD;
      for (const id of ls.flat()) cross.set(id, cross.get(id)! + offset + LANE_PAD);
      lanes.push({ start: offset, size });
      offset += size;
    }
  } else placeLayers(layers);

  // Along the flow: each layer as deep as its deepest item, items centred in their band; the gap between
  // two layers is wide enough for the labels of the connectors crossing it.
  const gapAfter = new Array<number>(layerCount).fill(o.layerGap);
  for (const e of dag) {
    const la = layerOf.get(e.from)!;
    if (e.label) gapAfter[la] = Math.max(gapAfter[la]!, Math.min(o.layerGap * 2, e.label + 32));
  }
  const main = new Map<string, number>();
  let m = 0;
  const laneSpans: { start: number; size: number }[] = [];
  let laneK = 0;
  for (let li = 0; li < layerCount; li++) {
    if (o.laneMode === "perpendicular" && li === laneStart[laneK]) {
      if (laneK > 0) laneSpans[laneK - 1]!.size = m - laneSpans[laneK - 1]!.start + LANE_PAD - o.layerGap;
      m += laneK > 0 ? LANE_PAD * 2 - o.layerGap : LANE_PAD;
      laneSpans.push({ start: m - LANE_PAD, size: 0 });
      laneK++;
    }
    const layer = layers[li]!;
    const band = layer.length ? Math.max(...layer.map((id) => all.get(id)!.main)) : 0;
    for (const id of layer) main.set(id, m + (band - all.get(id)!.main) / 2);
    m += band + gapAfter[li]!;
  }
  if (o.laneMode === "perpendicular" && laneSpans.length) {
    // Close the last lane.
    const lastLane = laneSpans[laneSpans.length - 1]!;
    lastLane.size = m - o.layerGap + LANE_PAD - lastLane.start;
    lanes = laneSpans;
  }
  const result = new Map<string, { c: number; m: number }>();
  for (const id of ids) result.set(id, { c: cross.get(id)!, m: main.get(id)! });
  const width = lanes && o.laneMode === "parallel" ? lanes.reduce((s, l) => s + l.size, 0) : Math.max(0, ...ids.map((id) => cross.get(id)! + info.get(id)!.cross));
  return { pos: result, width, height: Math.max(0, m - o.layerGap), lanes };
}

// ------------------------------------------------------------------------------------------ groups

function components(ids: string[], edges: LEdge[]): string[][] {
  const adj = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const e of edges) {
    if (!adj.has(e.from) || !adj.has(e.to)) continue;
    adj.get(e.from)!.add(e.to);
    adj.get(e.to)!.add(e.from);
  }
  const seen = new Set<string>();
  const out: string[][] = [];
  const order = new Map(ids.map((x, i) => [x, i]));
  for (const id of ids) {
    if (seen.has(id)) continue;
    const comp: string[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const v = stack.pop()!;
      comp.push(v);
      for (const w of adj.get(v)!) if (!seen.has(w)) {
        seen.add(w);
        stack.push(w);
      }
    }
    out.push(comp.sort((a, b) => order.get(a)! - order.get(b)!));
  }
  return out;
}

/** Lays out a group's items component by component, side by side across the flow. */
function layoutItems(items: Item[], edges: LEdge[], o: CoreOpts): Placed {
  const info = new Map(items.map((i) => [i.id, i]));
  let comps = components(items.map((i) => i.id), edges);
  if (o.keep) {
    const cOf = (c: string[]) => Math.min(...c.map((id) => info.get(id)!.hint.c - info.get(id)!.cross / 2));
    comps = comps.sort((a, b) => cOf(a) - cOf(b));
  } else comps = comps.sort((a, b) => (b.length > 1 ? 1 : 0) - (a.length > 1 ? 1 : 0));
  const pos = new Map<string, { c: number; m: number }>();
  let offset = 0;
  let height = 0;
  for (const comp of comps) {
    const set = new Set(comp);
    const r = layered(
      comp.map((id) => info.get(id)!),
      edges.filter((e) => set.has(e.from) && set.has(e.to)),
      o,
    );
    for (const [id, p] of r.pos) pos.set(id, { c: p.c + offset, m: p.m });
    offset += r.width + o.nodeGap * 1.75;
    height = Math.max(height, r.height);
  }
  return { pos, width: Math.max(0, offset - o.nodeGap * 1.75), height };
}

/** Returns the chart with every shape (and frame, and lane) laid out, and every connector on automatic sides. */
export function layoutFlowchart(fc: FlowchartData, opts: LayoutOptions = {}): FlowchartData {
  const frames = fc.frames ?? [];
  const pools = fc.pools ?? [];
  if (!fc.nodes.length && !frames.length) return fc;
  const lr = opts.direction === "LR";
  const nodeGap = opts.nodeGap ?? (lr ? 40 : 56);
  const layerGap = opts.layerGap ?? (lr ? 72 : 64);
  const keep = !!opts.keepPlacement;
  const toCM = (r: Rect) => ({ c: lr ? r.y + r.h / 2 : r.x + r.w / 2, m: lr ? r.x + r.w / 2 : r.y + r.h / 2 });

  const frameById = new Map(frames.map((f) => [f.id, f]));
  const laneIds = new Map<string, { pool: FlowPool; index: number }>();
  for (const p of pools) p.lanes.forEach((l, index) => laneIds.set(l.id, { pool: p, index }));
  const nodeParent = new Map(fc.nodes.map((n) => [n.id, n.parent && (frameById.has(n.parent) || laneIds.has(n.parent)) ? n.parent : undefined]));
  const frameParent = new Map(frames.map((f) => [f.id, f.parent && (frameById.has(f.parent) || laneIds.has(f.parent)) ? f.parent : undefined]));
  const parent = (id: string) => (nodeParent.has(id) ? nodeParent.get(id) : frameParent.get(id));

  // The item of a group a node belongs to (the node itself, or the frame of the group that holds it).
  const repIn = (nodeId: string, group: string | undefined, groupMembers: Set<string>): string | null => {
    let cur: string | undefined = nodeId;
    for (let guard = 0; cur !== undefined && guard < 64; guard++) {
      if (groupMembers.has(cur)) return cur;
      cur = parent(cur);
      if (cur === group) return null;
    }
    return null;
  };
  const labelWidth = (e: FlowEdge) => (e.labels.length ? Math.min(200, Math.max(...e.labels.map((l) => measureFlowText(l.text, FLOWCHART_LABEL_FONT_SIZE)))) + 12 : 0);
  const decisionShapes = new Set(["decision", "diamond", "sort"]);
  const edgesFor = (members: Set<string>, group: string | undefined): LEdge[] => {
    const list: LEdge[] = [];
    const seen = new Set<string>();
    for (const e of fc.edges) {
      if (!e.from || !e.to) continue;
      const a = repIn(e.from, group, members);
      const b = repIn(e.to, group, members);
      if (!a || !b || a === b) continue;
      const k = `${a}>${b}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const label = e.labels[0]?.text.trim() ?? "";
      const direct = a === e.from && b === e.to && decisionShapes.has(fc.nodes.find((n) => n.id === a)?.shape ?? "");
      list.push({ from: a, to: b, label: lr ? 20 : labelWidth(e), yes: direct && YES.test(label), no: direct && NO.test(label) });
    }
    return list;
  };

  // Frames from the inside out: each frame's size and its members' places relative to it.
  const rel = new Map<string, { x: number; y: number }>();
  const frameSize = new Map<string, { w: number; h: number }>();
  const sizeOf = (id: string): { w: number; h: number } => {
    const fs = frameSize.get(id);
    if (fs) return fs;
    const n = fc.nodes.find((x) => x.id === id);
    if (n) return { w: n.w, h: n.h };
    const f = frameById.get(id)!;
    return { w: f.w, h: f.h };
  };
  const rectOf = (id: string): Rect => {
    const n = fc.nodes.find((x) => x.id === id);
    if (n) return n;
    const f = frameById.get(id)!;
    return f;
  };
  const itemOf = (id: string): Item => {
    const s = sizeOf(id);
    const hint = toCM(rectOf(id));
    const n = fc.nodes.find((x) => x.id === id);
    return { id, cross: lr ? s.h : s.w, main: lr ? s.w : s.h, hint, decision: !!n && decisionShapes.has(n.shape) };
  };
  const membersOf = (group: string | undefined) => [...fc.nodes.filter((n) => nodeParent.get(n.id) === group).map((n) => n.id), ...frames.filter((f) => frameParent.get(f.id) === group).map((f) => f.id)];
  const depth = (f: FlowFrame): number => {
    let d = 0;
    for (let cur = frameParent.get(f.id); cur && frameById.has(cur) && d < 16; cur = frameParent.get(cur)) d++;
    return d;
  };
  const core: CoreOpts = { nodeGap, layerGap, keep };
  for (const f of [...frames].sort((a, b) => depth(b) - depth(a))) {
    const members = membersOf(f.id);
    const title = f.title ? FLOWCHART_FRAME_TITLE : 12;
    if (!members.length) {
      frameSize.set(f.id, { w: f.w, h: f.h });
      continue;
    }
    const set = new Set(members);
    const placed = layoutItems(members.map(itemOf), edgesFor(set, f.id), core);
    const cw = lr ? placed.height : placed.width;
    const ch = lr ? placed.width : placed.height;
    frameSize.set(f.id, { w: Math.max(120, snap(cw + 2 * FRAME_PAD)), h: Math.max(80, snap(ch + 2 * FRAME_PAD + title)) });
    for (const [id, p] of placed.pos) rel.set(id, { x: FRAME_PAD + (lr ? p.m : p.c), y: title + FRAME_PAD + (lr ? p.c : p.m) });
  }

  // Top level: free items, then each pool's members within its lanes.
  const abs = new Map<string, { x: number; y: number }>();
  const freeMembers = membersOf(undefined);
  const free = fc.nodes.filter((n) => !nodeParent.get(n.id)).concat([]) as Rect[];
  const freeFrames = frames.filter((f) => !frameParent.get(f.id));
  const origin =
    opts.origin ??
    (() => {
      const rs = [...free, ...freeFrames];
      if (!rs.length) return { x: 0, y: 0 };
      return { x: Math.min(...rs.map((r) => r.x)), y: Math.min(...rs.map((r) => r.y)) };
    })();
  const outPools: FlowPool[] = pools.map((p) => ({ ...p, lanes: p.lanes.map((l) => ({ ...l })) }));
  const poolRects: Rect[] = [];
  outPools.forEach((pool) => {
    const laneIndex = new Map(pool.lanes.map((l, i) => [l.id, i]));
    const members = [...fc.nodes.filter((n) => laneIndex.has(nodeParent.get(n.id) ?? "")).map((n) => n.id), ...frames.filter((f) => laneIndex.has(frameParent.get(f.id) ?? "")).map((f) => f.id)];
    const laneOf = new Map(members.map((id) => [id, laneIndex.get(parent(id)!)!]));
    const parallel = (pool.orient === "rows") === lr;
    const set = new Set(members);
    // Every lane-scoped parent counts as the pool's group for lifting connectors.
    const liftEdges: LEdge[] = [];
    for (const lane of pool.lanes) for (const e of edgesFor(set, lane.id)) if (!liftEdges.some((x) => x.from === e.from && x.to === e.to)) liftEdges.push(e);
    const r = members.length
      ? layered(members.map(itemOf), liftEdges, { ...core, laneOf, laneCount: pool.lanes.length, laneMode: parallel ? "parallel" : "perpendicular" })
      : { pos: new Map(), width: 0, height: 0, lanes: pool.lanes.map((l, i) => ({ start: i * l.size, size: l.size })) };
    const lanes = r.lanes ?? [];
    // Lane sizes follow their content (lanes across the flow keep at least their header's room).
    pool.lanes.forEach((l, i) => {
      const needed = lanes[i]?.size ?? l.size;
      l.size = snap(Math.min(FLOWCHART_LIMITS.maxLaneSize, Math.max(FLOWCHART_LIMITS.minLaneSize, keep ? Math.max(l.size, needed) : needed)));
    });
    // Where each lane starts across the lanes, and the pool's length along them (header plus content).
    const laneStarts: number[] = [];
    let acc = 0;
    for (const l of pool.lanes) {
      laneStarts.push(acc);
      acc += l.size;
    }
    const content = (parallel ? r.height : r.width) + 2 * LANE_PAD;
    const header = pool.orient === "rows" ? FLOWCHART_LANE_HEADER_ROW : FLOWCHART_LANE_HEADER_COLUMN;
    pool.length = snap(Math.min(FLOWCHART_LIMITS.maxFrameSize, Math.max(keep ? pool.length : 0, header * 3, header + content)));
    for (const [id, p] of r.pos as Map<string, { c: number; m: number }>) {
      const k = laneOf.get(id)!;
      const raw = lanes[k]!;
      // Across the lanes: the place inside the lane band, recentred in the (snapped) lane. Along them: after
      // the lane headers.
      const inBand = (parallel ? p.c : p.m) - raw.start;
      const laneCoord = laneStarts[k]! + inBand + (pool.lanes[k]!.size - raw.size) / 2;
      const other = (parallel ? p.m : p.c) + LANE_PAD;
      if (pool.orient === "rows") abs.set(id, { x: pool.x + header + other, y: pool.y + FLOWCHART_POOL_TITLE + laneCoord });
      else abs.set(id, { x: pool.x + laneCoord, y: pool.y + FLOWCHART_POOL_TITLE + header + other });
    }
    poolRects.push(poolRect(pool));
  });

  if (freeMembers.length) {
    const set = new Set(freeMembers);
    const placed = layoutItems(freeMembers.map(itemOf), edgesFor(set, undefined), core);
    let ox = origin.x;
    let oy = origin.y;
    const box = { x: ox, y: oy, w: lr ? placed.height : placed.width, h: lr ? placed.width : placed.height };
    // Keep clear of the pools.
    for (let guard = 0; guard < poolRects.length + 1; guard++) {
      const hit = poolRects.find((r) => box.x < r.x + r.w + 40 && box.x + box.w + 40 > r.x && box.y < r.y + r.h + 40 && box.y + box.h + 40 > r.y);
      if (!hit) break;
      if (lr) box.y = oy = hit.y + hit.h + 80;
      else box.x = ox = hit.x + hit.w + 80;
    }
    for (const [id, p] of placed.pos) abs.set(id, { x: ox + (lr ? p.m : p.c), y: oy + (lr ? p.c : p.m) });
  }

  // Members of frames: relative to their frame, frames placed first (outermost first).
  const resolve = (id: string, guard = 0): { x: number; y: number } | null => {
    const a = abs.get(id);
    if (a) return a;
    const r = rel.get(id);
    const p = parent(id);
    if (!r || !p || !frameById.has(p) || guard > 32) return null;
    const pa = resolve(p, guard + 1);
    if (!pa) return null;
    const out = { x: pa.x + r.x, y: pa.y + r.y };
    abs.set(id, out);
    return out;
  };
  const nodes: FlowNode[] = fc.nodes.map((n) => {
    const p = resolve(n.id);
    return p ? { ...n, x: snap(p.x), y: snap(p.y) } : n;
  });
  const framesOut: FlowFrame[] = frames.map((f) => {
    const p = resolve(f.id);
    const s = frameSize.get(f.id) ?? { w: f.w, h: f.h };
    return p ? { ...f, x: snap(p.x), y: snap(p.y), w: s.w, h: s.h } : { ...f, ...s };
  });
  const moved = new Set(nodes.filter((n, i) => n !== fc.nodes[i]).map((n) => n.id));
  const edgesOut = fc.edges.map((e) => {
    if (!e.from || !e.to || (!moved.has(e.from) && !moved.has(e.to))) return e;
    const { fromSide: _f, toSide: _t, fromAt: _fa, toAt: _ta, ...rest } = e;
    return { ...rest, bends: [] };
  });
  return { v: 2, nodes, edges: edgesOut, frames: framesOut, pools: outPools };
}

// ------------------------------------------------------------------------------------------ align, distribute

export type FlowAlign = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** Lines the chosen shapes up on one edge or centre of their combined box. */
export function alignNodes(fc: FlowchartData, ids: readonly string[], how: FlowAlign): FlowchartData {
  const set = new Set(ids);
  const sel = fc.nodes.filter((n) => set.has(n.id));
  if (sel.length < 2) return fc;
  const x0 = Math.min(...sel.map((n) => n.x));
  const y0 = Math.min(...sel.map((n) => n.y));
  const x1 = Math.max(...sel.map((n) => n.x + n.w));
  const y1 = Math.max(...sel.map((n) => n.y + n.h));
  const place = (n: FlowNode): FlowNode => {
    switch (how) {
      case "left":
        return { ...n, x: x0 };
      case "center":
        return { ...n, x: Math.round((x0 + x1) / 2 - n.w / 2) };
      case "right":
        return { ...n, x: x1 - n.w };
      case "top":
        return { ...n, y: y0 };
      case "middle":
        return { ...n, y: Math.round((y0 + y1) / 2 - n.h / 2) };
      case "bottom":
        return { ...n, y: y1 - n.h };
    }
  };
  return { ...fc, nodes: fc.nodes.map((n) => (set.has(n.id) ? place(n) : n)) };
}

/** Spaces the chosen shapes evenly between the first and the last (equal gaps). */
export function distributeNodes(fc: FlowchartData, ids: readonly string[], axis: "horizontal" | "vertical"): FlowchartData {
  const set = new Set(ids);
  const h = axis === "horizontal";
  const sel = fc.nodes.filter((n) => set.has(n.id)).sort((a, b) => (h ? a.x - b.x : a.y - b.y) || (a.id < b.id ? -1 : 1));
  if (sel.length < 3) return fc;
  const first = sel[0]!;
  const last = sel[sel.length - 1]!;
  const span = h ? last.x + last.w - first.x : last.y + last.h - first.y;
  const sizes = sel.reduce((s, n) => s + (h ? n.w : n.h), 0);
  const gap = (span - sizes) / (sel.length - 1);
  const at = new Map<string, number>();
  let cur = h ? first.x : first.y;
  for (const n of sel) {
    at.set(n.id, Math.round(cur));
    cur += (h ? n.w : n.h) + gap;
  }
  return { ...fc, nodes: fc.nodes.map((n) => (at.has(n.id) ? (h ? { ...n, x: at.get(n.id)! } : { ...n, y: at.get(n.id)! }) : n)) };
}

// ------------------------------------------------------------------------------------------ smart guides

export interface AlignGuide {
  kind: "align";
  axis: "x" | "y";
  /** The line's position, and the span it's drawn over. */
  at: number;
  from: number;
  to: number;
}
export interface GapGuide {
  kind: "gap";
  axis: "x" | "y";
  /** The equal gaps, each from…to along `axis`, drawn at `at` across it. */
  gaps: { from: number; to: number; at: number }[];
}
export type SmartGuide = AlignGuide | GapGuide;

/**
 * Snaps a moving box (a shape or a selection) while it's dragged: to other shapes' edges and centres, and
 * to equal spacing with its neighbours in the same row or column, when within `threshold`; otherwise to the
 * grid (pass `grid: 0` for none). Returns the correction to apply and the guides to draw.
 */
export function smartGuides(moving: Rect, others: readonly Rect[], threshold: number, opts: { grid?: number } = {}): { dx: number; dy: number; guides: SmartGuide[] } {
  const grid = opts.grid ?? FLOWCHART_GRID;
  const guides: SmartGuide[] = [];
  const pick = (axis: "x" | "y"): number => {
    const pos = axis === "x" ? moving.x : moving.y;
    const size = axis === "x" ? moving.w : moving.h;
    const lines = [pos, pos + size / 2, pos + size];
    let best: { d: number; at: number } | null = null;
    for (const o of others) {
      const op = axis === "x" ? o.x : o.y;
      const os = axis === "x" ? o.w : o.h;
      for (const target of [op, op + os / 2, op + os]) {
        for (const l of lines) {
          const d = target - l;
          if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d) - 0.01)) best = { d, at: target };
        }
      }
    }
    // Equal spacing with neighbours in the same row (for x) or column (for y).
    const crossLo = axis === "x" ? moving.y : moving.x;
    const crossHi = crossLo + (axis === "x" ? moving.h : moving.w);
    const row = others.filter((o) => {
      const lo = axis === "x" ? o.y : o.x;
      const hi = lo + (axis === "x" ? o.h : o.w);
      return lo < crossHi && hi > crossLo;
    });
    const start = (o: Rect) => (axis === "x" ? o.x : o.y);
    const end = (o: Rect) => start(o) + (axis === "x" ? o.w : o.h);
    const before = row.filter((o) => end(o) <= pos + size / 2).sort((a, b) => end(b) - end(a));
    const after = row.filter((o) => start(o) >= pos + size / 2).sort((a, b) => start(a) - start(b));
    let gapBest: { d: number; gaps: { from: number; to: number }[] } | null = null;
    const consider = (d: number, gaps: { from: number; to: number }[]) => {
      if (Math.abs(d) <= threshold && (!gapBest || Math.abs(d) < Math.abs(gapBest.d))) gapBest = { d, gaps };
    };
    const L = before[0];
    const R = after[0];
    if (L && R) {
      // Centred between the two neighbours.
      const target = (end(L) + start(R) - size) / 2;
      const g = target - end(L);
      if (g > 0) consider(target - pos, [{ from: end(L), to: end(L) + g }, { from: target + size, to: start(R) }]);
    }
    if (L) {
      // The same gap as between the left neighbour and the one before it.
      const L2 = row.filter((o) => end(o) <= start(L)).sort((a, b) => end(b) - end(a))[0];
      if (L2) {
        const g = start(L) - end(L2);
        consider(end(L) + g - pos, [{ from: end(L2), to: start(L) }, { from: end(L), to: end(L) + g }]);
      }
    }
    if (R) {
      const R2 = row.filter((o) => start(o) >= end(R)).sort((a, b) => start(a) - start(b))[0];
      if (R2) {
        const g = start(R2) - end(R);
        consider(start(R) - g - size - pos, [{ from: start(R) - g, to: start(R) }, { from: end(R), to: start(R2) }]);
      }
    }
    const gb = gapBest as { d: number; gaps: { from: number; to: number }[] } | null;
    if (gb && (!best || Math.abs(gb.d) < Math.abs(best.d) - 0.01)) {
      const mid = (crossLo + crossHi) / 2;
      guides.push({ kind: "gap", axis, gaps: gb.gaps.map((g) => ({ ...g, at: mid })) });
      return gb.d;
    }
    if (!best) return grid ? Math.round(pos / grid) * grid - pos : 0;
    // One guide along the snapped line, over everything on it.
    const b = best;
    const movedPos = pos + b.d;
    const on = [moving, ...others].filter((o) => {
      const op = axis === "x" ? o.x : o.y;
      const os = axis === "x" ? o.w : o.h;
      const r = o === moving ? [movedPos, movedPos + size / 2, movedPos + size] : [op, op + os / 2, op + os];
      return r.some((v) => Math.abs(v - b.at) < 0.5);
    });
    const a0 = Math.min(...on.map((o) => (axis === "x" ? o.y : o.x)));
    const a1 = Math.max(...on.map((o) => (axis === "x" ? o.y + o.h : o.x + o.w)));
    guides.push({ kind: "align", axis, at: b.at, from: a0, to: a1 });
    return b.d;
  };
  const dx = pick("x");
  const dy = pick("y");
  return { dx, dy, guides };
}

// ------------------------------------------------------------------------------------------ quick add

const NORMAL: Record<FlowSide, Pt> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

/**
 * Where the next shape goes when it's added from `side` of a shape (the + arrows, Tab): one step out in
 * that direction, centred on the shape; beside the shape's existing children on that side when it has
 * some (so branches line up); never on top of another shape. Returns the new shape's top-left (snapped).
 */
export function quickAddPosition(fc: FlowchartData, sourceId: string, side: FlowSide, size: { w: number; h: number }, opts: { gap?: number; nodeGap?: number } = {}): { x: number; y: number } {
  const src = fc.nodes.find((n) => n.id === sourceId);
  if (!src) return { x: 0, y: 0 };
  const vertical = side === "top" || side === "bottom";
  const gap = opts.gap ?? (vertical ? 64 : 72);
  const nodeGap = opts.nodeGap ?? (vertical ? 56 : 40);
  const n = NORMAL[side];
  const byId = new Map(fc.nodes.map((x) => [x.id, x]));
  // Children already out on this side.
  const kids = fc.edges
    .filter((e) => e.from === sourceId && e.to && byId.has(e.to))
    .map((e) => byId.get(e.to)!)
    .filter((k) => {
      const kc = { x: k.x + k.w / 2, y: k.y + k.h / 2 };
      return side === "bottom" ? kc.y > src.y + src.h : side === "top" ? kc.y < src.y : side === "right" ? kc.x > src.x + src.w : kc.x < src.x;
    });
  let x: number;
  let y: number;
  let step: Pt;
  if (kids.length) {
    // Beside the outermost child, in the same row (or column).
    if (vertical) {
      const outer = kids.reduce((a, b) => (b.x + b.w > a.x + a.w ? b : a));
      x = outer.x + outer.w + nodeGap;
      y = outer.y + outer.h / 2 - size.h / 2;
      step = { x: size.w + nodeGap, y: 0 };
    } else {
      const outer = kids.reduce((a, b) => (b.y + b.h > a.y + a.h ? b : a));
      x = outer.x + outer.w / 2 - size.w / 2;
      y = outer.y + outer.h + nodeGap;
      step = { x: 0, y: size.h + nodeGap };
    }
  } else {
    x = src.x + src.w / 2 - size.w / 2 + n.x * (src.w / 2 + gap + size.w / 2);
    y = src.y + src.h / 2 - size.h / 2 + n.y * (src.h / 2 + gap + size.h / 2);
    step = vertical ? { x: size.w + nodeGap, y: 0 } : { x: 0, y: size.h + nodeGap };
  }
  const free = (px: number, py: number) => !fc.nodes.some((o) => o.id !== sourceId && px < o.x + o.w + 16 && px + size.w + 16 > o.x && py < o.y + o.h + 16 && py + size.h + 16 > o.y) && !(px < src.x + src.w && px + size.w > src.x && py < src.y + src.h && py + size.h > src.y);
  if (free(x, y)) return { x: snap(x), y: snap(y) };
  // Try alongside (alternating sides when starting straight out; onward beside children), then further out.
  for (let ring = 0; ring < 6; ring++) {
    const out = { x: n.x * ring * (size.w + gap), y: n.y * ring * (size.h + gap) };
    for (let k = 1; k <= 12; k++) {
      const signs = kids.length ? [1] : [1, -1];
      for (const s of signs) {
        const px = x + out.x + step.x * k * s;
        const py = y + out.y + step.y * k * s;
        if (free(px, py)) return { x: snap(px), y: snap(py) };
      }
    }
    if (ring > 0 && free(x + out.x, y + out.y)) return { x: snap(x + out.x), y: snap(y + out.y) };
  }
  return { x: snap(x), y: snap(y) };
}

/**
 * Where a sibling branch goes (Shift+Tab): beside `nodeId`, across the flow from the shape that leads to
 * it, clear of other shapes. Returns the position and that parent (null when the shape has none).
 */
export function quickAddSibling(fc: FlowchartData, nodeId: string, size: { w: number; h: number }, direction: FlowDirection = "TD"): { x: number; y: number; parent: string | null } {
  const node = fc.nodes.find((n) => n.id === nodeId);
  if (!node) return { x: 0, y: 0, parent: null };
  const parentEdge = fc.edges.find((e) => e.to === nodeId && e.from);
  if (parentEdge) {
    const p = fc.nodes.find((n) => n.id === parentEdge.from);
    if (p) {
      const side: FlowSide = direction === "LR" ? "right" : "bottom";
      return { ...quickAddPosition(fc, p.id, side, size), parent: p.id };
    }
  }
  const side: FlowSide = direction === "LR" ? "bottom" : "right";
  return { ...quickAddPosition(fc, nodeId, side, size, { gap: direction === "LR" ? 40 : 56 }), parent: null };
}

