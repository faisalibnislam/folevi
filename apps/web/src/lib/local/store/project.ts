// Local writes into the library's files (docs/LOCAL_MODE_PLAN.md §3.3, §3.5): a commit's row writes become
// stamped edits of note files and the library index (packages/local-store edits.ts), journal records, and the
// immutable files to write before them (history versions, attachments).
//
// Only what a handler changed is stamped: each row is compared with the row it replaces, so derived fields
// (counts, search text, change counters) and fields nobody touched keep their stamps, and a note another
// device changed keeps that device's changes. materialize.ts is the other direction.
import { canonicalJson, type ChangedField, type WireBlock } from "@folevi/editor-schema";
import {
  addTag,
  blockToWire,
  bumpVv,
  conflictVersion,
  conflictVersionName,
  createNote,
  deleteBlock,
  diffNote,
  dismissNotice,
  emptyIndex,
  encodeVersionFile,
  historyPath,
  hlcDevice,
  isStub,
  liveTags,
  lossNoticeId,
  makeStub,
  recordDeletedNote,
  removeTag,
  restoreBlock,
  setDocField,
  setFile,
  setFileText,
  setFolderField,
  setRowValue,
  setSetting,
  setTagField,
  setVersionName,
  snapshotVersion,
  upsertBlock,
  type BlockEntry,
  type CollectionDef,
  type DocRegisterField,
  type HybridClock,
  type IndexFile,
  type JournalRecord,
  type NoteFile,
  type NoteLike,
  type Register,
  type VersionFile,
  type VersionReason,
} from "@folevi/local-store";
import type { LocalBlock, LocalCollection, LocalDocument, LocalFile, LocalFileText, LocalFolder, LocalNotice, LocalTag, LocalVersion, StoreWrite } from "../store";
import { INDEX_ROW_TABLES, isDeviceMeta, metaSetting, placementOf, rowSetting } from "./policy";

export const canon = (v: unknown) => canonicalJson(v === undefined ? null : v);
export const same = (a: unknown, b: unknown) => canon(a) === canon(b);

/** A row's document fields as note registers: [register, how a row holds it]. */
export const DOC_FIELDS: readonly [DocRegisterField, (d: LocalDocument) => unknown][] = [
  ["title", (d) => d.title],
  ["icon", (d) => d.icon ?? null],
  ["folderId", (d) => d.folderId ?? null],
  ["parentDocumentId", (d) => d.parentDocumentId ?? null],
  ["rank", (d) => d.rank],
  ["style", (d) => d.style ?? null],
  ["cover", (d) => d.cover ?? null],
  ["starred", (d) => !!d.starred],
  ["archivedAt", (d) => d.archivedAt ?? null],
  ["trashedAt", (d) => (d.inTrash ? (d.deletedAt ?? 0) : null)],
  ["templateKey", (d) => d.templateKey ?? null],
  ["dailyDate", (d) => d.dailyDate ?? null],
];

/** A note's value of a document field, as a row holds it (for a note with no row yet). */
function noteDocValue(note: NoteFile, field: DocRegisterField): unknown {
  return (note.doc[field] as Register<unknown> | undefined)?.v ?? null;
}

/** The parts of a block's content group (props without `collapsed`, which merges on its own). */
export function contentKey(b: Pick<WireBlock, "type" | "schemaVersion" | "text" | "props">): string {
  const props = { ...(b.props as Record<string, unknown>) };
  delete props.collapsed;
  return canon({ type: b.type, schemaVersion: b.schemaVersion, text: b.text, props });
}

const collapsedOf = (b: Pick<WireBlock, "props">) => (b.props as { collapsed?: unknown }).collapsed === true;

export const toWire = (r: Pick<LocalBlock, "id" | "type" | "parentId" | "rank" | "schemaVersion" | "text" | "props">): WireBlock => ({
  id: r.id,
  type: r.type,
  parentId: r.parentId,
  rank: r.rank,
  schemaVersion: r.schemaVersion,
  text: r.text,
  props: r.props,
});

/** A register's value with no `undefined` (canonical JSON drops it, and a register must hold `v`). */
const regValue = <T>(v: T): T => (v === undefined ? (null as T) : v);

function stampRegister<T>(old: Register<T> | undefined, value: T, clock: HybridClock, causal = true): Register<T> {
  const c = clock.tickAfter(old?.c);
  return causal ? { v: regValue(value), c, cv: bumpVv(old?.cv, clock.deviceId, c) } : { v: regValue(value), c };
}

