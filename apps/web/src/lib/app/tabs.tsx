"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAppRouter } from "./router";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { cameFromHistory } from "./historyNav";

/**
 * An open note in the tab strip. A tab is a top-level page (`id`); its nested pages open inside it, and
 * `at` is the page (the note itself or one of its nested pages) the tab is showing. The title is the
 * top-level page's, cached so the strip renders before pages load.
 */
export interface DocTab {
  id: string;
  at?: string;
  title: string;
  /** The nested page's own title, while the tab shows one ("Note › Page"). */
  atTitle?: string;
  /**
   * A view's tab (Foli AI, Graph, Drafts, a folder, Tasks…) instead of a note's: its route kind and the path it
   * shows now. Its id is `view:` and the view's key (one per view; one per folder or tag).
   */
  view?: { kind: string; path: string };
  /** Kept at the strip's start, half as wide, with no close button (unpin it first). */
  pinned?: boolean;
  /**
   * Notes joined side by side (two or three), left to right. `at` is the one with focus. Its id is `join:` and a
   * random key; a note sits in at most one tab, so a joined note has no tab of its own.
   */
  panes?: string[];
  /** Each pane's share of the width (they add up to 1); missing means equal. */
  sizes?: number[];
}

/** The page a tab is showing (a note's id; a view's path; a joined tab's pane with focus). */
export const tabPage = (t: DocTab) => t.view?.path ?? t.at ?? t.panes?.[0] ?? t.id;
/** Whether a tab holds a page: the page it shows, or one of its joined panes. */
export const tabHolds = (t: DocTab, page: string) => t.id === page || tabPage(t) === page || Boolean(t.panes?.includes(page));
/** The most notes joined side by side. */
export const MAX_PANES = 3;
/** Where a tab goes. */
export const tabHref = (t: DocTab) => (t.view ? t.view.path : `/d/${tabPage(t)}`);

/** Views that get no tab of their own: Home is always the first tab; the rest aren't places you work in. */
const NO_VIEW_TAB = new Set(["documents", "doc", "onboarding", "quick-add", "invite", "share-invite", "folder-invite", "not_found"]);
/** A view's tab key: one tab per view (it follows you inside it, like Foli AI's conversations), one per folder or tag. */
function viewKey(route: { name: string; id?: string | null }): string | null {
  if (NO_VIEW_TAB.has(route.name)) return null;
  if ((route.name === "folder" || route.name === "tag") && route.id) return `view:${route.name}:${route.id}`;
  return `view:${route.name}`;
}

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
  /** Moves a tab to another place in the strip (dragging it, or ⌥⇧← / ⌥⇧→ on it). Pinned tabs stay among pinned ones. */
  move: (id: string, to: number) => void;
  /** Pins a tab (to the end of the pinned ones) or unpins it (to the start of the others). */
  setPinned: (id: string, pinned: boolean) => void;
  /** Joins a note to a tab, as a new pane on its right (a note's own tab merges in), and shows it. */
  join: (id: string, documentId: string) => void;
  /** Splits a joined tab at the gap after pane `gap`: each side becomes its own tab (a single note's, or still joined). */
  unjoin: (id: string, gap: number) => void;
  /** A joined tab's pane widths (shares adding up to 1). */
  setSizes: (id: string, sizes: number[] | undefined) => void;
  /** Moves a joined tab's pane to another place among its panes (its width goes with it). */
  movePane: (id: string, from: number, to: number) => void;
  /** Takes one note out of a joined tab into its own tab, just after (the rest stay joined, or become one note's tab). */
  detachPane: (id: string, page: string) => void;
  /** Files the open page under its top-level page's tab (nested pages never get a tab of their own). */
  place: (documentId: string, root: { id: string; title: string }, pageTitle?: string) => void;
  /**
   * The notes to keep ready (the most recently shown open tabs, not the one on screen): the shell keeps their
   * details loaded, so switching to them shows the note at once.
   */
  warm: string[];
}

const MAX_TABS = 12;
/** Notes kept ready to show at once (their details and page tree stay loaded): the most recently used tabs. */
const WARM_TABS = 5;
/**
 * A tab not shown for this long isn't kept ready any more (it holds nothing then; clicking it loads the note from
 * this device as any note opens). Tabs left from an earlier visit count from the window's start.
 */
