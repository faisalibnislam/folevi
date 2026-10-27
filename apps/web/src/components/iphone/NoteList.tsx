"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, Check, LayoutGrid, List, Star, StarOff, Trash2, Undo2, type LucideIcon } from "lucide-react";
import { AppLink } from "@/lib/app/router";
import { ageText, formatRelative } from "@/lib/format";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import type { MenuEntry } from "@/components/ui/Menu";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { NOTE_CARD_LINK, NoteCardFace } from "@/components/views/DocumentCard";
import { NoteContextMenu, contextPoint, type Summary } from "@/components/views/DocumentBrowser";
import type { SelectionAction } from "@/components/views/SelectionBar";
import { useNoteActions } from "@/components/views/noteActions";
import { GlassPill, GlassTextButton } from "./Glass";
import { MoreMenu } from "./RootBar";
import { ListRow, ScreenEmpty, SearchField } from "./Rows";
import { PullToRefresh, useListRefresh } from "./PullToRefresh";
import { folderHex } from "@/lib/folderColors";
import { prefersReducedMotion, SPRINGS, springCss } from "@/lib/native/physics";

/** Select mode's bar rising into the tab bar's place. */
const BAR_IN = springCss(SPRINGS.sheet);
import { SwipeRow } from "./Swipe";
import { useHideTabBar } from "./chrome";
import { ViewChrome } from "@/components/app/Shell";

type View = "all" | "starred" | "archive" | "trash" | "templates" | "unsorted" | "folder" | "tag";
type Sort = "updated" | "created" | "title" | "manual";

const SORTS: [Sort, string][] = [
  ["updated", "Last edited"],
  ["created", "Created"],
  ["title", "Title"],
  ["manual", "Manual order"],
];

export interface IphoneNoteListProps {
  view: View;
  title: string;
  docs: Summary[];
  loading: boolean;
  canLoadMore: boolean;
  onLoadMore: () => void;
  /** The folders inside this one (a folder's screen). */
  subfolders: { id: string; name: string; color: string | null }[];
  folderCounts?: Map<string, number>;
  empty: { icon: LucideIcon; title: string; body?: string; action?: ReactNode };
  selection: { selected: Set<string>; selectedIds: string[]; toggle: (id: string) => void; clear: () => void; selectAll: () => void };
  bulkActions: SelectionAction[];
  sort: Sort;
  onSort: (s: Sort) => void;
  /** More actions for the screen's "…" menu (Empty Trash, New template…). */
  menu?: MenuEntry[];
  /** Above the notes (Templates' built-in ones). */
  before?: ReactNode;
  unsynced: Set<string>;
  canArrange: boolean;
  onNudge: (id: string, delta: -1 | 1) => void;
  /** A folder's colour, washed faintly over its screen. */
  tint?: string;
  /** The list's dialogs (move, copy, delete). */
  children?: ReactNode;
}

/**
 * A list of notes in the iPhone app (All notes, Drafts, a folder or tag, Starred, Archive, Trash,
 * Templates): a large title, a search field, the notes as two columns of cards or as rows, and Select for
 * acting on several at once (a bar of actions takes the tab bar's place). Rows swipe (right to star, left
 * to archive or delete); everything also has a long-press menu.
 */
