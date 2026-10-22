// Sealing one note, one version, one file, and a space's folder and tag names (docs/E2EE_DESIGN.md §6.9,
// WP8). Each step reads plaintext through the server's normal queries (documents.get, e2ee.migrate.plainBlocks
// and plainExtras, documents.snapshotContent, files.urls) and hands ciphertext back through e2ee.migrate. The
// note switches atomically in `finishDocument`, so a tab killed halfway leaves the note plain and held for at
// most two minutes; the next device (or this one) starts that note again.
//
// Nothing here logs content or keys; key bytes are zeroed once imported.
import { blocksFileIds, type WireBlock } from "@folevi/editor-schema";
import { ctx as aad, importAead, sealFileStream, sha256, toWireBytes } from "@folevi/local-store/e2ee";
import { api } from "@/lib/convex/api";
import type { LocalCollection, LocalCollectionProperty, LocalCollectionView, LocalFileText, LocalStudyReview } from "@/lib/local/store";
import { Sealer, type DocumentMeta } from "../seal";
import { b64, call, checkStop, hex, loadNoteKeys, migrate, type MigrateEnv } from "./env";
import { moveMemories } from "./memories";

/** e2ee.migrate.sealBlocks takes at most 200 blocks or 4 MiB a call; this stays under both. */
const BLOCKS_PER_CALL = 200;
const BYTES_PER_CALL = 3.5 * 1024 * 1024;
const RECORDS_PER_FINISH = 200;
const COMMENTS_PER_CALL = 200;

export interface PlainBlockRow {
  block: WireBlock & { sealed?: { c: ArrayBuffer; mac: string; k: number; collapsed?: true; syncedSource?: string; mentions?: string[] } };
  revision: number;
  deleted: boolean;
}

/** Every block row of a note (live and deleted), as e2ee.migrate.plainBlocks pages them. */
export async function allBlocks(env: Pick<MigrateEnv, "server">, documentId: string): Promise<PlainBlockRow[]> {
  const out: PlainBlockRow[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 200; i++) {
    const page = (await call.query(env, migrate.plainBlocks as never, { documentId, cursor })) as { blocks: PlainBlockRow[]; cursor: string; isDone: boolean };
    out.push(...page.blocks);
    if (page.isDone) return out;
    cursor = page.cursor;
  }
  throw new Error("This note has too many blocks to convert.");
}

/** A block as it is stored: sealed already (a lapsed lease sealed part of the note), or plaintext. */
export function isSealedRow(r: PlainBlockRow): boolean {
  return r.block.sealed !== undefined || r.block.type === "sealed";
}

/** What e2ee.migrate.plainExtras serves. */
export interface PlainExtras {
  fileTexts: { blockId: string; fileId: string | null; source: LocalFileText["source"]; by: LocalFileText["by"]; text: string; pageStarts: number[] | null; hash: string }[];
  collections: {
    id: string;
    name: string;
    properties: { id: string; name: string; type: LocalCollectionProperty["type"]; options: LocalCollectionProperty["options"]; formula?: string; numberFormat?: LocalCollectionProperty["numberFormat"]; rank: string }[];
    views: { id: string; name: string; type: LocalCollectionView["type"]; config: LocalCollectionView["config"]; rank: string }[];
    rows: { id: string; documentId: string; rank: string; values: { propertyId: string; value: unknown }[] }[];
  }[];
  comments: { commentId: string; threadId: string; body?: unknown[]; sealedBody?: { c: ArrayBuffer; k: number }; deleted: boolean }[];
  /** The caller's own study schedules for the note (other people carry theirs, features/study.ts). */
  studyReviews?: (Omit<LocalStudyReview, "documentId">)[];
}

/** documents.get's answer, the parts the migration reads. */
interface GotDocument {
  document: {
    id: string;
    kind: string;
    title: string;
    icon: string | null;
    cover: unknown;
    style: unknown;
    sealed?: { title: { c: ArrayBuffer; k: number; mac: string }; appearance: { c: ArrayBuffer; k: number }; meta?: { c: ArrayBuffer; k: number } | null };
  };
}

