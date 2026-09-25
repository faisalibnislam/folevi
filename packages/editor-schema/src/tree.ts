import { LIMITS } from "./generated/schema";
import { compareRank, rankBetween } from "./rank";

export interface TreeNodeLike {
  id: string;
  parentId: string | null;
  rank: string;
}

export function compareSiblings(a: TreeNodeLike, b: TreeNodeLike): number {
  return compareRank(a.rank, b.rank) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function childrenMap<T extends TreeNodeLike>(blocks: readonly T[]): Map<string | null, T[]> {
  const ids = new Set(blocks.map((b) => b.id));
  const map = new Map<string | null, T[]>();
  for (const b of blocks) {
    // Orphans (parent missing) are shown at the root so content is never hidden.
    const key = b.parentId !== null && ids.has(b.parentId) ? b.parentId : null;
    const list = map.get(key);
    if (list) list.push(b);
    else map.set(key, [b]);
  }
  for (const list of map.values()) list.sort(compareSiblings);
  return map;
}

export interface FlatEntry<T> {
  block: T;
  depth: number;
}

/** Depth-first document order with nesting depth. Cycles are broken (the cyclic block becomes a root). */
export function flattenTree<T extends TreeNodeLike>(blocks: readonly T[]): FlatEntry<T>[] {
  const map = childrenMap(blocks);
  const out: FlatEntry<T>[] = [];
  const visited = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const child of map.get(parent) ?? []) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      out.push({ block: child, depth });
      walk(child.id, depth + 1);
    }
  };
  walk(null, 0);
  // Anything unreachable is part of a cycle; surface it at the root in rank order.
  const rest = blocks.filter((b) => !visited.has(b.id)).sort(compareSiblings);
  for (const b of rest) {
    if (visited.has(b.id)) continue;
    visited.add(b.id);
    out.push({ block: b, depth: 0 });
  }
  return out;
}

export interface TreeIssue {
  blockId: string;
  code: "duplicate_id" | "missing_parent" | "cycle" | "too_deep" | "duplicate_rank";
}

export function checkTreeInvariants(blocks: readonly TreeNodeLike[]): TreeIssue[] {
  const issues: TreeIssue[] = [];
  const byId = new Map<string, TreeNodeLike>();
  for (const b of blocks) {
    if (byId.has(b.id)) issues.push({ blockId: b.id, code: "duplicate_id" });
    byId.set(b.id, b);
  }
  for (const b of blocks) {
    if (b.parentId !== null && !byId.has(b.parentId)) issues.push({ blockId: b.id, code: "missing_parent" });
    const seen = new Set<string>([b.id]);
    let cur = b.parentId;
    let depth = 0;
    while (cur !== null) {
      if (seen.has(cur)) {
        issues.push({ blockId: b.id, code: "cycle" });
        break;
      }
      seen.add(cur);
      depth++;
      cur = byId.get(cur)?.parentId ?? null;
    }
    if (depth > LIMITS.maxDepth) issues.push({ blockId: b.id, code: "too_deep" });
  }
  return issues;
}

export function descendantIds(blocks: readonly TreeNodeLike[], rootId: string): string[] {
  const map = childrenMap(blocks);
  const out: string[] = [];
  const walk = (id: string) => {
    for (const c of map.get(id) ?? []) {
      out.push(c.id);
      walk(c.id);
    }
  };
  walk(rootId);
  return out;
}

/** Rank for placing a block under `parentId` directly after `afterId` (null = first child). */
export function rankForPosition<T extends TreeNodeLike>(
  blocks: readonly T[],
  parentId: string | null,
  afterId: string | null,
  movingId?: string,
): string {
  const siblings = (childrenMap(blocks).get(parentId) ?? []).filter((b) => b.id !== movingId);
  if (afterId === null) return rankBetween(null, siblings[0]?.rank ?? null);
  const idx = siblings.findIndex((b) => b.id === afterId);
  if (idx === -1) return rankBetween(siblings[siblings.length - 1]?.rank ?? null, null);
  const prev = siblings[idx]!;
  const next = siblings[idx + 1];
  if (next && compareRank(prev.rank, next.rank) === 0) {
    // Equal ranks (concurrent inserts) — place after both.
    return rankBetween(next.rank, siblings[idx + 2]?.rank ?? null);
  }
  return rankBetween(prev.rank, next?.rank ?? null);
}

/**
 * Converts a flat (depth-annotated) ordering into parent/rank assignments, keeping existing ranks
 * wherever they are already correctly ordered (longest increasing subsequence per parent).
 * This is how the web editor (a flat list of blocks with indentation) maps back to the tree.
 */
export function assignTreePositions(
  flat: readonly { id: string; depth: number; rank?: string | undefined; parentId?: string | null | undefined }[],
): Map<string, { parentId: string | null; rank: string }> {
  const parents: (string | null)[] = [];
  const stack: { id: string; depth: number }[] = [];
  for (const entry of flat) {
    let depth = Math.max(0, entry.depth);
    while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
    const parent = stack.length ? stack[stack.length - 1]! : null;
    if (parent === null) depth = 0;
    else depth = Math.min(depth, parent.depth + 1);
    parents.push(parent?.id ?? null);
    stack.push({ id: entry.id, depth });
  }
  const groups = new Map<string | null, number[]>();
  flat.forEach((_, i) => {
    const p = parents[i]!;
    const g = groups.get(p);
    if (g) g.push(i);
    else groups.set(p, [i]);
  });
  const result = new Map<string, { parentId: string | null; rank: string }>();
  for (const [parentId, idxs] of groups) {
    const ranks = idxs.map((i) => {
      const e = flat[i]!;
      return e.rank !== undefined && e.parentId === parentId ? e.rank : undefined;
    });
    const keep = longestIncreasing(ranks);
    let prevRank: string | null = null;
    for (let k = 0; k < idxs.length; k++) {
      const e = flat[idxs[k]!]!;
      if (keep.has(k)) {
        prevRank = ranks[k]!;
      } else {
        // Next kept rank bounds this one from above.
        let nextRank: string | null = null;
        for (let j = k + 1; j < idxs.length; j++) {
          if (keep.has(j)) {
            nextRank = ranks[j]!;
            break;
          }
        }
        prevRank = rankBetween(prevRank, nextRank);
      }
      result.set(e.id, { parentId, rank: prevRank });
    }
  }
  return result;
}

function longestIncreasing(ranks: (string | undefined)[]): Set<number> {
  // O(n log n) LIS over defined ranks (strictly increasing).
  const tails: number[] = [];
  const prev = new Array<number>(ranks.length).fill(-1);
  for (let i = 0; i < ranks.length; i++) {
    const r = ranks[i];
    if (r === undefined) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ranks[tails[mid]!]! < r) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const keep = new Set<number>();
  let k = tails.length ? tails[tails.length - 1]! : -1;
  while (k !== -1) {
    keep.add(k);
    k = prev[k]!;
  }
  return keep;
}