function withSeen(note: NoteFile, clock: HybridClock, c: string): NoteFile {
  return { ...note, seen: bumpVv(note.seen, clock.deviceId, c) };
}

/** Keys of a collection's definition that aren't property ids: the collection's own fields. */
export const COLLECTION_META = "~";
/** Key of a row note's values that holds the row's own fields. */
export const ROW_META = "~";

/** What the store knows that a projection needs. */
export interface ProjectionEnv {
  clock: HybridClock;
  /** The note as it is now (including earlier writes of this commit). */
  note(id: string): NoteLike | undefined;
  /** The row as it was before this commit. */
  before(table: string, id: string, partition: string | undefined): unknown;
  index: IndexFile;
  libraryId: string;
  /** The revision a block's content last arrived from another device as. */
  remoteBlockRev(docId: string, blockId: string): number | undefined;
  /** The revision a note's title last arrived from another device as. */
  remoteTitleRev(docId: string): number | undefined;
  /** A version row's history file (by row id). */
  versionFile(rowId: string): { docId: string; name: string } | undefined;
  bases?: ReadonlyMap<string, number | null>;
}

/** A version that holds what a concurrent edit overwrote (for the `versions` table). */
export interface ConflictKept {
  docId: string;
  name: string;
  file: VersionFile;
}

export interface Projection {
  /** Notes changed, as they are now. */
  notes: Map<string, NoteLike>;
  index: IndexFile | null;
  /** Immutable files to write before any note that refers to them: path → bytes. */
  history: Map<string, Uint8Array>;
  /** History files to remove (a version deleted by thinning). */
  removeHistory: string[];
  /** Attachments to write, by sha256 → the file row holding the bytes. */
  attachments: Map<string, LocalFile>;
  /** New version rows' files: row id → where it is. */
  versionFiles: Map<string, { docId: string; name: string }>;
  /** Overwritten versions kept because an edit didn't see another device's change. */
  conflicts: ConflictKept[];
  records: JournalRecord[];
}

