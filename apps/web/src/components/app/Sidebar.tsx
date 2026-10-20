"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import {
  Archive,
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  FileDiff,
  FolderPlus,
  Hash,
  Files,
  Inbox,
  Layers,
  LayoutTemplate,
  MoreHorizontal,
  Search,
  Share2,
  Star,
  Trash2,
  House as Home,
  FileText,
  Waypoints,
} from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter, type Route } from "@/lib/app/router";
import { Button, IconButton, Kbd } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { MenuButton } from "@/components/ui/Menu";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import { modKey, useLocalStorage } from "@/lib/hooks/useEngine";
import { useShell } from "./Shell";
import { FolderMenu } from "./FolderMenu";
import { NotificationsButton } from "./NotificationsButton";
import { SidebarMenu } from "./SidebarMenu";
import { SyncStatus } from "./SyncStatus";
import { WorkspaceMenu } from "./WorkspaceMenu";
import { openNextInNewTab } from "@/lib/app/tabs";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { useNoteActions } from "@/components/views/noteActions";
import { useMinute } from "@/lib/hooks/useMinute";
import { draggedNoteIds, isNoteDrag } from "@/lib/app/noteDrag";
import { draggedFolderId, draggingFolderId, endFolderDrag, folderMoveMessage, isFolderDrag, startFolderDrag, useFolderActions, useMoveFolder, useOpenFolders, useFolderTree } from "@/lib/app/folders";
import { flattenFolders, folderAncestors, folderMoveProblem } from "@folevi/editor-schema";
import { AiIcon } from "@/components/ai/AiIcon";
import { useAiEnabled } from "@/components/ai/useAi";
import { useCanCall, useCapabilities } from "@/lib/mode";
import { useReviewWindow } from "@/components/study/review";

function isActive(route: Route, href: string): boolean {
  const map: Record<string, (r: Route) => boolean> = {
    "/documents": (r) => r.name === "documents",
    "/notes": (r) => r.name === "notes",
    "/ai": (r) => r.name === "ai",
    "/graph": (r) => r.name === "graph",
    "/tasks/today": (r) => r.name === "tasks",
    "/calendar": (r) => r.name === "calendar",
    "/review": (r) => r.name === "review",
    "/changes": (r) => r.name === "changes",
    "/shared": (r) => r.name === "shared",
    "/templates": (r) => r.name === "templates",
    "/starred": (r) => r.name === "starred",
    "/archive": (r) => r.name === "archive",
    "/trash": (r) => r.name === "trash",
    "/drafts": (r) => r.name === "unsorted",
    "/settings/account": (r) => r.name === "settings",
    "/help": (r) => r.name === "help",
  };
  if (map[href]) return map[href]!(route);
  if (href === "/folders") return route.name === "folders";
  if (href === "/tags") return route.name === "tags";
  if (href.startsWith("/folders/")) return route.name === "folder" && route.id === href.slice(9);
  if (href.startsWith("/tags/")) return route.name === "tag" && route.id === href.slice(6);
  if (href.startsWith("/d/")) return route.name === "doc" && route.id === href.slice(3);
  return false;
}

/** A folder row's part in dragging folders: it can be dragged, and other folders can be dropped into it. */
interface FolderDrag {
  id: string;
  /** Whether the folder being dragged may go in here (not itself, a subfolder, or too deep). */
  takes: (draggedId: string) => boolean;
  onTake: (draggedId: string) => void;
}

