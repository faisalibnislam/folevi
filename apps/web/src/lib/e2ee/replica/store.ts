// `SpaceReplicaStore`: the decrypted copy of one e2ee-active space, as a `LocalStore` for the local backend's
// handlers (docs/E2EE_DESIGN.md §6.5, WP7). It's read-only for handlers: no mutation is ever routed to the
// backend over it, and a commit throws `e2ee_replica_read_only`. Rows arrive from the pull (ingest.ts) and
// from the router's own accepted writes, through `ingest`, which announces the keys they change so device
// queries re-run.
//
// On a trusted device the rows are kept in IndexedDB `folevi-e2ee-<scopeKey>` (the local library's
// `replicaDb.ts` layout), so a launch shows the space before the first pull; a public session keeps them in
// memory only (§6.10).
import { ConvexError } from "convex/values";
import { MemoryStore, writeKeys, type CommitHints, type LocalBlock, type LocalDocument, type LocalIndexStorage, type LocalStore, type LocalTable, type LocalTables, type StoreWrite } from "@/lib/local/store";
import { IdbReplicaDb, MemoryReplicaDb, parseRowKey, rowKey, type ReplicaDb } from "@/lib/local/store/replicaDb";

/**
 * The database a space's replica is kept in (`folevi-e2ee-<scopeKey>`, §6.5), and the Web Lock and channel of the
 * window hosting it. A team workspace's also names whose copy it is (`…_<profileId>`): two accounts in one browser
 * can both belong to a workspace, each seeing what that account may see, and must never share a copy
 * (docs/MULTI_ACCOUNT_PLAN.md §4). Personal's scope id already names its owner.
 */
