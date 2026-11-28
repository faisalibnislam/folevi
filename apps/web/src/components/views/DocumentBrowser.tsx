"use client";

import { useMutation } from "convex/react";
import { usePaginatedQuery, useQuery } from "@/lib/convex/queries";
import { lazy, startTransition, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, ArrowDown, ArrowDownUp, ArrowUp, Check, CheckSquare, Copy, CopyPlus, EyeOff, FilePlus2, ExternalLink, FolderInput, LayoutGrid, List, MoreHorizontal, PencilLine, Plus, Trash2, Undo2, FileText, Files, FolderOpen, Hash, Inbox, LayoutTemplate, Share2, type LucideIcon } from "lucide-react";
import { Bookmark, BookmarkOff } from "lucide-react";
import { folderAncestors } from "@folevi/editor-schema";
import { useOpenedOnce } from "@/lib/hooks/useOpenedOnce";
import { api } from "@/lib/convex/api";
import { useFolderTree, useFolderTreeState } from "@/lib/app/folders";
import { useOfflineQuery, useOutboxEntries } from "@/lib/sync/queryCache";
import { hasNative } from "@/lib/native/ui";
import { overlayFolderIndex, pendingNoteFolders } from "@/lib/sync/overlays";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { useEngineSelector, useLocalStorage } from "@/lib/hooks/useEngine";
import { startItemsDrag, startNoteDrag, NOTE_MIME } from "@/lib/app/noteDrag";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadFailed, loadFailedCopy } from "@/components/ui/LoadFailed";
import { ContextMenu, MenuButton, type MenuItem } from "@/components/ui/Menu";
import { floatMenuItems } from "@/components/app/floatMenu";
import { Dialog } from "@/components/ui/Dialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ViewChrome } from "@/components/app/Shell";
import { folderHex } from "@/lib/folderColors";
import { useCreateDocument } from "@/components/app/useCreateDocument";
import { editedText, formatRelative, templatesCountText } from "@/lib/format";
import { t } from "@/i18n";
import { localDb } from "@/lib/sync/db";
import { onMemoryPressure } from "@/lib/memoryPressure";
import { TemplateTile } from "@/components/ui/TemplateIcon";
import { NOTE_CARD_LINK, NoteCardFace } from "./DocumentCard";
import { FolderCard, type FolderSummary } from "./FolderCard";
import { pendingByDocument, type PendingDocument } from "@/lib/hooks/usePendingDocs";
import { useNotesWithLocal } from "@/lib/hooks/useLocalNotes";
import { Select } from "@/components/ui/Select";
import { MoveToFolderDialog } from "./MoveToFolderDialog";
import { CopyToDialog, useCanCopyElsewhere } from "./CopyToDialog";
import { SelectedCheck, SelectionBar, SelectionMarquee } from "./SelectionBar";
import { useCardSelection } from "./useCardSelection";
import { useSelectionActions, type SelectionEntry } from "./useSelectionActions";
import { useNoteActions } from "./noteActions";
import { useAiEnabled } from "@/components/ai/useAi";
import { AiIcon } from "@/components/ai/AiIcon";
import { useIphoneApp } from "@/lib/iphone";
import { IphoneNoteList } from "@/components/iphone/lazy";
import { useCapabilities } from "@/lib/mode";
import { FolderShareDialog } from "@/components/app/FolderShareDialog";
import { FolderMenu } from "@/components/app/FolderMenu";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { FilterField, ListPageHeader, ROW_ICON_BUTTON, ROW_SEG, RowSort, RowTraySep, SECTION_LABEL } from "./ListPageHeader";
import { NoteColumns } from "./NoteColumns";

// Foli AI's "Generate a template" brings the read-only drawing of every block (its preview): it loads the first
// time it's opened, not with every list (docs/IOS_PERFORMANCE.md, "Startup").
const AiGenerateDialog = lazy(() => import("@/components/ai/AiGenerateDialog").then((m) => ({ default: m.AiGenerateDialog })));

