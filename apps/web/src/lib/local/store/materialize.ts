// The library's files as rows (the other direction from project.ts): after notes or the index changed on disk
// (another device's edits, a conflict copy merged, a journal replayed at launch), the rows the handlers read
// are brought in step, inside a mutation of the backend's own (StoreHost.ingest), so the triggers run and every
// query that read what changed runs again.
//
// Rows keep what's only this device's: change counters, orderings, the revision numbers the editor bases its
// edits on (bumped whenever the content changes), derived text and links (recomputed as the handlers do).
import { DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE, type WireBlock } from "@folevi/editor-schema";
import {
  blockToWire,
  hlcDevice,
  hlcMs,
  isStub,
  latestStamp,
  liveFolders,
  liveTags,
  normalizeBlocks,
  type CatalogEntry,
  type IndexFile,
  type NoteFile,
  type NoteLike,
  type Register,
  type VersionFile,
} from "@folevi/local-store";
import type { LocalMutationCtx } from "../registry";
import type { LocalBlock, LocalCollection, LocalCollectionRow, LocalDocument, LocalFile, LocalFileText, LocalFolder, LocalNotice, LocalTable, LocalTag, LocalVersion } from "../store";
import { linksAfter, refreshDerived, refreshSyncedSource } from "../functions/shared";
import { COLLECTION_META, ROW_META, canon, contentKey, same } from "./project";
import { INDEX_ROW_TABLES, isDeviceMeta, metaSetting, parseRowSetting } from "./policy";

async function counter(ctx: LocalMutationCtx, key: string): Promise<number> {
  const n = (((await ctx.db.get("meta", key)) as number | undefined) ?? 0) + 1;
  ctx.db.put("meta", key, n);
  return n;
}

const reg = <T>(r: Register<T> | undefined): T | undefined => r?.v;

/** The document fields a note file holds, as a row holds them. */
export function docFields(note: NoteFile) {
  const d = note.doc;
  const trashed = (reg(d.trashedAt) ?? null) as number | null;
  return {
    kind: (d.kind?.v ?? "document") as LocalDocument["kind"],
    title: reg(d.title) ?? "",
    icon: reg(d.icon) ?? null,
    folderId: reg(d.folderId) ?? null,
    parentDocumentId: reg(d.parentDocumentId) ?? null,
    rank: reg(d.rank) ?? "V",
    style: (reg(d.style) ?? DEFAULT_DOCUMENT_STYLE) as LocalDocument["style"],
    cover: (reg(d.cover) ?? DEFAULT_COVER) as LocalDocument["cover"],
    starred: !!reg(d.starred),
    archivedAt: (reg(d.archivedAt) ?? null) as number | null,
    inTrash: trashed !== null,
    deletedAt: trashed,
    templateKey: reg(d.templateKey) ?? null,
    dailyDate: reg(d.dailyDate) ?? null,
    tagIds: liveTags(note),
    collectionId: note.row?.collectionId ?? null,
  };
}

function rowOf(note: NoteFile): LocalCollectionRow | null {
  const r = note.row;
  const meta = r?.values[ROW_META]?.v as { id?: string; createdAt?: number; deletedAt?: number | null } | undefined;
  if (!r || !meta?.id) return null;
  const values: Record<string, unknown> = {};
  for (const [pid, v] of Object.entries(r.values)) if (pid !== ROW_META && v.v !== null && v.v !== undefined) values[pid] = v.v;
  const stamps = Object.values(r.values).map((v) => v.c);
  if (r.rank) stamps.push(r.rank.c);
  return {
    id: meta.id,
    collectionId: r.collectionId,
    rank: r.rank?.v ?? "V",
    values,
    createdAt: meta.createdAt ?? 0,
    updatedAt: Math.max(0, ...stamps.map(hlcMs)),
    deletedAt: meta.deletedAt ?? null,
  };
}

const blankDoc = (id: string): LocalDocument => ({
  id,
  parentDocumentId: null,
  folderId: null,
  kind: "document",
  title: "",
  icon: null,
  cover: DEFAULT_COVER,
  style: DEFAULT_DOCUMENT_STYLE,
  dailyDate: null,
  templateKey: null,
  collectionId: null,
  rank: "V",
  createdAt: 0,
  ordinal: 0,
  updatedAt: 0,
  archivedAt: null,
  deletedAt: null,
  inTrash: false,
  revision: 0,
  titleRev: 0,
  seq: 0,
  contentSeq: 0,
  searchText: "",
  wordCount: 0,
  charCount: 0,
  blockCount: 0,
  excerpt: "",
  preview: null,
  starred: false,
  tagIds: [],
});

