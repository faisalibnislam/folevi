"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Pin, Plus, Search, X } from "lucide-react";
import type { DocTab } from "@/lib/app/tabs";
import { TAB_PICTURE_BOX, TabPictureFor } from "./TabPictures";

export interface OverviewEntry {
  /** The tab, or null for Home. */
  tab: DocTab | null;
  key: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  href: string;
}

/** Where the overview sits in the window (CSS px from each edge): under the top bar, inside the page's panel. */
export interface OverviewFrame {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

/** The next tile from `from` in a direction, by where the tiles are on screen (rows can hold wider tiles). */
export function nextTile(rects: { x: number; y: number; w: number; h: number }[], from: number, key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"): number {
  if (key === "ArrowLeft") return Math.max(0, from - 1);
  if (key === "ArrowRight") return Math.min(rects.length - 1, from + 1);
  const at = rects[from];
  if (!at) return from;
  const cx = at.x + at.w / 2;
  const down = key === "ArrowDown";
  // The nearest row above or below, then the tile in it whose middle is closest to this one's.
  const rows = rects.map((r, i) => ({ r, i })).filter(({ r }) => (down ? r.y > at.y + at.h / 2 : r.y + r.h < at.y + at.h / 2));
  if (!rows.length) return from;
  const rowY = down ? Math.min(...rows.map(({ r }) => r.y)) : Math.max(...rows.map(({ r }) => r.y));
  const row = rows.filter(({ r }) => Math.abs(r.y - rowY) < 2);
  row.sort((a, b) => Math.abs(a.r.x + a.r.w / 2 - cx) - Math.abs(b.r.x + b.r.w / 2 - cx));
  return row[0]!.i;
}

/**
 * Every open tab at once (the owner's redesign, 2026-11-25): each tab as what it holds, a note as its card (Home's
 * Recent notes card), notes side by side as their cards side by side, a folder as its folder card, Home and the
 * other views as a small drawing of the page, with the tab's name under it. It fills the page's panel under the
 * top bar, so the window's buttons, the tabs and New note stay where they are. Search them, open one, close them,
 * or start a new note; Esc or Done closes it.
 */
export function TabOverview({
  entries,
  titles,
  frame,
  onOpen,
  onCloseTab,
  onNewNote,
  onDismiss,
}: {
  entries: OverviewEntry[];
  titles: Record<string, string>;
  frame?: OverviewFrame | null;
  onOpen: (href: string) => void;
  onCloseTab: (id: string) => void;
  onNewNote: () => void;
  onDismiss: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (q ? entries.filter((e) => e.label.toLowerCase().includes(q)) : entries), [entries, q]);
  const [sel, setSel] = useState(() => Math.max(0, entries.findIndex((e) => e.active)));
  // Typing a search starts from its first match (opening starts on the tab on screen).
  const searched = useRef(false);
  useEffect(() => {
    if (!searched.current && !q) return;
    searched.current = true;
    setSel(0);
  }, [q]);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    grid.current?.querySelector<HTMLElement>(`[data-overview-index="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);
  // In, with a short fade and settle (not when motion is reduced).
  const [shownIn, setShownIn] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setShownIn(true));
    return () => cancelAnimationFrame(r);
  }, []);
  const tiles = () => [...(grid.current?.querySelectorAll<HTMLElement>("[data-overview-index]") ?? [])].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const last = q ? shown.length - 1 : shown.length; // the New note tile comes after the tabs

  const place = frame ? { top: frame.top, left: frame.left, right: frame.right, bottom: frame.bottom } : { top: 0, left: 0, right: 0, bottom: 0 };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="All tabs"
      data-tab-overview=""
      style={place}
      className={`fixed z-[70] flex flex-col overflow-hidden bg-[var(--color-canvas)] transition-[opacity,transform] duration-200 ease-[var(--ease-folio)] motion-reduce:transition-none ${frame ? "rounded-panel shadow-[0_0_0_0.5px_rgb(0_0_0/0.08)]" : ""} ${shownIn ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") onDismiss();
        else if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowDown" || e.key === "ArrowUp") {
          // In the search field, Left and Right move the caret.
          if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.target instanceof HTMLInputElement && query) return;
          setSel((s) => Math.min(last, nextTile(tiles(), Math.min(s, last), e.key as "ArrowLeft")));
        } else if (e.key === "Enter") {
          if (sel === shown.length) onNewNote();
          else if (shown[sel]) onOpen(shown[sel]!.href);
        } else return;
        e.preventDefault();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div className="flex flex-none items-center gap-3 px-8 pb-2 pt-5">
        <h2 className="ui-display text-title-2 font-semibold text-heading">
          {entries.length} {entries.length === 1 ? "tab" : "tabs"}
        </h2>
        <div className="flex-1" />
        <label className="flex h-8 w-64 min-w-0 items-center gap-2 rounded-control border border-line bg-[var(--color-surface-raised)] px-2.5 text-subheadline focus-within:ring-2 focus-within:ring-focus">
          <Search size={14} aria-hidden className="text-faint" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tabs" aria-label="Search tabs" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint" />
          {query ? (
            <button type="button" aria-label="Clear search" title="Clear" onClick={() => setQuery("")} className="ui-hit grid h-5 w-5 place-items-center rounded-chip text-faint hover:bg-[var(--glass-hover)] hover:text-heading">
              <X size={12} aria-hidden />
            </button>
          ) : null}
        </label>
        <button type="button" onClick={onDismiss} className="ui-hit h-8 rounded-control px-3 text-subheadline font-semibold text-heading hover:bg-[var(--glass-hover)]">
          Done
        </button>
      </div>
      <div
        ref={grid}
        className="grid min-h-0 flex-1 auto-rows-max grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-x-8 gap-y-7 overflow-y-auto px-8 pb-10 pt-5"
        onClick={(e) => {
          if (e.target === e.currentTarget) onDismiss();
        }}
      >
        {shown.length === 0 ? <p className="col-span-full py-10 text-center text-subheadline text-muted">No tabs match “{query.trim()}”.</p> : null}
        {shown.map((e, i) => {
          const pinned = Boolean(e.tab?.pinned);
          const closable = Boolean(e.tab) && !pinned;
          const split = (e.tab?.panes?.length ?? 0) > 1;
          return (
            <div key={e.key} data-overview-index={i} className={`group relative flex min-w-0 flex-col items-center gap-2.5 ${split ? "col-span-2" : ""}`} onMouseEnter={() => setSel(i)}>
              <button
                type="button"
                aria-label={`Open ${e.label}`}
                aria-current={e.active ? "page" : undefined}
                onClick={() => onOpen(e.href)}
                className={`relative block w-full rounded-container p-2 text-left outline-none transition-[background-color,box-shadow,transform] duration-150 ease-[var(--ease-folio)] hover:-translate-y-0.5 ${i === sel ? "bg-[var(--glass-hover)] ring-2 ring-focus" : e.active ? "bg-[var(--glass-hover)] ring-[1.5px] ring-[color-mix(in_oklab,var(--color-heading)_35%,transparent)]" : ""}`}
              >
                <span className={split ? "relative block w-full aspect-[50/27]" : TAB_PICTURE_BOX + " block"}>
                  <TabPictureFor tab={e.tab} titles={titles} label={e.label} icon={e.icon} />
                </span>
              </button>
              {closable ? (
                <button
                  type="button"
                  aria-label={`Close ${e.label}`}
                  title="Close tab"
                  onClick={() => onCloseTab(e.tab!.id)}
                  className="ui-raised absolute -left-1.5 -top-1.5 z-10 grid h-6 w-6 place-items-center rounded-chip text-muted opacity-0 transition-opacity hover:text-heading focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus group-hover:opacity-100 pointer-coarse:opacity-100"
                >
                  <X size={13} aria-hidden />
                </button>
              ) : pinned ? (
                <span className="ui-raised absolute -left-1.5 -top-1.5 z-10 grid h-6 w-6 place-items-center rounded-chip text-muted">
                  <Pin size={12} aria-label="Pinned" />
                </span>
              ) : null}
              <span className="flex max-w-full min-w-0 items-center justify-center gap-1.5 px-1 text-subheadline">
                {e.icon}
                <span className={`truncate ${e.active ? "font-semibold text-heading" : "text-ink"}`}>{e.label}</span>
              </span>
            </div>
          );
        })}
        {!q ? (
          <div data-overview-index={shown.length} className="flex min-w-0 flex-col items-center gap-2.5" onMouseEnter={() => setSel(shown.length)}>
            <button
              type="button"
              onClick={onNewNote}
              aria-label="New note"
              className={`block w-full rounded-container p-2 text-faint outline-none transition-colors hover:text-heading ${sel === shown.length ? "bg-[var(--glass-hover)] ring-2 ring-focus" : ""}`}
            >
              <span className={`${TAB_PICTURE_BOX} grid place-items-center rounded-l-tiny rounded-r-small border-2 border-dashed border-line`}>
                <Plus size={36} strokeWidth={1.5} aria-hidden />
              </span>
            </button>
            <span className="text-subheadline text-muted">New note</span>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
