// Flowchart containers as edits: frames (titled boxes that group shapes, and nest) and swimlane pools (titled
// lanes in rows or columns). Shared by the editor, Foli AI and local mode. Pure: inputs are never changed, and
// every result keeps the rules flowchartDataIssue checks (parents exist, frames nest at most
// FLOWCHART_LIMITS.maxFrameDepth deep, sizes stay in range).
//
//   Membership  a shape or frame belongs to the innermost frame or lane its centre is over (`boxAt`).
//               `settleContainers(before, next)` applies that to whatever an edit moved or added, grows
//               frames to hold what they contain, and keeps a lane's shapes inside it (growing the lane or the
//               pool when a shape doesn't fit). The editor runs it on every committed change.
//   Frames      addFrame, frameSelection, resizeFrame, removeFrame (keeping what's inside, or not)
//   Pools       addPool, addLane, removeLane, moveLane, resizeLane, resizePool, removePool
//   Moving      moveBoxes moves frames and pools with everything in them (and the bends of connectors whose
//               two ends both move)
//   Titles      renameBox, setBoxColor
import {
  FLOWCHART_FRAME_TITLE,
  FLOWCHART_GRID,
  FLOWCHART_LANE_HEADER_COLUMN,
  FLOWCHART_LANE_HEADER_ROW,
  FLOWCHART_LIMITS,
  FLOWCHART_POOL_TITLE,
  containerMembers,
  flowContainers,
  flowId,
  laneBoxes,
  poolRect,
  type FlowchartData,
  type FlowColor,
  type FlowFrame,
  type FlowLane,
  type FlowPool,
  type FlowPoolOrient,
} from "./flowchart";
import type { Rect } from "./flowchartShapes";

export type FlowBoxKind = "frame" | "pool" | "lane";

/** Room kept between a frame's edge and the shapes in it, and between a lane's edge and its shapes. */
export const FLOWCHART_FRAME_PAD = 16;
export const FLOWCHART_LANE_PAD = 12;
/** The smallest frame a person can resize to. */
export const FLOWCHART_MIN_FRAME = { w: 96, h: 64 } as const;

const G = FLOWCHART_GRID;
const L = FLOWCHART_LIMITS;
const snap = (n: number) => Math.round(n / G) * G;
const snapUp = (n: number) => Math.ceil(n / G) * G;
const snapDown = (n: number) => Math.floor(n / G) * G;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const coord = (n: number) => clamp(Math.round(n), -L.maxCoord, L.maxCoord);
const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const inside = (p: { x: number; y: number }, r: Rect) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h;
const headerOf = (orient: FlowPoolOrient) => (orient === "rows" ? FLOWCHART_LANE_HEADER_ROW : FLOWCHART_LANE_HEADER_COLUMN);

// ------------------------------------------------------------------------------------------ lookups

/** What kind of container an id names, or null. */
export function boxKind(fc: FlowchartData, id: string): FlowBoxKind | null {
  if ((fc.frames ?? []).some((f) => f.id === id)) return "frame";
  for (const p of fc.pools ?? []) {
    if (p.id === id) return "pool";
    if (p.lanes.some((l) => l.id === id)) return "lane";
  }
  return null;
}

/** The pool a lane is in, with the lane and its place. */
export function findLane(fc: FlowchartData, laneId: string): { pool: FlowPool; lane: FlowLane; index: number } | null {
  for (const pool of fc.pools ?? []) {
    const index = pool.lanes.findIndex((l) => l.id === laneId);
    if (index >= 0) return { pool, lane: pool.lanes[index]!, index };
  }
  return null;
}

/** A frame's, pool's or lane's whole box. */
export function boxRect(fc: FlowchartData, id: string): Rect | null {
  const f = (fc.frames ?? []).find((x) => x.id === id);
  if (f) return { x: f.x, y: f.y, w: f.w, h: f.h };
  const p = (fc.pools ?? []).find((x) => x.id === id);
  if (p) return poolRect(p);
  const lane = findLane(fc, id);
  return lane ? (laneBoxes(lane.pool)[lane.index]?.rect ?? null) : null;
}

/** Every shape and frame inside a frame, pool or lane, however deep. */
export function boxContents(fc: FlowchartData, id: string): { nodes: Set<string>; frames: Set<string> } {
  const pool = (fc.pools ?? []).find((p) => p.id === id);
  const roots = pool ? pool.lanes.map((l) => l.id) : [id];
  const nodes = new Set<string>();
  const frames = new Set<string>();
  for (const r of roots) {
    const m = containerMembers(fc, r);
    m.nodes.forEach((n) => nodes.add(n));
    m.frames.forEach((f) => frames.add(f));
  }
  return { nodes, frames };
}

/** The frames and lane a node or frame sits in, innermost first. */
export function ancestors(fc: FlowchartData, id: string): string[] {
  const frames = new Map((fc.frames ?? []).map((f) => [f.id, f]));
  const out: string[] = [];
  let cur = fc.nodes.find((n) => n.id === id)?.parent ?? frames.get(id)?.parent;
  for (let guard = 0; cur && guard < 64 && !out.includes(cur); guard++) {
    out.push(cur);
    cur = frames.get(cur)?.parent;
  }
  return out;
}

