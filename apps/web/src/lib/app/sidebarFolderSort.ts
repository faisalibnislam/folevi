// The sidebar's own folder order (the owner, 5 November 2026): Manual (the folders' rank, dragged into place),
// Name (A to Z) or Recent (last changed first), chosen from the small sort button beside Folders and kept on
// this device. It's independent of the Folders page's sort. Dragging a folder to a new spot in the sidebar while
// it's sorted by Name or Recent first makes that order the manual one, then switches the sidebar to Manual.
import type { FolderLink } from "@folevi/editor-schema";

export type SidebarFolderSort = "manual" | "name" | "recent";

export const SIDEBAR_FOLDER_SORTS: [SidebarFolderSort, string][] = [
  ["manual", "Manual"],
  ["name", "Name"],
  ["recent", "Recent"],
];

/**
 * The folders in the order the sidebar shows them, each level sorted on its own (flattenFolders keeps the list's
 * order among siblings). `changed` is each folder's last change, for Recent; one it doesn't know keeps its
 * manual place after those it does.
 */
export function sortSidebarFolders<T extends FolderLink & { name: string }>(folders: readonly T[], sort: SidebarFolderSort, changed?: ReadonlyMap<string, number>): T[] {
  if (sort === "manual") return [...folders];
  const manual = new Map(folders.map((f, i) => [f.id, i]));
  return [...folders].sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) || manual.get(a.id)! - manual.get(b.id)!;
    const ta = changed?.get(a.id);
    const tb = changed?.get(b.id);
    if (ta !== undefined && tb !== undefined && ta !== tb) return tb - ta;
    if (ta !== undefined && tb === undefined) return -1;
    if (tb !== undefined && ta === undefined) return 1;
    return manual.get(a.id)! - manual.get(b.id)!;
  });
}

/**
 * The moves that make the manual order equal `shown` (the sidebar's sorted list): for each level whose order
 * differs, every folder of that level in turn, after the one before it. Levels already in that order are left.
 */
export function adoptMoves(manual: readonly FolderLink[], shown: readonly FolderLink[]): { id: string; parentFolderId: string | null; afterFolderId: string | null }[] {
  const level = (list: readonly FolderLink[], parent: string | null) => list.filter((f) => (f.parentFolderId ?? null) === parent).map((f) => f.id);
  const parents = new Set<string | null>(manual.map((f) => f.parentFolderId ?? null));
  const out: { id: string; parentFolderId: string | null; afterFolderId: string | null }[] = [];
  for (const parent of parents) {
    const was = level(manual, parent);
    const want = level(shown, parent);
    if (was.join("\n") === want.join("\n")) continue;
    want.forEach((id, i) => out.push({ id, parentFolderId: parent, afterFolderId: i > 0 ? want[i - 1]! : null }));
  }
  return out;
}

/** The sidebar's order while it isn't Manual, for a drop on one of its rows (FolderDropLayer). */
let shownOrder: { folders: readonly FolderLink[]; adopt: () => void } | null = null;

export function setSidebarShownOrder(order: { folders: readonly FolderLink[]; adopt: () => void } | null): void {
  shownOrder = order;
}

export function sidebarShownOrder(): { folders: readonly FolderLink[]; adopt: () => void } | null {
  return shownOrder;
}
