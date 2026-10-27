"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Archive, Calendar, CheckSquare, ChevronDown, ChevronRight, FileDiff, FolderPlus, Hash, Files, Inbox, Layers, LayoutTemplate, MoreHorizontal, Search, Share2, Star, Trash2, House as Home, FileText, Waypoints, Lock } from "lucide-react";
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
import { LockGlyph } from "@/components/e2ee/LockGlyph";
import { SidebarMigrationLine } from "@/components/e2ee/MigrationProgress";
import { NotificationsButton } from "./NotificationsButton";
import { SidebarMenu } from "./SidebarMenu";
import { SyncStatus } from "./SyncStatus";
import { WorkspaceMenu } from "./WorkspaceMenu";
import { openNextInNewTab } from "@/lib/app/tabs";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { useMinute } from "@/lib/hooks/useMinute";
import { startNoteDrag } from "@/lib/app/noteDrag";
import { endFolderDrag, startFolderDrag, useFolderActions, useOpenFolders, useFolderTree } from "@/lib/app/folders";
import { useDragPayload, useDropHint } from "@/lib/app/dragSession";
import { FloatingDropRefusal } from "./FolderDropLayer";
import { flattenFolders, folderAncestors } from "@folevi/editor-schema";
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

function NavItem({
  href,
  icon,
  label,
  count,
  onNavigate,
  dropFolderId,
  dragFolderId,
  dragNoteId,
  locked,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
  onNavigate?: () => void;
  /** Makes the item a drop target for notes (FolderDropLayer): "" is Drafts. (Folder rows are targets as a whole row.) */
  dropFolderId?: string;
  /** The folder this row stands for, dragged by it (to reorder or nest it). */
  dragFolderId?: string;
  /** The note this row stands for (Starred): dragged onto a folder, it moves there. */
  dragNoteId?: string;
  /** Always fully encrypted: a small lock after the name (docs/E2EE_DESIGN.md §10.8). */
  locked?: boolean;
}) {
  const { route } = useAppRouter();
  const active = isActive(route, href);
  const hint = useDropHint(dropFolderId ?? "\u0000");
  const over = hint !== null && !hint.refused;
  return (
    <AppLink
      href={href}
      onClick={() => {
        // A note opened from the sidebar (e.g. Starred) gets its own tab.
        if (href.startsWith("/d/")) openNextInNewTab();
        onNavigate?.();
      }}
      aria-current={active ? "page" : undefined}
      {...(dropFolderId !== undefined ? { "data-drop-folder": dropFolderId, "data-drop-name": label } : {})}
      draggable={dragFolderId || dragNoteId ? true : undefined}
      onDragStart={dragFolderId ? (e) => startFolderDrag(e, dragFolderId) : dragNoteId ? (e) => startNoteDrag(e, [dragNoteId], () => label) : undefined}
      onDragEnd={dragFolderId || dragNoteId ? endFolderDrag : undefined}
      className={`group relative flex h-8 items-center gap-2.5 rounded-chip px-2.5 text-body outline-none transition-[background-color,box-shadow,color] duration-150 motion-reduce:transition-none pointer-coarse:h-11 ${
        active ? "bg-[var(--glass-active)] font-semibold text-heading shadow-[var(--glass-edge),0_1px_3px_rgb(0_0_0/0.06)]" : "text-ink/90 hover:bg-[var(--glass-hover)] hover:text-heading"
      } ${over ? "bg-[var(--glass-active)] text-heading ring-2 ring-heading" : ""} focus-visible:ring-2 focus-visible:ring-focus`}
    >
      <span className={`transition-colors ${active ? "text-heading" : "text-muted group-hover:text-heading"}`} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {locked ? <LockGlyph /> : null}
      {count ? <span className={`min-w-5 rounded-chip px-1.5 text-center text-caption-2 font-semibold leading-5 tabular-nums ${active ? "bg-heading text-canvas" : "bg-[var(--glass-hover)] text-muted"}`}>{count}</span> : null}
    </AppLink>
  );
}

