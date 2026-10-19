// Edits to a mind map, as pure functions from one map to the next (the block's history keeps the old ones).
// A node's children are the nodes naming it as their parent, in the order they appear in `nodes`, so
// inserting a sibling is inserting into the list, and moving an idea moves it (with its branch) in the list.
import {
  MINDMAP_LIMITS,
  layoutMindmap,
  mindId,
  mindmapChildren,
  mindmapRoot,
  mindmapSides,
  type MindmapColor,
  type MindmapData,
  type MindmapLayout,
  type MindmapSide,
  type MindNode,
} from "@folevi/editor-schema";

export const byId = (map: MindmapData, id: string | null | undefined) => (id ? map.nodes.find((n) => n.id === id) : undefined);

/** An idea and everything under it (ids). */
export function branchIds(map: MindmapData, id: string): Set<string> {
  const kids = mindmapChildren(map);
  const out = new Set<string>([id]);
  const stack = [id];
  while (stack.length) {
    for (const c of kids.get(stack.pop()!) ?? []) {
      out.add(c.id);
      stack.push(c.id);
    }
  }
  return out;
}

/** Levels from the centre (0 for it). */
export function depthOf(map: MindmapData, id: string): number {
  let d = 0;
  let at = byId(map, id);
  while (at && at.parent !== null && d <= MINDMAP_LIMITS.maxDepth) {
    at = byId(map, at.parent);
    d++;
  }
  return d;
}

const full = (map: MindmapData) => map.nodes.length >= MINDMAP_LIMITS.maxNodes;

/** A brand-new map with only its central idea. */
export function startMap(text = "", layout: MindmapLayout = "both"): { map: MindmapData; id: string } {
  const id = mindId();
  return { map: { v: 1, layout, nodes: [{ id, parent: null, text }] }, id };
}

/** The side a new main branch takes in "both": the lighter one, so the map stays balanced as it grows. */
function lighterSide(map: MindmapData): MindmapSide {
  const l = layoutMindmap({ ...map, nodes: map.nodes.map((n) => (n.parent === null ? { ...n, collapsed: false } : n)) });
  let right = 0;
  let left = 0;
  for (const b of l.boxes) {
    if (b.depth === 0) continue;
    if (b.side === "left") left += b.h;
    else right += b.h;
  }
  return left < right ? "left" : "right";
}

/** Where a new idea goes in `nodes`: after `after`'s whole branch (so outlines read in order), or at the end. */
function insertAt(map: MindmapData, node: MindNode, after: string | null): MindNode[] {
  const nodes = [...map.nodes];
  if (!after) {
    nodes.push(node);
    return nodes;
  }
  const branch = branchIds(map, after);
  let i = nodes.findIndex((n) => n.id === after);
  while (i + 1 < nodes.length && branch.has(nodes[i + 1]!.id)) i++;
  nodes.splice(i + 1, 0, node);
  return nodes;
}

/** Adds an idea as the last child of `parent` (which opens if it was collapsed). */
export function addChild(map: MindmapData, parent: string, text = ""): { map: MindmapData; id: string } | null {
  const p = byId(map, parent);
  if (!p || full(map) || depthOf(map, parent) + 1 > MINDMAP_LIMITS.maxDepth) return null;
  const id = mindId();
  const node: MindNode = { id, parent, text };
  if (p.parent === null && map.layout === "both") node.side = lighterSide(map);
  const kids = mindmapChildren(map).get(parent) ?? [];
  const last = kids[kids.length - 1]?.id ?? parent;
  const nodes = insertAt(map, node, last).map((n) => (n.id === parent && n.collapsed ? withOptional(n, "collapsed", undefined) : n));
  return { map: { ...map, nodes }, id };
}

