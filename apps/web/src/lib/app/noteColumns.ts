/**
 * The columns layout (docs/NOTE_COLUMNS.md): the sidebar, a column of a list's notes, and the open note. What it
 * decides without React: which lists have it, how its address reads, the date groups, and which note a list opens on.
 */
import { parseRoute, type Route } from "./router";

/** The lists shown as a column (Templates keeps its own page). */
export type ColumnsListRoute = Extract<Route, { name: "notes" | "starred" | "archive" | "trash" | "unsorted" | "folder" | "folders" | "tag" | "shared" }>;
/** (The Folders page, `folders`, lists every note that's in a folder; `shared` is Shared with Me.) */
const LIST_NAMES = new Set(["notes", "starred", "archive", "trash", "unsorted", "folder", "folders", "tag", "shared"]);

export function isColumnsList(route: Route): route is ColumnsListRoute {
  return LIST_NAMES.has(route.name);
}

/** A list's own path ("/folders/abc", "/drafts"), the one form `?list=` takes. */
export function listPath(route: ColumnsListRoute): string {
  switch (route.name) {
    case "folder":
      return `/folders/${encodeURIComponent(route.id)}`;
    case "tag":
      return `/tags/${encodeURIComponent(route.id)}`;
    case "unsorted":
      return "/drafts";
    default:
      return `/${route.name}`;
  }
}

/** The list a note's address names (`?list=`), or null when it names none, or nothing that is a list. */
export function listFromSearch(search: URLSearchParams | string): { path: string; route: ColumnsListRoute } | null {
  const raw = (typeof search === "string" ? new URLSearchParams(search) : search).get("list");
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  const route = parseRoute(raw.split("?")[0]!);
  return isColumnsList(route) ? { path: listPath(route), route } : null;
}

/** Where a note in a list goes: the note's address with the list after it (and `new=1` for a note just made). */
export function columnsHref(noteId: string, list: string, opts?: { fresh?: boolean }): string {
  return `/d/${encodeURIComponent(noteId)}?${opts?.fresh ? "new=1&" : ""}list=${encodeURIComponent(list)}`;
}

/** The note's address as it is (its other query fields kept), with the list it's shown in. */
export function withListParam(pathname: string, search: URLSearchParams | string, list: string): string {
  const q = new URLSearchParams(typeof search === "string" ? search : search.toString());
  q.set("list", list);
  return `${pathname}?${q.toString()}`;
}

/** What a note's details (documents.get) say about where it is, as much as the column needs. */
export interface NoteWhere {
  document: { kind?: string; archivedAt?: number | null; deletedAt?: number | null };
  isMember: boolean;
  inTrash?: boolean;
  folder: { id: string } | null;
  breadcrumbs: { id: string }[];
}

/**
 * The list a note opened on its own shows in, with the Columns layout on (docs/NOTE_COLUMNS.md): Trash or Archive
 * while it's there, a note shared with you in Shared with Me, else its folder (a nested page: its top note's), else
 * Drafts. Templates aren't in a note list: null, the note page as it is. `row` is the row to mark: the note, or the
 * top note a nested page is inside.
 */
export function listForNote(noteId: string, where: NoteWhere): { path: string; row: string } | null {
  if (where.document.kind === "template") return null;
  const row = where.breadcrumbs[0]?.id ?? noteId;
  const path = !where.isMember
    ? "/shared"
    : where.inTrash || where.document.deletedAt
      ? "/trash"
      : where.document.archivedAt
        ? "/archive"
        : where.folder
          ? `/folders/${encodeURIComponent(where.folder.id)}`
          : "/drafts";
  return { path, row };
}

/** The list on screen in the columns layout: a list's own page, or a note opened in one. */
export function columnsListOf(route: Route, search: URLSearchParams | string): { path: string; route: ColumnsListRoute; noteId: string | null } | null {
  if (isColumnsList(route)) return { path: listPath(route), route, noteId: null };
  if (route.name !== "doc") return null;
  const list = listFromSearch(search);
  return list ? { ...list, noteId: route.id } : null;
}

// --- Date groups ---------------------------------------------------------------------------------------------

export interface GroupableNote {
  id: string;
  starred?: boolean;
  updatedAt: number;
  createdAt?: number;
  deletedAt?: number | null;
}

export interface NoteGroup<T> {
  key: string;
  label: string;
  notes: T[];
}

const DAY = 86_400_000;
function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
const monthFormat = new Map<string, Intl.DateTimeFormat>();
function monthLabel(date: Date, withYear: boolean): string {
  const key = withYear ? "y" : "m";
  let f = monthFormat.get(key);
  if (!f) monthFormat.set(key, (f = new Intl.DateTimeFormat(undefined, withYear ? { month: "long", year: "numeric" } : { month: "long" })));
  return f.format(date);
}