/** Projects a commit's writes. Pure apart from the clock; throws nothing for rows it doesn't know (they stay on the device). */
export function project(writes: readonly StoreWrite[], env: ProjectionEnv): Projection {
  const out: Projection = { notes: new Map(), index: null, history: new Map(), removeHistory: [], attachments: new Map(), versionFiles: new Map(), conflicts: [], records: [] };
  const clock = env.clock;
  const startNotes = new Map<string, NoteLike | undefined>();
  const noteNow = (id: string): NoteLike | undefined => (out.notes.has(id) ? out.notes.get(id) : env.note(id));
  const setNote = (id: string, n: NoteLike) => {
    if (!startNotes.has(id)) startNotes.set(id, env.note(id));
    out.notes.set(id, n);
  };
  /** A live note to write into (made if needed: a block can come before its note in one commit). */
  const liveNote = (id: string, kind?: string, createdAt?: number): NoteFile => {
    const n = noteNow(id);
    if (n && !isStub(n)) return n;
    return createNote(id, { kind: kind ?? "document", createdAt: createdAt ?? Date.now() }, clock);
  };
  let index = env.index;
  const startIndex = env.index;

  // Notes first (blocks may be in the same commit), then everything that lives in them.
  const order = (w: StoreWrite) => (w.table === "documents" ? 0 : w.table === "versions" ? 2 : 1);
  const sorted = [...writes].sort((a, b) => order(a) - order(b));

  for (const w of sorted) {
    const placement = placementOf(w.table);
    if (placement === "device") continue;
    switch (w.table) {
      case "documents": {
        const old = env.before("documents", w.id, undefined) as LocalDocument | undefined;
        const row = w.value;
        const current = noteNow(w.id);
        if (row === null) {
          if (current && !isStub(current)) {
            const stub = makeStub(current, clock.tick());
            setNote(w.id, stub);
            index = recordDeletedNote(index, w.id, stub);
          }
          break;
        }
        let note = current && !isStub(current) ? current : createNote(w.id, { kind: row.kind, createdAt: row.createdAt }, clock);
        const base = old && !old.pending ? old : undefined;
        for (const [field, get] of DOC_FIELDS) {
          const next = get(row);
          const prev = base ? get(base) : noteDocValue(note, field);
          // A field the note doesn't hold yet is written once even if the row didn't change it.
          if (same(next, prev) && (note.doc[field] !== undefined || next === null || next === false)) continue;
          const overwritten = field === "title" ? overwrittenTitle(note, w.id, next as string, env) : null;
          note = setDocField(note, field, next as never, clock);
          if (overwritten) note = keepOverwrittenTitle(note, w.id, overwritten, env, out);
        }
        const before = new Set(base ? base.tagIds : liveTags(note));
        const after = new Set(row.tagIds ?? []);
        for (const t of after) if (!before.has(t)) note = addTag(note, t, clock);
        for (const t of before) if (!after.has(t)) note = removeTag(note, t, clock);
        note = projectRow(note, base, row, clock);
        if (note !== current) setNote(w.id, note);
        break;
      }
      case "blocks": {
        const docId = w.partition!;
        const current = noteNow(docId);
        if (current && isStub(current)) break;
        const old = env.before("blocks", w.id, docId) as LocalBlock | undefined;
        const row = w.value;
        let note = liveNote(docId);
        const entry = note.blocks[w.id];
        if (row === null) {
          if (entry && !entry.deleted) note = deleteBlock(note, w.id, clock);
          if (note !== current) setNote(docId, note);
          break;
        }
        const wire = toWire(row);
        if (!entry) {
          note = upsertBlock(note, wire, ["content", "position", "collapsed"], clock);
          if (row.deletedAt !== null) note = deleteBlock(note, w.id, clock);
          setNote(docId, note);
          break;
        }
        const was = old ?? { ...blockToWire(w.id, entry), deletedAt: entry.deleted ? 0 : null };
        const fields: ChangedField[] = [];
        if (contentKey(was) !== contentKey(wire)) fields.push("content");
        if (was.parentId !== wire.parentId || was.rank !== wire.rank) fields.push("position");
        if (collapsedOf(was) !== collapsedOf(wire)) fields.push("collapsed");
        const wasDeleted = was.deletedAt !== null;
        const nowDeleted = row.deletedAt !== null;
        if (!fields.length && wasDeleted === nowDeleted) break;
        const contentWrite = fields.includes("content") || wasDeleted !== nowDeleted;
        const loser = contentWrite ? overwrittenRemote(docId, w.id, entry, env) : null;
        if (wasDeleted && !nowDeleted && entry.deleted) note = restoreBlock(note, w.id, clock);
        if (fields.length) note = upsertBlock(note, wire, fields, clock);
        if (!wasDeleted && nowDeleted) note = deleteBlock(note, w.id, clock);
        if (loser && contentKey(blockToWire(w.id, loser)) + String(!!loser.deleted) !== contentKey(wire) + String(nowDeleted)) note = keepOverwrittenBlock(note, docId, w.id, loser, nowDeleted, env, out);
        setNote(docId, note);
        break;
      }
      case "notices": {
        const row = w.value as LocalNotice | null;
        const docId = w.partition!;
        const old = env.before("notices", w.id, docId) as LocalNotice | undefined;
        const note = noteNow(docId);
        if (!row || !note || isStub(note) || !note.notices[w.id]) break;
        if (row.dismissed && !old?.dismissed && !note.notices[w.id]!.dismissed) setNote(docId, dismissNotice(note, w.id, clock));
        break;
      }
      case "files": {
        const row = w.value as LocalFile | null;
        const old = env.before("files", w.id, undefined) as LocalFile | undefined;
        const docId = row?.documentId ?? old?.documentId ?? null;
        if (row && row.blob && row.sha256 && (!old || old.sha256 !== row.sha256)) out.attachments.set(row.sha256, row);
        if (docId === null) {
          index = setIndexRow(index, "files", undefined, w.id, row ? fileEntryOf(row) : null, clock);
          break;
        }
        const current = noteNow(docId);
        if (current && isStub(current)) break;
        if (!row) break; // An attachment stays referenced until its note says otherwise (§3.8): nothing to stamp.
        const note = liveNote(docId);
        const entry = fileEntryOf(row);
        const had = note.files[w.id];
        if (had && same({ ...had, c: undefined }, entry)) break;
        setNote(docId, setFile(note, w.id, entry as never, clock));
        break;
      }
      case "fileTexts": {
        const docId = w.partition!;
        const row = w.value as LocalFileText | null;
        const current = noteNow(docId);
        if (!row || (current && isStub(current))) break;
        const note = liveNote(docId);
        const entry = fileTextEntryOf(row);
        const had = note.fileText[w.id];
        if (had && same({ ...had, c: undefined }, entry)) break;
        setNote(docId, setFileText(note, w.id, entry as never, clock));
        break;
      }
      case "collections": {
        const row = w.value as LocalCollection | null;
        const old = env.before("collections", w.id, undefined) as LocalCollection | undefined;
        const docId = row?.documentId ?? old?.documentId;
        if (!docId) break;
        const current = noteNow(docId);
        if (current && isStub(current)) break;
        const note = liveNote(docId);
        const next = projectCollection(note.collections[w.id], old, row ?? (old ? { ...old, deletedAt: old.deletedAt ?? Date.now() } : null), clock);
        if (!next) break;
        setNote(docId, withSeen({ ...note, collections: { ...note.collections, [w.id]: next.def } }, clock, next.c));
        break;
      }
      case "versions": {
        const row = w.value as LocalVersion | null;
        const docId = w.partition!;
        const old = env.before("versions", w.id, docId) as LocalVersion | undefined;
        const where = env.versionFile(w.id) ?? out.versionFiles.get(w.id);
        if (!row) {
          if (where) out.removeHistory.push(historyPath(where.docId, where.name));
          break;
        }
        const note = noteNow(docId);
        if (!old && !where) {
          if (!note || isStub(note) || row.conflict) break;
          const { name, file } = snapshotVersion(note, reasonFor(row.reason), clock.tick(), clock.deviceId);
          // The row as the app made it rides along (its id, editors, authors), so every device lists it the same.
          const withRow = { ...file, app: row } as VersionFile;
          out.history.set(historyPath(docId, name), encodeVersionFile(withRow));
          out.versionFiles.set(w.id, { docId, name });
          if (row.name) setNote(docId, setVersionName(liveNote(docId), name, row.name, clock));
          break;
        }
        if (where && note && !isStub(note) && (old?.name ?? null) !== (row.name ?? null)) setNote(docId, setVersionName(note, where.name, row.name ?? null, clock));
        break;
      }
      case "folders": {
        const row = w.value as LocalFolder | null;
        const old = env.before("folders", w.id, undefined) as LocalFolder | undefined;
        index = projectFolder(index, w.id, old, row, clock);
        break;
      }
      case "tags": {
        const row = w.value as LocalTag | null;
        const old = env.before("tags", w.id, undefined) as LocalTag | undefined;
        index = projectTag(index, w.id, old, row, clock);
        break;
      }
      case "meta": {
        if (isDeviceMeta(w.id)) break;
        const old = env.before("meta", w.id, undefined);
        if (w.value !== null && old !== undefined && same(old, w.value)) break;
        index = setSetting(index, metaSetting(w.id), w.value === null ? null : { value: w.value }, clock);
        break;
      }
      default: {
        if (!INDEX_ROW_TABLES.has(w.table)) break;
        const old = env.before(w.table, w.id, w.partition);
        if (w.value !== null && old !== undefined && same(old, w.value)) break;
        index = setIndexRow(index, w.table, w.partition, w.id, w.value, clock);
      }
    }
  }

  for (const [id, after] of out.notes) {
    const before = startNotes.get(id);
    if (isStub(after)) out.records.push({ k: "stub", id, stub: after });
    else out.records.push({ k: "note", id, delta: diffNote(before && !isStub(before) ? before : null, after) });
  }
  if (index !== startIndex) {
    out.index = index;
    out.records.push({ k: "index", delta: diffIndex(startIndex, index) });
  }
  return out;
}

