"use client";

import { useMemo } from "react";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { useIphoneApp } from "@/lib/iphone";
import { nativeChrome } from "@/lib/nativeApp";
import { useQuery } from "@/lib/convex/queries";
import { api } from "@/lib/convex/api";
import { parseRoute, useAppRouter } from "./router";
import { columnsListOf, COLUMN_DEFAULT, listForNote, type ColumnsListRoute, type NoteWhere } from "./noteColumns";

/** The layout preference (Settings > Appearance and the Sidebar menu's Layout write the same one). */
export const NOTE_COLUMNS_KEY = "folevi:note-columns";

export function useNoteColumnsPref(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useLocalStorage<boolean>(NOTE_COLUMNS_KEY, false);
  return [on === true, setOn];
}

/** Below this width the column starts hidden (its rail shows it), so the note keeps its room. */
export const COLUMNS_MIN_WINDOW = 900;

/**
 * Whether the columns layout is drawn: chosen, on the web's own chrome (not the phone layout, not a native app's page,
 * which keeps its own layout until the Mac and iPad have it). At any width: in a narrow window the column starts
 * hidden instead (NoteColumns).
 */
export function useNoteColumnsActive(): boolean {
  const [on] = useNoteColumnsPref();
  const iphone = useIphoneApp();
  return on && !iphone && !nativeChrome();
}

export interface ColumnsList {
  /** The list's own path, its route, the note open in it, and the row marked (the top note of a nested page). */
  path: string;
  route: ColumnsListRoute;
  noteId: string | null;
  row: string | null;
}

/**
 * The list on screen in the columns layout, and whether it's still being worked out. With the layout on, a note is
 * always shown in a list (the owner, 2026-11-28): the one its address names (`?list=`), else the one it belongs in
 * (listForNote, from its details). `pending` while those details are on their way (online only: offline, or for a
 * note the server doesn't have yet, the note shows on its own).
 */
export function useColumnsInfo(): { list: ColumnsList | null; pending: boolean } {
  const active = useNoteColumnsActive();
  const { route, search } = useAppRouter();
  // (The browser's own word on being online: this runs in the tab strip's provider too, outside the app's state.)
  const online = typeof navigator === "undefined" || navigator.onLine;
  const docId = active && route.name === "doc" ? route.id : null;
  const meta = useQuery(api.documents.get, docId ? { documentId: docId } : "skip") as NoteWhere | null | undefined;
  return useMemo(() => {
    if (!active) return { list: null, pending: false };
    const named = columnsListOf(route, search);
    if (!docId) return { list: named ? { ...named, row: null } : null, pending: false };
    const found = meta ? listForNote(docId, meta) : null;
    if (named) return { list: { ...named, row: found?.row ?? docId }, pending: false };
    if (meta === undefined) return { list: null, pending: online };
    if (!found) return { list: null, pending: false };
    const listRoute = parseRoute(found.path) as ColumnsListRoute;
    return { list: { path: found.path, route: listRoute, noteId: docId, row: found.row }, pending: false };
  }, [active, route, search, docId, meta, online]);
}

/** The list on screen in the columns layout, when it's drawn (a list's page, or a note shown in one). */
export function useColumnsList(): ColumnsList | null {
  return useColumnsInfo().list;
}

export function useColumnWidth() {
  return useLocalStorage<number>("folevi:note-columns:width", COLUMN_DEFAULT);
}

export function useColumnCollapsed() {
  return useLocalStorage<boolean>("folevi:note-columns:collapsed", false);
}

/**
 * The Layout choice in the Sidebar menu (components/app/SidebarMenu.tsx): available everywhere, it switches the
 * preference. Turning it off on a note in a column goes to the list's own page; turning it on shows the page on
 * screen in a column when it's a note or a list (useColumnsInfo); anywhere else the page stays as it is and the next
 * note opens in a column.
 */
export function useLayoutChoice(): { columns: boolean; available: boolean; setColumns: (on: boolean) => void } {
  const [on, setOn] = useNoteColumnsPref();
  const iphone = useIphoneApp();
  const { navigate } = useAppRouter();
  const here = useColumnsList();
  const setColumns = (next: boolean) => {
    if (next === on) return;
    if (!next && here?.noteId) navigate(here.path, { replace: true });
    setOn(next);
  };
  return { columns: on, available: !iphone && !nativeChrome(), setColumns };
}

/** The route the sidebar marks as where you are: a note open in a list's column is in that list. */
export function useNavRoute() {
  const { route } = useAppRouter();
  const columns = useColumnsList();
  return columns ? columns.route : route;
}