/** How many levels of frames a frame holds below itself (0 when none). */
function frameHeight(fc: FlowchartData, id: string, guard = 0): number {
  if (guard > L.maxFrameDepth + 2) return guard;
  let h = 0;
  for (const f of fc.frames ?? []) if (f.parent === id) h = Math.max(h, 1 + frameHeight(fc, f.id, guard + 1));
  return h;
}

/** Whether frame `id` (with what it holds) may go inside `target` without nesting too deep. */
export function canNest(fc: FlowchartData, id: string, target: string | null | undefined): boolean {
  if (!target) return frameHeight(fc, id) <= L.maxFrameDepth;
  if (target === id || ancestors(fc, target).includes(id)) return false;
  return 1 + ancestors(fc, target).length + frameHeight(fc, id) <= L.maxFrameDepth;
}

/**
 * The innermost frame or lane over the centre of `r` (where a dropped shape or frame belongs), or null.
 * `exclude` skips a frame and everything in it (a frame can't go inside itself).
 */
export function boxAt(fc: FlowchartData, r: Rect, exclude?: string): string | null {
  const c = centre(r);
  const skip = new Set<string>();
  if (exclude) {
    skip.add(exclude);
    containerMembers(fc, exclude).frames.forEach((f) => skip.add(f));
  }
  let best: { id: string; depth: number; area: number } | null = null;
  for (const box of flowContainers(fc).values()) {
    if (skip.has(box.id) || !inside(c, box.rect)) continue;
    const area = box.rect.w * box.rect.h;
    if (!best || box.depth > best.depth || (box.depth === best.depth && area < best.area)) best = { id: box.id, depth: box.depth, area };
  }
  return best?.id ?? null;
}

// ------------------------------------------------------------------------------------------ low-level edits

/** Moves the given shapes, frames and pools by (dx, dy); connector bends follow when both ends move. */
function translate(fc: FlowchartData, nodes: ReadonlySet<string>, frames: ReadonlySet<string>, pools: ReadonlySet<string>, dx: number, dy: number): FlowchartData {
  if ((!dx && !dy) || (!nodes.size && !frames.size && !pools.size)) return fc;
  return {
    ...fc,
    nodes: nodes.size ? fc.nodes.map((n) => (nodes.has(n.id) ? { ...n, x: coord(n.x + dx), y: coord(n.y + dy) } : n)) : fc.nodes,
    frames: frames.size ? (fc.frames ?? []).map((f) => (frames.has(f.id) ? { ...f, x: coord(f.x + dx), y: coord(f.y + dy) } : f)) : (fc.frames ?? []),
    pools: pools.size ? (fc.pools ?? []).map((p) => (pools.has(p.id) ? { ...p, x: coord(p.x + dx), y: coord(p.y + dy) } : p)) : (fc.pools ?? []),
    edges:
      nodes.size && fc.edges.some((e) => e.bends.length)
        ? fc.edges.map((e) => (e.bends.length && nodes.has(e.from) && nodes.has(e.to) ? { ...e, bends: e.bends.map((p) => ({ x: coord(p.x + dx), y: coord(p.y + dy) })) } : e))
        : fc.edges,
  };
}

/** Moves one shape, or one frame with everything in it. */
function translateItem(fc: FlowchartData, id: string, dx: number, dy: number): FlowchartData {
  if (fc.nodes.some((n) => n.id === id)) return translate(fc, new Set([id]), new Set(), new Set(), dx, dy);
  const m = containerMembers(fc, id);
  return translate(fc, new Set(m.nodes), new Set([id, ...m.frames]), new Set(), dx, dy);
}

/** Moves everything inside the given containers (not the containers themselves). */
function translateContents(fc: FlowchartData, ids: readonly string[], dx: number, dy: number): FlowchartData {
  const nodes = new Set<string>();
  const frames = new Set<string>();
  for (const id of ids) {
    const m = boxContents(fc, id);
    m.nodes.forEach((n) => nodes.add(n));
    m.frames.forEach((f) => frames.add(f));
  }
  return translate(fc, nodes, frames, new Set(), dx, dy);
}

/** Removes shapes and frames, and the connectors attached to those shapes. */
function removeItems(fc: FlowchartData, nodes: ReadonlySet<string>, frames: ReadonlySet<string>): FlowchartData {
  if (!nodes.size && !frames.size) return fc;
  return {
    ...fc,
    nodes: fc.nodes.filter((n) => !nodes.has(n.id)),
    frames: (fc.frames ?? []).filter((f) => !frames.has(f.id)),
    edges: fc.edges.filter((e) => !nodes.has(e.from) && !nodes.has(e.to)),
  };
}

function setParent(fc: FlowchartData, id: string, parent: string | null | undefined): FlowchartData {
  const apply = <T extends { id: string; parent?: string }>(x: T): T => {
    if (x.id !== id || (x.parent ?? null) === (parent ?? null)) return x;
    const { parent: _old, ...rest } = x;
    return (parent ? { ...rest, parent } : rest) as T;
  };
  if (fc.nodes.some((n) => n.id === id)) return { ...fc, nodes: fc.nodes.map(apply) };
  return { ...fc, frames: (fc.frames ?? []).map(apply) };
}