/** Which group a time falls in, from the day it is (`now`): Today, Yesterday, Previous 7 days, Previous 30 days, then its month. */
export function dateGroup(ts: number, now: number): { key: string; label: string } {
  const today = startOfDay(now);
  // Days apart by calendar day (a day with a clock change is still one day).
  const days = Math.round((today - startOfDay(ts)) / DAY);
  if (days <= 0) return { key: "today", label: "Today" };
  if (days === 1) return { key: "yesterday", label: "Yesterday" };
  if (days < 7) return { key: "week", label: "Previous 7 days" };
  if (days < 30) return { key: "month", label: "Previous 30 days" };
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return { key: `m:${d.getFullYear()}-${d.getMonth()}`, label: monthLabel(d, !sameYear) };
}

/**
 * A list's notes in the column's groups, in the order given (the list's sort): its bookmarked notes under Pinned
 * first (not on Bookmarks itself, where every note is one), then by date when sorted by a date, else in one group.
 * `dateOf` is the time a row shows (when it was deleted, in Trash).
 */
export function groupNotes<T extends GroupableNote>(notes: readonly T[], opts: { now: number; sort: string; pinned: boolean; dateOf?: (n: T) => number }): NoteGroup<T>[] {
  const dateOf = opts.dateOf ?? ((n: T) => (opts.sort === "created" ? (n.createdAt ?? n.updatedAt) : n.updatedAt));
  const byDate = opts.sort === "updated" || opts.sort === "created";
  const groups: NoteGroup<T>[] = [];
  const pinned = opts.pinned ? notes.filter((n) => n.starred) : [];
  if (pinned.length) groups.push({ key: "pinned", label: "Pinned", notes: pinned });
  const rest = pinned.length ? notes.filter((n) => !n.starred) : notes;
  if (!byDate) {
    if (rest.length) groups.push({ key: "notes", label: pinned.length ? "Notes" : "", notes: [...rest] });
    return groups;
  }
  const at = new Map<string, NoteGroup<T>>();
  for (const n of rest) {
    const g = dateGroup(dateOf(n), opts.now);
    let group = at.get(g.key);
    if (!group) {
      group = { ...g, notes: [] };
      at.set(g.key, group);
      groups.push(group);
    }
    group.notes.push(n);
  }
  return groups;
}

// --- Which note a list opens on --------------------------------------------------------------------------------

export const LAST_NOTES_KEY = "folevi:note-columns:last";
const LAST_NOTES_KEPT = 200;
export type LastNotes = Record<string, string>;

export function lastNoteKey(scopeKey: string, list: string): string {
  return `${scopeKey}|${list}`;
}

/** `last` with `noteId` as the list's last note, newest last, keeping the newest 200 lists. */
export function rememberNote(last: LastNotes, key: string, noteId: string): LastNotes {
  if (last[key] === noteId) return last;
  const next: LastNotes = {};
  const keys = Object.keys(last).filter((k) => k !== key);
  for (const k of keys.slice(Math.max(0, keys.length - (LAST_NOTES_KEPT - 1)))) next[k] = last[k]!;
  next[key] = noteId;
  return next;
}

/** The note a list opens on: the one it had last, while it's still in the list; else the most recently edited. */
export function pickNote<T extends { id: string; updatedAt: number }>(notes: readonly T[], remembered: string | undefined): T | null {
  if (!notes.length) return null;
  if (remembered) {
    const kept = notes.find((n) => n.id === remembered);
    if (kept) return kept;
  }
  return notes.reduce((best, n) => (n.updatedAt > best.updatedAt ? n : best), notes[0]!);
}

/**
 * The note to show when the open one leaves the list (moved, archived, trashed): the one that took its place, or the
 * one before it at the end. Null when the list is empty now.
 */
export function noteAfterLeaving(before: readonly string[], after: readonly string[], gone: string): string | null {
  if (!after.length) return null;
  const at = before.indexOf(gone);
  if (at < 0) return after[0]!;
  // The first note after it that's still here, else the nearest one before it.
  for (let i = at + 1; i < before.length; i++) if (after.includes(before[i]!)) return before[i]!;
  for (let i = at - 1; i >= 0; i--) if (after.includes(before[i]!)) return before[i]!;
  return after[0]!;
}

/** The note `delta` rows away from `current` in the column's order (arrow keys), or null past either end. */
export function stepNote(order: readonly string[], current: string | null, delta: 1 | -1): string | null {
  if (!order.length) return null;
  const at = current ? order.indexOf(current) : -1;
  if (at < 0) return order[delta > 0 ? 0 : order.length - 1]!;
  return order[at + delta] ?? null;
}

// --- The column's size ----------------------------------------------------------------------------------------

export const COLUMN_MIN = 240;
export const COLUMN_MAX = 480;
export const COLUMN_DEFAULT = 300;
export function clampColumn(width: number): number {
  return Math.round(Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, width)));
}
