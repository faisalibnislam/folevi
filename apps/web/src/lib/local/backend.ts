// The local backend: runs the ported handlers (functions/) against a LocalStore, in the window that hosts the
// library (host.ts). Queries read through a tracking reader and report the dependency keys they read;
// mutations run one at a time, see their own writes, and commit them together when they return (or not at
// all when they throw), then announce the keys they changed. See docs/LOCAL_MODE_PLAN.md §2.2.
import { getFunctionName, type FunctionReference } from "convex/server";
import { LOCAL_TRIGGERS, resolveLocal, type LocalActionCtx, type LocalJobCtx, type LocalMutationCtx, type LocalQueryCtx, type LocalReader, type LocalWriter } from "./registry";
import { BLOCKS_ANY, readKey, scanBlocksOfTypes, writeKeys, type CommitHints, type LocalBlock, type LocalStore, type LocalTable, type LocalTables, type StoreWrite } from "./store";
import { commitHints } from "./store/hints";
import type { LocalExecutor, LocalHostApi, LocalSetup } from "./client";
import { setupLibrary } from "./setup";
import "./functions";
import { commitUpload, prepareUpload } from "./functions/files";
import { LocalSearchIndex } from "./search";

export interface LocalBackendOptions {
  /** This device's id in the library (the sync engine sends its own with each push). */
  deviceId: string;
  /** The clock (tests). */
  now?: () => number;
}

/**
 * What a call returns is its own copy, as from the server (which sends JSON): nothing the caller keeps can
 * change when the library does, and nothing the caller changes reaches the library.
 */
function detached<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

const slot = (table: LocalTable, id: string, partition?: string) => `${table}\u0000${partition ?? ""}\u0000${id}`;

/** A mutation's view of the store: its own writes on top, kept until it commits. */
class Transaction implements LocalWriter {
  private writes = new Map<string, StoreWrite>();
  private seq: number | null = null;
  constructor(private store: LocalStore) {}

  async get<T extends LocalTable>(table: T, id: string, partition?: string): Promise<LocalTables[T] | undefined> {
    const w = this.writes.get(slot(table, id, partition));
    if (w) return w.value === null ? undefined : (w.value as LocalTables[T]);
    return await this.store.get(table, id, partition);
  }

  async list<T extends LocalTable>(table: T, partition?: string): Promise<LocalTables[T][]> {
    const base = await this.store.list(table, partition);
    const own = [...this.writes.values()].filter((w) => w.table === table && (partition === undefined || w.partition === partition));
    if (!own.length) return base;
    const changed = new Set(own.map((w) => w.id));
    // Rows of meta have no id field; every other table's rows carry theirs.
    const kept = base.filter((r) => !changed.has((r as { id?: string }).id ?? ""));
    for (const w of own) if (w.value !== null) kept.push(w.value as LocalTables[T]);
    return kept;
  }

  async blocksOfTypes(types: readonly string[]): Promise<LocalBlock[]> {
    const base = this.store.blocksOfTypes ? await this.store.blocksOfTypes(types) : await scanBlocksOfTypes(this.store, types);
    const own = [...this.writes.values()].filter((w) => w.table === "blocks");
    if (!own.length) return base;
    const key = (partition: string | undefined, id: string) => `${partition ?? ""}\u0000${id}`;
    const changed = new Set(own.map((w) => key(w.partition, w.id)));
    const want = new Set(types);
    const kept = base.filter((b) => !changed.has(key(b.documentId, b.id)));
    for (const w of own) {
      const b = w.value as LocalBlock | null;
      if (b && b.deletedAt === null && want.has(b.type)) kept.push(b);
    }
    return kept;
  }

  put<T extends LocalTable>(table: T, id: string, value: LocalTables[T], partition?: string): void {
    this.writes.set(slot(table, id, partition), { table, id, partition, value } as StoreWrite);
  }

