// The note page's "…" menu, grouped (the owner, 6 November 2026): the everyday items at the top, then a submenu
// for each kind of action (Connections, History, Move and copy, Share and export, Note settings), then Archive
// and Move to Trash. Each item keeps its own conditions; a group with one item available shows that item in the
// group's place, and a group with none is left out.
import type { ReactNode } from "react";
import { FolderInput, History, Settings2, Share, Waypoints } from "lucide-react";
import type { MenuItem } from "@/components/ui/Menu";

/** The menu's items by where they go (each list already holds only what's available here). */
export interface NoteMenuParts {
  /** Bookmark, Comments, Info, Find and replace (and the note's own extras: its cards to review, images to read). */
  top: MenuItem[];
  /** Related notes, Foli DNA. */
  connections: MenuItem[];
  /** Version history…, Show editors. */
  history: MenuItem[];
  /** Move…, Copy to…, Duplicate, Move to another place…, Move to the Vault…. */
  moveCopy: MenuItem[];
  /** Export…, Present, Save as template. */
  shareExport: MenuItem[];
  /** Comment notifications, Always fully encrypted. */
  settings: MenuItem[];
  /** Archive (or Unarchive), Move to Trash. */
  end: MenuItem[];
}

/**
 * A submenu named `label` holding `items`: nothing when there are none, the item itself when there's only one (no
 * one-row submenus), otherwise one row that opens the rest to its side.
 */
export function submenuOrItems(label: string, icon: ReactNode, items: MenuItem[]): MenuItem[] {
  if (items.length <= 1) return items;
  return [{ label, icon, submenu: items, onSelect: () => undefined }];
}

/** The submenus' names, in order, with what goes in each (also what tests and e2e helpers look items up by). */
export const NOTE_SUBMENUS = ["Connections", "History", "Move and copy", "Share and export", "Note settings"] as const;

export function noteMenuEntries(parts: NoteMenuParts): (MenuItem | "separator")[] {
  const middle = [
    ...submenuOrItems("Connections", <Waypoints size={14} />, parts.connections),
    ...submenuOrItems("History", <History size={14} />, parts.history),
    ...submenuOrItems("Move and copy", <FolderInput size={14} />, parts.moveCopy),
    ...submenuOrItems("Share and export", <Share size={14} />, parts.shareExport),
    ...submenuOrItems("Note settings", <Settings2 size={14} />, parts.settings),
  ];
  const sections = [parts.top, middle, parts.end].filter((s) => s.length > 0);
  return sections.flatMap((s, i) => (i === 0 ? s : ["separator" as const, ...s]));
}

/** Every item of the menu in one list, submenus opened out (Info → Actions, the Mac's menu bar commands). */
export function flattenMenu(entries: (MenuItem | "separator")[]): (MenuItem | "separator")[] {
  return entries.flatMap((e) => (e !== "separator" && e.submenu ? flattenMenu(e.submenu) : [e]));
}