// ---- concurrent edits from disk (§2.3) -----------------------------------------------------------------

/** The block as another device wrote it, when this edit was made without seeing that. */
function overwrittenRemote(docId: string, blockId: string, entry: BlockEntry, env: ProjectionEnv): BlockEntry | null {
  const base = env.bases?.get(`${docId}/${blockId}`);
  const remote = env.remoteBlockRev(docId, blockId);
  if (typeof base !== "number" || remote === undefined || remote <= base) return null;
  if (entry.by === env.clock.deviceId) return null;
  return entry;
}

/** Keeps what the edit overwrote in version history, with a notice on the block. */
function keepOverwrittenBlock(note: NoteFile, docId: string, blockId: string, loser: BlockEntry, deleted: boolean, env: ProjectionEnv, out: Projection): NoteFile {
  const loserC = loser.c.content;
  const kept = conflictVersion({ docId, kind: "block", blockId, state: loser, c: loserC, from: hlcDevice(loserC) });
  out.history.set(historyPath(docId, kept.name), encodeVersionFile(kept.file));
  out.conflicts.push({ docId, name: kept.name, file: kept.file });
  const noticeId = lossNoticeId(blockId, loserC);
  if (note.notices[noticeId]) return note;
  const at = note.blocks[blockId]?.c.content ?? env.clock.tick();
  return {
    ...note,
    notices: { ...note.notices, [noticeId]: { blockId, kind: deleted ? "deleted" : "changed", from: env.clock.deviceId, at, version: kept.name, other: hlcDevice(loserC) } },
  };
}

