"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen, type LucideIcon } from "lucide-react";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { useAppState } from "@/lib/app/state";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { useListViewTab, useOpenManyInBackground } from "@/lib/app/tabs";
import { clampColumn, columnsHref, groupNotes, LAST_NOTES_KEY, lastNoteKey, noteAfterLeaving, pickNote, rememberNote, stepNote, type LastNotes } from "@/lib/app/noteColumns";
import { useColumnCollapsed, useColumnWidth } from "@/lib/app/useNoteColumns";
import { ageText, formatRelative } from "@/lib/format";
import { useKeyLabels } from "@/lib/shortcuts";
import { ViewChrome } from "@/components/app/Shell";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadFailed } from "@/components/ui/LoadFailed";
import { Button } from "@/components/ui/Button";
import { FolderBadge } from "./FolderBadge";
import type { Summary } from "./DocumentBrowser";

/** What a list hands its column (DocumentBrowser's DocumentList draws the rest: data, selection, menus, dialogs). */
export interface NoteColumnsProps {
  /** The list's own path (`?list=`), and the note open in it. */
  list: string;
  noteId: string | null;
  /** The note's page (RouteView's), while one is open. */
  note: ReactNode;
  view: string;
  title: string;
  /** A mark before the title (a folder's glyph). */
  mark?: ReactNode;
  count?: string;
  /** Every note loaded (what the column opens on and follows), and the ones the filter leaves. */
  docs: Summary[];
  shown: Summary[];
  loading: boolean;
  failed?: { what: string; onRetry: () => void };
  canLoadMore: boolean;
  onLoadMore: () => void;
  sort: string;
  /** Sort, the filter and the list's own actions (Share, its "…", Empty Trash), in the column's head. */
  filter: ReactNode;
  controls: ReactNode;
  empty: { icon: LucideIcon; title: string; body?: string; action?: ReactNode };
  filtering: boolean;
  filterEmpty: ReactNode;
  /** Selection, the context menu and dragging, as on every card and row. */
  rowProps: (d: Summary) => Record<string, unknown>;
  rowMenu: (d: Summary) => ReactNode;
  selected: Set<string>;
  unsynced: Set<string>;
  unsyncedMark: ReactNode;
  dropTarget: string | null;
  /** The selection's bar, menus and dialogs. */
  overlay: ReactNode;
  children?: ReactNode;
}

const ROW_ICON = "ui-btn ui-btn-ghost size-control flex-none";

