"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Copy,
  ExternalLink,
  FolderInput,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  Rows3,
  Star,
  StarOff,
  Trash2,
  Undo2,
} from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { useLocalStorage } from "@/lib/hooks/useEngine";
import { Button } from "@/components/ui/Button";
import { MenuButton } from "@/components/ui/Menu";
import { Dialog } from "@/components/ui/Dialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ViewChrome } from "@/components/app/Shell";
import { SyncStatus } from "@/components/app/SyncStatus";
import { useCreateDocument } from "@/components/app/useCreateDocument";
import { formatRelative } from "@/lib/format";
import { localDb } from "@/lib/sync/db";
import { DocumentCardPreview } from "./DocumentCard";

type View = "all" | "starred" | "archive" | "trash" | "templates" | "unsorted" | "folder" | "tag";
type Layout = "grid" | "compact" | "list";
type Sort = "updated" | "created" | "title" | "manual";

const TITLES: Record<View, string> = {
  all: "Home",
  starred: "Starred",
  archive: "Archive",
  trash: "Trash",
  templates: "Templates",
  unsorted: "Unsorted",
  folder: "Folder",
  tag: "Tag",
};

const EMPTY: Record<View, string> = {
  all: "Nothing here yet. Start a document — it takes one keystroke.",
  starred: "Star a document to keep it one click away.",
  archive: "Archived documents rest here, out of your lists but never lost.",
  trash: "Trash is empty. Deleted documents stay here for 30 days.",
  templates: "Save any document as a template, or start from a built-in one below.",
  unsorted: "Everything has a folder. Nicely done.",
  folder: "This folder is empty. Drag documents here from the list.",
  tag: "No documents carry this tag yet.",
};

type Summary = NonNullable<ReturnType<typeof usePaginatedQuery<typeof api.documents.list>>["results"]>[number];