function itemRect(fc: FlowchartData, id: string): Rect | null {
  const n = fc.nodes.find((x) => x.id === id);
  if (n) return n;
  const f = (fc.frames ?? []).find((x) => x.id === id);
  return f ?? null;
}

function parentOf(fc: FlowchartData, id: string): string | undefined {
  return fc.nodes.find((n) => n.id === id)?.parent ?? (fc.frames ?? []).find((f) => f.id === id)?.parent;
}

/** The shapes and frames directly inside a container. */
function directMembers(fc: FlowchartData, id: string): string[] {
  return [...fc.nodes.filter((n) => n.parent === id).map((n) => n.id), ...(fc.frames ?? []).filter((f) => f.parent === id).map((f) => f.id)];
}

function updatePool(fc: FlowchartData, poolId: string, patch: (p: FlowPool) => FlowPool): FlowchartData {
  return { ...fc, pools: (fc.pools ?? []).map((p) => (p.id === poolId ? patch(p) : p)) };
}

/** Sets a lane's size; the lanes after it (and what's in them) move along. */
function setLaneSize(fc: FlowchartData, poolId: string, index: number, size: number): FlowchartData {
  const pool = (fc.pools ?? []).find((p) => p.id === poolId);
  const lane = pool?.lanes[index];
  if (!pool || !lane) return fc;
  const next = Math.round(clamp(size, L.minLaneSize, L.maxLaneSize));
  const d = next - lane.size;
  if (!d) return fc;
  const later = pool.lanes.slice(index + 1).map((l) => l.id);
  const moved = translateContents(fc, later, pool.orient === "rows" ? 0 : d, pool.orient === "rows" ? d : 0);
  return updatePool(moved, poolId, (p) => ({ ...p, lanes: p.lanes.map((l, i) => (i === index ? { ...l, size: next } : l)) }));
}

/**
 * Keeps a shape or frame inside its lane: the lane grows across (and the pool along) when it doesn't fit,
 * then the item is moved in from any edge it crosses.
 */
function fitInLane(fc: FlowchartData, laneId: string, itemId: string, growLength = true): FlowchartData {
  const found = findLane(fc, laneId);
  let r = itemRect(fc, itemId);
  if (!found || !r) return fc;
  const pad = FLOWCHART_LANE_PAD;
  const rows = found.pool.orient === "rows";
  // Across the lanes: the lane is at least as big as the item.
  const across = (rows ? r.h : r.w) + 2 * pad;
  if (found.lane.size < across) fc = setLaneSize(fc, found.pool.id, found.index, snapUp(across));
  r = itemRect(fc, itemId)!;
  // Along the lanes: the pool is long enough to hold it after the headers.
  let pool = (fc.pools ?? []).find((p) => p.id === found.pool.id)!;
  const header = headerOf(pool.orient);
  const start = rows ? pool.x : pool.y + FLOWCHART_POOL_TITLE;
  const at = rows ? r.x : r.y;
  const size = rows ? r.w : r.h;
  const need = Math.max(header + size + 2 * pad, Math.max(at, start + header + pad) + size + pad - start);
  if (growLength && pool.length < need) {
    fc = updatePool(fc, pool.id, (p) => ({ ...p, length: Math.min(L.maxFrameSize, snapUp(need)) }));
    pool = (fc.pools ?? []).find((p) => p.id === found.pool.id)!;
  }
  const box = laneBoxes(pool)[found.index]!.content;
  const x = clamp(r.x, box.x + pad, Math.max(box.x + pad, box.x + box.w - pad - r.w));
  const y = clamp(r.y, box.y + pad, Math.max(box.y + pad, box.y + box.h - pad - r.h));
  return translateItem(fc, itemId, Math.round(x - r.x), Math.round(y - r.y));
}

/** Grows a frame (never shrinks it) to hold its direct members with room around them. */
function growFrame(fc: FlowchartData, frameId: string): FlowchartData {
  const f = (fc.frames ?? []).find((x) => x.id === frameId);
  if (!f) return fc;
  const rects = directMembers(fc, frameId)
    .map((id) => itemRect(fc, id))
    .filter((r): r is Rect => !!r);
  if (!rects.length) return fc;
  const pad = FLOWCHART_FRAME_PAD;
  const top = f.title ? FLOWCHART_FRAME_TITLE : 12;
  const x0 = Math.min(f.x, snapDown(Math.min(...rects.map((r) => r.x)) - pad));
  const y0 = Math.min(f.y, snapDown(Math.min(...rects.map((r) => r.y)) - pad - top));
  const x1 = Math.max(f.x + f.w, snapUp(Math.max(...rects.map((r) => r.x + r.w)) + pad));
  const y1 = Math.max(f.y + f.h, snapUp(Math.max(...rects.map((r) => r.y + r.h)) + pad));
  if (x0 === f.x && y0 === f.y && x1 === f.x + f.w && y1 === f.y + f.h) return fc;
  const next: FlowFrame = { ...f, x: x0, y: y0, w: Math.min(L.maxFrameSize, x1 - x0), h: Math.min(L.maxFrameSize, y1 - y0) };
  return { ...fc, frames: (fc.frames ?? []).map((x) => (x.id === frameId ? next : x)) };
}

