"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Check, CheckSquare, ChevronRight, Copy, CopyPlus, EyeOff, FilePlus2, ExternalLink, FolderInput, LayoutGrid, List, MoreHorizontal, Plus, Rows3, Star, StarOff, Trash2, Undo2, FileText, Files, FolderOpen, Hash, Inbox, LayoutTemplate, Share2, type LucideIcon } from "lucide-react";
import { folderAncestors } from "@folevi/editor-schema";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { api } from "@/lib/convex/api";
import { endFolderDrag, startFolderDrag, useFolderTree, useFolderTreeState } from "@/lib/app/folders";
import { useOutboxEntries } from "@/lib/sync/queryCache";
import { hasNative } from "@/lib/native/ui";
import { pendingNoteFolders } from "@/lib/sync/overlays";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { useEngineSelector, useLocalStorage } from "@/lib/hooks/useEngine";
import { startNoteDrag, NOTE_MIME } from "@/lib/app/noteDrag";
import { useDropHint } from "@/lib/app/dragSession";
import { DropRefusal } from "@/components/app/FolderDropLayer";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ContextMenu, MenuButton, type MenuItem } from "@/components/ui/Menu";
import { Dialog } from "@/components/ui/Dialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ViewChrome } from "@/components/app/Shell";
import { folderHex } from "@/lib/folderColors";
import { useCreateDocument } from "@/components/app/useCreateDocument";
import { ageText, formatRelative } from "@/lib/format";
import { t } from "@/i18n";
import { localDb } from "@/lib/sync/db";
import { TemplateTile } from "@/components/ui/TemplateIcon";
import { DocumentCardPreview, NOTE_CARD_LINK, NoteCardFace } from "./DocumentCard";
import { FolderBadge } from "./FolderBadge";
import { pendingByDocument, type PendingDocument } from "@/lib/hooks/usePendingDocs";
import { useNotesWithLocal } from "@/lib/hooks/useLocalNotes";
import { Select } from "@/components/ui/Select";
import { MoveToFolderDialog } from "./MoveToFolderDialog";
import { CopyToDialog, useCanCopyElsewhere } from "./CopyToDialog";
import { SelectionBar, type SelectionAction } from "./SelectionBar";
import { useCardSelection } from "./useCardSelection";
import { useNoteActions } from "./noteActions";
import { useAiEnabled } from "@/components/ai/useAi";
import { AiIcon } from "@/components/ai/AiIcon";
import { useIphoneApp } from "@/lib/iphone";
import { IphoneNoteList } from "@/components/iphone/NoteList";
import { useCapabilities } from "@/lib/mode";
import { FolderShareDialog } from "@/components/app/FolderShareDialog";

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

type View = "all" | "starred" | "archive" | "trash" | "templates" | "unsorted" | "folder" | "tag";
type Layout = "grid" | "compact" | "list";
type Sort = "updated" | "created" | "title" | "manual";

const TITLES: Record<View, string> = {
  all: "Home",
  starred: "Starred",
  archive: "Archive",
  trash: "Trash",
  templates: "Templates",
  unsorted: "Drafts",
  folder: "Folder",
  tag: "Tag",
};

// What an empty list says: a short heading and one line of help.
const EMPTY: Record<View, { icon: LucideIcon; title: string; body?: string }> = {
  all: { icon: Files, title: "Nothing here yet", body: "Starting a document takes one keystroke." },
  starred: { icon: Star, title: "Nothing starred yet", body: "Star a note to keep it close at hand." },
  archive: { icon: Archive, title: "Archive is empty", body: "Archived notes rest here, out of your lists but never lost." },
  trash: { icon: Trash2, title: "Trash is empty", body: "Deleted notes stay here for 30 days." },
  templates: { icon: LayoutTemplate, title: "No templates of your own yet", body: "Save any document as a template from its menu." },
  unsorted: { icon: Inbox, title: "No drafts", body: "Everything has a folder. Nicely done." },
  folder: { icon: FolderOpen, title: "This folder is empty", body: "Start a document here, or move one in with Move to folder." },
  tag: { icon: Hash, title: "No documents carry this tag yet", body: "Add tags to a document from its Info panel." },
};

