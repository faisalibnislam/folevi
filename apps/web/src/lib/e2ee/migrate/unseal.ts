// Unsealing (docs/E2EE_DESIGN.md §6.9 "Unseal is the mirror image", WP8): a note's blocks, title, look and
// comments back to plaintext, its collections and found text recreated on the server from the records it
// had, then its versions, files and the space's folder and tag names. Only ever into a Standard space or out
// of a lock: the server refuses anything else (requireReadable).
import { validateWireBlock, type WireBlock } from "@folevi/editor-schema";
import { ctx as aad, importAead, openFileStream, sha256 } from "@folevi/local-store/e2ee";
import { api } from "@/lib/convex/api";
import type { LocalCollection, LocalCollectionRow, LocalDocument, LocalFileText } from "@/lib/local/store";
import type { LocalReader } from "@/lib/local/registry";
import { Sealer } from "../seal";
import type { FileMeta } from "../files";
import { call, checkStop, hex, loadNoteKeys, migrate, pending, unb64, type MigrateEnv, type PlainVersionContent } from "./env";
import { allBlocks, fileEntry, folderTree, getDocument, sidebarRows, upload, type PlainExtras, type VersionNames } from "./seal";

const PER_CALL = 200;

/**
 * A sealed block carries only `collapsed: true` (§4.6: the state travels as `sealed.collapsed`), so an open
 * toggle comes back without `props.collapsed`; blocks whose schema needs the field get `false` again.
 */
export function withCollapsed(block: WireBlock): WireBlock {
  const props = block.props as Record<string, unknown>;
  if ("collapsed" in props) return block;
  const fixed = { ...block, props: { ...props, collapsed: false } };
  const before = validateWireBlock(block).some((i) => i.path === "props.collapsed");
  return before && !validateWireBlock(fixed).some((i) => i.path === "props.collapsed") ? fixed : block;
}

/** What e2ee.pull.document serves of a sealed note's records. */
interface PulledRecords {
  records: { kind: string; recordId: string; keyVersion: number; sealed: ArrayBuffer; rev: number }[];
}

export interface UnsealOptions {
  visited?: Set<string>;
  /** The replica of the space (a collection's rows are other notes: their values are in those notes' sealed meta). */
  store?: LocalReader | null;
}

/** Opens a note's sealed records (found text and hosted collections). */
async function openRecords(env: MigrateEnv, documentId: string): Promise<{ collections: LocalCollection[]; fileTexts: LocalFileText[] }> {
  const pulled = (await call.query(env, api.e2ee.pull.document, { documentId })) as PulledRecords | null;
  const collections: LocalCollection[] = [];
  const fileTexts: LocalFileText[] = [];
  for (const r of pulled?.records ?? []) {
    if (r.kind !== "collection" && r.kind !== "fileText") continue;
    const value = await env.sealer.openRecordValue({ documentId }, env.space.scopeId, r.kind, r.recordId, r.sealed);
    if (r.kind === "collection") collections.push({ ...(value as LocalCollection), id: r.recordId, documentId });
    else fileTexts.push({ ...(value as LocalFileText), id: r.recordId, documentId });
  }
  return { collections, fileTexts };
}

/** The server's PlainCollectionInput for finishUnseal, rows from the replica (each row note's sealed meta). */
export function plainCollection(c: LocalCollection, rows: { documentId: string; row: LocalCollectionRow }[]) {
  return {
    id: c.id,
    name: c.name,
    properties: Object.values(c.properties)
      .filter((p) => p.deletedAt === null)
      .map((p) => ({ id: p.id, name: p.name, type: p.type, ...(p.options?.length ? { options: p.options } : {}), ...(p.formula ? { formula: p.formula } : {}), ...(p.numberFormat ? { numberFormat: p.numberFormat } : {}), rank: p.rank })),
    views: Object.values(c.views)
      .filter((v) => v.deletedAt === null)
      .map((v) => ({ id: v.id, name: v.name, type: v.type, config: v.config, rank: v.rank })),
    rows: rows
      .filter((r) => r.row.collectionId === c.id && r.row.deletedAt === null)
      .map((r) => ({ id: r.documentId, documentId: r.documentId, rank: r.row.rank, values: Object.entries(r.row.values).map(([propertyId, value]) => ({ propertyId, value })) })),
  };
}

function plainFileText(t: LocalFileText) {
  return { blockId: t.blockId, ...(t.fileId ? { fileId: t.fileId } : {}), source: t.source, by: t.by, text: t.text, ...(t.pageStarts ? { pageStarts: t.pageStarts } : {}), hash: t.hash };
}

