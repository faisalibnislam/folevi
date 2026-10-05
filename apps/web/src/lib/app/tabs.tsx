"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAppRouter } from "./router";
import { useLocalStorage } from "@/lib/hooks/useEngine";

/**
 * An open note in the tab strip. A tab is a top-level page (`id`); its nested pages open inside it, and
 * `at` is the page (the note itself or one of its nested pages) the tab is showing. The title is the
 * top-level page's, cached so the strip renders before pages load.
 */
export interface DocTab {
  id: string;
  at?: string;
  title: string;
}

/** The page a tab is showing. */
export const tabPage = (t: DocTab) => t.at ?? t.id;

interface TabsValue {
  tabs: DocTab[];
  /** The list view on screen (a folder, Drafts, Trash…) and its name, keyed by path so it's never stale. */
  view: { path: string; title: string } | null;
  setView: (view: { path: string; title: string }) => void;
  /** Where the Home tab goes: the last non-page view (Home, Drafts, a folder, Tasks…). */
  homeHref: string;
  close: (id: string) => void;
  /**
   * Closes several tabs at once (the tab menu: to the left, to the right, all). If the page on screen goes,
   * `then` is shown instead (a tab that stays), else Home.
   */
  closeMany: (ids: string[], then?: string) => void;
  /** Moves a tab to another place in the strip (dragging it, or ⌥⇧← / ⌥⇧→ on it). */
  move: (id: string, to: number) => void;
  /** Files the open page under its top-level page's tab (nested pages never get a tab of their own). */
  place: (documentId: string, root: { id: string; title: string }) => void;
}

const MAX_TABS = 12;

// Opening a page from inside a note (a nested page, a page link, a breadcrumb) replaces the current tab;
// opening one from anywhere else (Home, lists, search, "+", New document) opens a new tab. Callers that
// start a new page on purpose mark it here right before navigating.
let nextInNewTab = false;
export function openNextInNewTab() {
  nextInNewTab = true;
}
const TabsContext = createContext<TabsValue | null>(null);

/**
 * Where a context's tabs are remembered: Personal keeps the account's original keys (so tabs opened before
 * contexts existed stay in Personal); each workspace has its own.
 */
export function tabsStorageKeys(accountKey: string, workspaceId: string | null): { tabs: string; homeHref: string } {
  const suffix = workspaceId ? `:${workspaceId}` : "";
  return { tabs: `folevi:tabs:${accountKey}${suffix}`, homeHref: `folevi:home-href:${accountKey}${suffix}` };
}

/**
 * Pages open in tabs: visiting a page adds its tab (or switches to it), tabs stay open until closed, and
 * they're remembered per account and per context (Personal, or each workspace) on this device. Switching
 * context shows that context's tabs, so a page from one never sits in another's strip.
 */