export const WARM_FOR = 10 * 60_000;

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
  // The pages shown most recently, newest first (this session).
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    if (docId) setRecent((cur) => (cur[0] === docId ? cur : [docId, ...cur.filter((x) => x !== docId)].slice(0, 2 * WARM_TABS)));
  }, [docId]);
  // When each note was last on screen (the one leaving counts from now), and a minute's tick to let go of the
  // ones hidden too long.
  const [startedAt] = useState(() => Date.now());
  const [lastShown, setLastShown] = useState<Record<string, number>>({});
  const [now, setNow] = useState(startedAt);
  const shownBefore = useRef<string | null>(null);
  useEffect(() => {
    const at = Date.now();
    const left = shownBefore.current;
    shownBefore.current = docId;
    setLastShown((cur) => ({ ...cur, ...(left ? { [left]: at } : {}), ...(docId ? { [docId]: at } : {}) }));
    setNow(at);
  }, [docId]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const previousDoc = useRef<string | null>(null);
  useEffect(() => {
    const from = previousDoc.current;
    previousDoc.current = docId;
    // "Open in a new tab" is for the next move to another page, not any update of this one (the address
    // losing "?new=1" used to take it, and the following new note then replaced the current tab).
    const moved = docId !== from;
    // Back or Forward to a page whose tab was closed brings that tab back rather than taking over this one.
    const newTab = moved && (nextInNewTab || cameFromHistory());
    if (moved) nextInNewTab = false;
    if (docId) {
      const open = tabs.findIndex((t) => tabHolds(t, docId));
      if (open !== -1) {
        if (tabPage(tabs[open]!) !== docId) setTabs((cur) => cur.map((t) => (t.id === tabs[open]!.id ? { ...t, at: docId, atTitle: undefined } : t)));
        return;
      }
      const at = from ? tabs.findIndex((t) => tabPage(t) === from) : -1;
      if (at !== -1 && !newTab) {
        // Moving within a note: the current tab follows it (place() then files it under its top page). In a
        // joined tab, the pane with focus follows it.
        const replaced = tabs[at]!;
        if (replaced.panes) setTabs((cur) => cur.map((t) => (t.id === replaced.id ? { ...t, panes: t.panes!.map((p) => (p === from ? docId : p)), at: docId } : t)));
        else setTabs((cur) => cur.map((t) => (t.id === replaced.id ? { id: docId, at: docId, title: "", ...(t.pinned ? { pinned: true } : {}) } : t)));
        return;
      }
      setTabs((cur) => {
        if (cur.some((t) => tabHolds(t, docId))) return cur;
        let next: DocTab[] = [...cur, { id: docId, at: docId, title: "" }];
        // Keep the strip bounded: drop the oldest tabs other than this one (never a pinned one).
        while (next.length > MAX_TABS && next.some((x) => x.id !== docId && !x.pinned)) next = next.filter((t, i) => i !== next.findIndex((x) => x.id !== docId && !x.pinned));
        return next;
      });
    } else if (!["settings", "onboarding", "invite", "share-invite", "folder-invite", "not_found", "help"].includes(route.name)) {
      const href = `${pathname}${query ? `?${query}` : ""}`;
      if (href !== homeHref) setHomeHref(href);
      // Every view you open gets its own tab, which stays until you close it (it follows you inside the view).
      const key = viewKey(route as { name: string; id?: string | null });
      if (key) {
        const kind = route.name;
        setTabs((cur) => {
          const i = cur.findIndex((t) => t.id === key);
          if (i !== -1) return cur[i]!.view?.path === pathname ? cur : cur.map((t) => (t.id === key ? { ...t, view: { kind, path: pathname } } : t));
          let next: DocTab[] = [...cur, { id: key, title: "", view: { kind, path: pathname } }];
          while (next.length > MAX_TABS && next.some((x) => x.id !== key && !x.pinned)) next = next.filter((t, j) => j !== next.findIndex((x) => x.id !== key && !x.pinned));
          return next;
        });
      }
    }
  }, [docId, route.name, pathname, query]); // eslint-disable-line react-hooks/exhaustive-deps

  // Whether a tab is the one on screen (a note's page, or a view at its path).
  const isShown = useCallback((t: DocTab) => (t.view ? t.view.path === pathname : Boolean(docId) && tabHolds(t, docId!)), [pathname, docId]);

  const close = useCallback(
    (id: string) => {
      const i = tabs.findIndex((t) => t.id === id);
      if (i === -1) return;
      const next = tabs.filter((t) => t.id !== id);
      setTabs((cur) => cur.filter((t) => t.id !== id));
      if (isShown(tabs[i]!)) {
        const neighbor = next[i] ?? next[i - 1];
        navigate(neighbor ? tabHref(neighbor) : "/documents");
      }
    },
    [tabs, setTabs, isShown, navigate],
  );
  const closeMany = useCallback(
    (ids: string[], then?: string) => {
      const gone = new Set(ids);
      if (!gone.size) return;
      const next = tabs.filter((t) => !gone.has(t.id));
      setTabs((cur) => cur.filter((t) => !gone.has(t.id)));
      if (tabs.some((t) => gone.has(t.id) && isShown(t))) {
        const stay = next.find((t) => t.id === then);
        navigate(stay ? tabHref(stay) : "/documents");
      }
    },
    [tabs, setTabs, isShown, navigate],
  );

  const move = useCallback(
    (id: string, to: number) => {
      setTabs((cur) => {
        const from = cur.findIndex((t) => t.id === id);
        if (from === -1 || to < 0 || to >= cur.length || from === to) return cur;
        // Pinned tabs stay together at the start: a tab moves only among its own kind.
        if (Boolean(cur[to]!.pinned) !== Boolean(cur[from]!.pinned)) return cur;
        const next = [...cur];
        next.splice(to, 0, ...next.splice(from, 1));
        return next;
      });
    },
    [setTabs],
  );

  const setPinned = useCallback(
    (id: string, pinned: boolean) => {
      setTabs((cur) => {
        const t = cur.find((x) => x.id === id);
        if (!t || Boolean(t.pinned) === pinned) return cur;
        const rest = cur.filter((x) => x.id !== id);
        const edge = rest.filter((x) => x.pinned).length;
        const moved: DocTab = { ...t, pinned: pinned || undefined };
        return [...rest.slice(0, edge), moved, ...rest.slice(edge)];
      });
    },
    [setTabs],
  );

  const join = useCallback(
    (id: string, documentId: string) => {
      const t = tabs.find((x) => x.id === id);
      if (!t || t.view) return;
      const panes = t.panes ?? [tabPage(t)];
      if (panes.length >= MAX_PANES || panes.includes(documentId)) return;
      const joinedId = t.panes ? t.id : `join:${Math.random().toString(36).slice(2, 10)}`;
      setTabs((cur) =>
        cur
          // The note's own tab (if open) merges into this one.
          .filter((x) => x.id === id || !(x.id === documentId || (!x.panes && tabPage(x) === documentId)))
          .map((x) => (x.id === id ? { id: joinedId, title: "", panes: [...panes, documentId], at: documentId, ...(x.pinned ? { pinned: true } : {}) } : x)),
      );
      navigate(`/d/${documentId}`);
    },
    [tabs, setTabs, navigate],
  );

  const unjoin = useCallback(
    (id: string, gap: number) => {
      const t = tabs.find((x) => x.id === id);
      if (!t?.panes || gap < 0 || gap >= t.panes.length - 1) return;
      const side = (panes: string[], sizes: number[] | undefined, keepId: boolean): DocTab => {
        const focus = t.at && panes.includes(t.at) ? t.at : panes[0]!;
        if (panes.length === 1) return { id: panes[0]!, at: panes[0]!, title: "", ...(t.pinned ? { pinned: true } : {}) };
        const total = sizes ? sizes.reduce((a, b) => a + b, 0) : 0;
        return { id: keepId ? t.id : `join:${Math.random().toString(36).slice(2, 10)}`, title: "", panes, at: focus, ...(sizes && total > 0 ? { sizes: sizes.map((s) => s / total) } : {}), ...(t.pinned ? { pinned: true } : {}) };
      };
      const left = side(t.panes.slice(0, gap + 1), t.sizes?.slice(0, gap + 1), true);
      const right = side(t.panes.slice(gap + 1), t.sizes?.slice(gap + 1), false);
      setTabs((cur) => cur.flatMap((x) => (x.id === id ? [left, right] : [x])));
    },
    [tabs, setTabs],
  );

  const setSizes = useCallback(
    (id: string, sizes: number[] | undefined) => {
      setTabs((cur) => cur.map((x) => (x.id === id ? { ...x, sizes } : x)));
    },
    [setTabs],
  );

  const movePane = useCallback(
    (id: string, from: number, to: number) => {
      setTabs((cur) =>
        cur.map((x) => {
          if (x.id !== id || !x.panes || from === to || to < 0 || to >= x.panes.length || from < 0 || from >= x.panes.length) return x;
          const panes = [...x.panes];
          panes.splice(to, 0, ...panes.splice(from, 1));
          const sizes = x.sizes ? [...x.sizes] : undefined;
          if (sizes) sizes.splice(to, 0, ...sizes.splice(from, 1));
          return { ...x, panes, ...(sizes ? { sizes } : {}) };
        }),
      );
    },
    [setTabs],
  );

  const detachPane = useCallback(
    (id: string, page: string) => {
      setTabs((cur) =>
        cur.flatMap((x) => {
          if (x.id !== id || !x.panes?.includes(page)) return [x];
          const i = x.panes.indexOf(page);
          const panes = x.panes.filter((p) => p !== page);
          const own: DocTab = { id: page, at: page, title: "" };
          if (panes.length === 1) return [{ id: panes[0]!, at: panes[0]!, title: "", ...(x.pinned ? { pinned: true } : {}) }, own];
          const kept = x.sizes?.filter((_, j) => j !== i);
          const total = kept?.reduce((a, b) => a + b, 0) ?? 0;
          const at = x.at === page ? panes[0]! : x.at;
          return [{ ...x, panes, at, sizes: kept && total > 0 ? kept.map((v) => v / total) : undefined }, own];
        }),
      );
    },
    [setTabs],
  );

  const place = useCallback(
    (documentId: string, root: { id: string; title: string }, pageTitle?: string) => {
      const i = tabs.findIndex((t) => tabPage(t) === documentId);
      if (i === -1) return;
      const t = tabs[i]!;
      // A joined tab names itself from its panes' titles.
      if (t.panes) return;
      const atTitle = documentId === root.id ? undefined : pageTitle || undefined;
      if (t.id === root.id) {
        if (t.title !== root.title || t.atTitle !== atTitle) setTabs((cur) => cur.map((x) => (x.id === t.id ? { ...x, title: root.title, atTitle } : x)));
        return;
      }
      const j = tabs.findIndex((x) => x.id === root.id);
      if (j !== -1) {
        // The note already has a tab: show this page there and drop the extra one.
        setTabs((cur) => cur.filter((x) => x.id !== t.id).map((x) => (x.id === root.id ? { ...x, at: documentId, title: root.title, atTitle } : x)));
      } else {
        setTabs((cur) => cur.map((x) => (x.id === t.id ? { id: root.id, at: documentId, title: root.title, atTitle } : x)));
      }
    },
    [tabs, setTabs],
  );

  const [view, setViewState] = useState<{ path: string; title: string } | null>(null);
  const setView = useCallback(
    (next: { path: string; title: string }) => {
      setViewState((prev) => (prev && prev.path === next.path && prev.title === next.title ? prev : next));
      // The view's tab takes its name.
      setTabs((cur) => (cur.some((t) => t.view?.path === next.path && t.title !== next.title) ? cur.map((t) => (t.view?.path === next.path ? { ...t, title: next.title } : t)) : cur));
    },
    [setTabs],
  );

  // Switching tabs shows the note at once: the recent tabs' details are already here, and their blocks are
  // on this device (the note catches up with the server once it's showing).
  const warmKey = (() => {
    const notes = tabs.filter((t) => !t.view);
    const open = new Set(notes.flatMap((t) => t.panes ?? [tabPage(t)]));
    const fresh = (id: string) => now - (lastShown[id] ?? startedAt) < WARM_FOR;
    return [...recent, ...notes.flatMap((t) => t.panes ?? [tabPage(t)])]
      .filter((id, i, all) => id !== docId && open.has(id) && all.indexOf(id) === i && fresh(id))
      .slice(0, WARM_TABS)
      .join(",");
  })();
  const warm = useMemo(() => (warmKey ? warmKey.split(",") : []), [warmKey]);
  const value = useMemo(
    () => ({ tabs, view, setView, homeHref, close, closeMany, move, setPinned, join, unjoin, setSizes, movePane, detachPane, place, warm }),
    [tabs, view, setView, homeHref, close, closeMany, move, setPinned, join, unjoin, setSizes, movePane, detachPane, place, warm],
  );
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
    place(documentId, { id: rootId, title: rootTitle }, title || "Untitled");
  }, [place, documentId, rootId, rootTitle, title]);
}
