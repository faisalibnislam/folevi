"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Archive, ArrowLeftToLine, CircleHelp, Settings, ArrowRightToLine, Calendar, CheckSquare, ChevronLeft, ChevronRight, FileDiff, FileText, Files, Folder, Hash, House, Inbox, Layers, LayoutGrid, LayoutList, LayoutTemplate, Lock, Pin, PinOff, Plus, SquareSplitHorizontal, Share2, Star, Trash2, Waypoints, X, XCircle } from "lucide-react";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { tabHolds, tabHref, useTabs, type DocTab } from "@/lib/app/tabs";
import { AiIcon } from "@/components/ai/AiIcon";
import { Button } from "@/components/ui/Button";
import { ContextMenu } from "@/components/ui/Menu";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex/api";
import { useShell } from "./Shell";
import { SidebarMenu } from "./SidebarMenu";
import { SyncStatus } from "./SyncStatus";
import { useCreateDocument } from "./useCreateDocument";
import { BackForward } from "./BackForward";
import { useIpadLayout } from "@/lib/iphone";
import { PillButton } from "@/components/iphone/Glass";
import { useAiAccess } from "@/components/ai/useAi";
import { TabPicture } from "./TabPreview";
import { TabOverview, type OverviewEntry } from "./TabOverview";

/** How wide the strip's soft edges are when it scrolls (the open tab is kept clear of them). */
const FADE = 28;

/** A tab's element in the strip: Home, or a tab by its id. */
function tabElement(strip: HTMLElement, key: string | null): HTMLElement | null {
  if (key === "home") return strip.querySelector<HTMLElement>("[data-tab-home]");
  return key ? strip.querySelector<HTMLElement>(`[data-tab="${CSS.escape(key)}"]`) : null;
}

const ARROW = "grid h-9 w-6 flex-none place-items-center rounded-control text-muted transition-colors hover:bg-accent-soft hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";


/** A view's tab name until the view names it (the same names as the sidebar). */
const VIEW_NAMES: Record<string, string> = {
  ai: "Foli AI",
  graph: "Graph",
  starred: "Starred",
  unsorted: "Drafts",
  notes: "All notes",
  tasks: "Tasks",
  calendar: "Calendar",
  review: "Reviews",
  changes: "Changes",
  daily: "Daily note",
  shared: "Shared with Me",
  templates: "Templates",
  archive: "Archive",
  trash: "Trash",
  folders: "Folders",
  folder: "Folder",
  tags: "Tags",
  tag: "Tag",
  settings: "Settings",
  help: "Help",
};

/** A view's tab icon (the sidebar's). */
function ViewIcon({ kind }: { kind: string }) {
  const c = "flex-none opacity-70";
  switch (kind) {
    case "ai":
      return <AiIcon size={14} />;
    case "graph":
      return <Waypoints size={14} aria-hidden className={c} />;
    case "starred":
      return <Star size={14} aria-hidden className={c} />;
    case "unsorted":
      return <Inbox size={14} aria-hidden className={c} />;
    case "notes":
      return <Files size={14} aria-hidden className={c} />;
    case "tasks":
      return <CheckSquare size={14} aria-hidden className={c} />;
    case "calendar":
    case "daily":
      return <Calendar size={14} aria-hidden className={c} />;
    case "review":
      return <Layers size={14} aria-hidden className={c} />;
    case "changes":
      return <FileDiff size={14} aria-hidden className={c} />;
    case "shared":
      return <Share2 size={14} aria-hidden className={c} />;
    case "templates":
      return <LayoutTemplate size={14} aria-hidden className={c} />;
    case "archive":
      return <Archive size={14} aria-hidden className={c} />;
    case "trash":
      return <Trash2 size={14} aria-hidden className={c} />;
    case "folder":
    case "folders":
      return <Folder size={14} aria-hidden className={c} />;
    case "tag":
    case "tags":
      return <Hash size={14} aria-hidden className={c} />;
    case "settings":
      return <Settings size={14} aria-hidden className={c} />;
    case "help":
      return <CircleHelp size={14} aria-hidden className={c} />;
    case "vault":
      return <Lock size={14} aria-hidden className={c} />;
    default:
      return <LayoutList size={14} aria-hidden className={c} />;
  }
}

