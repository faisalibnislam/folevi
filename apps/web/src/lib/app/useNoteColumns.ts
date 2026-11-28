"use client";

import { useMemo } from "react";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { useIphoneApp } from "@/lib/iphone";
import { nativeChrome } from "@/lib/nativeApp";
import { useAppRouter } from "./router";
import { columnsListOf, COLUMN_DEFAULT } from "./noteColumns";

/** The layout preference (Settings > Appearance and the top bar's toggle write the same one). */
export const NOTE_COLUMNS_KEY = "folevi:note-columns";

export function useNoteColumnsPref(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useLocalStorage<boolean>(NOTE_COLUMNS_KEY, false);
  return [on === true, setOn];
}

/** Below this width the column and the note don't both fit beside the sidebar: today's layout shows instead. */
export const COLUMNS_MIN_WINDOW = 900;

/**
 * Whether the columns layout is drawn now: chosen, on the web's own chrome (not the phone layout, not a native app's
 * page, which keeps its own layout until the Mac and iPad have it), in a window wide enough.
 */
export function useNoteColumnsActive(): boolean {
  const [on] = useNoteColumnsPref();
  const wide = useMediaQuery(`(min-width: ${COLUMNS_MIN_WINDOW}px)`);
  const iphone = useIphoneApp();
  return on && wide && !iphone && !nativeChrome();
}

/** The list on screen in the columns layout, when it's drawn (a list's page, or a note opened in one). */
export function useColumnsList() {
  const active = useNoteColumnsActive();
  const { route, search } = useAppRouter();
  return useMemo(() => (active ? columnsListOf(route, search) : null), [active, route, search]);
}

export function useColumnWidth() {
  return useLocalStorage<number>("folevi:note-columns:width", COLUMN_DEFAULT);
}

export function useColumnCollapsed() {
  return useLocalStorage<boolean>("folevi:note-columns:collapsed", false);
}

/**
 * The top bar's toggle: shown on a note list (and on a note open in one) in a window wide enough. Turning it off on
 * a note in a column goes to the list's own page; turning it on on a list's page opens the column there.
 */
export function useColumnsToggle(): { available: boolean; on: boolean; toggle: () => void } {
  const [on, setOn] = useNoteColumnsPref();
  const wide = useMediaQuery(`(min-width: ${COLUMNS_MIN_WINDOW}px)`);
  const iphone = useIphoneApp();
  const { route, search, navigate } = useAppRouter();
  const here = columnsListOf(route, search);
  const available = wide && !iphone && !nativeChrome() && here !== null;
  const toggle = () => {
    if (on && here?.noteId) navigate(here.path, { replace: true });
    setOn(!on);
  };
  return { available, on, toggle };
}

/** The route the sidebar marks as where you are: a note open in a list's column is in that list. */
export function useNavRoute() {
  const { route } = useAppRouter();
  const columns = useColumnsList();
  return columns ? columns.route : route;
}
