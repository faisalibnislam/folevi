// The local backend's storage seam (docs/LOCAL_MODE_PLAN.md §2.2, WP5). Handlers read and write rows through
// a `LocalStore`; every read is recorded as a dependency key and every write emits the keys it changed, which
// is what makes local queries reactive (queryCache.ts). Phase 2 puts a store over packages/local-store (note
// files, the library index, history) behind this same interface; `MemoryStore` is the in-memory one used by
// tests and by development builds until then.
import type { WireBlock } from "@folevi/editor-schema";
import type { Doc } from "@/lib/convex/api";

/** A note (a page, a template, synced content, a collection row) as the local backend keeps it. */
export interface LocalDocument {
  id: string;
  parentDocumentId: string | null;
  folderId: string | null;
  kind: Doc<"documents">["kind"];
  title: string;
  icon: string | null;
  cover: Doc<"documents">["cover"];
  style: Doc<"documents">["style"];
  dailyDate: string | null;
  templateKey: string | null;
  collectionId: string | null;
  rank: string;
  createdAt: number;
  /** The library's count of notes made when this one was: orders notes made in the same millisecond. */
  ordinal: number;
  updatedAt: number;
  archivedAt: number | null;
  /** When it went to Trash (`inTrash`). */
  deletedAt: number | null;
  inTrash: boolean;
  revision: number;
  titleRev: number;
  seq: number;
  contentSeq: number;
  searchText: string;
  wordCount: number;
  charCount: number;
  blockCount: number;
  excerpt: string;
  preview: NonNullable<Doc<"documents">["preview"]> | null;
  /** One person per library, so a star and the tags live on the note itself. */
  starred: boolean;
  tagIds: string[];
}

/** A block of a note, tombstones included (`deletedAt`). Stored under its note (`partition` = note id). */
export interface LocalBlock extends Omit<WireBlock, "revision"> {
  documentId: string;
  revision: number;
  contentRev: number;
  positionRev: number;
  seq: number;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface LocalFolder {
  id: string;
  name: string;
  color: string | null;
  parentFolderId: string | null;
  rank: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface LocalTag {
  id: string;
  name: string;
  normalizedName: string;
  color: string;
  createdAt: number;
}

/** An attachment's bytes and what's known about them (Phase 2: `files/<sha>` in the library). */
export interface LocalFile {
  id: string;
  documentId: string | null;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  kind: string;
  blob: Blob;
  createdAt: number;
}

export interface LocalTables {
  documents: LocalDocument;
  blocks: LocalBlock;
  folders: LocalFolder;
  tags: LocalTag;
  files: LocalFile;
  /** Small values by key: "profile", "seq", "op:<opId>" (sync replays). */
  meta: unknown;
}
export type LocalTable = keyof LocalTables;

/** One row written (`value`) or removed (`null`). `partition` is required for blocks (the note's id). */
export type StoreWrite = { [T in LocalTable]: { table: T; id: string; partition?: string; value: LocalTables[T] | null } }[LocalTable];

export interface LocalStore {
  get<T extends LocalTable>(table: T, id: string, partition?: string): Promise<LocalTables[T] | undefined>;
  /** Every row of a table, or of one partition (a note's blocks). Order is unspecified. */
  list<T extends LocalTable>(table: T, partition?: string): Promise<LocalTables[T][]>;
  /** Applies the writes together: all of them or none. */
  commit(writes: readonly StoreWrite[]): Promise<void>;
  /**
   * Changes that didn't come from this backend's own commits (another device's edits read from disk, a sync
   * folder catching up): the listener gets their dependency keys (see `writeKeys`).
   */
  subscribe(listener: (keys: readonly string[]) => void): () => void;
  close?(): Promise<void>;
}

// ---- dependency keys ------------------------------------------------------------------------------------
//
// A read records one key and a write emits every key a read of it could have recorded:
//   documents  get → doc:<id>        list → catalog
//   blocks     get or list of a note → blocks:<noteId>
//   folders    folders               tags   tags
//   files      get → file:<id>       list → files
//   meta       get → meta:<key>      list → meta

export function readKey(table: LocalTable, id?: string, partition?: string): string {
  switch (table) {
    case "documents":
      return id === undefined ? "catalog" : `doc:${id}`;
    case "blocks":
      return `blocks:${partition ?? ""}`;
    case "folders":
    case "tags":
      return table;
    case "files":
      return id === undefined ? "files" : `file:${id}`;
    case "meta":
      return id === undefined ? "meta" : `meta:${id}`;
  }
}

export function writeKeys(w: Pick<StoreWrite, "table" | "id" | "partition">): string[] {
  switch (w.table) {
    case "documents":
      return [`doc:${w.id}`, "catalog"];
    case "blocks":
      return [`blocks:${w.partition ?? ""}`];
    case "folders":
    case "tags":
      return [w.table];
    case "files":
      return [`file:${w.id}`, "files"];
    case "meta":
      return [`meta:${w.id}`, "meta"];
  }
}

/** Copies a row so a handler can never change what the store holds without committing it. */
function copy<T>(value: T, table: LocalTable): T {
  // A file's Blob is immutable and not always cloneable across realms; the rest is plain data.
  if (table === "files") return { ...(value as object) } as T;
  return structuredClone(value);
}

/**
 * The store in memory. Rows are copied on the way in and out. `ingest` stands for a change arriving from
 * outside (another device, through the library folder): it commits and tells subscribers.
 */
export class MemoryStore implements LocalStore {
  private tables = new Map<LocalTable, Map<string, Map<string, unknown>>>();
  private listeners = new Set<(keys: readonly string[]) => void>();
  /** Test hook: how many commits there were. */
  commits = 0;

  private partitionOf(table: LocalTable, partition: string | undefined, create: true): Map<string, unknown>;
  private partitionOf(table: LocalTable, partition: string | undefined, create: false): Map<string, unknown> | undefined;
  private partitionOf(table: LocalTable, partition: string | undefined, create: boolean) {
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

  async get<T extends LocalTable>(table: T, id: string, partition?: string): Promise<LocalTables[T] | undefined> {
    const v = this.partitionOf(table, partition, false)?.get(id);
    return v === undefined ? undefined : copy(v as LocalTables[T], table);
  }

  async list<T extends LocalTable>(table: T, partition?: string): Promise<LocalTables[T][]> {
    const out: LocalTables[T][] = [];
    if (partition !== undefined || table === "blocks") {
      for (const v of this.partitionOf(table, partition, false)?.values() ?? []) out.push(copy(v as LocalTables[T], table));
      return out;
    }
    for (const p of this.tables.get(table)?.values() ?? []) for (const v of p.values()) out.push(copy(v as LocalTables[T], table));
    return out;
  }

  async commit(writes: readonly StoreWrite[]): Promise<void> {
    this.apply(writes);
  }

  /** A change from outside this backend: committed, then announced to subscribers. */
  ingest(writes: readonly StoreWrite[]): void {
    this.apply(writes);
    const keys = new Set<string>();
    for (const w of writes) for (const k of writeKeys(w)) keys.add(k);
    for (const l of this.listeners) l([...keys]);
  }

  private apply(writes: readonly StoreWrite[]) {
    this.commits++;
    for (const w of writes) {
      if (w.table === "blocks" && w.partition === undefined) throw new Error("A block is written under its note (partition).");
      const p = this.partitionOf(w.table, w.partition, true);
      if (w.value === null) p.delete(w.id);
      else p.set(w.id, copy(w.value, w.table));
    }
  }

  subscribe(listener: (keys: readonly string[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
