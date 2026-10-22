// The persistent local store (docs/LOCAL_MODE_PLAN.md §3.1, §3.6, §3.7): the rows the handlers read, kept in
// IndexedDB (replicaDb.ts), and the library folder they live in as note files, the index, history and
// attachments (packages/local-store), through the shell's file layer (LibraryHost).
//
//   commit   rows → stamped note and index edits (project.ts) → the native journal and IndexedDB, then
//            acknowledged: "Saved" means on this device. Each note is written to the folder after 1 s of
//            quiet, at most 5 s after its first unsaved change, and when the page hides.
//   sync     the folder → notes (merged, conflict copies and provider versions too, losses into history with a
//            notice) → rows (materialize.ts, as a mutation of the backend's own, so queries re-run). Run on
//            change events, every 30 s, on focus and on "Sync now". Every write is read-merge-write, and a
//            file that can't be read is never written over. Notes keep being written until the file holds
//            everything this device has (anti-entropy), so a provider that dropped an update is repaired.
//   open     what IndexedDB kept, then the journal replayed over it (a crash before IndexedDB or the folder
//            had it), then the folder; a new device shows the library from the other devices' catalogs
//            before its notes have downloaded.
import { ConvexError } from "convex/values";
import { canonicalJson, ulid } from "@folevi/editor-schema";
import {
  DEVICES_DIR,
  DEVICE_FORMAT,
  HybridClock,
  INDEX_DIR,
  INDEX_FILE,
  LIBRARY_FILE,
  NOTES_DIR,
  NOTE_VERSION,
  attachmentPath,
  buildCatalog,
  catalogPath,
  compactTombstones,
  conflictVersion,
  coveredPrefix,
  createManifest,
  decodeCatalog,
  decodeDevice,
  decodeIndex,
  decodeManifest,
  decodeNoteFile,
  decodeVersionFile,
  devicePath,
  emptyIndex,
  encodeCatalog,
  encodeDevice,
  encodeManifest,
  encodeVersionFile,
  historyDir,
  historyPath,
  hlcMs,
  indexCodec,
  isNotFound,
  isStub,
  mergeIndex,
  mergeNoteFiles,
  mergeVv,
  noteCodec,
  notePath,
  noteSum,
  observeNote,
  parseNotePath,
  parseVersionFileName,
  readMergeWrite,
  readRecords,
  replayJournal,
  resolveCatalog,
  stubExpired,
  writeOnce,
  type CatalogEntry,
  type CatalogFile,
  type Codec,
  type DeviceRecord,
  type IndexFile,
  type JournalRecord,
  type Loss,
  type NoteLike,
  type NoteStub,
  type VersionFile,
  type VersionVector,
} from "@folevi/local-store";
import { appendRecord } from "@folevi/local-store";
import type { LibraryInfo } from "@/lib/shell/types";
import { writeKeys, type CommitHints, type LocalIndexStorage, type LocalStore, type LocalTable, type LocalTables, type StoreHost, type StoreWrite } from "../store";
import { materialize, type MaterializeInput } from "./materialize";
import { project, type ConflictKept } from "./project";
import { openDefaultReplicaDb, parseRowKey, rowKey, type OpenReplicaDb, type ReplicaBatch, type ReplicaDb } from "./replicaDb";
import type { HealthItem, LibraryControl, LibraryDevice, LibraryHost, LibraryState, LibraryStatus } from "./types";

export interface LibraryStoreOptions {
  host: LibraryHost;
  /** The backend's device id (made a valid library device id: letters, digits and "_"). */
  deviceId: string;
  openDb?: OpenReplicaDb;
  device?: { name?: string; platform?: "mac" | "ios" | "android" | "web"; appVersion?: string };
  now?: () => number;
  /** Write a note this long after its last change (1 s)… */
  quietMs?: number;
  /** …and no later than this after its first unsaved one (5 s). */
  maxDelayMs?: number;
  /** Read the whole folder this often (30 s; 0 turns it off). */
  scanMs?: number;
  /** Where hiding and focus are heard (default: the page). Null: nowhere (tests). */
  page?: Pick<Window, "addEventListener" | "removeEventListener"> | null;
  /** Remembers the library id between launches (default: localStorage), for when the folder can't be read. */
  libraryIds?: { recall(): string | null; remember(id: string): void };
}

/** A device id as note files need it. */
export function libraryDeviceId(id: string): string {
  const clean = id.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 64);
  return clean || "device";
}