function NavItem({
  href,
  icon,
  label,
  count,
  onNavigate,
  draggableFolderId,
  folder,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
  onNavigate?: () => void;
  /** Makes the item a drop target for notes: a folder id, or "" for Drafts. */ draggableFolderId?: string;
  folder?: FolderDrag;
}) {
  const { route } = useAppRouter();
  const active = isActive(route, href);
  const notes = useNoteActions();
  const [over, setOver] = useState(false);
  const takesFolder = (e: React.DragEvent) => {
    if (!folder || !isFolderDrag(e)) return false;
    const dragged = draggingFolderId();
    return dragged === null || folder.takes(dragged);
  };
  return (
    <AppLink
      href={href}
      onClick={() => {
        // A note opened from the sidebar (e.g. Starred) gets its own tab.
        if (href.startsWith("/d/")) openNextInNewTab();
        onNavigate?.();
      }}
      aria-current={active ? "page" : undefined}
      draggable={folder ? true : undefined}
      onDragStart={folder ? (e) => startFolderDrag(e, folder.id) : undefined}
      onDragEnd={folder ? endFolderDrag : undefined}
      onDragOver={
        draggableFolderId !== undefined || folder
          ? (e) => {
              if ((draggableFolderId !== undefined && isNoteDrag(e)) || takesFolder(e)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOver(true);
              }
            }
          : undefined
      }
      onDragLeave={(e) => {
        // Moving onto the icon or label inside the item isn't leaving it.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={
        draggableFolderId !== undefined || folder
          ? (e) => {
              e.preventDefault();
              setOver(false);
              if (folder && isFolderDrag(e)) {
                // A folder dropped onto another goes inside it.
                const dragged = draggedFolderId(e);
                if (dragged && dragged !== folder.id) folder.onTake(dragged);
                return;
              }
              if (draggableFolderId === undefined) return;
              // One note, or a whole selection; the toast offers Undo.
              const ids = draggedNoteIds(e);
              if (ids.length) void notes.moveTo(ids, { id: draggableFolderId || null, name: label });
            }
          : undefined
      }
      className={`group relative flex h-8 items-center gap-2.5 rounded-chip px-2.5 text-[13.5px] outline-none transition-[background-color,box-shadow,color] duration-150 pointer-coarse:h-11 ${
        active ? "bg-[var(--glass-active)] font-semibold text-heading shadow-[var(--glass-edge),0_1px_3px_rgb(0_0_0/0.06)]" : "text-ink/90 hover:bg-[var(--glass-hover)] hover:text-heading"
      } ${over ? "bg-[var(--glass-active)] text-heading ring-2 ring-heading" : ""} focus-visible:ring-2 focus-visible:ring-focus`}
    >
      <span className={`transition-colors ${active ? "text-heading" : "text-muted group-hover:text-heading"}`} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? <span className={`min-w-5 rounded-chip px-1.5 text-center text-[11px] font-semibold leading-5 tabular-nums ${active ? "bg-heading text-canvas" : "bg-[var(--glass-hover)] text-muted"}`}>{count}</span> : null}
    </AppLink>
  );
}

/** Sidebar lists show a few items; the rest are one click away on the section's own page. */
const SIDEBAR_LIMIT = 5;

function MoreLink({ href, count, noun, onNavigate, exact = true }: { href: string; count: number; noun: string; onNavigate?: () => void; exact?: boolean }) {
  if (count <= 0) return null;
  if (!exact) {
    return (
      <AppLink href={href} onClick={onNavigate} className="flex h-8 items-center rounded-chip px-2.5 pl-8 text-[12.5px] text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading">
        View all <span className="sr-only">{noun}</span>
      </AppLink>
    );
  }
  return (
    <AppLink href={href} onClick={onNavigate} className="flex h-8 items-center rounded-chip px-2.5 pl-8 text-[12.5px] text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading">
      +{count.toLocaleString()} more <span className="sr-only">{noun}</span>
    </AppLink>
  );
}