export async function getDocument(env: Pick<MigrateEnv, "server">, documentId: string): Promise<GotDocument | null> {
  return ((await call.query(env, api.documents.get, { documentId })) as GotDocument | null) ?? null;
}

/** A collection row's place and values: what its note's sealed meta holds (§4.6 SealedDocumentCreate.meta). */
export type RowMeta = NonNullable<DocumentMeta["row"]>;

export interface SealOptions {
  /** Notes handled in this run (a host and its rows call each other). */
  visited?: Set<string>;
  /** The note is a collection row: its row, read from its host before the host's tables go. */
  row?: RowMeta;
}

/**
 * Seals one note (§6.9 steps 1 to 4). A collection's rows are sealed before the note hosting it, each with its
 * row in its sealed meta, because sealing the host deletes the server's collection tables. A row reached on
 * its own seals its host first (which seals the row). Returns false when there was nothing to do.
 */
export async function sealDocument(env: MigrateEnv, documentId: string, o: SealOptions = {}): Promise<boolean> {
  const visited = o.visited ?? new Set<string>();
  if (visited.has(documentId)) return false;
  visited.add(documentId);
  const got = await getDocument(env, documentId);
  if (!got || got.document.sealed) return false;

  if (!o.row && got.document.kind === "collectionRow") {
    const r = (await call.query(env, api.collections.rowForDocument, { documentId })) as { collection: { hostDocumentId: string | null } } | null;
    const host = r?.collection.hostDocumentId ?? null;
    if (host && !visited.has(host)) {
      await sealDocument(env, host, { visited });
      const again = await getDocument(env, documentId);
      if (!again || again.document.sealed) return true;
    }
  }

  const extras = (await call.query(env, migrate.plainExtras as never, { documentId })) as PlainExtras;
  for (const c of extras.collections) {
    for (const row of c.rows) {
      if (row.documentId === documentId || visited.has(row.documentId)) continue;
      checkStop(env);
      const values: Record<string, unknown> = {};
      for (const v of row.values) values[v.propertyId] = v.value;
      await sealDocument(env, row.documentId, { visited, row: { collectionId: c.id, rank: row.rank, values } });
    }
  }

  // The note's key: the one the server already holds (a lapsed lease stored it), else a new one, sent with begin.
  let noteKey: Record<string, unknown> | undefined;
  if ((await loadNoteKeys(env, documentId)) === 0) {
    const nk = await env.keyring.newNoteKey(documentId, env.space.scope);
    noteKey = { documentId, version: nk.version, wrappedBy: "space", spaceVersion: nk.spaceVersion, wrapped: toWireBytes(nk.wrapped) };
  }
  await call.mutation(env, migrate.beginDocument as never, { documentId, deviceId: env.deviceId, ...(noteKey ? { noteKey } : {}) });

  const rows = await sealBlocksOf(env, documentId);

  // Fields as they are now that the note is held (nobody else can change them until it's done).
  const now = (await getDocument(env, documentId)) ?? got;
  const d = now.document;
  const title = await env.sealer.sealTitle(documentId, d.title ?? "");
  const appearance = await env.sealer.sealAppearance(documentId, { icon: d.icon ?? null, cover: d.cover, style: d.style });
  const meta = o.row ? await env.sealer.sealMeta(documentId, { row: o.row }) : undefined;
  await call.mutation(env, migrate.sealDocumentFields as never, {
    documentId,
    deviceId: env.deviceId,
    sealedTitle: { c: title.c, mac: title.mac },
    sealedAppearance: appearance,
    ...(meta ? { sealedMeta: meta } : {}),
    fileIds: await fileIdsOf(env, documentId, rows, d.cover),
  });

  const comments = extras.comments.filter((c) => Array.isArray(c.body) && c.sealedBody === undefined);
  for (let i = 0; i < comments.length; i += COMMENTS_PER_CALL) {
    const batch = [];
    for (const c of comments.slice(i, i + COMMENTS_PER_CALL)) batch.push({ commentId: c.commentId, sealedBody: (await env.sealer.sealComment(documentId, c.commentId, c.body!)).c });
    await call.mutation(env, migrate.sealComments as never, { documentId, deviceId: env.deviceId, comments: batch });
  }

  const records = await recordsOf(env, documentId, extras);
  await call.mutation(env, migrate.finishDocument as never, { documentId, deviceId: env.deviceId, records: records.slice(0, RECORDS_PER_FINISH) });
  // Past what one finish takes (a note with very many found texts): the rest as ordinary sealed records.
  for (const r of records.slice(RECORDS_PER_FINISH)) {
    await call.mutation(env, api.e2ee.content.putRecord, { scope: env.space.scope, kind: r.kind, recordId: r.recordId, documentId, sealed: r.sealed, keyVersion: r.keyVersion, baseRev: 0 });
  }
  return true;
}

