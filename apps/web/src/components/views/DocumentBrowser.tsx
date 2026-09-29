"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Check, CheckSquare, Copy, EyeOff, FilePlus2, ExternalLink, FolderInput, LayoutGrid, List, MoreHorizontal, Plus, Rows3, Star, StarOff, Trash2, Undo2, FileText } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { startNoteDrag, NOTE_MIME } from "@/lib/app/noteDrag";
import { Button } from "@/components/ui/Button";
import { ContextMenu, MenuButton, type MenuItem } from "@/components/ui/Menu";
import { Dialog } from "@/components/ui/Dialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ViewChrome } from "@/components/app/Shell";
import { useCreateDocument } from "@/components/app/useCreateDocument";
import { ageText, formatRelative } from "@/lib/format";
import { t } from "@/i18n";
import { localDb } from "@/lib/sync/db";
import { TemplateTile } from "@/components/ui/TemplateIcon";
import { DocumentCardPreview, NOTE_CARD_LINK, NoteCardFace } from "./DocumentCard";
import { FolderBadge } from "./FolderBadge";
import { usePendingDocs } from "@/lib/hooks/usePendingDocs";
import { Select } from "@/components/ui/Select";
import { MoveToFolderDialog } from "./MoveToFolderDialog";
import { SelectionBar, type SelectionAction } from "./SelectionBar";
import { useCardSelection } from "./useCardSelection";
import { useNoteActions } from "./noteActions";