export function replicaDbName(scopeKey: string, profileId?: string | null): string {
  const base = `folevi-e2ee-${scopeKey.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  return profileId && !scopeKey.startsWith("personal:") ? `${base}_${profileId.replace(/[^A-Za-z0-9_-]/g, "_")}` : base;
}

export async function openReplicaDb(scopeKey: string, persist: boolean, profileId?: string | null): Promise<ReplicaDb> {
  const name = replicaDbName(scopeKey, profileId);
  // A workspace's copy from before copies were per account is only a cache: it's dropped (the pull fills the new one).
  if (profileId && persist && typeof indexedDB !== "undefined" && name !== replicaDbName(scopeKey)) {
    try {
      indexedDB.deleteDatabase(replicaDbName(scopeKey));
    } catch {
      /* nothing to drop */
    }
  }
  if (persist && typeof indexedDB !== "undefined") return await IdbReplicaDb.openNamed(name);
  // Not kept (a public session, or no IndexedDB): a fresh copy in memory each time, shared with nothing.
  return new MemoryReplicaDb();
}

/** What the replica's overlay (the engine's unsent edits, §6.5 "Pending edits") answers. */
export interface ReplicaOverlay {
  /** The note's blocks as this device has them now (sent or not), from the replica's `base`; null: as they are. */
  blocks(documentId: string, base: LocalBlock[]): LocalBlock[] | null;
  /** A note as this device has it now (a create or a title not sent yet), or null. */
  document(id: string, replica: LocalDocument | undefined): LocalDocument | null;
  /** Notes made on this device that the replica doesn't have yet. */
  extraDocuments(): LocalDocument[];
}

export class SpaceReplicaStore implements LocalStore {
  private mem = new MemoryStore();
  private overlay: ReplicaOverlay | null = null;
  private listeners = new Set<(keys: readonly string[]) => void>();
  private unsubscribeMem: () => void;
  searchIndexStorage?: LocalIndexStorage;

  constructor(private readonly db: ReplicaDb | null) {
    this.unsubscribeMem = this.mem.subscribe((keys) => this.emit(keys));
    if (db) this.searchIndexStorage = { load: async () => (await this.readState("searchIndex")) ?? null, save: (snapshot) => this.writeState([["searchIndex", snapshot]]) };
  }

  /** Reads what the database kept (a launch on a trusted device). */
  async load(): Promise<void> {
    if (!this.db) return;
    const snap = await this.db.load();
    const writes: StoreWrite[] = [];
    for (const [key, value] of snap.rows) {
      const { table, partition, id } = parseRowKey(key);
      writes.push({ table: table as LocalTable, id, partition, value } as StoreWrite);
    }
    if (writes.length) this.mem.ingest(writes);
  }

  /** Keeps the engine's unsent edits on top of what the replica holds (null: none). */
  setOverlay(overlay: ReplicaOverlay | null): void {
    this.overlay = overlay;
  }

  /** The overlay changed (the engine's state did): queries that read these notes re-run. */
  overlayChanged(documentIds: readonly string[]): void {
    const keys = new Set<string>(["catalog"]);
    for (const id of documentIds) {
      keys.add(`doc:${id}`);
      keys.add(`blocks:${id}`);
    }
    keys.add("blocks:any");
    this.emit([...keys]);
  }

  async get<T extends LocalTable>(table: T, id: string, partition?: string): Promise<LocalTables[T] | undefined> {
    if (this.overlay && table === "documents") {
      const base = (await this.mem.get("documents", id)) as LocalDocument | undefined;
      const over = this.overlay.document(id, base);
      return (over ?? base) as LocalTables[T] | undefined;
    }
    if (this.overlay && table === "blocks" && partition) {
      const over = this.overlay.blocks(partition, (await this.mem.list("blocks", partition)) as LocalBlock[]);
      if (over) return over.find((b) => b.id === id) as LocalTables[T] | undefined;
    }
    return await this.mem.get(table, id, partition);
  }

  async list<T extends LocalTable>(table: T, partition?: string): Promise<LocalTables[T][]> {
    const rows = await this.mem.list(table, partition);
    if (this.overlay && table === "blocks" && partition) {
      const over = this.overlay.blocks(partition, rows as LocalBlock[]);
      if (over) return over as LocalTables[T][];
    }
    if (this.overlay && table === "documents") {
      const docs = rows as LocalDocument[];
      const out = docs.map((d) => this.overlay!.document(d.id, d) ?? d);
      const have = new Set(out.map((d) => d.id));
      for (const extra of this.overlay.extraDocuments()) if (!have.has(extra.id)) out.push(extra);
      return out as LocalTables[T][];
    }
    return rows;
  }

  /** Handlers never write here (mutations aren't routed to the replica, §6.5). */
  async commit(_writes: readonly StoreWrite[], _hints?: CommitHints): Promise<void> {
    void _writes;
    void _hints;
    throw new ConvexError({ code: "e2ee_replica_read_only", message: "The encrypted space's copy on this device is read-only." });
  }

  /** Rows from the pull or from accepted writes: kept (and persisted), then announced. */
  async ingest(writes: readonly StoreWrite[], state?: [string, unknown][], o: { persist?: boolean } = {}): Promise<void> {
    if (!writes.length && !state?.length) return;
    if (writes.length) this.mem.ingest(writes);
    if (this.db && o.persist !== false) await this.db.write({ rows: writes.map((w) => [rowKey(w.table, w.partition, w.id), w.value] as [string, unknown]), state });
  }

  /** The replica's own bookkeeping (the pull cursor, counts), persisted with the rows. */
  async readState(key: string): Promise<unknown> {
    if (!this.db) return this.state.get(key);
    if (!this.stateLoaded) {
      for (const [k, v] of (await this.db.load()).state) this.state.set(k, v);
      this.stateLoaded = true;
    }
    return this.state.get(key);
  }

  private state = new Map<string, unknown>();
  private stateLoaded = false;

  async writeState(entries: [string, unknown][]): Promise<void> {
    for (const [k, v] of entries) this.state.set(k, v);
    if (this.db) await this.db.write({ state: entries });
  }

  subscribe(listener: (keys: readonly string[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(keys: readonly string[]) {
    if (!keys.length) return;
    for (const l of [...this.listeners]) l(keys);
  }

  /** Every dependency key a set of writes touches (for callers that announce changes themselves). */
  static keysOf(writes: readonly StoreWrite[]): string[] {
    const keys = new Set<string>();
    for (const w of writes) for (const k of writeKeys(w)) keys.add(k);
    return [...keys];
  }

  async close(): Promise<void> {
    this.unsubscribeMem();
    this.listeners.clear();
    await this.db?.close();
  }
}