/** Marks a page with edits on this device the server hasn't confirmed yet. */
function UnsyncedMarker({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-footnote font-medium text-heading ${className}`} title="Changes on this device haven’t synced yet">
      <span className="inline-block h-1.5 w-1.5 rounded-tiny bg-heading" aria-hidden />
      <span>Waiting to sync</span>
    </span>
  );
}

/** `folders`: every note in a folder, the Folders page in the columns layout (docs/NOTE_COLUMNS.md). */
type View = "all" | "starred" | "archive" | "trash" | "templates" | "unsorted" | "folder" | "folders" | "tag";
/** Grid or List; the Compact cards view is gone (the owner, 28 November 2026), and a saved "compact" shows the grid. */
type Layout = "grid" | "list";
type Sort = "updated" | "created" | "title" | "manual";
const NOTE_SORTS: readonly (readonly [Sort, string])[] = [
  ["updated", "Last edited"],
  ["created", "Created"],
  ["title", "Title"],
  ["manual", "Manual order"],
];

const TITLES: Record<View, string> = {
  all: "Home",
  starred: "Bookmarks",
  archive: "Archive",
  trash: "Trash",
  templates: "Templates",
  unsorted: "Drafts",
  folder: "Folder",
  folders: "All folders",
  tag: "Tag",
};

// What a list that couldn't load says it couldn't load.
const LIST_WHAT: Record<View, string> = {
  all: "your notes",
  starred: "your bookmarks",
  archive: "the archive",
  trash: "the trash",
  templates: "your templates",
  unsorted: "your drafts",
  folder: "this folder",
  folders: "your folders",
  tag: "this tag",
};

// What an empty list says: a short heading and one line of help.
const EMPTY: Record<View, { icon: LucideIcon; title: string; body?: string }> = {
  all: { icon: Files, title: "No notes yet", body: "Start one with New note." },
  starred: { icon: Bookmark, title: "No bookmarks yet", body: "Bookmark a note to keep it here." },
  archive: { icon: Archive, title: "Archive is empty", body: "Archived notes rest here, out of your lists but never lost." },
  trash: { icon: Trash2, title: "Trash is empty", body: "Deleted notes stay here for 30 days." },
  templates: { icon: LayoutTemplate, title: "No templates of your own yet", body: "Save any note as a template from its menu." },
  unsorted: { icon: Inbox, title: "No drafts", body: "Notes without a folder show up here." },
  folder: { icon: FolderOpen, title: "This folder is empty", body: "Start a note here, or move one in with Move to folder." },
  folders: { icon: FolderOpen, title: "No notes in folders yet", body: "Move a note into a folder, or start one in a folder." },
  tag: { icon: Hash, title: "No notes with this tag yet", body: "Add tags to a note from its Info panel." },
};

const PAGE_SIZE = 48;
/** Cards drawn at once when a grid opens: more than a large screen shows before scrolling. */
const FIRST_CARDS = 24;

/**
 * The first page the server last served for each list (account, scope, view, folder, tag and sort), for this visit:
 * a list opened again (the phone remounts its screens on every push, pop and tab switch) draws these notes on its
 * first frame, in the server's order, and the live page then replaces them in place.
 */
const firstPages = new Map<string, Summary[]>();
const FIRST_PAGES_KEPT = 60;
onMemoryPressure(() => firstPages.clear());

function keepFirstPage(key: string, rows: Summary[]) {
  firstPages.delete(key);
  firstPages.set(key, rows);
  if (firstPages.size > FIRST_PAGES_KEPT) firstPages.delete(firstPages.keys().next().value as string);
}

/** "drag to arrange" as a line of its own: "Drag to arrange". */
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function samePending(a: PendingDocument[], b: PendingDocument[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => {
      const q = b[i]!;
      return p.documentId === q.documentId && p.changes === q.changes && p.uploads === q.uploads && p.isNew === q.isNew && p.localTitle === q.localTitle;
    })
  );
}

export type Summary = NonNullable<ReturnType<typeof usePaginatedQuery<typeof api.documents.list>>["results"]>[number];

/** The columns layout (docs/NOTE_COLUMNS.md): the list's path, the note open in it, and that note's page. */
export interface ColumnsInput {
  list: string;
  noteId: string | null;
  /** The row marked open: the note, or the top note a nested page is inside. */
  row?: string | null;
  note: ReactNode;
}

export function DocumentBrowser({ view, folderId, tagId, title, columns }: { view: View; folderId?: string; tagId?: string; title?: string; columns?: ColumnsInput }) {
  const { scope } = useAppState();
  const { data: org, fromCache } = useFolderTreeState(scope);
  // A folder/tag link that doesn't resolve in the current context (deleted, mistyped, or from Personal while a
  // workspace is open, or the other way round) gets a real not-found page instead of a failing list query.
  // (The copy kept on this device may not know a folder made elsewhere yet: only the server's answer counts.)
  const missing =
    org !== undefined &&
    !fromCache &&
    ((view === "folder" && !org.folders.some((f) => f.id === folderId)) || (view === "tag" && !org.tags.some((t) => t.id === tagId)));
  if (missing) return <MissingContainer kind={view === "folder" ? "folder" : "tag"} />;
  return <DocumentList view={view} folderId={folderId} tagId={tagId} org={org} titleOverride={title} columns={columns} />;
}

function MissingContainer({ kind }: { kind: "folder" | "tag" }) {
  const { workspace, workspaces } = useAppState();
  const here = workspace ? workspace.name : "Personal";
  const title = kind === "folder" ? "Folder not found" : "Tag not found";
  return (
    <ViewChrome title={<h1 className="truncate text-subheadline font-semibold">{title}</h1>} tabTitle={title}>
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h2 className="ui-display text-large-title">{kind === "folder" ? "This folder isn’t here" : "This tag isn’t here"}</h2>
        <p className="mt-3 text-muted">
          It may have been deleted{workspaces.length ? `, or it belongs somewhere other than ${here}` : ""}. Links to {kind === "folder" ? "folders" : "tags"} only work in their own Personal or workspace. Switch there from the menu at the bottom of the sidebar.
        </p>
        <AppLink href="/documents" className="ui-btn ui-btn-primary mt-6 h-control px-4 text-callout">
          Go to Home
        </AppLink>
      </div>
    </ViewChrome>
  );
}

type Org = ReturnType<typeof useFolderTree>;

/** Where the pointer (or, from the keyboard, the element) is, for a context menu. */
export function contextPoint(e: React.MouseEvent): { x: number; y: number } {
  if (e.clientX || e.clientY) return { x: e.clientX, y: e.clientY };
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return { x: r.left + 16, y: r.top + 16 };
}

type KeptRow = { kind?: string; parentDocumentId?: string | null; archivedAt?: number | null; deletedAt?: number | null };

/**
 * Which notes kept on this device a view shows before (or without) the server's answer, as documents.list
 * filters them; null where the device can't tell (tags, bookmarked notes, templates, a manual order) and it waits for the
 * server, unless offline (then the kept rows, as before).
 */
function cachedViewFilter(view: View, sort: Sort, online: boolean): ((d: KeptRow) => boolean) | null {
  const page = (d: KeptRow) => d.kind === "document" || d.kind === "daily" || d.kind === undefined;
  const live = (d: KeptRow) => !d.deletedAt && !d.archivedAt;
  const ordered = sort === "updated" || sort === "created";
  switch (view) {
    case "all":
    case "folder":
    case "folders":
      return ordered || !online ? (d) => page(d) && live(d) && !d.parentDocumentId : null;
    case "unsorted":
      return ordered || !online ? (d) => page(d) && live(d) && !d.parentDocumentId && !(d as { folderId?: string | null }).folderId : null;
    case "trash":
      return online ? null : (d) => Boolean(d.deletedAt) && d.kind !== "synced";
    case "archive":
      return online ? null : (d) => Boolean(d.archivedAt) && !d.deletedAt;
    default:
      return online ? null : (d) => live(d);
  }
}

function DocumentList({ view, folderId, tagId, org, titleOverride, columns }: { view: View; folderId?: string; tagId?: string; org: Org; titleOverride?: string; columns?: ColumnsInput }) {
  const { scope, scopeKey, profile, online, engine, outbox } = useAppState();
  const [savedLayout, setLayout] = useLocalStorage<Layout | "compact">(`folevi:layout:${view}`, view === "trash" || view === "archive" ? "list" : "grid");
  const layout: Layout = savedLayout === "list" ? "list" : "grid";
  const [sort, setSort] = useLocalStorage<Sort>(`folevi:sort:${view}`, "updated");
  // A folder made on this device whose creation is still in the outbox (just made, or made offline) isn't on
  // the server (or in the library) yet: asking for its notes would fail as not found and take the page down.
  // Until it's there it's an empty folder; its notes, if any were filed while it waited, arrive with it.
  const queued = useOutboxEntries(outbox);
  const unsent = view === "folder" && !!folderId && queued.some((e) => e.creates?.includes(folderId));
  // The Folders page's notes are All notes' without Drafts (filed below): the server has no list of its own for them.
  const serverView = view === "folders" ? "all" : view;
  const paged = usePaginatedQuery(api.documents.list, unsent ? "skip" : { scope, view: serverView, folderId, tagId, sort }, { initialNumItems: PAGE_SIZE });
  const { results, loadMore } = paged;
  const status = unsent ? ("Exhausted" as const) : paged.status;
  const builtIns = useQuery(api.settings.builtInTemplates, view === "templates" ? {} : "skip");
  // Templates can be generated with AI (where AI is on and included).
  const aiOn = useAiEnabled();
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  if (generating && !generated) setGenerated(true);
  const createDocument = useCreateDocument();
  const emptyTrash = useMutation(api.documents.emptyTrash);
  const toast = useToast();
  const [stored, setCached] = useState<Summary[] | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  // A folder's Share dialog, from the folder page's title row (docs/SHARING.md).
  const [sharingFolder, setSharingFolder] = useState(false);
  const caps = useCapabilities();
  const trashSummary = useQuery(api.documents.trashSummary, confirmEmpty ? { scope } : "skip");
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ doc: Summary; at: { x: number; y: number } } | null>(null);
  // A right-click on an item of a selection of several: the selection's menu.
  const [selectionCtx, setSelectionCtx] = useState<{ x: number; y: number } | null>(null);
  const reorder = useMutation(api.documents.reorder);
  const iphone = useIphoneApp();

  // Keep a last-known copy for offline reloads. Results change with every edit anywhere in the list (and
  // grow with each page loaded): only notes that changed since they were last written go, once the list
  // settles.
  const cachedRows = useRef<{ key: string; written: Map<string, string> }>({ key: "", written: new Map() });
  useEffect(() => {
    if (view !== "all" || status === "LoadingFirstPage") return;
    const key = `${profile.id}:${scopeKey}`;
    if (cachedRows.current.key !== key) cachedRows.current = { key, written: new Map() };
    const { written } = cachedRows.current;
    const timer = setTimeout(() => {
      const changed = results.map((d) => [d, JSON.stringify(d)] as const).filter(([d, json]) => written.get(d.id) !== json);
      if (!changed.length) return;
      void (async () => {
        const db = await localDb(profile.id);
        const tx = db.transaction("documents", "readwrite");
        for (const [d] of changed) {
          // The device copy's bookkeeping on the row (copyGen, head) stays.
          const prev = await tx.store.get(d.id);
          await tx.store.put({ ...prev, id: d.id, scopeKey, title: d.title, icon: d.icon, kind: d.kind, updatedAt: d.updatedAt, excerpt: d.excerpt, parentDocumentId: d.parentDocumentId, cachedAt: Date.now(), summary: d });
        }
        await tx.done;
        for (const [d, json] of changed) written.set(d.id, json);
      })();
    }, 1000);
    return () => clearTimeout(timer);
  }, [results, status, view, profile.id, scopeKey]);

  // Offline, or before the server's first page arrives: the notes this device keeps (the device copy fills every
  // note of the scope, lib/sync/deviceCopy.ts), filtered as the server filters this view.
  const fromDevice = useMemo(() => cachedViewFilter(view, sort, online), [view, sort, online]);
  useEffect(() => {
    if (status !== "LoadingFirstPage" || !fromDevice) return;
    let live = true;
    void (async () => {
      const db = await localDb(profile.id);
      const docs = await db.getAllFromIndex("documents", "by_scope", scopeKey);
      const rows = docs.map((d) => ({ starred: false, tags: [], homeFolder: null, ...(d.summary as object) }) as unknown as Summary).filter(fromDevice);
      const by = sort === "created" ? (s: Summary) => (s as { createdAt?: number }).createdAt ?? s.updatedAt : (s: Summary) => s.updatedAt;
      if (live) setCached(rows.sort((a, b) => by(b) - by(a)));
    })();
    return () => {
      live = false;
    };
  }, [status, fromDevice, profile.id, scopeKey, sort]);
  // This list's first page as the server last served it (this visit), ahead of the device copy: it's exactly
  // this list, in the server's order, so the live page replaces it without the notes moving.
  const listKey = `${profile.id}|${scopeKey}|${view}|${folderId ?? ""}|${tagId ?? ""}|${sort}`;
  useEffect(() => {
    if (unsent || status === "LoadingFirstPage") return;
    keepFirstPage(listKey, results.slice(0, PAGE_SIZE));
  }, [unsent, status, results, listKey]);
  const cached = firstPages.get(listKey) ?? stored;
  // Offline, the saved copies come a page at a time too, like the live list.
  const [cachedShown, setCachedShown] = useState(PAGE_SIZE);

  const title =
    titleOverride ?? (view === "folder" ? (org?.folders.find((f) => f.id === folderId)?.name ?? "Folder") : view === "tag" ? `#${org?.tags.find((t) => t.id === tagId)?.name ?? "tag"}` : TITLES[view]);
  const fromCache = status === "LoadingFirstPage" && cached !== null;
  // The saved copies, with notes moved while offline in their new folders, and a folder's view showing its own.
  const waiting = queued;
  const kept = useMemo(() => {
    if (!cached) return null;
    const moved = pendingNoteFolders(waiting);
    const placed = moved.size ? cached.map((d) => (moved.has(d.id) ? { ...d, folderId: moved.get(d.id) ?? null } : d)) : cached;
    return view === "folder" ? placed.filter((d) => d.folderId === folderId) : placed;
  }, [cached, waiting, view, folderId]);
  const served = useMemo(() => (fromCache && kept ? kept.slice(0, cachedShown) : results), [fromCache, kept, cachedShown, results]);
  // Notes made (or renamed, or moved) on this device that the server doesn't have yet show in their lists at
  // once, marked as waiting to sync (lib/sync/localNotes.ts).
  const offlineNoList = status === "LoadingFirstPage" && !cached && !online;
  const withLocal =
    useNotesWithLocal(offlineNoList ? undefined : served, {
      include: view === "all" || view === "folders" ? "all" : view === "unsorted" ? "drafts" : view === "folder" ? "folder" : "none",
      folderId,
      byUpdated: sort === "updated",
    }) ?? served;
  const docs = useMemo(() => (view === "folders" ? withLocal.filter((d) => d.folderId) : withLocal), [view, withLocal]);
  // "Filter notes" narrows the notes loaded so far, by title or text (as the iPhone's list does); it starts empty on
  // each list. Typing in it never asks the server: Search looks through every note.
  const [filterState, setFilterState] = useState({ view, q: "" });
  const q = filterState.view === view ? filterState.q : "";
  const setQ = (next: string) => setFilterState({ view, q: next });
  const filtering = q.trim() !== "";
  const shown = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase();
    if (!needle) return docs;
    return docs.filter((d) => (d.title || "Untitled").toLocaleLowerCase().includes(needle) || d.excerpt.toLocaleLowerCase().includes(needle));
  }, [docs, q]);
  // The grid's first cards draw with the click that opened the list; the rest (below the fold on any screen) follow
  // in the background a moment later, so the click answers sooner (INP, docs/perf/web-results.md).
  // (Per list: going from All notes to a folder reuses this view, and starts over.)
  const cardsKey = `${view}:${folderId ?? ""}:${tagId ?? ""}`;
  const [allCardsFor, setAllCardsFor] = useState<string | null>(null);
  useEffect(() => {
    if (allCardsFor !== cardsKey) startTransition(() => setAllCardsFor(cardsKey));
  }, [allCardsFor, cardsKey]);
  const cards = allCardsFor === cardsKey || shown.length <= FIRST_CARDS ? shown : shown.slice(0, FIRST_CARDS);
  const moreCached = fromCache && (kept?.length ?? 0) > cachedShown;
  const canLoadMore = status === "CanLoadMore" || moreCached;
  // The server's list failed and there's nothing else to show: say so (it keeps retrying) instead of loading forever.
  const listFailed = paged.failed && status === "LoadingFirstPage" && !cached && docs.length === 0;
  const loading = status === "LoadingFirstPage" && !cached && docs.length === 0 && !listFailed;
  const canArrange = sort === "manual" && view !== "trash";
  // Only the pages with unsynced work, compared by value: this list shouldn't re-render on every keystroke.
  const pendingDocs = useEngineSelector(engine, pendingByDocument, samePending);
  const unsynced = useMemo(() => new Set(pendingDocs.filter((p) => p.changes > 0 || p.uploads > 0).map((p) => p.documentId)), [pendingDocs]);

  // A folder inside other folders shows the way up (Work / Clients / Acme), and the folders inside it.
  const allFolders = useMemo(() => org?.folders ?? [], [org]);
  const folder = view === "folder" && folderId ? allFolders.find((f) => f.id === folderId) : undefined;
  const crumbs = view === "folder" && folderId ? folderAncestors(allFolders, folderId) : [];
  const subfolders = useMemo(() => (view === "folder" && folderId ? allFolders.filter((f) => f.parentFolderId === folderId) : []), [view, folderId, allFolders]);

  // Finder-style multi-select (lib/app/multiSelect.ts): on a folder's page its folders and notes are one list,
  // folders first as they show. (Templates have their own actions and aren't selectable; the phone layout selects
  // its notes in its own way.)
  const selectable = view !== "templates";
  // While filtering, the page shows only the notes that match: its folders step aside.
  // (The columns layout's note column shows notes only: the sidebar has the folders inside.)
  const subfolderIds = useMemo(() => (iphone || filtering || columns ? [] : subfolders.map((f) => f.id)), [iphone, filtering, columns, subfolders]);
  const itemIds = useMemo(() => [...subfolderIds, ...shown.map((d) => d.id)], [subfolderIds, shown]);
  const selection = useCardSelection(itemIds, selectable);
  const selectedEntries = useMemo<SelectionEntry[]>(() => {
    const out: SelectionEntry[] = [];
    for (const id of selection.selectedIds) {
      const f = subfolders.find((x) => x.id === id);
      if (f) {
        out.push({ kind: "folder", id, name: f.name, color: f.color, parentFolderId: f.parentFolderId ?? null });
        continue;
      }
      const d = docs.find((x) => x.id === id);
      if (d) out.push({ kind: "note", id, name: d.title || "Untitled", starred: d.starred, archived: Boolean(d.archivedAt), template: d.kind === "template", folderId: d.folderId ?? null, tagIds: d.tags.map((t) => t.id) });
    }
    return out;
  }, [selection.selectedIds, subfolders, docs]);
  const selectionActions = useSelectionActions({ entries: selectedEntries, trash: view === "trash", clear: selection.clear });
  const bulkActions = selectionActions.barActions;
  /** Dragging an item of the selection takes the whole selection along (with folders in it, as "items"). */
  const dragSelection = (e: React.DragEvent, id: string, title?: string) => {
    const picked = selection.selected.has(id) ? selectedEntries : [];
    const folders = picked.filter((x) => x.kind === "folder").map((x) => x.id);
    if (!folders.length) {
      const ids = picked.length ? picked.map((x) => x.id) : [id];
      startNoteDrag(e, ids, (n) => (n === id ? title : docs.find((x) => x.id === n)?.title));
      return;
    }
    startItemsDrag(e, { notes: picked.filter((x) => x.kind === "note").map((x) => x.id), folders }, (n) => docs.find((x) => x.id === n)?.title);
  };
  /** A right-click on an item: with several selected and it among them, the selection's menu; else its own. */
  const selectionMenuAt = (e: React.MouseEvent, id: string): boolean => {
    if (!selection.selected.has(id) || selection.selectedIds.length < 2) return false;
    e.preventDefault();
    e.stopPropagation();
    setCtx(null);
    setSelectionCtx(contextPoint(e));
    return true;
  };

  /** Moves `dragged` onto `target`'s slot: after it when moving down, before it when moving up. */
  const place = (dragged: string, target: string) => {
    if (dragged === target) return;
    const from = docs.findIndex((x) => x.id === dragged);
    const to = docs.findIndex((x) => x.id === target);
    if (to < 0) return;
    const down = from >= 0 && from < to;
    const afterDocumentId = down ? target : (docs[to - 1]?.id ?? null);
    const beforeDocumentId = down ? (docs[to + 1]?.id ?? null) : target;
    reorder({ documentId: dragged, afterDocumentId, beforeDocumentId }).catch((err) => toast.show(errorMessage(err), { tone: "error" }));
  };
  const nudge = (id: string, delta: -1 | 1) => {
    const i = docs.findIndex((x) => x.id === id);
    const target = docs[i + delta];
    if (target) place(id, target.id);
  };
  const dropProps = (d: Summary) => ({
    onDragOver: (e: React.DragEvent) => {
      if (canArrange && e.dataTransfer.types.includes(NOTE_MIME)) {
        e.preventDefault();
        setDropTarget(d.id);
      }
    },
    onDragLeave: () => setDropTarget(null),
    onDrop: (e: React.DragEvent) => {
      setDropTarget(null);
      const dragged = e.dataTransfer.getData(NOTE_MIME);
      if (!canArrange || !dragged || dragged === d.id) return;
      e.preventDefault();
      place(dragged, d.id);
    },
  });
  /** What every card and row shares: selection, the context menu, and dragging (to a folder or to arrange). */
  const cardProps = (d: Summary) => ({
    "data-card-id": d.id,
    onClickCapture: selection.onCardClick(d.id),
    onContextMenu: (e: React.MouseEvent) => {
      if (selectionMenuAt(e, d.id)) return;
      e.preventDefault();
      setCtx({ doc: d, at: contextPoint(e) });
    },
    draggable: view !== "trash",
    // Dragging a selected card takes the whole selection along.
    onDragStart: (e: React.DragEvent) => dragSelection(e, d.id, d.title),
    ...dropProps(d),
  });
  const menuProps = (d: Summary) => ({
    doc: d,
    view,
    columns: Boolean(columns),
    arrange: canArrange ? { up: () => nudge(d.id, -1), down: () => nudge(d.id, 1) } : undefined,
    select: selectable ? { selected: selection.selected.has(d.id), toggle: () => selection.toggle(d.id) } : undefined,
  });

  const nativeAlert = hasNative("alert");
  const runEmptyTrash = async () => {
    const count = trashSummary?.deletable ?? 0;
    setConfirmEmpty(false);
    selection.clear();
    try {
      const r = await emptyTrash({ scope });
      toast.show(t("documents.trash.scheduled", { count: Math.max(count, r.scheduled) }));
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    }
  };
  const summaryText = trashSummary
    ? `${trashSummary.deletable.toLocaleString()}${trashSummary.more ? "+" : ""} ${trashSummary.deletable === 1 ? "note" : "notes"} will be permanently deleted, including attachments and version history. This can’t be undone.${
        trashSummary.deletable < trashSummary.total ? ` ${(trashSummary.total - trashSummary.deletable).toLocaleString()} you don’t have permission to delete will stay in Trash.` : ""
      }`
    : "Counting the notes in Trash…";

  // The folders inside, drawn as folder cards like All folders: their page counts, last change and previews come
  // from the same index (and offline cache) All folders reads; until it's here, the tree's names and colours.
  const servedIndex = useOfflineQuery(api.organization.index, subfolders.length ? { scope, only: "folders" } : "skip");
  const folderIndex = useMemo(() => (servedIndex ? overlayFolderIndex(servedIndex, queued, scope) : servedIndex), [servedIndex, queued, scope]);
  const subfolderCards: FolderSummary[] = subfolders.map(
    (f) => folderIndex?.folders.find((x) => x.id === f.id) ?? { id: f.id, name: f.name, color: f.color, parentFolderId: f.parentFolderId, updatedAt: 0, documentCount: 0 },
  );
  const heading = <h1 className="truncate text-subheadline font-semibold">{title}</h1>;
  // Nothing in the list (and, on Templates, no built-in ones either).
  const listEmpty = !loading && !listFailed && docs.length === 0 && !(view === "templates" && builtIns?.length);
  const allText = `${docs.length}${canLoadMore ? "+" : ""} ${docs.length === 1 ? "note" : "notes"}`;
  const countText = filtering ? `${shown.length} of ${allText}` : allText;
  // The filter shows wherever there are notes to narrow (and stays while it has words, so they can be cleared).
  const filterField = (inRow: boolean) => (docs.length || filtering ? <FilterField value={q} onChange={setQ} label="Filter notes" inRow={inRow} /> : null);
  // How the list is shown: in the toolbar on most lists, in a folder's title row on its page.
  const layoutSwitch = (compact: boolean) => (
    <div role="radiogroup" aria-label="Layout" className={compact ? ROW_SEG : "ui-seg ui-well"}>
      {(
        [
          ["grid", "Grid", <LayoutGrid key="g" size={15} />],
          ["list", "List", <List key="l" size={15} />],
        ] as const
      ).map(([value, label, icon]) => (
        <button key={value} type="button" role="radio" aria-checked={layout === value} data-active={layout === value} aria-label={label} title={label} onClick={() => setLayout(value)}>
          {icon}
        </button>
      ))}
    </div>
  );
  // A folder's page: one compact title row (the owner, 6 November 2026, "A. One compact row"): the folder's glyph,
  // the way up when it's nested, its name and count, then Sort, the view switch, Share and its "…" menu. No New note
  // of its own: the top bar's makes the note in the open folder (useCreateDocument).
  const folderHeader =
    view === "folder" && folderId ? (
      <ListPageHeader
        title={title}
        mark={<FolderGlyph color={folder?.color} size={22} />}
        markColor={folder?.color}
        path={crumbs.length ? crumbs.map((c) => ({ label: c.name, href: `/folders/${c.id}`, color: c.color })) : undefined}
        count={loading ? undefined : `${countText}${!online && cached ? " · saved on this device" : ""}`}
        before={filterField(true)}
        controls={
          <>
            <RowSort<Sort> value={sort} onChange={setSort} options={NOTE_SORTS} />
            <RowTraySep />
            {layoutSwitch(true)}
            <RowTraySep />
            {caps.sharing ? (
              <button type="button" aria-label="Share" title="Share" className={ROW_ICON_BUTTON} onClick={() => setSharingFolder(true)}>
                <Share2 size={15} aria-hidden />
              </button>
            ) : null}
            {folder ? <FolderMenu folder={folder} tooltip="More" trigger={<MoreHorizontal size={15} aria-hidden />} triggerClassName={ROW_ICON_BUTTON} /> : null}
          </>
        }
      />
    ) : null;

  const dialogs = (
    <>
      {sharingFolder && folderId ? <FolderShareDialog open onClose={() => setSharingFolder(false)} folderId={folderId} name={org?.folders.find((f) => f.id === folderId)?.name ?? ""} /> : null}
      {selectionActions.dialogs}
      <Dialog
        // In the apps it's the system's alert, which can't change once shown: it's asked when the count is in.
        open={confirmEmpty && (!nativeAlert || trashSummary !== undefined)}
        onClose={() => setConfirmEmpty(false)}
        title="Empty Trash?"
        description={summaryText}
        size="sm"
        confirm={{ label: "Delete permanently", destructive: true, onConfirm: () => void runEmptyTrash() }}
        footer={
          <>
            <Button onClick={() => setConfirmEmpty(false)}>Cancel</Button>
            <Button variant="danger" disabled={!trashSummary || trashSummary.deletable === 0} onClick={() => void runEmptyTrash()}>
              Delete permanently
            </Button>
          </>
        }
      />
    </>
  );

  if (columns && !iphone) {
    return (
      <NoteColumns
        list={columns.list}
        noteId={columns.noteId}
        row={columns.row ?? columns.noteId}
        note={columns.note}
        view={view}
        title={title}
        mark={view === "folder" ? <FolderGlyph color={folder?.color} size={20} /> : undefined}
        count={loading || listEmpty ? undefined : sentence([countText, !online && cached ? "saved on this device" : null, canArrange ? "drag to arrange" : null].filter(Boolean).join(" · "))}
        docs={docs}
        shown={shown}
        loading={loading}
        failed={listFailed ? { what: LIST_WHAT[view], onRetry: paged.retry } : undefined}
        canLoadMore={canLoadMore}
        onLoadMore={() => (moreCached ? setCachedShown((n) => n + PAGE_SIZE) : loadMore(PAGE_SIZE))}
        sort={sort}
        filter={filterField(false)}
        controls={
          <>
            {/* Nothing to sort in an empty list (the owner: not on an empty Archive or folder). */}
            {listEmpty ? null : <ColumnSort value={sort} onChange={setSort} />}
            {/* (A folder's options, Share among them, are its right-click menu in the sidebar: the column's head keeps to
                Sort.) */}
            {view === "trash" && results.length ? (
              <MenuButton label="Trash actions" trigger={<MoreHorizontal size={15} aria-hidden />} triggerClassName={ROW_ICON_BUTTON} items={[{ label: "Empty Trash…", icon: <Trash2 size={14} />, danger: true, onSelect: () => setConfirmEmpty(true) }]} />
            ) : null}
          </>
        }
        empty={{
          ...EMPTY[view],
          action:
            view === "all" || view === "folder" || view === "unsorted" ? (
              <Button variant="primary" onClick={() => void createDocument({})}>
                <Plus size={14} aria-hidden /> New note
              </Button>
            ) : undefined,
        }}
        filtering={filtering}
        filterEmpty={<p className="px-3 pt-4 text-subheadline text-muted">No notes match “{q.trim()}”.</p>}
        rowProps={cardProps}
        rowMenu={(d) => <DocMenu {...menuProps(d)} />}
        selected={selection.selected}
        unsynced={unsynced}
        unsyncedMark={<UnsyncedMarker />}
        dropTarget={dropTarget}
        overlay={
          selection.selectedIds.length ? (
            <SelectionBar count={selection.selectedIds.length} total={itemIds.length} actions={bulkActions} onSelectAll={selection.selectAll} onClear={selection.clear} label={selectionActions.label} />
          ) : null
        }
      >
        {ctx ? <NoteContextMenu key={ctx.doc.id + ctx.at.x + ctx.at.y} at={ctx.at} onDone={() => setCtx(null)} {...menuProps(ctx.doc)} /> : null}
        {selectionCtx ? <ContextMenu key={selectionCtx.x + selectionCtx.y} at={selectionCtx} label={`${selectionActions.noun} selected`} items={selectionActions.menuItems} onClose={() => setSelectionCtx(null)} /> : null}
        {dialogs}
      </NoteColumns>
    );
  }

  if (iphone) {
    return (
      <IphoneNoteList
        // (The phone shows the Folders page as folders: its notes view is only drawn in the columns layout.)
        view={view === "folders" ? "all" : view}
        title={title}
        docs={docs}
        loading={loading}
        failed={listFailed ? { ...loadFailedCopy(LIST_WHAT[view]), onRetry: paged.retry } : undefined}
        canLoadMore={canLoadMore}
        onLoadMore={() => (moreCached ? setCachedShown((n) => n + PAGE_SIZE) : loadMore(PAGE_SIZE))}
        subfolders={subfolders}
        empty={{
          ...EMPTY[view],
          body: view === "folder" && subfolders.length ? "The folders above hold the rest." : view === "templates" && builtIns?.length ? "Save any note as a template from its menu, or start from a built-in one above." : EMPTY[view].body,
          action:
            view === "all" || view === "folder" ? (
              <Button variant="primary" onClick={() => void createDocument({})}>
                <Plus size={14} aria-hidden /> New note
              </Button>
            ) : null,
        }}
        selection={selection}
        bulkActions={bulkActions}
        sort={sort}
        onSort={setSort}
        unsynced={unsynced}
        canArrange={canArrange}
        onNudge={nudge}
        tint={view === "folder" ? folderHex(org?.folders.find((f) => f.id === folderId)?.color) : undefined}
        menu={[
          ...(view === "trash" && results.length ? [{ label: "Empty Trash", icon: <Trash2 size={18} />, danger: true, onSelect: () => setConfirmEmpty(true) }] : []),
          ...(view === "templates" ? [{ label: "New template", icon: <Plus size={18} />, onSelect: () => void createDocument({ folderId: null, kind: "template" }) }] : []),
          ...(view === "templates" && aiOn && online ? [{ label: "Generate with Foli AI", icon: <AiIcon size={18} />, onSelect: () => setGenerating(true) }] : []),
          ...(view === "folder" && folderId ? [{ label: "New note here", icon: <FilePlus2 size={18} />, onSelect: () => void createDocument({ folderId }) }] : []),
        ]}
        before={
          view === "templates" && builtIns?.length ? (
            <section aria-labelledby="builtin-title" className="pt-3">
              <h2 id="builtin-title" className="px-5 pb-1 text-subheadline font-medium uppercase tracking-[0.02em] text-muted">
                Built-in templates
              </h2>
              {builtIns.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  aria-label={`New note from ${t.name}`}
                  onClick={() => void createDocument({ title: t.name, templateId: t.key })}
                  className="flex w-full items-center gap-3 pl-5 pr-4 text-left outline-none hover:bg-[var(--glass-hover)] active:bg-[var(--liquid-press)]"
                >
                  <TemplateTile name={t.icon} />
                  <span className="ui-row-sep min-w-0 flex-1 py-2.5">
                    <span className="block truncate text-body text-ink">{t.name}</span>
                    <span className="block truncate text-subheadline text-muted">{t.description}</span>
                  </span>
                </button>
              ))}
              <h2 className="px-5 pb-1 pt-6 text-subheadline font-medium uppercase tracking-[0.02em] text-muted">Your templates</h2>
            </section>
          ) : null
        }
      >
        {dialogs}
        {view === "templates" && aiOn && generated ? (
          <Suspense fallback={null}>
            <AiGenerateDialog open={generating} onClose={() => setGenerating(false)} kind="template" />
          </Suspense>
        ) : null}
      </IphoneNoteList>
    );
  }

  return (
    <ViewChrome
      // A folder's page names itself in its title row (with the way up); the other lists in a hidden heading.
      title={folderHeader ? null : heading}
      tabTitle={title}
      // A folder's page takes a faint wash of its colour.
      tint={view === "folder" ? folderHex(org?.folders.find((f) => f.id === folderId)?.color) : undefined}
      overlay={
        selection.selectedIds.length ? (
          <SelectionBar count={selection.selectedIds.length} total={itemIds.length} actions={bulkActions} onSelectAll={selection.selectAll} onClear={selection.clear} label={selectionActions.label} />
        ) : null
      }
    >
      {/* The surface fills the scrolling area so a selection rectangle can start anywhere around the cards. */}
      <div className="min-h-full" onPointerDown={selection.onSurfacePointerDown}>
      <div className="mx-auto max-w-[1180px] px-4 pb-[max(6rem,var(--fab-clearance))] pt-3 sm:px-8">
        {folderHeader ?? (
        <div data-toolbar="" className="mb-5 flex flex-wrap items-center gap-2">
          <p role="status" className="mr-auto min-w-0 truncate text-subheadline text-muted">
            {loading || listEmpty
              ? undefined
              : sentence(
                  [view === "templates" ? templatesCountText(builtIns?.length ?? 0, docs.length, canLoadMore) : countText, !online && cached ? "saved on this device" : null, canArrange ? "drag to arrange" : null]
                    .filter(Boolean)
                    .join(" · "),
                )}
          </p>
          {/* An empty list has nothing to sort or lay out: its empty state says so, without a "0 notes" over it. */}
          {listEmpty ? null : (
            <>
              {filterField(false)}
              <label className="flex items-center gap-2 text-subheadline text-muted">
                <span>Sort</span>
                <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="ui-hit h-control ui-input px-3 text-callout text-ink">
                  {NOTE_SORTS.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </Select>
              </label>
              {layoutSwitch(false)}
            </>
          )}
          {/* Page actions share the toolbar row. */}
          {view === "trash" && results.length ? (
            <Button variant="quiet" onClick={() => setConfirmEmpty(true)}>
              Empty Trash
            </Button>
          ) : null}
          {view === "templates" && aiOn && online ? (
            <Button variant="secondary" onClick={() => setGenerating(true)}>
              <AiIcon size={14} aria-hidden className="text-[#7c6cf0]" /> Generate with Foli AI
            </Button>
          ) : null}
          {view === "templates" ? (
            <Button variant="primary" onClick={() => void createDocument({ folderId: null, kind: "template" })}>
              <Plus size={14} aria-hidden /> New template
            </Button>
          ) : null}
          {view === "templates" && aiOn && generated ? (
          <Suspense fallback={null}>
            <AiGenerateDialog open={generating} onClose={() => setGenerating(false)} kind="template" />
          </Suspense>
        ) : null}
        </div>
        )}

        {subfolderCards.length && !filtering ? (
          // A third smaller than All folders' cards: the page's own notes stay the main thing here. A section of its
          // own, under a small heading as Built-in templates has.
          <section aria-labelledby="subfolders-title">
            <h2 id="subfolders-title" data-section-label="" className={SECTION_LABEL}>
              Folders
            </h2>
            <ul aria-label="Folders inside" className="-mt-4 mb-10 grid grid-cols-[repeat(auto-fill,var(--subfolder-card))] gap-x-[var(--subfolder-gap-x)] gap-y-[var(--subfolder-gap-y)]">
              {subfolderCards.map((f) => {
                const on = selection.selected.has(f.id);
                return (
                  <li key={f.id} data-card-id={f.id} onClickCapture={selection.onCardClick(f.id)} onContextMenu={(e) => selectionMenuAt(e, f.id)}>
                    <FolderCard folder={f} labelScale={SUBFOLDER_LABELS} selected={on} dragSelection={on && selection.selectedIds.length > 1 ? (e) => dragSelection(e, f.id) : undefined} />
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {view === "templates" && builtIns?.length ? (
          <section aria-labelledby="builtin-title" className="mb-10">
            <h3 id="builtin-title" className={SECTION_LABEL}>
              Built-in templates
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {builtIns.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  aria-label={`New page from ${t.name}`}
                  onClick={() => void createDocument({ title: t.name, templateId: t.key })}
                  data-card-row=""
                  className="flex items-start gap-3 ui-card rounded-control p-4 text-left transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--shadow-edge),var(--shadow-floating)]"
                >
                  <TemplateTile name={t.icon} />
                  <span>
                    <span className="block font-medium">{t.name}</span>
                    <span className="block text-subheadline text-muted">{t.description}</span>
                  </span>
                </button>
              ))}
            </div>
            <h3 className={`${SECTION_LABEL} mt-8`}>Your templates</h3>
          </section>
        ) : null}

        {/* A folder with folders and notes names both sections (the owner, 28 November 2026). */}
        {subfolderCards.length && !filtering && !loading && !listFailed && docs.length ? (
          <h2 data-section-label="" className={SECTION_LABEL}>
            Notes
          </h2>
        ) : null}
        {loading ? (
          <div className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-52 animate-pulse ui-card rounded-control motion-reduce:animate-none" />
            ))}
          </div>
        ) : listFailed ? (
          <LoadFailed what={LIST_WHAT[view]} onRetry={paged.retry} />
        ) : filtering && shown.length === 0 ? (
          <EmptyState icon={FileText} title={`No notes match “${q.trim()}”`} body={canLoadMore ? "Load more to look further, or search all notes." : "Try other words, or search all notes."} />
        ) : docs.length === 0 ? (
          <EmptyState
            icon={EMPTY[view].icon}
            title={view === "folder" && subfolders.length ? "No notes directly in this folder yet" : EMPTY[view].title}
            body={view === "folder" && subfolders.length ? "The folders above hold the rest." : view === "templates" && builtIns?.length ? "Save any note as a template from its menu, or start from a built-in one above." : EMPTY[view].body}
            action={
              view === "all" || view === "folder" ? (
                // On a folder page the new note starts in that folder.
                <Button variant="primary" onClick={() => void createDocument({})}>
                  <Plus size={14} aria-hidden /> New note
                </Button>
              ) : null
            }
          />
        ) : layout === "list" ? (
          // Apple Notes-style rows (the owner, 28 November 2026): the serif title over the note's first words on the left,
          // the time over its folder (or Draft) and tags on the right. Hairlines start at the text and stop before the
          // last row; the "…" and the drag handle show on hover.
          <ul aria-label="Notes" className="-mx-3">
            {shown.map((d) => {
              const on = selection.selected.has(d.id);
              const time = view === "trash" && d.deletedAt ? `Deleted ${formatRelative(d.deletedAt)}` : editedText(d.updatedAt);
              const firstWords = d.excerpt.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
              return (
                <li
                  key={d.id}
                  className={`group relative rounded-chip transition-colors [&:last-child_[data-note-row-body]]:border-b-transparent ${on ? "bg-[var(--glass-active)]" : "hover:bg-[var(--glass-hover)]"} ${dropTarget === d.id ? "shadow-[inset_0_2px_0_var(--color-heading)]" : ""}`}
                  {...cardProps(d)}
                >
                  <span className="absolute -left-4 top-1/2 -translate-y-1/2">
                    <DocDragHandle ids={on ? selection.selectedIds : [d.id]} />
                  </span>
                  <AppLink href={`/d/${d.id}`} className="flex items-center gap-3 px-3 outline-none focus-visible:bg-[var(--glass-hover)]">
                    {on ? (
                      <span className="grid h-4 w-4 flex-none place-items-center rounded-tiny bg-heading text-canvas">
                        <Check size={11} strokeWidth={3} aria-hidden />
                        <span className="sr-only">Selected</span>
                      </span>
                    ) : null}
                    {/* The title and the note's first words on the left; the time and its folder (or Draft) on the right. */}
                    <span data-note-row-body="" className="flex min-w-0 flex-1 items-center gap-6 border-b border-[var(--color-line)] py-3 pr-10">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="ui-list-name min-w-0 truncate">{d.title || "Untitled"}</span>
                          {unsynced.has(d.id) ? <UnsyncedMarker /> : null}
                        </span>
                        <span className="mt-0.5 block truncate text-subheadline leading-[18px] text-muted">{firstWords || "No additional text"}</span>
                      </span>
                      <span className="flex max-w-[40%] flex-none flex-col items-end gap-1">
                        <span className="ui-list-meta text-ink/80">{time}</span>
                        <span className="ui-list-meta flex min-w-0 max-w-full items-center gap-1.5">
                          {d.tags.length ? <span className="truncate text-faint">{d.tags.map((t) => `#${t.name}`).join(" ")}</span> : null}
                          {d.kind === "template" ? (
                            <span>Template</span>
                          ) : d.homeFolder ? (
                            <>
                              <FolderGlyph color={d.homeFolder.color} size={11} />
                              <span className="truncate">{d.homeFolder.name}</span>
                            </>
                          ) : (
                            <>
                              <PencilLine size={11} strokeWidth={2} aria-hidden className="flex-none" />
                              <span>Draft</span>
                            </>
                          )}
                        </span>
                      </span>
                    </span>
                  </AppLink>
                  <div data-card-menu="" className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
                    {d.kind === "template" && view !== "trash" ? <UseTemplateButton doc={d} /> : null}
                    <DocMenu {...menuProps(d)} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className={`grid gap-x-[var(--card-gap)] gap-y-[var(--card-row-gap)] grid-cols-[repeat(auto-fill,minmax(var(--note-card-min),1fr))]`}>
            {cards.map((d) => {
              const on = selection.selected.has(d.id);
              return (
                <li
                  key={d.id}
                  className={`group relative [container-type:inline-size] rounded-chip ${dropTarget === d.id || on ? "ring-2 ring-heading ring-offset-4 ring-offset-canvas" : ""}`}
                  {...cardProps(d)}
                >
                  <AppLink href={`/d/${d.id}`} className={NOTE_CARD_LINK}>
                    <NoteCardFace
                      title={d.title}
                      excerpt={d.excerpt}
                      preview={d.preview}
                      shape={d.shape}
                      kind={d.kind}
                      cover={d.cover}
                      style={d.style}
                      createdAt={d.createdAt}
                      time={view === "trash" && d.deletedAt ? `Deleted ${formatRelative(d.deletedAt)}` : editedText(d.updatedAt)}
                      starred={d.starred}
                      folder={d.homeFolder}
                      showFolder={d.kind !== "template"}
                      extra={unsynced.has(d.id) ? <UnsyncedMarker /> : null}
                    />
                    {on ? <span className="sr-only">Selected</span> : null}
                  </AppLink>
                  {on ? <SelectedCheck /> : null}
                  <div data-card-menu="" className={`absolute top-2 flex items-center gap-1 ${d.starred ? "right-[calc(11cqw+4px)]" : "right-2"} opacity-0 transition-[opacity,translate] duration-200 ease-[var(--ease-folio)] group-focus-within:opacity-100 group-hover:-translate-y-0.5 group-hover:opacity-100 pointer-coarse:opacity-100`}>
                    {d.kind === "template" && view !== "trash" ? <UseTemplateButton doc={d} raised /> : null}
                    <div className="ui-raised rounded-tiny [&_button]:rounded-tiny">
                      <DocMenu {...menuProps(d)} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {canLoadMore ? (
          <div className="mt-12 text-center">
            <Button onClick={() => (moreCached ? setCachedShown((n) => n + PAGE_SIZE) : loadMore(PAGE_SIZE))}>Load more</Button>
          </div>
        ) : null}
      </div>
      </div>
      <SelectionMarquee rect={selection.marquee} />
      {ctx ? <NoteContextMenu key={ctx.doc.id + ctx.at.x + ctx.at.y} at={ctx.at} onDone={() => setCtx(null)} {...menuProps(ctx.doc)} /> : null}
      {selectionCtx ? <ContextMenu key={selectionCtx.x + selectionCtx.y} at={selectionCtx} label={`${selectionActions.noun} selected`} items={selectionActions.menuItems} onClose={() => setSelectionCtx(null)} /> : null}
      {dialogs}
    </ViewChrome>
  );
}

/** The column's sort: a "…"-sized button with the sorts in its menu (the column is too narrow for the row's field). */
function ColumnSort({ value, onChange }: { value: Sort; onChange: (v: Sort) => void }) {
  return (
    <MenuButton
      label={`Sort by: ${NOTE_SORTS.find(([v]) => v === value)?.[1] ?? ""}`}
      trigger={<ArrowDownUp size={15} aria-hidden />}
      triggerClassName={ROW_ICON_BUTTON}
      items={NOTE_SORTS.map(([v, label]) => ({ label, icon: v === value ? <Check size={14} /> : <span className="inline-block w-3.5" />, onSelect: () => onChange(v) }))}
    />
  );
}

/** A subfolder card is 152 px wide, about two thirds of All folders' (~234 px): its labels stay that card's size. */
const SUBFOLDER_LABELS = 234 / 152;

function DocDragHandle({ ids }: { ids: string[] }) {
  return (
    <span
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        startNoteDrag(e, ids);
      }}
      aria-hidden
      className="w-3 flex-none cursor-grab overflow-hidden text-center text-faint opacity-0 group-hover:opacity-100"
    >
      ⋮⋮
    </span>
  );
}

function UseTemplateButton({ doc, raised }: { doc: Summary; raised?: boolean }) {
  const createDocument = useCreateDocument();
  return (
    <button
      type="button"
      onClick={() => void createDocument({ title: doc.title, templateId: doc.id })}
      className={`ui-btn ${raised ? "ui-btn-secondary" : "ui-btn-ghost"} h-control gap-1 px-2.5 text-footnote`}
      aria-label={`New page from template ${doc.title || "Untitled"}`}
    >
      <FilePlus2 size={13} aria-hidden /> Use
    </button>
  );
}

interface DocMenuProps {
  doc: Summary;
  view: View;
  arrange?: { up: () => void; down: () => void };
  /** Offer "Select" (the keyboard way into multi-select). */
  select?: { selected: boolean; toggle: () => void };
  /** Offer "Remove from recent" (Home's Recent notes). */
  recent?: boolean;
  /** Offer "Float this note" (the right-click menu only; lib/app/float.ts). */
  floatable?: boolean;
  /** In the columns layout a click already opens the note here: "Open in New Tab" instead of Open. */
  columns?: boolean;
}

/**
 * A note's actions (shared by its "…" button and its right-click menu), with the dialogs they open.
 * `dialogOpen` tells a context menu to stay mounted while one of its dialogs is showing.
 */
function useDocMenu({ doc, view, arrange, select, recent, floatable, columns }: DocMenuProps): { items: (MenuItem | "separator")[]; dialogs: ReactNode; dialogOpen: boolean } {
  const createDocument = useCreateDocument();
  const duplicate = useMutation(api.documents.duplicate);
  const notes = useNoteActions();
  const toast = useToast();
  const { navigate } = useAppRouter();
  const [moveOpen, setMoveOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const canCopy = useCanCopyElsewhere();
  // In the phone layout there are no tabs to open a note in, and a tap already opens it (docs/IOS_POLISH_PLAN.md
  // §3 Lists): the menu leads with what you'd do to the note.
  const phone = useIphoneApp();
  const ids = [doc.id];

  const items: (MenuItem | "separator")[] =
    view === "trash"
      ? [
          { label: "Restore", icon: <Undo2 size={14} />, onSelect: () => void notes.restore(ids) },
          ...(select ? [{ label: select.selected ? "Deselect" : "Select", icon: <CheckSquare size={14} />, onSelect: select.toggle }] : []),
          "separator" as const,
          { label: "Delete permanently…", icon: <Trash2 size={14} />, danger: true, onSelect: () => setDeleteOpen(true) },
        ]
      : [
          ...(doc.kind === "template" ? [{ label: "New page from template", icon: <FilePlus2 size={14} />, onSelect: () => void createDocument({ title: doc.title, templateId: doc.id }) }] : []),
          ...(phone && doc.kind !== "template"
            ? []
            : [
                // (In the columns layout a click already opens the note, and there are no tabs to open it in.)
                ...(columns && doc.kind !== "template" ? [] : [{ label: doc.kind === "template" ? "Edit template" : "Open", icon: <ExternalLink size={14} />, onSelect: () => navigate(`/d/${doc.id}`) }]),
              ]),
          ...(floatable && doc.kind !== "template" ? floatMenuItems({ id: doc.id, title: doc.title }) : []),
          doc.starred
            ? { label: "Remove bookmark", icon: <BookmarkOff size={14} />, onSelect: () => void notes.star(ids, false) }
            : { label: "Bookmark", icon: <Bookmark size={14} />, onSelect: () => void notes.star(ids, true) },
          ...(phone && doc.kind !== "template" ? [{ label: "Move to folder…", icon: <FolderInput size={14} />, onSelect: () => setMoveOpen(true) }] : []),
          { label: "Duplicate", icon: <Copy size={14} />, onSelect: () => void duplicate({ documentId: doc.id }).then(() => toast.show("Duplicated"), (e) => toast.show(errorMessage(e), { tone: "error" })) },
          ...(!phone && doc.kind !== "template" ? [{ label: "Move to folder…", icon: <FolderInput size={14} />, onSelect: () => setMoveOpen(true) }] : []),
          ...(canCopy ? [{ label: "Copy to…", icon: <CopyPlus size={14} />, onSelect: () => setCopyOpen(true) }] : []),
          doc.archivedAt
            ? { label: "Unarchive", icon: <ArchiveRestore size={14} />, onSelect: () => void notes.archive(ids, false) }
            : { label: "Archive", icon: <Archive size={14} />, onSelect: () => void notes.archive(ids, true) },
          ...(recent ? [{ label: "Remove from recent", icon: <EyeOff size={14} />, onSelect: () => void notes.removeFromRecent(ids) }] : []),
          ...(select ? [{ label: select.selected ? "Deselect" : "Select", icon: <CheckSquare size={14} />, onSelect: select.toggle }] : []),
          ...(arrange
            ? ["separator" as const, { label: "Move up", icon: <ArrowUp size={14} />, onSelect: arrange.up }, { label: "Move down", icon: <ArrowDown size={14} />, onSelect: arrange.down }]
            : []),
          "separator" as const,
          { label: "Move to Trash", icon: <Trash2 size={14} />, danger: true, onSelect: () => void notes.trash(ids) },
        ];

  // Every card and row has these: each is drawn once it first opens (useOpenedOnce), not closed on every row.
  const moveDrawn = useOpenedOnce(moveOpen);
  const deleteDrawn = useOpenedOnce(deleteOpen);
  const dialogs = (
    <>
      {moveDrawn ? <MoveToFolderDialog open={moveOpen} onClose={() => setMoveOpen(false)} noteTitle={doc.title} currentFolderId={doc.folderId} onPick={(folder) => void notes.moveTo(ids, folder)} /> : null}
      {copyOpen ? <CopyToDialog open onClose={() => setCopyOpen(false)} documentIds={ids} noteTitle={doc.title} /> : null}
      {deleteDrawn ? <PermanentDeleteDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} documentId={doc.id} title={doc.title} /> : null}
    </>
  );
  return { items, dialogs, dialogOpen: moveOpen || copyOpen || deleteOpen };
}

export function DocMenu(props: DocMenuProps) {
  const { items, dialogs } = useDocMenu(props);
  return (
    <>
      <MenuButton label={`More actions for ${props.doc.title || "Untitled"}`} trigger={<MoreHorizontal size={16} aria-hidden />} items={items} />
      {dialogs}
    </>
  );
}

/** A note's actions at the pointer (right-click on a card or row). Stays mounted while a dialog it opened is showing. */
export function NoteContextMenu({ at, onDone, ...props }: DocMenuProps & { at: { x: number; y: number }; onDone: () => void }) {
  const { items, dialogs, dialogOpen } = useDocMenu({ ...props, floatable: true });
  const [menuOpen, setMenuOpen] = useState(true);
  useEffect(() => {
    if (!menuOpen && !dialogOpen) onDone();
  }, [menuOpen, dialogOpen, onDone]);
  return (
    <>
      {menuOpen ? <ContextMenu at={at} label={`More actions for ${props.doc.title || "Untitled"}`} items={items} onClose={() => setMenuOpen(false)} /> : null}
      {dialogs}
    </>
  );
}

export function PermanentDeleteDialog({ open, onClose, documentId, title }: { open: boolean; onClose: () => void; documentId: string; title: string }) {
  const del = useMutation(api.documents.deletePermanently);
  const toast = useToast();
  const [typed, setTyped] = useState("");
  const expected = title.trim() || "Untitled";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Delete permanently?"
      description={
        <>
          “{expected}”, its nested pages, attachments and version history will be deleted for everyone. This can’t be undone. Type the title to confirm.
        </>
      }
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={typed.trim() !== expected}
            onClick={async () => {
              try {
                await del({ documentId, confirmTitle: typed });
                toast.show("Deleted permanently");
                onClose();
              } catch (e) {
                toast.show(errorMessage(e), { tone: "error" });
              }
            }}
          >
            Delete permanently
          </Button>
        </>
      }
    >
      <label className="block text-subheadline" htmlFor="confirm-title">
        Document title
      </label>
      <input id="confirm-title" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus className="mt-1 h-control w-full ui-input px-3 text-callout" />
    </Dialog>
  );
}