const DOC_KEYS = ["kind", "title", "icon", "folderId", "parentDocumentId", "rank", "style", "cover", "starred", "archivedAt", "inTrash", "deletedAt", "templateKey", "dailyDate", "tagIds", "collectionId"] as const;

/** What a materialize pass learned that the store keeps (which block revisions came from elsewhere). */
export interface MaterializeReport {
  /** `<noteId>/<blockId>` → the revision its content from another device arrived as. */
  remoteBlocks: Map<string, number>;
  /** note id → the revision its title from another device arrived as. */
  remoteTitles: Map<string, number>;
}

export interface MaterializeInput {
  /** Notes to bring in step (their current state; undefined when there's no file at all). */
  notes: Map<string, NoteLike | undefined>;
  /** The index, when it changed. */
  index?: IndexFile;
  /** Notes known only from catalogs, by id. */
  placeholders?: Map<string, { entry: CatalogEntry; state: "downloading" | "waiting" }>;
  /** Version files read from history/, by note. */
  versions?: Map<string, { name: string; file: VersionFile }[]>;
  /** Version files whose rows should go (removed on disk). */
  removedVersions?: { docId: string; rowId: string }[];
  /** Device records, for device names in version history. */
  devices?: { deviceId: string; name: string }[];
  /** This device in note files. */
  deviceId: string;
  /** Row id of a version file (the id the app gave it, else the note id and the file name). */
  versionRowId(docId: string, name: string, file: VersionFile | null): string;
}

export function versionRow(docId: string, name: string, file: VersionFile, rowId: string, note: NoteFile | null, ordinal: number): LocalVersion {
  const app = (file as VersionFile & { app?: LocalVersion }).app;
  if (app && typeof app === "object" && app.documentId === docId) return { ...app, id: rowId, documentId: docId, name: note?.versionNames[name]?.v ?? app.name ?? null };
  const title = (note ? reg(note.doc.title) : undefined) ?? "";
  const icon = (note ? reg(note.doc.icon) : undefined) ?? null;
  if (file.conflict) {
    const target = file.conflict.target;
    const state = file.conflict.state as Record<string, unknown> & { v?: unknown; deleted?: unknown };
    const blocks: WireBlock[] = target.startsWith("doc.") || state.deleted ? [] : [blockToWire(target, { ...(state as object), parentId: null, rank: "V", c: { content: file.c, position: file.c }, cv: {} } as never)];
    return {
      id: rowId,
      documentId: docId,
      reason: "manual",
      name: note?.versionNames[name]?.v ?? null,
      title: target === "doc.title" ? String(state.v ?? "") : title,
      icon,
      blocks,
      blockCount: blocks.length,
      // Never equal to a note's counter: a kept version is never "the current version".
      contentSeq: -1,
      createdAt: hlcMs(file.c),
      ordinal,
      deviceId: file.by,
      editors: [file.by],
      authors: {},
      removed: {},
      conflict: { target, device: file.by },
    };
  }
  const snap = file.note;
  const blocks = snap ? normalizeBlocks(snap).blocks : [];
  return {
    id: rowId,
    documentId: docId,
    reason: file.reason === "named" ? "manual" : file.reason === "before-restore" ? "before_restore" : file.reason === "imported" ? "import" : "idle",
    name: note?.versionNames[name]?.v ?? null,
    title: (snap ? reg(snap.doc.title) : undefined) ?? title,
    icon: (snap ? reg(snap.doc.icon) : undefined) ?? icon,
    ...(snap?.doc.style ? { style: snap.doc.style.v as LocalDocument["style"] } : {}),
    blocks,
    blockCount: blocks.length,
    contentSeq: -1,
    createdAt: hlcMs(file.c),
    ordinal,
    deviceId: file.by,
    editors: [file.by],
    authors: {},
    removed: {},
  };
}

