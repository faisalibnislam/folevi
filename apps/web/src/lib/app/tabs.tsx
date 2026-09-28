"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
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
  /** Where the Home tab goes: the last non-page view (Home, Drafts, a folder, Tasks…). */
  homeHref: string;
  close: (id: string) => void;
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
 * Pages open in tabs: visiting a page adds its tab (or switches to it), tabs stay open until closed, and
 * they're remembered per account on this device.
 */
export function TabsProvider({ accountKey, children }: { accountKey: string; children: ReactNode }) {
  const { route, pathname, search, navigate } = useAppRouter();
  const [tabs, setTabs] = useLocalStorage<DocTab[]>(`folevi:tabs:${accountKey}`, []);
  const [homeHref, setHomeHref] = useLocalStorage<string>(`folevi:home-href:${accountKey}`, "/documents");

  const docId = route.name === "doc" ? route.id : null;
  const query = search.toString();
  const previousDoc = useRef<string | null>(null);
  useEffect(() => {
    const from = previousDoc.current;
    previousDoc.current = docId;
    const newTab = nextInNewTab;
    nextInNewTab = false;
    if (docId) {
      const open = tabs.findIndex((t) => t.id === docId || tabPage(t) === docId);
      if (open !== -1) {
        if (tabPage(tabs[open]!) !== docId) setTabs(tabs.map((t, i) => (i === open ? { ...t, at: docId } : t)));
        return;
      }
      const at = from ? tabs.findIndex((t) => tabPage(t) === from) : -1;
      if (at !== -1 && !newTab) {
        // Moving within a note: the current tab follows it (place() then files it under its top page).
        setTabs(tabs.map((t, i) => (i === at ? { id: docId, at: docId, title: "" } : t)));
        return;
      }
      let next: DocTab[] = [...tabs, { id: docId, at: docId, title: "" }];
      // Keep the strip bounded: drop the oldest tabs other than this one.
      while (next.length > MAX_TABS) next = next.filter((t, i) => i !== next.findIndex((x) => x.id !== docId));
      setTabs(next);
    } else if (!["settings", "onboarding", "invite", "not_found", "help"].includes(route.name)) {
      const href = `${pathname}${query ? `?${query}` : ""}`;
      if (href !== homeHref) setHomeHref(href);
    }
  }, [docId, route.name, pathname, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback(
    (id: string) => {
      const i = tabs.findIndex((t) => t.id === id);
      if (i === -1) return;
      const next = tabs.filter((t) => t.id !== id);
      setTabs(next);
      if (docId && tabPage(tabs[i]!) === docId) {
        const neighbor = next[i] ?? next[i - 1];
        navigate(neighbor ? `/d/${tabPage(neighbor)}` : homeHref);
      }
    },
    [tabs, setTabs, docId, navigate, homeHref],
  );

  const place = useCallback(
    (documentId: string, root: { id: string; title: string }) => {
      const i = tabs.findIndex((t) => tabPage(t) === documentId);
      if (i === -1) return;
      const t = tabs[i]!;
      if (t.id === root.id) {
        if (t.title !== root.title) setTabs(tabs.map((x, k) => (k === i ? { ...x, title: root.title } : x)));
        return;
      }
      const j = tabs.findIndex((x) => x.id === root.id);
      if (j !== -1) {
        // The note already has a tab: show this page there and drop the extra one.
        setTabs(tabs.filter((_, k) => k !== i).map((x) => (x.id === root.id ? { ...x, at: documentId, title: root.title } : x)));
      } else {
        setTabs(tabs.map((x, k) => (k === i ? { id: root.id, at: documentId, title: root.title } : x)));
      }
    },
    [tabs, setTabs],
  );

  const value = useMemo(() => ({ tabs, homeHref, close, place }), [tabs, homeHref, close, place]);
  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

export function useTabs(): TabsValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("useTabs outside TabsProvider");
  return ctx;
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
