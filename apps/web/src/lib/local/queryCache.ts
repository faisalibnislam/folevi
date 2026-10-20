// Reactive local queries (docs/LOCAL_MODE_PLAN.md §2.2). One entry per (function, canonical args), shared by
// every watch of it and reference-counted by its subscribers. A run records the dependency keys its handler
// read (store.ts); a commit that changes any of them marks the entry dirty, and dirty entries re-run together
// in one microtask. A result is replaced only when its canonical JSON changed, so an unchanged result keeps
// its object identity (useMemo, documentBlocks and friends rely on that).
//
// Paginated queries keep their end, as Convex's query journal does: a page's first run records its
// `continueCursor`, and later runs pass it back as `endCursor`, so an insert above a loaded page grows that
// page instead of pushing a row into the next one. Handlers use sort-key cursors (paginate.ts), never offsets.
import { canonicalJson } from "@folevi/editor-schema";

export type QueryRunner = (name: string, args: Record<string, unknown>) => Promise<{ value: unknown; deps: readonly string[] }>;

export type QueryState = { value: unknown } | { error: Error };

interface Entry {
  key: string;
  name: string;
  args: Record<string, unknown>;
  state: QueryState | undefined;
  json: string | undefined;
  deps: Set<string>;
  subscribers: Set<() => void>;
  running: boolean;
  /** Changed while running, or before anyone subscribed: run again. */
  dirty: boolean;
  /** A dependency changed while nobody was subscribed: re-run on the next watch instead of in the background. */
  stale: boolean;
  /** The page's end once loaded (undefined: not a page, or not loaded yet). */
  pinnedEnd: string | null | undefined;
  evictTimer: ReturnType<typeof setTimeout> | null;
}

export interface QueryWatch {
  /** Starts the entry if needed; `cb` runs whenever the result changes. Returns the unsubscribe. */
  subscribe(cb: () => void): () => void;
  /** The current result, or undefined while it loads (starting it if nobody has yet). */
  current(): QueryState | undefined;
}

type PaginationOpts = { cursor: string | null; numItems: number; endCursor?: string | null };

function isPage(v: unknown): v is { continueCursor: string } {
  return typeof v === "object" && v !== null && typeof (v as { continueCursor?: unknown }).continueCursor === "string";
}

function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

export class QueryCache {
  private entries = new Map<string, Entry>();
  private byDep = new Map<string, Set<Entry>>();
  private dirty = new Set<Entry>();
  private scheduled = false;
  /** Bumped when the runner changes: a run that started before is stale. */
  private generation = 0;
  /** Test hook: runs per entry key (`name|canonicalJson(args)`). */
  readonly runs = new Map<string, number>();

  constructor(
    private runner: QueryRunner,
    private readonly evictAfterMs = 5000,
  ) {}

  static keyOf(name: string, args: Record<string, unknown>): string {
    return `${name}|${canonicalJson(args)}`;
  }

  watch(name: string, args: Record<string, unknown>): QueryWatch {
    const key = QueryCache.keyOf(name, args);
    return {
      subscribe: (cb) => {
        const e = this.entry(key, name, args);
        e.subscribers.add(cb);
        if (e.evictTimer) clearTimeout(e.evictTimer);
        e.evictTimer = null;
        if (e.stale) this.markDirty(e, true);
        return () => {
          e.subscribers.delete(cb);
          if (e.subscribers.size === 0) this.scheduleEvict(e);
        };
      },
      current: () => {
        const e = this.entry(key, name, args);
        if (e.stale && !e.running) this.markDirty(e, true);
        return e.state;
      },
    };
  }

  /** Re-runs every entry that read one of these keys. */
  invalidate(keys: Iterable<string>): void {
    for (const k of keys) for (const e of this.byDep.get(k) ?? []) this.markDirty(e);
  }

  /** Re-runs everything (the runner changed, a library was reloaded). */
  invalidateAll(): void {
    for (const e of this.entries.values()) this.markDirty(e);
  }