  remove(table: LocalTable, id: string, partition?: string): void {
    this.writes.set(slot(table, id, partition), { table, id, partition, value: null } as StoreWrite);
  }

  async nextSeq(): Promise<number> {
    if (this.seq === null) {
      this.seq = (((await this.get("meta", "seq")) as number | undefined) ?? 0) + 1;
      this.put("meta", "seq", this.seq);
    }
    return this.seq;
  }

  pending(): StoreWrite[] {
    return [...this.writes.values()];
  }
}

export class LocalBackend implements LocalExecutor {
  private listeners = new Set<(keys: readonly string[]) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private unsubscribeStore: () => void;
  private closed = false;
  readonly deviceId: string;
  private readonly now: () => number;
  readonly local: LocalHostApi;

  constructor(
    readonly store: LocalStore,
    opts: LocalBackendOptions,
  ) {
    this.deviceId = opts.deviceId;
    this.now = opts.now ?? Date.now;
    // Changes from outside (another device, through the library) reach the same listeners as our own.
    this.unsubscribeStore = store.subscribe((keys) => this.emit(keys));
    // A library store applies what it reads from disk as mutations of its own: in order with the others, with
    // the triggers, and announced like any change.
    store.bind?.({ ingest: async (fn) => void (await this.serial(() => this.transact(fn, { origin: "disk" }))) });
    this.local = {
      putFile: (blob, meta) => this.putFile(blob, meta),
      setup: (input) => this.setup(input),
      ...(store.library ? { library: store.library } : {}),
    };
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

  private search: LocalSearchIndex | null = null;

  /** The library's search index (lib/local/search), loaded from the store's storage on first use. */
  private searchIndex = async (): Promise<LocalSearchIndex> => {
    this.search ??= new LocalSearchIndex({ storage: this.store.searchIndexStorage });
    await this.search.ready();
    return this.search;
  };

  private queryCtx(db: LocalReader): LocalQueryCtx {
    return { db, deviceId: this.deviceId, now: this.now, searchIndex: this.searchIndex };
  }

  async query(name: string, args: Record<string, unknown>): Promise<{ value: unknown; deps: readonly string[] }> {
    this.assertOpen();
    const fn = resolveLocal(name, "query");
    const deps = new Set<string>();
    const db: LocalReader = {
      get: (table, id, partition) => {
        deps.add(readKey(table, id, partition));
        return this.store.get(table, id, partition);
      },
      list: (table, partition) => {
        deps.add(readKey(table, undefined, partition));
        return this.store.list(table, partition);
      },
      blocksOfTypes: (types) => {
        deps.add(BLOCKS_ANY);
        return this.store.blocksOfTypes ? this.store.blocksOfTypes(types) : scanBlocksOfTypes(this.store, types);
      },
    };
    const value = await (fn.handler as (ctx: LocalQueryCtx, args: unknown) => unknown)(this.queryCtx(db), detached(args));
    return { value: detached(value), deps: [...deps] };
  }

  mutation(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.serial(async () => {
      const fn = resolveLocal(name, "mutation");
      return detached(await this.transact((ctx) => (fn.handler as (ctx: LocalMutationCtx, args: unknown) => unknown)(ctx, detached(args)), commitHints(name, args)));
    });
  }

  async action(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.assertOpen();
    const fn = resolveLocal(name, "action");
    const ctx: LocalActionCtx = {
      deviceId: this.deviceId,
      now: this.now,
      runQuery: async (ref, a) => (await this.query(getFunctionName(ref as FunctionReference<"query">), a as Record<string, unknown>)).value as never,
      runMutation: async (ref, a) => (await this.mutation(getFunctionName(ref as FunctionReference<"mutation">), a as Record<string, unknown>)) as never,
      mutate: (fn) => this.serial(() => this.transact(fn)),
    };
    return detached(await (fn.handler as (ctx: LocalActionCtx, args: unknown) => unknown)(ctx, detached(args)));
  }

  /** One mutation at a time, in call order (Convex's guarantee for one client). */
  private serial<T>(run: () => Promise<T>): Promise<T> {
    this.assertOpen();
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /**
   * Runs `fn` against a transaction and commits what it wrote; nothing is written if it throws. The
   * triggers (registry.ts defineTrigger) see the writes just before the commit; jobs started with
   * `runAfter` start once it's done.
   */
  private async transact<T>(fn: (ctx: LocalMutationCtx) => T | Promise<T>, hints?: CommitHints): Promise<T> {
    const tx = new Transaction(this.store);
    const jobs: ((ctx: LocalJobCtx) => Promise<void>)[] = [];
    const ctx: LocalMutationCtx = { db: tx, deviceId: this.deviceId, now: this.now, nextSeq: () => tx.nextSeq(), runAfter: (job) => void jobs.push(job) };
    const result = await fn(ctx);
    let writes = tx.pending();
    if (writes.length && LOCAL_TRIGGERS.size) {
      const before: LocalReader["get"] = (table, id, partition) => this.store.get(table, id, partition);
      for (const trigger of LOCAL_TRIGGERS.values()) await trigger(ctx, writes, before, hints?.origin ?? "local");
      writes = tx.pending();
    }
    if (writes.length) {
      await this.store.commit(writes, hints);
      const keys = new Set<string>();
      for (const w of writes) for (const k of writeKeys(w)) keys.add(k);
      this.emit([...keys]);
    }
    for (const job of jobs) this.startJob(job);
    return result;
  }

  private jobs = new Set<Promise<void>>();

  /** A job from `runAfter`: after the current call returns, in its own time, its writes as mutations of their own. */
  private startJob(job: (ctx: LocalJobCtx) => Promise<void>) {
    const ctx: LocalJobCtx = {
      deviceId: this.deviceId,
      now: this.now,
      mutate: (fn) => this.serial(() => this.transact(fn)),
    };
    const run = Promise.resolve()
      .then(() => (this.closed ? undefined : job(ctx)))
      .catch((e: unknown) => {
        if (!this.closed) console.error("[local mode] A background job failed:", e);
      })
      .finally(() => this.jobs.delete(run));
    this.jobs.add(run);
  }

  /** Whether close() has run (what keeps working beside the backend, like reminders, stops then). */
  get isClosed(): boolean {
    return this.closed;
  }

  /** Resolves once no job started by `runAfter` is running and no mutation is waiting (tests). */
  async idle(): Promise<void> {
    for (;;) {
      await this.queue;
      if (!this.jobs.size) return;
      await Promise.all([...this.jobs]);
    }
  }

  /** An attachment's bytes into the library, checked as the server's upload checks them (functions/files.ts). */
  private async putFile(blob: Blob, meta: { name: string; mimeType: string; kind: string; documentId?: string | null }): Promise<{ fileId: string; mimeType: string }> {
    this.assertOpen();
    const prepared = await prepareUpload(blob, meta);
    return await this.serial(() => this.transact((ctx) => commitUpload(ctx, prepared)));
  }

  /**
   * Runs `fn` as one of this backend's own mutations, in order with the others (bookkeeping that has no
   * server function, like a move's progress between a library and an account, lib/migrate/progress.ts).
   */
  run<T>(fn: (ctx: LocalMutationCtx) => T | Promise<T>): Promise<T> {
    return this.serial(() => this.transact(fn));
  }

  private setup(input: LocalSetup): Promise<{ created: boolean }> {
    return this.serial(() => this.transact((ctx) => setupLibrary(ctx, input)));
  }

  private assertOpen() {
    if (this.closed) throw new Error("The local library is closed.");
  }

  async close(): Promise<void> {
    if (this.closed) return;
    // Let what's running finish first.
    await this.queue;
    await Promise.all([...this.jobs]);
    this.closed = true;
    this.unsubscribeStore();
    this.listeners.clear();
    await this.search?.close();
    await this.store.close?.();
  }
}
