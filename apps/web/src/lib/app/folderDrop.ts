// Where a dragged folder lands in the sidebar's tree, worked out from the row it's over and where on that row
// (the top quarter: before it, the bottom quarter: after it, the middle: inside it). Pure, so the sidebar, the
// outbox overlay and the tests agree. The server (organization.moveFolder, and its local-mode twin) does the
// same with `afterFolderId`: the folder goes right after that sibling, or first when it's null.
import { folderMoveProblem, rankBetween, type FolderLink, type FolderMoveProblem } from "@folevi/editor-schema";

/** Where on a row the pointer is: a line above it, inside it, or a line below it. */
export type DropZone = "before" | "inside" | "after";

/** The zone of a row at `y` (the row spans `top` to `top + height`). */
export function zoneAt(y: number, top: number, height: number): DropZone {
  if (height <= 0) return "inside";
  const f = (y - top) / height;
  return f < 0.25 ? "before" : f > 0.75 ? "after" : "inside";
}

/** A folder's place among its siblings: its parent, and the sibling right before it (null: it's first). */
export interface FolderPlace {
  parentFolderId: string | null;
  afterFolderId: string | null;
}

export type FolderDrop = ({ ok: true; changed: boolean } & FolderPlace) | { ok: false; problem: Exclude<FolderMoveProblem, null> };

/** The folders inside `parentId` (null: the top level) in the order given, leaving out `except`. */
export function siblingsIn<T extends FolderLink>(folders: readonly T[], parentId: string | null, except?: string): T[] {
  const ids = new Set(folders.map((f) => f.id));
  // A parent that isn't in the list reads as the top level (flattenFolders does the same).
  const parentOf = (f: T) => (f.parentFolderId && ids.has(f.parentFolderId) ? f.parentFolderId : null);
  return folders.filter((f) => f.id !== except && parentOf(f) === parentId);
}

/** Where a folder is now (null when it isn't in the list). */
export function folderPlace(folders: readonly FolderLink[], id: string): FolderPlace | null {
  const folder = folders.find((f) => f.id === id);
  if (!folder) return null;
  const ids = new Set(folders.map((f) => f.id));
  const parentFolderId = folder.parentFolderId && ids.has(folder.parentFolderId) ? folder.parentFolderId : null;
  const siblings = siblingsIn(folders, parentFolderId);
  const i = siblings.findIndex((f) => f.id === id);
  return { parentFolderId, afterFolderId: i > 0 ? siblings[i - 1]!.id : null };
}

/**
 * Where `draggedId` goes when dropped on `targetId`'s row in `zone` (targetId null: the space for the top
 * level, where it goes last). `targetOpen` says the target's subfolders show under it: a line below an open
 * folder is above its first subfolder, so the folder goes first inside it. `folders` are in sidebar order.
 */
export function resolveFolderDrop(folders: readonly FolderLink[], draggedId: string, targetId: string | null, zone: DropZone, targetOpen = false): FolderDrop {
  const now = folderPlace(folders, draggedId);
  if (!now) return { ok: false, problem: "self" };
  let place: FolderPlace;
  if (targetId === null) {
    const roots = siblingsIn(folders, null, draggedId);
    place = { parentFolderId: null, afterFolderId: roots.at(-1)?.id ?? null };
  } else {
    const target = folderPlace(folders, targetId);
    if (!target) return { ok: false, problem: "self" };
    if (targetId === draggedId) {
      // On itself: inside is refused; a line just above or below it changes nothing.
      if (zone === "inside") return { ok: false, problem: "self" };
      return { ok: true, changed: false, ...now };
    }
    if (zone === "inside" || (zone === "after" && targetOpen && siblingsIn(folders, targetId, draggedId).length > 0)) {
      const inside = siblingsIn(folders, targetId, draggedId);
      place = { parentFolderId: targetId, afterFolderId: zone === "inside" ? (inside.at(-1)?.id ?? null) : null };
    } else if (zone === "after") {
      place = { parentFolderId: target.parentFolderId, afterFolderId: targetId };
    } else {
      const siblings = siblingsIn(folders, target.parentFolderId, draggedId);
      const i = siblings.findIndex((f) => f.id === targetId);
      place = { parentFolderId: target.parentFolderId, afterFolderId: i > 0 ? siblings[i - 1]!.id : null };
    }
  }
  const problem = folderMoveProblem(folders, draggedId, place.parentFolderId);
  if (problem) return { ok: false, problem };
  return { ok: true, changed: place.parentFolderId !== now.parentFolderId || place.afterFolderId !== now.afterFolderId, ...place };
}

/**
 * The list with `id` moved into `parentFolderId`, right after its sibling `afterFolderId` (null: first), as the
 * server will have it: the folder takes a rank between its new neighbours (when theirs can be read) and its
 * place in the list, so the tree shows it there at once. Null when the move isn't allowed.
 */
export function placeFolder<T extends FolderLink & { rank?: string }>(folders: readonly T[], id: string, parentFolderId: string | null, afterFolderId: string | null): T[] | null {
  const folder = folders.find((f) => f.id === id);
  if (!folder) return null;
  if (parentFolderId !== null && !folders.some((f) => f.id === parentFolderId)) return null;
  if (folderMoveProblem(folders, id, parentFolderId)) return null;
  const rest = folders.filter((f) => f.id !== id);
  const siblings = siblingsIn(rest, parentFolderId);
  const i = afterFolderId === null ? -1 : siblings.findIndex((f) => f.id === afterFolderId);
  const before = i >= 0 ? siblings[i] : undefined;
  const after = siblings[i + 1];
  let rank = folder.rank;
  if (rank !== undefined) {
    try {
      rank = rankBetween(before?.rank ?? null, after?.rank ?? null);
    } catch {
      // A folder made offline has a stand-in rank: the order in the list still holds.
    }
  }
  const moved = { ...folder, parentFolderId, ...(rank !== undefined ? { rank } : {}) } as T;
  const at = after ? rest.indexOf(after) : before ? rest.indexOf(before) + 1 : folders.indexOf(folder);
  return [...rest.slice(0, at), moved, ...rest.slice(at)];
}