/**
 * Unseals one note. A collection row's host goes first (finishUnseal of the host recreates the server's tables
 * from the rows' values, which only the still-sealed row notes hold).
 */
export async function unsealDocument(env: MigrateEnv, documentId: string, o: UnsealOptions = {}): Promise<boolean> {
  const visited = o.visited ?? new Set<string>();
  if (visited.has(documentId)) return false;
  visited.add(documentId);
  const got = await getDocument(env, documentId);
  if (!got?.document.sealed) return false;
  await loadNoteKeys(env, documentId);
  const fields = await env.sealer.openDocumentFields(documentId, got.document.sealed);

  if (fields.row && o.store) {
    const collection = await o.store.get("collections", fields.row.collectionId);
    if (collection && collection.documentId !== documentId && !visited.has(collection.documentId)) {
      await unsealDocument(env, collection.documentId, o);
      const again = await getDocument(env, documentId);
      if (!again?.document.sealed) return true;
    }
  }

  await call.mutation(env, migrate.beginDocument as never, { documentId, deviceId: env.deviceId });

  for (let round = 0; round < 4; round++) {
    const rows = (await allBlocks(env, documentId)).filter((r) => r.block.sealed);
    if (!rows.length) break;
    const opened: { blockId: string; revision: number; block: WireBlock }[] = [];
    for (const r of rows) {
      const b = await env.sealer.openBlock(documentId, { id: r.block.id, parentId: r.block.parentId, rank: r.block.rank, sealed: r.block.sealed! });
      const { revision: _revision, ...rest } = b;
      void _revision;
      const block = withCollapsed(rest as WireBlock);
      const issues = validateWireBlock(block);
      // Which field, never its content.
      if (issues.length) throw new Error(`A block of this note isn't valid after decrypting it (${issues.map((i) => i.path).join(", ")}).`);
      opened.push({ blockId: r.block.id, revision: r.revision, block: block as WireBlock });
    }
    let skipped = 0;
    for (let i = 0; i < opened.length; i += PER_CALL) {
      const r = (await call.mutation(env, migrate.unsealBlocks as never, { documentId, deviceId: env.deviceId, blocks: opened.slice(i, i + PER_CALL) })) as { skipped?: string[] } | null;
      skipped += r?.skipped?.length ?? 0;
    }
    if (!skipped) break;
  }

  await call.mutation(env, migrate.unsealDocumentFields as never, {
    documentId,
    deviceId: env.deviceId,
    title: fields.title,
    icon: fields.icon,
    cover: fields.cover,
    style: fields.style,
    ...(fields.templateKey ? { templateKey: fields.templateKey } : {}),
  });

  const extras = (await call.query(env, migrate.plainExtras as never, { documentId })) as PlainExtras;
  const comments = [];
  for (const c of extras.comments) if (c.sealedBody) comments.push({ commentId: c.commentId, body: await env.sealer.openComment(documentId, c.commentId, c.sealedBody.c) });
  for (let i = 0; i < comments.length; i += PER_CALL) await call.mutation(env, migrate.unsealComments as never, { documentId, deviceId: env.deviceId, comments: comments.slice(i, i + PER_CALL) });

  const { collections, fileTexts } = await openRecords(env, documentId);
  let rows: { documentId: string; row: LocalCollectionRow }[] = [];
  if (collections.length && o.store) {
    const ids = new Set(collections.map((c) => c.id));
    rows = ((await o.store.list("documents")) as LocalDocument[]).filter((d) => d.row && ids.has(d.row.collectionId)).map((d) => ({ documentId: d.id, row: d.row! }));
  }
  await call.mutation(env, migrate.finishUnseal as never, {
    documentId,
    deviceId: env.deviceId,
    collections: collections.filter((c) => c.deletedAt === null).map((c) => plainCollection(c, rows)),
    fileTexts: fileTexts.map(plainFileText),
  });
  return true;
}