export function DocumentBrowser({ view, folderId, tagId }: { view: View; folderId?: string; tagId?: string }) {
  const { workspace, profile, online } = useAppState();
  const [layout, setLayout] = useLocalStorage<Layout>(`folevi:layout:${view}`, view === "trash" || view === "archive" ? "list" : "grid");
  const [sort, setSort] = useLocalStorage<Sort>(`folevi:sort:${view}`, "updated");
  const { results, status, loadMore } = usePaginatedQuery(
    api.documents.list,
    { workspaceId: workspace.id, view, folderId, tagId, sort },
    { initialNumItems: 48 },
  );
  const org = useQuery(api.organization.sidebar, { workspaceId: workspace.id });
  const builtIns = useQuery(api.settings.builtInTemplates, view === "templates" ? {} : "skip");
  const createDocument = useCreateDocument();
  const emptyTrash = useMutation(api.documents.emptyTrash);
  const toast = useToast();
  const [cached, setCached] = useState<Summary[] | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const reorder = useMutation(api.documents.reorder);

  // Keep a last-known copy for offline reloads.
  useEffect(() => {
    if (view !== "all" || status === "LoadingFirstPage") return;
    void (async () => {
      const db = await localDb(profile.id);
      const tx = db.transaction("documents", "readwrite");
      for (const d of results) {
        await tx.store.put({ id: d.id, workspaceId: workspace.id, title: d.title, icon: d.icon, kind: d.kind, updatedAt: d.updatedAt, excerpt: d.excerpt, parentDocumentId: d.parentDocumentId, cachedAt: Date.now(), summary: d });
      }
      await tx.done;
    })();
  }, [results, status, view, profile.id, workspace.id]);

  useEffect(() => {
    if (status !== "LoadingFirstPage" || online) return;
    void (async () => {
      const db = await localDb(profile.id);
      const docs = await db.getAllFromIndex("documents", "by_workspace", workspace.id);
      setCached(docs.map((d) => d.summary as Summary).sort((a, b) => b.updatedAt - a.updatedAt));
    })();
  }, [status, online, profile.id, workspace.id]);

  const title =
    view === "folder" ? (org?.folders.find((f) => f.id === folderId)?.name ?? "Folder") : view === "tag" ? `#${org?.tags.find((t) => t.id === tagId)?.name ?? "tag"}` : TITLES[view];
  const docs = status === "LoadingFirstPage" && cached ? cached : results;
  const loading = status === "LoadingFirstPage" && !cached;

  return (
    <ViewChrome
      title={<h1 className="truncate text-sm font-semibold">{title}</h1>}
      tabTitle={title}
      actions={
        <>
          <SyncStatus />
          {view === "trash" && results.length ? (
            <Button size="sm" variant="quiet" onClick={() => setConfirmEmpty(true)}>
              Empty Trash
            </Button>
          ) : null}
          {view !== "trash" && view !== "archive" ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => void createDocument({ folderId: view === "folder" ? folderId : null, kind: view === "templates" ? "template" : "document" })}
            >
              <Plus size={14} aria-hidden /> {view === "templates" ? "New template" : "New"}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="mx-auto max-w-[1180px] px-4 pb-24 pt-6 sm:px-8">
        <div className="mb-5 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="ui-display text-[34px] leading-tight">{title}</h2>
            {!loading ? (
              <p className="text-sm text-muted">
                {docs.length} document{docs.length === 1 ? "" : "s"}
                {status === "CanLoadMore" ? "+" : ""}
                {!online && cached ? " · showing the copy saved on this device" : ""}
                {sort === "manual" && layout !== "list" ? " · drag cards to arrange them" : ""}
              </p>
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-sm text-muted">
            <span>Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-8 ui-input rounded-full px-2 text-ink">
              <option value="updated">Last edited</option>
              <option value="created">Created</option>
              <option value="title">Title</option>
              <option value="manual">Manual order</option>
            </select>
          </label>
          <div role="radiogroup" aria-label="Layout" className="flex ui-well rounded-full p-0.5">
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
                className={`grid h-7 w-9 place-items-center rounded-full transition-[background-color,box-shadow] ${layout === value ? "bg-raised text-heading shadow-[var(--shadow-control)]" : "text-muted hover:text-heading"}`}
              >
                {icon}
              </button>
            ))}
          </div>
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
                  onClick={() => void createDocument({ title: t.name, templateId: t.key })}
                  className="flex items-start gap-3 ui-card rounded-[18px] p-4 text-left transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--shadow-pop)]"
                >
                  <span className="text-2xl" aria-hidden>
                    {t.icon}
                  </span>
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-52 animate-pulse ui-card rounded-[18px] motion-reduce:animate-none" />
            ))}
          </div>
        ) : docs.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-line-strong px-6 py-16 text-center">
            <p className="ui-display text-2xl">{EMPTY[view]}</p>
            {view === "all" || view === "folder" ? (
              <Button className="mt-6" variant="primary" onClick={() => void createDocument({ folderId: view === "folder" ? folderId : null })}>
                <Plus size={14} aria-hidden /> New document
              </Button>
            ) : null}
          </div>
        ) : layout === "list" ? (
          <ul className="divide-y divide-line overflow-hidden ui-card rounded-[18px]">
            {docs.map((d) => (
              <li key={d.id} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-surface">
                <DocDragHandle id={d.id} />
                <span className="w-6 text-center text-lg" aria-hidden>
                  {d.icon ?? "·"}
                </span>
                <AppLink href={`/d/${d.id}`} className="min-w-0 flex-1 truncate font-medium outline-none focus-visible:underline">
                  {d.title || "Untitled"}
                </AppLink>
                <span className="hidden text-xs text-muted sm:block">{d.tags.map((t) => `#${t.name}`).join(" ")}</span>
                <span className="w-28 text-right text-xs text-faint">{view === "trash" && d.deletedAt ? `Deleted ${formatRelative(d.deletedAt)}` : formatRelative(d.updatedAt)}</span>
                <DocMenu doc={d} view={view} folders={org?.folders ?? []} />
              </li>
            ))}
          </ul>
        ) : (
          <ul className={`grid gap-5 ${layout === "compact" ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}`}>
            {docs.map((d) => (
              <li
                key={d.id}
                className={`group relative rounded-[18px] ${dropTarget === d.id ? "ring-2 ring-ember ring-offset-2 ring-offset-canvas" : ""}`}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("application/x-folevi-document", d.id)}
                onDragOver={(e) => {
                  if (sort === "manual" && e.dataTransfer.types.includes("application/x-folevi-document")) {
                    e.preventDefault();
                    setDropTarget(d.id);
                  }
                }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => {
                  setDropTarget(null);
                  const dragged = e.dataTransfer.getData("application/x-folevi-document");
                  if (sort !== "manual" || !dragged || dragged === d.id) return;
                  e.preventDefault();
                  const idx = docs.findIndex((x) => x.id === d.id);
                  reorder({ documentId: dragged, afterDocumentId: docs[idx - 1]?.id === dragged ? d.id : (docs[idx - 1]?.id ?? null), beforeDocumentId: docs[idx - 1]?.id === dragged ? (docs[idx + 1]?.id ?? null) : d.id }).catch((err) =>
                    toast.show(errorMessage(err), { tone: "error" }),
                  );
                }}
              >
                <AppLink href={`/d/${d.id}`} className={`block rounded-[18px] shadow-[var(--shadow-card)] outline-none transition-[transform,box-shadow] duration-200 ease-[var(--ease-folio)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)] focus-visible:ring-2 focus-visible:ring-focus ${layout === "compact" ? "h-28" : "h-64"}`}>
                  <DocumentCardPreview
                    title={d.title}
                    icon={d.icon}
                    excerpt={d.excerpt}
                    cover={d.cover}
                    style={d.style}
                    compact={layout === "compact"}
                    footer={
                      layout === "compact" ? null : (
                        <>
                          {d.starred ? <Star size={11} className="fill-marigold text-marigold" aria-label="Starred" /> : null}
                          <span>{view === "trash" && d.deletedAt ? `Deleted ${formatRelative(d.deletedAt)}` : `Edited ${formatRelative(d.updatedAt)}`}</span>
                          {d.tags.length ? <span className="truncate">· {d.tags.map((t) => `#${t.name}`).join(" ")}</span> : null}
                        </>
                      )
                    }
                  />
                </AppLink>
                <div className="absolute right-2 top-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
                  <div className="ui-raised rounded-full">
                    <DocMenu doc={d} view={view} folders={org?.folders ?? []} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {status === "CanLoadMore" ? (
          <div className="mt-12 text-center">
            <Button onClick={() => loadMore(48)}>Load more</Button>
          </div>
        ) : null}
      </div>
      <Dialog
        open={confirmEmpty}
        onClose={() => setConfirmEmpty(false)}
        title="Empty Trash?"
        description="Documents in Trash will be deleted permanently, including their attachments and version history. This can't be undone."
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmEmpty(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                setConfirmEmpty(false);
                try {
                  const r = await emptyTrash({ workspaceId: workspace.id });
                  toast.show(`${r.scheduled} document${r.scheduled === 1 ? "" : "s"} will be permanently deleted.`);
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

function DocDragHandle({ id }: { id: string }) {
  return (
    <span
      draggable
      onDragStart={(e) => e.dataTransfer.setData("application/x-folevi-document", id)}
      aria-hidden
      className="cursor-grab text-faint opacity-0 group-hover:opacity-100"
    >
      ⋮⋮
    </span>
  );
}

function DocMenu({ doc, view, folders }: { doc: Summary; view: View; folders: { id: string; name: string }[] }) {
  const setStarred = useMutation(api.documents.setStarred);
  const setArchived = useMutation(api.documents.setArchived);
  const trash = useMutation(api.documents.moveToTrash);
  const restore = useMutation(api.documents.restoreFromTrash);
  const duplicate = useMutation(api.documents.duplicate);
  const move = useMutation(api.documents.move);
  const toast = useToast();
  const { navigate } = useAppRouter();
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const act = (p: Promise<unknown>, success?: string, undo?: () => void) =>
    p.then(
      () => success && toast.show(success, undo ? { action: { label: "Undo", onClick: undo } } : undefined),
      (e) => toast.show(errorMessage(e), { tone: "error" }),
    );

  const items =
    view === "trash"
      ? [
          { label: "Restore", icon: <Undo2 size={14} />, onSelect: () => void act(restore({ documentId: doc.id }), "Restored") },
          { label: "Delete permanently…", icon: <Trash2 size={14} />, danger: true, onSelect: () => setDeleteOpen(true) },
        ]
      : [
          { label: "Open", icon: <ExternalLink size={14} />, onSelect: () => navigate(`/d/${doc.id}`) },
          { label: "Open in new tab", icon: <ExternalLink size={14} />, onSelect: () => window.open(`/d/${doc.id}`, "_blank", "noopener") },
          doc.starred
            ? { label: "Unstar", icon: <StarOff size={14} />, onSelect: () => void act(setStarred({ documentId: doc.id, starred: false })) }
            : { label: "Star", icon: <Star size={14} />, onSelect: () => void act(setStarred({ documentId: doc.id, starred: true }), "Starred") },
          { label: "Duplicate", icon: <Copy size={14} />, onSelect: () => void act(duplicate({ documentId: doc.id }), "Duplicated") },
          { label: "Move to folder…", icon: <FolderInput size={14} />, onSelect: () => setMoveOpen(true) },
          doc.archivedAt
            ? { label: "Unarchive", icon: <ArchiveRestore size={14} />, onSelect: () => void act(setArchived({ documentId: doc.id, archived: false }), "Moved out of Archive") }
            : {
                label: "Archive",
                icon: <Archive size={14} />,
                onSelect: () => void act(setArchived({ documentId: doc.id, archived: true }), "Archived", () => void setArchived({ documentId: doc.id, archived: false })),
              },
          "separator" as const,
          {
            label: "Move to Trash",
            icon: <Trash2 size={14} />,
            danger: true,
            onSelect: () => void act(trash({ documentId: doc.id }), "Moved to Trash", () => void restore({ documentId: doc.id })),
          },
        ];

  return (
    <>
      <MenuButton label={`Actions for ${doc.title || "Untitled"}`} trigger={<MoreHorizontal size={16} aria-hidden />} items={items} />
      <Dialog open={moveOpen} onClose={() => setMoveOpen(false)} title="Move to folder" size="sm">
        <ul className="space-y-1">
          <li>
            <button type="button" className="w-full rounded-[10px] px-3 py-2 text-left hover:bg-surface" onClick={() => { setMoveOpen(false); void act(move({ documentId: doc.id, folderId: null }), "Moved to Unsorted"); }}>
              Unsorted (no folder)
            </button>
          </li>
          {folders.map((f) => (
            <li key={f.id}>
              <button type="button" className="w-full rounded-[10px] px-3 py-2 text-left hover:bg-surface" onClick={() => { setMoveOpen(false); void act(move({ documentId: doc.id, folderId: f.id }), `Moved to ${f.name}`); }}>
                {f.name}
              </button>
            </li>
          ))}
        </ul>
      </Dialog>
      <PermanentDeleteDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} documentId={doc.id} title={doc.title} />
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
      <input id="confirm-title" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus className="mt-1 h-10 w-full ui-input rounded-full px-3" />
    </Dialog>
  );
}