/** The title as another device wrote it, when this rename was made without seeing that. */
function overwrittenTitle(note: NoteFile, docId: string, next: string, env: ProjectionEnv): Register<string> | null {
  const base = env.bases?.get(docId);
  const remote = env.remoteTitleRev(docId);
  const reg = note.doc.title;
  if (typeof base !== "number" || remote === undefined || remote <= base || !reg || hlcDevice(reg.c) === env.clock.deviceId || reg.v === next) return null;
  return reg;
}

function keepOverwrittenTitle(note: NoteFile, docId: string, reg: Register<string>, env: ProjectionEnv, out: Projection): NoteFile {
  const kept = conflictVersion({ docId, kind: "field", field: "title", state: reg, c: reg.c, from: hlcDevice(reg.c) });
  out.history.set(historyPath(docId, kept.name), encodeVersionFile(kept.file));
  out.conflicts.push({ docId, name: kept.name, file: kept.file });
  const noticeId = lossNoticeId("doc.title", reg.c);
  if (note.notices[noticeId]) return note;
  const at = note.doc.title?.c ?? env.clock.tick();
  return { ...note, notices: { ...note.notices, [noticeId]: { blockId: null, field: "title", kind: "changed", from: env.clock.deviceId, at, version: kept.name, other: hlcDevice(reg.c) } } };
}

// ---- the other things a note holds ---------------------------------------------------------------------

function reasonFor(reason: LocalVersion["reason"]): Exclude<VersionReason, "conflict"> {
  if (reason === "manual") return "named";
  if (reason === "before_restore") return "before-restore";
  if (reason === "import") return "imported";
  return "auto";
}

export function fileEntryOf(row: LocalFile): Record<string, unknown> {
  const { id: _id, documentId: _doc, blob: _blob, mimeType, sha256, name, size, kind, ...rest } = row as LocalFile & Record<string, unknown>;
  void _id;
  void _doc;
  void _blob;
  return JSON.parse(canon({ ...rest, sha256, name, mime: mimeType, size, kind })) as Record<string, unknown>;
}

export function fileTextEntryOf(row: LocalFileText): Record<string, unknown> {
  const { id: _id, documentId: _doc, by, hash, pageStarts, ...rest } = row;
  void _id;
  void _doc;
  return JSON.parse(canon({ ...rest, reader: by, fingerprint: hash, ...(pageStarts ? { pageStarts } : {}) })) as Record<string, unknown>;
}

/** A row note's `row` (its collection, rank and values). */
function projectRow(note: NoteFile, old: LocalDocument | undefined, row: LocalDocument, clock: HybridClock): NoteFile {
  const next = row.row ?? null;
  const prev = old?.row ?? null;
  const collectionId = next?.collectionId ?? row.collectionId ?? null;
  if (!collectionId) return note;
  let n = note;
  if (!n.row) n = { ...n, row: { collectionId, values: {} } };
  if (!next) return n === note ? note : n;
  const r = n.row!;
  let values = { ...r.values };
  let rank = r.rank;
  let top: string | null = null;
  const bump = (c: string) => {
    if (!top || c > top) top = c;
  };
  if (!prev || prev.rank !== next.rank || !rank) {
    rank = stampRegister(rank, next.rank, clock);
    bump(rank.c);
  }
  const meta = { id: next.id, createdAt: next.createdAt, deletedAt: next.deletedAt ?? null };
  if (!prev || !same({ id: prev.id, createdAt: prev.createdAt, deletedAt: prev.deletedAt ?? null }, meta) || !values[ROW_META]) {
    values[ROW_META] = stampRegister(values[ROW_META], meta as unknown, clock, false);
    bump(values[ROW_META]!.c);
  }
  for (const pid of new Set([...Object.keys(prev?.values ?? {}), ...Object.keys(next.values)])) {
    const a = prev?.values[pid];
    const b = next.values[pid];
    if (prev && same(a, b)) continue;
    if (!prev && b === undefined) continue;
    n = setRowValue({ ...n, row: { ...r, rank, values } }, collectionId, pid, b === undefined ? null : b, clock);
    values = { ...n.row!.values };
  }
  const out: NoteFile = { ...n, row: { ...r, collectionId, rank, values } };
  return top ? withSeen(out, clock, top) : out;
}