/** Parents that no longer exist, would loop, or nest too deep are forgotten (the server would refuse them). */
function dropBadParents(fc: FlowchartData): FlowchartData {
  const frames = fc.frames ?? [];
  const lanes = new Set((fc.pools ?? []).flatMap((p) => p.lanes.map((l) => l.id)));
  const frameIds = new Set(frames.map((f) => f.id));
  const exists = (id: string) => frameIds.has(id) || lanes.has(id);
  const byId = new Map(frames.map((f) => [f.id, f]));
  const frameOk = (f: FlowFrame) => {
    if (!f.parent) return true;
    if (!exists(f.parent) || f.parent === f.id) return false;
    let depth = 0;
    for (let cur: string | undefined = f.parent; cur; cur = byId.get(cur)?.parent) if (cur === f.id || ++depth > L.maxFrameDepth) return false;
    return true;
  };
  let changed = false;
  const strip = <T extends { parent?: string }>(x: T): T => {
    changed = true;
    const { parent: _p, ...rest } = x;
    return rest as T;
  };
  const nextFrames = frames.map((f) => (frameOk(f) ? f : strip(f)));
  const nextNodes = fc.nodes.map((n) => (n.parent && !exists(n.parent) ? strip(n) : n));
  return changed ? { ...fc, frames: nextFrames, nodes: nextNodes } : fc;
}

// ------------------------------------------------------------------------------------------ membership

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * Brings containers up to date after an edit (`before` → `next`): shapes and frames the edit added or moved
 * join the innermost frame or lane they were dropped over (or leave the one they were dragged out of), frames
 * grow to hold what's in them, and lanes keep their shapes inside (growing when needed). Shapes that moved
 * together with their own container keep their place in it. Returns `next` itself when nothing changes.
 *
 * `stepAcross` (moving with the keyboard): a shape pushed against its lane's edge, which would otherwise stay
 * put, steps into the next lane that way, so the keyboard can move shapes between lanes too.
 */
export function settleContainers(before: FlowchartData, next: FlowchartData, opts: { stepAcross?: boolean } = {}): FlowchartData {
  if (before === next) return next;
  let fc = dropBadParents(next);
  if (!(fc.frames ?? []).length && !(fc.pools ?? []).length) return fc;
  const bNodes = new Map(before.nodes.map((n) => [n.id, n]));
  const bFrames = new Map((before.frames ?? []).map((f) => [f.id, f]));
  const bBoxes = flowContainers(before);
  const nBoxes = flowContainers(fc);
  /** Moved by the same amount as the container it was in (the container itself was moved). */
  const rigid = (old: Rect, now: Rect, parent: string | undefined) => {
    if (!parent || old.w !== now.w || old.h !== now.h) return false;
    const a = bBoxes.get(parent)?.rect;
    const b = nBoxes.get(parent)?.rect;
    if (!a || !b) return false;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return (dx !== 0 || dy !== 0) && now.x - old.x === dx && now.y - old.y === dy;
  };

  // 1. What the edit placed: new or moved shapes and frames, which find their container again.
  const touched = new Set<string>();
  for (const n of fc.nodes) {
    const old = bNodes.get(n.id);
    if (old && (old.parent ?? null) !== (n.parent ?? null)) touched.add(n.id);
    if (old && (sameRect(old, n) || rigid(old, n, old.parent))) continue;
    touched.add(n.id);
    const target = boxAt(fc, n);
    if ((target ?? null) !== (n.parent ?? null)) fc = setParent(fc, n.id, target);
  }
  for (const f of fc.frames ?? []) {
    const old = bFrames.get(f.id);
    if (old && (old.parent ?? null) !== (f.parent ?? null)) touched.add(f.id);
    if (old && (sameRect(old, f) || rigid(old, f, old.parent))) continue;
    touched.add(f.id);
    // The innermost container over it that has room for another level (frames nest only so deep).
    let target = boxAt(fc, f, f.id);
    while (target && !canNest(fc, f.id, target)) target = (fc.frames ?? []).find((x) => x.id === target)?.parent ?? null;
    if ((target ?? null) !== (f.parent ?? null)) fc = setParent(fc, f.id, target);
  }
  if (!touched.size) return fc;

  // 2. Frames hold what's in them, innermost first (a frame that grows can make its own frame grow).
  const depth = (id: string) => ancestors(fc, id).length;
  for (const f of [...(fc.frames ?? [])].sort((a, b) => depth(b.id) - depth(a.id))) {
    if (!directMembers(fc, f.id).some((m) => touched.has(m))) continue;
    const grown = growFrame(fc, f.id);
    if (grown !== fc) {
      fc = grown;
      touched.add(f.id);
    }
  }

  // 3. Lanes keep their shapes inside.
  const stepped = new Set<string>();
  for (const poolId of (fc.pools ?? []).map((p) => p.id)) {
    const laneIds = (fc.pools ?? []).find((p) => p.id === poolId)!.lanes.map((l) => l.id);
    for (const laneId of laneIds) {
      for (const id of directMembers(fc, laneId)) {
        if (!touched.has(id) || stepped.has(id)) continue;
        const asked = itemRect(fc, id)!;
        const fitted = fitInLane(fc, laneId, id);
        const old = bNodes.get(id) ?? bFrames.get(id);
        if (opts.stepAcross && old && old.parent === laneId && sameRect(itemRect(fitted, id)!, old) && !sameRect(asked, old)) {
          const moved = stepLane(fc, laneId, id, asked.x - old.x, asked.y - old.y, old);
          if (moved) {
            fc = moved;
            stepped.add(id);
            continue;
          }
        }
        fc = fitted;
      }
    }
  }
  return fc;
}