export function IphoneNoteList(props: IphoneNoteListProps) {
  const { view, title, docs, loading, canLoadMore, onLoadMore, subfolders, folderCounts, empty, selection, bulkActions, sort, onSort, menu = [], before, unsynced, canArrange, onNudge, tint, children } = props;
  const [layout, setLayout] = useLocalStorage<"cards" | "list">(`folevi:iphone-layout:${view}`, view === "trash" || view === "archive" ? "list" : "cards");
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [ctx, setCtx] = useState<{ doc: Summary; at: { x: number; y: number } } | null>(null);
  const notes = useNoteActions();
  const refresh = useListRefresh();
  const selectable = view !== "templates";
  useHideTabBar("select", selecting);

  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return docs;
    return docs.filter((d) => (d.title || "Untitled").toLocaleLowerCase().includes(q) || d.excerpt.toLocaleLowerCase().includes(q));
  }, [docs, query]);

  const stopSelecting = () => {
    setSelecting(false);
    selection.clear();
  };
  const menuProps = (d: Summary) => ({
    doc: d,
    view,
    arrange: canArrange ? { up: () => onNudge(d.id, -1), down: () => onNudge(d.id, 1) } : undefined,
    select: selectable ? { selected: selection.selected.has(d.id), toggle: () => (setSelecting(true), selection.toggle(d.id)) } : undefined,
  });
  // In Select mode a tap picks the note instead of opening it.
  const tap = (d: Summary) => (e: React.MouseEvent) => {
    if (!selecting) return;
    e.preventDefault();
    e.stopPropagation();
    selection.toggle(d.id);
  };
  const longPress = (d: Summary) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (selecting) return;
    setCtx({ doc: d, at: contextPoint(e) });
  };

  const screenMenu: MenuEntry[] = [
    { heading: "View as" },
    { label: "Cards", icon: <LayoutGrid size={18} />, checked: layout === "cards", onSelect: () => setLayout("cards") },
    { label: "List", icon: <List size={18} />, checked: layout === "list", onSelect: () => setLayout("list") },
    "separator",
    { heading: "Sort by" },
    ...SORTS.filter(([s]) => s !== "manual" || view !== "trash").map(([s, label]) => ({ label, checked: sort === s, onSelect: () => onSort(s) })),
    ...(menu.length ? (["separator", ...menu] as MenuEntry[]) : []),
  ];

  const picked = selection.selectedIds.length;
  const all = picked > 0 && picked >= shown.length;
  const trailing = selecting ? (
    <GlassTextButton strong onClick={stopSelecting}>
      Done
    </GlassTextButton>
  ) : (
    <>
      {selectable && docs.length ? <GlassTextButton onClick={() => setSelecting(true)}>Select</GlassTextButton> : null}
      <GlassPill>
        <MoreMenu items={screenMenu} label={`${title} options`} />
      </GlassPill>
    </>
  );

  const swipeFor = (d: Summary) =>
    view === "trash"
      ? { leading: [{ label: "Restore", icon: <Undo2 />, tone: "#3f7d58", onAction: () => void notes.restore([d.id]) }], trailing: [] }
      : {
          leading: [d.starred ? { label: "Unstar", icon: <StarOff />, tone: "#b07a12", onAction: () => void notes.star([d.id], false) } : { label: "Star", icon: <Star />, tone: "#c58a12", onAction: () => void notes.star([d.id], true) }],
          trailing: [
            { label: "Trash", icon: <Trash2 />, tone: "#d6453d", danger: true, onAction: () => void notes.trash([d.id]) },
            d.archivedAt
              ? { label: "Unarchive", icon: <ArchiveRestore />, tone: "#6b6b73", onAction: () => void notes.archive([d.id], false) }
              : { label: "Archive", icon: <Archive />, tone: "#6b6b73", onAction: () => void notes.archive([d.id], true) },
          ],
        };

  return (
    <ViewChrome
      title={title}
      tabTitle={title}
      tint={tint}
      iphone={{
        title,
        trailing,
        // Select mode: Select All where Back was, how many are picked in the bar's middle.
        leading: selecting ? (
          <GlassTextButton onClick={() => (all ? selection.clear() : selection.selectAll())}>{all ? "Deselect All" : "Select All"}</GlassTextButton>
        ) : undefined,
        status: selecting ? (picked ? `${picked} selected` : "Select notes") : undefined,
        header: docs.length || query ? <SearchField placeholder="Search" value={query} onChange={setQuery} /> : null,
      }}
    >
      {selecting ? (
        <p role="status" aria-live="polite" className="sr-only">
          {picked ? `${picked} selected` : "Select notes"}
        </p>
      ) : (
        <PullToRefresh onRefresh={refresh} />
      )}
      {subfolders.length ? (
        <nav aria-label="Folders inside" className="mt-2">
          {subfolders.map((f) => (
            <ListRow key={f.id} href={`/folders/${f.id}`} icon={<FolderGlyph color={f.color} size={22} />} label={f.name} detail={folderCounts?.get(f.id)} />
          ))}
        </nav>
      ) : null}
      {before}
      {loading ? (
        <div className="grid grid-cols-2 gap-x-3.5 gap-y-5 px-4 pt-4" aria-busy aria-label="Loading">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="aspect-[25/27] animate-pulse rounded-container bg-sunken motion-reduce:animate-none" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        query ? (
          <ScreenEmpty title={`No notes match “${query.trim()}”`} body="Try other words, or search everywhere from Home." />
        ) : (
          <ScreenEmpty icon={empty.icon} title={subfolders.length && view === "folder" ? "No notes directly in this folder yet" : empty.title} body={empty.body} action={empty.action} />
        )
      ) : layout === "cards" ? (
        <ul data-iphone-tappable="" className="grid grid-cols-2 gap-x-3.5 gap-y-5 px-4 pt-4 [@media(orientation:landscape)]:grid-cols-4">
          {shown.map((d) => {
            const on = selection.selected.has(d.id);
            return (
              <li key={d.id} data-lift="" className="relative transition-transform [container-type:inline-size]" onContextMenu={longPress(d)}>
                <AppLink href={`/d/${d.id}`} onClickCapture={tap(d)} aria-pressed={selecting ? on : undefined} className={`${NOTE_CARD_LINK} active:scale-[0.97]`}>
                  <NoteCardFace
                    title={d.title}
                    excerpt={d.excerpt}
                    preview={d.preview}
                    cover={d.cover}
                    style={d.style}
                    createdAt={d.createdAt}
                    time={view === "trash" && d.deletedAt ? `Deleted ${formatRelative(d.deletedAt)}` : ageText(d.updatedAt)}
                    starred={d.starred}
                    folder={d.homeFolder}
                    showFolder={d.kind !== "template"}
                  />
                </AppLink>
                {selecting ? <SelectMark on={on} /> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <ul data-iphone-tappable="" className="pt-2">
          {shown.map((d) => {
            const on = selection.selected.has(d.id);
            const row = (
              <AppLink
                href={`/d/${d.id}`}
                onClickCapture={tap(d)}
                onContextMenu={longPress(d)}
                aria-pressed={selecting ? on : undefined}
                className="ui-key-focus flex w-full items-center gap-3 pl-5 pr-4 outline-none transition-colors duration-150 active:bg-[var(--liquid-press)] active:duration-0"
              >
                {selecting ? <SelectCircle on={on} /> : <NoteGlyph folderColor={d.kind === "template" ? undefined : d.homeFolder ? d.homeFolder.color : null} />}
                <span className="ui-row-sep flex min-h-16 min-w-0 flex-1 flex-col justify-center py-2.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-body leading-[22px] text-ink">{d.title || "Untitled"}</span>
                    {d.starred ? <Star size={13} aria-label="Starred" className="flex-none fill-current text-faint" /> : null}
                  </span>
                  <span className="mt-0.5 truncate text-subheadline leading-5 text-muted">
                    {view === "trash" && d.deletedAt ? `Deleted ${formatRelative(d.deletedAt)}` : ageText(d.updatedAt)}
                    {d.homeFolder && d.kind !== "template" ? ` · ${d.homeFolder.name}` : d.kind !== "template" ? " · Draft" : ""}
                    {unsynced.has(d.id) ? " · Waiting to sync" : ""}
                  </span>
                </span>
              </AppLink>
            );
            return <li key={d.id}>{selecting ? row : <SwipeRow {...swipeFor(d)}>{row}</SwipeRow>}</li>;
          })}
        </ul>
      )}
      {canLoadMore && !query ? (
        <div className="px-4 pt-6 text-center">
          <button type="button" onClick={onLoadMore} className="h-11 rounded-capsule px-5 text-callout font-medium text-heading ui-liquid">
            Show more
          </button>
        </div>
      ) : null}
      {selecting ? (
        <SelectBar
          count={picked}
          actions={bulkActions}
          onAction={(a) => {
            a.onClick();
            setSelecting(false);
          }}
        />
      ) : null}
      {ctx ? <NoteContextMenu key={ctx.doc.id + ctx.at.x + ctx.at.y} at={ctx.at} onDone={() => setCtx(null)} {...menuProps(ctx.doc)} /> : null}
      {children}
    </ViewChrome>
  );
}

/** The check on a card in Select mode. */
function SelectMark({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={`pointer-events-none absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-capsule shadow-[0_1px_4px_rgb(0_0_0/0.2)] transition-colors duration-150 ${on ? "bg-heading text-canvas" : "bg-[rgb(255_255_255/0.85)] ring-[1.5px] ring-inset ring-[rgb(0_0_0/0.25)]"}`}>
      {on ? <Check size={16} strokeWidth={3} /> : null}
    </span>
  );
}

/** A row's selection circle in Select mode (iOS's own: an empty ring, or filled with a tick). */
function SelectCircle({ on }: { on: boolean }) {
  return (
    <span aria-hidden className="grid h-7 w-7 flex-none place-items-center">
      <span className={`grid h-[22px] w-[22px] place-items-center rounded-capsule transition-colors duration-150 ${on ? "bg-heading text-canvas" : "shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]"}`}>
        {on ? <Check size={14} strokeWidth={3} /> : null}
      </span>
    </span>
  );
}

/**
 * A note in a list row: a small page with the spine of its folder's colour (a draft's is plain), as the cards
 * draw it, so the rows of a mixed list tell their folders apart. Templates have no folder: a plain page.
 */
function NoteGlyph({ folderColor }: { folderColor?: string | null }) {
  const spine = folderColor !== undefined && folderColor !== null ? folderHex(folderColor) : "color-mix(in oklab, var(--color-heading) 14%, var(--color-canvas))";
  return (
    <span aria-hidden className="grid h-7 w-7 flex-none place-items-center">
      <span className="relative h-6 w-5 overflow-hidden rounded-l-tiny rounded-r-chip bg-surface shadow-[inset_0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.06)]">
        <span className="absolute inset-y-0 left-0 w-1" style={{ background: spine }} />
        <span className="absolute left-2 right-1.5 top-1.5 h-[1.5px] rounded-capsule bg-[var(--color-line-strong)]" />
        <span className="absolute left-2 right-2.5 top-3 h-[1.5px] rounded-capsule bg-[var(--color-line)]" />
      </span>
    </span>
  );
}

/** Select mode's bar, in the tab bar's place and shape: what to do with the picked notes. */
function SelectBar({ count, actions, onAction }: { count: number; actions: SelectionAction[]; onAction: (a: SelectionAction) => void }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(10px,calc(env(safe-area-inset-bottom)-10px))] pl-[calc(16px+env(safe-area-inset-left))] pr-[calc(16px+env(safe-area-inset-right))]"
      style={{ animation: prefersReducedMotion() ? "iphone-fade-in 150ms ease-out" : `iphone-sheet-in ${BAR_IN.ms}ms ${BAR_IN.easing}` }}
    >
      <div role="toolbar" aria-label="Selected notes" className="ui-liquid pointer-events-auto flex h-16 items-stretch rounded-capsule p-1">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            disabled={!count}
            onClick={() => onAction(a)}
            className={`ui-glass-press flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-capsule px-1 text-caption-2 font-medium leading-[13px] outline-none disabled:opacity-35 ${a.danger ? "text-danger" : "text-heading"}`}
          >
            <span aria-hidden className="[&_svg]:h-[22px] [&_svg]:w-[22px]">{a.icon}</span>
            <span className="max-w-full truncate">{a.label.replace(/…$/, "").replace("Move to folder", "Move").replace("Move to Trash", "Trash").replace("Delete permanently", "Delete")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
