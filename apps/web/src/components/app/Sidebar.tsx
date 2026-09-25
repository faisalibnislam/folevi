"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import {
  Archive,
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Hash,
  HelpCircle,
  Inbox,
  LayoutTemplate,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  Share2,
  Star,
  Trash2,
  Users,
  House as Home,
} from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter, type Route } from "@/lib/app/router";
import { Button, IconButton, Kbd } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { MenuButton } from "@/components/ui/Menu";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { FoleviMark } from "@/components/brand/FoleviMark";
import { modKey } from "@/lib/hooks/useEngine";
import { useShell } from "./Shell";
import { useCreateDocument } from "./useCreateDocument";
import { NotificationsButton } from "./NotificationsButton";
import { clearAllLocalData } from "@/lib/sync/db";

function isActive(route: Route, href: string): boolean {
  const map: Record<string, (r: Route) => boolean> = {
    "/documents": (r) => r.name === "documents",
    "/tasks/today": (r) => r.name === "tasks",
    "/calendar": (r) => r.name === "calendar",
    "/shared": (r) => r.name === "shared",
    "/templates": (r) => r.name === "templates",
    "/starred": (r) => r.name === "starred",
    "/archive": (r) => r.name === "archive",
    "/trash": (r) => r.name === "trash",
    "/unsorted": (r) => r.name === "unsorted",
    "/settings/account": (r) => r.name === "settings",
    "/help": (r) => r.name === "help",
  };
  if (map[href]) return map[href]!(route);
  if (href.startsWith("/folders/")) return route.name === "folder" && route.id === href.slice(9);
  if (href.startsWith("/tags/")) return route.name === "tag" && route.id === href.slice(6);
  if (href.startsWith("/d/")) return route.name === "doc" && route.id === href.slice(3);
  return false;
}

function NavItem({ href, icon, label, count, onNavigate, draggableFolderId }: { href: string; icon: React.ReactNode; label: string; count?: number; onNavigate?: () => void; draggableFolderId?: string }) {
  const { route } = useAppRouter();
  const active = isActive(route, href);
  const move = useMutation(api.documents.move);
  const toast = useToast();
  const [over, setOver] = useState(false);
  return (
    <AppLink
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      onDragOver={
        draggableFolderId !== undefined
          ? (e) => {
              if (e.dataTransfer.types.includes("application/x-folevi-document")) {
                e.preventDefault();
                setOver(true);
              }
            }
          : undefined
      }
      onDragLeave={() => setOver(false)}
      onDrop={
        draggableFolderId !== undefined
          ? (e) => {
              e.preventDefault();
              setOver(false);
              const docId = e.dataTransfer.getData("application/x-folevi-document");
              if (docId) move({ documentId: docId, folderId: draggableFolderId || null }).then(() => toast.show(`Moved to ${label}`), (err) => toast.show(errorMessage(err), { tone: "error" }));
            }
          : undefined
      }
      className={`group relative flex h-8 items-center gap-2.5 rounded-[10px] px-2.5 text-[13.5px] outline-none transition-[background-color,box-shadow,color] duration-150 pointer-coarse:h-11 ${
        active ? "ui-raised font-semibold text-heading" : "text-ink/90 hover:bg-[color-mix(in_oklab,var(--color-accent-soft)_75%,transparent)] hover:text-heading"
      } ${over ? "ring-2 ring-ember" : ""} focus-visible:ring-2 focus-visible:ring-focus`}
    >
      <span className={`transition-colors ${active ? "text-ember" : "text-muted group-hover:text-heading"}`} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? <span className={`min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5 tabular-nums ${active ? "bg-ember-soft text-ember-ink" : "bg-[color-mix(in_oklab,var(--color-ink)_7%,transparent)] text-muted"}`}>{count}</span> : null}
    </AppLink>
  );
}

