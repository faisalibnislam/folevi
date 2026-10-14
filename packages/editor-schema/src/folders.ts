// Folder trees. Folders nest (a folder's `parentFolderId`) up to MAX_FOLDER_DEPTH levels; a top-level folder
// is level 1. Pure helpers shared by the server (which enforces the rules) and the apps (which show the tree
// and check a move before sending it). A folder whose parent isn't in the list counts as top level, and every
// walk is bounded, so a damaged tree (a cycle written by an old client) can't hang anything.

export const MAX_FOLDER_DEPTH = 5;

export interface FolderLink {
  id: string;
  parentFolderId: string | null;
}

/** Why a folder can't go where it was asked to (null: it can). */
export type FolderMoveProblem = "self" | "descendant" | "depth" | null;

const WALK_LIMIT = 64;

function parentsOf(folders: readonly FolderLink[]): Map<string, string | null> {
  const ids = new Set(folders.map((f) => f.id));
  return new Map(folders.map((f) => [f.id, f.parentFolderId && ids.has(f.parentFolderId) ? f.parentFolderId : null]));
}

function childrenOf<T extends FolderLink>(folders: readonly T[]): Map<string | null, T[]> {
  const parents = parentsOf(folders);
  const out = new Map<string | null, T[]>();
  for (const f of folders) {
    const p = parents.get(f.id) ?? null;
    const list = out.get(p);
    if (list) list.push(f);
    else out.set(p, [f]);
  }
  return out;
}

/** The folders above `id`, outermost first (empty for a top-level folder). */
export function folderAncestors<T extends FolderLink>(folders: readonly T[], id: string): T[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const parents = parentsOf(folders);
  const out: T[] = [];
  const seen = new Set([id]);
  for (let p = parents.get(id) ?? null, i = 0; p && !seen.has(p) && i < WALK_LIMIT; p = parents.get(p) ?? null, i++) {
    seen.add(p);
    out.unshift(byId.get(p)!);
  }
  return out;
}

/** A folder's level: 1 at the top level, 2 inside a top-level folder, and so on. */
export function folderDepth(folders: readonly FolderLink[], id: string): number {
  return folderAncestors(folders, id).length + 1;
}

/** Every folder inside `id`, at any level (not `id` itself). */
export function folderDescendants(folders: readonly FolderLink[], id: string): Set<string> {
  const children = childrenOf(folders);
  const out = new Set<string>();
  const queue = [id];
  while (queue.length && out.size < folders.length) {
    for (const c of children.get(queue.shift()!) ?? []) {
      if (c.id === id || out.has(c.id)) continue;
      out.add(c.id);
      queue.push(c.id);
    }
  }
  return out;
}

/** How many levels a folder and the folders inside it take up (1 for a folder with no subfolders). */
export function folderHeight(folders: readonly FolderLink[], id: string): number {
  const children = childrenOf(folders);
  const seen = new Set<string>();
  const walk = (at: string, depth: number): number => {
    if (seen.has(at) || depth > WALK_LIMIT) return depth - 1;
    seen.add(at);
    let max = depth;
    for (const c of children.get(at) ?? []) max = Math.max(max, walk(c.id, depth + 1));
    return max;
  };
  return walk(id, 1);
}

/**
 * Whether folder `id` (with everything inside it) may move into `parentId` (null: the top level): never into
 * itself or one of its own subfolders, and never deeper than MAX_FOLDER_DEPTH levels.
 */
export function folderMoveProblem(folders: readonly FolderLink[], id: string, parentId: string | null): FolderMoveProblem {
  if (parentId === null) return null;
  if (parentId === id) return "self";
  if (folderDescendants(folders, id).has(parentId)) return "descendant";
  if (folderDepth(folders, parentId) + folderHeight(folders, id) > MAX_FOLDER_DEPTH) return "depth";
  return null;
}

/** Whether a new folder may be made inside `parentId` (null: the top level). */
export function canNestFolderIn(folders: readonly FolderLink[], parentId: string | null): boolean {
  return parentId === null || folderDepth(folders, parentId) < MAX_FOLDER_DEPTH;
}

/**
 * The folders in tree order (each followed by what's inside it, siblings in the order given) with their level
 * (0 at the top level). Folders a cycle cuts off from the top level are listed at the end, at the top level.
 */
export function flattenFolders<T extends FolderLink>(folders: readonly T[]): { folder: T; depth: number }[] {
  const children = childrenOf(folders);
  const out: { folder: T; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const f of children.get(parent) ?? []) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const f of folders) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push({ folder: f, depth: 0 });
    walk(f.id, 1);
  }
  return out;
}

/** A folder's path as people read it: "Work / Clients / Acme". */
export function folderPath<T extends FolderLink & { name: string }>(folders: readonly T[], id: string, separator = " / "): string {
  const self = folders.find((f) => f.id === id);
  return [...folderAncestors(folders, id), ...(self ? [self] : [])].map((f) => f.name).join(separator);
}