/** Brings rows in step with notes and the index. Writes only rows that differ. */
export async function materialize(ctx: LocalMutationCtx, input: MaterializeInput): Promise<MaterializeReport> {
  const report: MaterializeReport = { remoteBlocks: new Map(), remoteTitles: new Map() };
  for (const [id, note] of input.notes) await materializeNote(ctx, id, note, input, report);
  for (const [id, p] of input.placeholders ?? []) if (!input.notes.has(id)) await placeholder(ctx, id, p.entry, p.state);
  for (const [docId, files] of input.versions ?? []) {
    const note = input.notes.get(docId) ?? undefined;
    for (const { name, file } of files) {
      const rowId = input.versionRowId(docId, name, file);
      const have = await ctx.db.get("versions", rowId, docId);
      const live = note && !isStub(note) ? note : null;
      if (have) {
        const nextName = live?.versionNames[name]?.v;
        if (nextName !== undefined && (have.name ?? null) !== (nextName ?? null)) ctx.db.put("versions", rowId, { ...have, name: nextName ?? null }, docId);
        continue;
      }
      ctx.db.put("versions", rowId, versionRow(docId, name, file, rowId, live, await counter(ctx, "versionOrdinal")), docId);
    }
  }
  for (const { docId, rowId } of input.removedVersions ?? []) if (await ctx.db.get("versions", rowId, docId)) ctx.db.remove("versions", rowId, docId);
  if (input.index) await materializeIndex(ctx, input.index);
  for (const d of input.devices ?? []) {
    if (d.deviceId === input.deviceId) continue;
    const key = `device:${d.deviceId}`;
    const had = (await ctx.db.get("meta", key)) as { name?: string } | undefined;
    if (had?.name !== d.name) ctx.db.put("meta", key, { ...(had ?? {}), name: d.name });
  }
  return report;
}

async function placeholder(ctx: LocalMutationCtx, id: string, entry: CatalogEntry, state: "downloading" | "waiting") {
  const prev = await ctx.db.get("documents", id);
  if (prev && !prev.pending) return;
  const next: LocalDocument = {
    ...(prev ?? blankDoc(id)),
    title: entry.title,
    icon: entry.icon,
    kind: entry.kind as LocalDocument["kind"],
    folderId: entry.folderId,
    parentDocumentId: entry.parentDocumentId,
    updatedAt: entry.updatedAt,
    createdAt: prev?.createdAt ?? entry.updatedAt,
    inTrash: entry.trashed,
    deletedAt: entry.trashed ? entry.updatedAt : null,
    pending: state,
  };
  if (prev && same(prev, next)) return;
  next.ordinal = prev?.ordinal ?? (await counter(ctx, "documentOrdinal"));
  next.revision = (prev?.revision ?? 0) + 1;
  next.seq = await ctx.nextSeq();
  ctx.db.put("documents", id, await refreshDerived(ctx.db, next));
}