/**
 * Top strip: sidebar controls, then a Home tab (the last list view you were on) and one tab per open
 * page. Pages open in tabs; closing the current tab moves to its neighbour.
 */
export function TabStrip() {
  const { sidebarOpen, openAsk } = useShell();
  // The iPad app keeps its tabs (the owner's call, docs/IOS_POLISH_PLAN.md §6 D2), drawn as iPadOS draws them: a
  // glass capsule bar, 40 pt capsule tabs in 15 pt text, chevrons and round glass buttons instead of the Mac's
  // arrows and its dark "New note" button. globals.css (data-ipad-tabs) gives the capsule corners.
  const ipad = useIpadLayout();
  const ai = useAiAccess();
  const { route, pathname } = useAppRouter();
  const { tabs, close, closeMany, move, setPinned, unjoin } = useTabs();
  const { navigate } = useAppRouter();
  // Each tab's title as it is now (a tab only learns its title while its page is open, so one left before
  // its title arrived, or renamed elsewhere, would keep the old one).
  // Each tab's note, and the nested page it shows (titles change elsewhere too).
  const noteTabs = tabs.filter((t) => !t.view);
  const live = useQuery(api.documents.titles, noteTabs.length ? { documentIds: [...new Set(noteTabs.flatMap((t) => t.panes ?? (t.at && t.at !== t.id ? [t.id, t.at] : [t.id])))] } : "skip");
  const paneTitle = (id: string) => live?.[id]?.title || "Untitled";
  // The tab menu (right-click): close this tab, those to its right or left, or all of them.
  const [tabMenu, setTabMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const createDocument = useCreateDocument();
  const docId = route.name === "doc" ? route.id : null;
  // The first tab is always Home (the dashboard); every other view (Foli AI, Graph, Drafts, a folder…) gets a tab
  // of its own that stays until it's closed, like a note's.
  const onHome = route.name === "documents";
  const inFolder = route.name === "folder";

  // Dragging a tab (with a mouse or pen; a finger scrolls the strip): it follows the pointer and trades
  // places with a neighbour once it passes that tab's middle, as tabs do in a browser.
  const drag = useRef<{ id: string; el: HTMLElement; startX: number; grab: number; x: number; dx: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // The tab on screen: Home, a view's tab (by its path) or a note's tab. Keyed on this (not on the route) so the
  // strip follows once the tab itself exists: a new note's tab arrives a render after the address changes.
  const isActive = (t: DocTab) => (t.view ? t.view.path === pathname : Boolean(docId) && tabHolds(t, docId!));
  const activeKey = onHome ? "home" : (tabs.find(isActive)?.id ?? null);
  const order = tabs.map((t) => t.id).join("|");

  // Keep the open tab in view when there are more tabs than fit: fully inside the strip and clear of the
  // soft edges, whenever it changes (opened, new, switched by click, keyboard, Back or Forward, a link),
  // when tabs open or close around it, and when the strip's width changes (the window, the sidebar, or the
  // scroll arrows coming and going).
  const navRef = useRef<HTMLElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });
  const reveal = useRef<(smooth: boolean) => void>(() => undefined);
  reveal.current = (smooth: boolean) => {
    const el = navRef.current;
    if (!el) return;
    const cur = tabElement(el, activeKey);
    if (!cur) return;
    // Scroll the strip itself (not scrollIntoView, which would also move the browser's Tab starting point).
    const box = el.getBoundingClientRect();
    const r = cur.getBoundingClientRect();
    const left = r.left - box.left + el.scrollLeft;
    const right = left + r.width;
    // Room for the edge fade, so the open tab never sits under it (less when the strip is barely wider than the tab).
    const pad = Math.max(0, Math.min(FADE + 4, (el.clientWidth - r.width) / 2));
    const max = el.scrollWidth - el.clientWidth;
    let to = el.scrollLeft;
    if (left - pad < to) to = left - pad;
    else if (right + pad > to + el.clientWidth) to = right + pad - el.clientWidth;
    to = Math.max(0, Math.min(max, Math.round(to)));
    if (Math.abs(to - el.scrollLeft) < 1) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: to, behavior: smooth && !reduce ? "smooth" : "auto" });
  };
  const shownOnce = useRef(false);
  useLayoutEffect(() => {
    // (Not while a tab is being dragged: the strip stays put under the pointer.)
    if (drag.current?.moved) return;
    // The first time without motion (the strip just appeared); after that, smoothly.
    reveal.current(shownOnce.current);
    shownOnce.current = true;
  }, [activeKey, order]);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const update = () => setOverflow({ start: el.scrollLeft > 2, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      update();
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        if (!drag.current?.moved) reveal.current(false);
      }
    });
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  // Tabs coming or going change how far the strip scrolls without a scroll event; the open tab growing (its
  // title typed, or arriving) mustn't push its end out of view.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    setOverflow({ start: el.scrollLeft > 2, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    const cur = tabElement(el, activeKey);
    if (!cur) return;
    let width = cur.offsetWidth;
    const ro = new ResizeObserver(() => {
      if (cur.offsetWidth === width) return;
      width = cur.offsetWidth;
      setOverflow({ start: el.scrollLeft > 2, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
      if (!drag.current?.moved) reveal.current(false);
    });
    ro.observe(cur);
    return () => ro.disconnect();
  }, [activeKey, order]);
  const scrollTabs = (dir: 1 | -1) => {
    const el = navRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: reduce ? "auto" : "smooth" });
  };
  const justDragged = useRef(false);
  const follow = () => {
    const d = drag.current;
    if (!d?.moved) return;
    const r = d.el.getBoundingClientRect();
    const natural = r.left - d.dx;
    const nav = navRef.current?.getBoundingClientRect();
    let left = d.x - d.grab;
    if (nav) left = Math.min(Math.max(left, nav.left), nav.right - r.width);
    d.dx = left - natural;
    d.el.style.transform = `translateX(${d.dx}px)`;
    const i = tabs.findIndex((t) => t.id === d.id);
    const middle = (id: string | undefined) => {
      const box = id ? navRef.current?.querySelector(`[data-tab="${CSS.escape(id)}"]`)?.getBoundingClientRect() : undefined;
      return box ? box.left + box.width / 2 : null;
    };
    const after = middle(tabs[i + 1]?.id);
    const before = middle(tabs[i - 1]?.id);
    if (after !== null && left + r.width > after) move(d.id, i + 1);
    else if (before !== null && left < before) move(d.id, i - 1);
  };
  // After a swap the tab sits in its new slot; keep it under the pointer.
  useLayoutEffect(follow, [tabs]); // eslint-disable-line react-hooks/exhaustive-deps
  const dragStart = (e: PointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0 || e.pointerType === "touch" || (e.target as Element).closest("button")) return;
    const el = e.currentTarget;
    drag.current = { id, el, startX: e.clientX, grab: e.clientX - el.getBoundingClientRect().left, x: e.clientX, dx: 0, moved: false };
  };
  const dragMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.x = e.clientX;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.startX) < 5) return;
      d.moved = true;
      d.el.setPointerCapture(e.pointerId);
      setDragging(d.id);
    }
    follow();
  };
  const dragEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    // Settle into the slot, then let the click that ends the drag pass without opening the tab.
    d.el.style.transition = "transform 150ms var(--ease-folio)";
    d.el.style.transform = "";
    window.setTimeout(() => {
      d.el.style.transition = "";
      setDragging(null);
    }, 150);
    justDragged.current = true;
    window.setTimeout(() => (justDragged.current = false), 0);
  };
  /** A tab's name: a view's, a note's ("Note › Page" inside a nested page), or joined notes' ("A + B"). */
  const labelOf = (t: DocTab) => {
    if (t.view) return t.title || VIEW_NAMES[t.view.kind] || "Page";
    if (t.panes) return t.panes.map(paneTitle).join(" + ");
    const note = live?.[t.id]?.title || t.title || "Untitled";
    const nested = t.at && t.at !== t.id ? live?.[t.at]?.title || t.atTitle || null : null;
    return nested !== null ? `${note} › ${nested || "Untitled"}` : note;
  };
  const iconOf = (t: DocTab | null) =>
    !t ? <House size={14} aria-hidden className="flex-none" /> : t.view ? <ViewIcon kind={t.view.kind} /> : t.panes ? <SquareSplitHorizontal size={14} aria-hidden className="flex-none opacity-70" /> : <FileText size={14} aria-hidden className="flex-none opacity-70" />;

  // Hovering a tab (with a pointer) shows a picture of its page under it, as Safari does: 300 ms after the pointer
  // first rests on a tab, then with no delay at all while it moves along the strip from tab to tab. Nothing hides
  // in between (the gaps between tabs keep the last picture), so it never flickers: it goes when the pointer
  // leaves the strip, a tab is pressed or dragged, or it reaches the open tab.
  const [preview, setPreview] = useState<{ id: string; left: number; top: number } | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether a picture has shown since the pointer came onto the strip (from then on, each tab's shows at once).
  const previewing = useRef(false);
  // The tabs pictured lately, kept drawn (hidden) so going back to one shows it already loaded.
  const [pictured, setPictured] = useState<string[]>([]);
  const showPreview = (e: PointerEvent<HTMLElement>, t: DocTab) => {
    if (e.pointerType !== "mouse" || ipad || drag.current) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    if (isActive(t)) {
      setPreview(null);
      return;
    }
    const el = e.currentTarget;
    const place = () => {
      const r = el.getBoundingClientRect();
      previewing.current = true;
      setPictured((cur) => (cur[0] === t.id ? cur : [t.id, ...cur.filter((x) => x !== t.id)].slice(0, 6)));
      setPreview({ id: t.id, left: Math.min(Math.max(8, r.left + r.width / 2 - 150), window.innerWidth - 308), top: r.bottom + 8 });
    };
    if (previewing.current) place();
    else previewTimer.current = setTimeout(place, 300);
  };
  // Leaving one tab only stops a picture that hasn't shown yet; the next tab's replaces this one.
  const leaveTab = () => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
  };
  const hidePreview = () => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewing.current = false;
    setPreview(null);
  };
  useEffect(() => () => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
  }, []);
  useEffect(() => {
    previewing.current = false;
    setPreview(null);
  }, [activeKey, dragging]);

  // The Tab Overview: every tab as a picture (⌘⇧\ or the button by Back and Forward).
  const [overview, setOverview] = useState(false);
  useEffect(() => {
    if (ipad) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "Backslash") {
        e.preventDefault();
        setOverview((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ipad]);
  const titleMap: Record<string, string> = {};
  for (const t of noteTabs) for (const id of t.panes ?? [t.at ?? t.id]) titleMap[id] = live?.[id]?.title || "";
  const overviewEntries: OverviewEntry[] = [
    { tab: null, key: "home", label: "Home", icon: iconOf(null), active: onHome, href: "/documents" },
    ...tabs.map((t) => ({ tab: t, key: t.id, label: labelOf(t), icon: iconOf(t), active: isActive(t), href: tabHref(t) })),
  ];

  const mask = `linear-gradient(to right, ${overflow.start ? "transparent" : "#000"} 0, #000 ${FADE}px, #000 calc(100% - ${FADE}px), ${overflow.end ? "transparent" : "#000"} 100%)`;
  const tabBase = ipad
    ? "group relative flex h-10 items-center gap-2 rounded-container px-3.5 text-body outline-none transition-[background-color,color,box-shadow] duration-150 ring-focus focus-visible:ring-2 has-[:focus-visible]:ring-2"
    : "group relative flex h-9 items-center gap-2 rounded-control px-2.5 text-subheadline outline-none transition-[background-color,color,box-shadow] duration-150 ring-focus ring-offset-1 ring-offset-canvas focus-visible:ring-2 has-[:focus-visible]:ring-2";
  // Every tab is an outlined rounded rectangle. Closed tabs sit back (a light grey fill, quiet text); the
  // open one comes forward: white, a firm dark outline, a soft shadow and bold text. On the iPad: no outline,
  // the open tab a raised capsule, the others plain text that tints under the finger.
  const tabOn = ipad
    ? "bg-[var(--iphone-row)] font-semibold text-heading shadow-[0_1px_4px_rgb(0_0_0/0.08),0_0_0_0.5px_var(--iphone-separator)]"
    : "bg-[var(--color-surface-raised)] font-semibold text-heading shadow-[0_1px_3px_rgb(0_0_0/0.1),inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-heading)_16.5%,transparent)]";
  const tabOff = ipad
    ? "text-muted active:bg-[var(--liquid-press)] [@media(hover:hover)]:hover:bg-[var(--liquid-active)] [@media(hover:hover)]:hover:text-heading"
    : "bg-[var(--glass-hover)] text-muted hover:bg-[color-mix(in_oklab,var(--glass-active)_70%,transparent)] hover:text-heading";

  return (
    <div
      data-ipad-tabs={ipad ? "" : undefined}
      className={ipad ? "ui-liquid absolute inset-x-2 top-2 z-30 flex h-[52px] items-center gap-1 px-1.5" : `ui-drag ui-glass ui-glass-sidebar absolute inset-x-1 top-1 z-30 flex h-11 items-center gap-1.5 rounded-panel px-1 ${route.name === "vault" ? "!bg-surface" : ""}`}
    >
      {/* While the sidebar is hidden, its menu waits here; otherwise it sits in the sidebar. */}
      {!sidebarOpen ? (
        <>
          {/* In the Mac app, the window's buttons sit here while the sidebar is hidden. */}
          <span aria-hidden className="ui-traffic-space" />
          <SidebarMenu />
          <SyncStatus align="start" documentId={docId ?? undefined} />
          {ipad ? null : <span aria-hidden className="h-5 w-px flex-none bg-black/10" />}
        </>
      ) : null}

      {/* Back and Forward, like a browser's, then a divider before the tab arrows and tabs. */}
      <BackForward ipad={ipad} />
      {ipad ? null : (
        <button type="button" aria-label="Show all tabs" title="Show all tabs (⌘⇧\)" aria-haspopup="dialog" aria-expanded={overview} onClick={() => setOverview(true)} className="grid h-9 w-8 flex-none place-items-center rounded-control text-muted transition-colors hover:bg-accent-soft hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <LayoutGrid size={15} aria-hidden />
        </button>
      )}
      {ipad ? null : <span aria-hidden className="h-5 w-px flex-none bg-black/10" />}

      {/* (A finger scrolls the strip on the iPad: no arrows.) */}
      {!ipad && (overflow.start || overflow.end) ? (
        <button type="button" aria-label="Scroll tabs left" disabled={!overflow.start} onClick={() => scrollTabs(-1)} className={`${ARROW} disabled:opacity-30`}>
          <ChevronLeft size={15} aria-hidden />
        </button>
      ) : null}
      {!ipad && (overflow.start || overflow.end) ? (
        <button type="button" aria-label="Scroll tabs right" disabled={!overflow.end} onClick={() => scrollTabs(1)} className={`${ARROW} disabled:opacity-30`}>
          <ChevronRight size={15} aria-hidden />
        </button>
      ) : null}
      <nav
        ref={navRef}
        onPointerLeave={hidePreview}
        aria-label="Open pages"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
        className="flex min-w-0 flex-initial items-center gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <AppLink
          href="/documents"
          aria-current={onHome ? "page" : undefined}
          data-tab-home=""
          data-ipad-tab={ipad ? "" : undefined}
          // Just the house: Home is the first tab and always there (its name in the tooltip).
          aria-label="Home"
          title={ipad ? undefined : "Home"}
          className={`${tabBase} flex-none ${ipad ? "" : "w-9 justify-center !px-0"} ${onHome ? tabOn : tabOff}`}
        >
          <House size={ipad ? 17 : 15} aria-hidden className="flex-none" />
          {ipad ? <span>Home</span> : null}
        </AppLink>
        {tabs.map((t) => {
          const active = isActive(t);
          const label = labelOf(t);
          const pinned = Boolean(t.pinned);
          const joined = Boolean(t.panes && t.panes.length > 1);
          // Showing a nested page: "Note › Page" (the page's name keeps more room than the note's).
          const note = t.view ? label : live?.[t.id]?.title || t.title || "Untitled";
          const nested = !t.view && !t.panes && t.at && t.at !== t.id ? live?.[t.at]?.title || t.atTitle || null : null;
          // Pinned tabs are half a tab wide (joined ones a little wider, for their notes' icons) and can't be
          // closed until unpinned; joined tabs are as wide as two.
          const width = ipad
            ? `min-w-[150px] pr-1.5 ${active ? "max-w-[260px] flex-none" : "flex-[0_1_260px]"}`
            : pinned
              ? `${joined ? "w-[112px]" : "w-[86px]"} flex-none pr-1`
              : joined
                ? `min-w-[240px] pr-1 ${active ? "max-w-[460px] flex-none" : "flex-[0_1_460px]"}`
                : // The others shrink evenly to their minimum; the open one keeps room for its whole title (up to the
                  // widest a tab gets), so it stays readable however many tabs are open.
                  `min-w-[172px] pr-1 ${active ? "max-w-[284px] flex-none" : "flex-[0_1_284px]"}`;
          const pinButton = ipad ? null : (
            <button
              type="button"
              aria-label={pinned ? `Unpin ${label}` : `Pin ${label}`}
              title={pinned ? "Unpin tab" : "Pin tab"}
              onClick={() => setPinned(t.id, !pinned)}
              className={`grid h-5 w-5 flex-none place-items-center rounded-chip transition-opacity hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:opacity-100 focus-visible:outline-none ${pinned ? "text-muted" : "text-faint opacity-0 group-hover:opacity-100"}`}
            >
              {pinned ? (
                <>
                  <Pin size={11} aria-hidden className="fill-current group-hover:hidden" />
                  <PinOff size={11} aria-hidden className="hidden group-hover:block" />
                </>
              ) : (
                <Pin size={11} aria-hidden />
              )}
            </button>
          );
          return (
            <div
              key={t.id}
              data-tab={t.id}
              data-pinned={pinned ? "" : undefined}
              data-ipad-tab={ipad ? "" : undefined}
              className={`${tabBase} ${width} ${pinned ? "!gap-1 !px-2" : ""} ${active ? tabOn : tabOff} ${dragging === t.id ? "z-10 cursor-grabbing shadow-[0_4px_14px_rgb(0_0_0/0.16)]" : ""}`}
              onPointerDown={(e) => {
                hidePreview();
                dragStart(e, t.id);
              }}
              onPointerMove={dragMove}
              onPointerUp={dragEnd}
              onPointerCancel={dragEnd}
              onPointerEnter={(e) => showPreview(e, t)}
              onPointerLeave={leaveTab}
              onDragStart={(e) => e.preventDefault()}
              onClickCapture={(e) => {
                if (justDragged.current) e.preventDefault();
              }}
              onAuxClick={(e) => {
                if (e.button === 1 && !pinned) {
                  e.preventDefault();
                  close(t.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                hidePreview();
                setTabMenu({ id: t.id, at: { x: e.clientX, y: e.clientY } });
              }}
              // From the keyboard too (the Menu key or Shift+F10 on the tab).
              onKeyDown={(e) => {
                // ⌥⇧← / ⌥⇧→ moves the tab (the keyboard's way to drag it).
                if (e.altKey && e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                  e.preventDefault();
                  const i = tabs.findIndex((x) => x.id === t.id);
                  move(t.id, i + (e.key === "ArrowLeft" ? -1 : 1));
                  return;
                }
                if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setTabMenu({ id: t.id, at: { x: r.left + 8, y: r.bottom + 4 } });
              }}
            >
              {joined ? (
                // Joined notes: one tab, a section per note (each opens the group with that note in focus).
                <span className="flex min-w-0 flex-1 items-center">
                  {t.panes!.map((id, i) => {
                    const here = id === docId;
                    const name = paneTitle(id);
                    return (
                      <span key={id} className={`flex items-center ${pinned ? "flex-none" : "min-w-0 flex-1"}`}>
                        {i > 0 ? <span aria-hidden className="mx-1 h-4 w-px flex-none bg-[color-mix(in_oklab,var(--color-heading)_18%,transparent)]" /> : null}
                        <AppLink
                          href={`/d/${id}`}
                          aria-current={here ? "page" : undefined}
                          aria-label={`${name} (joined)`}
                          className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-chip outline-none ${pinned ? "px-0.5" : "px-0.5"} ${here ? "font-semibold text-heading" : active ? "font-normal text-muted" : ""}`}
                        >
                          <FileText size={13} aria-hidden className="flex-none opacity-70" />
                          {pinned ? null : <span className="truncate">{name}</span>}
                        </AppLink>
                      </span>
                    );
                  })}
                </span>
              ) : (
                <AppLink href={tabHref(t)} aria-current={active ? "page" : undefined} className="flex min-w-0 flex-1 items-center gap-2 outline-none" aria-label={label}>
                  {t.view ? <ViewIcon kind={t.view.kind} /> : <FileText size={14} aria-hidden className="flex-none opacity-70" />}
                  {nested !== null ? (
                    <span className="flex min-w-0 items-center gap-1">
                      <span className="min-w-[2.5rem] max-w-[45%] shrink truncate font-normal text-muted">{note}</span>
                      <ChevronRight size={12} aria-hidden className="flex-none text-faint" />
                      <span className="min-w-0 truncate">{nested || "Untitled"}</span>
                    </span>
                  ) : (
                    <span className="truncate">{label}</span>
                  )}
                </AppLink>
              )}
              {pinButton}
              {pinned ? null : (
                <button
                  type="button"
                  aria-label={`Close ${label}`}
                  onClick={() => close(t.id)}
                  data-ipad-tab-close={ipad ? "" : undefined}
                  className={
                    ipad
                      ? // A finger closes only the open tab (a closed one's × would be too easy to hit); a pointer sees them all on hover.
                        `relative grid h-7 w-7 flex-none place-items-center rounded-container text-muted outline-none transition-opacity before:absolute before:-inset-2 before:content-[''] active:bg-[var(--liquid-press)] focus-visible:opacity-100 ${active ? "opacity-100" : "pointer-events-none opacity-0 [@media(hover:hover)]:group-hover:pointer-events-auto [@media(hover:hover)]:group-hover:opacity-100"}`
                      : `grid h-5 w-5 flex-none place-items-center rounded-chip text-faint transition-opacity hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:opacity-100 focus-visible:outline-none ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`
                  }
                >
                  <X size={ipad ? 15 : 12} strokeWidth={ipad ? 2.4 : 2} aria-hidden />
                </button>
              )}
            </div>
          );
        })}
      </nav>
      {tabMenu ? (() => {
        const i = tabs.findIndex((t) => t.id === tabMenu.id);
        if (i < 0) return null;
        const t = tabs[i]!;
        // Pinned tabs stay through "close others" (unpin one to close it).
        const left = tabs.slice(0, i).filter((x) => !x.pinned).map((x) => x.id);
        const right = tabs.slice(i + 1).filter((x) => !x.pinned).map((x) => x.id);
        const joinedPanes = t.panes && t.panes.length > 1 ? t.panes.length : 0;
        return (
          <ContextMenu
            at={tabMenu.at}
            label="Tab options"
            onClose={() => setTabMenu(null)}
            items={[
              t.pinned
                ? { label: "Unpin tab", icon: <PinOff size={14} />, onSelect: () => setPinned(tabMenu.id, false) }
                : { label: "Pin tab", icon: <Pin size={14} />, onSelect: () => setPinned(tabMenu.id, true) },
              ...(joinedPanes
                ? [{ label: joinedPanes > 2 ? "Unjoin all notes" : "Unjoin notes", icon: <SquareSplitHorizontal size={14} />, onSelect: () => {
                    // Split from the right so each gap's index stays valid.
                    for (let g = joinedPanes - 2; g >= 0; g--) unjoin(tabMenu.id, g);
                  } }]
                : []),
              "separator",
              { label: "Close tab", icon: <X size={14} />, disabled: Boolean(t.pinned), onSelect: () => close(tabMenu.id) },
              { label: "Close tabs to the right", icon: <ArrowRightToLine size={14} />, disabled: !right.length, onSelect: () => closeMany(right, tabMenu.id) },
              { label: "Close tabs to the left", icon: <ArrowLeftToLine size={14} />, disabled: !left.length, onSelect: () => closeMany(left, tabMenu.id) },
              "separator",
              { label: "Close all tabs", icon: <XCircle size={14} />, danger: true, onSelect: () => closeMany(tabs.filter((x) => !x.pinned).map((x) => x.id)) },
            ]}
          />
        );
      })() : null}
      {preview
        ? (() => {
            const t = tabs.find((x) => x.id === preview.id);
            if (!t) return null;
            const label = labelOf(t);
            return createPortal(
              <div
                aria-hidden
                className="pointer-events-none fixed z-[60] w-[300px] overflow-hidden rounded-container border border-line bg-[var(--color-surface-raised)] shadow-[0_12px_36px_rgb(0_0_0/0.18)]"
                style={{ left: preview.left, top: preview.top }}
              >
                {/* The tabs pictured lately stay drawn, one over another: switching shows a page already there. */}
                <div className="relative aspect-[16/10] w-full">
                  {pictured.map((id) => {
                    const pt = tabs.find((x) => x.id === id);
                    if (!pt) return null;
                    return (
                      <div key={id} className="absolute inset-0" style={{ visibility: id === t.id ? "visible" : "hidden" }}>
                        <TabPicture tab={pt} titles={titleMap} viewIcon={iconOf(pt)} viewName={labelOf(pt)} className="h-full w-full" />
                      </div>
                    );
                  })}
                </div>
                <div className="truncate border-t border-line px-3 py-2 text-subheadline font-semibold text-heading">{label}</div>
              </div>,
              document.body,
            );
          })()
        : null}
      {overview ? (
        <TabOverview
          entries={overviewEntries}
          titles={titleMap}
          onOpen={(href) => {
            setOverview(false);
            navigate(href);
          }}
          onCloseTab={(id) => close(id)}
          onNewNote={() => {
            setOverview(false);
            void createDocument({});
          }}
          onDismiss={() => setOverview(false)}
        />
      ) : null}
      <div className="flex-1" />
      {ipad ? (
        // Foli AI (the Mac's floating pill has no place on an iPad) and New note, as round glass buttons.
        <>
          {ai.on ? (
            <PillButton label="Foli AI" onClick={() => openAsk()}>
              <AiIcon size={20} />
            </PillButton>
          ) : null}
          <PillButton label={inFolder ? "New note in this folder" : "New note"} onClick={() => void createDocument({})}>
            <Plus size={22} strokeWidth={2.2} aria-hidden />
          </PillButton>
        </>
      ) : (
      <Button size="sm" variant="primary" title={inFolder ? "New note in this folder (⌘⌥N)" : "New note (⌘⌥N)"} onClick={() => void createDocument({})} className="h-9 flex-none rounded-control">
        <Plus size={14} aria-hidden /> New note
      </Button>
      )}
    </div>
  );
}