/** Adds an idea next to `id` (after it, or before), on the same side. The centre gets a child instead. */
export function addSibling(map: MindmapData, id: string, before = false, text = ""): { map: MindmapData; id: string } | null {
  const at = byId(map, id);
  if (!at) return null;
  if (at.parent === null) return addChild(map, id, text);
  if (full(map)) return null;
  const newId = mindId();
  const node: MindNode = { id: newId, parent: at.parent, text };
  if (at.side) node.side = at.side;
  let nodes: MindNode[];
  if (before) {
    nodes = [...map.nodes];
    nodes.splice(nodes.findIndex((n) => n.id === id), 0, node);
  } else nodes = insertAt(map, node, id);
  return { map: { ...map, nodes }, id: newId };
}

/** Removes ideas with their branches (never the centre). Returns the idea to select next. */
export function removeIdeas(map: MindmapData, ids: string[]): { map: MindmapData; select: string | null } {
  const root = mindmapRoot(map);
  const gone = new Set<string>();
  for (const id of ids) if (id !== root?.id) for (const x of branchIds(map, id)) gone.add(x);
  if (!gone.size) return { map, select: ids[0] ?? null };
  // Next: the sibling after the first removed idea, else the one before, else its parent.
  const first = byId(map, ids.find((x) => gone.has(x)));
  let select: string | null = root?.id ?? null;
  if (first?.parent) {
    const sibs = (mindmapChildren(map).get(first.parent) ?? []).filter((s) => !gone.has(s.id) || s.id === first.id);
    const i = sibs.findIndex((s) => s.id === first.id);
    select = sibs[i + 1]?.id ?? sibs[i - 1]?.id ?? first.parent;
  }
  return { map: { ...map, nodes: map.nodes.filter((n) => !gone.has(n.id)) }, select };
}

export const setText = (map: MindmapData, id: string, text: string): MindmapData => ({
  ...map,
  nodes: map.nodes.map((n) => (n.id === id ? { ...n, text: text.slice(0, MINDMAP_LIMITS.maxText) } : n)),
});

/** A colour for ideas (and, by inheritance, their branches); undefined goes back to automatic. */
export const setColor = (map: MindmapData, ids: string[], color: MindmapColor | undefined): MindmapData => ({
  ...map,
  nodes: map.nodes.map((n) => (ids.includes(n.id) ? withOptional(n, "color", color) : n)),
});

export function setCollapsed(map: MindmapData, id: string, collapsed: boolean): MindmapData {
  const n = byId(map, id);
  if (!n || n.parent === null || Boolean(n.collapsed) === collapsed) return map;
  return { ...map, nodes: map.nodes.map((x) => (x.id === id ? withOptional(x, "collapsed", collapsed || undefined) : x)) };
}

/** Collapses every idea that has children below the main branches' level (`depth`), or opens them all. */
export function setAllCollapsed(map: MindmapData, collapsed: boolean, depth = 1): MindmapData {
  const kids = mindmapChildren(map);
  const depths = new Map<string, number>();
  const root = mindmapRoot(map);
  if (!root) return map;
  const walk = (id: string, d: number) => {
    depths.set(id, d);
    for (const c of kids.get(id) ?? []) walk(c.id, d + 1);
  };
  walk(root.id, 0);
  let changed = false;
  const nodes = map.nodes.map((n) => {
    const want = collapsed && (depths.get(n.id) ?? 0) >= depth && (kids.get(n.id)?.length ?? 0) > 0;
    if (Boolean(n.collapsed) === want) return n;
    changed = true;
    return withOptional(n, "collapsed", want || undefined);
  });
  return changed ? { ...map, nodes } : map;
}

export const setLayout = (map: MindmapData, layout: MindmapLayout): MindmapData => (map.layout === layout ? map : { ...map, layout });