/** Moves a shape or frame from its lane into the neighbouring lane in the direction (dx, dy), just inside it. */
function stepLane(fc: FlowchartData, laneId: string, id: string, dx: number, dy: number, from: Rect): FlowchartData | null {
  const found = findLane(fc, laneId);
  if (!found) return null;
  const rows = found.pool.orient === "rows";
  const d = Math.sign(rows ? dy : dx);
  const to = found.pool.lanes[found.index + d];
  if (!d || !to) return null;
  const box = laneBoxes(found.pool)[found.index + d]!.content;
  const pad = FLOWCHART_LANE_PAD;
  const r = itemRect(fc, id)!;
  const target = rows ? (d > 0 ? box.y + pad : box.y + box.h - pad - r.h) : d > 0 ? box.x + pad : box.x + box.w - pad - r.w;
  const doc = translateItem(fc, id, rows ? from.x - r.x : Math.round(target - r.x), rows ? Math.round(target - r.y) : from.y - r.y);
  return fitInLane(setParent(doc, id, to.id), to.id, id);
}

// ------------------------------------------------------------------------------------------ frames

/** Moves frames and pools by (dx, dy) from `fc`, with everything in them (and any extra shapes given). */
export function moveBoxes(fc: FlowchartData, ids: readonly string[], dx: number, dy: number, extraNodes: readonly string[] = []): FlowchartData {
  const nodes = new Set(extraNodes);
  const frames = new Set<string>();
  const pools = new Set<string>();
  for (const id of ids) {
    const kind = boxKind(fc, id);
    const poolId = kind === "lane" ? findLane(fc, id)!.pool.id : kind === "pool" ? id : null;
    if (poolId) pools.add(poolId);
    else if (kind === "frame") frames.add(id);
    else continue;
    const m = boxContents(fc, poolId ?? id);
    m.nodes.forEach((n) => nodes.add(n));
    m.frames.forEach((f) => frames.add(f));
  }
  return translate(fc, nodes, frames, pools, Math.round(dx), Math.round(dy));
}

/** A new empty frame centred on `at` (snapped), in whatever frame or lane is there. */
export function addFrame(fc: FlowchartData, at: { x: number; y: number }, opts: { w?: number; h?: number; title?: string; color?: FlowColor } = {}): { doc: FlowchartData; id: string } | null {
  if ((fc.frames ?? []).length >= L.maxFrames) return null;
  const w = snap(opts.w ?? 400);
  const h = snap(opts.h ?? 280);
  const frame: FlowFrame = { id: flowId("f"), x: coord(snap(at.x - w / 2)), y: coord(snap(at.y - h / 2)), w, h, title: opts.title ?? "Frame", color: opts.color ?? "neutral" };
  let doc: FlowchartData = { ...fc, frames: [...(fc.frames ?? []), frame] };
  const target = boxAt(doc, frame, frame.id);
  if (target && canNest(doc, frame.id, target)) doc = setParent(doc, frame.id, target);
  return { doc, id: frame.id };
}

/**
 * Puts a frame around shapes and frames (with room around them and a title band above), making them its
 * members. The new frame goes where they were: inside their common frame or lane, if they shared one.
 */