function Section({ title, href, children, action, defaultOpen = true, onNavigate }: { title: string; href?: string; children: React.ReactNode; action?: React.ReactNode; defaultOpen?: boolean; onNavigate?: () => void }) {
  const { route } = useAppRouter();
  // Follows `defaultOpen` (which may only be known once data loads) until the person toggles it; their
  // choice is remembered on this device (e.g. Tags stays open once opened).
  const [toggled, setToggled] = useLocalStorage<boolean | null>(`folevi:sidebar-section:${title.toLowerCase()}`, null);
  const open = toggled ?? defaultOpen;
  const setOpen = (next: boolean) => setToggled(next);
  return (
    <section className="mt-5">
      {/* The chevron sits centred on the nav icons' column and the title starts where their labels do. */}
      <div className={`flex h-7 items-center gap-1 pr-2.5 ${href ? "pl-1.5" : "pl-2.5"}`}>
        {href ? (
          <span className="flex min-w-0 flex-1 items-center gap-0.5">
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
              className="ui-caps grid h-7 w-6 flex-none place-items-center rounded-chip transition-colors hover:bg-[var(--glass-hover)] hover:text-heading"
            >
              {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
            </button>
            <AppLink
              href={href}
              onClick={onNavigate}
              aria-current={isActive(route, href) ? "page" : undefined}
              className={`ui-caps flex h-7 min-w-0 flex-1 items-center rounded-chip pl-1 pr-2 transition-colors hover:bg-[var(--glass-hover)] hover:text-heading ${isActive(route, href) ? "bg-[var(--glass-hover)] text-heading" : ""}`}
              title={`All ${title.toLowerCase()}`}
            >
              {title}
            </AppLink>
          </span>
        ) : (
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="ui-caps flex flex-1 items-center gap-1 hover:text-muted">
            {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
            {title}
          </button>
        )}
        {action}
      </div>
      {open ? <div className="mt-1 space-y-0.5">{children}</div> : null}
    </section>
  );
}

const FOLDER_MENU_REVEAL = "opacity-0 transition-opacity focus-within:opacity-100 group-hover/folder:opacity-100 pointer-coarse:opacity-100";

/** Where a dragged subfolder goes to become a top-level folder (shown only while one is dragged). */
function TopLevelDrop({ onDrop }: { onDrop: (folderId: string) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        if (!isFolderDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = draggedFolderId(e);
        if (id) onDrop(id);
      }}
      className={`ml-5 flex h-8 items-center rounded-chip border border-dashed px-2.5 text-[12.5px] transition-colors ${over ? "border-heading bg-[var(--glass-active)] text-heading" : "border-line-strong text-muted"}`}
    >
      Move to the top level
    </div>
  );
}

const TAG_COLORS = [
  { id: "accent", label: "Cocoa" },
  { id: "moss", label: "Moss" },
  { id: "marigold", label: "Marigold" },
  { id: "plum", label: "Plum" },
  { id: "coral", label: "Coral" },
  { id: "muted", label: "Gray" },
] as const;

function tagColorVar(color: string) {
  return `var(--color-${color === "muted" ? "ink-muted" : color})`;
}

function TagMenu({ tag }: { tag: { id: string; name: string; color: string } }) {
  const update = useMutation(api.organization.updateTag);
  const del = useMutation(api.organization.deleteTag);
  const toast = useToast();
  const { route, navigate } = useAppRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover/tag:opacity-100 pointer-coarse:opacity-100">
      <MenuButton
        label={`Tag options for ${tag.name}`}
        trigger={<MoreHorizontal size={14} aria-hidden />}
        items={[
          {
            label: "Edit tag…",
            onSelect: () => {
              setName(tag.name);
              setColor(tag.color);
              setError(null);
              setEditing(true);
            },
          },
          ...TAG_COLORS.filter((c) => c.id !== tag.color).map((c) => ({
            label: `Color: ${c.label}`,
            icon: <span className="inline-block h-2.5 w-2.5 rounded-tiny" style={{ background: tagColorVar(c.id) }} />,
            onSelect: () => void update({ tagId: tag.id, color: c.id }).catch((e) => toast.show(errorMessage(e), { tone: "error" })),
          })),
          "separator" as const,
          { label: "Delete tag…", danger: true, onSelect: () => setDeleting(true) },
        ]}
      />
      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit tag" size="sm">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await update({ tagId: tag.id, name, color });
              setEditing(false);
              toast.show("Tag updated", { tone: "success" });
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          <label className="block text-sm font-medium" htmlFor={`tag-name-${tag.id}`}>
            Name
          </label>
          <input
            id={`tag-name-${tag.id}`}
            autoFocus
            value={name}
            maxLength={40}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            className="ui-input mt-2 h-10 w-full rounded-chip px-3 text-sm"
          />
          <fieldset className="mt-4">
            <legend className="text-sm font-medium">Color</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {TAG_COLORS.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-1.5 rounded-chip px-2 py-1 text-sm has-[:checked]:bg-accent-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus">
                  <input type="radio" name={`tag-color-${tag.id}`} value={c.id} checked={color === c.id} onChange={() => setColor(c.id)} className="sr-only" />
                  <span className="inline-block h-3 w-3 rounded-chip" style={{ background: tagColorVar(c.id) }} aria-hidden />
                  {c.label}
                </label>
              ))}
            </div>
          </fieldset>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete #${tag.name}?`}
        description="The tag is removed from every document. The documents themselves are not affected."
        size="sm"
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await del({ tagId: tag.id });
                  setDeleting(false);
                  toast.show(`Deleted #${tag.name}`, { tone: "success" });
                  if (route.name === "tag" && route.id === tag.id) navigate("/documents", { replace: true });
                } catch (e) {
                  toast.show(errorMessage(e), { tone: "error" });
                }
              }}
            >
              Delete tag
            </Button>
          </>
        }
      />
    </div>
  );
}