/** Seals every block row not sealed yet, again for rows that changed under it (compare-and-set on revision). */
async function sealBlocksOf(env: MigrateEnv, documentId: string): Promise<PlainBlockRow[]> {
  for (let round = 0; round < 4; round++) {
    const rows = await allBlocks(env, documentId);
    const todo = rows.filter((r) => !isSealedRow(r));
    if (!todo.length) return rows;
    let skipped = 0;
    let batch: Record<string, unknown>[] = [];
    let bytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      const r = (await call.mutation(env, migrate.sealBlocks as never, { documentId, deviceId: env.deviceId, blocks: batch })) as { skipped?: string[] } | null;
      skipped += r?.skipped?.length ?? 0;
      batch = [];
      bytes = 0;
    };
    for (const r of todo) {
      const { revision: _revision, ...plain } = r.block;
      void _revision;
      const s = (await env.sealer.sealBlock(documentId, plain as WireBlock)).sealed;
      const size = s.c.byteLength;
      if (batch.length >= BLOCKS_PER_CALL || bytes + size > BYTES_PER_CALL) await flush();
      batch.push({
        blockId: r.block.id,
        revision: r.revision,
        sealed: { c: s.c, mac: s.mac, k: s.k, ...(s.collapsed ? { collapsed: true } : {}) },
        ...(s.syncedSource ? { syncedSource: s.syncedSource } : {}),
        ...(s.mentions?.length ? { mentionIds: s.mentions } : {}),
      });
      bytes += size;
    }
    await flush();
    if (!skipped) return await allBlocks(env, documentId);
  }
  throw new Error("This note kept changing while it was being encrypted.");
}

/** The files a note references (its live blocks' and its cover's) that exist in the space. */
async function fileIdsOf(env: MigrateEnv, documentId: string, rows: PlainBlockRow[], cover: unknown): Promise<string[]> {
  const live: WireBlock[] = [];
  for (const r of rows) {
    if (r.deleted) continue;
    if (!r.block.sealed) live.push(r.block);
    else live.push(await env.sealer.openBlockOrUnreadable(documentId, { id: r.block.id, parentId: r.block.parentId, rank: r.block.rank, sealed: r.block.sealed }));
  }
  const ids = new Set(blocksFileIds(live));
  const c = cover as { kind?: string; value?: unknown } | null;
  if (c?.kind === "image" && typeof c.value === "string") ids.add(c.value);
  if (!ids.size) return [];
  const known: string[] = [];
  const list = [...ids];
  for (let i = 0; i < list.length && i < 500; i += 200) {
    const urls = (await call.query(env, api.files.urls, { fileIds: list.slice(i, i + 200), now: Date.now() })) as Record<string, unknown>;
    for (const id of list.slice(i, i + 200)) if (urls[id]) known.push(id);
  }
  return known;
}

/** A sealed record for finishDocument: found text and hosted collections, sealed with the note's key. */
export interface SealedRecordInput {
  kind: "collection" | "fileText" | "studyReview";
  recordId: string;
  sealed: ArrayBuffer;
  keyVersion: number;
}