async function materializeNote(ctx: LocalMutationCtx, id: string, note: NoteLike | undefined, input: MaterializeInput, report: MaterializeReport) {
  const prevDoc = await ctx.db.get("documents", id);
  if (!note || isStub(note)) {
    if (!note || !prevDoc) return;
    // Deleted for good on another device: the note and everything kept under it go.
    for (const table of ["blocks", "notices", "fileTexts", "versions"] as const) for (const r of await ctx.db.list(table, id)) ctx.db.remove(table, (r as { id: string }).id, id);
    for (const c of await ctx.db.list("collections")) if (c.documentId === id) ctx.db.remove("collections", c.id);
    for (const f of await ctx.db.list("files")) if (f.documentId === id) ctx.db.remove("files", f.id);
    ctx.db.remove("documents", id);
    if (prevDoc.kind === "synced" || prevDoc.links?.length) await refreshAround(ctx, prevDoc);
    return;
  }
  const now = ctx.now();
  let seq: number | null = null;
  const nextSeq = async () => (seq ??= await ctx.nextSeq());

  // Blocks: every entry, tombstones included; live blocks under their parent as the tree reads after the merge.
  const prevBlocks = new Map((await ctx.db.list("blocks", id)).map((b) => [b.id, b]));
  const parents = new Map(normalizeBlocks(note).blocks.map((b) => [b.id, b.parentId]));
  const changed: LocalBlock[] = [];
  for (const [bid, entry] of Object.entries(note.blocks)) {
    const wire = blockToWire(bid, entry);
    const parentId = entry.deleted ? entry.parentId : (parents.get(bid) ?? null);
    const deletedAt = entry.deleted ? hlcMs(entry.deleted.c) : null;
    const prev = prevBlocks.get(bid);
    const contentSame = !!prev && contentKey(prev) === contentKey(wire) && canon((prev.props as { collapsed?: unknown }).collapsed ?? null) === canon((wire.props as { collapsed?: unknown }).collapsed ?? null);
    const placeSame = !!prev && prev.parentId === parentId && prev.rank === wire.rank;
    const deletedSame = !!prev && (prev.deletedAt === null) === (deletedAt === null);
    if (contentSame && placeSame && deletedSame) continue;
    const revision = (prev?.revision ?? 0) + 1;
    const row: LocalBlock = {
      ...(prev ?? {}),
      ...wire,
      parentId,
      documentId: id,
      revision,
      contentRev: contentSame && deletedSame ? prev!.contentRev : revision,
      positionRev: placeSame && deletedSame ? prev!.positionRev : revision,
      seq: await nextSeq(),
      deletedAt: deletedAt === null ? null : (prev?.deletedAt ?? deletedAt),
      createdAt: prev?.createdAt ?? hlcMs(entry.c.position < entry.c.content ? entry.c.position : entry.c.content),
      updatedAt: now,
      updatedByDevice: entry.by,
    };
    ctx.db.put("blocks", bid, row, id);
    changed.push(row);
    if ((!contentSame || !deletedSame) && entry.by !== input.deviceId) report.remoteBlocks.set(`${id}/${bid}`, revision);
  }
  for (const [bid] of prevBlocks) {
    if (note.blocks[bid]) continue;
    // A tombstone compacted away (every device has seen the delete).
    ctx.db.remove("blocks", bid, id);
  }

  // The note's own fields.
  const fields = docFields(note);
  const row = rowOf(note);
  const base = prevDoc && !prevDoc.pending ? prevDoc : undefined;
  const fieldsChanged = !base || DOC_KEYS.some((k) => !same(base[k], fields[k])) || !same(base.row ?? null, row);
  if (fieldsChanged || changed.length || prevDoc?.pending) {
    const latest = latestStamp(note);
    const revision = (prevDoc?.revision ?? 0) + 1;
    const titleChanged = !base || base.title !== fields.title;
    let doc: LocalDocument = {
      ...(prevDoc ?? blankDoc(id)),
      ...fields,
      ...(row ? { row } : {}),
      createdAt: note.doc.createdAt ?? prevDoc?.createdAt ?? (latest ? hlcMs(latest) : now),
      ordinal: prevDoc?.ordinal || (await counter(ctx, "documentOrdinal")),
      revision,
      titleRev: titleChanged ? revision : base!.titleRev,
      seq: await nextSeq(),
      contentSeq: (prevDoc?.contentSeq ?? 0) + (changed.length ? 1 : 0),
      updatedAt: Math.max(base?.updatedAt ?? 0, latest ? hlcMs(latest) : now),
      ...(latest ? { editedByDevice: hlcDevice(latest) } : {}),
    };
    delete doc.pending;
    if (!row && doc.row) delete doc.row;
    if (fields.starred && !base?.starred && (doc.starOrder ?? null) === null) doc.starOrder = await counter(ctx, "starOrder");
    if (!fields.starred && doc.starOrder != null) doc.starOrder = null;
    doc = await refreshDerived(ctx.db, doc);
    if (changed.length) doc.links = await linksAfter(ctx, doc, changed.map((b) => ({ id: b.id, type: b.type, text: b.text, props: b.props, deletedAt: b.deletedAt })));
    ctx.db.put("documents", id, doc);
    if (titleChanged && base && latest && hlcDevice(note.doc.title?.c ?? latest) !== input.deviceId) report.remoteTitles.set(id, revision);
    if (doc.kind === "synced" || changed.some((b) => b.type === "synced") || (base && base.inTrash !== doc.inTrash)) await refreshAround(ctx, doc);
  }

  await materializeNotices(ctx, id, note, input);
  await materializeKept(ctx, id, note);
}

/** Synced content shown by a note that changed: in Trash only when no live note shows it (lib/synced.ts). */
async function refreshAround(ctx: LocalMutationCtx, doc: LocalDocument) {
  if (doc.kind === "synced") await refreshSyncedSource(ctx, doc.id);
  for (const link of doc.links ?? []) await refreshSyncedSource(ctx, link.target);
}