/** Puts one version back in plaintext (needs WP3's e2ee.migrate.unsealSnapshot, env.ts `pending`). */
export async function unsealSnapshot(env: MigrateEnv, snapshotId: string, documentId: string, names: VersionNames): Promise<boolean> {
  await loadNoteKeys(env, documentId);
  const got = (await call.query(env, api.documents.snapshotContent, { snapshotId })) as { content: string | null } | null;
  if (!got?.content) throw new Error("This version's content couldn't be read.");
  const parsed = JSON.parse(got.content) as {
    e2ee?: 1;
    title: { c: string; k: number };
    appearance: { c: string; k: number };
    blocks: { id: string; parentId: string | null; rank: string; c: string; k: number; mac?: string; collapsed?: true }[];
  };
  if (parsed.e2ee !== 1) return false;
  const title = await env.sealer.openTitle(documentId, unb64(parsed.title.c).buffer as ArrayBuffer);
  const look = await env.sealer.openAppearance(documentId, unb64(parsed.appearance.c).buffer as ArrayBuffer);
  const blocks: WireBlock[] = [];
  for (const b of parsed.blocks) {
    const opened = await env.sealer.openBlock(documentId, { id: b.id, parentId: b.parentId, rank: b.rank, sealed: { c: unb64(b.c).buffer as ArrayBuffer, mac: b.mac ?? "", k: b.k, ...(b.collapsed ? { collapsed: true } : {}) } });
    const { revision: _revision, ...plain } = opened;
    void _revision;
    blocks.push(plain as WireBlock);
  }
  const entry = (await names.of(documentId)).get(snapshotId);
  const name = entry?.sealedName ? await env.sealer.openVersionName(documentId, snapshotId, entry.sealedName.c) : null;
  const content: PlainVersionContent = { title, icon: look.icon, cover: look.cover, style: look.style, blocks };
  await call.mutation(env, pending.unsealSnapshot, { snapshotId, content, name });
  return true;
}

/** Puts one attachment's plaintext back (a plain upload, then e2ee.files.replaceBlob with `sealed: null`). */
export async function unsealFile(env: MigrateEnv, fileId: string, documentId: string): Promise<boolean> {
  await loadNoteKeys(env, documentId);
  const entry = await fileEntry(env, fileId);
  if (!entry?.sealed) return false;
  const res = await (env.fetch ?? fetch)(entry.url);
  if (!res.ok) throw new Error(`The file couldn't be downloaded (${res.status}).`);
  const envelope = new Uint8Array(await res.arrayBuffer());
  const raw = await env.sealer.openFileKey(documentId, fileId, entry.sealed.key);
  let plain: Uint8Array | null = null;
  try {
    const meta = (await Sealer.openFileMeta(raw, documentId, fileId, entry.sealed.meta)) as FileMeta;
    plain = await openFileStream(await importAead(raw.slice()), aad.file((meta as FileMeta & { sourceFileId?: string }).sourceFileId ?? fileId), envelope);
    const kind = meta.mime.startsWith("image/") ? "image" : meta.mime.startsWith("audio/") || meta.mime.startsWith("video/") ? "audio" : "file";
    const target = (await call.mutation(env, api.files.generateUploadUrl, { documentId, filename: meta.name, size: plain.length, mimeType: meta.mime, kind })) as { uploadUrl: string; intentId: string };
    const storageId = await upload(env, target.uploadUrl, plain, meta.mime || "application/octet-stream");
    await call.action(env, api.e2ee.files.replaceBlob, {
      intentId: target.intentId,
      fileId,
      storageId,
      size: plain.length,
      sha256: hex(sha256(plain)),
      sealed: null,
      plain: { filename: meta.name, mimeType: meta.mime, ...(meta.width ? { width: meta.width } : {}), ...(meta.height ? { height: meta.height } : {}) },
    });
    return true;
  } finally {
    raw.fill(0);
    plain?.fill(0);
  }
}

/** Cleanup of an unseal: folder (and for a space, tag) names back in plaintext (needs WP3's unsealNames). */
export async function unsealNames(env: MigrateEnv, job: { scopeOf: "space" | "folder" | "document"; rootId: string | null }): Promise<void> {
  if (job.scopeOf === "document") return;
  const { folders, tags } = await sidebarRows(env);
  const only = job.scopeOf === "folder" && job.rootId ? folderTree(folders, job.rootId) : null;
  const plainFolders: { folderId: string; name: string }[] = [];
  for (const f of folders) {
    if (!f.sealedName || (only && !only.has(f.id))) continue;
    checkStop(env);
    plainFolders.push({ folderId: f.id, name: await env.sealer.openFolderName(env.space.scope, env.space.scopeId, f.id, f.sealedName.c) });
  }
  const plainTags: { tagId: string; name: string }[] = [];
  if (!only) for (const t of tags) if (t.sealedName) plainTags.push({ tagId: t.id, name: await env.sealer.openTagName(env.space.scope, env.space.scopeId, t.id, t.sealedName.c) });
  if (!plainFolders.length && !plainTags.length) return;
  await call.mutation(env, pending.unsealNames, { scope: env.space.scope, folders: plainFolders, tags: plainTags });
}