/** Moves `id` (with its branch) under `parent`, before `beforeId` (or last). Refuses loops. */
export function moveIdea(map: MindmapData, id: string, parent: string, beforeId: string | null = null, side?: MindmapSide): MindmapData {
  const node = byId(map, id);
  const target = byId(map, parent);
  if (!node || !target || node.parent === null) return map;
  const branch = branchIds(map, id);
  if (branch.has(parent) || (beforeId && branch.has(beforeId))) return map;
  if (depthOf(map, parent) + 1 + subtreeDepth(map, id) > MINDMAP_LIMITS.maxDepth) return map;
  const moving = map.nodes.filter((n) => branch.has(n.id));
  const rest = map.nodes.filter((n) => !branch.has(n.id));
  const head: MindNode = { ...moving[0]!, parent };
  // A main branch keeps a side (dropped on one); anywhere else, sides don't apply.
  if (target.parent === null) {
    if (side) head.side = side;
    else if (!head.side && map.layout === "both") head.side = lighterSide({ ...map, nodes: rest });
  } else delete head.side;
  const block = [head, ...moving.slice(1)];
  let at: number;
  if (beforeId) at = rest.findIndex((n) => n.id === beforeId);
  else {
    // After the target's last child's branch (or right after the target).
    const kids = rest.filter((n) => n.parent === parent);
    const last = kids[kids.length - 1];
    if (last) {
      const lastBranch = branchIds({ ...map, nodes: rest }, last.id);
      at = rest.findIndex((n) => n.id === last.id);
      while (at + 1 < rest.length && lastBranch.has(rest[at + 1]!.id)) at++;
      at++;
    } else at = rest.findIndex((n) => n.id === parent) + 1;
  }
  if (at < 0) at = rest.length;
  const nodes = [...rest.slice(0, at), ...block, ...rest.slice(at)];
  return { ...map, nodes: nodes.map((n) => (n.id === parent && n.collapsed ? withOptional(n, "collapsed", undefined) : n)) };
}

/** How many levels a branch has below its idea. */
function subtreeDepth(map: MindmapData, id: string): number {
  const kids = mindmapChildren(map);
  const walk = (x: string): number => Math.max(0, ...(kids.get(x) ?? []).map((c) => 1 + walk(c.id)));
  return walk(id);
}

/** Shift+Tab: the idea moves up a level, to just after its parent. Main branches stay where they are. */
export function outdent(map: MindmapData, id: string): MindmapData {
  const node = byId(map, id);
  const parent = byId(map, node?.parent);
  if (!node || !parent || parent.parent === null) return map;
  const grand = parent.parent;
  // Before the parent's next sibling, so it lands right after the parent's branch.
  const sibs = mindmapChildren(map).get(grand) ?? [];
  const next = sibs[sibs.findIndex((s) => s.id === parent.id) + 1]?.id ?? null;
  return moveIdea(map, id, grand, next, grand === mindmapRoot(map)?.id ? parent.side : undefined);
}

/** Outline Tab: the idea becomes the last child of the sibling before it. */
export function indent(map: MindmapData, id: string): MindmapData {
  const node = byId(map, id);
  if (!node?.parent) return map;
  const sibs = mindmapChildren(map).get(node.parent) ?? [];
  const prev = sibs[sibs.findIndex((s) => s.id === id) - 1];
  return prev ? moveIdea(map, id, prev.id) : map;
}

/** ⌥↑ / ⌥↓: swaps an idea with the sibling before or after it (on the same side, in "both"). */
export function reorder(map: MindmapData, id: string, dir: -1 | 1): MindmapData {
  const node = byId(map, id);
  if (!node?.parent) return map;
  let sibs = mindmapChildren(map).get(node.parent) ?? [];
  // Main branches in "both" swap with their neighbour on the same side, and both keep their sides.
  const main = map.layout === "both" && byId(map, node.parent)?.parent === null;
  const sides = main ? sidesOf(map) : new Map<string, MindmapSide>();
  if (main) sibs = sibs.filter((s) => sides.get(s.id) === sides.get(id));
  const i = sibs.findIndex((s) => s.id === id);
  const other = sibs[i + dir];
  if (!other) return map;
  // Every main branch keeps the side it's shown on, so the swap moves nothing else across.
  const pinned: MindmapData = main ? { ...map, nodes: map.nodes.map((n) => (sides.has(n.id) && n.side !== sides.get(n.id) ? { ...n, side: sides.get(n.id)! } : n)) } : map;
  // Down: the other idea moves before this one instead.
  return dir < 0 ? moveIdea(pinned, id, node.parent, other.id, sides.get(id)) : moveIdea(pinned, other.id, node.parent, id, sides.get(other.id));
}

