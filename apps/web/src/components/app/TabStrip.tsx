"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { Archive, ArrowLeftToLine, CircleHelp, Settings, ArrowRightToLine, Calendar, CheckSquare, ChevronLeft, ChevronRight, FileText, Files, Folder, Hash, House, Inbox, LayoutList, LayoutTemplate, Plus, Share2, Star, Trash2, Waypoints, X, XCircle } from "lucide-react";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { tabHref, tabPage, useTabs } from "@/lib/app/tabs";
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

const ARROW = "grid h-9 w-6 flex-none place-items-center rounded-control text-muted transition-colors hover:bg-accent-soft hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";


/** A view's tab name until the view names it (the same names as the sidebar). */
const VIEW_NAMES: Record<string, string> = {
  ai: "Foli",
  graph: "Graph",
  starred: "Starred",
  unsorted: "Drafts",
  notes: "All notes",
  tasks: "Tasks",
  calendar: "Calendar",
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
    default:
      return <LayoutList size={14} aria-hidden className={c} />;
  }
}

/**
 * Top strip: sidebar controls, then a Home tab (the last list view you were on) and one tab per open
 * page. Pages open in tabs; closing the current tab moves to its neighbour.
 */
export function TabStrip() {
  const { sidebarOpen } = useShell();
  const { route, pathname } = useAppRouter();
  const { tabs, close, closeMany, move } = useTabs();
  // Each tab's title as it is now (a tab only learns its title while its page is open, so one left before
  // its title arrived, or renamed elsewhere, would keep the old one).
  // Each tab's note, and the nested page it shows (titles change elsewhere too).
  const noteTabs = tabs.filter((t) => !t.view);
  const live = useQuery(api.documents.titles, noteTabs.length ? { documentIds: [...new Set(noteTabs.flatMap((t) => (t.at && t.at !== t.id ? [t.id, t.at] : [t.id])))] } : "skip");
  // The tab menu (right-click): close this tab, those to its right or left, or all of them.
  const [tabMenu, setTabMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const createDocument = useCreateDocument();
  const docId = route.name === "doc" ? route.id : null;
  // The first tab is always Home (the dashboard); every other view (Foli, Graph, Drafts, a folder…) gets a tab
  // of its own that stays until it's closed, like a note's.
  const onHome = route.name === "documents";
  const inFolder = route.name === "folder";

  // Keep the open tab in view when there are more tabs than fit.
  const navRef = useRef<HTMLElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    // Scroll the strip itself (not scrollIntoView, which would also move the browser's Tab starting point).
    const cur = el.querySelector<HTMLElement>('[aria-current="page"]')?.closest<HTMLElement>(".group") ?? el.querySelector<HTMLElement>('[aria-current="page"]');
    if (cur) {
      const left = cur.offsetLeft - el.offsetLeft;
      if (left < el.scrollLeft) el.scrollLeft = left - 8;
      else if (left + cur.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = left + cur.offsetWidth - el.clientWidth + 8;
    }
    const update = () => setOverflow({ start: el.scrollLeft > 2, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [docId, tabs.length]);
  const scrollTabs = (dir: 1 | -1) => {
    const el = navRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: reduce ? "auto" : "smooth" });
  };
  // Dragging a tab (with a mouse or pen; a finger scrolls the strip): it follows the pointer and trades
  // places with a neighbour once it passes that tab's middle, as tabs do in a browser.
  const drag = useRef<{ id: string; el: HTMLElement; startX: number; grab: number; x: number; dx: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
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
  const fade = 28;
  const mask = `linear-gradient(to right, ${overflow.start ? "transparent" : "#000"} 0, #000 ${fade}px, #000 calc(100% - ${fade}px), ${overflow.end ? "transparent" : "#000"} 100%)`;
  const tabBase = "group relative flex h-9 items-center gap-2 rounded-control px-2.5 text-[13px] outline-none transition-[background-color,color,box-shadow] duration-150 ring-focus ring-offset-1 ring-offset-canvas focus-visible:ring-2 has-[:focus-visible]:ring-2";
  // Every tab is an outlined rounded rectangle. Closed tabs sit back (a light grey fill, quiet text); the
  // open one comes forward: white, a firm dark outline, a soft shadow and bold text.
  const tabOn = "bg-[var(--color-surface-raised)] font-semibold text-heading shadow-[0_1px_3px_rgb(0_0_0/0.1),inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-heading)_16.5%,transparent)]";
  const tabOff = "bg-[var(--glass-hover)] text-muted hover:bg-[color-mix(in_oklab,var(--glass-active)_70%,transparent)] hover:text-heading";

  return (
    <div className="ui-drag ui-glass ui-glass-sidebar absolute inset-x-1 top-1 z-30 flex h-11 items-center gap-1.5 rounded-panel px-1">
      {/* While the sidebar is hidden, its menu waits here; otherwise it sits in the sidebar. */}
      {!sidebarOpen ? (
        <>
          {/* In the Mac app, the window's buttons sit here while the sidebar is hidden. */}
          <span aria-hidden className="ui-traffic-space" />
          <SidebarMenu />
          <SyncStatus align="start" documentId={docId ?? undefined} />
          <span aria-hidden className="h-5 w-px flex-none bg-black/10" />
        </>
      ) : null}

      {/* Back and Forward, like a browser's, then a divider before the tab arrows and tabs. */}
      <BackForward />
      <span aria-hidden className="h-5 w-px flex-none bg-black/10" />

      {overflow.start || overflow.end ? (
        <button type="button" aria-label="Scroll tabs left" disabled={!overflow.start} onClick={() => scrollTabs(-1)} className={`${ARROW} disabled:opacity-30`}>
          <ChevronLeft size={15} aria-hidden />
        </button>
      ) : null}
      {overflow.start || overflow.end ? (
        <button type="button" aria-label="Scroll tabs right" disabled={!overflow.end} onClick={() => scrollTabs(1)} className={`${ARROW} disabled:opacity-30`}>
          <ChevronRight size={15} aria-hidden />
        </button>
      ) : null}
      <nav
        ref={navRef}
        aria-label="Open pages"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
        className="flex min-w-0 flex-initial items-center gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <AppLink
          href="/documents"
          aria-current={onHome ? "page" : undefined}
          className={`${tabBase} flex-none ${onHome ? tabOn : tabOff}`}
        >
          <House size={14} aria-hidden className="flex-none" />
          <span>Home</span>
        </AppLink>
        {tabs.map((t) => {
          const active = t.view ? t.view.path === pathname : tabPage(t) === docId;
          const note = t.view ? t.title || VIEW_NAMES[t.view.kind] || "Page" : live?.[t.id]?.title || t.title || "Untitled";
          // Showing a nested page: "Note › Page" (the page's name keeps more room than the note's).
          const nested = !t.view && t.at && t.at !== t.id ? live?.[t.at]?.title || t.atTitle || null : null;
          const label = nested !== null ? `${note} › ${nested || "Untitled"}` : note;
          return (
            <div
              key={t.id}
              data-tab={t.id}
              className={`${tabBase} min-w-[172px] flex-[0_1_284px] pr-1 ${active ? tabOn : tabOff} ${dragging === t.id ? "z-10 cursor-grabbing shadow-[0_4px_14px_rgb(0_0_0/0.16)]" : ""}`}
              onPointerDown={(e) => dragStart(e, t.id)}
              onPointerMove={dragMove}
              onPointerUp={dragEnd}
              onPointerCancel={dragEnd}
              onDragStart={(e) => e.preventDefault()}
              onClickCapture={(e) => {
                if (justDragged.current) e.preventDefault();
              }}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  close(t.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
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
              <AppLink href={tabHref(t)} aria-current={active ? "page" : undefined} className="flex min-w-0 flex-1 items-center gap-2 outline-none" title={label} aria-label={label}>
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
              <button
                type="button"
                aria-label={`Close ${label}`}
                onClick={() => close(t.id)}
                className={`grid h-5 w-5 flex-none place-items-center rounded-chip text-faint transition-opacity hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:opacity-100 focus-visible:outline-none ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
              >
                <X size={12} aria-hidden />
              </button>
            </div>
          );
        })}
      </nav>
      {tabMenu ? (() => {
        const i = tabs.findIndex((t) => t.id === tabMenu.id);
        if (i < 0) return null;
        const left = tabs.slice(0, i).map((t) => t.id);
        const right = tabs.slice(i + 1).map((t) => t.id);
        return (
          <ContextMenu
            at={tabMenu.at}
            label="Tab options"
            onClose={() => setTabMenu(null)}
            items={[
              { label: "Close tab", icon: <X size={14} />, onSelect: () => close(tabMenu.id) },
              { label: "Close tabs to the right", icon: <ArrowRightToLine size={14} />, disabled: !right.length, onSelect: () => closeMany(right, tabMenu.id) },
              { label: "Close tabs to the left", icon: <ArrowLeftToLine size={14} />, disabled: !left.length, onSelect: () => closeMany(left, tabMenu.id) },
              "separator",
              { label: "Close all tabs", icon: <XCircle size={14} />, danger: true, onSelect: () => closeMany(tabs.map((t) => t.id)) },
            ]}
          />
        );
      })() : null}
      <div className="flex-1" />
      {/* Always here: a new note opens in its own tab (in the open folder, else in Drafts). */}
      <Button size="sm" variant="primary" title={inFolder ? "New note in this folder (⌘⌥N)" : "New note (⌘⌥N)"} onClick={() => void createDocument({})} className="h-9 flex-none rounded-control">
        <Plus size={14} aria-hidden /> New note
      </Button>
    </div>
  );
}