async function materializeNotices(ctx: LocalMutationCtx, id: string, note: NoteFile, input: MaterializeInput) {
  const prev = new Map((await ctx.db.list("notices", id)).map((n) => [n.id, n]));
  for (const [nid, n] of Object.entries(note.notices)) {
    const row: LocalNotice = {
      id: nid,
      documentId: id,
      blockId: n.blockId,
      field: n.field ?? null,
      kind: n.kind,
      from: n.from,
      at: hlcMs(n.at),
      versionId: n.version ? input.versionRowId(id, n.version, null) : null,
      other: n.other ?? null,
      dismissed: !!n.dismissed,
    };
    const had = prev.get(nid);
    if (!had || !same(had, row)) ctx.db.put("notices", nid, row, id);
  }
}

/** The things kept inside a note besides its blocks: files, text found in them, collections it hosts. */
async function materializeKept(ctx: LocalMutationCtx, id: string, note: NoteFile) {
  for (const [fid, e] of Object.entries(note.files)) {
    const had = await ctx.db.get("files", fid);
    const { c, mime, sha256, name, size, kind, ...rest } = e as typeof e & Record<string, unknown>;
    const next = { ...(had ?? {}), ...rest, id: fid, documentId: id, name, mimeType: mime, size, sha256, kind, createdAt: (rest.createdAt as number | undefined) ?? had?.createdAt ?? hlcMs(c) } as LocalFile;
    if (had && same({ ...had, blob: null }, { ...next, blob: null })) continue;
    // The bytes are read from the library when something asks for them (LibraryStore.get).
    if (!had || had.sha256 !== sha256) delete (next as Partial<LocalFile>).blob;
    ctx.db.put("files", fid, next);
  }
  for (const [key, e] of Object.entries(note.fileText)) {
    const { c, reader, fingerprint, pageStarts, ...rest } = e as typeof e & Record<string, unknown>;
    const had = await ctx.db.get("fileTexts", key, id);
    const next = { ...(had ?? {}), ...rest, id: key, documentId: id, by: reader, hash: fingerprint, pageStarts: pageStarts ?? null, createdAt: (rest.createdAt as number | undefined) ?? had?.createdAt ?? hlcMs(c), updatedAt: (rest.updatedAt as number | undefined) ?? hlcMs(c) } as LocalFileText;
    if (!had || !same(had, next)) ctx.db.put("fileTexts", key, next, id);
  }
  for (const [cid, def] of Object.entries(note.collections)) {
    const had = await ctx.db.get("collections", cid);
    const meta = (def.properties[COLLECTION_META]?.v ?? {}) as { createdAt?: number; deletedAt?: number | null };
    const properties: Record<string, unknown> = {};
    const views: Record<string, unknown> = {};
    const stamps: string[] = def.name ? [def.name.c] : [];
    for (const [pid, r] of Object.entries(def.properties)) {
      stamps.push(r.c);
      if (pid !== COLLECTION_META && r.v !== null) properties[pid] = r.v;
    }
    for (const [vid, r] of Object.entries(def.views)) {
      stamps.push(r.c);
      if (r.v !== null) views[vid] = r.v;
    }
    const content = { documentId: id, name: def.name?.v ?? "", createdAt: meta.createdAt ?? had?.createdAt ?? 0, deletedAt: meta.deletedAt ?? null, properties, views };
    if (had && same({ documentId: had.documentId, name: had.name, createdAt: had.createdAt, deletedAt: had.deletedAt, properties: had.properties, views: had.views }, content)) continue;
    const next: LocalCollection = {
      ...(had ?? {}),
      ...(content as Omit<LocalCollection, "id" | "ordinal" | "updatedAt" | "seq">),
      id: cid,
      ordinal: had?.ordinal ?? (await counter(ctx, "collectionOrdinal")),
      updatedAt: Math.max(had?.updatedAt ?? 0, ...stamps.map(hlcMs)),
      seq: await ctx.nextSeq(),
    };
    ctx.db.put("collections", cid, next);
  }
}