/** The found-text record id local mode uses (lib/local/functions/fileText.ts). */
export const fileTextRecordId = (t: { fileId: string | null; blockId: string }) => t.fileId ?? `hw:${t.blockId}`;

/** A server collection (plainExtras) as the replica's LocalCollection. */
export function localCollection(c: PlainExtras["collections"][number], documentId: string, ordinal: number, now: number): LocalCollection {
  const properties: Record<string, LocalCollectionProperty> = {};
  for (const p of c.properties) properties[p.id] = { id: p.id, name: p.name, type: p.type, options: p.options ?? [], formula: p.formula ?? null, numberFormat: p.numberFormat ?? null, rank: p.rank, createdAt: now, deletedAt: null };
  const views: Record<string, LocalCollectionView> = {};
  for (const v of c.views) views[v.id] = { id: v.id, name: v.name, type: v.type, config: v.config, rank: v.rank, createdAt: now, deletedAt: null };
  return { id: c.id, documentId, name: c.name, createdAt: now, ordinal, updatedAt: now, deletedAt: null, seq: 0, properties, views };
}

async function recordsOf(env: MigrateEnv, documentId: string, extras: PlainExtras): Promise<SealedRecordInput[]> {
  const out: SealedRecordInput[] = [];
  const now = Date.now();
  for (const t of extras.fileTexts) {
    const recordId = fileTextRecordId(t);
    const value: LocalFileText = { id: recordId, documentId, blockId: t.blockId, fileId: t.fileId, source: t.source, by: t.by, text: t.text, pageStarts: t.pageStarts, hash: t.hash, createdAt: now, updatedAt: now };
    const s = await env.sealer.sealRecordValue({ documentId }, env.space.scopeId, "fileText", recordId, value);
    out.push({ kind: "fileText", recordId, sealed: s.sealed, keyVersion: s.keyVersion });
  }
  for (const [i, c] of extras.collections.entries()) {
    const s = await env.sealer.sealRecordValue({ documentId }, env.space.scopeId, "collection", c.id, localCollection(c, documentId, i + 1, now));
    out.push({ kind: "collection", recordId: c.id, sealed: s.sealed, keyVersion: s.keyVersion });
  }
  // This person's study schedules, one record per card (the replica's studyReviews rows, keyed by block).
  for (const r of extras.studyReviews ?? []) out.push(await studyRecord(env, documentId, r));
  return out;
}

/** One study schedule as a sealed `studyReview` record (record id = the card's block id, as local mode keys it). */
export async function studyRecord(env: Pick<MigrateEnv, "sealer" | "space">, documentId: string, row: Omit<LocalStudyReview, "documentId">): Promise<{ kind: "studyReview"; recordId: string; sealed: ArrayBuffer; keyVersion: number }> {
  const value: LocalStudyReview = { ...row, documentId };
  const s = await env.sealer.sealRecordValue({ documentId }, env.space.scopeId, "studyReview", row.blockId, value);
  return { kind: "studyReview", recordId: row.blockId, sealed: s.sealed, keyVersion: s.keyVersion };
}

// ---- history -------------------------------------------------------------------------------------------

/** A note's version names, once per note per run (documents.versions). */
export class VersionNames {
  private byDoc = new Map<string, Promise<Map<string, { name: string | null; sealedName: { c: ArrayBuffer; k: number } | null }>>>();
  constructor(private readonly env: Pick<MigrateEnv, "server">) {}
  of(documentId: string) {
    let p = this.byDoc.get(documentId);
    if (!p) {
      p = (async () => {
        const r = (await call.query(this.env, api.documents.versions, { documentId })) as { versions: { id: string; name: string | null; sealedName?: { c: ArrayBuffer; k: number } | null }[] } | null;
        return new Map((r?.versions ?? []).map((v) => [v.id, { name: v.name, sealedName: v.sealedName ?? null }]));
      })();
      this.byDoc.set(documentId, p);
    }
    return p;
  }
}