export function NoteColumns(p: NoteColumnsProps) {
  const { navigate } = useAppRouter();
  const { scopeKey } = useAppState();
  const openInBackground = useOpenManyInBackground();
  const [width, setWidth] = useColumnWidth();
  const [collapsed, setCollapsed] = useColumnCollapsed();
  const keys = useKeyLabels();
  useListViewTab(p.list, p.title);

  // Which note the list opens on: the one it had last, else its most recently edited (docs/NOTE_COLUMNS.md).
  const [last, setLast] = useLocalStorage<LastNotes>(LAST_NOTES_KEY, {});
  const memoryKey = lastNoteKey(scopeKey, p.list);
  const open = useCallback((id: string, how: "push" | "replace") => navigate(columnsHref(id, p.list), how === "replace" ? { replace: true } : undefined), [navigate, p.list]);
  const ready = !p.loading && !p.failed;
  useEffect(() => {
    if (p.noteId || !ready) return;
    const pick = pickNote(p.docs, last[memoryKey]);
    if (pick) open(pick.id, "replace");
  }, [p.noteId, ready, p.docs, last, memoryKey, open]);
  useEffect(() => {
    if (p.noteId && p.docs.some((d) => d.id === p.noteId)) setLast((cur) => rememberNote(cur, memoryKey, p.noteId!));
  }, [p.noteId, p.docs, memoryKey, setLast]);

  // The open note leaving the list (moved, archived, trashed, restored): the one that took its place opens. Only a
  // note that was in the list counts: a note just made may not be in it yet.
  const seen = useRef<{ id: string | null; order: string[] }>({ id: null, order: [] });
  useEffect(() => {
    const order = p.docs.map((d) => d.id);
    const before = seen.current;
    seen.current = { id: p.noteId, order };
    if (!ready || !p.noteId || before.id !== p.noteId || !before.order.includes(p.noteId) || order.includes(p.noteId)) return;
    const next = noteAfterLeaving(before.order, order, p.noteId);
    if (next) open(next, "replace");
    else navigate(p.list, { replace: true });
  }, [p.docs, p.noteId, ready, open, navigate, p.list]);

  // The rows in their groups, and in the order the arrow keys go through them.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const groups = useMemo(
    () => groupNotes(p.shown, { now, sort: p.sort, pinned: p.view !== "starred", dateOf: p.view === "trash" ? (d) => d.deletedAt ?? d.updatedAt : undefined }),
    [p.shown, now, p.sort, p.view],
  );
  const order = useMemo(() => groups.flatMap((g) => g.notes.map((d) => d.id)), [groups]);
  const listRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable='true'], [role='menu']")) return;
    const next = stepNote(order, p.noteId, e.key === "ArrowDown" ? 1 : -1);
    e.preventDefault();
    if (!next) return;
    open(next, "replace");
    requestAnimationFrame(() => {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(next)}"] a`);
      row?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: "nearest" });
    });
  };
  // The open note's row is in view when the list opens on it.
  useEffect(() => {
    if (!p.noteId) return;
    listRef.current?.querySelector(`[data-card-id="${CSS.escape(p.noteId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [p.noteId]);

  // ⌘⌥L hides or shows the column.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      // (AltGr is Ctrl+Alt on Windows and Linux: AltGr+L types a letter on some layouts, never this.)
      if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && e.code === "KeyL" && !e.getModifierState?.("AltGraph")) {
        e.preventDefault();
        setCollapsed(!collapsed);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed, setCollapsed]);

  // Resizing: drag the edge, or ← → on it.
  const [dragW, setDragW] = useState<number | null>(null);
  const shownWidth = clampColumn(dragW ?? width);
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = shownWidth;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let w = w0;
    const move = (ev: PointerEvent) => {
      w = clampColumn(w0 + ev.clientX - x0);
      setDragW(w);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setWidth(w);
      setDragW(null);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const hideLabel = keys("Hide note list (⌘⌥L)");
  const showLabel = keys("Show note list (⌘⌥L)");
  const listEmpty = ready && p.docs.length === 0;

  const column = collapsed ? (
    // A slim rail keeps the way back to the list where it was.
    <div className="flex w-12 flex-none flex-col items-center pt-[60px]">
      <button type="button" aria-label="Show note list" title={showLabel} onClick={() => setCollapsed(false)} className={ROW_ICON}>
        <PanelLeftOpen size={16} aria-hidden />
      </button>
    </div>
  ) : (
    <section aria-label={`${p.title}: notes`} data-note-column="" style={{ width: shownWidth }} className="relative flex min-h-0 flex-none flex-col pt-[56px]">
      <header data-toolbar="" className="flex-none px-3 pb-2 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          {p.mark}
          <h2 className="ui-list-name min-w-0 flex-1 truncate">{p.title}</h2>
          <button type="button" aria-label="Hide note list" title={hideLabel} onClick={() => setCollapsed(true)} className={ROW_ICON}>
            <PanelLeftClose size={16} aria-hidden />
          </button>
        </div>
        {p.count ? (
          <p role="status" className="ui-list-meta mt-0.5 truncate">
            {p.count}
          </p>
        ) : null}
        <div className="mt-2 flex min-w-0 items-center justify-end gap-1.5 [&>div:first-child]:min-w-0 [&>div:first-child]:flex-1">
          {p.filter}
          {p.controls}
        </div>
      </header>
      <div ref={listRef} onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto px-2 pb-[max(1.5rem,var(--fab-clearance))]">
        {p.loading ? (
          <div aria-busy className="space-y-2 px-1 pt-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-chip bg-sunken motion-reduce:animate-none" />
            ))}
          </div>
        ) : p.failed ? (
          <LoadFailed what={p.failed.what} onRetry={p.failed.onRetry} />
        ) : p.filtering && p.shown.length === 0 ? (
          p.filterEmpty
        ) : listEmpty ? null : (
          groups.map((g) => (
            <section key={g.key} aria-label={g.label || p.title}>
              {g.label ? <h2 className="ui-caption-caps px-3 pb-1.5 pt-4">{g.label}</h2> : null}
              <ul className="ui-note-rows">
                {g.notes.map((d) => (
                  <NoteRow
                    key={d.id}
                    doc={d}
                    href={columnsHref(d.id, p.list)}
                    current={d.id === p.noteId}
                    selected={p.selected.has(d.id)}
                    dropTarget={p.dropTarget === d.id}
                    showFolder={p.view !== "folder" && d.kind !== "template"}
                    time={p.view === "trash" && d.deletedAt ? `Deleted ${formatRelative(d.deletedAt)}` : ageText(d.updatedAt)}
                    unsynced={p.unsynced.has(d.id) ? p.unsyncedMark : null}
                    rowProps={p.rowProps(d)}
                    menu={p.rowMenu(d)}
                    onOpenInTab={() => openInBackground?.([{ kind: "note", id: d.id, name: d.title || "Untitled" }])}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
        {p.canLoadMore && ready ? (
          <div className="py-4 text-center">
            <Button onClick={p.onLoadMore}>Load more</Button>
          </div>
        ) : null}
      </div>
      {/* The edge to drag (or ← → on it). */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize note list"
        aria-valuenow={shownWidth}
        tabIndex={0}
        onPointerDown={startResize}
        onDoubleClick={() => setWidth(clampColumn(300))}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setWidth(clampColumn(shownWidth - 16));
          if (e.key === "ArrowRight") setWidth(clampColumn(shownWidth + 16));
        }}
        className="absolute inset-y-3 -right-[3px] z-10 w-1.5 cursor-col-resize rounded-chip outline-none transition-colors hover:bg-heading/20 focus-visible:bg-heading/30"
      />
    </section>
  );

  return (
    <div data-note-columns="" className="relative flex min-h-0 flex-1">
      {column}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {p.note ?? (
          <ViewChrome title={<h1 className="truncate text-subheadline font-semibold">{p.title}</h1>} tabTitle={p.title}>
            {listEmpty && !p.filtering ? (
              <div className="grid h-full place-items-center pb-24">
                <EmptyState icon={p.empty.icon} title={p.empty.title} body={p.empty.body} action={p.empty.action} />
              </div>
            ) : ready && !p.loading ? (
              <div className="grid h-full place-items-center pb-24">
                <p className="text-subheadline text-muted">No note open</p>
              </div>
            ) : null}
          </ViewChrome>
        )}
      </div>
      {/* The selection's bar floats over the column and the note, as it does over a list's page. */}
      {p.overlay}
      {p.children}
    </div>
  );
}

/**
 * A note's row, as Apple Notes draws one: its name in the serif, then its time and first line, then its folder. The
 * open note's row comes forward as the open tab does.
 */
function NoteRow({
  doc,
  href,
  current,
  selected,
  dropTarget,
  showFolder,
  time,
  unsynced,
  rowProps,
  menu,
  onOpenInTab,
}: {
  doc: Summary;
  href: string;
  current: boolean;
  selected: boolean;
  dropTarget: boolean;
  showFolder: boolean;
  time: string;
  unsynced: ReactNode;
  rowProps: Record<string, unknown>;
  menu: ReactNode;
  onOpenInTab: () => void;
}) {
  const excerpt = doc.excerpt?.trim();
  return (
    <li
      {...rowProps}
      data-current={current || undefined}
      data-selected={selected || undefined}
      className={`ui-note-row group ${dropTarget ? "shadow-[inset_0_2px_0_var(--color-heading)]" : ""}`}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        onOpenInTab();
      }}
    >
      <AppLink href={href} aria-current={current ? "page" : undefined} className="block min-w-0 rounded-chip px-3 py-2.5 pr-10 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-focus">
        <span className="ui-list-name block truncate">{doc.title || "Untitled"}</span>
        <span className="ui-list-meta mt-0.5 flex min-w-0 gap-2">
          <span className="flex-none">{time}</span>
          <span className="min-w-0 truncate">{excerpt || "No additional text"}</span>
        </span>
        {showFolder && doc.homeFolder ? (
          <span className="mt-1 flex min-w-0">
            <FolderBadge folder={doc.homeFolder} className="!max-w-full" />
          </span>
        ) : null}
        {unsynced ? <span className="mt-1 block">{unsynced}</span> : null}
        {selected ? <span className="sr-only"> (selected)</span> : null}
      </AppLink>
      <div data-card-menu="" className="absolute right-1.5 top-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
        {menu}
      </div>
    </li>
  );
}