export function frameSelection(fc: FlowchartData, ids: readonly string[], opts: { title?: string; color?: FlowColor } = {}): { doc: FlowchartData; id: string } | null {
  if ((fc.frames ?? []).length >= L.maxFrames) return null;
  const wanted = new Set(ids.filter((id) => itemRect(fc, id)));
  // Things inside another chosen frame come along with it.
  const items = [...wanted].filter((id) => !ancestors(fc, id).some((a) => wanted.has(a)));
  if (!items.length) return null;
  const rects = items.map((id) => itemRect(fc, id)!);
  const parents = new Set(items.map((id) => parentOf(fc, id) ?? null));
  let parent = parents.size === 1 ? [...parents][0]! : null;
  const pad = FLOWCHART_FRAME_PAD + 8;
  const x0 = snapDown(Math.min(...rects.map((r) => r.x)) - pad);
  const y0 = snapDown(Math.min(...rects.map((r) => r.y)) - pad - FLOWCHART_FRAME_TITLE);
  const x1 = snapUp(Math.max(...rects.map((r) => r.x + r.w)) + pad);
  const y1 = snapUp(Math.max(...rects.map((r) => r.y + r.h)) + pad);
  const frame: FlowFrame = { id: flowId("f"), x: coord(x0), y: coord(y0), w: Math.min(L.maxFrameSize, x1 - x0), h: Math.min(L.maxFrameSize, y1 - y0), title: opts.title ?? "Frame", color: opts.color ?? "neutral" };
  // The new frame adds a level above the chosen frames.
  const tallest = Math.max(0, ...items.filter((id) => !fc.nodes.some((n) => n.id === id)).map((id) => 1 + frameHeight(fc, id)));
  const room = (p: string | null) => (p ? 1 + ancestors(fc, p).length : 0) + tallest <= L.maxFrameDepth;
  if (!room(parent)) parent = null;
  if (!room(null)) return null;
  let doc: FlowchartData = { ...fc, frames: [...(fc.frames ?? []), parent ? { ...frame, parent } : frame] };
  for (const id of items) doc = setParent(doc, id, frame.id);
  return { doc, id: frame.id };
}

/**
 * Resizes a frame to `rect` (snapped, kept to a sensible size). Members whose centre ends up outside leave it
 * for the frame or lane around it; shapes and frames beside it whose centre ends up inside join it.
 */
export function resizeFrame(fc: FlowchartData, id: string, rect: Rect): FlowchartData {
  const f = (fc.frames ?? []).find((x) => x.id === id);
  if (!f) return fc;
  const w = clamp(snap(rect.w), FLOWCHART_MIN_FRAME.w, L.maxFrameSize);
  const h = clamp(snap(rect.h), FLOWCHART_MIN_FRAME.h, L.maxFrameSize);
  const next: FlowFrame = { ...f, x: coord(snap(rect.x)), y: coord(snap(rect.y)), w, h };
  if (sameRect(next, f)) return fc;
  let doc: FlowchartData = { ...fc, frames: (fc.frames ?? []).map((x) => (x.id === id ? next : x)) };
  for (const m of directMembers(doc, id)) if (!inside(centre(itemRect(doc, m)!), next)) doc = setParent(doc, m, f.parent);
  const level = [...doc.nodes.filter((n) => (n.parent ?? null) === (f.parent ?? null)).map((n) => n.id), ...(doc.frames ?? []).filter((x) => x.id !== id && (x.parent ?? null) === (f.parent ?? null)).map((x) => x.id)];
  for (const m of level) {
    if (!inside(centre(itemRect(doc, m)!), next)) continue;
    const isFrame = !doc.nodes.some((n) => n.id === m);
    if (isFrame && !canNest(doc, m, id)) continue;
    doc = setParent(doc, m, id);
  }
  return doc;
}

/** Removes a frame. With `keep`, what was in it stays (in the frame or lane around it); otherwise it goes too. */
export function removeFrame(fc: FlowchartData, id: string, keep: boolean): FlowchartData {
  const f = (fc.frames ?? []).find((x) => x.id === id);
  if (!f) return fc;
  if (!keep) {
    const m = containerMembers(fc, id);
    return removeItems(fc, new Set(m.nodes), new Set([id, ...m.frames]));
  }
  let doc = fc;
  for (const m of directMembers(fc, id)) doc = setParent(doc, m, f.parent);
  return { ...doc, frames: (doc.frames ?? []).filter((x) => x.id !== id) };
}

// ------------------------------------------------------------------------------------------ pools

export const FLOWCHART_POOL_DEFAULTS = {
  rows: { laneSize: 160, length: 880 },
  columns: { laneSize: 240, length: 480 },
} as const;

/**
 * A new pool of `count` lanes (rows or columns) centred on `at`; when that spot is taken it goes below the
 * chart instead, so it never lands on top of shapes.
 */
export function addPool(fc: FlowchartData, at: { x: number; y: number }, orient: FlowPoolOrient = "rows", count = 3, opts: { title?: string } = {}): { doc: FlowchartData; id: string } | null {
  if ((fc.pools ?? []).length >= L.maxPools) return null;
  const n = clamp(Math.round(count), 1, L.maxLanes);
  const d = FLOWCHART_POOL_DEFAULTS[orient];
  const lanes: FlowLane[] = Array.from({ length: n }, (_, i) => ({ id: flowId("l"), title: `Lane ${i + 1}`, size: d.laneSize, color: "neutral" }));
  const pool: FlowPool = { id: flowId("p"), x: 0, y: 0, orient, title: opts.title ?? "Swimlanes", length: d.length, lanes };
  const r = poolRect(pool);
  pool.x = coord(snap(at.x - r.w / 2));
  pool.y = coord(snap(at.y - r.h / 2));
  const taken = [...fc.nodes, ...(fc.frames ?? []), ...(fc.pools ?? []).map(poolRect)];
  const box = poolRect(pool);
  const hits = (a: Rect) => taken.some((t) => a.x < t.x + t.w + 24 && a.x + a.w + 24 > t.x && a.y < t.y + t.h + 24 && a.y + a.h + 24 > t.y);
  if (hits(box)) {
    pool.x = coord(snap(Math.min(...taken.map((t) => t.x))));
    pool.y = coord(snap(Math.max(...taken.map((t) => t.y + t.h)) + 80));
  }
  return { doc: { ...fc, pools: [...(fc.pools ?? []), pool] }, id: pool.id };
}