/** A plain version's content as SealedVersionContent (§5.4), sealed with the note's newest key. */
export async function sealVersionContent(sealer: Sealer, documentId: string, content: { title: string; icon: string | null; cover?: unknown; style?: unknown; blocks: WireBlock[] }) {
  const title = await sealer.sealTitle(documentId, content.title ?? "");
  const appearance = await sealer.sealAppearance(documentId, { icon: content.icon ?? null, cover: content.cover, style: content.style });
  const blocks = [];
  for (const b of content.blocks) {
    const { revision: _revision, ...plain } = b;
    void _revision;
    const s = (await sealer.sealBlock(documentId, plain as WireBlock)).sealed;
    blocks.push({ id: b.id, parentId: b.parentId, rank: b.rank, c: b64(s.c), k: s.k, mac: s.mac, ...(s.collapsed ? { collapsed: true as const } : {}) });
  }
  return { e2ee: 1 as const, title: { c: b64(title.c), k: title.k, mac: title.mac }, appearance: { c: b64(appearance), k: title.k }, blocks };
}

/** Seals one version (§6.9 step 5): its content and, when it has one, its name. */
export async function sealSnapshot(env: MigrateEnv, snapshotId: string, documentId: string, names: VersionNames): Promise<boolean> {
  await loadNoteKeys(env, documentId);
  const got = (await call.query(env, api.documents.snapshotContent, { snapshotId })) as { content: string | null } | null;
  if (!got?.content) throw new Error("This version's content couldn't be read.");
  const parsed = JSON.parse(got.content) as { e2ee?: 1; title: string; icon: string | null; cover?: unknown; style?: unknown; blocks: WireBlock[] };
  if (parsed.e2ee === 1) return false;
  const content = await sealVersionContent(env.sealer, documentId, parsed);
  const name = (await names.of(documentId)).get(snapshotId)?.name ?? null;
  const sealedName = name && name !== "\u0001sealed" ? (await env.sealer.sealVersionName(documentId, snapshotId, name)).c : undefined;
  await call.mutation(env, migrate.sealSnapshot as never, { snapshotId, content, ...(sealedName ? { sealedName } : {}) });
  return true;
}

// ---- files ---------------------------------------------------------------------------------------------

interface FileUrlEntry {
  url: string;
  mimeType: string;
  filename: string;
  size: number;
  width: number | null;
  height: number | null;
  palette: unknown;
  sealed?: { key: ArrayBuffer; meta: ArrayBuffer; k: number; plainSize: number };
}

export async function fileEntry(env: Pick<MigrateEnv, "server">, fileId: string): Promise<FileUrlEntry | null> {
  const urls = (await call.query(env, api.files.urls, { fileIds: [fileId], now: Date.now() })) as Record<string, FileUrlEntry | undefined>;
  return urls[fileId] ?? null;
}

/** The sealed upload kind for a file (the limits e2ee.files.generateUploadUrl checks). */
export function sealedKind(mime: string): "image" | "file" | "audio" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/") || mime.startsWith("video/")) return "audio";
  return "file";
}

/** Posts bytes to a Convex upload URL; returns the storage id. */
export async function upload(env: Pick<MigrateEnv, "fetch">, url: string, bytes: Uint8Array, mime: string): Promise<string> {
  const res = await (env.fetch ?? fetch)(url, { method: "POST", headers: { "Content-Type": mime }, body: bytes as Uint8Array<ArrayBuffer> });
  if (!res.ok) throw new Error(`The upload failed (${res.status}).`);
  return ((await res.json()) as { storageId: string }).storageId;
}

/**
 * Seals one attachment's bytes (§6.9 step 6): downloads the plaintext, a new file key wrapped by the note key,
 * the metadata sealed with it, the bytes as FLV1 0x04, then e2ee.files.replaceBlob swaps the stored blob.
 */