export function TabsProvider({ accountKey, workspaceId, children }: { accountKey: string; workspaceId: string | null; children: ReactNode }) {
  const { route, pathname, search, navigate } = useAppRouter();
  const keys = tabsStorageKeys(accountKey, workspaceId);
  const [tabs, setTabs] = useLocalStorage<DocTab[]>(keys.tabs, []);
  const [homeHref, setHomeHref] = useLocalStorage<string>(keys.homeHref, "/documents");

  const docId = route.name === "doc" ? route.id : null;
  const query = search.toString();
  const previousDoc = useRef<string | null>(null);
  useEffect(() => {
    const from = previousDoc.current;
    previousDoc.current = docId;
    // "Open in a new tab" is for the next move to another page, not any update of this one (the address
    // losing "?new=1" used to take it, and the following new note then replaced the current tab).
    const moved = docId !== from;
    const newTab = moved && nextInNewTab;
    if (moved) nextInNewTab = false;
    if (docId) {
      const open = tabs.findIndex((t) => t.id === docId || tabPage(t) === docId);
      if (open !== -1) {
        if (tabPage(tabs[open]!) !== docId) setTabs((cur) => cur.map((t) => (t.id === tabs[open]!.id ? { ...t, at: docId } : t)));
        return;
      }
      const at = from ? tabs.findIndex((t) => tabPage(t) === from) : -1;
      if (at !== -1 && !newTab) {
        // Moving within a note: the current tab follows it (place() then files it under its top page).
        const replaced = tabs[at]!.id;
        setTabs((cur) => cur.map((t) => (t.id === replaced ? { id: docId, at: docId, title: "" } : t)));
        return;
      }
      setTabs((cur) => {
        if (cur.some((t) => t.id === docId || tabPage(t) === docId)) return cur;
        let next: DocTab[] = [...cur, { id: docId, at: docId, title: "" }];
        // Keep the strip bounded: drop the oldest tabs other than this one.
        while (next.length > MAX_TABS) next = next.filter((t, i) => i !== next.findIndex((x) => x.id !== docId));
        return next;
      });
    } else if (!["settings", "onboarding", "invite", "share-invite", "not_found", "help"].includes(route.name)) {
      const href = `${pathname}${query ? `?${query}` : ""}`;
      if (href !== homeHref) setHomeHref(href);
    }
  }, [docId, route.name, pathname, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback(
    (id: string) => {
      const i = tabs.findIndex((t) => t.id === id);
      if (i === -1) return;
      const next = tabs.filter((t) => t.id !== id);
      setTabs((cur) => cur.filter((t) => t.id !== id));
      if (docId && tabPage(tabs[i]!) === docId) {
        const neighbor = next[i] ?? next[i - 1];
        navigate(neighbor ? `/d/${tabPage(neighbor)}` : homeHref);
      }
    },
    [tabs, setTabs, docId, navigate, homeHref],
  );
  const closeMany = useCallback(
    (ids: string[], then?: string) => {
      const gone = new Set(ids);
      if (!gone.size) return;
      const next = tabs.filter((t) => !gone.has(t.id));
      setTabs((cur) => cur.filter((t) => !gone.has(t.id)));
      if (docId && tabs.some((t) => gone.has(t.id) && tabPage(t) === docId)) {
        const stay = next.find((t) => t.id === then);
        navigate(stay ? `/d/${tabPage(stay)}` : homeHref);
      }
    },
    [tabs, setTabs, docId, navigate, homeHref],
  );

  const move = useCallback(
    (id: string, to: number) => {
      setTabs((cur) => {
        const from = cur.findIndex((t) => t.id === id);
        if (from === -1 || to < 0 || to >= cur.length || from === to) return cur;
        const next = [...cur];
        next.splice(to, 0, ...next.splice(from, 1));
        return next;
      });
    },
    [setTabs],
  );

  const place = useCallback(
    (documentId: string, root: { id: string; title: string }) => {
      const i = tabs.findIndex((t) => tabPage(t) === documentId);
      if (i === -1) return;
      const t = tabs[i]!;
      if (t.id === root.id) {
        if (t.title !== root.title) setTabs((cur) => cur.map((x) => (x.id === t.id ? { ...x, title: root.title } : x)));
        return;
      }
      const j = tabs.findIndex((x) => x.id === root.id);
      if (j !== -1) {
        // The note already has a tab: show this page there and drop the extra one.
        setTabs((cur) => cur.filter((x) => x.id !== t.id).map((x) => (x.id === root.id ? { ...x, at: documentId, title: root.title } : x)));
      } else {
        setTabs((cur) => cur.map((x) => (x.id === t.id ? { id: root.id, at: documentId, title: root.title } : x)));
      }
    },
    [tabs, setTabs],
  );

  const [view, setViewState] = useState<{ path: string; title: string } | null>(null);
  const setView = useCallback((next: { path: string; title: string }) => {
    setViewState((prev) => (prev && prev.path === next.path && prev.title === next.title ? prev : next));
  }, []);

  const value = useMemo(() => ({ tabs, view, setView, homeHref, close, closeMany, move, place }), [tabs, view, setView, homeHref, close, closeMany, move, place]);
  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

export function useTabs(): TabsValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("useTabs outside TabsProvider");
  return ctx;
}

/**
 * Names the list view on screen for the tab strip (ViewChrome passes the view's tab title). The strip
 * shows it as the current tab, so a folder page never looks like the last note you had open.
 */
export function useViewTab(title: string | undefined) {
  const ctx = useContext(TabsContext);
  const setView = ctx?.setView;
  const { route, pathname } = useAppRouter();
  const isDoc = route.name === "doc";
  useEffect(() => {
    if (!setView || isDoc || !title) return;
    setView({ path: pathname, title });
  }, [setView, isDoc, pathname, title]);
}

/**
 * Keeps the open page's tab in step: the tab belongs to the page's top-level note (`root`, or the page
 * itself when it isn't nested) and shows that note's title. Pass root = undefined until it's known.
 */
export function useDocTab(documentId: string, title: string, root: { id: string; title: string } | null | undefined) {
  const ctx = useContext(TabsContext);
  const place = ctx?.place;
  const rootId = root === undefined ? undefined : (root?.id ?? documentId);
  const rootTitle = root === undefined ? title : (root?.title ?? title);
  useEffect(() => {
    if (rootId === undefined || !place) return;
    if (rootId === documentId && !rootTitle) return;
    place(documentId, { id: rootId, title: rootTitle });
  }, [place, documentId, rootId, rootTitle]);
}