/** Marks a page with edits on this device the server hasn't confirmed yet. */
function UnsyncedMarker({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium text-heading ${className}`} title="Changes on this device haven’t synced yet">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-heading" aria-hidden />
      <span>Not synced</span>
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

const EMPTY: Record<View, string> = {
  all: "Nothing here yet. Starting a document takes one keystroke.",
  starred: "Star a document to keep it one click away.",
  archive: "Archived documents rest here, out of your lists but never lost.",
  trash: "Trash is empty. Deleted documents stay here for 30 days.",
  templates: "Save any document as a template, or start from a built-in one below.",
  unsorted: "Everything has a folder. Nicely done.",
  folder: "This folder is empty. Drag documents here from the list.",
  tag: "No documents carry this tag yet.",
};

export type Summary = NonNullable<ReturnType<typeof usePaginatedQuery<typeof api.documents.list>>["results"]>[number];

export function DocumentBrowser({ view, folderId, tagId, title }: { view: View; folderId?: string; tagId?: string; title?: string }) {
  const { scope } = useAppState();
  const org = useQuery(api.organization.sidebar, { scope });
  // A folder/tag link that doesn't resolve in the current context (deleted, mistyped, or from Personal while a
  // workspace is open, or the other way round) gets a real not-found page instead of a failing list query.
  const missing =
    org !== undefined &&
    ((view === "folder" && !org.folders.some((f) => f.id === folderId)) || (view === "tag" && !org.tags.some((t) => t.id === tagId)));
  if (missing) return <MissingContainer kind={view === "folder" ? "folder" : "tag"} />;
  return <DocumentList view={view} folderId={folderId} tagId={tagId} org={org} titleOverride={title} />;
}

function MissingContainer({ kind }: { kind: "folder" | "tag" }) {
  const { workspace, workspaces } = useAppState();
  const here = workspace ? workspace.name : "Personal";
  const title = kind === "folder" ? "Folder not found" : "Tag not found";
  return (
    <ViewChrome title={<h1 className="truncate text-sm font-semibold">{title}</h1>} tabTitle={title}>
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h2 className="ui-display text-4xl">{kind === "folder" ? "This folder isn’t here" : "This tag isn’t here"}</h2>
        <p className="mt-3 text-muted">
          It may have been deleted{workspaces.length ? `, or it belongs somewhere other than ${here}` : ""}. Links to {kind === "folder" ? "folders" : "tags"} only work in their own Personal or workspace. Switch there from the menu at the bottom of the sidebar.
        </p>
        <AppLink href="/documents" className="ui-btn ui-btn-primary mt-6 h-9 px-4 text-sm">
          Go to Home
        </AppLink>
      </div>
    </ViewChrome>
  );
}

type Org = ReturnType<typeof useQuery<typeof api.organization.sidebar>>;

/** Where the pointer (or, from the keyboard, the element) is, for a context menu. */
export function contextPoint(e: React.MouseEvent): { x: number; y: number } {
  if (e.clientX || e.clientY) return { x: e.clientX, y: e.clientY };
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return { x: r.left + 16, y: r.top + 16 };
}

function DocumentList({ view, folderId, tagId, org, titleOverride }: { view: View; folderId?: string; tagId?: string; org: Org; titleOverride?: string }) {
  const { scope, scopeKey, profile, online } = useAppState();
  const [layout, setLayout] = useLocalStorage<Layout>(`folevi:layout:${view}`, view === "trash" || view === "archive" ? "list" : "grid");
  const [sort, setSort] = useLocalStorage<Sort>(`folevi:sort:${view}`, "updated");
  const { results, status, loadMore } = usePaginatedQuery(
    api.documents.list,
    { scope, view, folderId, tagId, sort },
    { initialNumItems: 48 },
  );
  const builtIns = useQuery(api.settings.builtInTemplates, view === "templates" ? {} : "skip");
  const createDocument = useCreateDocument();
  const emptyTrash = useMutation(api.documents.emptyTrash);
  const toast = useToast();
  const notes = useNoteActions();
  const [cached, setCached] = useState<Summary[] | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const trashSummary = useQuery(api.documents.trashSummary, confirmEmpty ? { scope } : "skip");
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ doc: Summary; at: { x: number; y: number } } | null>(null);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const reorder = useMutation(api.documents.reorder);

  // Keep a last-known copy for offline reloads.
  useEffect(() => {
    if (view !== "all" || status === "LoadingFirstPage") return;
    void (async () => {
      const db = await localDb(profile.id);
      const tx = db.transaction("documents", "readwrite");
      for (const d of results) {
        await tx.store.put({ id: d.id, scopeKey, title: d.title, icon: d.icon, kind: d.kind, updatedAt: d.updatedAt, excerpt: d.excerpt, parentDocumentId: d.parentDocumentId, cachedAt: Date.now(), summary: d });
      }
      await tx.done;
    })();
  }, [results, status, view, profile.id, scopeKey]);

  useEffect(() => {
    if (status !== "LoadingFirstPage" || online) return;
    void (async () => {
      const db = await localDb(profile.id);
      const docs = await db.getAllFromIndex("documents", "by_scope", scopeKey);
      setCached(docs.map((d) => d.summary as Summary).sort((a, b) => b.updatedAt - a.updatedAt));
    })();
  }, [status, online, profile.id, scopeKey]);

  const title =
    titleOverride ?? (view === "folder" ? (org?.folders.find((f) => f.id === folderId)?.name ?? "Folder") : view === "tag" ? `#${org?.tags.find((t) => t.id === tagId)?.name ?? "tag"}` : TITLES[view]);
  const docs = status === "LoadingFirstPage" && cached ? cached : results;
  const loading = status === "LoadingFirstPage" && !cached;
  const canArrange = sort === "manual" && view !== "trash";
  const pendingDocs = usePendingDocs();
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
    onDragStart: (e: React.DragEvent) => startNoteDrag(e, selection.selected.has(d.id) ? selection.selectedIds : [d.id]),
    ...dropProps(d),
  });
  const menuProps = (d: Summary) => ({
    doc: d,
    view,
    arrange: canArrange ? { up: () => nudge(d.id, -1), down: () => nudge(d.id, 1) } : undefined,
    select: selectable ? { selected: selection.selected.has(d.id), toggle: () => selection.toggle(d.id) } : undefined,
  });

  const summaryText = trashSummary
    ? `${trashSummary.deletable.toLocaleString()}${trashSummary.more ? "+" : ""} ${trashSummary.deletable === 1 ? "note" : "notes"} will be permanently deleted, including attachments and version history. This can’t be undone.${
        trashSummary.deletable < trashSummary.total ? ` ${(trashSummary.total - trashSummary.deletable).toLocaleString()} you don’t have permission to delete will stay in Trash.` : ""
      }`
    : "Counting the notes in Trash…";

  return (
    <ViewChrome
      title={<h1 className="truncate text-sm font-semibold">{title}</h1>}
      tabTitle={title}
      overlay={
        selection.selectedIds.length ? (
          <SelectionBar count={selection.selectedIds.length} total={docs.length} actions={bulkActions} onSelectAll={selection.selectAll} onClear={selection.clear} />
        ) : null
      }
    >
      {/* The surface fills the scrolling area so a selection rectangle can start anywhere around the cards. */}
      <div className="min-h-full" onPointerDown={selection.onSurfacePointerDown}>
      <div className="mx-auto max-w-[1180px] px-4 pb-24 pt-3 sm:px-8">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <p role="status" className="mr-auto min-w-0 truncate text-[13px] text-muted">
            {loading
          ? undefined
          : `${docs.length}${status === "CanLoadMore" ? "+" : ""} ${view === "templates" ? (docs.length === 1 ? "template" : "templates") : docs.length === 1 ? "note" : "notes"}${!online && cached ? " · saved on this device" : ""}${canArrange ? " · drag to arrange" : ""}`}
          </p>
          <label className="flex items-center gap-2 text-sm text-muted">
            <span>Sort</span>
            <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-8 ui-input rounded-[6px] px-3 text-ink">
              <option value="updated">Last edited</option>
              <option value="created">Created</option>
              <option value="title">Title</option>
              <option value="manual">Manual order</option>
            </Select>
          </label>
          <div role="radiogroup" aria-label="Layout" className="flex ui-well rounded-[6px] p-0.5">
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
                aria-label={label}
                title={label}
                onClick={() => setLayout(value)}
                className={`grid h-7 w-9 place-items-center rounded-[6px] transition-[background-color,box-shadow] ${layout === value ? "bg-raised text-heading shadow-[var(--shadow-control)]" : "text-muted hover:text-heading"}`}
              >
                {icon}
              </button>
            ))}
          </div>
          {/* Page actions share the toolbar row (new notes come from the tab bar). */}
          {view === "trash" && results.length ? (
            <Button size="sm" variant="quiet" onClick={() => setConfirmEmpty(true)}>
              Empty Trash
            </Button>
          ) : null}
          {view === "templates" ? (
            <Button size="sm" variant="primary" onClick={() => void createDocument({ folderId: null, kind: "template" })}>
              <Plus size={14} aria-hidden /> New template
            </Button>
          ) : null}
        </div>

        {view === "templates" && builtIns?.length ? (
          <section aria-labelledby="builtin-title" className="mb-10">
            <h3 id="builtin-title" className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-faint">
              Built-in templates
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {builtIns.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  aria-label={`New page from ${t.name}`}
                  onClick={() => void createDocument({ title: t.name, templateId: t.key })}
                  className="flex items-start gap-3 ui-card rounded-[8px] p-4 text-left transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--shadow-pop)]"
                >
                  <TemplateTile name={t.icon} />
                  <span>
                    <span className="block font-medium">{t.name}</span>
                    <span className="block text-sm text-muted">{t.description}</span>
                  </span>
                </button>
              ))}
            </div>
            <h3 className="mb-3 mt-8 text-[12px] font-semibold uppercase tracking-[0.06em] text-faint">Your templates</h3>
          </section>
        ) : null}

        {loading ? (
          <div className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-52 animate-pulse ui-card rounded-[8px] motion-reduce:animate-none" />
            ))}
          </div>
        ) : docs.length === 0 ? (
          <div className="rounded-[6px] border border-dashed border-line-strong px-6 py-16 text-center">
            <p className="ui-display text-2xl">{EMPTY[view]}</p>
            {view === "all" || view === "folder" ? (
              // On a folder page the new note starts in that folder.
              <Button className="mt-6" variant="primary" onClick={() => void createDocument({})}>
                <Plus size={14} aria-hidden /> New document
              </Button>
            ) : null}
          </div>
        ) : layout === "list" ? (
          <ul className="divide-y divide-line overflow-hidden ui-card rounded-[8px]">
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
                    <span className="grid h-4 w-4 flex-none place-items-center rounded-[4px] bg-heading text-canvas">
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
                  <span className="hidden text-xs text-muted sm:block">{d.tags.map((t) => `#${t.name}`).join(" ")}</span>
                  <span className="w-28 text-right text-xs text-faint">{view === "trash" && d.deletedAt ? `Deleted ${formatRelative(d.deletedAt)}` : formatRelative(d.updatedAt)}</span>
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
                  className={`group relative [container-type:inline-size] rounded-[6px] ${dropTarget === d.id || on ? "ring-2 ring-heading ring-offset-4 ring-offset-canvas" : ""}`}
                  {...cardProps(d)}
                >
                  {layout === "compact" ? (
                    <AppLink href={`/d/${d.id}`} className="block h-28 rounded-[6px] shadow-[var(--shadow-card)] outline-none transition-[transform,box-shadow] duration-200 ease-[var(--ease-folio)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)] focus-visible:ring-2 focus-visible:ring-focus">
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
                        time={view === "trash" && d.deletedAt ? `Deleted ${ageText(d.deletedAt).toLowerCase()}` : ageText(d.updatedAt)}
                        starred={d.starred}
                        folder={d.homeFolder}
                        showFolder={d.kind !== "template"}
                        extra={unsynced.has(d.id) ? <UnsyncedMarker /> : null}
                      />
                      {on ? <span className="sr-only">Selected</span> : null}
                    </AppLink>
                  )}
                  {on ? <SelectedMark /> : null}
                  <div className={`absolute top-2 flex items-center gap-1 ${d.starred && layout !== "compact" ? "right-[calc(12cqw+8px)]" : "right-2"} opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100`}>
                    {d.kind === "template" && view !== "trash" ? <UseTemplateButton doc={d} raised /> : null}
                    <div className="ui-raised rounded-[6px]">
                      <DocMenu {...menuProps(d)} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {status === "CanLoadMore" ? (
          <div className="mt-12 text-center">
            <Button onClick={() => loadMore(48)}>Load more</Button>
          </div>
        ) : null}
      </div>
      </div>
      {/* In <body>: the glass panel's backdrop filter would otherwise offset a fixed element inside it. */}
      {selection.marquee
        ? createPortal(
            <div
              aria-hidden
              className="pointer-events-none fixed z-40 rounded-[4px]"
              style={{ ...selection.marquee, background: "color-mix(in oklab, var(--color-heading) 7%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--color-heading) 45%, transparent)" }}
            />,
            document.body,
          )
        : null}
      {ctx ? <NoteContextMenu key={ctx.doc.id + ctx.at.x + ctx.at.y} at={ctx.at} onDone={() => setCtx(null)} {...menuProps(ctx.doc)} /> : null}
      <MoveToFolderDialog
        open={bulkMoveOpen}
        onClose={() => setBulkMoveOpen(false)}
        count={selectedDocs.length}
        noteTitle={selectedDocs[0]?.title}
        currentFolderId={sharedFolder}
        onPick={(folder) => bulk((ids) => notes.moveTo(ids, folder))}
      />
      <Dialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        title={`Delete ${selectedDocs.length === 1 ? "1 note" : `${selectedDocs.length} notes`} permanently?`}
        description="They’ll be deleted for everyone, with their nested pages, attachments and version history. This can’t be undone. Notes you don’t have permission to delete stay in Trash."
        size="sm"
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
        open={confirmEmpty}
        onClose={() => setConfirmEmpty(false)}
        title="Empty Trash?"
        description={summaryText}
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmEmpty(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={!trashSummary || trashSummary.deletable === 0}
              onClick={async () => {
                const count = trashSummary?.deletable ?? 0;
                setConfirmEmpty(false);
                selection.clear();
                try {
                  const r = await emptyTrash({ scope });
                  toast.show(t("documents.trash.scheduled", { count: Math.max(count, r.scheduled) }));
                } catch (e) {
                  toast.show(errorMessage(e), { tone: "error" });
                }
              }}
            >
              Delete permanently
            </Button>
          </>
        }
      />
    </ViewChrome>
  );
}

