// Reading a library or an account for a move (docs/LOCAL_MODE_PLAN.md §6): the same public functions on both
// backends (the Convex client, or a LocalClient over a library), so one reader serves both directions. Only
// the bytes of attachments come another way: from the library's own store, or through files.urls.
import type { WireBlock, WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import type { LocalStore } from "@/lib/local/store";
import type { MigrationClient, MigrationSource, SourceCollection, SourceFile, SourceNote, SourceVersion } from "./types";

const PERSONAL: WireScope = { kind: "personal" };
const PAGE = 100;

export interface ClientSourceOptions {
  /** Personal, or a workspace being copied as a folder. */
  scope?: WireScope;
  /** An attachment's bytes and what's known about them. */
  readFile: (fileId: string, documentId: string, kind: SourceFile["kind"]) => Promise<SourceFile | null>;
}

/** A version's id as both backends take it: a library names its versions `<note>~<id>`. */
function plainVersionId(id: string): string {
  const at = id.lastIndexOf("~");
  return at >= 0 ? id.slice(at + 1) : id;
}

export function clientSource(client: MigrationClient, opts: ClientSourceOptions): MigrationSource {
  const scope = opts.scope ?? PERSONAL;
  return {
    async profileId() {
      const me = await client.query(api.users.me, {});
      if (me.state !== "ready") throw new Error("Sign in again to go on.");
      return me.profile.id;
    },
    async organization() {
      const index = await client.query(api.organization.index, { scope });
      return {
        folders: index.folders.map((f) => ({ id: f.id, name: f.name, color: f.color, parentFolderId: f.parentFolderId, rank: f.rank })),
        tags: index.tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
      };
    },
    async notes() {
      const out: SourceNote[] = [];
      let cursor: string | null = null;
      for (let pages = 0; pages < 10_000; pages++) {
        const r: { page: SourceNote[]; isDone: boolean; continueCursor: string } = await client.query(api.migration.documents, { scope, paginationOpts: { numItems: PAGE, cursor } });
        out.push(...r.page);
        if (r.isDone) break;
        cursor = r.continueCursor;
      }
      // A page can list a note again when it changed while being read: keep the last.
      return [...new Map(out.map((n) => [n.id, n])).values()];
    },
    async blocks(documentId) {
      const r = await client.query(api.blocks.list, { documentId });
      return (r?.blocks ?? []) as WireBlock[];
    },
    async collection(collectionId) {
      const c = await client.query(api.collections.get, { collectionId }).catch(() => null);
      if (!c) return null;
      return {
        id: c.id,
        name: c.name,
        hostDocumentId: c.hostDocumentId,
        properties: c.properties.map((p) => ({ id: p.id, name: p.name, type: p.type, options: p.options as SourceCollection["properties"][number]["options"], formula: p.formula ?? null, numberFormat: p.numberFormat ?? null })),
        views: c.views.map((vw) => ({ id: vw.id, name: vw.name, type: vw.type, config: vw.config })),
        rows: c.rows.map((r) => ({ id: r.id, documentId: r.documentId, rank: r.rank, values: r.values as Record<string, unknown> })),
      };
    },
    file: opts.readFile,
    async fileTexts(documentId) {
      return await client.query(api.migration.fileTexts, { documentId });
    },
    async versions(documentId) {
      const list = await client.query(api.documents.versions, { documentId });
      const out: SourceVersion[] = [];
      // Oldest first, so they arrive in the order they were made.
      for (const v of [...list.versions].sort((a, b) => a.createdAt - b.createdAt)) {
        const content = await client.query(api.documents.snapshotContent, { snapshotId: v.id });
        if (!content?.content) continue;
        try {
          const parsed = JSON.parse(content.content) as { title?: string; icon?: string | null; style?: SourceNote["style"]; blocks?: WireBlock[] };
          if (!Array.isArray(parsed.blocks)) continue;
          out.push({ id: plainVersionId(v.id), name: v.name, title: parsed.title ?? v.title, icon: parsed.icon ?? null, ...(parsed.style ? { style: parsed.style } : {}), blocks: parsed.blocks, createdAt: v.createdAt });
        } catch {
          // A version that can't be read stays behind.
        }
      }
      return out;
    },
  };
}

/** Attachments of a library: straight from its store (bytes, name and type as they were put there). */
export function libraryFiles(store: Pick<LocalStore, "get">): ClientSourceOptions["readFile"] {
  return async (fileId, _documentId, kind) => {
    const f = await store.get("files", fileId);
    if (!f) return null;
    return { id: f.id, name: f.name, mimeType: f.mimeType, kind, size: f.size, sha256: f.sha256, blob: f.blob };
  };
}

/** Attachments of an account: through their signed links (files.urls), fetched with `fetchBytes`. */
export function accountFiles(client: MigrationClient, fetchBytes: (url: string) => Promise<Blob> = defaultFetch): ClientSourceOptions["readFile"] {
  return async (fileId, _documentId, kind) => {
    const urls = await client.query(api.files.urls, { fileIds: [fileId], now: Date.now() });
    const meta = urls[fileId];
    if (!meta) return null;
    const blob = await fetchBytes(meta.url);
    return { id: fileId, name: meta.filename, mimeType: meta.mimeType, kind, size: blob.size, sha256: null, blob: blob.type ? blob : new Blob([blob], { type: meta.mimeType }) };
  };
}

async function defaultFetch(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`A file couldn't be downloaded (${res.status}).`);
  return await res.blob();
}
