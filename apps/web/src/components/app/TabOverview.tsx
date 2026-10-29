"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Pin, Plus, Search, X } from "lucide-react";
import type { DocTab } from "@/lib/app/tabs";
import { TabPicture } from "./TabPreview";

export interface OverviewEntry {
  /** The tab, or null for Home. */
  tab: DocTab | null;
  key: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  href: string;
}

/**
 * Every open tab at once, as pictures of their pages (like Safari's tab overview and Mission Control): search
 * them, open one, close them, or start a new note. Esc or the same button closes it.
 */
export function TabOverview({
  entries,
  titles,
  onOpen,
  onCloseTab,
  onNewNote,
  onDismiss,
}: {
  entries: OverviewEntry[];
  titles: Record<string, string>;
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
  const [cols, setCols] = useState(4);
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCols(Math.max(1, getComputedStyle(el).gridTemplateColumns.split(" ").length)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    grid.current?.querySelector<HTMLElement>(`[data-overview-index="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);
  // In, with a short zoom (not when motion is reduced).
  const [shownIn, setShownIn] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setShownIn(true));
    return () => cancelAnimationFrame(r);
  }, []);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Tab Overview"
      className={`fixed inset-0 z-[70] flex flex-col bg-[color-mix(in_oklab,var(--color-canvas)_82%,transparent)] backdrop-blur-xl transition-opacity duration-200 motion-reduce:transition-none ${shownIn ? "opacity-100" : "opacity-0"}`}
      onKeyDown={(e) => {
        const last = shown.length; // the New note card comes after the tabs
        if (e.key === "Escape") onDismiss();
        else if (e.key === "ArrowRight") setSel((s) => Math.min(last, s + 1));
        else if (e.key === "ArrowLeft") setSel((s) => Math.max(0, s - 1));
        else if (e.key === "ArrowDown") setSel((s) => Math.min(last, s + cols));
        else if (e.key === "ArrowUp") setSel((s) => Math.max(0, s - cols));
        else if (e.key === "Enter") {
          if (sel === last) onNewNote();
          else if (shown[sel]) onOpen(shown[sel]!.href);
        } else return;
        e.preventDefault();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div className="flex flex-none items-center gap-3 px-8 pb-2 pt-5">
        <h2 className="text-headline font-semibold text-heading">
          {entries.length} {entries.length === 1 ? "tab" : "tabs"}
        </h2>
        <div className="flex-1" />
        <label className="flex h-9 w-72 items-center gap-2 rounded-control border border-line bg-[var(--color-surface-raised)] px-2.5 text-subheadline shadow-sm focus-within:ring-2 focus-within:ring-focus">
          <Search size={14} aria-hidden className="text-faint" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tabs" aria-label="Search tabs" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint" />
          {query ? (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="grid h-5 w-5 place-items-center rounded-chip text-faint hover:text-heading">
              <X size={12} aria-hidden />
            </button>
          ) : null}
        </label>
        <button type="button" onClick={onDismiss} className="h-9 rounded-control px-3 text-subheadline font-semibold text-heading hover:bg-[var(--glass-hover)]">
          Done
        </button>
      </div>
      <div
        ref={grid}
        className={`grid min-h-0 flex-1 auto-rows-max grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6 overflow-y-auto px-8 pb-10 pt-4 transition-transform duration-200 motion-reduce:transition-none ${shownIn ? "scale-100" : "scale-[0.97]"}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) onDismiss();
        }}
      >
        {shown.length === 0 ? <p className="col-span-full py-10 text-center text-subheadline text-muted">No tabs match “{query.trim()}”.</p> : null}
        {shown.map((e, i) => {
          const pinned = Boolean(e.tab?.pinned);
          const closable = Boolean(e.tab) && !pinned;
          return (
            <div
              key={e.key}
              data-overview-index={i}
              className={`group relative flex flex-col overflow-hidden rounded-container bg-[var(--color-surface-raised)] shadow-[0_2px_10px_rgb(0_0_0/0.08)] outline-none transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_26px_rgb(0_0_0/0.14)] ${i === sel ? "ring-2 ring-focus" : e.active ? "ring-[1.5px] ring-[color-mix(in_oklab,var(--color-heading)_30%,transparent)]" : ""}`}
              onMouseEnter={() => setSel(i)}
            >
              <div className="flex h-10 flex-none items-center gap-2 px-3 text-subheadline">
                {closable ? (
                  <button
                    type="button"
                    aria-label={`Close ${e.label}`}
                    onClick={() => onCloseTab(e.tab!.id)}
                    className="grid h-5 w-5 flex-none place-items-center rounded-chip text-faint hover:bg-[var(--glass-hover)] hover:text-heading"
                  >
                    <X size={13} aria-hidden />
                  </button>
                ) : (
                  <span className="grid h-5 w-5 flex-none place-items-center text-faint">{pinned ? <Pin size={12} aria-label="Pinned" /> : null}</span>
                )}
                <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5 pr-5">
                  {e.icon}
                  <span className={`truncate ${e.active ? "font-semibold text-heading" : "text-ink"}`}>{e.label}</span>
                </span>
              </div>
              <button type="button" aria-label={`Open ${e.label}`} onClick={() => onOpen(e.href)} className="block aspect-[16/10] w-full overflow-hidden border-t border-line text-left outline-none">
                {e.tab ? (
                  <TabPicture tab={e.tab} titles={titles} viewIcon={e.icon} viewName={e.label} className="h-full w-full" />
                ) : (
                  <div className="grid h-full w-full place-items-center bg-[var(--color-canvas)]">
                    <div className="flex flex-col items-center gap-2 text-muted">
                      <span className="grid h-12 w-12 place-items-center rounded-container bg-[var(--glass-hover)] [&>svg]:h-6 [&>svg]:w-6">{e.icon}</span>
                      <span className="text-subheadline font-semibold text-heading">{e.label}</span>
                    </div>
                  </div>
                )}
              </button>
            </div>
          );
        })}
        {!q ? (
          <button
            type="button"
            data-overview-index={shown.length}
            onClick={onNewNote}
            onMouseEnter={() => setSel(shown.length)}
            aria-label="New note"
            className={`grid aspect-[16/10] place-items-center self-end rounded-container bg-[var(--glass-hover)] text-faint transition-colors hover:text-heading ${sel === shown.length ? "ring-2 ring-focus" : ""}`}
          >
            <Plus size={40} strokeWidth={1.5} aria-hidden />
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