/** Adds a lane at `index` (0 first; the end by default), as big as its neighbour; later lanes move along. */
export function addLane(fc: FlowchartData, poolId: string, index?: number, title?: string): { doc: FlowchartData; id: string } | null {
  const pool = (fc.pools ?? []).find((p) => p.id === poolId);
  if (!pool || pool.lanes.length >= L.maxLanes) return null;
  const at = clamp(index ?? pool.lanes.length, 0, pool.lanes.length);
  const size = pool.lanes[Math.min(at, pool.lanes.length - 1)]?.size ?? FLOWCHART_POOL_DEFAULTS[pool.orient].laneSize;
  const used = new Set(pool.lanes.map((l) => l.title));
  let k = pool.lanes.length + 1;
  while (used.has(`Lane ${k}`)) k++;
  const lane: FlowLane = { id: flowId("l"), title: title ?? `Lane ${k}`, size, color: "neutral" };
  const later = pool.lanes.slice(at).map((l) => l.id);
  const moved = translateContents(fc, later, pool.orient === "rows" ? 0 : size, pool.orient === "rows" ? size : 0);
  const doc = updatePool(moved, poolId, (p) => ({ ...p, lanes: [...p.lanes.slice(0, at), lane, ...p.lanes.slice(at)] }));
  return { doc, id: lane.id };
}

/**
 * Removes a lane (the last lane removes the pool). With `keep`, its shapes move into the lane before it (the
 * next one for the first lane), keeping their place along the pool; otherwise they go too.
 */
export function removeLane(fc: FlowchartData, laneId: string, keep: boolean): FlowchartData {
  const found = findLane(fc, laneId);
  if (!found) return fc;
  const { pool, index } = found;
  if (pool.lanes.length === 1) return removePool(fc, pool.id, keep);
  const rows = pool.orient === "rows";
  let doc = fc;
  const members = directMembers(fc, laneId);
  const targetIndex = index > 0 ? index - 1 : 1;
  const target = pool.lanes[targetIndex]!;
  if (keep) {
    const boxes = laneBoxes(pool);
    const from = boxes[index]!.rect;
    const to = boxes[targetIndex]!.rect;
    for (const m of members) {
      doc = translateItem(doc, m, rows ? 0 : to.x - from.x, rows ? to.y - from.y : 0);
      doc = setParent(doc, m, target.id);
    }
  } else {
    const m = containerMembers(fc, laneId);
    doc = removeItems(doc, new Set(m.nodes), new Set(m.frames));
  }
  // The lanes after it close the gap (members just moved into the next lane move with it).
  const size = found.lane.size;
  const later = pool.lanes.slice(index + 1).map((l) => l.id);
  doc = translateContents(doc, later, rows ? 0 : -size, rows ? -size : 0);
  doc = updatePool(doc, pool.id, (p) => ({ ...p, lanes: p.lanes.filter((l) => l.id !== laneId) }));
  if (keep) for (const m of members) doc = fitInLane(doc, target.id, m);
  return doc;
}

/** Swaps a lane with the one before (-1) or after (+1) it; what's in them moves with them. */
export function moveLane(fc: FlowchartData, laneId: string, dir: -1 | 1): FlowchartData {
  const found = findLane(fc, laneId);
  if (!found) return fc;
  const { pool, index } = found;
  const other = index + dir;
  if (other < 0 || other >= pool.lanes.length) return fc;
  const order = pool.lanes.slice();
  [order[index], order[other]] = [order[other]!, order[index]!];
  const startsBefore = new Map<string, number>();
  const startsAfter = new Map<string, number>();
  let acc = 0;
  for (const l of pool.lanes) {
    startsBefore.set(l.id, acc);
    acc += l.size;
  }
  acc = 0;
  for (const l of order) {
    startsAfter.set(l.id, acc);
    acc += l.size;
  }
  let doc = fc;
  // Each lane's contents move by how far its lane moved (computed before any of them moves).
  const shifts = [pool.lanes[index]!, pool.lanes[other]!].map((l) => ({ id: l.id, d: startsAfter.get(l.id)! - startsBefore.get(l.id)!, contents: boxContents(fc, l.id) }));
  for (const s of shifts) doc = translate(doc, s.contents.nodes, s.contents.frames, new Set(), pool.orient === "rows" ? 0 : s.d, pool.orient === "rows" ? s.d : 0);
  return updatePool(doc, pool.id, (p) => ({ ...p, lanes: order }));
}

