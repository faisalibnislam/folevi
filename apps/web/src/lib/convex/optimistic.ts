"use client";

import { useMemo } from "react";
import { useMutation, type ReactMutation } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionArgs, FunctionReference } from "convex/server";
import { api } from "@/lib/convex/api";

// Clicks that show at once (docs/perf/feel-results.md). A plain mutation changes the screen only when the server's
// answer comes back: a round trip, which far from the backend is a third of a second on every bookmark, check-off,
// archive and trash. These are Convex optimistic updates: the lists and the note on screen change with the click,
// and Convex puts the server's own answer in their place when it arrives (or takes the change back if it refuses).
// They only touch queries already on screen, so a list that isn't open is simply read fresh the next time.
//
// Use: useOptimisticMutation(api.tasks.update, taskUpdated)

/** `useMutation` whose effect shows at once (`update`, one of the functions below). The same function every render. */
export function useOptimisticMutation<M extends FunctionReference<"mutation">>(mutation: M, update: (store: OptimisticLocalStore, args: FunctionArgs<M>) => void): ReactMutation<M> {
  const base = useMutation(mutation);
  return useMemo(() => base.withOptimisticUpdate(update), [base, update]);
}

type Row = { id?: unknown; starred?: unknown };
type Page = { page?: unknown };

/** What a click does to notes: bookmark them or not, or take them out of the lists they're in. */
export type NoteChange =
  | { kind: "star"; starred: boolean }
  | { kind: "archive"; archived: boolean }
  | { kind: "trash" }
  | { kind: "restore" }
  | { kind: "delete" };

/** Whether a list of `view` stops showing a note after `change`. */
function leaves(view: unknown, change: NoteChange): boolean {
  switch (change.kind) {
    case "star":
      return view === "starred" && !change.starred;
    case "trash":
      return view !== "trash";
    case "archive":
      return change.archived ? view !== "archive" && view !== "trash" : view === "archive";
    case "restore":
    case "delete":
      return view === "trash";
  }
}

/** Applies `change` to the notes `ids` in every note list and note on screen. */
export function notesChanged(store: OptimisticLocalStore, ids: readonly string[], change: NoteChange) {
  if (!ids.length) return;
  const touched = new Set(ids);
  for (const { args, value } of store.getAllQueries(api.documents.list)) {
    const page = (value as Page | undefined)?.page;
    if (!value || !Array.isArray(page)) continue;
    const view = (args as { view?: unknown }).view;
    let changed = false;
    const next: Row[] = [];
    for (const row of page as Row[]) {
      if (typeof row?.id !== "string" || !touched.has(row.id)) next.push(row);
      else if (leaves(view, change)) changed = true;
      else if (change.kind === "star" && row.starred !== change.starred) {
        next.push({ ...row, starred: change.starred });
        changed = true;
      } else next.push(row);
    }
    if (changed) store.setQuery(api.documents.list, args, { ...(value as object), page: next } as never);
  }
  // The note itself (its menu and title row read the bookmark from here).
  if (change.kind !== "star") return;
  for (const id of ids) {
    const args = { documentId: id };
    const value = store.getQuery(api.documents.get, args) as { document?: { starred?: boolean } } | null | undefined;
    if (value?.document && value.document.starred !== change.starred) store.setQuery(api.documents.get, args, { ...value, document: { ...value.document, starred: change.starred } } as never);
  }
}

/** documents.bulkUpdate: the list actions (multi-select, a card's menu, a drag to Trash). Moves have the outbox. */
export function bulkUpdated(store: OptimisticLocalStore, args: { documentIds: string[]; action: { kind: string; starred?: boolean; archived?: boolean } }) {
  const a = args.action;
  if (a.kind === "star" && typeof a.starred === "boolean") notesChanged(store, args.documentIds, { kind: "star", starred: a.starred });
  else if (a.kind === "archive" && typeof a.archived === "boolean") notesChanged(store, args.documentIds, { kind: "archive", archived: a.archived });
  else if (a.kind === "trash" || a.kind === "restore" || a.kind === "delete") notesChanged(store, args.documentIds, { kind: a.kind });
}

/** documents.setStarred: the bookmark in a note's own menu. */
export function starSet(store: OptimisticLocalStore, args: { documentId: string; starred: boolean }) {
  notesChanged(store, [args.documentId], { kind: "star", starred: args.starred });
}

type TaskRow = { blockId?: unknown; status?: unknown };

/** A task's status after tasks.update's `checked` / `canceled`, as the server sets it. */
function statusAfter(status: unknown, args: { checked?: boolean; canceled?: boolean }): unknown {
  if (args.checked !== undefined) return args.checked ? "done" : "open";
  if (args.canceled !== undefined) return args.canceled ? "canceled" : "open";
  return status;
}

/** tasks.update: a task checked off (or reopened) shows so in Tasks and Calendar at the click. */
export function taskUpdated(store: OptimisticLocalStore, args: { blockId: string; checked?: boolean; canceled?: boolean }) {
  if (args.checked === undefined && args.canceled === undefined) return;
  const apply = (rows: unknown): unknown[] | null => {
    if (!Array.isArray(rows)) return null;
    let changed = false;
    const next = (rows as TaskRow[]).map((t) => {
      if (t?.blockId !== args.blockId) return t;
      const status = statusAfter(t.status, args);
      if (status === t.status) return t;
      changed = true;
      return { ...t, status };
    });
    return changed ? next : null;
  };
  for (const { args: queryArgs, value } of store.getAllQueries(api.tasks.list)) {
    const next = apply(value);
    if (next) store.setQuery(api.tasks.list, queryArgs, next as never);
  }
  for (const { args: queryArgs, value } of store.getAllQueries(api.tasks.range)) {
    // The calendar's tasks: a list, or a list under `tasks`.
    const inner = (value as { tasks?: unknown } | undefined)?.tasks;
    const next = apply(Array.isArray(value) ? value : inner);
    if (!next) continue;
    store.setQuery(api.tasks.range, queryArgs, (Array.isArray(value) ? next : { ...(value as unknown as object), tasks: next }) as never);
  }
}

/** documents.setArchived, moveToTrash and restoreFromTrash from a note's own menu: its lists follow at once. */
export function archivedSet(store: OptimisticLocalStore, args: { documentId: string; archived: boolean }) {
  notesChanged(store, [args.documentId], { kind: "archive", archived: args.archived });
}
export function trashed(store: OptimisticLocalStore, args: { documentId: string }) {
  notesChanged(store, [args.documentId], { kind: "trash" });
}
export function restored(store: OptimisticLocalStore, args: { documentId: string }) {
  notesChanged(store, [args.documentId], { kind: "restore" });
}
