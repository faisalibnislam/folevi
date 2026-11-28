// The Mac's menu bar note (apps/native-kit FoleviMenuBarNote, owner decisions 2026-11-28): Home's quick note under
// the menu bar. One plain text box; Save makes a note of it (its first line the title, as Home's CaptureField does)
// in Drafts or the folder picked, with the screenshots taken into it; Add as a task adds it to Tasks. The panel asks
// a quiet page of the place (`/float/menu?panel=1`) for these and for where a note can go.
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

/** The menu bar's panel page: true for `/float/...?panel=1`. */
export function inMenuBarPanel(search: URLSearchParams): boolean {
  return search.get("panel") === "1";
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

/** A screenshot the panel took, sent with the note. */
export interface MenuNoteImage {
  mime: string;
  name: string;
  /** The bytes, base64. */
  data: string;
}

export interface MenuNoteSave {
  space: string;
  folderId: string | null;
  text: string;
  images: MenuNoteImage[];
}

/** What the Mac sends for a save, checked (null when it isn't one). */
export function validateMenuNote(raw: unknown): MenuNoteSave | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.space !== "string" || !o.space || typeof o.text !== "string") return null;
  if (o.folderId !== null && o.folderId !== undefined && typeof o.folderId !== "string") return null;
  const images: MenuNoteImage[] = [];
  for (const raw of (Array.isArray(o.images) ? o.images : []).slice(0, 20)) {
    const i = raw as Record<string, unknown>;
    if (typeof i.data !== "string" || typeof i.mime !== "string" || !/^image\/(png|jpeg|gif|webp)$/.test(i.mime)) return null;
    images.push({ mime: i.mime, name: typeof i.name === "string" && i.name ? i.name : "Screenshot", data: i.data });
  }
  if (!o.text.trim() && !images.length) return null;
  return { space: o.space, folderId: (o.folderId as string | null | undefined) ?? null, text: o.text, images };
}

/**
 * The note's title and content, as Home makes them (noteFromText: the first line the title, each other line a
 * paragraph). With screenshots it's Markdown: the lines as paragraphs, then each picture (`menu-note-image-N`, which
 * `imageMap` turns into the uploaded file).
 */
export function menuNoteContent(text: string, images: number, fromText: (t: string) => { title: string; body: string }): { title: string; content: string; format: "text" | "markdown" } {
  const { title, body } = text.trim() ? fromText(text) : { title: "Screenshot", body: "" };
  const paragraphs = body.split(/\n+/).filter((l) => l.trim());
  if (!images) return { title, content: paragraphs.join("\n\n"), format: "text" };
  // Plain lines in Markdown: characters Markdown would read as formatting are kept as typed.
  const escaped = paragraphs.map((l) => l.replace(/([\\`*_[\]#<>!|])/g, "\\$1").replace(/^(\s*)([-+]|\d+[.)])(\s)/, "$1\\$2$3"));
  const pictures = Array.from({ length: images }, (_, i) => `![](menu-note-image-${i + 1})`);
  return { title, content: [...escaped, ...pictures].join("\n\n"), format: "markdown" };
}