/** The check on a selected card (the card also gets a ring). */
function SelectedMark() {
  return (
    <span aria-hidden className="pointer-events-none absolute -left-2 -top-2 z-10 grid h-6 w-6 place-items-center rounded-full bg-heading text-canvas shadow-[0_2px_6px_rgb(0_0_0/0.2)]">
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
      className={`ui-btn ${raised ? "ui-btn-secondary" : "ui-btn-ghost"} h-7 gap-1 px-2.5 text-xs`}
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
  const [deleteOpen, setDeleteOpen] = useState(false);
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
          { label: doc.kind === "template" ? "Edit template" : "Open", icon: <ExternalLink size={14} />, onSelect: () => navigate(`/d/${doc.id}`) },
          { label: "Open in new tab", icon: <ExternalLink size={14} />, onSelect: () => window.open(`/d/${doc.id}`, "_blank", "noopener") },
          doc.starred
            ? { label: "Unstar", icon: <StarOff size={14} />, onSelect: () => void notes.star(ids, false) }
            : { label: "Star", icon: <Star size={14} />, onSelect: () => void notes.star(ids, true) },
          { label: "Duplicate", icon: <Copy size={14} />, onSelect: () => void duplicate({ documentId: doc.id }).then(() => toast.show("Duplicated"), (e) => toast.show(errorMessage(e), { tone: "error" })) },
          ...(doc.kind !== "template" ? [{ label: "Move to folder…", icon: <FolderInput size={14} />, onSelect: () => setMoveOpen(true) }] : []),
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
      <PermanentDeleteDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} documentId={doc.id} title={doc.title} />
    </>
  );
  return { items, dialogs, dialogOpen: moveOpen || deleteOpen };
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
      <label className="block text-sm" htmlFor="confirm-title">
        Document title
      </label>
      <input id="confirm-title" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus className="mt-1 h-10 w-full ui-input rounded-[6px] px-3" />
    </Dialog>
  );
}
