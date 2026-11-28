// The Mac's menu bar note (apps/native-kit FoleviMenuBarNote, owner decisions 2026-11-28): one real note in the float
// page without its bar (`/float/<id>?panel=1`). Its empty page (`/float/new?panel=1&space=&folder=`) makes the note
// in Drafts, or the folder picked, on the first keystroke; where new notes can go (Personal or a team workspace, and
// its folders) is listed for the panel's picker; screenshots go in as a paste would.
import type { WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";

/** A folder as the destination menu lists it: in sidebar order, each under its parent, `depth` 0 at the top. */
export interface NoteFolder {
  id: string;
  name: string;
  depth: number;
}

export interface NoteSpace {
  /** "personal" or the workspace's id. */
  id: string;
  name: string;
  kind: "personal" | "workspace";
  canEdit: boolean;
  /** Its mark, as the app's workspace menu shows it: your picture for Personal, the workspace's logo; null for the initial. */
  imageUrl: string | null;
  /** The name the initial comes from when there's no picture (your name for Personal). */
  markName: string;
  folders: NoteFolder[];
}

export const scopeOfSpace = (space: string): WireScope => (space === "personal" ? { kind: "personal" } : { kind: "workspace", workspaceId: space });

type SidebarFolder = { id: string; name: string; parentFolderId: string | null; sealedName?: unknown };

/** The sidebar's folders as a tree in its order (each folder right after its parent), with depths; sealed names say "Locked folder". */
export function folderTree(folders: readonly SidebarFolder[]): NoteFolder[] {
  const ids = new Set(folders.map((f) => f.id));
  const children = new Map<string | null, SidebarFolder[]>();
  for (const f of folders) {
    const parent = f.parentFolderId && ids.has(f.parentFolderId) ? f.parentFolderId : null;
    children.set(parent, [...(children.get(parent) ?? []), f]);
  }
  const out: NoteFolder[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const f of children.get(parent) ?? []) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push({ id: f.id, name: f.name || "Untitled folder", depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Where the empty page makes its note: `?space=personal|<workspace id>&folder=<id>` (Drafts without a folder). */
export function composerTarget(search: URLSearchParams): { space: string; folderId: string | null } {
  const space = search.get("space") || "personal";
  const folder = search.get("folder");
  return { space, folderId: folder ? folder : null };
}

/** The menu bar's empty page, in the panel: true for `/float/...?panel=1`. */
export function inMenuBarPanel(search: URLSearchParams): boolean {
  return search.get("panel") === "1";
}

function base64Blob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Puts an image (a screenshot from the panel) into the note as a paste would: the editor's own paste takes the file,
 * uploads it with the note and places it at the caret (or the note's end when it has never had one). False when the
 * page has no note editor.
 */
export function pasteImage(doc: Document, data: string, mime: string, name: string): boolean {
  const editors = [...doc.querySelectorAll<HTMLElement>(".ProseMirror[contenteditable='true']")];
  const editor = editors.find((e) => e.contains(doc.activeElement)) ?? editors[0];
  if (!editor) return false;
  const file = new File([base64Blob(data, mime)], name, { type: mime });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  editor.focus();
  editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  return true;
}

/** The spaces of this place a new note can go to, each with its mark and folders. */
export async function noteSpaces(
  client: { query: (fn: never, args: never) => Promise<unknown> },
  workspaces: readonly { id: string; name: string; canEdit?: boolean; logoUrl?: string | null }[],
  personal: { displayName?: string | null; avatarUrl?: string | null } = {},
): Promise<NoteSpace[]> {
  const list: Omit<NoteSpace, "folders">[] = [
    { id: "personal", name: "Personal", kind: "personal", canEdit: true, imageUrl: personal.avatarUrl ?? null, markName: personal.displayName || "Personal" },
    ...workspaces.map((w) => ({ id: w.id, name: w.name, kind: "workspace" as const, canEdit: w.canEdit !== false, imageUrl: w.logoUrl ?? null, markName: w.name })),
  ];
  return Promise.all(
    list.map(async (s) => {
      try {
        const sidebar = (await client.query(api.organization.sidebar as never, { scope: scopeOfSpace(s.id) } as never)) as { folders: SidebarFolder[] };
        return { ...s, folders: folderTree(sidebar.folders.filter((f) => !f.sealedName)) };
      } catch {
        return { ...s, folders: [] };
      }
    }),
  );
}