/**
 * A folder's row in the tree as a drop target (FolderDropLayer reads its data attributes): a ring when what's
 * dragged would go inside it, a line above or below it when it would go before or after it, and a dashed ring
 * with the reason when it can't go there.
 */
function FolderRow({ id, name, depth, open, hasChildren, children }: { id: string; name: string; depth: number; open: boolean; hasChildren: boolean; children: React.ReactNode }) {
  const hint = useDropHint(id);
  const zone = hint && !hint.refused ? hint.zone : null;
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  // The line starts where the row's name does, so it reads as "at this level".
  const indent = depth * 14 + 20;
  // Below an open folder the drop lands first inside it, so the line sits a level in.
  const lineIndent = zone === "after" && open && hasChildren ? indent + 14 : indent;
  return (
    <div
      ref={setEl}
      data-ctx-host=""
      data-drop-folder={id}
      data-drop-name={name}
      data-drop-tree=""
      data-drop-open={open && hasChildren ? "1" : undefined}
      data-drop-closed={!open && hasChildren ? "1" : undefined}
      data-drop-state={hint ? (hint.refused ? "refused" : hint.zone) : undefined}
      className={`group/folder relative flex items-center rounded-chip transition-shadow duration-150 motion-reduce:transition-none ${zone === "inside" ? "bg-[var(--glass-active)] shadow-[inset_0_0_0_2px_var(--color-heading)]" : ""} ${hint?.refused ? "shadow-[inset_0_0_0_1.5px_var(--color-danger)] [background-image:repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_oklab,var(--color-danger)_8%,transparent)_6px_8px)]" : ""}`}
      style={depth ? { paddingLeft: depth * 14 } : undefined}
    >
      {children}
      {zone === "before" || zone === "after" ? (
        <span aria-hidden className={`pointer-events-none absolute right-1 z-10 flex h-0.5 items-center rounded-tiny bg-heading ${zone === "before" ? "top-0" : "bottom-0"}`} style={{ left: lineIndent }}>
          <span className="-ml-1 h-2 w-2 flex-none rounded-chip border-2 border-heading bg-canvas" />
        </span>
      ) : null}
      {hint?.refused ? <FloatingDropRefusal text={hint.refused} anchor={el} left={indent} /> : null}
    </div>
  );
}

/** Sidebar lists show a few items; the rest are one click away on the section's own page. */
const SIDEBAR_LIMIT = 5;

