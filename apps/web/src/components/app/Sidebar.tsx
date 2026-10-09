"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import {
  Archive,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Hash,
  Files,
  Inbox,
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
import { draggedNoteIds, isNoteDrag } from "@/lib/app/noteDrag";
import { AiIcon } from "@/components/ai/AiIcon";
import { useAiEnabled } from "@/components/ai/useAi";

function isActive(route: Route, href: string): boolean {
  const map: Record<string, (r: Route) => boolean> = {
    "/documents": (r) => r.name === "documents",
    "/notes": (r) => r.name === "notes",
    "/ai": (r) => r.name === "ai",
    "/graph": (r) => r.name === "graph",
    "/tasks/today": (r) => r.name === "tasks",
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

function NavItem({ href, icon, label, count, onNavigate, draggableFolderId }: { href: string; icon: React.ReactNode; label: string; count?: number; onNavigate?: () => void; /** Makes the item a drop target for notes: a folder id, or "" for Drafts. */ draggableFolderId?: string }) {
  const { route } = useAppRouter();
  const active = isActive(route, href);
  const notes = useNoteActions();
  const [over, setOver] = useState(false);
  return (
    <AppLink
      href={href}
      onClick={() => {
        // A note opened from the sidebar (e.g. Starred) gets its own tab.
        if (href.startsWith("/d/")) openNextInNewTab();
        onNavigate?.();
      }}
      aria-current={active ? "page" : undefined}
      onDragOver={
        draggableFolderId !== undefined
          ? (e) => {
              if (isNoteDrag(e)) {
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
        draggableFolderId !== undefined
          ? (e) => {
              e.preventDefault();
              setOver(false);
              // One note, or a whole selection; the toast offers Undo.
              const ids = draggedNoteIds(e);
              if (ids.length) void notes.moveTo(ids, { id: draggableFolderId || null, name: label });
            }
          : undefined
      }
      className={`group relative flex h-8 items-center gap-2.5 rounded-[6px] px-2.5 text-[13.5px] outline-none transition-[background-color,box-shadow,color] duration-150 pointer-coarse:h-11 ${
        active ? "bg-[var(--glass-active)] font-semibold text-heading shadow-[var(--glass-edge),0_1px_3px_rgb(0_0_0/0.06)]" : "text-ink/90 hover:bg-[var(--glass-hover)] hover:text-heading"
      } ${over ? "bg-[var(--glass-active)] text-heading ring-2 ring-heading" : ""} focus-visible:ring-2 focus-visible:ring-focus`}
    >
      <span className={`transition-colors ${active ? "text-heading" : "text-muted group-hover:text-heading"}`} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? <span className={`min-w-5 rounded-[6px] px-1.5 text-center text-[11px] font-semibold leading-5 tabular-nums ${active ? "bg-heading text-canvas" : "bg-[var(--glass-hover)] text-muted"}`}>{count}</span> : null}
    </AppLink>
  );
}

/** Sidebar lists show a few items; the rest are one click away on the section's own page. */
const SIDEBAR_LIMIT = 5;

function MoreLink({ href, count, noun, onNavigate, exact = true }: { href: string; count: number; noun: string; onNavigate?: () => void; exact?: boolean }) {
  if (count <= 0) return null;
  if (!exact) {
    return (
      <AppLink href={href} onClick={onNavigate} className="flex h-8 items-center rounded-[6px] px-2.5 pl-8 text-[12.5px] text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading">
        View all <span className="sr-only">{noun}</span>
      </AppLink>
    );
  }
  return (
    <AppLink href={href} onClick={onNavigate} className="flex h-8 items-center rounded-[6px] px-2.5 pl-8 text-[12.5px] text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading">
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
      <div className="flex h-7 items-center gap-1 px-2.5">
        {href ? (
          <span className="flex min-w-0 flex-1 items-center gap-0.5">
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
              className="ui-caps grid h-7 w-6 flex-none place-items-center rounded-[6px] transition-colors hover:bg-[var(--glass-hover)] hover:text-heading"
            >
              {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
            </button>
            <AppLink
              href={href}
              onClick={onNavigate}
              aria-current={isActive(route, href) ? "page" : undefined}
              className={`ui-caps flex h-7 min-w-0 flex-1 items-center rounded-[6px] px-2 transition-colors hover:bg-[var(--glass-hover)] hover:text-heading ${isActive(route, href) ? "bg-[var(--glass-hover)] text-heading" : ""}`}
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
            icon: <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: tagColorVar(c.id) }} />,
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
            className="ui-input mt-2 h-10 w-full rounded-[6px] px-4"
          />
          <fieldset className="mt-4">
            <legend className="text-sm font-medium">Color</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {TAG_COLORS.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-1.5 rounded-[6px] px-2 py-1 text-sm has-[:checked]:bg-accent-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus">
                  <input type="radio" name={`tag-color-${tag.id}`} value={c.id} checked={color === c.id} onChange={() => setColor(c.id)} className="sr-only" />
                  <span className="inline-block h-3 w-3 rounded-full" style={{ background: tagColorVar(c.id) }} aria-hidden />
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
      className="ui-well flex h-9 w-full items-center gap-2 rounded-[6px] pl-3 pr-1.5 text-left text-[13px] text-muted transition-colors hover:text-ink pointer-coarse:h-11"
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
        className="ui-browser-only flex min-w-0 flex-1 items-center gap-2 rounded-[6px] px-1 py-1 text-heading outline-none focus-visible:ring-2 focus-visible:ring-focus"
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
  const org = useQuery(api.organization.sidebar, { scope });
  const counts = useQuery(api.tasks.counts, { scope, today });
  const drafts = useQuery(api.organization.draftCount, { scope });
  const starred = useQuery(api.documents.list, { scope, view: "starred", paginationOpts: { numItems: 8, cursor: null } });
  const createFolder = useMutation(api.organization.createFolder);
  const { route } = useAppRouter();
  const toast = useToast();
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [folderDialog, setFolderDialog] = useState(false);
  const [starredOpen, setStarredOpen] = useLocalStorage("folevi:sidebar-starred-open", true);
  // The AI page, where AI is included and on (never on Core).
  const aiOn = useAiEnabled();

  const folders = org?.folders ?? [];
  const roots = folders.filter((f) => !f.parentFolderId);
  // Only the first few folders and tags are listed (plus the one you're in); "+N more" opens the full list.
  const activeFolder = route.name === "folder" ? folders.find((f) => f.id === route.id) : undefined;
  const activeRootId = activeFolder ? (activeFolder.parentFolderId ?? activeFolder.id) : null;
  const shownRoots = roots.filter((f, i) => i < SIDEBAR_LIMIT || f.id === activeRootId);
  const shownFolderCount = shownRoots.reduce((n, r) => n + 1 + folders.filter((c) => c.parentFolderId === r.id).length, 0);
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
          {aiOn ? <NavItem href="/ai" icon={<AiIcon size={16} mono />} label="AI" onNavigate={onNavigate} /> : null}
          <NavItem href="/graph" icon={<Waypoints size={16} />} label="Graph" onNavigate={onNavigate} />
          <div className="group/starred relative">
            <NavItem href="/starred" icon={<Star size={16} />} label="Starred" onNavigate={onNavigate} />
            {starred?.page.length ? (
              <button
                type="button"
                onClick={() => setStarredOpen(!starredOpen)}
                aria-expanded={starredOpen}
                aria-label={starredOpen ? "Collapse Starred" : "Expand Starred"}
                className="absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-[6px] text-faint transition-colors hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
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
          <NavItem href="/shared" icon={<Share2 size={16} />} label="Shared with Me" onNavigate={onNavigate} />
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
          {shownRoots.map((f) => {
            const children = folders.filter((c) => c.parentFolderId === f.id);
            const open = openFolders[f.id] ?? true;
            return (
              <div key={f.id}>
                <div className="flex items-center">
                  {children.length ? (
                    <button type="button" aria-label={open ? `Collapse ${f.name}` : `Expand ${f.name}`} aria-expanded={open} className="grid h-8 w-5 place-items-center text-faint" onClick={() => setOpenFolders({ ...openFolders, [f.id]: !open })}>
                      {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
                    </button>
                  ) : (
                    <span className="w-5" />
                  )}
                  <div data-ctx-host="" className="group/folder flex min-w-0 flex-1 items-center">
                    <div className="min-w-0 flex-1">
                      <NavItem href={`/folders/${f.id}`} icon={<FolderGlyph color={f.color} size={18} />} label={f.name} onNavigate={onNavigate} draggableFolderId={f.id} />
                    </div>
                    <FolderMenu folder={f} className={FOLDER_MENU_REVEAL} />
                  </div>
                </div>
                {open
                  ? children.map((c) => (
                      <div key={c.id} data-ctx-host="" className="group/folder flex items-center pl-7">
                        <div className="min-w-0 flex-1">
                          <NavItem href={`/folders/${c.id}`} icon={<FolderGlyph color={c.color} size={18} />} label={c.name} onNavigate={onNavigate} draggableFolderId={c.id} />
                        </div>
                        <FolderMenu folder={c} className={FOLDER_MENU_REVEAL} />
                      </div>
                    ))
                  : null}
              </div>
            );
          })}
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
            await createFolder({ scope, name });
          } catch (e) {
            toast.show(errorMessage(e), { tone: "error" });
          }
        }}
      />
      <div className="flex-none px-2 pb-2">
        <WorkspaceMenu onNavigate={onNavigate} />
      </div>
    </nav>
  );
}
