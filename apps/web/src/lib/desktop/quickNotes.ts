// The Mac menu bar's quick notes (apps/native-kit FoleviQuickNotes): where a dot can be saved (Personal or a team
// workspace, and its folders) and the save itself, a new note made from the dot's Markdown with its images, in
// the chosen folder or the workspace's Drafts. The Mac asks through DesktopCapabilities; these are its pieces.
import type { WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { uploadFileNow } from "@/lib/sync/uploads";

/** A folder as the destination menu lists it: in sidebar order, each under its parent, `depth` 0 at the top. */
export interface QuickNoteFolder {
  id: string;
  name: string;
  depth: number;
}

export interface QuickNoteSpace {
  /** "personal" or the workspace's id. */
  id: string;
  name: string;
  kind: "personal" | "workspace";
  canEdit: boolean;
  folders: QuickNoteFolder[];
}

/** An image of the dot, as the Mac sends it: referred to in the Markdown as `![alt](ref)`. */
export interface QuickNoteImage {
  ref: string;
  mime: string;
  name: string;
  /** The bytes, base64. */
  data: string;
}

export interface QuickNoteSave {
  space: string;
  folderId: string | null;
  title: string;
  markdown: string;
  images: QuickNoteImage[];
}

export const scopeOfSpace = (space: string): WireScope => (space === "personal" ? { kind: "personal" } : { kind: "workspace", workspaceId: space });

type SidebarFolder = { id: string; name: string; parentFolderId: string | null; sealedName?: unknown };

/** The sidebar's folders as a tree in its order (each folder right after its parent), with depths; sealed names say "Locked folder". */
export function folderTree(folders: readonly SidebarFolder[]): QuickNoteFolder[] {
  const ids = new Set(folders.map((f) => f.id));
  const children = new Map<string | null, SidebarFolder[]>();
  for (const f of folders) {
    const parent = f.parentFolderId && ids.has(f.parentFolderId) ? f.parentFolderId : null;
    children.set(parent, [...(children.get(parent) ?? []), f]);
  }
  const out: QuickNoteFolder[] = [];
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

/** The checks the page makes before uploading anything (the server checks again). */
export function validateSave(s: unknown): QuickNoteSave | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  if (typeof o.space !== "string" || !o.space || typeof o.markdown !== "string" || typeof o.title !== "string") return null;
  if (o.folderId !== null && o.folderId !== undefined && typeof o.folderId !== "string") return null;
  const images = Array.isArray(o.images) ? o.images : [];
  const clean: QuickNoteImage[] = [];
  for (const raw of images.slice(0, 100)) {
    const i = raw as Record<string, unknown>;
    if (typeof i.ref !== "string" || typeof i.data !== "string" || typeof i.mime !== "string" || !/^image\//.test(i.mime)) return null;
    clean.push({ ref: i.ref, mime: i.mime, name: typeof i.name === "string" && i.name ? i.name : "Image", data: i.data });
  }
  return { space: o.space, folderId: (o.folderId as string | null | undefined) ?? null, title: o.title.slice(0, 200), markdown: o.markdown, images: clean };
}

function base64Blob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

type Client = Parameters<typeof uploadFileNow>[0];
type ImportText = (args: { scope: WireScope; filename: string; content: string; format: "markdown"; folderId?: string; imageMap?: Record<string, string> }) => Promise<{ document: { id: string } }>;

/** Uploads the images, then makes the note from the Markdown (its title the dot's first line). Returns the note's id. */
export async function saveQuickNote(client: Client, importText: ImportText, s: QuickNoteSave): Promise<string> {
  const scope = scopeOfSpace(s.space);
  const imageMap: Record<string, string> = {};
  for (const img of s.images) {
    if (!s.markdown.includes(`(${img.ref})`)) continue;
    imageMap[img.ref] = await uploadFileNow(client, { scope, blob: base64Blob(img.data, img.mime), filename: img.name, mimeType: img.mime, kind: "image" });
  }
  const made = await importText({ scope, filename: s.title || "Untitled", content: s.markdown, format: "markdown", ...(s.folderId ? { folderId: s.folderId } : {}), ...(Object.keys(imageMap).length ? { imageMap } : {}) });
  return made.document.id;
}

/** The spaces of this place a quick note can go to, each with its folders. */
export async function quickNoteSpaces(client: { query: (fn: never, args: never) => Promise<unknown> }, workspaces: readonly { id: string; name: string; canEdit?: boolean }[]): Promise<QuickNoteSpace[]> {
  const list: Omit<QuickNoteSpace, "folders">[] = [{ id: "personal", name: "Personal", kind: "personal", canEdit: true }, ...workspaces.map((w) => ({ id: w.id, name: w.name, kind: "workspace" as const, canEdit: w.canEdit !== false }))];
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
