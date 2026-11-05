// The Folders page's order (views/OrganizeIndex.tsx): its sorts, and dragging a folder card to a new spot among
// the others. Pure, so the page, the drop layer and the tests agree. The native apps do the same in Swift
// (apps/native-kit/Sources/FoleviScreens/Folders/FolderOrder.swift).
import { compareRank } from "@folevi/editor-schema";

/**
 * Manual: the folders' own order (their `rank`, as the sidebar shows them). Name: A to Z. Recent: the last
 * changed first (the time each card shows).
 */
export type FolderSort = "manual" | "name" | "recent";

export const FOLDER_SORTS: [FolderSort, string][] = [
  ["manual", "Manual"],
  ["name", "Name"],
  ["recent", "Recent"],
];

/**
 * The sort a saved value stands for. Earlier versions saved Name, Last updated ("updated"), Most pages ("count")
 * and Newest ("created"): Name stays Name, Last updated is Recent, the others are Manual (as is anything unknown).
 */
export function folderSortOf(saved: unknown): FolderSort {
  if (saved === "name") return "name";
  if (saved === "recent" || saved === "updated") return "recent";
  return "manual";
}

/** Folders in their own order: by rank (plain byte order, as the server sorts them), else as they came. */
export function byFolderRank<T extends { rank?: string }>(folders: readonly T[]): T[] {
  return folders
    .map((f, i) => [f, i] as const)
    .sort(([a, i], [b, j]) => (a.rank !== undefined && b.rank !== undefined ? compareRank(a.rank, b.rank) : 0) || i - j)
    .map(([f]) => f);
}

/** `folders` (given in their manual order) in `sort`'s order. Never changes the list it's given. */
export function sortFolders<T extends { name: string; updatedAt: number }>(folders: readonly T[], sort: FolderSort): T[] {
  const out = [...folders];
  if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  else if (sort === "recent") out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/**
 * The order with `draggedId` put in the gap at `gap`, counted among the others (0: before the first; their count:
 * after the last). A folder that wasn't in the list (dragged in from the sidebar) joins it there.
 */
export function reorderIds(ids: readonly string[], draggedId: string, gap: number): string[] {
  const rest = ids.filter((id) => id !== draggedId);
  const at = Math.max(0, Math.min(Math.round(gap), rest.length));
  return [...rest.slice(0, at), draggedId, ...rest.slice(at)];
}

/** Whether dropping in that gap changes anything. */
export function gapChangesOrder(ids: readonly string[], draggedId: string, gap: number): boolean {
  const next = reorderIds(ids, draggedId, gap);
  return next.length !== ids.length || next.some((id, i) => id !== ids[i]);
}

/** One folder moved among its siblings: right after `afterId` (null: first), as organization.moveFolder takes it. */
export interface OrderMove {
  id: string;
  afterId: string | null;
}

/**
 * The fewest moves (each "put this folder right after that one") that turn the order `current` into `target`, in
 * the order to send them. The folders already in the right order relative to each other (the longest such run)
 * stay; every other one goes right after the folder before it in `target`, from the first to the last. A folder
 * of `target` that isn't in `current` always moves. Folders of `current` missing from `target` are left alone.
 */
export function orderMoves(current: readonly string[], target: readonly string[]): OrderMove[] {
  const at = new Map(current.map((id, i) => [id, i]));
  // The longest run of `target` whose places in `current` go up: those keep their places.
  const seq: { id: string; pos: number }[] = target.flatMap((id) => (at.has(id) ? [{ id, pos: at.get(id)! }] : []));
  const tails: number[] = [];
  const prev: number[] = new Array(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]!]!.pos < seq[i]!.pos) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const kept = new Set<string>();
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = prev[i]!) kept.add(seq[i]!.id);
  const moves: OrderMove[] = [];
  target.forEach((id, i) => {
    if (!kept.has(id)) moves.push({ id, afterId: i > 0 ? target[i - 1]! : null });
  });
  return moves;
}

/** `current` with `moves` applied one after another (what the server ends up with). */
export function applyOrderMoves(current: readonly string[], moves: readonly OrderMove[]): string[] {
  let out = [...current];
  for (const m of moves) {
    out = out.filter((id) => id !== m.id);
    const i = m.afterId === null ? 0 : out.indexOf(m.afterId) + 1;
    out.splice(i, 0, m.id);
  }
  return out;
}

/** Where over a card a dragged folder is held: its left quarter (before it), its right quarter (after it), or the middle (inside it). */
export function cardZone(x: number, left: number, width: number): "before" | "inside" | "after" {
  if (width <= 0) return "inside";
  const f = (x - left) / width;
  return f < 0.25 ? "before" : f > 0.75 ? "after" : "inside";
}
