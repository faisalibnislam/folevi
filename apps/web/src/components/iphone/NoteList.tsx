"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, Check, CheckCircle2, FileText, LayoutGrid, List, Star, StarOff, Trash2, Undo2, type LucideIcon } from "lucide-react";
import { AppLink } from "@/lib/app/router";
import { ageText, formatRelative } from "@/lib/format";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import type { MenuEntry } from "@/components/ui/Menu";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { EmptyState } from "@/components/ui/EmptyState";
import { NOTE_CARD_LINK, NoteCardFace } from "@/components/views/DocumentCard";
import { NoteContextMenu, contextPoint, type Summary } from "@/components/views/DocumentBrowser";
import type { SelectionAction } from "@/components/views/SelectionBar";
import { useNoteActions } from "@/components/views/noteActions";
import { GlassPill, GlassTextButton } from "./Glass";
import { MoreMenu } from "./RootBar";
import { ListRow, SearchField } from "./Rows";
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
            { label: "Delete", icon: <Trash2 />, tone: "#d6453d", danger: true, onAction: () => void notes.trash([d.id]) },
            d.archivedAt
              ? { label: "Unarchive", icon: <ArchiveRestore />, tone: "#6b6b73", onAction: () => void notes.archive([d.id], false) }
              : { label: "Archive", icon: <Archive />, tone: "#6b6b73", onAction: () => void notes.archive([d.id], true) },
          ],
        };

  return (
    <ViewChrome title={title} tabTitle={title} tint={tint} iphone={{ title, trailing, header: docs.length || query ? <SearchField placeholder="Search" value={query} onChange={setQuery} /> : null }}>
      {subfolders.length ? (
        <nav aria-label="Folders inside" className="mt-2">
          {subfolders.map((f) => (
            <ListRow key={f.id} href={`/folders/${f.id}`} icon={<FolderGlyph color={f.color} size={22} />} label={f.name} detail={folderCounts?.get(f.id)} />
          ))}
        </nav>
      ) : null}
      {before}
      {loading ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 px-4 pt-4" aria-busy aria-label="Loading">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="aspect-[25/27] animate-pulse rounded-panel bg-sunken motion-reduce:animate-none" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        query ? (
          <p className="px-6 py-16 text-center text-[15px] text-muted">No notes match “{query.trim()}”</p>
        ) : (
          <EmptyState icon={empty.icon} title={subfolders.length && view === "folder" ? "No notes directly in this folder yet" : empty.title} body={empty.body} action={empty.action} />
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
                className="flex w-full items-center gap-3 pl-5 pr-4 outline-none active:bg-[var(--liquid-press)] focus-visible:bg-[var(--liquid-active)]"
              >
                {selecting ? (
                  on ? <CheckCircle2 size={24} aria-hidden className="flex-none fill-heading text-canvas" /> : <span aria-hidden className="h-6 w-6 flex-none rounded-capsule border-[1.5px] border-line-strong" />
                ) : (
                  <FileText size={22} aria-hidden className="flex-none text-muted" />
                )}
                <span className="ui-row-sep flex min-h-[62px] min-w-0 flex-1 flex-col justify-center py-2">
                  <span className="truncate text-[17px] text-ink">
                    {d.title || "Untitled"}
                    {d.starred ? <Star size={13} aria-label="Starred" className="ml-1.5 inline -translate-y-px fill-current text-faint" /> : null}
                  </span>
                  <span className="mt-0.5 truncate text-[13px] text-muted">
                    {view === "trash" && d.deletedAt ? `Deleted ${formatRelative(d.deletedAt)}` : ageText(d.updatedAt)}
                    {d.homeFolder && d.kind !== "template" ? ` · ${d.homeFolder.name}` : d.kind !== "template" ? " · Draft" : ""}
                    {unsynced.has(d.id) ? " · Not synced" : ""}
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
          <button type="button" onClick={onLoadMore} className="h-11 rounded-capsule px-5 text-[16px] font-medium text-heading ui-liquid">
            Show more
          </button>
        </div>
      ) : null}
      {selecting ? (
        <SelectBar
          count={selection.selectedIds.length}
          total={shown.length}
          actions={bulkActions}
          onSelectAll={selection.selectAll}
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
    <span aria-hidden className={`pointer-events-none absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-capsule shadow-[0_1px_4px_rgb(0_0_0/0.2)] ${on ? "bg-heading text-canvas" : "bg-[rgb(255_255_255/0.85)] ring-[1.5px] ring-inset ring-[rgb(0_0_0/0.25)]"}`}>
      {on ? <Check size={16} strokeWidth={3} /> : null}
    </span>
  );
}

/** Select mode's bar, where the tab bar was: how many are picked, Select all, and what to do with them. */
function SelectBar({ count, total, actions, onSelectAll, onAction }: { count: number; total: number; actions: SelectionAction[]; onSelectAll: () => void; onAction: (a: SelectionAction) => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(10px,calc(env(safe-area-inset-bottom)-10px))] animate-[iphone-sheet-in_320ms_cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none">
      <div role="toolbar" aria-label="Selected notes" className="ui-liquid-strong pointer-events-auto rounded-sheet px-2 pb-2 pt-2.5">
        <div className="flex items-center justify-between px-2.5 pb-1.5">
          <p role="status" aria-live="polite" className="text-[15px] font-semibold text-heading">
            {count ? `${count} selected` : "Select notes"}
          </p>
          {count < total ? (
            <button type="button" onClick={onSelectAll} className="h-8 px-1 text-[15px] font-medium text-heading">
              Select all
            </button>
          ) : null}
        </div>
        <div className="flex items-stretch">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              disabled={!count}
              onClick={() => onAction(a)}
              className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-panel px-1 py-1.5 text-[11.5px] font-medium outline-none transition-colors active:bg-[var(--liquid-press)] disabled:opacity-35 ${a.danger ? "text-danger" : "text-heading"}`}
            >
              <span aria-hidden className="[&_svg]:h-[22px] [&_svg]:w-[22px]">{a.icon}</span>
              <span className="max-w-full truncate">{a.label.replace(/…$/, "").replace("Move to folder", "Move").replace("Move to Trash", "Delete").replace("Delete permanently", "Delete")}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