const LIBRARY_ID_KEY = "folevi:local-library-id";
const defaultLibraryIds = {
  recall: () => {
    try {
      return localStorage.getItem(LIBRARY_ID_KEY);
    } catch {
      return null;
    }
  },
  remember: (id: string) => {
    try {
      localStorage.setItem(LIBRARY_ID_KEY, id);
    } catch {
      // Without storage the folder's own id is read each launch.
    }
  },
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Dirty = { since: number; last: number };
type RoundOptions = { ingest?: boolean; force?: boolean; history?: Set<string>; maintain?: boolean };

interface SyncState {
  fileStates: [string, string][];
  diskSums: [string, string][];
  diskSeen: [string, VersionVector][];
  indexEtag: string | null;
  indexSeen: VersionVector | null;
  copies: [string, { id: string; etag: string }][];
  versionsMerged: [string, string[]][];
  catalogs: [string, { etag: string; file: CatalogFile }][];
  devices: [string, { etag: string; record: DeviceRecord }][];
  lastSyncAt: number | null;
  lastMaintenance: number;
}

interface WorkState {
  dirty: [string, Dirty][];
  indexDirty: boolean;
  history: [string, Uint8Array][];
  attachments: string[];
  removeHistory: string[];
  versionFiles: [string, { docId: string; name: string }][];
  remoteBlocks: [string, number][];
  remoteTitles: [string, number][];
  kept: [string, { name: string; file: VersionFile }[]][];
  materialize: string[];
}

export class LibraryStore implements LocalStore {
  readonly deviceId: string;
  readonly library: LibraryControl;
  readonly searchIndexStorage: LocalIndexStorage;

  private tables = new Map<string, Map<string, Map<string, unknown>>>();
  private notes = new Map<string, NoteLike>();
  private index: IndexFile;
  private clock: HybridClock;
  private listeners = new Set<(keys: readonly string[]) => void>();
  private statusListeners = new Set<() => void>();
  private host: StoreHost | null = null;
  private readonly now: () => number;
  private readonly quietMs: number;
  private readonly maxDelayMs: number;
  private state: LibraryState = "opening";
  private info: LibraryInfo | null = null;
  private error: string | null = null;
  private syncing = false;

  // What the folder holds, as last read or written.
  private fileStates = new Map<string, string>();
  private diskSums = new Map<string, string>();
  private diskSeen = new Map<string, VersionVector>();
  private indexEtag: string | null = null;
  private indexSeen: VersionVector | null = null;
  private copies = new Map<string, { id: string; etag: string }>();
  private versionsMerged = new Map<string, string[]>();
  private catalogs = new Map<string, { etag: string; file: CatalogFile }>();
  private devices = new Map<string, { etag: string; record: DeviceRecord }>();
  private lastSyncAt: number | null = null;
  private lastMaintenance = 0;

  // What this device still has to do.
  private dirty = new Map<string, Dirty>();
  private indexDirty = false;
  private pendingHistory = new Map<string, Uint8Array>();
  private pendingAttachments = new Set<string>();
  private removeHistory: string[] = [];
  private versionFiles = new Map<string, { docId: string; name: string }>();
  private remoteBlocks = new Map<string, number>();
  private remoteTitles = new Map<string, number>();
  private kept = new Map<string, { name: string; file: VersionFile }[]>();
  private toMaterialize = new Set<string>();
  private indexToMaterialize = false;

  // This session only.
  private health = { unreadable: new Map<string, HealthItem>(), downloading: new Map<string, HealthItem>(), waiting: new Map<string, HealthItem>() };
  private downloadsAsked = new Set<string>();
  private historyLoaded = new Set<string>();
  private placeholders = new Map<string, { entry: CatalogEntry; state: "downloading" | "waiting" }>();
  private blocked = new Set<string>();
  private lastOwnFiles = { at: 0, catalog: "", device: "" };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private scan: ReturnType<typeof setInterval> | null = null;
  private unwatch: (() => void) | null = null;
  private watchTimer: ReturnType<typeof setTimeout> | null = null;
  private watchedHistory = new Set<string>();
  private want: RoundOptions | null = null;
  private running: Promise<void> | null = null;
  private writes: Promise<void> = Promise.resolve();
  private searchSnapshot: unknown = null;

  private constructor(
    private readonly hostFs: LibraryHost,
    private readonly db: ReplicaDb,
    readonly libraryId: string,
    private readonly opts: LibraryStoreOptions,
  ) {
    this.deviceId = libraryDeviceId(opts.deviceId);
    this.now = opts.now ?? Date.now;
    this.quietMs = opts.quietMs ?? 1000;
    this.maxDelayMs = opts.maxDelayMs ?? 5000;
    this.index = emptyIndex(libraryId);
    this.clock = new HybridClock(this.deviceId, { now: this.now });
    this.library = {
      status: () => this.status(),
      subscribe: (cb) => {
        this.statusListeners.add(cb);
        return () => {
          this.statusListeners.delete(cb);
        };
      },
      unlock: (p) => this.unlock(p),
      syncNow: () => this.request({ ingest: true, force: true }),
      flush: () => this.request({ force: true }),
    };
    this.searchIndexStorage = {
      load: async () => this.searchSnapshot,
      save: async (snapshot) => {
        this.searchSnapshot = snapshot;
        await this.persist({ state: [["device:searchIndex", snapshot ?? null]] });
      },
    };
  }

  // ---- opening ------------------------------------------------------------------------------------------

  /** Opens the library: what this device kept, the journal over it, then (once bound) the folder. */
  static async open(opts: LibraryStoreOptions): Promise<LibraryStore> {
    const host = opts.host;
    const ids = opts.libraryIds ?? defaultLibraryIds;
    const info = await host.info();
    const libraryId = await LibraryStore.libraryIdOf(host, info, ids.recall(), opts.now ?? Date.now);
    ids.remember(libraryId);
    const db = await (opts.openDb ?? openDefaultReplicaDb)(libraryId);
    const store = new LibraryStore(host, db, libraryId, opts);
    store.info = info;
    await store.restore();
    store.state = info.locked ? "locked" : info.available ? "ready" : "unavailable";
    return store;
  }

  /** The library's id from its manifest (made now for a new library), or the one this device remembers. */
  private static async libraryIdOf(host: LibraryHost, info: LibraryInfo, remembered: string | null, now: () => number): Promise<string> {
    for (let attempt = 0; attempt < 3 && info.available; attempt++) {
      try {
        const r = await host.read(LIBRARY_FILE);
        if ("bytes" in r) return decodeManifest(r.bytes).libraryId;
        break; // A placeholder: the folder is still arriving.
      } catch (error) {
        if (!isNotFound(error)) break;
      }
      const id = remembered ?? `lib_${ulid()}`;
      const w = await host.write(LIBRARY_FILE, encodeManifest(createManifest(id, now())), { ifMatch: null });
      if (!("mismatch" in w)) return id;
    }
    if (remembered) return remembered;
    throw new ConvexError({ code: "library_unavailable", message: "The library's folder can't be read right now." });
  }

  private async restore() {
    const snap = await this.db.load();
    for (const [key, row] of snap.rows) {
      const { table, partition, id } = parseRowKey(key);
      this.slot(table, partition, true).set(id, row);
      if (table === "blocks") this.indexBlock(partition, id, row as LocalTables["blocks"]);
    }
    this.notes = snap.notes;
    const idx = snap.state.get("index") as IndexFile | undefined;
    if (idx) this.index = idx;
    const last = snap.state.get("clock") as string | undefined;
    this.clock = new HybridClock(this.deviceId, { now: this.now, last: last ?? null });
    this.searchSnapshot = snap.state.get("device:searchIndex") ?? null;
    const sync = snap.state.get("sync") as SyncState | undefined;
    if (sync) {
      this.fileStates = new Map(sync.fileStates);
      this.diskSums = new Map(sync.diskSums);
      this.diskSeen = new Map(sync.diskSeen);
      this.indexEtag = sync.indexEtag;
      this.indexSeen = sync.indexSeen;
      this.copies = new Map(sync.copies);
      this.versionsMerged = new Map(sync.versionsMerged);
      this.catalogs = new Map(sync.catalogs);
      this.devices = new Map(sync.devices);
      this.lastSyncAt = sync.lastSyncAt;
      this.lastMaintenance = sync.lastMaintenance ?? 0;
    }
    const work = snap.state.get("work") as WorkState | undefined;
    if (work) {
      this.dirty = new Map(work.dirty);
      this.indexDirty = work.indexDirty;
      this.pendingHistory = new Map(work.history);
      this.pendingAttachments = new Set(work.attachments);
      this.removeHistory = work.removeHistory;
      this.versionFiles = new Map(work.versionFiles);
      this.remoteBlocks = new Map(work.remoteBlocks);
      this.remoteTitles = new Map(work.remoteTitles);
      this.kept = new Map(work.kept);
      for (const id of work.materialize) this.toMaterialize.add(id);
    }
    for (const n of this.notes.values()) observeNote(this.clock, n);
    // The journal holds every change acknowledged on this device; replaying it is a merge, so what IndexedDB
    // already had changes nothing and what it lost (a crash before it was written) comes back.
    const records = await readRecords(this.hostFs.journal);
    if (records.length) {
      const replica = { notes: this.notes, index: this.index as IndexFile | null };
      const touched = replayJournal(records, replica);
      this.index = replica.index ?? this.index;
      const t = this.now();
      for (const id of touched.notes) {
        this.toMaterialize.add(id);
        if (!this.dirty.has(id)) this.dirty.set(id, { since: t, last: t });
      }
      if (touched.index) {
        this.indexDirty = true;
        this.indexToMaterialize = true;
      }
      for (const n of this.notes.values()) observeNote(this.clock, n);
    }
  }

  // ---- LocalStore -----------------------------------------------------------------------------------------

  private slot(table: string, partition: string | undefined, create: true): Map<string, unknown>;
  private slot(table: string, partition: string | undefined, create: false): Map<string, unknown> | undefined;
  private slot(table: string, partition: string | undefined, create: boolean) {
    let t = this.tables.get(table);
    if (!t) {
      if (!create) return undefined;
      this.tables.set(table, (t = new Map()));
    }
    const key = partition ?? "";
    let p = t.get(key);
    if (!p && create) t.set(key, (p = new Map()));
    return p;
  }

  private row(table: string, id: string, partition?: string): unknown {
    return this.slot(table, partition, false)?.get(id);
  }

  async get<T extends LocalTable>(table: T, id: string, partition?: string): Promise<LocalTables[T] | undefined> {
    const v = this.row(table, id, partition);
    if (v === undefined) {
      if (table === "versions" && partition) this.loadHistorySoon(partition);
      return undefined;
    }
    if (table === "files") return (await this.withBlob(v as LocalTables["files"])) as LocalTables[T];
    if (table === "versions" && partition) this.loadHistorySoon(partition);
    return copyRow(v as LocalTables[T], table);
  }

  async list<T extends LocalTable>(table: T, partition?: string): Promise<LocalTables[T][]> {
    if (table === "versions" && partition) this.loadHistorySoon(partition);
    const out: LocalTables[T][] = [];
    const t = this.tables.get(table);
    if (!t) return out;
    const parts = partition !== undefined || table === "blocks" ? [t.get(partition ?? "")] : [...t.values()];
    for (const p of parts) for (const v of p?.values() ?? []) out.push(table === "files" ? ((await this.withBlob(v as LocalTables["files"])) as LocalTables[T]) : copyRow(v as LocalTables[T], table));
    return out;
  }

  /** Live blocks by type, across notes (blocksOfTypes): type → `<note>\u0001<block>`. */
  private byType = new Map<string, Set<string>>();
  private blockType = new Map<string, string>();

  private indexBlock(partition: string | undefined, id: string, row: LocalTables["blocks"] | null) {
    const key = `${partition ?? ""}\u0001${id}`;
    const had = this.blockType.get(key);
    if (had !== undefined) {
      this.byType.get(had)?.delete(key);
      this.blockType.delete(key);
    }
    if (!row || row.deletedAt !== null) return;
    let set = this.byType.get(row.type);
    if (!set) this.byType.set(row.type, (set = new Set()));
    set.add(key);
    this.blockType.set(key, row.type);
  }

  async blocksOfTypes(types: readonly string[]): Promise<LocalTables["blocks"][]> {
    const out: LocalTables["blocks"][] = [];
    for (const type of new Set(types))
      for (const key of this.byType.get(type) ?? []) {
        const [partition, id] = key.split("\u0001");
        const row = this.row("blocks", id!, partition || undefined);
        if (row) out.push(copyRow(row as LocalTables["blocks"], "blocks"));
      }
    return out;
  }

  subscribe(listener: (keys: readonly string[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  bind(host: StoreHost): void {
    this.host = host;
    this.unwatch = this.hostFs.watch((changes) => this.onWatch(changes));
    const scanMs = this.opts.scanMs ?? 30_000;
    if (scanMs > 0) this.scan = setInterval(() => void this.request({ ingest: true }), scanMs);
    const page = this.opts.page === undefined ? (typeof window !== "undefined" ? window : null) : this.opts.page;
    if (page) {
      page.addEventListener("pagehide", this.onHide);
      page.addEventListener("visibilitychange", this.onVisibility);
      page.addEventListener("focus", this.onFocus);
    }
    void this.request({ ingest: true, maintain: true });
  }

  private onHide = () => void this.request({ force: true });
  private onFocus = () => void this.request({ ingest: true });
  private onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") void this.request({ force: true });
    else void this.request({ ingest: true });
  };

  private onWatch(changes: { path: string; kind: string }[]) {
    for (const c of changes) {
      const m = /^history\/([^/]+)\//.exec(c.path);
      if (m && this.historyLoaded.has(m[1]!)) this.watchedHistory.add(m[1]!);
    }
    if (this.watchTimer) return;
    this.watchTimer = setTimeout(() => {
      this.watchTimer = null;
      const history = new Set(this.watchedHistory);
      this.watchedHistory.clear();
      void this.request({ ingest: true, history });
    }, 100);
  }

  async commit(writes: readonly StoreWrite[], hints?: CommitHints): Promise<void> {
    if (this.state === "closed") throw new Error("The local library is closed.");
    if (hints?.origin === "disk") {
      await this.applyRows(writes);
      return;
    }
    if (this.state === "locked" && this.row("meta", "profile") === undefined && writes.some((w) => w.table === "meta" && w.id === "profile")) {
      // A device that hasn't unlocked the library yet mustn't start a second one inside it.
      throw new ConvexError({ code: "library_locked", message: "Enter the library's passphrase first." });
    }
    const env = {
      clock: this.clock,
      note: (id: string) => this.notes.get(id),
      before: (table: string, id: string, partition: string | undefined) => this.row(table, id, partition),
      index: this.index,
      libraryId: this.libraryId,
      remoteBlockRev: (docId: string, blockId: string) => this.remoteBlocks.get(`${docId}/${blockId}`),
      remoteTitleRev: (docId: string) => this.remoteTitles.get(docId),
      versionFile: (rowId: string) => this.versionFiles.get(rowId),
      bases: hints?.bases,
    };
    const startIndex = this.index;
    const bases = new Map([...new Set(writes.flatMap((w) => [w.id, w.partition ?? ""]))].map((id) => [id, this.notes.get(id)]));
    const p = project(writes, env);
    // On this device before it's acknowledged: the journal (native, fsync'd) and IndexedDB.
    const journal = (async () => {
      for (const r of p.records) await appendRecord(this.hostFs.journal, r);
    })();
    const t = this.now();
    for (const [id, note] of p.notes) {
      this.absorb(id, note, bases.has(id) ? bases.get(id) : undefined);
      const d = this.dirty.get(id);
      this.dirty.set(id, { since: d?.since ?? t, last: t });
    }
    if (p.index) {
      this.index = this.index === startIndex ? p.index : mergeIndex(this.index, p.index);
      this.indexDirty = true;
    }
    for (const [path, bytes] of p.history) this.pendingHistory.set(path, bytes);
    for (const sha of p.attachments.keys()) this.pendingAttachments.add(sha);
    this.removeHistory.push(...p.removeHistory);
    for (const [rowId, where] of p.versionFiles) this.versionFiles.set(rowId, where);
    for (const k of p.conflicts) this.keep(k);
    const batch = this.rowBatch(writes);
    batch.notes = [...p.notes.keys()].map((id) => [id, this.notes.get(id) ?? null]);
    batch.state = this.workState();
    await Promise.all([journal, this.persist(batch)]);
    this.scheduleFlush();
    // An attachment is shown by its library URL (shell.library.fileUrl) as soon as it's uploaded: its bytes go
    // to files/<aa>/<sha256> now, not with the next note flush.
    if (p.attachments.size) void this.request({});
    // Notices and kept versions from edits that overwrote another device's: their rows follow at once.
    if (p.conflicts.length) {
      for (const k of p.conflicts) this.toMaterialize.add(k.docId);
      void this.request({});
    }
  }

  /** Rows written by the backend (a materialize pass, or anything else that only changes rows). */
  private async applyRows(writes: readonly StoreWrite[]) {
    await this.persist(this.rowBatch(writes));
  }

  /** Applies row writes in memory, and returns them as an IndexedDB batch. */
  private rowBatch(writes: readonly StoreWrite[]): ReplicaBatch {
    const rows: [string, unknown][] = [];
    for (const w of writes) {
      const s = this.slot(w.table, w.partition, true);
      if (w.value === null) s.delete(w.id);
      else s.set(w.id, copyRow(w.value, w.table));
      if (w.table === "blocks") this.indexBlock(w.partition, w.id, w.value as LocalTables["blocks"] | null);
      rows.push([rowKey(w.table, w.partition, w.id), w.value === null ? null : stripBlob(w.value, w.table)]);
    }
    return { rows };
  }

  /** IndexedDB writes in order. */
  private persist(batch: ReplicaBatch): Promise<void> {
    const run = this.writes.then(() => this.db.write(batch));
    this.writes = run.catch(() => undefined);
    return run;
  }

  private workState(): [string, unknown][] {
    const work: WorkState = {
      dirty: [...this.dirty],
      indexDirty: this.indexDirty,
      history: [...this.pendingHistory],
      attachments: [...this.pendingAttachments],
      removeHistory: this.removeHistory,
      versionFiles: [...this.versionFiles],
      remoteBlocks: [...this.remoteBlocks],
      remoteTitles: [...this.remoteTitles],
      kept: [...this.kept],
      materialize: [...this.toMaterialize],
    };
    return [
      ["work", work],
      ["clock", this.clock.peek()],
      ["index", this.index],
    ];
  }

  private syncState(): [string, unknown][] {
    const sync: SyncState = {
      fileStates: [...this.fileStates],
      diskSums: [...this.diskSums],
      diskSeen: [...this.diskSeen],
      indexEtag: this.indexEtag,
      indexSeen: this.indexSeen,
      copies: [...this.copies],
      versionsMerged: [...this.versionsMerged],
      catalogs: [...this.catalogs],
      devices: [...this.devices],
      lastSyncAt: this.lastSyncAt,
      lastMaintenance: this.lastMaintenance,
    };
    return [["sync", sync], ...this.workState()];
  }

  /**
   * Takes in a note state. `base` is what `incoming` was computed from: if the note hasn't changed since,
   * it's replaced; otherwise the two are merged, so nothing that happened in between is lost.
   */
  private absorb(id: string, incoming: NoteLike, base?: NoteLike): boolean {
    const cur = this.notes.get(id);
    if (!cur || (base !== undefined && cur === base)) {
      this.notes.set(id, incoming);
      return !cur || noteSum(cur) !== noteSum(incoming);
    }
    const r = mergeNoteFiles(cur, incoming);
    this.lost(r.losses);
    const changed = noteSum(cur) !== noteSum(r.file);
    this.notes.set(id, r.file);
    return changed;
  }

  /** Concurrent edits that lost in a merge: their history files, and rows for them. */
  private lost(losses: readonly Loss[]) {
    for (const loss of losses) {
      const { name, file } = conflictVersion(loss);
      const path = historyPath(loss.docId, name);
      if (!this.pendingHistory.has(path)) this.pendingHistory.set(path, encodeVersionFile(file));
      this.keep({ docId: loss.docId, name, file });
    }
  }

  private keep(k: ConflictKept) {
    const list = this.kept.get(k.docId) ?? [];
    if (!list.some((e) => e.name === k.name)) list.push({ name: k.name, file: k.file });
    this.kept.set(k.docId, list);
    this.toMaterialize.add(k.docId);
  }

  // ---- files of rows ----------------------------------------------------------------------------------

  /** An attachment row with its bytes, read from the library the first time something asks. */
  private async withBlob(row: LocalTables["files"]): Promise<LocalTables["files"]> {
    if (row.blob) return { ...row };
    let blob: Blob | null = null;
    if (this.state !== "locked") {
      try {
        const r = await this.hostFs.read(attachmentPath(row.sha256));
        if ("bytes" in r) blob = new Blob([r.bytes as Uint8Array<ArrayBuffer>], { type: row.mimeType });
        else void this.hostFs.startDownload([attachmentPath(row.sha256)]).catch(() => undefined);
      } catch {
        // Not here yet: Library health lists it as waiting.
      }
    }
    if (!blob) {
      this.mark("waiting", attachmentPath(row.sha256), row.documentId, null);
      return { ...row, blob: new Blob([], { type: row.mimeType }) };
    }
    const full = { ...row, blob };
    this.slot("files", undefined, true).set(row.id, full);
    void this.persist({ rows: [[rowKey("files", undefined, row.id), full]] });
    return { ...full };
  }

  // ---- the folder -------------------------------------------------------------------------------------

  private scheduleFlush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty.size && !this.indexDirty) return;
    let due = Infinity;
    for (const [id, d] of this.dirty) if (!this.blocked.has(id)) due = Math.min(due, d.last + this.quietMs, d.since + this.maxDelayMs);
    if (this.indexDirty) due = Math.min(due, this.now() + this.quietMs);
    if (due === Infinity) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.request({});
    }, Math.max(0, due - this.now()));
  }

  /** Runs a sync round (rounds never overlap; requests made meanwhile are folded into the next one). */
  private request(o: RoundOptions): Promise<void> {
    if (this.state === "closed") return Promise.resolve();
    const w = this.want ?? {};
    const history = new Set([...(w.history ?? []), ...(o.history ?? [])]);
    this.want = { ingest: w.ingest || o.ingest, force: w.force || o.force, maintain: w.maintain || o.maintain, history };
    this.running ??= (async () => {
      try {
        while (this.want) {
          const next = this.want;
          this.want = null;
          try {
            await this.round(next);
          } catch (e) {
            this.error = errorText(e);
            this.notifyStatus();
          }
        }
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async round(o: RoundOptions) {
    if (this.state === "closed") return;
    this.info = await this.hostFs.info().catch(() => this.info);
    if (this.info?.locked) this.state = "locked";
    else if (this.info && !this.info.available) this.state = "unavailable";
    else this.state = "ready";
    if (this.state !== "ready") {
      await this.materializePending();
      this.notifyStatus();
      return;
    }
    this.syncing = true;
    this.notifyStatus();
    try {
      await this.writePending();
      if (o.ingest) {
        this.blocked.clear();
        await this.ingestNotes();
        await this.ingestIndexDir();
        await this.ingestDevices();
        this.resolvePlaceholders();
      }
      for (const docId of o.history ?? []) await this.loadHistory(docId);
      if (o.maintain) this.maintain();
      await this.flushNotes(!!o.force);
      await this.flushIndex(!!o.force);
      await this.writeOwnFiles(!!o.force);
      await this.truncateJournal();
      await this.materializePending();
      this.error = null;
      this.lastSyncAt = this.now();
      if (o.ingest) await this.checkAttachments();
    } finally {
      this.syncing = false;
      await this.persist({ state: this.syncState() });
      this.scheduleFlush();
      this.notifyStatus();
    }
  }

  /** History files and attachments go before any note that refers to them. */
  private async writePending() {
    for (const [path, bytes] of [...this.pendingHistory]) {
      try {
        await writeOnce(this.hostFs, path, bytes);
        this.pendingHistory.delete(path);
      } catch (e) {
        this.error = errorText(e);
      }
    }
    for (const sha of [...this.pendingAttachments]) {
      const row = this.findFile(sha);
      if (!row?.blob) {
        this.pendingAttachments.delete(sha);
        continue;
      }
      try {
        await writeOnce(this.hostFs, attachmentPath(sha), new Uint8Array(await row.blob.arrayBuffer()));
        this.pendingAttachments.delete(sha);
      } catch (e) {
        this.error = errorText(e);
      }
    }
    for (const path of this.removeHistory.splice(0)) await this.hostFs.remove(path).catch(() => undefined);
  }

  private findFile(sha: string): LocalTables["files"] | undefined {
    for (const p of this.tables.get("files")?.values() ?? []) for (const f of p.values()) if ((f as LocalTables["files"]).sha256 === sha) return f as LocalTables["files"];
    return undefined;
  }

  private mark(kind: "unreadable" | "downloading" | "waiting", path: string, documentId: string | null, detail: string | null) {
    const map = this.health[kind];
    const had = map.get(path);
    const title = documentId ? (((this.row("documents", documentId) as LocalTables["documents"] | undefined)?.title ?? null) || null) : null;
    map.set(path, { path, documentId, title, ...(detail ? { detail } : {}), since: had?.since ?? this.now() });
  }

  private clear(path: string) {
    this.health.unreadable.delete(path);
    this.health.downloading.delete(path);
    this.health.waiting.delete(path);
  }

  private async ingestNotes() {
    const entries = await this.hostFs.list(NOTES_DIR);
    const listed = new Set<string>();
    const ask: string[] = [];
    for (const entry of entries) {
      const parsed = parseNotePath(entry.path);
      if (!parsed) continue;
      listed.add(entry.path);
      if (!entry.downloaded || parsed.placeholder) {
        if (!this.notes.has(parsed.id)) this.mark("downloading", entry.path, parsed.id, null);
        if (!this.downloadsAsked.has(entry.path)) {
          this.downloadsAsked.add(entry.path);
          ask.push(entry.path);
        }
        continue;
      }
      const changed = this.fileStates.get(entry.path) !== entry.etag;
      if (changed) {
        let file: NoteLike;
        let etag: string;
        try {
          const r = await this.hostFs.read(entry.path);
          if ("notDownloaded" in r) {
            this.mark("downloading", entry.path, parsed.id, null);
            continue;
          }
          file = decodeNoteFile(r.bytes);
          etag = r.etag;
        } catch (e) {
          // Not arrived yet, damaged or can't be decrypted: never written over; tried again next time.
          this.mark("unreadable", entry.path, parsed.id, errorText(e));
          continue;
        }
        this.clear(entry.path);
        observeNote(this.clock, file);
        if (this.absorb(file.id, file)) this.toMaterialize.add(file.id);
        this.fileStates.set(entry.path, etag);
        if (parsed.copy || file.id !== parsed.id) {
          this.copies.set(entry.path, { id: file.id, etag });
          this.markDirty(file.id);
        } else {
          this.diskSums.set(file.id, noteSum(file));
          this.diskSeen.set(file.id, file.seen);
          // Anti-entropy: the file lacks something this device has (a provider dropped an update).
          if (noteSum(this.notes.get(file.id)!) !== this.diskSums.get(file.id)) this.markDirty(file.id);
        }
      }
      if (entry.hasConflicts && !parsed.copy) await this.ingestConflictVersions(entry.path, parsed.id);
    }
    // A note file that went missing (not a delete: deletes are stubs) is written again.
    for (const path of [...this.fileStates.keys()]) {
      if (!path.startsWith(`${NOTES_DIR}/`) || listed.has(path)) continue;
      this.fileStates.delete(path);
      const parsed = parseNotePath(path);
      if (!parsed || parsed.copy) {
        this.copies.delete(path);
        continue;
      }
      this.diskSums.delete(parsed.id);
      this.diskSeen.delete(parsed.id);
      if (this.notes.has(parsed.id)) this.markDirty(parsed.id);
    }
    if (ask.length) await this.hostFs.startDownload(ask).catch(() => undefined);
  }

  private async ingestConflictVersions(path: string, id: string) {
    let versions: { id: string; bytes: Uint8Array }[];
    try {
      versions = await this.hostFs.conflictVersions(path);
    } catch (e) {
      this.mark("unreadable", path, id, errorText(e));
      return;
    }
    const merged = this.versionsMerged.get(path) ?? [];
    for (const v of versions) {
      if (merged.includes(v.id)) continue;
      try {
        const file = decodeNoteFile(v.bytes);
        observeNote(this.clock, file);
        if (this.absorb(file.id, file)) this.toMaterialize.add(file.id);
        merged.push(v.id);
        this.markDirty(file.id);
      } catch (e) {
        this.mark("unreadable", `${path}#${v.id}`, id, errorText(e));
      }
    }
    if (merged.length) this.versionsMerged.set(path, merged);
  }

  private markDirty(id: string) {
    if (this.dirty.has(id)) return;
    const t = this.now();
    // Due at once: it's the folder that's behind, not an edit still being typed.
    this.dirty.set(id, { since: t - this.maxDelayMs, last: t - this.quietMs });
  }

  private async ingestIndexDir() {
    let entries: Awaited<ReturnType<LibraryHost["list"]>>;
    try {
      entries = await this.hostFs.list(INDEX_DIR);
    } catch (e) {
      this.mark("unreadable", INDEX_DIR, null, errorText(e));
      return;
    }
    for (const entry of entries) {
      if (!entry.downloaded) {
        this.mark("downloading", entry.path, null, null);
        continue;
      }
      if (entry.path === INDEX_FILE) {
        if (entry.etag === this.indexEtag) continue;
        try {
          const r = await this.hostFs.read(INDEX_FILE);
          if ("notDownloaded" in r) continue;
          const disk = decodeIndex(r.bytes);
          this.clear(INDEX_FILE);
          const merged = mergeIndex(this.index, disk);
          if (canonicalJson(merged) !== canonicalJson(this.index)) this.indexToMaterialize = true;
          this.index = merged;
          this.indexEtag = r.etag;
          this.indexSeen = disk.seen;
          if (canonicalJson({ ...merged, sum: undefined }) !== canonicalJson({ ...disk, sum: undefined })) this.indexDirty = true;
        } catch (e) {
          this.mark("unreadable", INDEX_FILE, null, errorText(e));
        }
        continue;
      }
      const m = /^index\/catalog\/([A-Za-z0-9_]+)\.fcat$/.exec(entry.path);
      if (!m || m[1] === this.deviceId || this.catalogs.get(m[1]!)?.etag === entry.etag) continue;
      try {
        const r = await this.hostFs.read(entry.path);
        if ("bytes" in r) this.catalogs.set(m[1]!, { etag: r.etag, file: decodeCatalog(r.bytes) });
        this.clear(entry.path);
      } catch (e) {
        this.mark("unreadable", entry.path, null, errorText(e));
      }
    }
    if (!entries.some((e) => e.path === INDEX_FILE) && this.indexEtag !== null) {
      this.indexEtag = null;
      this.indexDirty = true;
    }
  }

  private async ingestDevices() {
    let entries: Awaited<ReturnType<LibraryHost["list"]>>;
    try {
      entries = await this.hostFs.list(DEVICES_DIR);
    } catch {
      return;
    }
    let changed = false;
    for (const entry of entries) {
      const m = /^devices\/([A-Za-z0-9_]+)\.json$/.exec(entry.path);
      if (!m || !entry.downloaded || this.devices.get(m[1]!)?.etag === entry.etag) continue;
      try {
        const r = await this.hostFs.read(entry.path);
        if ("bytes" in r) {
          this.devices.set(m[1]!, { etag: r.etag, record: decodeDevice(r.bytes) });
          changed = true;
        }
      } catch {
        // A record half written: read next time.
      }
    }
    if (changed) this.devicesToMaterialize = true;
  }

  private devicesToMaterialize = false;

  /** Notes only other devices' catalogs know of yet: shown from the catalog until their files arrive. */
  private resolvePlaceholders() {
    if (!this.catalogs.size) return;
    const resolved = resolveCatalog([...this.catalogs.values()].map((c) => c.file), new Map(), hlcMs);
    const deleted = this.index.deletedNotes;
    const next = new Map<string, { entry: CatalogEntry; state: "downloading" | "waiting" }>();
    for (const [id, entry] of resolved) {
      if (this.notes.has(id) || deleted[id]) continue;
      const state = [...this.health.downloading.values()].some((h) => h.documentId === id) ? "downloading" : "waiting";
      next.set(id, { entry, state });
      const prev = this.placeholders.get(id);
      if (!prev || prev.state !== state || prev.entry.c !== entry.c) this.toMaterialize.add(`placeholder:${id}`);
    }
    this.placeholders = next;
  }

  private async flushNotes(force: boolean) {
    const t = this.now();
    for (const [id, d] of [...this.dirty]) {
      if (this.blocked.has(id)) continue;
      if (!force && t < Math.min(d.last + this.quietMs, d.since + this.maxDelayMs)) continue;
      await this.flushNote(id);
    }
  }

  private async flushNote(id: string) {
    const snapshot = this.notes.get(id);
    if (!snapshot) {
      this.dirty.delete(id);
      return;
    }
    const path = notePath(id);
    const losses: Loss[] = [];
    const codec: Codec<NoteLike> = {
      ...noteCodec,
      merge: (a, b) => {
        const r = mergeNoteFiles(a, b);
        losses.push(...r.losses);
        return r.file;
      },
    };
    const result = await readMergeWrite(this.hostFs, path, codec, snapshot, {
      // The losers are safe in history before a note without them is written.
      beforeCommit: async () => {
        for (const loss of losses) {
          const { name, file } = conflictVersion(loss);
          await writeOnce(this.hostFs, historyPath(loss.docId, name), encodeVersionFile(file));
        }
      },
    });
    if (result.status === "unreadable") {
      this.mark("unreadable", path, id, errorText(result.error));
      this.blocked.add(id);
      return;
    }
    if (result.status === "notDownloaded") {
      this.mark("downloading", path, id, null);
      this.blocked.add(id);
      return;
    }
    if (result.status === "busy") return;
    this.clear(path);
    for (const loss of losses) this.keep({ docId: loss.docId, ...conflictVersion(loss) });
    observeNote(this.clock, result.value);
    const untouched = this.notes.get(id) === snapshot;
    if (this.absorb(id, result.value, snapshot)) this.toMaterialize.add(id);
    if (noteSum(result.value) !== noteSum(snapshot)) this.toMaterialize.add(id);
    this.fileStates.set(path, result.etag);
    this.diskSums.set(id, noteSum(result.value));
    this.diskSeen.set(id, result.value.seen);
    if (untouched) this.dirty.delete(id);
    for (const [copyPath, copy] of [...this.copies]) {
      if (copy.id !== id) continue;
      await this.hostFs.remove(copyPath, { ifMatch: copy.etag }).catch(() => undefined);
      this.copies.delete(copyPath);
      this.fileStates.delete(copyPath);
    }
    const versions = this.versionsMerged.get(path);
    if (versions?.length) {
      await this.hostFs.resolveConflicts(path, versions).catch(() => undefined);
      this.versionsMerged.delete(path);
    }
  }

  private async flushIndex(force: boolean) {
    if (!this.indexDirty) return;
    void force;
    const snapshot = this.index;
    const r = await readMergeWrite(this.hostFs, INDEX_FILE, indexCodec, snapshot);
    if (r.status === "unreadable") {
      this.mark("unreadable", INDEX_FILE, null, errorText(r.error));
      return;
    }
    if (r.status !== "written" && r.status !== "unchanged") return;
    const merged = this.index === snapshot ? r.value : mergeIndex(this.index, r.value);
    if (canonicalJson(merged) !== canonicalJson(this.index)) this.indexToMaterialize = true;
    this.index = merged;
    this.indexEtag = r.etag;
    this.indexSeen = r.value.seen;
    if (this.index === r.value) this.indexDirty = false;
  }

  /** This device's catalog and record: what a new device shows first, and what this one has seen. */
  private async writeOwnFiles(force: boolean) {
    const t = this.now();
    if (!force && t - this.lastOwnFiles.at < 10_000) return;
    const catalog = buildCatalog(this.deviceId, this.notes.values(), 0, hlcMs);
    const catalogKey = canonicalJson(catalog.notes);
    if (catalogKey !== this.lastOwnFiles.catalog && this.notes.size) {
      await this.hostFs.write(catalogPath(this.deviceId), encodeCatalog({ ...catalog, writtenAt: t }), {});
      this.lastOwnFiles.catalog = catalogKey;
    }
    let heads: VersionVector = this.index.seen;
    for (const n of this.notes.values()) heads = mergeVv(heads, n.seen);
    const name = this.opts.device?.name ?? ((this.row("meta", `device:${this.opts.deviceId}`) as { name?: string } | undefined)?.name || "This device");
    const record: DeviceRecord = {
      format: DEVICE_FORMAT,
      v: 1,
      deviceId: this.deviceId,
      name,
      platform: this.opts.device?.platform ?? "mac",
      appVersion: this.opts.device?.appVersion ?? "",
      formatVersion: NOTE_VERSION,
      lastSeen: t,
      heads,
    };
    const deviceKey = canonicalJson({ ...record, lastSeen: 0 });
    if (deviceKey !== this.lastOwnFiles.device || force || t - this.lastOwnFiles.at > 300_000) {
      const w = await this.hostFs.write(devicePath(this.deviceId), encodeDevice(record), {});
      this.lastOwnFiles.device = deviceKey;
      if ("etag" in w) this.devices.set(this.deviceId, { etag: w.etag, record });
    }
    this.lastOwnFiles.at = t;
  }

  /** Drops the journal records the folder holds now. */
  private async truncateJournal() {
    const records = await readRecords(this.hostFs.journal);
    if (!records.length) return;
    const notes = new Map([...this.diskSeen].map(([id, seen]) => [id, { seen } as NoteLike]));
    const n = coveredPrefix(records as (JournalRecord | null)[], { notes, index: this.indexSeen ? ({ seen: this.indexSeen } as IndexFile) : null });
    if (n > 0) await this.hostFs.journal.truncate(n);
  }

  /** Tombstones every device has seen past (90 days), and stubs past their 180 days (§3.5). */
  private maintain() {
    const t = this.now();
    if (t - this.lastMaintenance < 24 * 3_600_000) return;
    this.lastMaintenance = t;
    const devices = [...this.devices.values()].map((d) => d.record);
    for (const [id, note] of [...this.notes]) {
      if (isStub(note)) {
        if (stubExpired(note as NoteStub, t)) {
          const etag = this.fileStates.get(notePath(id));
          void this.hostFs.remove(notePath(id), etag ? { ifMatch: etag } : undefined).catch(() => undefined);
          this.notes.delete(id);
          this.dirty.delete(id);
          void this.persist({ notes: [[id, null]] });
        }
        continue;
      }
      const r = compactTombstones(note, devices, t);
      if (r.removed.length) {
        this.notes.set(id, r.note);
        this.markDirty(id);
        this.toMaterialize.add(id);
      }
    }
  }

  private async checkAttachments() {
    const referenced = new Map<string, string>();
    for (const n of this.notes.values()) if (!isStub(n)) for (const f of Object.values(n.files)) referenced.set(f.sha256, n.id);
    if (!referenced.size) return;
    let present: Set<string>;
    try {
      present = new Set((await this.hostFs.list("files")).filter((e) => e.downloaded).map((e) => e.path));
    } catch {
      return;
    }
    for (const [sha, docId] of referenced) {
      const path = attachmentPath(sha);
      if (present.has(path)) this.health.waiting.delete(path);
      else if (this.findFile(sha)?.blob) this.pendingAttachments.add(sha);
      else this.mark("waiting", path, docId, null);
    }
  }

  // ---- version history from the folder ----------------------------------------------------------------

  private loadHistorySoon(docId: string) {
    if (this.historyLoaded.has(docId) || this.state === "closed") return;
    this.historyLoaded.add(docId);
    void this.request({ history: new Set([docId]) });
  }

  private historyNames(docId: string): Set<string> {
    const out = new Set<string>();
    for (const v of this.versionFiles.values()) if (v.docId === docId) out.add(v.name);
    for (const k of this.kept.get(docId) ?? []) out.add(k.name);
    return out;
  }

  private async loadHistory(docId: string) {
    let entries: Awaited<ReturnType<LibraryHost["list"]>>;
    try {
      entries = await this.hostFs.list(historyDir(docId));
    } catch {
      return;
    }
    const known = this.historyNames(docId);
    const found: { name: string; file: VersionFile }[] = [];
    for (const entry of entries) {
      const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
      if (!parseVersionFileName(name) || known.has(name) || !entry.downloaded) continue;
      try {
        const r = await this.hostFs.read(entry.path);
        if (!("bytes" in r)) continue;
        const file = decodeVersionFile(r.bytes);
        found.push({ name, file });
        const rowId = this.versionRowId(docId, name, file);
        this.versionFiles.set(rowId, { docId, name });
      } catch {
        // Half arrived: read again when it changes.
      }
    }
    if (found.length) {
      this.kept.set(docId, [...(this.kept.get(docId) ?? []), ...found]);
      this.toMaterialize.add(docId);
    }
  }

  private versionRowId = (docId: string, name: string, file: VersionFile | null): string => {
    for (const [rowId, v] of this.versionFiles) if (v.docId === docId && v.name === name) return rowId;
    const app = (file as (VersionFile & { app?: { id?: unknown } }) | null)?.app;
    if (typeof app?.id === "string" && app.id.startsWith(`${docId}~`)) return app.id;
    return `${docId}~${name.replace(/\.fver$/, "")}`;
  };

  // ---- rows from the folder -----------------------------------------------------------------------------

  private async materializePending() {
    if (!this.host) return;
    const ids = [...this.toMaterialize];
    if (!ids.length && !this.indexToMaterialize && !this.devicesToMaterialize) return;
    this.toMaterialize.clear();
    const withIndex = this.indexToMaterialize;
    this.indexToMaterialize = false;
    const withDevices = this.devicesToMaterialize;
    this.devicesToMaterialize = false;
    const notes = new Map<string, NoteLike | undefined>();
    const placeholders = new Map<string, { entry: CatalogEntry; state: "downloading" | "waiting" }>();
    const versions = new Map<string, { name: string; file: VersionFile }[]>();
    for (const id of ids) {
      if (id.startsWith("placeholder:")) {
        const p = this.placeholders.get(id.slice(12));
        if (p) placeholders.set(id.slice(12), p);
        continue;
      }
      notes.set(id, this.notes.get(id));
      const kept = this.kept.get(id);
      if (kept?.length) versions.set(id, kept);
    }
    // Versions whose rows are made now are listed by row id from here on.
    for (const [docId, list] of versions) for (const k of list) this.versionFiles.set(this.versionRowId(docId, k.name, k.file), { docId, name: k.name });
    const input: MaterializeInput = {
      notes,
      ...(withIndex ? { index: this.index } : {}),
      placeholders,
      versions,
      devices: withDevices ? [...this.devices.values()].map((d) => ({ deviceId: d.record.deviceId, name: d.record.name })) : [],
      deviceId: this.deviceId,
      versionRowId: this.versionRowId,
    };
    try {
      let report: Awaited<ReturnType<typeof materialize>> | null = null;
      await this.host.ingest(async (ctx) => {
        report = await materialize(ctx, input);
      });
      for (const docId of versions.keys()) this.kept.delete(docId);
      const r = report as Awaited<ReturnType<typeof materialize>> | null;
      for (const [k, v] of r?.remoteBlocks ?? []) this.remoteBlocks.set(k, v);
      for (const [k, v] of r?.remoteTitles ?? []) this.remoteTitles.set(k, v);
    } catch (e) {
      // Tried again next round.
      for (const id of ids) this.toMaterialize.add(id);
      if (withIndex) this.indexToMaterialize = true;
      if (withDevices) this.devicesToMaterialize = true;
      throw e;
    }
  }

  // ---- status and controls ------------------------------------------------------------------------------

  private notifyStatus() {
    for (const cb of [...this.statusListeners]) {
      try {
        cb();
      } catch (e) {
        console.error("[local mode] A library status listener threw", e);
      }
    }
  }

  private statusCache: { key: string; value: LibraryStatus } | null = null;

  status(): LibraryStatus {
    const docs = this.tables.get("documents");
    let total = 0;
    let downloading = 0;
    for (const p of docs?.values() ?? [])
      for (const d of p.values()) {
        total++;
        if ((d as LocalTables["documents"]).pending) downloading++;
      }
    const devices: LibraryDevice[] = [...this.devices.values()]
      .map(({ record }) => ({ deviceId: record.deviceId, name: record.name, platform: record.platform, appVersion: record.appVersion, lastSeen: record.lastSeen, thisDevice: record.deviceId === this.deviceId }))
      .sort((a, b) => b.lastSeen - a.lastSeen);
    const value: LibraryStatus = {
      state: this.state,
      info: this.info,
      libraryId: this.libraryId,
      deviceId: this.deviceId,
      lastSyncAt: this.lastSyncAt,
      syncing: this.syncing,
      unsaved: this.dirty.size + (this.indexDirty ? 1 : 0),
      notes: { total, downloading },
      health: { unreadable: [...this.health.unreadable.values()], downloading: [...this.health.downloading.values()], waiting: [...this.health.waiting.values()] },
      devices,
      error: this.error,
    };
    // The same object while nothing changed (useSyncExternalStore compares by reference).
    const key = canonicalJson(value);
    if (this.statusCache?.key === key) return this.statusCache.value;
    this.statusCache = { key, value };
    return value;
  }

  private async unlock(passphrase: string): Promise<boolean> {
    if (!(await this.hostFs.unlock(passphrase))) return false;
    this.info = await this.hostFs.info();
    this.state = this.info.locked ? "locked" : "ready";
    this.notifyStatus();
    await this.request({ ingest: true, force: true });
    return !this.info.locked;
  }

  /** Every unsaved change written to the folder, watchers and timers stopped, IndexedDB closed. */
  async close(): Promise<void> {
    if (this.state === "closed") return;
    if (this.timer) clearTimeout(this.timer);
    if (this.watchTimer) clearTimeout(this.watchTimer);
    if (this.scan) clearInterval(this.scan);
    this.unwatch?.();
    const page = this.opts.page === undefined ? (typeof window !== "undefined" ? window : null) : this.opts.page;
    page?.removeEventListener("pagehide", this.onHide);
    page?.removeEventListener("visibilitychange", this.onVisibility);
    page?.removeEventListener("focus", this.onFocus);
    // The host's queue is finishing (backend.close waits for it): rows can't be materialized from here on.
    this.host = null;
    try {
      await this.request({ force: true });
    } catch {
      // What wasn't written stays in the journal and in IndexedDB.
    }
    this.state = "closed";
    await this.persist({ state: this.syncState() }).catch(() => undefined);
    await this.writes;
    await this.db.close();
    this.notifyStatus();
  }

  /** Test hook: stops everything without writing anything more (a crash). */
  async crash(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    if (this.watchTimer) clearTimeout(this.watchTimer);
    if (this.scan) clearInterval(this.scan);
    this.unwatch?.();
    this.state = "closed";
    this.host = null;
    await this.writes;
  }

  /** Test hook: waits for the current sync round and IndexedDB writes. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
    await this.writes;
  }

  /** Test hook: the note as this device holds it. */
  noteFile(id: string): NoteLike | undefined {
    return this.notes.get(id);
  }

  /** Emits keys to subscribers (rows this store changed by itself; normally the host announces them). */
  protected emit(writes: readonly StoreWrite[]) {
    const keys = new Set<string>();
    for (const w of writes) for (const k of writeKeys(w)) keys.add(k);
    for (const l of this.listeners) l([...keys]);
  }
}

function copyRow<T>(value: T, table: string): T {
  if (table === "files") return { ...(value as object) } as T;
  return structuredClone(value);
}

/** What IndexedDB keeps of a row (a Blob is kept as it is; everything else is plain data). */
function stripBlob(value: unknown, table: string): unknown {
  void table;
  return value;
}

export type { LibraryHost };
