"use client";

import { useNavRoute, useNoteColumnsActive } from "@/lib/app/useNoteColumns";
import { useCreateDocument } from "./useCreateDocument";
import { useKeyLabels } from "@/lib/shortcuts";
import { SquarePen } from "lucide-react";
import { useMutation } from "convex/react";
import { Fragment, useEffect, useId, useMemo, useState } from "react";
import { ArrowDownUp, Archive, CalendarDays, SquareCheckBig, ChevronDown, ChevronRight, FileDiff, FolderPlus, Hash, Files, Inbox, Layers, LayoutTemplate, MoreHorizontal, Search, Share2, SlidersHorizontal, Trash2, House as Home, FileText, Waypoints, Lock } from "lucide-react";
import { Bookmark } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter, type Route } from "@/lib/app/router";
import { Button, IconButton, Kbd } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ContextMenu, MenuButton, type MenuItem } from "@/components/ui/Menu";
import { floatMenuItems } from "./floatMenu";
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
import { openNextFresh, openNextInNewTab, useFolderTabClicks } from "@/lib/app/tabs";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { useMinute } from "@/lib/hooks/useMinute";
import { startNoteDrag } from "@/lib/app/noteDrag";
import { endFolderDrag, startFolderDrag, useFolderActions, useOpenFolders, useFolderTree, useSidebarOrder } from "@/lib/app/folders";
import { useDragPayload, useDropHint } from "@/lib/app/dragSession";
import { FloatingDropRefusal } from "./FolderDropLayer";
import { flattenFolders, folderAncestors } from "@folevi/editor-schema";
import { useOfflineQuery } from "@/lib/sync/queryCache";
import { applySidebarOrder, planSidebarDrop, setSidebarTreeDrops, SIDEBAR_FOLDER_SORTS, sortSidebarFolders, type SidebarFolderSort } from "@/lib/app/sidebarFolderSort";
import { folderPlace } from "@/lib/app/folderDrop";
import { AiIcon } from "@/components/ai/AiIcon";
import { useAiEnabled } from "@/components/ai/useAi";
import { useBackendMode, useCanCall, useCapabilities } from "@/lib/mode";
import { useReviewWindow } from "@/components/study/review";
import { LOCKED_SIDEBAR_ITEMS, moveSidebarItem, type SidebarItemId } from "@/lib/app/sidebarLayout";
import { useSidebarLayout } from "@/lib/app/useSidebarLayout";
import { SidebarCustomize } from "./SidebarCustomize";

/**
 * The last answer of a query whose arguments move with the clock or the page (a minute, a review window, the note in
 * front), held per query name while the new arguments' answer loads, so a count doesn't blink out and back.
 */
const held = new Map<string, unknown>();
function useHeld<T>(key: string, value: T | undefined): T | undefined {
  if (value !== undefined) {
    held.set(key, value);
    return value;
  }
  return held.get(key) as T | undefined;
}

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
    "/vault": (r) => r.name === "vault",
  };
  if (map[href]) return map[href]!(route);
  if (href === "/folders") return route.name === "folders";
  if (href === "/tags") return route.name === "tags";
  if (href.startsWith("/folders/")) return route.name === "folder" && route.id === href.slice(9);
  if (href.startsWith("/tags/")) return route.name === "tag" && route.id === href.slice(6);
  if (href.startsWith("/d/")) return route.name === "doc" && route.id === href.slice(3);
  return false;
}

/** The keyboard's right-click: the Menu key or Shift+F10. */
function isMenuKey(e: React.KeyboardEvent): boolean {
  return e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");
}

