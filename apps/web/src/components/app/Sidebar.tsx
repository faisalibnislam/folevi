"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import {
  Archive,
  Calendar,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  Hash,
  HelpCircle,
  Inbox,
  LayoutTemplate,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  Share2,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter, type Route } from "@/lib/app/router";
import { IconButton, Kbd } from "@/components/ui/Button";
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
    "/daily": (r) => r.name === "daily",
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
      className={`group flex h-8 items-center gap-2.5 rounded-[7px] px-2 text-[13.5px] outline-none transition-colors pointer-coarse:h-11 ${
        active ? "bg-[color-mix(in_oklab,var(--color-ink)_8%,transparent)] font-medium text-ink" : "text-ink/85 hover:bg-[color-mix(in_oklab,var(--color-ink)_5%,transparent)]"
      } ${over ? "ring-2 ring-accent" : ""} focus-visible:ring-2 focus-visible:ring-focus`}
    >
      <span className={active ? "text-ink" : "text-muted"} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? <span className="text-xs tabular-nums text-faint">{count}</span> : null}
    </AppLink>
  );
}

function Section({ title, children, action, defaultOpen = true }: { title: string; children: React.ReactNode; action?: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mt-4">
      <div className="flex h-7 items-center gap-1 px-2">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex flex-1 items-center gap-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-faint hover:text-muted">
          {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
          {title}
        </button>
        {action}
      </div>
      {open ? <div className="mt-0.5 space-y-px">{children}</div> : null}
    </section>
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
    <nav aria-label="Workspace" className="flex h-full flex-col bg-canvas">
      <div className="flex h-12 flex-none items-center gap-1 px-2">
        <MenuButton
          label="Switch workspace"
          align="start"
          className="min-w-0 flex-1"
          trigger={
            <span className="flex min-w-0 items-center gap-2 px-1 text-sm font-semibold text-ink">
              <span className="grid h-6 w-6 flex-none place-items-center rounded-[6px] bg-ink text-canvas">
                <FoleviMark size={14} />
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

      <div className="flex-none space-y-1 px-2">
        <button
          type="button"
          onClick={openPalette}
          className="flex h-8 w-full items-center gap-2 rounded-[7px] border border-line bg-surface px-2 text-left text-[13px] text-muted hover:border-line-strong pointer-coarse:h-11"
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
          className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13.5px] font-medium text-accent hover:bg-accent-soft pointer-coarse:h-11"
        >
          <Plus size={16} aria-hidden />
          New document
          <span className="ml-auto text-[11px] font-normal text-faint">{modKey()}⌥N</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <div className="mt-2 space-y-px">
          <NavItem href="/documents" icon={<FileText size={16} />} label="All Documents" onNavigate={onNavigate} />
          <NavItem href="/tasks/today" icon={<CheckSquare size={16} />} label="Tasks" count={counts ? counts.today : undefined} onNavigate={onNavigate} />
          <NavItem href="/calendar" icon={<Calendar size={16} />} label="Calendar" onNavigate={onNavigate} />
          <NavItem href="/daily" icon={<CalendarDays size={16} />} label="Daily Notes" onNavigate={onNavigate} />
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
                  <div className="min-w-0 flex-1">
                    <NavItem href={`/folders/${f.id}`} icon={f.icon ? <span className="inline-block w-4 text-center">{f.icon}</span> : <Folder size={16} />} label={f.name} onNavigate={onNavigate} draggableFolderId={f.id} />
                  </div>
                </div>
                {open
                  ? children.map((c) => (
                      <div key={c.id} className="pl-7">
                        <NavItem href={`/folders/${c.id}`} icon={c.icon ? <span className="inline-block w-4 text-center">{c.icon}</span> : <Folder size={16} />} label={c.name} onNavigate={onNavigate} draggableFolderId={c.id} />
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

        <div className="mt-4 space-y-px">
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
      <div className="flex flex-none items-center gap-1 border-t border-line px-2 py-2">
        <MenuButton
          label="Account"
          align="start"
          className="min-w-0 flex-1"
          trigger={
            <span className="flex min-w-0 items-center gap-2 px-1 text-[13px] text-ink">
              <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-moss-soft text-[11px] font-semibold text-moss-ink">{profile.displayName.slice(0, 1).toUpperCase()}</span>
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
        <AppLink href="/help" aria-label="Help" className="grid h-8 w-8 place-items-center rounded-[6px] text-muted hover:bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)] hover:text-ink">
          <HelpCircle size={16} aria-hidden />
        </AppLink>
        <AppLink href="/settings/account" aria-label="Settings" className="grid h-8 w-8 place-items-center rounded-[6px] text-muted hover:bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)] hover:text-ink">
          <Settings size={16} aria-hidden />
        </AppLink>
      </div>
    </nav>
  );
}