/** A collection's definition: name, properties and views as registers; its own fields under `~`. */
function projectCollection(def: CollectionDef | undefined, old: LocalCollection | undefined, row: LocalCollection | null, clock: HybridClock): { def: CollectionDef; c: string } | null {
  if (!row) return null;
  const next: CollectionDef = { ...(def ?? { properties: {}, views: {} }), properties: { ...(def?.properties ?? {}) }, views: { ...(def?.views ?? {}) } };
  let top: string | null = null;
  const bump = (c: string) => {
    if (!top || c > top) top = c;
  };
  if (!next.name || (old ? old.name !== row.name : next.name.v !== row.name)) {
    next.name = stampRegister(next.name, row.name, clock);
    bump(next.name.c);
  }
  const meta = { createdAt: row.createdAt, deletedAt: row.deletedAt ?? null };
  if (!next.properties[COLLECTION_META] || !same(next.properties[COLLECTION_META]!.v, meta)) {
    next.properties[COLLECTION_META] = stampRegister(next.properties[COLLECTION_META], meta as unknown, clock, false);
    bump(next.properties[COLLECTION_META]!.c);
  }
  for (const key of ["properties", "views"] as const) {
    const before = (old?.[key] ?? {}) as Record<string, unknown>;
    const after = (row[key] ?? {}) as Record<string, unknown>;
    for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const value = after[id] ?? null;
      const had = next[key][id];
      if (had && same(had.v, value)) continue;
      if (!had && value === null) continue;
      next[key][id] = stampRegister(had, value, clock, false);
      bump(next[key][id]!.c);
    }
  }
  return top ? { def: next, c: top } : null;
}

const FOLDER_SKIP = new Set(["id", "ordinal", "updatedAt"]);
const TAG_SKIP = new Set(["id", "ordinal"]);

function projectFolder(index: IndexFile, id: string, old: LocalFolder | undefined, row: LocalFolder | null, clock: HybridClock): IndexFile {
  const next: Record<string, unknown> = row ? { ...row } : { ...(old ?? {}), deletedAt: old?.deletedAt ?? Date.now() };
  const prev: Record<string, unknown> = old ? { ...old } : {};
  let out = index;
  for (const field of new Set([...Object.keys(next), ...Object.keys(prev)])) {
    if (FOLDER_SKIP.has(field)) continue;
    if (old && same(prev[field], next[field])) continue;
    if (field === "parentFolderId") out = setFolderField(out, id, "parentId", (next[field] ?? null) as string | null, clock);
    else if (field === "deletedAt") {
      out = setFolderField(out, id, "deleted", next[field] != null, clock);
      out = setFolderField(out, id, "deletedAt" as "deleted", regValue(next[field]) as never, clock);
    } else out = setFolderField(out, id, field as "name", regValue(next[field]) as never, clock);
  }
  return out;
}

function projectTag(index: IndexFile, id: string, old: LocalTag | undefined, row: LocalTag | null, clock: HybridClock): IndexFile {
  if (!row) return old ? setTagField(index, id, "deleted", true, clock) : index;
  let out = index;
  if (index.tags[id]?.deleted?.v) out = setTagField(out, id, "deleted", false, clock);
  const next = row as unknown as Record<string, unknown>;
  const prev = (old ?? {}) as Record<string, unknown>;
  for (const field of Object.keys(next)) {
    if (TAG_SKIP.has(field)) continue;
    if (old && same(prev[field], next[field])) continue;
    out = setTagField(out, id, field as "name", regValue(next[field]) as never, clock);
  }
  return out;
}

/** A whole row of a table that syncs through the index (null removes it). */
function setIndexRow(index: IndexFile, table: string, partition: string | undefined, id: string, value: unknown, clock: HybridClock): IndexFile {
  return setSetting(index, rowSetting(table, partition, id), value === null ? null : { value }, clock);
}

/** The part of `after` that changed since `before` (a journal record; merging it into `before` gives `after`). */
export function diffIndex(before: IndexFile, after: IndexFile): IndexFile {
  const delta = emptyIndex(after.libraryId);
  for (const key of ["folders", "tags", "settings", "deletedNotes"] as const) {
    const a = after[key] as Record<string, unknown>;
    const b = before[key] as Record<string, unknown>;
    for (const [id, v] of Object.entries(a)) if (!same(v, b[id])) (delta[key] as Record<string, unknown>)[id] = v;
  }
  delta.seen = { ...after.seen };
  return delta;
}

export { conflictVersionName };
