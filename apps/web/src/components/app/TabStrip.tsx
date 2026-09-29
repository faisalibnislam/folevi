"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Folder, Hash, House, LayoutList, Plus, X } from "lucide-react";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { tabPage, useTabs } from "@/lib/app/tabs";
import { Button } from "@/components/ui/Button";
import { useShell } from "./Shell";
import { SidebarMenu } from "./SidebarMenu";
import { SyncStatus } from "./SyncStatus";
import { useCreateDocument } from "./useCreateDocument";
import { UpButton } from "./UpButton";

const ARROW = "grid h-8 w-6 flex-none place-items-center rounded-[6px] text-muted transition-colors hover:bg-accent-soft hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";


/**
 * Top strip: sidebar controls, then a Home tab (the last list view you were on) and one tab per open
 * page. Pages open in tabs; closing the current tab moves to its neighbour.
 */
export function TabStrip() {
  const { sidebarOpen } = useShell();
  const { route, pathname } = useAppRouter();
  const { tabs, close, view } = useTabs();
  const createDocument = useCreateDocument();
  const docId = route.name === "doc" ? route.id : null;
  // The first tab is always Home (the dashboard); other list views don't take it over. While one is open it
  // gets a tab of its own next to Home (named by the view itself, for this path only, so it's never stale).
  const onHome = route.name === "documents";
  const viewTab = !docId && !onHome ? (view?.path === pathname ? view.title : null) : null;
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
  const fade = 28;
  const mask = `linear-gradient(to right, ${overflow.start ? "transparent" : "#000"} 0, #000 ${fade}px, #000 calc(100% - ${fade}px), ${overflow.end ? "transparent" : "#000"} 100%)`;
  const tabBase = "group relative flex h-8 items-center gap-2 rounded-[6px] px-2.5 text-[13px] outline-none transition-[background-color,color,box-shadow] duration-150 ring-focus ring-offset-1 ring-offset-canvas focus-visible:ring-2 has-[:focus-visible]:ring-2";
  // Every tab is an outlined rounded rectangle. Closed tabs sit back (a light grey fill, quiet text); the
  // open one comes forward: white, a firm dark outline, a soft shadow and bold text.
  const tabOn = "bg-[var(--color-surface-raised)] font-semibold text-heading shadow-[0_1px_3px_rgb(0_0_0/0.1),inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-heading)_16.5%,transparent)]";
  const tabOff = "bg-[var(--glass-hover)] text-muted hover:bg-[color-mix(in_oklab,var(--glass-active)_70%,transparent)] hover:text-heading";

  return (
    <div className="ui-glass ui-glass-sidebar absolute inset-x-2 top-2 z-30 flex h-11 items-center gap-1.5 rounded-[12px] px-1.5">
      {/* While the sidebar is hidden, its menu waits here; otherwise it sits in the sidebar. */}
      {!sidebarOpen ? (
        <>
          <SidebarMenu />
          <SyncStatus align="start" documentId={docId ?? undefined} />
          <span aria-hidden className="h-5 w-px flex-none bg-black/10" />
        </>
      ) : null}

      {/* Up a level (parent page, folder, …), then a divider before the tab arrows and tabs. */}
      <UpButton />
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
        {/* Any other list view (a folder, Drafts, Trash…) shows as the current tab while it's open. */}
        {viewTab ? (
          // The page you're on (not a link: it would only lead here); the sidebar and Up move between views.
          <span aria-current="page" title={viewTab} className={`${tabBase} min-w-0 max-w-[240px] flex-none cursor-default ${tabOn}`}>
            {route.name === "folder" || route.name === "folders" ? (
              <Folder size={14} aria-hidden className="flex-none" />
            ) : route.name === "tag" || route.name === "tags" ? (
              <Hash size={14} aria-hidden className="flex-none" />
            ) : (
              <LayoutList size={14} aria-hidden className="flex-none" />
            )}
            <span className="truncate">{viewTab}</span>
          </span>
        ) : null}
        {tabs.map((t) => {
          const active = tabPage(t) === docId;
          const label = t.title || "Untitled";
          return (
            <div
              key={t.id}
              className={`${tabBase} min-w-[172px] flex-[0_1_284px] pr-1 ${active ? tabOn : tabOff}`}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  close(t.id);
                }
              }}
            >
              <AppLink href={`/d/${tabPage(t)}`} aria-current={active ? "page" : undefined} className="flex min-w-0 flex-1 items-center gap-2 outline-none" title={label}>
                <FileText size={14} aria-hidden className="flex-none opacity-70" />
                <span className="truncate">{label}</span>
              </AppLink>
              <button
                type="button"
                aria-label={`Close ${label}`}
                onClick={() => close(t.id)}
                className={`grid h-5 w-5 flex-none place-items-center rounded-[4px] text-faint transition-opacity hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:opacity-100 focus-visible:outline-none ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
              >
                <X size={12} aria-hidden />
              </button>
            </div>
          );
        })}
      </nav>
      <div className="flex-1" />
      {/* Always here: a new note opens in its own tab (in the open folder, else in Drafts). */}
      <Button size="sm" variant="primary" title={inFolder ? "New note in this folder (⌘⌥N)" : "New note (⌘⌥N)"} onClick={() => void createDocument({})} className="flex-none">
        <Plus size={14} aria-hidden /> New note
      </Button>
    </div>
  );
}
