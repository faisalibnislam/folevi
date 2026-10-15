// The folders an import makes (Settings → Import & export): a picked folder or a ZIP keeps its tree, each
// file going into the folder its relative path names ("Vault/Projects/plan.md" into Projects, inside
// Vault). Folders nest up to MAX_FOLDER_DEPTH levels; files deeper than that go into the deepest folder
// allowed. A folder that already has a folder of the same name under the same parent is reused, so
// importing into the same tree twice doesn't make a second copy. Notion exports keep their page nesting
// instead (sources.ts), and an Evernote notebook is one top-level folder.
import { MAX_FOLDER_DEPTH, ulid } from "@folevi/editor-schema";

/** A folder as the sidebar lists it. */
export interface ExistingFolder {
  id: string;
  name: string;
  parentFolderId: string | null;
}

/** A folder to make (parents before their children), with the id it's made with. */
export interface FolderStep {
  id: string;
  name: string;
  parentFolderId: string | null;
}

/** The folder names a file at `path` goes into, outermost first: its directories, at most `maxDepth` of them. */
export function folderPathOf(path: string, maxDepth = MAX_FOLDER_DEPTH): string[] {
  const dirs = path
    .split("/")
    .slice(0, -1)
    .map((d) => d.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 80))
    .filter(Boolean);
  return dirs.slice(0, maxDepth);
}

const key = (parent: string | null, name: string) => `${parent ?? ""}/${name.normalize("NFC").toLocaleLowerCase()}`;

/**
 * Plans the folders for these paths (each a list of names, outermost first): `steps` are the ones to make,
 * parents first, each with a new id; `folderId` gives the folder a path ends in, made or reused.
 */
export function planFolders(paths: readonly (readonly string[])[], existing: readonly ExistingFolder[]): { steps: FolderStep[]; folderId: (path: readonly string[]) => string | null } {
  const byKey = new Map<string, string>();
  for (const f of existing) if (!byKey.has(key(f.parentFolderId, f.name))) byKey.set(key(f.parentFolderId, f.name), f.id);
  const steps: FolderStep[] = [];
  const walk = (path: readonly string[], make: boolean): string | null => {
    let parent: string | null = null;
    for (const name of path) {
      const k = key(parent, name);
      let id = byKey.get(k);
      if (!id) {
        if (!make) return null;
        id = ulid();
        byKey.set(k, id);
        steps.push({ id, name, parentFolderId: parent });
      }
      parent = id;
    }
    return parent;
  };
  for (const path of paths) walk(path, true);
  return { steps, folderId: (path) => (path.length ? walk(path, false) : null) };
}