async function materializeIndex(ctx: LocalMutationCtx, index: IndexFile) {
  const stampOf = (e: Record<string, Register<unknown> | undefined>) => Math.max(0, ...Object.values(e).flatMap((r) => (r ? [hlcMs(r.c)] : [])));
  // Folders: the tree made valid (a missing or cyclic parent puts a folder at the top level).
  const live = new Map(liveFolders(index).map((f) => [f.id, f]));
  const prevFolders = new Map((await ctx.db.list("folders")).map((f) => [f.id, f]));
  for (const [id, entry] of Object.entries(index.folders)) {
    const e = entry as Record<string, Register<unknown> | undefined>;
    const had = prevFolders.get(id);
    const tree = live.get(id);
    const extra: Record<string, unknown> = {};
    for (const [k, r] of Object.entries(e)) if (r && !["name", "color", "parentId", "rank", "deleted", "deletedAt"].includes(k)) extra[k] = r.v;
    const deletedAt = entry.deleted?.v ? ((e.deletedAt?.v as number | null | undefined) ?? hlcMs(entry.deleted.c)) : null;
    const next: LocalFolder = {
      ...(had ?? {}),
      ...(extra as Partial<LocalFolder>),
      id,
      name: tree?.name ?? entry.name?.v ?? "",
      color: tree?.color ?? entry.color?.v ?? null,
      parentFolderId: tree ? tree.parentId : (entry.parentId?.v ?? null),
      rank: tree?.rank ?? entry.rank?.v ?? "V",
      createdAt: (extra.createdAt as number | undefined) ?? had?.createdAt ?? stampOf(e),
      updatedAt: had && same({ ...had, updatedAt: 0 }, { ...had, ...extra, updatedAt: 0 }) ? had.updatedAt : Math.max(had?.updatedAt ?? 0, stampOf(e)),
      deletedAt,
    };
    if (!had || !same({ ...had, updatedAt: 0 }, { ...next, updatedAt: 0 })) {
      if (!had) next.ordinal = await counter(ctx, "folderOrdinal");
      next.updatedAt = Math.max(had?.updatedAt ?? 0, stampOf(e));
      ctx.db.put("folders", id, next);
    }
  }
  const prevTags = new Map((await ctx.db.list("tags")).map((t) => [t.id, t]));
  for (const [id, entry] of Object.entries(index.tags)) {
    const e = entry as Record<string, Register<unknown> | undefined>;
    const had = prevTags.get(id);
    if (entry.deleted?.v) {
      if (had) ctx.db.remove("tags", id);
      continue;
    }
    const extra: Record<string, unknown> = {};
    for (const [k, r] of Object.entries(e)) if (r && k !== "deleted") extra[k] = r.v;
    const name = (extra.name as string | undefined) ?? "";
    const next = { ...(had ?? {}), ...extra, id, name, normalizedName: (extra.normalizedName as string | undefined) ?? name, color: (extra.color as string | undefined) ?? "accent", createdAt: (extra.createdAt as number | undefined) ?? had?.createdAt ?? stampOf(e) } as LocalTag;
    if (!had || !same(had, next)) {
      if (!had) next.ordinal = await counter(ctx, "tagOrdinal");
      ctx.db.put("tags", id, next);
    }
  }
  // Library settings: synced meta keys, and whole rows of the tables that sync through the index.
  for (const [key, r] of Object.entries(index.settings)) {
    if (key.startsWith("meta:")) {
      const metaKey = key.slice(5);
      if (isDeviceMeta(metaKey) || metaSetting(metaKey) !== key) continue;
      const value = (r.v as { value?: unknown } | null)?.value;
      const had = await ctx.db.get("meta", metaKey);
      if (r.v === null) {
        if (had !== undefined) ctx.db.remove("meta", metaKey);
      } else if (!same(had, value)) ctx.db.put("meta", metaKey, value);
      continue;
    }
    const parsed = parseRowSetting(key);
    if (!parsed) continue;
    const table = parsed.table as LocalTable;
    if (!INDEX_ROW_TABLES.has(table) && table !== "files") continue;
    const had = await ctx.db.get(table, parsed.id, parsed.partition);
    const value = (r.v as { value?: unknown } | null)?.value;
    if (r.v === null || value === undefined) {
      if (had !== undefined) ctx.db.remove(table, parsed.id, parsed.partition);
    } else if (table === "files") {
      const f = value as Record<string, unknown>;
      const next = { ...(had ?? {}), ...f, id: parsed.id, documentId: null, mimeType: f.mime } as unknown as LocalFile;
      delete (next as unknown as Record<string, unknown>).mime;
      if (!had || !same({ ...had, blob: null }, { ...next, blob: null })) ctx.db.put("files", parsed.id, next);
    } else if (!same(had, value)) ctx.db.put(table, parsed.id, value as never, parsed.partition);
  }
}