/**
 * The top of either sidebar (app navigation or a note's tools): the Folevi logo (goes Home), save state,
 * notifications and the sidebar menu. It's the same row in both, so it never jumps when you switch.
 */
/** "Search or jump to…" (⌘K): the same box at the top of the app's sidebar and of a note's own sidebar. */
export function SidebarSearch() {
  const { openPalette } = useShell();
  return (
    <button
      type="button"
      onClick={openPalette}
      className="ui-well flex h-9 w-full items-center gap-2 rounded-control pl-3 pr-1.5 text-left text-[13px] text-muted transition-colors hover:text-ink pointer-coarse:h-11"
    >
      <Search size={14} aria-hidden />
      <span className="flex-1">Search or jump to…</span>
      <Kbd>{modKey()}K</Kbd>
    </button>
  );
}

export function SidebarTopBar({ onNavigate }: { onNavigate?: () => void }) {
  const { drawerMode } = useShell();
  const { route } = useAppRouter();
  return (
    <div className="ui-drag flex h-[52px] flex-none items-center gap-1 px-3">
      {/* In the Mac app, the window's buttons sit here. */}
      {drawerMode ? null : <span aria-hidden className="ui-traffic-space" />}
      <AppLink
        href="/documents"
        onClick={onNavigate}
        aria-label="Folevi"
        title="Go to Home"
        className="ui-browser-only flex min-w-0 flex-1 items-center gap-2 rounded-chip px-1 py-1 text-heading outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <FoleviLogo height={26} title={null} className="flex-none" />
      </AppLink>
      {/* (The Mac app shows its window buttons where the logo is; the space between moves the window.) */}
      <span aria-hidden className="ui-desktop-only flex-1 self-stretch" />
      {drawerMode ? null : <SyncStatus align="start" documentId={route.name === "doc" ? route.id : undefined} />}
      <NotificationsButton />
      {drawerMode ? null : <SidebarMenu />}
    </div>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { scope, canEdit, today } = useAppState();
  const org = useFolderTree(scope);
  const counts = useQuery(api.tasks.counts, { scope, today });
  const drafts = useQuery(api.organization.draftCount, { scope });
  // Reviews (flashcards due today, everywhere): listed once there's something to study.
  const reviews = useQuery(api.study.summary, useReviewWindow(5 * 60_000));
  const starred = useQuery(api.documents.list, { scope, view: "starred", paginationOpts: { numItems: 8, cursor: null } });
  const folderActions = useFolderActions();
  const { route } = useAppRouter();
  // Changes others made in notes you've opened (everywhere), leaving out the note in front of you.
  // (Local mode has no Changes: nobody else edits a library, docs/LOCAL_MODE_PLAN.md §5.2.)
  const caps = useCapabilities();
  // The graph comes to local mode later (lib/local/registry.ts LOCAL_PLANNED).
  const graph = useCanCall(api.aiGraph.graph);
  const changes = useQuery(api.changes.list, !caps.changes ? "skip" : route.name === "doc" ? { exclude: route.id } : {});
  // Changes apps proposed count too: they wait there for an answer.
  const minute = useMinute();
  const proposed = useQuery(api.proposals.count, caps.changes ? { now: minute } : "skip");
  const toast = useToast();
  const [folderOpen, setFolderOpen] = useOpenFolders();
  const moveFolder = useMoveFolder();
  const [folderDragging, setFolderDragging] = useState(false);
  const [folderDialog, setFolderDialog] = useState(false);
  const [starredOpen, setStarredOpen] = useLocalStorage("folevi:sidebar-starred-open", true);
  // The AI page, where AI is included and on (never on Core).
  const aiOn = useAiEnabled();

  const folders = org?.folders ?? [];
  // The folder tree: each folder followed by what's inside it.
  const tree = flattenFolders(folders);
  const roots = tree.filter((e) => e.depth === 0).map((e) => e.folder);
  const childrenOf = (id: string) => {
    const i = tree.findIndex((e) => e.folder.id === id);
    const depth = tree[i]!.depth;
    const out = [];
    for (let j = i + 1; j < tree.length && tree[j]!.depth > depth; j++) if (tree[j]!.depth === depth + 1) out.push(tree[j]!.folder);
    return out;
  };
  // Only the first few top-level folders and tags are listed (plus the one you're in, opened down to it);
  // "+N more" opens the full list.
  const activeFolder = route.name === "folder" ? folders.find((f) => f.id === route.id) : undefined;
  const activePath = activeFolder ? folderAncestors(folders, activeFolder.id) : [];
  const activeRootId = activeFolder ? (activePath[0]?.id ?? activeFolder.id) : null;
  const shownRoots = roots.filter((f, i) => i < SIDEBAR_LIMIT || f.id === activeRootId);
  const shownFolderCount = tree.reduce((n, e, i) => {
    // A folder counts when its top-level folder is shown.
    let root = i;
    while (tree[root]!.depth > 0) root--;
    return shownRoots.includes(tree[root]!.folder) ? n + 1 : n;
  }, 0);
  const isFolderOpen = (id: string) => folderOpen(id) || activePath.some((a) => a.id === id);

  // While a folder is dragged, a drop zone for the top level shows under the tree.
  useEffect(() => {
    const sync = () => setTimeout(() => setFolderDragging(draggingFolderId() !== null), 0);
    window.addEventListener("dragstart", sync);
    window.addEventListener("dragend", sync);
    window.addEventListener("drop", sync);
    return () => {
      window.removeEventListener("dragstart", sync);
      window.removeEventListener("dragend", sync);
      window.removeEventListener("drop", sync);
    };
  }, []);

  /** Moves a folder (with what's inside it) into `parentId`, or to the top level; the toast offers Undo. */
  const moveFolderInto = (folderId: string, parentId: string | null) => {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder || folder.parentFolderId === parentId) return;
    const problem = folderMoveProblem(folders, folderId, parentId);
    if (problem) {
      toast.show(folderMoveMessage(problem), { tone: "error" });
      return;
    }
    const was = folder.parentFolderId;
    const where = parentId ? (folders.find((f) => f.id === parentId)?.name ?? "the folder") : "the top level";
    if (parentId) setFolderOpen(parentId, true);
    moveFolder({ folderId, parentFolderId: parentId }).then(
      () => toast.show(`Moved “${folder.name}” to ${where}`, { action: { label: "Undo", onClick: () => void moveFolder({ folderId, parentFolderId: was }).catch((e) => toast.show(errorMessage(e), { tone: "error" })) } }),
      (e) => toast.show(errorMessage(e), { tone: "error" }),
    );
  };
  const folderDrag = (id: string): FolderDrag | undefined =>
    canEdit ? { id, takes: (dragged) => dragged !== id && !folderMoveProblem(folders, dragged, id), onTake: (dragged) => moveFolderInto(dragged, id) } : undefined;

  const renderFolder = (f: (typeof folders)[number], depth: number): React.ReactNode => {
    const children = childrenOf(f.id);
    const open = isFolderOpen(f.id);
    return (
      <div key={f.id}>
        <div data-ctx-host="" className="group/folder flex items-center" style={depth ? { paddingLeft: depth * 14 } : undefined}>
          {children.length ? (
            <button type="button" aria-label={open ? `Collapse ${f.name}` : `Expand ${f.name}`} aria-expanded={open} className="grid h-8 w-5 flex-none place-items-center rounded-chip text-faint hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" onClick={() => setFolderOpen(f.id, !open)}>
              {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
            </button>
          ) : (
            <span className="w-5 flex-none" />
          )}
          <div className="min-w-0 flex-1">
            <NavItem href={`/folders/${f.id}`} icon={<FolderGlyph color={f.color} size={18} />} label={f.name} onNavigate={onNavigate} draggableFolderId={f.id} folder={folderDrag(f.id)} />
          </div>
          <FolderMenu folder={f} className={FOLDER_MENU_REVEAL} />
        </div>
        {open && children.length ? (
          <div role="group" aria-label={`In ${f.name}`} className="space-y-0.5">
            {children.map((c) => renderFolder(c, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };
  const draggedIsNested = folderDragging && Boolean(folders.find((f) => f.id === draggingFolderId())?.parentFolderId);
  const allTags = org?.tags ?? [];
  const shownTags = allTags.filter((t, i) => i < SIDEBAR_LIMIT || (route.name === "tag" && route.id === t.id));

  return (
    <nav aria-label="Folio" className="flex h-full flex-col">
      <SidebarTopBar onNavigate={onNavigate} />

      <div className="flex-none space-y-2 px-2.5 pt-1">
        <SidebarSearch />
        {/* Ask AI lives in the floating chat button (bottom right) and on the AI page. */}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
        <div className="mt-3 space-y-0.5">
          <NavItem href="/documents" icon={<Home size={16} />} label="Home" onNavigate={onNavigate} />
          {aiOn ? <NavItem href="/ai" icon={<AiIcon size={16} />} label="Work with Foli AI" onNavigate={onNavigate} /> : null}
          {graph ? <NavItem href="/graph" icon={<Waypoints size={16} />} label="Graph" onNavigate={onNavigate} /> : null}
          <div className="group/starred relative">
            <NavItem href="/starred" icon={<Star size={16} />} label="Starred" onNavigate={onNavigate} />
            {starred?.page.length ? (
              <button
                type="button"
                onClick={() => setStarredOpen(!starredOpen)}
                aria-expanded={starredOpen}
                aria-label={starredOpen ? "Collapse Starred" : "Expand Starred"}
                className="absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-chip text-faint transition-colors hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                {starredOpen ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
              </button>
            ) : null}
          </div>
          {starred?.page.length && starredOpen ? (
            <div className="space-y-0.5 pl-5" aria-label="Starred pages" role="group">
              {starred.page.filter((d, i) => i < SIDEBAR_LIMIT || (route.name === "doc" && route.id === d.id)).map((d) => (
                <NavItem key={d.id} href={`/d/${d.id}`} icon={<FileText size={15} />} label={d.title || "Untitled"} onNavigate={onNavigate} />
              ))}
              <MoreLink href="/starred" count={starred.page.length - starred.page.filter((d, i) => i < SIDEBAR_LIMIT || (route.name === "doc" && route.id === d.id)).length} noun="starred pages" onNavigate={onNavigate} exact={starred.isDone} />
            </div>
          ) : null}
          <NavItem href="/drafts" icon={<Inbox size={16} />} label="Drafts" count={drafts ?? undefined} onNavigate={onNavigate} draggableFolderId="" />
          <NavItem href="/notes" icon={<Files size={16} />} label="All notes" onNavigate={onNavigate} />
          <NavItem href="/tasks/today" icon={<CheckSquare size={16} />} label="Tasks" count={counts ? counts.today : undefined} onNavigate={onNavigate} />
          <NavItem href="/calendar" icon={<Calendar size={16} />} label="Calendar" onNavigate={onNavigate} />
          {reviews?.hasCards || route.name === "review" ? <NavItem href="/review" icon={<Layers size={16} />} label="Reviews" count={reviews ? reviews.due + reviews.new : undefined} onNavigate={onNavigate} /> : null}
          {caps.sharing ? <NavItem href="/shared" icon={<Share2 size={16} />} label="Shared with Me" onNavigate={onNavigate} /> : null}
          {caps.changes ? <NavItem href="/changes" icon={<FileDiff size={16} />} label="Changes" count={(changes?.notes.length ?? 0) + (proposed ?? 0) || undefined} onNavigate={onNavigate} /> : null}
          <NavItem href="/templates" icon={<LayoutTemplate size={16} />} label="Templates" onNavigate={onNavigate} />
        </div>

        <Section
          title="Folders"
          href="/folders"
          onNavigate={onNavigate}
          action={
            <IconButton label="New folder" onClick={() => setFolderDialog(true)}>
              <FolderPlus size={14} aria-hidden />
            </IconButton>
          }
        >
          {roots.length === 0 ? <p className="px-2 py-1 text-xs text-faint">No folders yet</p> : null}
          {shownRoots.map((f) => renderFolder(f, 0))}
          {draggedIsNested && canEdit ? <TopLevelDrop onDrop={(id) => moveFolderInto(id, null)} /> : null}
          <MoreLink href="/folders" count={folders.length - shownFolderCount} noun="folders" onNavigate={onNavigate} />
        </Section>

        <Section title="Tags" href="/tags" onNavigate={onNavigate} defaultOpen={false}>
          {org?.tags.length === 0 ? <p className="px-2 py-1 text-xs text-faint">Tag documents from the inspector</p> : null}
          {shownTags.map((t) => (
            <div key={t.id} data-ctx-host="" className="group/tag flex items-center">
              <div className="min-w-0 flex-1">
                <NavItem href={`/tags/${t.id}`} icon={<Hash size={15} style={{ color: tagColorVar(t.color) }} />} label={t.name} onNavigate={onNavigate} />
              </div>
              {canEdit ? <TagMenu key={`${t.id}:${t.name}:${t.color}`} tag={t} /> : null}
            </div>
          ))}
          <MoreLink href="/tags" count={(org?.tags.length ?? 0) - shownTags.length} noun="tags" onNavigate={onNavigate} />
        </Section>

        <div className="mt-5 space-y-0.5">
          <NavItem href="/archive" icon={<Archive size={16} />} label="Archive" onNavigate={onNavigate} />
          <NavItem href="/trash" icon={<Trash2 size={16} />} label="Trash" onNavigate={onNavigate} />
        </div>
      </div>

      <PromptDialog
        open={folderDialog}
        title="New folder"
        label="Folder name"
        confirmLabel="Create folder"
        onClose={() => setFolderDialog(false)}
        onSubmit={async (name) => {
          try {
            folderActions.create(name);
          } catch (e) {
            toast.show(errorMessage(e), { tone: "error" });
          }
        }}
      />
      <div className="flex-none px-2.5 pb-2">
        <WorkspaceMenu onNavigate={onNavigate} />
      </div>
    </nav>
  );
}
