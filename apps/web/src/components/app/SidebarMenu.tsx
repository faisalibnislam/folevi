"use client";

import { Maximize2, Minimize2, PanelLeft, SquarePen } from "lucide-react";
import { useCreateDocument } from "./useCreateDocument";
import { useKeyLabels } from "@/lib/shortcuts";
import { useAppRouter } from "@/lib/app/router";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";
import { useShell } from "./Shell";
import { useFold } from "@/lib/platform";
import { useIpadLayout } from "@/lib/iphone";
import { useColumnsList, useLayoutChoice } from "@/lib/app/useNoteColumns";

/**
 * The sidebar's own menu (panel icon): hide or show it, focus mode, the Layout of note lists (cards and rows, or
 * columns), and (on a note) whether the sidebar shows the folders or the note's tools. It lives in the sidebar next to notifications, and moves to the
 * tab strip while the sidebar is hidden so it's always one click away.
 */
export function SidebarMenu() {
  const { sidebarOpen, toggleSidebar, docSidebarMode, setDocSidebarMode, focusMode, setFocusMode } = useShell();
  const { route } = useAppRouter();
  const onNote = route.name === "doc";
  const layout = useLayoutChoice();
  // A note shown in a list's column always has the folders beside it.
  const inColumn = useColumnsList() !== null;
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
    ...(onNote && !inColumn
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

/**
 * The columns layout has no tab bar (docs/NOTE_COLUMNS.md): with the sidebar hidden, its menu and New note float at
 * the top left of a page without a note column (Home, Tasks, Settings…). A note column has them in its own head.
 */
export function ColumnsCornerButtons() {
  const { sidebarOpen } = useShell();
  const createDocument = useCreateDocument();
  const keys = useKeyLabels();
  if (sidebarOpen) return null;
  return (
    <div className="ui-glass ui-glass-sidebar absolute left-2 top-2 z-30 flex items-center gap-1 rounded-panel p-1">
      <SidebarMenu />
      <button
        type="button"
        aria-label="New note"
        title={keys("New note (⌘⌥N)")}
        onClick={() => void createDocument({})}
        className="ui-hit grid h-8 w-8 flex-none place-items-center rounded-chip text-muted transition-colors hover:bg-accent-soft hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <SquarePen size={16} aria-hidden />
      </button>
    </div>
  );
}
