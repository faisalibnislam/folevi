// Pagination for local handlers, with sort-key cursors (never offsets), so a page keeps its place when rows
// are added or removed around it. Rows are walked in ascending key order: a handler builds keys that sort the
// way its list does (newest first is `invertedTime|id`). A page ends at `numItems` rows, or, once the query
// cache has pinned it (queryCache.ts), at its `endCursor`, which then grows or shrinks with the rows in it.
import type { PaginationOptions, PaginationResult } from "convex/server";

/** The cursor of a page that reached the end: a pinned last page takes in everything added after it. */
export const END_CURSOR = "￿";

/** Joins the parts of a sort key ("\u0000" sorts before any character a part can hold). */
export function sortKey(...parts: (string | number)[]): string {
  return parts.map(String).join("\u0000");
}

/** A time as a key part that sorts newest first. */
export function newestFirst(ms: number): string {
  return String(9_999_999_999_999 - Math.max(0, Math.floor(ms))).padStart(13, "0");
}

/** A time as a key part that sorts oldest first. */
export function oldestFirst(ms: number): string {
  return String(Math.max(0, Math.floor(ms))).padStart(13, "0");
}

export function paginate<T>(rows: readonly T[], keyOf: (row: T) => string, opts: PaginationOptions): PaginationResult<T> {
  const keyed = rows.map((row) => ({ row, key: keyOf(row) })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const cursor = opts.cursor;
  const from = cursor ? keyed.filter((r) => r.key > cursor) : keyed;
  const end = opts.endCursor;
  if (end !== undefined && end !== null) {
    const page = end === END_CURSOR ? from : from.filter((r) => r.key <= end);
    const isDone = end === END_CURSOR || !from.some((r) => r.key > end);
    return { page: page.map((r) => r.row), isDone, continueCursor: end };
  }
  const n = Math.max(0, Math.floor(opts.numItems));
  const page = from.slice(0, n);
  const isDone = from.length <= n;
  const last = page[page.length - 1];
  return { page: page.map((r) => r.row), isDone, continueCursor: isDone ? END_CURSOR : (last?.key ?? cursor ?? "") };
}
