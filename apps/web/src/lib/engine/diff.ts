// Windowed lists and their diffs (docs/NATIVE_APP_PLAN.md section 3.2, "Big lists"). Pure: the host keeps one
// `ListState` per list subscription and calls `windowDiff` whenever the list or the window changes. `applyDiff` is
// the reference for what native does with a diff (the Swift list store mirrors it; the fixtures check both).
import { canonicalJson } from "@folevi/editor-schema";
import { MAX_WINDOW_ROWS, RECOMMENDED_OVERSCAN, fnv1a, type ListDiff, type ListWindow, type NoteRow } from "./protocol";

/** What native holds of a list subscription, as the engine last told it. */
export interface ListState {
  start: number;
  count: number;
  total: number;
  complete: boolean;
  /** The window's ids in order, as last sent. */
  order: string[];
  /** id to the hash native has for it. */
  sent: Map<string, string>;
}

/** The window used when native leaves it out. */
export const DEFAULT_WINDOW: ListWindow = { start: 0, count: RECOMMENDED_OVERSCAN * 2 };

/** A window made safe: whole numbers, not negative, at most `MAX_WINDOW_ROWS` rows. */
export function clampWindow(win: ListWindow | undefined): ListWindow {
  if (!win) return DEFAULT_WINDOW;
  const start = Number.isFinite(win.start) ? Math.max(0, Math.floor(win.start)) : 0;
  const count = Number.isFinite(win.count) ? Math.max(0, Math.min(MAX_WINDOW_ROWS, Math.floor(win.count))) : DEFAULT_WINDOW.count;
  return { start, count };
}

/** A row's content hash: FNV-1a of its canonical JSON without `h`. */
export function rowHash(row: Omit<NoteRow, "h"> | NoteRow): string {
  const { h: _h, ...rest } = row as NoteRow;
  void _h;
  return fnv1a(canonicalJson(rest));
}

/** The row with its hash filled in. */
export function withHash(row: Omit<NoteRow, "h">): NoteRow {
  return { ...row, h: rowHash(row) } as NoteRow;
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * The diff that brings native from `prev` (null: it holds nothing, send everything) to the window `win` of the
 * list `ids` (rows by id). Returns null when native is already up to date.
 */
export function windowDiff(prev: ListState | null, ids: readonly string[], rows: ReadonlyMap<string, NoteRow>, win: ListWindow, complete: boolean): { diff: ListDiff | null; next: ListState } {
  const total = ids.length;
  const start = Math.min(win.start, total);
  const order = ids.slice(start, start + win.count);
  const sent = new Map<string, string>();
  const upsert: Record<string, NoteRow> = {};
  let upserts = 0;
  for (const id of order) {
    const row = rows.get(id);
    if (!row) continue;
    sent.set(id, row.h);
    if (!prev || prev.sent.get(id) !== row.h) {
      upsert[id] = row;
      upserts++;
    }
  }
  const next: ListState = { start, count: win.count, total, complete, order, sent };
  if (!prev) {
    return { diff: { reset: true, total, complete, start, order, ...(upserts ? { upsert } : {}) }, next };
  }
  const remove = [...prev.sent.keys()].filter((id) => !sent.has(id));
  const orderChanged = !sameIds(prev.order, order) || prev.start !== start;
  if (!orderChanged && !upserts && !remove.length && prev.total === total && prev.complete === complete) return { diff: null, next };
  const diff: ListDiff = { total, complete, start };
  if (orderChanged) diff.order = order;
  if (upserts) diff.upsert = upsert;
  if (remove.length) diff.remove = remove;
  return { diff, next };
}

/** What native holds: the window's rows in order. */
export interface NativeList {
  total: number;
  complete: boolean;
  start: number;
  order: string[];
  rows: Map<string, NoteRow>;
}

export function emptyNativeList(): NativeList {
  return { total: 0, complete: false, start: 0, order: [], rows: new Map() };
}

/** Applies a diff the way native does: reset, remove, upsert, then order. Returns a new list. */
export function applyDiff(list: NativeList, diff: ListDiff): NativeList {
  const rows = diff.reset ? new Map<string, NoteRow>() : new Map(list.rows);
  let order = diff.reset ? [] : list.order;
  for (const id of diff.remove ?? []) rows.delete(id);
  for (const [id, row] of Object.entries(diff.upsert ?? {})) rows.set(id, row);
  if (diff.order) order = diff.order;
  // Only the window's rows are kept (a row that left the window without a remove is dropped too).
  const keep = new Set(order);
  for (const id of [...rows.keys()]) if (!keep.has(id)) rows.delete(id);
  return { total: diff.total, complete: diff.complete, start: diff.start, order, rows };
}

/** The rows native shows, in order (a hole, which a correct diff never leaves, is skipped). */
export function nativeRows(list: NativeList): NoteRow[] {
  return list.order.map((id) => list.rows.get(id)).filter((r): r is NoteRow => Boolean(r));
}