/** Where a right-click menu opens: at the pointer, or under the row when the keyboard asked (Shift+F10). */
function menuPoint(e: React.MouseEvent | React.KeyboardEvent): { x: number; y: number } {
  if ("key" in e) {
    const box = (e.currentTarget as Element).getBoundingClientRect();
    return { x: box.left + 16, y: box.bottom };
  }
  if (e.clientX || e.clientY) return { x: e.clientX, y: e.clientY };
  const box = (e.currentTarget as Element).getBoundingClientRect();
  return { x: box.left + 16, y: box.bottom };
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
  noteId,
  locked,
  tabFolder,
  menu,
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
  /** The note this row stands for (Bookmarks): dragged onto a folder, it moves there. */
  dragNoteId?: string;
  /** The note this row opens (Bookmarks): its right-click offers Float this note. */
  noteId?: string;
  /** Always fully encrypted: a small lock after the name (docs/E2EE_DESIGN.md §10.8). */
  locked?: boolean;
  /** The folder this row opens: ⌘-click or middle-click opens it in a tab behind (useFolderTabClicks). */
  tabFolder?: { id: string; name: string };
  /** The row's right-click menu (the app's own items: Move to More, Customize sidebar). */
  menu?: MenuItem[];
}) {
  const route = useNavRoute();
  const tabClicks = useFolderTabClicks(tabFolder ?? { id: "", name: "" });
  const active = isActive(route, href);
  const hint = useDropHint(dropFolderId ?? "\u0000");
  const over = hint !== null && !hint.refused;
  // A bookmarked note's right-click: Float this note (lib/app/float.ts), where a note can float.
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  return (
    <>
    <AppLink
      onContextMenu={
        noteId || menu
          ? (e: React.MouseEvent) => {
              const items = noteId ? floatMenuItems({ id: noteId, title: label }) : menu!;
              if (!items.length) return;
              e.preventDefault();
              e.stopPropagation();
              setMenuAt({ ...menuPoint(e), items });
            }
          : undefined
      }
      href={href}
      onKeyDown={
        menu && !noteId
          ? (e: React.KeyboardEvent) => {
              if (!isMenuKey(e)) return;
              e.preventDefault();
              setMenuAt({ ...menuPoint(e), items: menu });
            }
          : undefined
      }
      onClick={(e) => {
        if (tabFolder) {
          tabClicks.onClick(e);
          if (e.defaultPrevented) return;
        }
        // A note opened from the sidebar (e.g. Bookmarks) gets its own tab.
        if (href.startsWith("/d/")) openNextInNewTab();
        onNavigate?.();
      }}
      onAuxClick={tabFolder ? tabClicks.onAuxClick : undefined}
      aria-current={active ? "page" : undefined}
      {...(dropFolderId !== undefined ? { "data-drop-folder": dropFolderId, "data-drop-name": label } : {})}
      draggable={dragFolderId || dragNoteId ? true : undefined}
      onDragStart={dragFolderId ? (e) => startFolderDrag(e, dragFolderId) : dragNoteId ? (e) => startNoteDrag(e, [dragNoteId], () => label) : undefined}
      onDragEnd={dragFolderId || dragNoteId ? endFolderDrag : undefined}
      className={`group relative flex h-8 items-center gap-2.5 rounded-chip px-2.5 text-body outline-none transition-[background-color,box-shadow,color] duration-150 motion-reduce:transition-none pointer-coarse:h-11 ${
        active ? "bg-[var(--glass-active)] font-semibold text-heading shadow-[var(--glass-edge),var(--shadow-raised)]" : "text-ink/90 hover:bg-[var(--glass-hover)] hover:text-heading"
      } ${over ? "bg-[var(--glass-active)] text-heading ring-2 ring-heading" : ""} focus-visible:ring-2 focus-visible:ring-focus`}
    >
      <span className={`transition-colors ${active ? "text-heading" : "text-muted group-hover:text-heading"}`} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {locked ? <LockGlyph /> : null}
      {count ? <span className={`min-w-5 rounded-chip px-1.5 text-center text-caption-2 font-semibold leading-5 tabular-nums ${active ? "bg-heading text-canvas" : "bg-[var(--glass-hover)] text-muted"}`}>{count}</span> : null}
    </AppLink>
    {menuAt ? <ContextMenu at={menuAt} label={`Actions for ${label}`} items={menuAt.items} onClose={() => setMenuAt(null)} /> : null}
    </>
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

/** The app's own sidebar items (lib/app/sidebarLayout.ts): where each goes, and how it's drawn. */
const SIDEBAR_ITEMS: Record<SidebarItemId, { label: string; href: string; icon: React.ReactNode }> = {
  home: { label: "Home", href: "/documents", icon: <Home size={16} /> },
  ai: { label: "Work with Foli AI", href: "/ai", icon: <AiIcon size={16} /> },
  dna: { label: "Foli DNA", href: "/graph", icon: <Waypoints size={16} /> },
  bookmarks: { label: "Bookmarks", href: "/starred", icon: <Bookmark size={16} /> },
  drafts: { label: "Drafts", href: "/drafts", icon: <Inbox size={16} /> },
  notes: { label: "All notes", href: "/notes", icon: <Files size={16} /> },
  tasks: { label: "Tasks", href: "/tasks/today", icon: <SquareCheckBig size={16} /> },
  calendar: { label: "Calendar", href: "/calendar", icon: <CalendarDays size={16} /> },
  reviews: { label: "Reviews", href: "/review", icon: <Layers size={16} /> },
  shared: { label: "Shared with Me", href: "/shared", icon: <Share2 size={16} /> },
  vault: { label: "Vault", href: "/vault", icon: <Lock size={16} /> },
  changes: { label: "Changes", href: "/changes", icon: <FileDiff size={16} /> },
  templates: { label: "Templates", href: "/templates", icon: <LayoutTemplate size={16} /> },
};

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
  const route = useNavRoute();
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
              className="ui-hit ui-caps grid h-7 w-6 flex-none place-items-center rounded-chip transition-colors hover:bg-[var(--glass-hover)] hover:text-heading"
            >
              {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
            </button>
            <AppLink
              href={href}
              onClick={onNavigate}
              aria-current={isActive(route, href) ? "page" : undefined}
              className={`ui-hit ui-caps flex h-7 min-w-0 flex-1 items-center rounded-chip pl-2.5 pr-2 transition-colors hover:bg-[var(--glass-hover)] hover:text-heading ${isActive(route, href) ? "text-heading" : ""}`}
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
            className="ui-input mt-2 h-control w-full px-3 text-callout"
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
  // In the columns layout there's no tab bar: New note sits beside the search box (docs/NOTE_COLUMNS.md).
  const columnsOn = useNoteColumnsActive();
  const createDocument = useCreateDocument();
  const keys = useKeyLabels();
  const search = (
    <button
      type="button"
      onClick={openPalette}
      className="ui-well flex h-9 w-full items-center gap-2 rounded-control pl-3 pr-1.5 text-left text-subheadline text-muted transition-colors hover:text-ink pointer-coarse:h-11"
    >
      <Search size={14} aria-hidden />
      <span className="min-w-0 flex-1 truncate">Search or jump to…</span>
      <Kbd>{modKey()}K</Kbd>
    </button>
  );
  if (!columnsOn) return search;
  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">{search}</div>
      <button
        type="button"
        aria-label="New note"
        title={keys("New note (⌘⌥N)")}
        onClick={() => void createDocument({})}
        className="ui-hit grid size-9 flex-none place-items-center rounded-control text-muted transition-colors hover:bg-accent-soft hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:size-11"
      >
        <SquarePen size={16} aria-hidden />
      </button>
    </div>
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
        className="ui-browser-only flex min-w-0 flex-1 items-center gap-2 rounded-chip px-1 py-1 text-heading outline-none hover:bg-[var(--glass-hover)] focus-visible:ring-2 focus-visible:ring-focus"
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

/** True once `ready` has been true, or `maxMs` after mounting, whichever comes first; then stays true. */
function useSettled(ready: boolean, maxMs: number): boolean {
  const [timedOut, setTimedOut] = useState(false);
  const [was, setWas] = useState(ready);
  if (ready && !was) setWas(true);
  useEffect(() => {
    if (was) return;
    const t = setTimeout(() => setTimedOut(true), maxMs);
    return () => clearTimeout(t);
  }, [was, maxMs]);
  return was || ready || timedOut;
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { scope, canEdit, today } = useAppState();
  const org = useFolderTree(scope);
  // Every list here is the last answer kept on this device until the live one comes (useOfflineQuery): the sidebar
  // is drawn anew each time it opens, and its rows mustn't pop in and push the folders down.
  const counts = useHeld(`tasks:${JSON.stringify(scope)}`, useOfflineQuery(api.tasks.counts, { scope, today }));
  const drafts = useOfflineQuery(api.organization.draftCount, { scope });
  // Reviews (flashcards due today, everywhere): listed once there's something to study. (Its window moves with the
  // clock, so the last answer is held while the next window's loads.)
  const reviews = useHeld("reviews", useOfflineQuery(api.study.summary, useReviewWindow(5 * 60_000)));
  const starred = useOfflineQuery(api.documents.list, { scope, view: "starred", paginationOpts: { numItems: 8, cursor: null } });
  const folderActions = useFolderActions();
  const { route } = useAppRouter();
  // A note open in a list's column is in that list (docs/NOTE_COLUMNS.md).
  const navRoute = useNavRoute();
  // Changes others made in notes you've opened (everywhere), leaving out the note in front of you.
  // (Local mode has no Changes: nobody else edits a library, docs/LOCAL_MODE_PLAN.md §5.2.)
  const caps = useCapabilities();
  // The graph comes to local mode later (lib/local/registry.ts LOCAL_PLANNED).
  const graph = useCanCall(api.aiGraph.graph);
  // Foli DNA's saved views, listed under it.
  const dnaViews = useOfflineQuery(api.graphViews.list, graph ? { scope } : "skip");
  const mode = useBackendMode();
  const canVault = useCanCall(api.vault.get);
  const changes = useHeld("changes", useOfflineQuery(api.changes.list, !caps.changes ? "skip" : route.name === "doc" ? { exclude: route.id } : {}));
  // The Vault shows for whoever can see one here (null: none for them; held back while its flag is off).
  // A library on this device has its own Vault (docs/MAC_REBUILD_PLAN.md §5.6), when local mode has it.
  const vaultHere = caps.sharing || (mode === "local" && canVault);
  const vault = useOfflineQuery(api.vault.get, vaultHere ? { scope } : "skip");
  // Changes apps proposed count too: they wait there for an answer.
  const minute = useMinute();
  const proposed = useHeld("proposals", useOfflineQuery(api.proposals.count, caps.changes ? { now: minute } : "skip"));
  // The rows from Templates down wait until the rows above them are known (the Vault appears when its query answers,
  // the folders replace their placeholder): drawn early, they jumped down a moment later (a layout shift on every
  // start, docs/perf/web-results.md). Never longer than a moment, so a query that keeps failing can't hide them.
  const lowerSettled = useSettled(org !== undefined && (!vaultHere || vault !== undefined), 1500);
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
  // The AI page, where Foli AI is on (not where it's turned off).
  const aiOn = useAiEnabled();
  // Folders and notes marked Always fully encrypted (the lists carry `locked` once the account has encryption).
  const isLockedFolder = (f: object) => (f as { locked?: boolean }).locked === true;

  // The folders in rank order (the Folders page's), and this person's own order of them here (synced with the
  // account; none saved: rank order). Manual is that order; Name and Recent sort it (lib/app/sidebarFolderSort.ts).
  const rankFolders = useMemo(() => org?.folders ?? [], [org]);
  const sidebarOrder = useSidebarOrder(scope);
  const manualFolders = useMemo(() => applySidebarOrder(rankFolders, sidebarOrder), [rankFolders, sidebarOrder]);
  const [folderSort, setFolderSort] = useLocalStorage<SidebarFolderSort>("folevi:sidebar-folders-sort", "manual");
  const folderIndex = useOfflineQuery(api.organization.index, folderSort === "recent" ? { scope, only: "folders" } : "skip");
  const changed = useMemo(() => new Map((folderIndex?.folders ?? []).map((f) => [f.id, f.updatedAt])), [folderIndex]);
  const folders = useMemo(() => sortSidebarFolders(manualFolders, folderSort, changed), [manualFolders, folderSort, changed]);
  // A folder dropped on the tree (FolderDropLayer): between two rows it moves in the sidebar's own order (a drag
  // while sorted by Name or Recent first makes the order shown the sidebar's, and switches to Manual); onto a
  // folder, or between rows of another level, it really moves there too (last by rank among its new siblings).
  useEffect(() => {
    setSidebarTreeDrops({
      folders,
      drop: (id, place, nest) => {
        const plan = planSidebarDrop({ rank: rankFolders, order: sidebarOrder, shown: folders, sort: folderSort, id, place, nest });
        const wasRank = folderPlace(rankFolders, id);
        const wasOrder = sidebarOrder ?? null;
        if (!plan.move && !plan.order) return null;
        if (plan.move) folderActions.move(id, plan.move.parentFolderId, plan.move.afterFolderId);
        if (plan.order) folderActions.setSidebarOrder(plan.order, scope);
        const wasSort = folderSort;
        if (plan.adopt) setFolderSort("manual");
        return () => {
          if (plan.move && wasRank) folderActions.move(id, wasRank.parentFolderId, wasRank.afterFolderId);
          if (plan.order) folderActions.setSidebarOrder(wasOrder ? [...wasOrder] : null, scope);
          if (plan.adopt) setFolderSort(wasSort);
        };
      },
    });
    return () => setSidebarTreeDrops(null);
  }, [folders, rankFolders, sidebarOrder, folderSort, folderActions, setFolderSort, scope]);
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
  const activeFolder = navRoute.name === "folder" ? folders.find((f) => f.id === navRoute.id) : undefined;
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
            <button type="button" aria-label={open ? `Collapse ${f.name}` : `Expand ${f.name}`} aria-expanded={open} className="ui-hit grid h-8 w-5 flex-none place-items-center rounded-chip text-faint pointer-coarse:w-8 hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" onClick={() => setFolderOpen(f.id, !open)}>
              {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
            </button>
          ) : (
            <span className="w-5 flex-none" />
          )}
          <div className="min-w-0 flex-1">
            <NavItem href={`/folders/${f.id}`} icon={<FolderGlyph color={f.color} size={15} kind={children.length ? "stack" : "notes"} />} label={f.name} onNavigate={onNavigate} dragFolderId={canEdit ? f.id : undefined} locked={isLockedFolder(f)} tabFolder={f} />
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
  const shownTags = allTags.filter((t, i) => i < SIDEBAR_LIMIT || (navRoute.name === "tag" && navRoute.id === t.id));

  // The app's own items (lib/app/sidebarLayout.ts): on the sidebar or under More, in this person's order, saved
  // with their account. Each shows only where it's available here (Foli AI when it's on, Changes where others edit).
  const { slots: layout, save: saveLayout } = useSidebarLayout();
  const [customizing, setCustomizing] = useState(false);
  const [spaceMenu, setSpaceMenu] = useState<{ x: number; y: number } | null>(null);
  const moreId = useId();
  const available = (id: SidebarItemId): boolean => {
    switch (id) {
      case "ai":
        return aiOn;
      case "dna":
        return Boolean(graph);
      case "reviews":
        return Boolean(reviews?.hasCards) || route.name === "review";
      case "shared":
        return caps.sharing;
      case "vault":
        return vaultHere && vault !== null && vault !== undefined;
      case "changes":
        return caps.changes;
      default:
        return true;
    }
  };
  const shownIds = layout.filter((s) => available(s.id));
  // (Templates on the sidebar waits with the rows below it, so nothing jumps as the start settles: see lowerSettled.)
  const onSidebar = shownIds.filter((s) => !s.more && (s.id !== "templates" || lowerSettled)).map((s) => s.id);
  const underMore = shownIds.filter((s) => s.more).map((s) => s.id);
  // More starts closed and remembers being opened or closed on this device; it opens by itself for the page you're on.
  const [moreToggled, setMoreOpen] = useLocalStorage("folevi:sidebar-more-open", false);
  const activeInMore = underMore.some((id) => isActive(navRoute, SIDEBAR_ITEMS[id].href));
  useEffect(() => {
    if (activeInMore && !moreToggled) setMoreOpen(true);
  }, [activeInMore, moreToggled, setMoreOpen]);
  const moreOpen = moreToggled || activeInMore;
  const customizeItems = useMemo(
    () => new Map(shownIds.map((s) => [s.id, { label: SIDEBAR_ITEMS[s.id].label, icon: SIDEBAR_ITEMS[s.id].icon }] as const)),
    // (shownIds is new each render; its ids are what matter.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shownIds.map((s) => s.id).join(" ")],
  );
  const itemMenu = (id: SidebarItemId): MenuItem[] => {
    const customize = { label: "Customize sidebar…", onSelect: () => setCustomizing(true) };
    if (LOCKED_SIDEBAR_ITEMS.has(id)) return [{ label: "Always on the sidebar", disabled: true, onSelect: () => {} }, customize];
    const more = layout.find((s) => s.id === id)?.more ?? false;
    return [{ label: more ? "Move to sidebar" : "Move to More", onSelect: () => saveLayout(moveSidebarItem(layout, id, !more)) }, customize];
  };
  const item = (id: SidebarItemId, extra?: Partial<Parameters<typeof NavItem>[0]>) => (
    <NavItem href={SIDEBAR_ITEMS[id].href} icon={SIDEBAR_ITEMS[id].icon} label={SIDEBAR_ITEMS[id].label} onNavigate={onNavigate} menu={itemMenu(id)} {...extra} />
  );
  const renderItem = (id: SidebarItemId): React.ReactNode => {
    switch (id) {
      case "dna":
        return (
          <>
            {item("dna")}
            {dnaViews?.length ? (
              <div className="space-y-0.5 pl-5" aria-label="Saved Foli DNA views" role="group">
                {dnaViews.slice(0, SIDEBAR_LIMIT).map((v) => (
                  <NavItem key={v.id} href={`/graph?view=${v.id}`} icon={<Waypoints size={14} />} label={v.name} onNavigate={onNavigate} />
                ))}
              </div>
            ) : null}
          </>
        );
      case "bookmarks": {
        const listed = starred?.page.filter((d, i) => i < SIDEBAR_LIMIT || (route.name === "doc" && route.id === d.id)) ?? [];
        return (
          <>
            <div className="group/starred relative">
              {item("bookmarks")}
              {starred?.page.length ? (
                <button
                  type="button"
                  onClick={() => setStarredOpen(!starredOpen)}
                  aria-expanded={starredOpen}
                  aria-label={starredOpen ? "Collapse Bookmarks" : "Expand Bookmarks"}
                  className="ui-hit absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-chip text-faint transition-colors hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  {/* (The 44 pt touch area is on a span inside: on a tablet .ui-hit makes its element relative, and this
                      button is absolute.) */}
                  <span aria-hidden className="ui-hit grid h-full w-full place-items-center">{starredOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                </button>
              ) : null}
            </div>
            {starred?.page.length && starredOpen ? (
              <div className="space-y-0.5 pl-5" aria-label="Bookmarked notes" role="group">
                {listed.map((d) => (
                  <NavItem key={d.id} href={`/d/${d.id}`} icon={<FileText size={14} />} label={d.title || "Untitled"} onNavigate={onNavigate} dragNoteId={canEdit ? d.id : undefined} noteId={d.id} locked={(d as { locked?: boolean }).locked === true} />
                ))}
                <MoreLink href="/starred" count={starred.page.length - listed.length} noun="bookmarked pages" onNavigate={onNavigate} exact={starred.isDone} />
              </div>
            ) : null}
          </>
        );
      }
      case "drafts":
        return item("drafts", { count: drafts ?? undefined, dropFolderId: "" });
      case "tasks":
        return item("tasks", { count: counts ? counts.today : undefined });
      case "reviews":
        return item("reviews", { count: reviews ? reviews.due + reviews.new : undefined });
      case "changes":
        return item("changes", { count: (changes?.notes.length ?? 0) + (proposed ?? 0) || undefined });
      default:
        return item(id);
    }
  };

  return (
    // A page opened from the sidebar starts a fresh tab, with no Back to the page you were on (lib/app/tabs.tsx).
    <nav aria-label="Folio" className="flex h-full flex-col" onClickCapture={(e) => (e.target as Element).closest("a[href]") && openNextFresh()}>
      <SidebarTopBar onNavigate={onNavigate} />

      <div className="flex-none space-y-2 px-2.5 pt-1">
        <SidebarSearch />
        {/* Ask AI lives in the floating chat button (bottom right) and on the AI page. */}
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4"
        onContextMenu={(e) => {
          // Empty sidebar space (not a row, a button or another menu's host): Customize sidebar.
          if (e.defaultPrevented || (e.target as Element).closest("a,button,input,textarea,[data-ctx-host],[role='menu']")) return;
          e.preventDefault();
          setSpaceMenu(menuPoint(e));
        }}
      >
        <div className="mt-3 space-y-0.5" data-sidebar-items="">
          {onSidebar.map((id) => <Fragment key={id}>{renderItem(id)}</Fragment>)}
          <div>
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-controls={moreId}
              onClick={() => setMoreOpen(!moreOpen)}
              onContextMenu={(e) => {
                e.preventDefault();
                setSpaceMenu(menuPoint(e));
              }}
              onKeyDown={(e) => {
                if (!isMenuKey(e)) return;
                e.preventDefault();
                setSpaceMenu(menuPoint(e));
              }}
              className="group flex h-8 w-full items-center gap-2.5 rounded-chip px-2.5 text-left text-body text-ink/90 outline-none transition-colors duration-150 hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:ring-2 focus-visible:ring-focus motion-reduce:transition-none pointer-coarse:h-11"
            >
              <span aria-hidden className="text-muted transition-colors group-hover:text-heading">
                <MoreHorizontal size={16} />
              </span>
              <span className="min-w-0 flex-1 truncate">More</span>
              <span aria-hidden className="text-faint group-hover:text-heading">
                {moreOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </span>
            </button>
            {moreOpen ? (
              <div id={moreId} role="group" aria-label="More" className="mt-0.5 space-y-0.5">
                {underMore.map((id) => <Fragment key={id}>{renderItem(id)}</Fragment>)}
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => setCustomizing(true)}
                  className="group flex h-8 w-full items-center gap-2.5 rounded-chip px-2.5 text-left text-body text-muted outline-none transition-colors duration-150 hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:ring-2 focus-visible:ring-focus motion-reduce:transition-none pointer-coarse:h-11"
                >
                  <span aria-hidden className="transition-colors group-hover:text-heading">
                    <SlidersHorizontal size={16} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">Customize</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {lowerSettled ? (
        <>
        <Section
          title="Folders"
          href="/folders"
          onNavigate={onNavigate}
          action={
            <span className="flex items-center">
              <MenuButton
                label="Sort folders"
                trigger={<ArrowDownUp size={14} aria-hidden />}
                items={[{ heading: "Sort folders" }, ...SIDEBAR_FOLDER_SORTS.map(([value, label]) => ({ label, checked: folderSort === value, onSelect: () => setFolderSort(value) }))]}
              />
              <IconButton label="New folder" onClick={() => setFolderDialog(true)}>
                <FolderPlus size={14} aria-hidden />
              </IconButton>
            </span>
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
              Show more <span className="sr-only">folders</span>
            </button>
          ) : allFoldersShown && roots.length > SIDEBAR_LIMIT ? (
            <button type="button" onClick={() => setAllFoldersShown(false)} className="flex h-8 w-full items-center rounded-chip px-2.5 pl-8 text-left text-subheadline text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-11">
              Show less <span className="sr-only">folders</span>
            </button>
          ) : null}
        </Section>

        <Section title="Tags" href="/tags" onNavigate={onNavigate} defaultOpen={false}>
          {org?.tags.length === 0 ? <p className="px-2 py-1 text-footnote text-faint">Add tags from a note’s Info panel</p> : null}
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
        </>
        ) : null}
      </div>

      {spaceMenu ? <ContextMenu at={spaceMenu} label="Sidebar" items={[{ label: "Customize sidebar…", onSelect: () => setCustomizing(true) }]} onClose={() => setSpaceMenu(null)} /> : null}
      <SidebarCustomize
        open={customizing}
        onClose={() => setCustomizing(false)}
        slots={layout}
        items={customizeItems}
        onChange={(next) => saveLayout(next)}
        onReset={() => saveLayout(null)}
      />
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