/** Main branches' sides as the layout places them. */
export function sidesOf(map: MindmapData): Map<string, MindmapSide> {
  const l = layoutMindmap(map);
  const out = new Map<string, MindmapSide>();
  for (const b of l.boxes) if (b.depth === 1 && b.side !== "down") out.set(b.id, b.side);
  return out;
}

/**
 * Tidy up: main branches are balanced again between the two sides (keeping their order) and keep those
 * sides from then on. The layout itself is always automatic.
 */
export function tidy(map: MindmapData): MindmapData {
  const root = mindmapRoot(map);
  if (!root) return map;
  const free: MindmapData = { ...map, nodes: map.nodes.map((n) => (n.parent === root.id ? withOptional(n, "side", undefined) : n)) };
  if (map.layout !== "both") return sameMap(map, free) ? map : free;
  const l = layoutMindmap(free);
  const branches = (mindmapChildren(free).get(root.id) ?? []).map((b) => ({ id: b.id, height: extentOf(l, b.id) }));
  const sides = mindmapSides(branches);
  const next = { ...free, nodes: free.nodes.map((n) => (sides.has(n.id) ? { ...n, side: sides.get(n.id)! } : n)) };
  return sameMap(map, next) ? map : next;
}

/** The height a main branch takes up in a layout (its boxes' vertical span). */
function extentOf(l: ReturnType<typeof layoutMindmap>, id: string): number {
  const ids = new Set<string>([id]);
  let top = Infinity;
  let bottom = -Infinity;
  for (const b of l.boxes) {
    if (!ids.has(b.id) && !(b.parent && ids.has(b.parent))) continue;
    ids.add(b.id);
    top = Math.min(top, b.y);
    bottom = Math.max(bottom, b.y + b.h);
  }
  return Number.isFinite(top) ? bottom - top : 0;
}

/** Adds ideas (Foli AI's, or pasted lines) under `parent`, nested as given. */
export function addIdeas(map: MindmapData, parent: string, ideas: { text: string; children?: { text: string }[] }[]): { map: MindmapData; ids: string[] } {
  let next = map;
  const ids: string[] = [];
  for (const idea of ideas) {
    const r = addChild(next, parent, idea.text);
    if (!r) break;
    next = r.map;
    ids.push(r.id);
    for (const sub of idea.children ?? []) {
      const s = addChild(next, r.id, sub.text);
      if (!s) break;
      next = s.map;
    }
  }
  return { map: next, ids };
}

/** The ideas from the centre down to `id` (for Foli AI's context). */
export function pathTo(map: MindmapData, id: string): string[] {
  const out: string[] = [];
  let at = byId(map, id);
  while (at && out.length <= MINDMAP_LIMITS.maxDepth) {
    out.unshift(at.text);
    at = byId(map, at.parent);
  }
  return out;
}

function withOptional<K extends "color" | "side" | "collapsed">(n: MindNode, key: K, value: MindNode[K] | undefined): MindNode {
  const out = { ...n };
  if (value === undefined) delete out[key];
  else out[key] = value;
  return out;
}

function sameMap(a: MindmapData, b: MindmapData): boolean {
  return a.layout === b.layout && a.nodes.length === b.nodes.length && a.nodes.every((n, i) => {
    const m = b.nodes[i]!;
    return n.id === m.id && n.parent === m.parent && n.text === m.text && n.color === m.color && n.side === m.side && Boolean(n.collapsed) === Boolean(m.collapsed);
  });
}

/** Undo history for the canvas: snapshots of whole maps (they're small), merged for quick runs of one kind. */
export class MindHistory {
  private past: MindmapData[] = [];
  private future: MindmapData[] = [];
  private lastKey: string | null = null;
  private lastAt = 0;

  push(before: MindmapData, key?: string, now = Date.now()): void {
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
  undo(current: MindmapData): MindmapData | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(current);
    this.lastKey = null;
    return prev;
  }
  redo(current: MindmapData): MindmapData | null {
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