  /** Runs queries somewhere else from now on (a window that became the library's host, host.ts). */
  setRunner(runner: QueryRunner): void {
    this.runner = runner;
    this.generation++;
    this.invalidateAll();
  }

  clear(): void {
    for (const e of this.entries.values()) if (e.evictTimer) clearTimeout(e.evictTimer);
    this.entries.clear();
    this.byDep.clear();
    this.dirty.clear();
  }

  /** How many entries are alive (tests). */
  get size(): number {
    return this.entries.size;
  }

  private entry(key: string, name: string, args: Record<string, unknown>): Entry {
    let e = this.entries.get(key);
    if (!e) {
      e = { key, name, args, state: undefined, json: undefined, deps: new Set(), subscribers: new Set(), running: false, dirty: false, stale: false, pinnedEnd: undefined, evictTimer: null };
      this.entries.set(key, e);
      // A watch that's only read (QueriesObserver reads one on every render) and never subscribed goes away.
      this.scheduleEvict(e);
      void this.exec(e);
    }
    return e;
  }

  private scheduleEvict(e: Entry) {
    if (e.evictTimer) clearTimeout(e.evictTimer);
    e.evictTimer = setTimeout(() => {
      e.evictTimer = null;
      if (e.subscribers.size > 0 || this.entries.get(e.key) !== e) return;
      this.entries.delete(e.key);
      this.dirty.delete(e);
      this.setDeps(e, []);
    }, this.evictAfterMs);
  }

  /** `now`: someone is looking at it, so run it even with nobody subscribed. */
  private markDirty(e: Entry, now = false) {
    if (this.entries.get(e.key) !== e) return;
    if (!now && e.subscribers.size === 0 && e.state !== undefined && !e.running) {
      // Nobody is looking: run it when someone does.
      e.stale = true;
      return;
    }
    e.stale = false;
    this.dirty.add(e);
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      const batch = [...this.dirty];
      this.dirty.clear();
      for (const d of batch) void this.exec(d);
    });
  }

  private setDeps(e: Entry, deps: Iterable<string>) {
    for (const k of e.deps) {
      const set = this.byDep.get(k);
      set?.delete(e);
      if (set?.size === 0) this.byDep.delete(k);
    }
    e.deps = new Set(deps);
    for (const k of e.deps) {
      let set = this.byDep.get(k);
      if (!set) this.byDep.set(k, (set = new Set()));
      set.add(e);
    }
  }

  private async exec(e: Entry): Promise<void> {
    if (e.running) {
      e.dirty = true;
      return;
    }
    e.running = true;
    e.dirty = false;
    e.stale = false;
    const generation = this.generation;
    const po = e.args.paginationOpts as PaginationOpts | undefined;
    // The caller's own endCursor (usePaginatedQuery splitting a page) wins over the pin.
    const pinning = po !== undefined && po.endCursor === undefined;
    const args = pinning && e.pinnedEnd !== undefined ? { ...e.args, paginationOpts: { ...po, endCursor: e.pinnedEnd } } : e.args;
    let next: QueryState;
    let deps: readonly string[] | null = null;
    try {
      const r = await this.runner(e.name, args);
      next = { value: r.value };
      deps = r.deps;
      if (pinning && e.pinnedEnd === undefined && isPage(r.value)) e.pinnedEnd = r.value.continueCursor;
    } catch (error) {
      next = { error: asError(error) };
    }
    e.running = false;
    if (this.entries.get(e.key) !== e) return;
    this.runs.set(e.key, (this.runs.get(e.key) ?? 0) + 1);
    // A failed run keeps what it depended on before, so it's tried again when that changes.
    if (deps) this.setDeps(e, deps);
    if (generation !== this.generation) e.dirty = true;
    const json = "value" in next ? `v:${canonicalJson(next.value)}` : `e:${next.error.name}:${next.error.message}:${canonicalJson((next.error as { data?: unknown }).data ?? null)}`;
    if (json !== e.json) {
      e.json = json;
      e.state = next;
      for (const s of [...e.subscribers]) s();
    }
    if (e.dirty) this.markDirty(e);
  }
}
