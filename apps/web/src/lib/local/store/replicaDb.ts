// This device's copy of the library (docs/LOCAL_MODE_PLAN.md §3.1, "Device-private data"): IndexedDB
// `folevi-local-<libraryId>`, outside the library folder. It holds the rows the handlers read (so a launch
// shows everything at once, before the folder is read), the parsed note files and index, and the store's
// bookkeeping (what was last read from each file, what still has to be written, the clock). `MemoryReplicaDb`
// is the same in memory, for tests and for runtimes without IndexedDB.
import { openDB, type IDBPDatabase } from "idb";
import type { NoteLike } from "@folevi/local-store";

export interface ReplicaSnapshot {
  /** By `rowKey`. */
  rows: Map<string, unknown>;
  notes: Map<string, NoteLike>;
  state: Map<string, unknown>;
}

/** Puts (a value) and deletes (null), applied together. */
export interface ReplicaBatch {
  rows?: [string, unknown][];
  notes?: [string, NoteLike | null][];
  state?: [string, unknown][];
}

export interface ReplicaDb {
  load(): Promise<ReplicaSnapshot>;
  /** Durable once it resolves: all of the batch or none of it. */
  write(batch: ReplicaBatch): Promise<void>;
  close(): Promise<void>;
}

export type OpenReplicaDb = (libraryId: string) => Promise<ReplicaDb>;

/** The key of a row: table, partition and id. */
export const rowKey = (table: string, partition: string | undefined, id: string) => `${table}\u0001${partition ?? ""}\u0001${id}`;

export function parseRowKey(key: string): { table: string; partition: string | undefined; id: string } {
  const [table, partition, ...rest] = key.split("\u0001");
  return { table: table!, partition: partition || undefined, id: rest.join("\u0001") };
}

export const replicaDbName = (libraryId: string) => `folevi-local-${libraryId}`;

function clone<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    // A Blob from another realm (tests): rows holding one are copied one level deep; the Blob is immutable.
    return { ...(value as object) } as T;
  }
}

/** The replica in memory. Instances by library id outlive a store, so "reopening" one finds what it kept. */
export class MemoryReplicaDb implements ReplicaDb {
  private static all = new Map<string, MemoryReplicaDb>();

  /** The database of a library, made the first time it's asked for. */
  static open(libraryId: string): MemoryReplicaDb {
    let db = MemoryReplicaDb.all.get(libraryId);
    if (!db) MemoryReplicaDb.all.set(libraryId, (db = new MemoryReplicaDb()));
    db.closed = false;
    return db;
  }

  /** Forgets a library's database (the device's storage was cleared), or every one. */
  static wipe(libraryId?: string): void {
    if (libraryId === undefined) MemoryReplicaDb.all.clear();
    else MemoryReplicaDb.all.delete(libraryId);
  }

  rows = new Map<string, unknown>();
  notes = new Map<string, NoteLike>();
  state = new Map<string, unknown>();
  writes = 0;
  private closed = false;

  async load(): Promise<ReplicaSnapshot> {
    return { rows: new Map([...this.rows].map(([k, v]) => [k, clone(v)])), notes: new Map([...this.notes].map(([k, v]) => [k, clone(v)])), state: new Map([...this.state].map(([k, v]) => [k, clone(v)])) };
  }

  async write(batch: ReplicaBatch): Promise<void> {
    if (this.closed) return;
    this.writes++;
    for (const [k, v] of batch.rows ?? []) if (v === null) this.rows.delete(k);
    else this.rows.set(k, clone(v));
    for (const [k, v] of batch.notes ?? []) if (v === null) this.notes.delete(k);
    else this.notes.set(k, clone(v));
    for (const [k, v] of batch.state ?? []) if (v === null) this.state.delete(k);
    else this.state.set(k, clone(v));
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

const STORES = ["rows", "notes", "state"] as const;

/** The replica in IndexedDB. */
export class IdbReplicaDb implements ReplicaDb {
  private constructor(private db: IDBPDatabase) {}

  static async open(libraryId: string): Promise<IdbReplicaDb> {
    return await IdbReplicaDb.openNamed(replicaDbName(libraryId));
  }

  /** The same layout under another database name (an encrypted space's replica, `folevi-e2ee-<scope>`). */
  static async openNamed(name: string): Promise<IdbReplicaDb> {
    const db = await openDB(name, 1, {
      upgrade(d) {
        for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
      },
    });
    return new IdbReplicaDb(db);
  }

  async load(): Promise<ReplicaSnapshot> {
    const tx = this.db.transaction([...STORES], "readonly");
    const read = async (name: (typeof STORES)[number]) => {
      const store = tx.objectStore(name);
      const [keys, values] = await Promise.all([store.getAllKeys(), store.getAll()]);
      return new Map(keys.map((k, i) => [String(k), values[i]]));
    };
    const [rows, notes, state] = await Promise.all([read("rows"), read("notes"), read("state")]);
    await tx.done;
    return { rows, notes: notes as Map<string, NoteLike>, state };
  }

  async write(batch: ReplicaBatch): Promise<void> {
    const names = STORES.filter((s) => batch[s]?.length);
    if (!names.length) return;
    const tx = this.db.transaction(names, "readwrite");
    for (const name of names) {
      const store = tx.objectStore(name);
      for (const [k, v] of batch[name] as [string, unknown][]) {
        if (v === null) void store.delete(k);
        else void store.put(v, k);
      }
    }
    await tx.done;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

/** IndexedDB where there is one, else memory. */
export const openDefaultReplicaDb: OpenReplicaDb = async (libraryId) =>
  typeof indexedDB !== "undefined" ? await IdbReplicaDb.open(libraryId) : MemoryReplicaDb.open(libraryId);
