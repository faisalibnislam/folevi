// `LocalClient`: the object `ConvexProvider` gets in local mode (docs/LOCAL_MODE_PLAN.md §2.1). It is duck-typed
// as a ConvexReactClient: convex/react 1.46's hooks only call watchQuery (onUpdate, localQueryResult,
// journal), query, mutation, action, connectionState, subscribeToConnectionState and read `logger`
// (usePaginatedQuery). The conformance suite (test/local-client.test.tsx) runs the real hooks against it and
// must pass again on every convex upgrade (the version is pinned for that reason).
//
// The work happens in a `LocalExecutor`: the LocalBackend in the window that hosts the library, or a
// RemoteExecutor that forwards to that window over a BroadcastChannel (host.ts). The executor can change
// under a live client (the host window closed and this one took over); every query then re-runs there.
import { getFunctionName, type FunctionReference } from "convex/server";
import type { FoleviClient } from "@/lib/convex/client";
import { QueryCache } from "./queryCache";

/** What a new local library needs to know about the person (users.me reads it back). */
export interface LocalSetup {
  timeZone: string;
  locale: string;
  displayName?: string;
  /** Today in their time zone (yyyy-mm-dd), for the dates in the seeded notes. */
  today?: string;
  /** Seed the welcome notes (default true). */
  seed?: boolean;
}

/** Local-only operations that have no server function (`client.local`). */
export interface LocalHostApi {
  /** Stores an attachment's bytes in the library; the fileId replaces files.generateUploadUrl + finalize. */
  putFile(blob: Blob, meta: { name: string; mimeType: string; kind: string; documentId?: string | null }): Promise<{ fileId: string; mimeType: string }>;
  /** Creates the library's profile on first launch, with the welcome notes (LocalGate). Idempotent. */
  setup(input: LocalSetup): Promise<{ created: boolean }>;
}

export interface LocalExecutor {
  query(name: string, args: Record<string, unknown>): Promise<{ value: unknown; deps: readonly string[] }>;
  mutation(name: string, args: Record<string, unknown>): Promise<unknown>;
  action(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** Dependency keys changed by any write (this window's or another's, or one read from disk). */
  subscribe(listener: (keys: readonly string[]) => void): () => void;
  local: LocalHostApi;
}

type AnyRef = FunctionReference<"query" | "mutation" | "action">;

const CONNECTED = Object.freeze({
  hasInflightRequests: false,
  isWebSocketConnected: true,
  timeOfOldestInflightRequest: null,
  hasEverConnected: true,
  connectionCount: 1,
  connectionRetries: 0,
  inflightMutations: 0,
  inflightActions: 0,
});

export class LocalClient {
  private cache: QueryCache;
  private executor: LocalExecutor;
  private unsubscribe: () => void;
  private closed = false;
  private connectionListeners = new Set<() => void>();

  /** usePaginatedQuery reads `client.logger.warn` when a cursor goes stale. */
  readonly logger = {
    log: (...a: unknown[]) => console.log(...a),
    warn: (...a: unknown[]) => console.warn(...a),
    error: (...a: unknown[]) => console.error(...a),
    logVerbose: () => {},
  };

  constructor(executor: LocalExecutor, opts: { evictAfterMs?: number } = {}) {
    this.executor = executor;
    this.cache = new QueryCache((name, args) => this.executor.query(name, args), opts.evictAfterMs);
    this.unsubscribe = executor.subscribe((keys) => this.cache.invalidate(keys));
  }

  /** Local-only operations (putFile, setup). Always the current executor's. */
  get local(): LocalHostApi {
    return this.executor.local;
  }

  /** Runs everything through another executor from now on, and re-runs every live query there. */
  setExecutor(next: LocalExecutor): void {
    if (next === this.executor) return;
    this.unsubscribe();
    this.executor = next;
    this.unsubscribe = next.subscribe((keys) => this.cache.invalidate(keys));
    this.cache.setRunner((name, args) => this.executor.query(name, args));
  }

  /** Test hook: runs per query entry (`name|canonicalJson(args)`). */
  get queryRuns(): ReadonlyMap<string, number> {
    return this.cache.runs;
  }

  // ---- the ConvexReactClient surface convex/react uses ---------------------------------------------------

  watchQuery(ref: FunctionReference<"query">, args: Record<string, unknown> = {}, _options?: { journal?: unknown }) {
    const watch = this.cache.watch(getFunctionName(ref), args);
    return {
      onUpdate: (callback: () => void) => watch.subscribe(callback),
      localQueryResult: (): unknown => {
        const s = watch.current();
        if (!s) return undefined;
        if ("error" in s) throw s.error;
        return s.value;
      },
      localQueryLogs: () => undefined,
      journal: () => undefined,
    };
  }

  /** Only usePaginatedQuery_experimental calls this; the app uses the stable usePaginatedQuery (watchQuery). */
  watchPaginatedQuery(): never {
    throw new Error("watchPaginatedQuery is not supported in local mode (use usePaginatedQuery).");
  }

  // query, mutation and action are typed as ConvexReactClient's (FoleviClient), so a LocalClient can go
  // wherever the sync engine, the outbox and the uploader take a client.
  readonly query: FoleviClient["query"] = (async (ref: FunctionReference<"query">, args: Record<string, unknown> = {}) =>
    (await this.executor.query(getFunctionName(ref), args)).value) as FoleviClient["query"];

  /** Mutations run one at a time, in call order. An optimistic update is ignored: a local write takes milliseconds. */
  readonly mutation: FoleviClient["mutation"] = ((ref: FunctionReference<"mutation">, args: Record<string, unknown> = {}) =>
    this.executor.mutation(getFunctionName(ref as AnyRef), args)) as FoleviClient["mutation"];

  readonly action: FoleviClient["action"] = ((ref: FunctionReference<"action">, args: Record<string, unknown> = {}) =>
    this.executor.action(getFunctionName(ref as AnyRef), args)) as FoleviClient["action"];

  /** Always connected: the backend is on this device. */
  connectionState() {
    return CONNECTED;
  }

  subscribeToConnectionState(cb: () => void): () => void {
    this.connectionListeners.add(cb);
    return () => {
      this.connectionListeners.delete(cb);
    };
  }

  /** Never called in local mode; present so code that clears auth on sign-out doesn't fail. */
  setAuth(): void {}
  clearAuth(): void {}

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.cache.clear();
    this.connectionListeners.clear();
  }
}