export async function sealFile(env: MigrateEnv, fileId: string, documentId: string): Promise<boolean> {
  await loadNoteKeys(env, documentId);
  const entry = await fileEntry(env, fileId);
  if (!entry || entry.sealed) return false;
  const res = await (env.fetch ?? fetch)(entry.url);
  if (!res.ok) throw new Error(`The file couldn't be downloaded (${res.status}).`);
  const plain = new Uint8Array(await res.arrayBuffer());
  const { raw, wrapped, k } = await env.sealer.newFileKey(documentId, fileId);
  try {
    const meta = { name: entry.filename, mime: entry.mimeType, width: entry.width, height: entry.height, ...(entry.palette ? { palette: entry.palette } : {}), sha256: hex(sha256(plain)) };
    const sealedMeta = await Sealer.sealFileMeta(raw, documentId, fileId, meta);
    const envelope = await sealFileStream(await importAead(raw.slice()), aad.file(fileId), plain);
    const target = (await call.mutation(env, api.e2ee.files.generateUploadUrl, { documentId, kind: sealedKind(entry.mimeType), declaredSize: envelope.length })) as { uploadUrl: string; intentId: string };
    const storageId = await upload(env, target.uploadUrl, envelope, "application/octet-stream");
    await call.action(env, api.e2ee.files.replaceBlob, {
      intentId: target.intentId,
      fileId,
      storageId,
      size: envelope.length,
      sha256: hex(sha256(envelope)),
      sealed: { key: wrapped, meta: sealedMeta, k, plainSize: plain.length },
    });
    return true;
  } finally {
    raw.fill(0);
    plain.fill(0);
  }
}

// ---- cleanup -------------------------------------------------------------------------------------------

interface SidebarRows {
  folders: { id: string; name: string; parentFolderId?: string | null; sealedName?: { c: ArrayBuffer; k: number }; locked?: boolean }[];
  tags: { id: string; name: string; sealedName?: { c: ArrayBuffer; k: number } }[];
}

export async function sidebarRows(env: Pick<MigrateEnv, "server" | "space">): Promise<SidebarRows> {
  const r = (await call.query(env, api.organization.sidebar, { scope: env.space.scope })) as Partial<SidebarRows> | null;
  return { folders: r?.folders ?? [], tags: r?.tags ?? [] };
}

/** The folder ids at and under a folder (a locked folder's own tree). */
export function folderTree(folders: SidebarRows["folders"], rootId: string): Set<string> {
  const out = new Set([rootId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of folders) if (f.parentFolderId && out.has(f.parentFolderId) && !out.has(f.id)) {
      out.add(f.id);
      grew = true;
    }
  }
  return out;
}

/**
 * §6.9 step 7 for a seal: folder names (and, for a whole space, tag names) sealed with the space key. A locked
 * folder's job seals that folder's tree only; a note's lock has no names to seal. Readable copies for the
 * switches that are on are the feature workers' (features/mirror.ts), which run once notes are sealed.
 */
export async function sealNames(env: MigrateEnv, job: { scopeOf: "space" | "folder" | "document"; rootId: string | null }): Promise<void> {
  if (job.scopeOf === "document") return;
  // A whole space's Foli AI memories become this person's sealed records (§5.7 aiMemory).
  if (job.scopeOf === "space") await moveMemories(env);
  const { folders, tags } = await sidebarRows(env);
  const only = job.scopeOf === "folder" && job.rootId ? folderTree(folders, job.rootId) : null;
  for (const f of folders) {
    if (f.sealedName || (only && !only.has(f.id))) continue;
    checkStop(env);
    const sealed = await env.sealer.sealFolderName(env.space.scope, env.space.scopeId, f.id, f.name);
    await call.mutation(env, api.e2ee.content.renameFolder, { folderId: f.id, sealedName: sealed.c });
  }
  if (only) return;
  for (const t of tags) {
    if (t.sealedName) continue;
    checkStop(env);
    const sealed = await env.sealer.sealTagName(env.space.scope, env.space.scopeId, t.id, t.name);
    await call.mutation(env, api.e2ee.content.updateTag, { tagId: t.id, sealedName: sealed.c, nameMac: sealed.nameMac });
  }
}