const PAGE_SIZE = 48;

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

export function DocumentBrowser({ view, folderId, tagId, title }: { view: View; folderId?: string; tagId?: string; title?: string }) {
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
  return <DocumentList view={view} folderId={folderId} tagId={tagId} org={org} titleOverride={title} />;
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
        <AppLink href="/documents" className="ui-btn ui-btn-primary mt-6 h-9 px-4 text-callout">
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
 * filters them; null where the device can't tell (tags, stars, templates, a manual order) and it waits for the
 * server, unless offline (then the kept rows, as before).
 */
function cachedViewFilter(view: View, sort: Sort, online: boolean): ((d: KeptRow) => boolean) | null {
  const page = (d: KeptRow) => d.kind === "document" || d.kind === "daily" || d.kind === undefined;
  const live = (d: KeptRow) => !d.deletedAt && !d.archivedAt;
  const ordered = sort === "updated" || sort === "created";
  switch (view) {
    case "all":
    case "folder":
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

function DocumentList({ view, folderId, tagId, org, titleOverride }: { view: View; folderId?: string; tagId?: string; org: Org; titleOverride?: string }) {
  const { scope, scopeKey, profile, online, engine, outbox, canEdit } = useAppState();
  const [layout, setLayout] = useLocalStorage<Layout>(`folevi:layout:${view}`, view === "trash" || view === "archive" ? "list" : "grid");
  const [sort, setSort] = useLocalStorage<Sort>(`folevi:sort:${view}`, "updated");
  // A folder made on this device whose creation is still in the outbox (just made, or made offline) isn't on
  // the server (or in the library) yet: asking for its notes would fail as not found and take the page down.
  // Until it's there it's an empty folder; its notes, if any were filed while it waited, arrive with it.
  const queued = useOutboxEntries(outbox);
  const unsent = view === "folder" && !!folderId && queued.some((e) => e.creates?.includes(folderId));
  const paged = usePaginatedQuery(api.documents.list, unsent ? "skip" : { scope, view, folderId, tagId, sort }, { initialNumItems: PAGE_SIZE });
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
  const notes = useNoteActions();
  const [cached, setCached] = useState<Summary[] | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  // A folder's Share dialog, from the folder page's toolbar (docs/SHARING.md).
  const [sharingFolder, setSharingFolder] = useState(false);
  const caps = useCapabilities();
  const trashSummary = useQuery(api.documents.trashSummary, confirmEmpty ? { scope } : "skip");
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ doc: Summary; at: { x: number; y: number } } | null>(null);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkCopy, setBulkCopy] = useState<{ ids: string[]; title?: string } | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const canCopy = useCanCopyElsewhere();
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
  const docs =
    useNotesWithLocal(offlineNoList ? undefined : served, {
      include: view === "all" ? "all" : view === "unsorted" ? "drafts" : view === "folder" ? "folder" : "none",
      folderId,
      byUpdated: sort === "updated",
    }) ?? served;
  const moreCached = fromCache && (kept?.length ?? 0) > cachedShown;
  const canLoadMore = status === "CanLoadMore" || moreCached;
  const loading = status === "LoadingFirstPage" && !cached && docs.length === 0;
  const canArrange = sort === "manual" && view !== "trash";
  // Only the pages with unsynced work, compared by value: this list shouldn't re-render on every keystroke.
  const pendingDocs = useEngineSelector(engine, pendingByDocument, samePending);
  const unsynced = useMemo(() => new Set(pendingDocs.filter((p) => p.changes > 0 || p.uploads > 0).map((p) => p.documentId)), [pendingDocs]);

  // Multi-select (templates have their own actions and aren't selectable).
  const selectable = view !== "templates";
  const docIds = useMemo(() => docs.map((d) => d.id), [docs]);
  const selection = useCardSelection(docIds, selectable);
  const selectedDocs = useMemo(() => docs.filter((d) => selection.selected.has(d.id)), [docs, selection.selected]);
  const sharedFolder = selectedDocs.length && selectedDocs.every((d) => d.folderId === selectedDocs[0]!.folderId) ? selectedDocs[0]!.folderId : undefined;
  const bulk = (run: (ids: string[]) => Promise<unknown>) => {
    const ids = selection.selectedIds;
    selection.clear();
    void run(ids);
  };
  const bulkActions: SelectionAction[] =
    view === "trash"
      ? [
          { label: "Restore", icon: <Undo2 size={15} />, onClick: () => bulk((ids) => notes.restore(ids)) },
          { label: "Delete permanently…", icon: <Trash2 size={15} />, danger: true, onClick: () => setBulkDeleteOpen(true) },
        ]
      : [
          { label: "Move to folder…", icon: <FolderInput size={15} />, onClick: () => setBulkMoveOpen(true) },
          ...(canCopy
            ? [
                {
                  label: "Copy to…",
                  icon: <CopyPlus size={15} />,
                  onClick: () => {
                    // The dialog keeps the notes it was opened for; the selection is done with.
                    setBulkCopy({ ids: selection.selectedIds, title: selectedDocs[0]?.title });
                    selection.clear();
                  },
                },
              ]
            : []),
          selectedDocs.every((d) => d.starred)
            ? { label: "Unstar", icon: <StarOff size={15} />, onClick: () => bulk((ids) => notes.star(ids, false)) }
            : { label: "Star", icon: <Star size={15} />, onClick: () => bulk((ids) => notes.star(ids, true)) },
          view === "archive"
            ? { label: "Unarchive", icon: <ArchiveRestore size={15} />, onClick: () => bulk((ids) => notes.archive(ids, false)) }
            : { label: "Archive", icon: <Archive size={15} />, onClick: () => bulk((ids) => notes.archive(ids, true)) },
          { label: "Move to Trash", icon: <Trash2 size={15} />, danger: true, onClick: () => bulk((ids) => notes.trash(ids)) },
        ];

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
      e.preventDefault();
      setCtx({ doc: d, at: contextPoint(e) });
    },
    draggable: view !== "trash",
    // Dragging a selected card takes the whole selection along.
    onDragStart: (e: React.DragEvent) => startNoteDrag(e, selection.selected.has(d.id) ? selection.selectedIds : [d.id], (id) => (id === d.id ? d.title : docs.find((x) => x.id === id)?.title)),
    ...dropProps(d),
  });
  const menuProps = (d: Summary) => ({
    doc: d,
    view,
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

  // A folder inside other folders shows the way up (Work / Clients / Acme), and the folders inside it.
  const allFolders = org?.folders ?? [];
  const crumbs = view === "folder" && folderId ? folderAncestors(allFolders, folderId) : [];
  const subfolders = view === "folder" && folderId ? allFolders.filter((f) => f.parentFolderId === folderId) : [];
  const heading = <h1 className="truncate text-subheadline font-semibold">{title}</h1>;

  const dialogs = (
    <>
      {sharingFolder && folderId ? <FolderShareDialog open onClose={() => setSharingFolder(false)} folderId={folderId} name={org?.folders.find((f) => f.id === folderId)?.name ?? ""} /> : null}
      <MoveToFolderDialog
        open={bulkMoveOpen}
        onClose={() => setBulkMoveOpen(false)}
        count={selectedDocs.length}
        noteTitle={selectedDocs[0]?.title}
        currentFolderId={sharedFolder}
        onPick={(folder) => bulk((ids) => notes.moveTo(ids, folder))}
      />
      <CopyToDialog open={bulkCopy !== null} onClose={() => setBulkCopy(null)} documentIds={bulkCopy?.ids ?? []} noteTitle={bulkCopy?.title} />
      <Dialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        title={`Delete ${selectedDocs.length === 1 ? "1 note" : `${selectedDocs.length} notes`} permanently?`}
        description="They’ll be deleted for everyone, with their nested pages, attachments and version history. This can’t be undone. Notes you don’t have permission to delete stay in Trash."
        size="sm"
        confirm={{ label: "Delete permanently", destructive: true, onConfirm: () => bulk((ids) => notes.deleteForever(ids)) }}
        footer={
          <>
            <Button onClick={() => setBulkDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setBulkDeleteOpen(false);
                bulk((ids) => notes.deleteForever(ids));
              }}
            >
              Delete permanently
            </Button>
          </>
        }
      />
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

  if (iphone) {
    return (
      <IphoneNoteList
        view={view}
        title={title}
        docs={docs}
        loading={loading}
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
          ...(view === "templates" && aiOn && online ? [{ label: "Generate with AI", icon: <AiIcon size={18} />, onSelect: () => setGenerating(true) }] : []),
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
                  className="flex w-full items-center gap-3 pl-5 pr-4 text-left outline-none active:bg-[var(--liquid-press)]"
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
      title={
        crumbs.length ? (
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-0.5 text-subheadline">
            {crumbs.map((c) => (
              <span key={c.id} className="flex min-w-0 items-center gap-0.5">
                <AppLink href={`/folders/${c.id}`} className="min-w-0 max-w-[10rem] truncate rounded-chip px-1.5 py-0.5 text-muted transition-colors hover:bg-accent-soft hover:text-heading">
                  {c.name}
                </AppLink>
                <ChevronRight size={13} className="flex-none text-faint" aria-hidden />
              </span>
            ))}
            {heading}
          </nav>
        ) : (
          heading
        )
      }
      tabTitle={title}
      // A folder's page takes a faint wash of its colour.
      tint={view === "folder" ? folderHex(org?.folders.find((f) => f.id === folderId)?.color) : undefined}
      overlay={
        selection.selectedIds.length ? (
          <SelectionBar count={selection.selectedIds.length} total={docs.length} actions={bulkActions} onSelectAll={selection.selectAll} onClear={selection.clear} />
        ) : null
      }
    >
      {/* The surface fills the scrolling area so a selection rectangle can start anywhere around the cards. */}
      <div className="min-h-full" onPointerDown={selection.onSurfacePointerDown}>
      <div className="mx-auto max-w-[1180px] px-4 pb-[max(6rem,var(--fab-clearance))] pt-3 sm:px-8">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <p role="status" className="mr-auto min-w-0 truncate text-subheadline text-muted">
            {loading
          ? undefined
          : `${docs.length}${canLoadMore ? "+" : ""} ${view === "templates" ? (docs.length === 1 ? "template" : "templates") : docs.length === 1 ? "note" : "notes"}${!online && cached ? " · saved on this device" : ""}${canArrange ? " · drag to arrange" : ""}`}
          </p>
          <label className="flex items-center gap-2 text-subheadline text-muted">
            <span>Sort</span>
            <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-9 ui-input rounded-chip px-3 text-callout text-ink">
              <option value="updated">Last edited</option>
              <option value="created">Created</option>
              <option value="title">Title</option>
              <option value="manual">Manual order</option>
            </Select>
          </label>
          <div role="radiogroup" aria-label="Layout" className="ui-seg ui-well">
            {(
              [
                ["grid", "Grid", <LayoutGrid key="g" size={15} />],
                ["compact", "Compact cards", <Rows3 key="c" size={15} />],
                ["list", "List", <List key="l" size={15} />],
              ] as const
            ).map(([value, label, icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={layout === value}
                data-active={layout === value}
                aria-label={label}
                title={label}
                onClick={() => setLayout(value)}
              >
                {icon}
              </button>
            ))}
          </div>
          {/* Page actions share the toolbar row (new notes come from the tab bar). */}
          {view === "folder" && folderId && caps.sharing ? (
            <Button variant="secondary" onClick={() => setSharingFolder(true)}>
              <Share2 size={14} aria-hidden /> Share
            </Button>
          ) : null}
          {view === "trash" && results.length ? (
            <Button variant="quiet" onClick={() => setConfirmEmpty(true)}>
              Empty Trash
            </Button>
          ) : null}
          {view === "templates" && aiOn && online ? (
            <Button variant="secondary" onClick={() => setGenerating(true)}>
              <AiIcon size={14} aria-hidden className="text-[#7c6cf0]" /> Generate with AI
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

        {subfolders.length ? (
          <nav aria-label="Folders inside" className="mb-6 flex flex-wrap gap-2">
            {subfolders.map((f) => (
              <SubfolderChip key={f.id} folder={f} canEdit={canEdit} />
            ))}
          </nav>
        ) : null}

        {view === "templates" && builtIns?.length ? (
          <section aria-labelledby="builtin-title" className="mb-10">
            <h3 id="builtin-title" className="mb-3 text-footnote font-semibold uppercase tracking-[0.06em] text-faint">
              Built-in templates
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {builtIns.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  aria-label={`New page from ${t.name}`}
                  onClick={() => void createDocument({ title: t.name, templateId: t.key })}
                  className="flex items-start gap-3 ui-card rounded-control p-4 text-left transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--shadow-pop)]"
                >
                  <TemplateTile name={t.icon} />
                  <span>
                    <span className="block font-medium">{t.name}</span>
                    <span className="block text-subheadline text-muted">{t.description}</span>
                  </span>
                </button>
              ))}
            </div>
            <h3 className="mb-3 mt-8 text-footnote font-semibold uppercase tracking-[0.06em] text-faint">Your templates</h3>
          </section>
        ) : null}

        {loading ? (
          <div className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-52 animate-pulse ui-card rounded-control motion-reduce:animate-none" />
            ))}
          </div>
        ) : docs.length === 0 ? (
          <EmptyState
            icon={EMPTY[view].icon}
            title={view === "folder" && subfolders.length ? "No notes directly in this folder yet" : EMPTY[view].title}
            body={view === "folder" && subfolders.length ? "The folders above hold the rest." : view === "templates" && builtIns?.length ? "Save any document as a template from its menu, or start from a built-in one above." : EMPTY[view].body}
            action={
              view === "all" || view === "folder" ? (
                // On a folder page the new note starts in that folder.
                <Button variant="primary" onClick={() => void createDocument({})}>
                  <Plus size={14} aria-hidden /> New document
                </Button>
              ) : null
            }
          />
        ) : layout === "list" ? (
          <ul className="divide-y divide-line overflow-hidden ui-card rounded-control">
            {docs.map((d) => {
              const on = selection.selected.has(d.id);
              return (
                <li
                  key={d.id}
                  className={`group flex items-center gap-3 px-4 py-2.5 ${on ? "bg-[var(--glass-active)]" : "hover:bg-surface"} ${dropTarget === d.id ? "shadow-[inset_0_2px_0_var(--color-heading)]" : ""}`}
                  {...cardProps(d)}
                >
                  <DocDragHandle ids={on ? selection.selectedIds : [d.id]} />
                  {on ? (
                    <span className="grid h-4 w-4 flex-none place-items-center rounded-tiny bg-heading text-canvas">
                      <Check size={11} strokeWidth={3} aria-hidden />
                    </span>
                  ) : (
                    <FileText size={16} aria-hidden className="flex-none text-muted" />
                  )}
                  <AppLink href={`/d/${d.id}`} className="min-w-0 flex-1 truncate font-medium outline-none focus-visible:underline">
                    {d.title || "Untitled"}
                    {on ? <span className="sr-only"> (selected)</span> : null}
                  </AppLink>
                  {unsynced.has(d.id) ? <UnsyncedMarker /> : null}
                  {d.kind !== "template" ? <FolderBadge folder={d.homeFolder} /> : null}
                  <span className="hidden text-footnote text-muted sm:block">{d.tags.map((t) => `#${t.name}`).join(" ")}</span>
                  <span className="w-28 text-right text-footnote text-faint">{view === "trash" && d.deletedAt ? `Deleted ${formatRelative(d.deletedAt)}` : ageText(d.updatedAt)}</span>
                  {d.kind === "template" && view !== "trash" ? <UseTemplateButton doc={d} /> : null}
                  <DocMenu {...menuProps(d)} />
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className={`grid gap-x-8 gap-y-10 ${layout === "compact" ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" : "grid-cols-[repeat(auto-fill,minmax(230px,1fr))]"}`}>
            {docs.map((d) => {
              const on = selection.selected.has(d.id);
              return (
                <li
                  key={d.id}
                  className={`group relative [container-type:inline-size] rounded-chip ${dropTarget === d.id || on ? "ring-2 ring-heading ring-offset-4 ring-offset-canvas" : ""}`}
                  {...cardProps(d)}
                >
                  {layout === "compact" ? (
                    <AppLink href={`/d/${d.id}`} className="block h-28 rounded-chip shadow-[var(--shadow-card)] outline-none transition-[transform,box-shadow] duration-200 ease-[var(--ease-folio)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)] focus-visible:ring-2 focus-visible:ring-focus">
                      <DocumentCardPreview
                        title={d.title}
                        style={d.style}
                        footer={
                          <>
                            {unsynced.has(d.id) ? <UnsyncedMarker /> : null}
                            {d.kind !== "template" ? <FolderBadge folder={d.homeFolder} className="ml-auto" /> : null}
                          </>
                        }
                      />
                      {on ? <span className="sr-only">Selected</span> : null}
                    </AppLink>
                  ) : (
                    <AppLink href={`/d/${d.id}`} className={NOTE_CARD_LINK}>
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
                        extra={unsynced.has(d.id) ? <UnsyncedMarker /> : null}
                      />
                      {on ? <span className="sr-only">Selected</span> : null}
                    </AppLink>
                  )}
                  {on ? <SelectedMark /> : null}
                  <div data-card-menu="" className={`absolute top-2 flex items-center gap-1 ${d.starred && layout !== "compact" ? "right-[calc(12cqw+8px)]" : "right-2"} opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100`}>
                    {d.kind === "template" && view !== "trash" ? <UseTemplateButton doc={d} raised /> : null}
                    <div className="ui-raised rounded-chip">
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
      {/* In <body>: the glass panel's backdrop filter would otherwise offset a fixed element inside it. */}
      {selection.marquee
        ? createPortal(
            <div
              aria-hidden
              className="pointer-events-none fixed z-40 rounded-tiny"
              style={{ ...selection.marquee, background: "color-mix(in oklab, var(--color-heading) 7%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--color-heading) 45%, transparent)" }}
            />,
            document.body,
          )
        : null}
      {ctx ? <NoteContextMenu key={ctx.doc.id + ctx.at.x + ctx.at.y} at={ctx.at} onDone={() => setCtx(null)} {...menuProps(ctx.doc)} /> : null}
      {dialogs}
    </ViewChrome>
  );
}

/**
 * A folder inside this one, as a chip: it opens the folder, and notes or folders dropped on it go inside
 * (components/app/FolderDropLayer.tsx reads its data attributes); it can be dragged onto another folder too.
 */
function SubfolderChip({ folder: f, canEdit }: { folder: { id: string; name: string; color: string | null }; canEdit: boolean }) {
  const hint = useDropHint(`chip:${f.id}`);
  return (
    <span className="relative inline-flex" data-drop-folder={f.id} data-drop-name={f.name} data-drop-key={`chip:${f.id}`} data-drop-state={hint ? (hint.refused ? "refused" : "inside") : undefined}>
      <AppLink
        href={`/folders/${f.id}`}
        draggable={canEdit ? true : undefined}
        onDragStart={canEdit ? (e) => startFolderDrag(e, f.id) : undefined}
        onDragEnd={canEdit ? endFolderDrag : undefined}
        className={`inline-flex h-9 max-w-[16rem] items-center gap-2 rounded-chip px-3 text-subheadline ui-card transition-[box-shadow] motion-reduce:transition-none hover:shadow-[var(--shadow-pop)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-11 ${hint && !hint.refused ? "bg-[var(--glass-active)] shadow-[inset_0_0_0_2px_var(--color-heading)]" : ""} ${hint?.refused ? "shadow-[inset_0_0_0_1.5px_var(--color-danger)]" : ""}`}
      >
        <FolderGlyph color={f.color} size={17} />
        <span className="truncate">{f.name}</span>
      </AppLink>
      {hint?.refused ? <DropRefusal text={hint.refused} className="left-0 top-full mt-1" /> : null}
    </span>
  );
}

/** The check on a selected card (the card also gets a ring). */
function SelectedMark() {
  return (
    <span aria-hidden className="pointer-events-none absolute -left-2 -top-2 z-10 grid h-6 w-6 place-items-center rounded-chip bg-heading text-canvas shadow-[0_2px_6px_rgb(0_0_0/0.2)]">
      <Check size={14} strokeWidth={3} />
    </span>
  );
}

function DocDragHandle({ ids }: { ids: string[] }) {
  return (
    <span
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        startNoteDrag(e, ids);
      }}
      aria-hidden
      className="cursor-grab text-faint opacity-0 group-hover:opacity-100"
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
      className={`ui-btn ${raised ? "ui-btn-secondary" : "ui-btn-ghost"} h-8 gap-1 px-2.5 text-footnote`}
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
}

/**
 * A note's actions (shared by its "…" button and its right-click menu), with the dialogs they open.
 * `dialogOpen` tells a context menu to stay mounted while one of its dialogs is showing.
 */
function useDocMenu({ doc, view, arrange, select, recent }: DocMenuProps): { items: (MenuItem | "separator")[]; dialogs: ReactNode; dialogOpen: boolean } {
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
                { label: doc.kind === "template" ? "Edit template" : "Open", icon: <ExternalLink size={14} />, onSelect: () => navigate(`/d/${doc.id}`) },
                ...(phone ? [] : [{ label: "Open in new tab", icon: <ExternalLink size={14} />, onSelect: () => window.open(`/d/${doc.id}`, "_blank", "noopener") }]),
              ]),
          doc.starred
            ? { label: "Unstar", icon: <StarOff size={14} />, onSelect: () => void notes.star(ids, false) }
            : { label: "Star", icon: <Star size={14} />, onSelect: () => void notes.star(ids, true) },
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

  const dialogs = (
    <>
      <MoveToFolderDialog open={moveOpen} onClose={() => setMoveOpen(false)} noteTitle={doc.title} currentFolderId={doc.folderId} onPick={(folder) => void notes.moveTo(ids, folder)} />
      {copyOpen ? <CopyToDialog open onClose={() => setCopyOpen(false)} documentIds={ids} noteTitle={doc.title} /> : null}
      <PermanentDeleteDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} documentId={doc.id} title={doc.title} />
    </>
  );
  return { items, dialogs, dialogOpen: moveOpen || copyOpen || deleteOpen };
}

export function DocMenu(props: DocMenuProps) {
  const { items, dialogs } = useDocMenu(props);
  return (
    <>
      <MenuButton label={`Actions for ${props.doc.title || "Untitled"}`} trigger={<MoreHorizontal size={16} aria-hidden />} items={items} />
      {dialogs}
    </>
  );
}

/** A note's actions at the pointer (right-click on a card or row). Stays mounted while a dialog it opened is showing. */
export function NoteContextMenu({ at, onDone, ...props }: DocMenuProps & { at: { x: number; y: number }; onDone: () => void }) {
  const { items, dialogs, dialogOpen } = useDocMenu(props);
  const [menuOpen, setMenuOpen] = useState(true);
  useEffect(() => {
    if (!menuOpen && !dialogOpen) onDone();
  }, [menuOpen, dialogOpen, onDone]);
  return (
    <>
      {menuOpen ? <ContextMenu at={at} label={`Actions for ${props.doc.title || "Untitled"}`} items={items} onClose={() => setMenuOpen(false)} /> : null}
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
      <input id="confirm-title" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus className="mt-1 h-10 w-full ui-input rounded-chip px-3 text-callout" />
    </Dialog>
  );
}