function Section({ title, children, action, defaultOpen = true }: { title: string; children: React.ReactNode; action?: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mt-5">
      <div className="flex h-7 items-center gap-1 px-2.5">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="ui-caps flex flex-1 items-center gap-1 hover:text-muted">
          {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
          {title}
        </button>
        {action}
      </div>
      {open ? <div className="mt-1 space-y-0.5">{children}</div> : null}
    </section>
  );
}

function FolderMenu({ folder, folders }: { folder: { id: string; name: string; parentFolderId: string | null }; folders: { id: string; name: string }[] }) {
  const rename = useMutation(api.organization.renameFolder);
  const moveFolder = useMutation(api.organization.moveFolder);
  const del = useMutation(api.organization.deleteFolder);
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const act = (p: Promise<unknown>, msg: string) => p.then(() => toast.show(msg), (e) => toast.show(errorMessage(e), { tone: "error" }));
  const targets = folders.filter((f) => f.id !== folder.id);
  return (
    <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover/folder:opacity-100 pointer-coarse:opacity-100">
      <MenuButton
        label={`Folder options for ${folder.name}`}
        trigger={<MoreHorizontal size={14} aria-hidden />}
        items={[
          { label: "Rename…", onSelect: () => setRenaming(true) },
          ...(folder.parentFolderId ? [{ label: "Move to top level", onSelect: () => void act(moveFolder({ folderId: folder.id, parentFolderId: null }), "Moved") }] : []),
          ...targets.filter((t) => t.id !== folder.parentFolderId).slice(0, 8).map((t) => ({ label: `Move into ${t.name}`, onSelect: () => void act(moveFolder({ folderId: folder.id, parentFolderId: t.id }), `Moved into ${t.name}`) })),
          "separator" as const,
          { label: "Delete folder…", danger: true, onSelect: () => setDeleting(true) },
        ]}
      />
      <PromptDialog open={renaming} title="Rename folder" label="Folder name" initial={folder.name} onClose={() => setRenaming(false)} onSubmit={(name) => act(rename({ folderId: folder.id, name }), "Renamed")} />
      <Dialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete “${folder.name}”?`}
        description="The folder is removed. Its documents are kept and move to Unsorted."
        size="sm"
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => { setDeleting(false); void act(del({ folderId: folder.id }), "Folder deleted"); }}>
              Delete folder
            </Button>
          </>
        }
      />
    </div>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { workspace, workspaces, setWorkspace, profile, today } = useAppState();
  const { toggleSidebar, openPalette } = useShell();
  const org = useQuery(api.organization.sidebar, { workspaceId: workspace.id });
  const counts = useQuery(api.tasks.counts, { workspaceId: workspace.id, today });
  const starred = useQuery(api.documents.list, { workspaceId: workspace.id, view: "starred", paginationOpts: { numItems: 8, cursor: null } });
  const createFolder = useMutation(api.organization.createFolder);
  const createDocument = useCreateDocument();
  const toast = useToast();
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [folderDialog, setFolderDialog] = useState(false);

  const folders = org?.folders ?? [];
  const roots = folders.filter((f) => !f.parentFolderId);

  return (
    <nav aria-label="Workspace" className="flex h-full flex-col">
      <div className="flex h-[52px] flex-none items-center gap-1 px-2.5">
        <MenuButton
          label="Switch workspace"
          align="start"
          className="min-w-0 flex-1"
          trigger={
            <span className="flex min-w-0 items-center gap-2.5 px-1 text-[14px] font-semibold tracking-[-0.01em] text-heading">
              <span className="grid h-7 w-7 flex-none place-items-center rounded-[9px] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-accent)_80%,white),var(--color-accent-strong))] text-accent-ink shadow-[var(--shadow-primary)]">
                <FoleviMark size={15} />
              </span>
              <span className="truncate">{workspace.name}</span>
              <ChevronDown size={14} className="text-muted" aria-hidden />
            </span>
          }
          items={[
            ...workspaces.map((w) => ({ label: `${w.name}${w.id === workspace.id ? " ✓" : ""}`, onSelect: () => setWorkspace(w.id) })),
            "separator" as const,
            { label: "Workspace settings", icon: <Settings size={14} />, onSelect: () => window.history.pushState(null, "", "/settings/workspace") },
            { label: "Members", icon: <Users size={14} />, onSelect: () => window.history.pushState(null, "", "/settings/members") },
          ]}
        />
        <NotificationsButton />
        <IconButton label="Hide sidebar" shortcut={`${modKey()}\\`} onClick={toggleSidebar}>
          <PanelLeftClose size={16} aria-hidden />
        </IconButton>
      </div>

      <div className="flex-none space-y-2 px-2.5 pt-1">
        <button
          type="button"
          onClick={openPalette}
          className="ui-well flex h-9 w-full items-center gap-2 rounded-full pl-3 pr-1.5 text-left text-[13px] text-muted transition-colors hover:text-ink pointer-coarse:h-11"
        >
          <Search size={14} aria-hidden />
          <span className="flex-1">Search or jump to…</span>
          <Kbd>{modKey()}K</Kbd>
        </button>
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            void createDocument({});
          }}
          className="ui-btn ui-btn-secondary h-9 w-full justify-start px-3 text-[13.5px] pointer-coarse:h-11"
        >
          <span className="grid h-5 w-5 place-items-center rounded-full bg-ember text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]" aria-hidden>
            <Plus size={13} strokeWidth={2.5} />
          </span>
          New document
          <span className="ml-auto text-[11px] font-normal text-faint">{modKey()}⌥N</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
        <div className="mt-3 space-y-0.5">
          <NavItem href="/documents" icon={<Home size={16} />} label="Home" onNavigate={onNavigate} />
          <NavItem href="/tasks/today" icon={<CheckSquare size={16} />} label="Tasks" count={counts ? counts.today : undefined} onNavigate={onNavigate} />
          <NavItem href="/calendar" icon={<Calendar size={16} />} label="Calendar" onNavigate={onNavigate} />
          <NavItem href="/shared" icon={<Share2 size={16} />} label="Shared with Me" onNavigate={onNavigate} />
          <NavItem href="/templates" icon={<LayoutTemplate size={16} />} label="Templates" onNavigate={onNavigate} />
          <NavItem href="/unsorted" icon={<Inbox size={16} />} label="Unsorted" onNavigate={onNavigate} draggableFolderId="" />
        </div>

        <Section title="Starred">
          <NavItem href="/starred" icon={<Star size={16} />} label="All starred" onNavigate={onNavigate} />
          {starred?.page.map((d) => (
            <NavItem key={d.id} href={`/d/${d.id}`} icon={<span className="inline-block w-4 text-center text-[13px]">{d.icon ?? "·"}</span>} label={d.title || "Untitled"} onNavigate={onNavigate} />
          ))}
        </Section>

        <Section
          title="Folders"
          action={
            <IconButton label="New folder" onClick={() => setFolderDialog(true)}>
              <FolderPlus size={14} aria-hidden />
            </IconButton>
          }
        >
          {roots.length === 0 ? <p className="px-2 py-1 text-xs text-faint">No folders yet</p> : null}
          {roots.map((f) => {
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
                  <div className="group/folder flex min-w-0 flex-1 items-center">
                    <div className="min-w-0 flex-1">
                      <NavItem href={`/folders/${f.id}`} icon={f.icon ? <span className="inline-block w-4 text-center">{f.icon}</span> : <Folder size={16} />} label={f.name} onNavigate={onNavigate} draggableFolderId={f.id} />
                    </div>
                    <FolderMenu folder={f} folders={roots} />
                  </div>
                </div>
                {open
                  ? children.map((c) => (
                      <div key={c.id} className="group/folder flex items-center pl-7">
                        <div className="min-w-0 flex-1">
                          <NavItem href={`/folders/${c.id}`} icon={c.icon ? <span className="inline-block w-4 text-center">{c.icon}</span> : <Folder size={16} />} label={c.name} onNavigate={onNavigate} draggableFolderId={c.id} />
                        </div>
                        <FolderMenu folder={c} folders={roots} />
                      </div>
                    ))
                  : null}
              </div>
            );
          })}
        </Section>

        <Section title="Tags" defaultOpen={Boolean(org?.tags.length)}>
          {org?.tags.length === 0 ? <p className="px-2 py-1 text-xs text-faint">Tag documents from the inspector</p> : null}
          {org?.tags.map((t) => (
            <NavItem key={t.id} href={`/tags/${t.id}`} icon={<Hash size={15} style={{ color: `var(--color-${t.color === "muted" ? "ink-muted" : t.color})` }} />} label={t.name} onNavigate={onNavigate} />
          ))}
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
            await createFolder({ workspaceId: workspace.id, name });
          } catch (e) {
            toast.show(errorMessage(e), { tone: "error" });
          }
        }}
      />
      <div className="mx-2.5 mb-2.5 flex flex-none items-center gap-1 rounded-[14px] p-1.5 ui-raised">
        <MenuButton
          label="Account"
          align="start"
          className="min-w-0 flex-1"
          trigger={
            <span className="flex min-w-0 items-center gap-2 px-1 text-[13px] font-medium text-ink">
              <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-[linear-gradient(135deg,var(--color-glow-peach),var(--color-ember-soft))] text-[12px] font-semibold text-heading shadow-[inset_0_0_0_1px_rgb(255_255_255/0.6)]">{profile.displayName.slice(0, 1).toUpperCase()}</span>
              <span className="truncate">{profile.displayName}</span>
            </span>
          }
          items={[
            { label: "Settings", icon: <Settings size={14} />, onSelect: () => window.history.pushState(null, "", "/settings/account") },
            { label: "Security & sessions", onSelect: () => window.history.pushState(null, "", "/settings/security") },
            ...(profile.platformRole ? [{ label: "Admin console", onSelect: () => (window.location.href = "/admin") }] : []),
            "separator" as const,
            {
              label: "Sign out",
              onSelect: () => {
                void clearAllLocalData().finally(() => {
                  const form = document.createElement("form");
                  form.method = "post";
                  form.action = "/signout";
                  document.body.appendChild(form);
                  form.submit();
                });
              },
            },
          ]}
        />
        <AppLink href="/help" aria-label="Help" className="grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-accent-soft hover:text-heading">
          <HelpCircle size={16} aria-hidden />
        </AppLink>
        <AppLink href="/settings/account" aria-label="Settings" className="grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-accent-soft hover:text-heading">
          <Settings size={16} aria-hidden />
        </AppLink>
      </div>
    </nav>
  );
}
