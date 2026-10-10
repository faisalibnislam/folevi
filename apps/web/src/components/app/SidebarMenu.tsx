"use client";

import { Maximize2, Minimize2, PanelLeft } from "lucide-react";
import { useAppRouter } from "@/lib/app/router";
import { MenuButton, type MenuItem } from "@/components/ui/Menu";
import { useShell } from "./Shell";

/**
 * The sidebar's own menu (panel icon): hide or show it, focus mode, and (on a note) whether the sidebar
 * shows the folders or the note's tools. It lives in the sidebar next to notifications, and moves to the
 * tab strip while the sidebar is hidden so it's always one click away.
 */
export function SidebarMenu() {
  const { sidebarOpen, toggleSidebar, docSidebarMode, setDocSidebarMode, focusMode, setFocusMode } = useShell();
  const { route } = useAppRouter();
  const onNote = route.name === "doc";
  const items: (MenuItem | "separator")[] = [
    { label: sidebarOpen ? "Hide sidebar" : "Show sidebar", icon: <PanelLeft size={14} />, shortcut: "⌘\\", onSelect: toggleSidebar },
    focusMode
      ? { label: "Exit focus mode", icon: <Minimize2 size={14} />, onSelect: () => setFocusMode(false) }
      : { label: "Focus mode", icon: <Maximize2 size={14} />, onSelect: () => setFocusMode(true) },
    ...(onNote
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
      triggerClassName="grid h-8 w-8 flex-none place-items-center rounded-chip text-muted transition-colors hover:bg-accent-soft hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus aria-expanded:bg-accent-soft aria-expanded:text-heading"
      trigger={<PanelLeft size={16} aria-hidden />}
      items={items}
    />
  );
}
