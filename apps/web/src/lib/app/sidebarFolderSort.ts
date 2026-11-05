// The sidebar's own folder order (the owner, 5 and 6 November 2026). The sort button beside Folders picks Manual,
// Name (A to Z) or Recent (last changed first), kept on this device. Manual is the sidebar's OWN order: one person's,
// synced with their account to all their devices (sidebarOrder.get / set, one per Personal and per workspace),
// independent of the folders' rank (the Folders page's manual order, which everyone in a workspace shares).
//
// The saved order is a list of folder ids. Each level of the tree is sorted by a folder's place in it; folders it
// doesn't name (new ones, or none saved at all) come after the ones it does, in rank order. So with nothing saved
// the sidebar shows rank order, and a new folder shows at the bottom of its level.
//
// Dragging in the sidebar: dropped between two folders of its own level, a folder moves in the sidebar order only
// (rank and the Folders page don't change). Dropped onto a folder it really goes inside it (organization.moveFolder,
// last among its new siblings by rank), and shows last among them in the sidebar too. Dropped between rows of
// another level, it really moves there and takes that spot in the sidebar order. A drag between rows while the
// sidebar is sorted by Name or Recent first makes the order shown the sidebar order, then switches to Manual.
import { flattenFolders, type FolderLink } from "@folevi/editor-schema";
import { folderPlace, placeFolder, siblingsIn, type FolderPlace } from "./folderDrop";

export type SidebarFolderSort = "manual" | "name" | "recent";

export const SIDEBAR_FOLDER_SORTS: [SidebarFolderSort, string][] = [
  ["manual", "Manual"],
  ["name", "Name"],
  ["recent", "Recent"],
];

/**
 * The folders (in rank order) in the sidebar's own order: each level by a folder's place in `order`, the ones it
 * doesn't name after those it does, in rank order. No order: rank order, as given.
 */
export function applySidebarOrder<T extends FolderLink>(folders: readonly T[], order: readonly string[] | null | undefined): T[] {
  if (!order?.length) return [...folders];
  const at = new Map<string, number>();
  order.forEach((id, i) => {
    if (!at.has(id)) at.set(id, i);
  });
  const rank = new Map(folders.map((f, i) => [f.id, i]));
  const key = (f: T) => at.get(f.id) ?? Number.POSITIVE_INFINITY;
  return [...folders].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return rank.get(a.id)! - rank.get(b.id)!;
  });
}

/**
 * The folders in the order the sidebar shows them, each level sorted on its own (flattenFolders keeps the list's
 * order among siblings). `folders` are in the sidebar's own order (applySidebarOrder); `changed` is each folder's
 * last change, for Recent; one it doesn't know keeps its manual place after those it does.
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
 * Every folder id, depth first, with `id` moved into `parentFolderId` right after `afterFolderId` (null: first among
 * its new siblings), the rest kept in the order `shown` lists them: the sidebar order to save after a drop.
 */
export function sidebarOrderAfterMove(shown: readonly FolderLink[], id: string, parentFolderId: string | null, afterFolderId: string | null): string[] {
  const list = shown.map((f) => ({ id: f.id, parentFolderId: f.parentFolderId ?? null }));
  const placed = placeFolder(list, id, parentFolderId, afterFolderId) ?? list;
  return flattenFolders(placed).map((e) => e.folder.id);
}

/** The sibling a folder goes after to be last inside `parentFolderId` in `folders`' order (null: it'd be the only one). */
export function lastSiblingIn(folders: readonly FolderLink[], parentFolderId: string | null, except: string): string | null {
  return siblingsIn(folders, parentFolderId, except).at(-1)?.id ?? null;
}

/** What a drop on the sidebar's folder tree does. */
export interface SidebarDropPlan {
  /** The sidebar order to save, or null to leave it as it is. */
  order: string[] | null;
  /** A real move (the parent changes, for everyone and everywhere): last among the new siblings by rank. */
  move: FolderPlace | null;
  /** The drop makes the order shown (Name or Recent) the sidebar's: switch the sort to Manual. */
  adopt: boolean;
}

/**
 * What dropping `id` at `place` does. `place` is where the drop puts it among the folders as shown
 * (folderDrop.ts resolveFolderDrop on `shown`); `nest` says it was dropped onto a folder (or onto the top level's
 * space), not between two rows. `rank` is the folders in rank order, `order` the saved sidebar order (null: none).
 */
export function planSidebarDrop(args: {
  rank: readonly FolderLink[];
  order: readonly string[] | null | undefined;
  shown: readonly FolderLink[];
  sort: SidebarFolderSort;
  id: string;
  place: FolderPlace;
  nest: boolean;
}): SidebarDropPlan {
  const { rank, order, shown, sort, id, place, nest } = args;
  const was = folderPlace(rank, id);
  const parentChanged = !was || was.parentFolderId !== place.parentFolderId;
  const move = parentChanged ? { parentFolderId: place.parentFolderId, afterFolderId: lastSiblingIn(rank, place.parentFolderId, id) } : null;
  const manual = applySidebarOrder(rank, order);
  if (nest) {
    // Last inside its new parent: in rank order that's where the move puts it; a saved order is told the same.
    const saved = (order?.length ?? 0) > 0;
    return { order: saved ? sidebarOrderAfterMove(manual, id, place.parentFolderId, lastSiblingIn(manual, place.parentFolderId, id)) : null, move, adopt: false };
  }
  const base = sort === "manual" ? manual : shown;
  return { order: sidebarOrderAfterMove(base, id, place.parentFolderId, place.afterFolderId), move, adopt: sort !== "manual" };
}

/**
 * The sidebar's tree, for a drop on one of its rows (FolderDropLayer): the folders as it shows them, and what a
 * drop there does (it returns the Undo). Registered by the Sidebar while it's on screen.
 */
export interface SidebarTreeDrops {
  folders: readonly FolderLink[];
  drop: (id: string, place: FolderPlace, nest: boolean) => (() => void) | null;
}

let treeDrops: SidebarTreeDrops | null = null;

export function setSidebarTreeDrops(drops: SidebarTreeDrops | null): void {
  treeDrops = drops;
}

export function sidebarTreeDrops(): SidebarTreeDrops | null {
  return treeDrops;
}
