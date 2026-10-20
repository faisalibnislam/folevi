// SPIKE S5 (docs/LOCAL_MODE.md): a minimal LocalClient, duck-typed as a ConvexReactClient, so the real
// convex/react hooks (useQuery, usePaginatedQuery, useMutation, useAction, useConvexConnectionState) run
// against an in-memory store. Not product code: Phase 1 WP5 rebuilds this as lib/local/{client,queryCache}.ts.
import { canonicalJson } from "@folevi/editor-schema";
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";

/** A tracking key a handler read ("doc:<id>", "catalog", ...). Commits emit the keys they changed. */
export type Key = string;

/** The store: a Map with change keys. Reads are tracked per query run; writes are buffered per mutation. */
export class MemoryStore {
  private rows = new Map<string, unknown>();
  private listeners = new Set<(keys: Set<Key>) => void>();
  get(table: string, id: string): unknown {
    return this.rows.get(`${table}:${id}`);
  }
  all(table: string): unknown[] {
    const out: unknown[] = [];
    for (const [k, v] of this.rows) if (k.startsWith(`${table}:`)) out.push(v);
    return out;
  }
  commit(writes: Map<string, unknown>, keys: Set<Key>) {
    for (const [k, v] of writes) {
      if (v === undefined) this.rows.delete(k);
      else this.rows.set(k, v);
    }
    for (const l of this.listeners) l(keys);
  }
  onCommit(l: (keys: Set<Key>) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export interface QueryCtx {
  get(table: string, id: string): unknown;
  all(table: string): unknown[];
}
export interface MutationCtx extends QueryCtx {
  put(table: string, id: string, value: unknown): void;
  remove(table: string, id: string): void;
}
type AnyRef = FunctionReference<"query" | "mutation" | "action">;
type Handler = { kind: "query" | "mutation" | "action"; run: (ctx: MutationCtx, args: never) => unknown };

/**
 * The registry; `defineLocal` makes args and return types follow the server function's (WP5 / §2.5.1).
 * The kind is passed explicitly: `ref._type` exists only in the types (at runtime `api.x.y` is a proxy
 * that knows nothing but its name), so the registry can't read it from the reference.
 */
export const LOCAL_FUNCTIONS = new Map<string, Handler>();
export function defineLocal<Ref extends AnyRef>(kind: Ref["_type"], ref: Ref, run: (ctx: Ref["_type"] extends "query" ? QueryCtx : MutationCtx, args: FunctionArgs<Ref>) => FunctionReturnType<Ref> | Promise<FunctionReturnType<Ref>>) {
  LOCAL_FUNCTIONS.set(getFunctionName(ref), { kind, run: run as Handler["run"] });
}

type Entry = {
  name: string;
  args: Record<string, unknown>;
  state: { value: unknown } | { error: Error } | undefined;
  json: string | undefined;
  deps: Set<Key>;
  subscribers: Set<() => void>;
  runs: number;
  running: boolean;
  dirty: boolean;
  /** Pagination pin (what Convex's query journal does): the end cursor of the first run. */
  pinnedEnd: string | null | undefined;
  evictTimer: ReturnType<typeof setTimeout> | null;
};

/**
 * One cache entry per (function, canonical args). Watches are cheap views: QueriesObserver.getLocalResults
 * makes a fresh watch on every render without subscribing, so a watch must not run anything by itself
 * beyond starting the entry once.
 */
export class LocalClient {
  private entries = new Map<string, Entry>();
  private connListeners = new Set<() => void>();
  private pendingDirty = false;
  private mutationQueue: Promise<unknown> = Promise.resolve();
  /** convex/react's usePaginatedQuery reads `client.logger.warn` when a cursor goes stale. */
  readonly logger = { log: console.log, warn: console.warn, error: console.error, logVerbose: () => {} };
  readonly local = { kind: "local" as const };
  /** Test hook: how many times each entry ran. */
  readonly stats = { runs: new Map<string, number>() };

  constructor(private store: MemoryStore) {
    store.onCommit((keys) => this.invalidate(keys));
  }

  private keyOf(name: string, args: Record<string, unknown>) {
    return `${name}|${canonicalJson(args)}`;
  }

  private entry(name: string, args: Record<string, unknown>): Entry {
    const key = this.keyOf(name, args);
    let e = this.entries.get(key);
    if (!e) {
      e = { name, args, state: undefined, json: undefined, deps: new Set(), subscribers: new Set(), runs: 0, running: false, dirty: true, pinnedEnd: undefined, evictTimer: null };
      this.entries.set(key, e);
      this.scheduleEvict(key, e);
      void this.run(e);
    }
    return e;
  }

  /** Entries nobody subscribes to are dropped after a grace period (Convex keeps them 5 s too). */
  private scheduleEvict(key: string, e: Entry) {
    if (e.evictTimer) clearTimeout(e.evictTimer);
    e.evictTimer = setTimeout(() => {
      if (e.subscribers.size === 0) this.entries.delete(key);
    }, 5000);
  }

  private async run(e: Entry) {
    if (e.running) return;
    e.running = true;
    e.dirty = false;
    const deps = new Set<Key>();
    const handler = LOCAL_FUNCTIONS.get(e.name);
    let next: Entry["state"];
    try {
      if (!handler) throw new ConvexError({ code: "local_unsupported", fn: e.name });
      if (handler.kind !== "query") throw new Error(`${e.name} is not a query`);
      const ctx = this.readCtx(deps);
      let args = e.args;
      const po = args.paginationOpts as { cursor: string | null; endCursor?: string | null } | undefined;
      if (po && e.pinnedEnd !== undefined) args = { ...args, paginationOpts: { ...po, endCursor: e.pinnedEnd } };
      const value = await handler.run(ctx as MutationCtx, args as never);
      if (po && e.pinnedEnd === undefined) e.pinnedEnd = (value as { continueCursor: string }).continueCursor;
      next = { value };
    } catch (error) {
      next = { error: error instanceof Error ? error : new Error(String(error)) };
    }
    e.runs++;
    this.stats.runs.set(this.keyOf(e.name, e.args), e.runs);
    e.deps = deps;
    e.running = false;
    // Replace the result only when it changed, so references stay stable for useMemo.
    const json = "value" in (next ?? {}) ? canonicalJson((next as { value: unknown }).value) : `error:${(next as { error: Error }).error.message}`;
    if (json !== e.json) {
      e.json = json;
      e.state = next;
      for (const s of e.subscribers) s();
    }
    if (e.dirty) void this.run(e);
  }

  private readCtx(deps: Set<Key>): QueryCtx {
    return {
      get: (table, id) => {
        deps.add(`${table}:${id}`);
        return this.store.get(table, id);
      },
      all: (table) => {
        deps.add(`${table}:*`);
        return this.store.all(table);
      },
    };
  }

  /** Dirty entries re-run in one microtask batch after a commit. */
  private invalidate(keys: Set<Key>) {
    for (const e of this.entries.values()) {
      for (const k of keys) {
        if (e.deps.has(k)) {
          e.dirty = true;
          break;
        }
      }
    }
    if (this.pendingDirty) return;
    this.pendingDirty = true;
    queueMicrotask(() => {
      this.pendingDirty = false;
      for (const e of this.entries.values()) if (e.dirty) void this.run(e);
    });
  }

  // ---- the ConvexReactClient surface convex/react uses ----

  watchQuery(ref: FunctionReference<"query">, args: Record<string, unknown> = {}, _opts?: { journal?: unknown }) {
    const name = getFunctionName(ref);
    return {
      onUpdate: (cb: () => void) => {
        const e = this.entry(name, args);
        e.subscribers.add(cb);
        if (e.evictTimer) clearTimeout(e.evictTimer);
        return () => {
          e.subscribers.delete(cb);
          if (e.subscribers.size === 0) this.scheduleEvict(this.keyOf(name, args), e);
        };
      },
      localQueryResult: (): unknown => {
        const s = this.entry(name, args).state;
        if (!s) return undefined;
        if ("error" in s) throw s.error;
        return s.value;
      },
      journal: () => undefined,
    };
  }

  /** Only the experimental paginated hook calls this; the stable usePaginatedQuery uses watchQuery. */
  watchPaginatedQuery(): never {
    throw new Error("watchPaginatedQuery is not supported by LocalClient (usePaginatedQuery_experimental)");
  }

  async query(ref: FunctionReference<"query">, args: Record<string, unknown> = {}) {
    const handler = LOCAL_FUNCTIONS.get(getFunctionName(ref));
    if (!handler) throw new ConvexError({ code: "local_unsupported", fn: getFunctionName(ref) });
    return handler.run(this.readCtx(new Set()) as MutationCtx, args as never);
  }

  mutation(ref: FunctionReference<"mutation">, args: Record<string, unknown> = {}, _opts?: { optimisticUpdate?: unknown }) {
    return this.write(ref, args);
  }

  action(ref: FunctionReference<"action">, args: Record<string, unknown> = {}) {
    return this.write(ref, args);
  }

  /** Mutations run one at a time, in call order, like Convex. Writes commit at the end, atomically. */
  private write(ref: AnyRef, args: Record<string, unknown>): Promise<unknown> {
    const name = getFunctionName(ref);
    const run = async () => {
      const handler = LOCAL_FUNCTIONS.get(name);
      if (!handler) throw new ConvexError({ code: "local_unsupported", fn: name });
      const writes = new Map<string, unknown>();
      const keys = new Set<Key>();
      const ctx: MutationCtx = {
        get: (t, id) => (writes.has(`${t}:${id}`) ? writes.get(`${t}:${id}`) : this.store.get(t, id)),
        all: (t) => this.store.all(t),
        put: (t, id, v) => {
          writes.set(`${t}:${id}`, v);
          keys.add(`${t}:${id}`).add(`${t}:*`);
        },
        remove: (t, id) => {
          writes.set(`${t}:${id}`, undefined);
          keys.add(`${t}:${id}`).add(`${t}:*`);
        },
      };
      const result = await handler.run(ctx, args as never);
      if (writes.size) this.store.commit(writes, keys);
      return result;
    };
    const p = this.mutationQueue.then(run, run);
    this.mutationQueue = p.catch(() => {});
    return p;
  }

  connectionState() {
    return { hasInflightRequests: false, isWebSocketConnected: true, timeOfOldestInflightRequest: null, hasEverConnected: true, connectionCount: 1, connectionRetries: 0, inflightMutations: 0, inflightActions: 0 };
  }
  subscribeToConnectionState(cb: () => void) {
    this.connListeners.add(cb);
    return () => this.connListeners.delete(cb);
  }
  async close() {
    this.entries.clear();
  }
}
