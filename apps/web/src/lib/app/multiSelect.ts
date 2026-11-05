// Finder-style multi-select of a list's items (notes and folders), as plain functions so the lists (web
// DocumentBrowser and the Folders page; the native apps follow the same rules in FoleviMac's ListSelection) and
// the tests share them:
// - a plain click opens the item, as ever;
// - ⌘-click (Ctrl-click off the Mac) adds or removes one item, ⇧-click selects the run from the last one clicked;
// - ⌘A selects every item shown, Escape clears;
// - the actions offered are those every selected item can take (a folder and a note: Move and Open in new tabs).
import { folderAncestors, folderMoveProblem, type FolderLink, type FolderMoveProblem } from "@folevi/editor-schema";

/** What a selection is: the picked ids, and the item a ⇧-click range starts from. */
export interface Selection {
  picked: ReadonlySet<string>;
  anchor: string | null;
}

export const NO_SELECTION: Selection = { picked: new Set(), anchor: null };

/** ⌘-click: the item goes in, or comes out; either way the next range starts from it. */
export function toggleSelection(s: Selection, id: string): Selection {
  const picked = new Set(s.picked);
  if (picked.has(id)) picked.delete(id);
  else picked.add(id);
  return { picked, anchor: id };
}

/**
 * ⇧-click: every item from the anchor to `id` (in `order`, the list as shown) joins the selection. With no anchor
 * (or one no longer shown) it's the item alone, and it becomes the anchor.
 */
export function selectRange(s: Selection, order: readonly string[], id: string): Selection {
  const to = order.indexOf(id);
  if (to < 0) return s;
  const from = s.anchor ? order.indexOf(s.anchor) : -1;
  if (from < 0) return { picked: new Set([...s.picked, id]), anchor: id };
  const [a, b] = from < to ? [from, to] : [to, from];
  return { picked: new Set([...s.picked, ...order.slice(a, b + 1)]), anchor: s.anchor };
}

/** ⌘A: everything shown. */
export function selectAll(order: readonly string[]): Selection {
  return { picked: new Set(order), anchor: order[0] ?? null };
}

/** The selected ids still shown, in the list's order (a moved or trashed item drops out). */
export function selectedInOrder(s: Selection, order: readonly string[]): string[] {
  return order.filter((id) => s.picked.has(id));
}

/** What a click does to the selection: "toggle" (⌘, or Ctrl off the Mac), "range" (⇧), or null (it opens). */
export function clickIntent(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey?: boolean }, mac: boolean): "toggle" | "range" | null {
  if (e.button !== 0 || e.altKey) return null;
  if (mac ? e.metaKey : e.ctrlKey) return "toggle";
  if (e.shiftKey) return "range";
  return null;
}

/** One selected item, with what decides the actions it can take. */
export interface SelectedItem {
  kind: "note" | "folder";
  /** A note's bookmark. */
  starred?: boolean;
  /** A note in Archive. */
  archived?: boolean;
  /** A note that's a template (it has its own actions and isn't moved to folders). */
  template?: boolean;
}

export type BulkAction =
  | "openTabs"
  | "move"
  | "copy"
  | "bookmark"
  | "unbookmark"
  | "tags"
  | "color"
  | "archive"
  | "unarchive"
  | "trash"
  | "restore"
  | "deleteForever"
  | "deleteFolders";

export interface BulkContext {
  /** The list is Trash (its notes are restored or deleted for good, nothing else). */
  trash?: boolean;
  /** Folders can be changed here (a viewer's workspace can't). */
  canEdit: boolean;
  /** "Copy to…" exists (another Personal or workspace to copy into). */
  canCopy?: boolean;
  /** There's a tab strip to open tabs in (not the phone layout). */
  tabs?: boolean;
}

/**
 * The actions a selection offers, in the order the bar and menu show them: only those every selected item can
 * take. Notes: bookmark, tags, archive, trash (and copy elsewhere); folders: colour and delete; both: open in new
 * tabs and move. Bookmark becomes Remove bookmark when every note is bookmarked, Archive becomes Unarchive when
 * every note is archived.
 */
export function bulkActions(items: readonly SelectedItem[], ctx: BulkContext): BulkAction[] {
  if (!items.length) return [];
  const notes = items.filter((i) => i.kind === "note");
  const folders = items.length - notes.length;
  const allNotes = folders === 0;
  const allFolders = notes.length === 0;
  if (ctx.trash) return allNotes ? ["restore", "deleteForever"] : [];
  const out: BulkAction[] = [];
  if (ctx.tabs) out.push("openTabs");
  // Templates aren't filed in folders; folders move only where folders can be changed.
  if (!notes.some((n) => n.template) && (allNotes || ctx.canEdit)) out.push("move");
  if (allNotes && ctx.canCopy) out.push("copy");
  if (allNotes) out.push(notes.every((n) => n.starred) ? "unbookmark" : "bookmark");
  if (allNotes && ctx.canEdit) out.push("tags");
  if (allFolders && ctx.canEdit) out.push("color");
  if (allNotes) out.push(notes.every((n) => n.archived) ? "unarchive" : "archive");
  if (allNotes) out.push("trash");
  if (allFolders && ctx.canEdit) out.push("deleteFolders");
  return out;
}

/**
 * Moving several selected folders into `targetId` (null: the top level): which move, which are there already, and
 * which can't go (into itself, its own subfolder, or too deep). A folder inside another selected folder goes along
 * with that one and isn't moved on its own.
 */
export function planFolderMoves(folders: readonly FolderLink[], ids: readonly string[], targetId: string | null): { move: string[]; unchanged: string[]; refused: { id: string; problem: Exclude<FolderMoveProblem, null> }[] } {
  const picked = new Set(ids);
  const move: string[] = [];
  const unchanged: string[] = [];
  const refused: { id: string; problem: Exclude<FolderMoveProblem, null> }[] = [];
  for (const id of ids) {
    const f = folders.find((x) => x.id === id);
    if (!f) continue;
    if (folderAncestors(folders, id).some((a) => picked.has(a.id) && a.id !== targetId)) continue;
    if ((f.parentFolderId ?? null) === targetId) {
      unchanged.push(id);
      continue;
    }
    const problem = folderMoveProblem(folders, id, targetId);
    if (problem) refused.push({ id, problem });
    else move.push(id);
  }
  return { move, unchanged, refused };
}

/** "3 selected" plus what they are, for a screen reader or a menu's label: "2 folders and 3 notes". */
export function selectionNoun(notes: number, folders: number): string {
  const n = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count.toLocaleString()} ${many}`);
  if (!folders) return n(notes, "note", "notes");
  if (!notes) return n(folders, "folder", "folders");
  return `${n(folders, "folder", "folders")} and ${n(notes, "note", "notes")}`;
}
