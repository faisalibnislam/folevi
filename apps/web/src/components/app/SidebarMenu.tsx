"use client";

import { Maximize2, Minimize2, PanelLeft } from "lucide-react";
import { useAppRouter } from "@/lib/app/router";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";
import { useShell } from "./Shell";
import { useFold } from "@/lib/platform";
import { useIpadLayout } from "@/lib/iphone";
import { useQuery } from "@/lib/convex/queries";
import { api } from "@/lib/convex/api";
import { useLayoutChoice } from "@/lib/app/useNoteColumns";
import { listFromSearch } from "@/lib/app/noteColumns";

/**
 * The sidebar's own menu (panel icon): hide or show it, focus mode, the Layout of note lists (cards and rows, or
 * columns), and (on a note) whether the sidebar shows the folders or the note's tools. It lives in the sidebar next to notifications, and moves to the
 * tab strip while the sidebar is hidden so it's always one click away.
 */
export function SidebarMenu() {
  const { sidebarOpen, toggleSidebar, docSidebarMode, setDocSidebarMode, focusMode, setFocusMode } = useShell();
  const { route, search } = useAppRouter();
  const onNote = route.name === "doc";
  // A note opened on its own goes into its list's column when Columns is chosen: its folder's, else Drafts (Trash
  // or Archive while it's there). Nested pages and templates aren't in a note list: they stay as they are.
  const alone = onNote && !listFromSearch(search);
  const meta = useQuery(api.documents.get, alone ? { documentId: route.id } : "skip");
  const doc = meta?.document as { parentDocumentId?: string | null; kind?: string; archivedAt?: number | null } | undefined;
  const listOfNote =
    !meta || !doc || doc.parentDocumentId || doc.kind === "template" ? null : meta.inTrash ? "/trash" : doc.archivedAt ? "/archive" : meta.folder ? `/folders/${encodeURIComponent(meta.folder.id)}` : "/drafts";
  const layout = useLayoutChoice(listOfNote);
  // An iPhone Duo or foldable partly open keeps the sidebar on its side of the fold (Shell.tsx foldSplit): there's
  // nothing to hide or show then, so the item isn't offered.
  const fold = useFold();
  const foldSplit = useIpadLayout() && fold?.orientation === "vertical" && fold.start > 240;
  const items: MenuEntry[] = [
    ...(foldSplit ? [] : [{ label: sidebarOpen ? "Hide sidebar" : "Show sidebar", icon: <PanelLeft size={14} />, shortcut: "⌘\\", onSelect: toggleSidebar }]),
    focusMode
      ? { label: "Exit focus mode", icon: <Minimize2 size={14} />, onSelect: () => setFocusMode(false) }
      : { label: "Focus mode", icon: <Maximize2 size={14} />, onSelect: () => setFocusMode(true) },
    // How note lists show (docs/NOTE_COLUMNS.md): the same choice as Settings > Appearance > Note lists.
    ...(layout.available
      ? [
          "separator" as const,
          { heading: "Layout" },
          { label: "Cards and rows", checked: !layout.columns, onSelect: () => layout.setColumns(false) },
          { label: "Columns", checked: layout.columns, onSelect: () => layout.setColumns(true) },
        ]
      : []),
    // (A note in a list's column always has the folders beside it.)
    ...(onNote && !(layout.columns && !alone)
      ? [
          "separator" as const,
          { label: "Show folders", checked: docSidebarMode === "folders", onSelect: () => setDocSidebarMode("folders") },
          { label: "Show document", checked: docSidebarMode === "document", onSelect: () => setDocSidebarMode("document") },
        ]
      : []),
  ];
  return (
    <MenuButton
      label="Sidebar"
      align="start"
      triggerClassName="ui-hit grid h-8 w-8 flex-none place-items-center rounded-chip text-muted transition-colors hover:bg-accent-soft hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus aria-expanded:bg-accent-soft aria-expanded:text-heading"
      trigger={<PanelLeft size={16} aria-hidden />}
      items={items}
    />
  );
}