function MoreLink({ href, count, noun, onNavigate, exact = true }: { href: string; count: number; noun: string; onNavigate?: () => void; exact?: boolean }) {
  if (count <= 0) return null;
  if (!exact) {
    return (
      <AppLink href={href} onClick={onNavigate} className="flex h-8 items-center rounded-chip px-2.5 pl-8 text-subheadline text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading">
        View all <span className="sr-only">{noun}</span>
      </AppLink>
    );
  }
  return (
    <AppLink href={href} onClick={onNavigate} className="flex h-8 items-center rounded-chip px-2.5 pl-8 text-subheadline text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading">
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
function TopLevelDrop() {
  const hint = useDropHint("@top");
  const over = hint !== null && !hint.refused;
  return (
    <div
      data-drop-folder="@top"
      data-drop-name="the top level"
      className={`ml-5 flex h-8 items-center rounded-chip border border-dashed px-2.5 text-subheadline transition-colors motion-reduce:transition-none pointer-coarse:h-11 ${over ? "border-heading bg-[var(--glass-active)] text-heading" : "border-line-strong text-muted"}`}
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
          <label className="block text-subheadline font-medium" htmlFor={`tag-name-${tag.id}`}>
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
            className="ui-input mt-2 h-10 w-full rounded-chip px-3 text-callout"
          />
          <fieldset className="mt-4">
            <legend className="text-subheadline font-medium">Color</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {TAG_COLORS.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-1.5 rounded-chip px-2 py-1 text-subheadline has-[:checked]:bg-accent-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus">
                  <input type="radio" name={`tag-color-${tag.id}`} value={c.id} checked={color === c.id} onChange={() => setColor(c.id)} className="sr-only" />
                  <span className="inline-block h-3 w-3 rounded-chip" style={{ background: tagColorVar(c.id) }} aria-hidden />
                  {c.label}
                </label>
              ))}
            </div>
          </fieldset>
          {error ? (
            <p role="alert" className="mt-3 text-subheadline text-danger">
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
      className="ui-well flex h-9 w-full items-center gap-2 rounded-control pl-3 pr-1.5 text-left text-subheadline text-muted transition-colors hover:text-ink pointer-coarse:h-11"
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
  // The Vault shows for whoever can see one here (null: none for them; held back while its flag is off).
  const vault = useQuery(api.vault.get, caps.sharing ? { scope } : "skip");
  // Changes apps proposed count too: they wait there for an answer.
  const minute = useMinute();
  const proposed = useQuery(api.proposals.count, caps.changes ? { now: minute } : "skip");
  const toast = useToast();
  const [folderOpen, setFolderOpen] = useOpenFolders();
  // A folder being dragged (a moment after its drag starts: the page mustn't change under a drag as it begins).
  const payload = useDragPayload();
  const [draggedFolder, setDraggedFolder] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDraggedFolder(payload?.kind === "folder" ? payload.id : null), 0);
    return () => clearTimeout(t);
  }, [payload]);
  // "+N more" shows every folder (the list then scrolls on its own when it's long); "Show less" goes back.
  const [allFoldersShown, setAllFoldersShown] = useLocalStorage("folevi:sidebar-folders-all", false);
  const [folderDialog, setFolderDialog] = useState(false);
  const [starredOpen, setStarredOpen] = useLocalStorage("folevi:sidebar-starred-open", true);
  // The AI page, where AI is included and on (never on Core).
  const aiOn = useAiEnabled();
  // Folders and notes marked Always fully encrypted (the lists carry `locked` once the account has encryption).
  const isLockedFolder = (f: object) => (f as { locked?: boolean }).locked === true;

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
  const shownRoots = allFoldersShown ? roots : roots.filter((f, i) => i < SIDEBAR_LIMIT || f.id === activeRootId);
  const shownFolderCount = tree.reduce((n, e, i) => {
    // A folder counts when its top-level folder is shown.
    let root = i;
    while (tree[root]!.depth > 0) root--;
    return shownRoots.includes(tree[root]!.folder) ? n + 1 : n;
  }, 0);
  const isFolderOpen = (id: string) => folderOpen(id) || activePath.some((a) => a.id === id);

  const renderFolder = (f: (typeof folders)[number], depth: number): React.ReactNode => {
    const children = childrenOf(f.id);
    const open = isFolderOpen(f.id);
    return (
      <div key={f.id}>
        <FolderRow id={f.id} name={f.name} depth={depth} open={open} hasChildren={children.length > 0}>
          {children.length ? (
            <button type="button" aria-label={open ? `Collapse ${f.name}` : `Expand ${f.name}`} aria-expanded={open} className="grid h-8 w-5 flex-none place-items-center rounded-chip text-faint hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" onClick={() => setFolderOpen(f.id, !open)}>
              {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
            </button>
          ) : (
            <span className="w-5 flex-none" />
          )}
          <div className="min-w-0 flex-1">
            <NavItem href={`/folders/${f.id}`} icon={<FolderGlyph color={f.color} size={18} />} label={f.name} onNavigate={onNavigate} dragFolderId={canEdit ? f.id : undefined} locked={isLockedFolder(f)} />
          </div>
          <FolderMenu folder={f} className={FOLDER_MENU_REVEAL} />
        </FolderRow>
        {open && children.length ? (
          <div role="group" aria-label={`In ${f.name}`} className="space-y-0.5">
            {children.map((c) => renderFolder(c, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };
  const draggedIsNested = draggedFolder !== null && Boolean(folders.find((f) => f.id === draggedFolder)?.parentFolderId);
  const hiddenFolders = folders.length - shownFolderCount;
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
                <NavItem key={d.id} href={`/d/${d.id}`} icon={<FileText size={15} />} label={d.title || "Untitled"} onNavigate={onNavigate} dragNoteId={canEdit ? d.id : undefined} locked={(d as { locked?: boolean }).locked === true} />
              ))}
              <MoreLink href="/starred" count={starred.page.length - starred.page.filter((d, i) => i < SIDEBAR_LIMIT || (route.name === "doc" && route.id === d.id)).length} noun="starred pages" onNavigate={onNavigate} exact={starred.isDone} />
            </div>
          ) : null}
          <NavItem href="/drafts" icon={<Inbox size={16} />} label="Drafts" count={drafts ?? undefined} onNavigate={onNavigate} dropFolderId="" />
          <NavItem href="/notes" icon={<Files size={16} />} label="All notes" onNavigate={onNavigate} />
          <NavItem href="/tasks/today" icon={<CheckSquare size={16} />} label="Tasks" count={counts ? counts.today : undefined} onNavigate={onNavigate} />
          <NavItem href="/calendar" icon={<Calendar size={16} />} label="Calendar" onNavigate={onNavigate} />
          {reviews?.hasCards || route.name === "review" ? <NavItem href="/review" icon={<Layers size={16} />} label="Reviews" count={reviews ? reviews.due + reviews.new : undefined} onNavigate={onNavigate} /> : null}
          {caps.sharing ? <NavItem href="/shared" icon={<Share2 size={16} />} label="Shared with Me" onNavigate={onNavigate} /> : null}
          {caps.sharing && vault !== null && vault !== undefined ? <NavItem href="/vault" icon={<Lock size={16} />} label="Vault" onNavigate={onNavigate} /> : null}
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
          {roots.length === 0 ? <p className="px-2 py-1 text-footnote text-faint">No folders yet</p> : null}
          {/* Every folder, once "+N more" is pressed: past half the window's height the list scrolls by itself. */}
          <div data-drag-scroll="" aria-label={allFoldersShown ? "All folders" : undefined} role={allFoldersShown ? "group" : undefined} className={`space-y-0.5 ${allFoldersShown ? "-mx-1 max-h-[50dvh] overflow-y-auto overscroll-contain px-1 py-0.5" : ""}`}>
            {shownRoots.map((f) => renderFolder(f, 0))}
          </div>
          {draggedIsNested && canEdit ? <TopLevelDrop /> : null}
          {hiddenFolders > 0 ? (
            <button type="button" data-drop-expand="" onClick={() => setAllFoldersShown(true)} className="flex h-8 w-full items-center rounded-chip px-2.5 pl-8 text-left text-subheadline text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-11">
              +{hiddenFolders.toLocaleString()} more <span className="sr-only">folders</span>
            </button>
          ) : allFoldersShown && roots.length > SIDEBAR_LIMIT ? (
            <button type="button" onClick={() => setAllFoldersShown(false)} className="flex h-8 w-full items-center rounded-chip px-2.5 pl-8 text-left text-subheadline text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-11">
              Show less <span className="sr-only">folders</span>
            </button>
          ) : null}
        </Section>

        <Section title="Tags" href="/tags" onNavigate={onNavigate} defaultOpen={false}>
          {org?.tags.length === 0 ? <p className="px-2 py-1 text-footnote text-faint">Tag documents from the inspector</p> : null}
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
        {/* While a space is being encrypted or decrypted: one line with its progress (§10.10). */}
        <SidebarMigrationLine scope={scope} href={scope.kind === "personal" ? "/settings/privacy" : "/settings/workspace-privacy"} />
        <WorkspaceMenu onNavigate={onNavigate} />
      </div>
    </nav>
  );
}