/** The smallest size a lane can take while every shape in it still fits. */
export function minLaneSize(fc: FlowchartData, laneId: string): number {
  const found = findLane(fc, laneId);
  if (!found) return L.minLaneSize;
  const rows = found.pool.orient === "rows";
  const sizes = directMembers(fc, laneId).map((id) => {
    const r = itemRect(fc, id)!;
    return (rows ? r.h : r.w) + 2 * FLOWCHART_LANE_PAD;
  });
  return Math.max(L.minLaneSize, snapUp(Math.max(0, ...sizes)));
}

/** Resizes a lane (at least big enough for its shapes); its shapes move in to stay inside, later lanes move along. */
export function resizeLane(fc: FlowchartData, laneId: string, size: number): FlowchartData {
  const found = findLane(fc, laneId);
  if (!found) return fc;
  const next = Math.max(minLaneSize(fc, laneId), snap(size));
  let doc = setLaneSize(fc, found.pool.id, found.index, next);
  for (const m of directMembers(doc, laneId)) doc = fitInLane(doc, laneId, m);
  return doc;
}

/** The shortest a pool can be while every shape in it still fits after the headers. */
export function minPoolLength(fc: FlowchartData, poolId: string): number {
  const pool = (fc.pools ?? []).find((p) => p.id === poolId);
  if (!pool) return L.minLaneSize;
  const rows = pool.orient === "rows";
  const header = headerOf(pool.orient);
  const sizes = pool.lanes.flatMap((l) => directMembers(fc, l.id).map((id) => (rows ? itemRect(fc, id)!.w : itemRect(fc, id)!.h)));
  return Math.max(L.minLaneSize, header * 2, snapUp(header + 2 * FLOWCHART_LANE_PAD + Math.max(0, ...sizes)));
}

/** Sets a pool's length along its lanes (at least long enough for its shapes); shapes past the end move in. */
export function resizePool(fc: FlowchartData, poolId: string, length: number): FlowchartData {
  const pool = (fc.pools ?? []).find((p) => p.id === poolId);
  if (!pool) return fc;
  const next = clamp(Math.max(minPoolLength(fc, poolId), snap(length)), L.minLaneSize, L.maxFrameSize);
  if (next === pool.length) return fc;
  let doc = updatePool(fc, poolId, (p) => ({ ...p, length: next }));
  for (const lane of pool.lanes) for (const m of directMembers(doc, lane.id)) doc = fitInLane(doc, lane.id, m, false);
  return doc;
}

/** Removes a pool. With `keep`, its shapes and frames stay where they are, outside any lane. */
export function removePool(fc: FlowchartData, poolId: string, keep: boolean): FlowchartData {
  const pool = (fc.pools ?? []).find((p) => p.id === poolId);
  if (!pool) return fc;
  let doc = fc;
  if (keep) {
    for (const lane of pool.lanes) for (const m of directMembers(fc, lane.id)) doc = setParent(doc, m, null);
  } else {
    const m = boxContents(fc, poolId);
    doc = removeItems(doc, m.nodes, m.frames);
  }
  return { ...doc, pools: (doc.pools ?? []).filter((p) => p.id !== poolId) };
}

/** Removes frames, pools and lanes (see removeFrame, removePool, removeLane). */
export function removeBoxes(fc: FlowchartData, ids: readonly string[], keep: boolean): FlowchartData {
  let doc = fc;
  for (const id of ids) {
    const kind = boxKind(doc, id);
    if (kind === "frame") doc = removeFrame(doc, id, keep);
    else if (kind === "pool") doc = removePool(doc, id, keep);
    else if (kind === "lane") doc = removeLane(doc, id, keep);
  }
  return doc;
}

// ------------------------------------------------------------------------------------------ titles and colours

/** Sets a frame's, pool's or lane's title (one line, kept to the limit). */
export function renameBox(fc: FlowchartData, id: string, title: string): FlowchartData {
  const clean = title
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .slice(0, L.maxTitle)
    .trim();
  const kind = boxKind(fc, id);
  if (kind === "frame") return { ...fc, frames: (fc.frames ?? []).map((f) => (f.id === id && f.title !== clean ? { ...f, title: clean } : f)) };
  if (kind === "pool") return updatePool(fc, id, (p) => (p.title === clean ? p : { ...p, title: clean }));
  if (kind === "lane") {
    const { pool } = findLane(fc, id)!;
    return updatePool(fc, pool.id, (p) => ({ ...p, lanes: p.lanes.map((l) => (l.id === id && l.title !== clean ? { ...l, title: clean } : l)) }));
  }
  return fc;
}

/** Colours a frame or a lane (pools take their lanes' colours). */
export function setBoxColor(fc: FlowchartData, id: string, color: FlowColor): FlowchartData {
  const kind = boxKind(fc, id);
  if (kind === "frame") return { ...fc, frames: (fc.frames ?? []).map((f) => (f.id === id ? { ...f, color } : f)) };
  if (kind === "lane") {
    const { pool } = findLane(fc, id)!;
    return updatePool(fc, pool.id, (p) => ({ ...p, lanes: p.lanes.map((l) => (l.id === id ? { ...l, color } : l)) }));
  }
  if (kind === "pool") return updatePool(fc, id, (p) => ({ ...p, lanes: p.lanes.map((l) => ({ ...l, color })) }));
  return fc;
}
