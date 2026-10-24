// Small reactive pieces the engine's views are built from (docs/NATIVE_APP_PLAN.md section 8, `lib/engine/`): a
// live Convex query over the page's client (the Convex client, the E2EE router or the local backend, whichever
// the data layer uses), with the device's kept answer while there's no live one, and plain signals for
// everything else that changes (the outbox, the sync engine, the app state). No React.
import { ConvexError } from "convex/values";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { EngineError } from "./protocol";

/** What the engine needs of the page's client: the surface convex/react uses. */
export interface EngineClient {
  watchQuery(query: FunctionReference<"query">, args: Record<string, unknown>): { onUpdate(cb: () => void): () => void; localQueryResult(): unknown };
  query(query: FunctionReference<"query">, args: Record<string, unknown>): Promise<unknown>;
  mutation(mutation: FunctionReference<"mutation">, args: Record<string, unknown>): Promise<unknown>;
  action(action: FunctionReference<"action">, args: Record<string, unknown>): Promise<unknown>;
}

/** The device's kept answers (lib/sync/queryCache.ts), so a view read once reads again offline. */
export interface KeptAnswers {
  read(name: string, args: unknown): Promise<unknown>;
  write(name: string, args: unknown, value: unknown): void;
}

/** Something that says when it changed. */
export interface Signal {
  subscribe(cb: () => void): () => void;
}

/** A value as a view sees it: the value (undefined while there's none), whether it's the kept copy, an error. */
export interface Snapshot<T> {
  value: T | undefined;
  stale: boolean;
  error: EngineError | null;
}

/** An error as the bridge carries it: a ConvexError's own code and message, else "failed" with the message. */
export function toEngineError(e: unknown): EngineError {
  if (e instanceof ConvexError) {
    const data = e.data as { code?: unknown; message?: unknown } | string | undefined;
    if (data && typeof data === "object") return { code: typeof data.code === "string" ? data.code : "failed", message: typeof data.message === "string" ? data.message : "Something went wrong." };
    if (typeof data === "string") return { code: "failed", message: data };
  }
  if (e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string" && "message" in e) {
    return { code: (e as { code: string }).code, message: String((e as { message: unknown }).message) };
  }
  return { code: "failed", message: e instanceof Error && e.message ? e.message : "Something went wrong." };
}

/** Listeners with lazy start and stop: `start` runs when the first one arrives, its cleanup when the last leaves. */
export class Emitter implements Signal {
  private listeners = new Set<() => void>();
  private stop: (() => void) | null = null;
  constructor(private start: ((emit: () => void) => () => void) | null = null) {}
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    if (this.listeners.size === 1 && this.start) this.stop = this.start(() => this.emit());
    return () => {
      if (!this.listeners.delete(cb)) return;
      if (!this.listeners.size && this.stop) {
        const stop = this.stop;
        this.stop = null;
        stop();
      }
    };
  }
  emit(): void {
    for (const l of [...this.listeners]) l();
  }
  get size(): number {
    return this.listeners.size;
  }
}

/** A signal over any `subscribe(cb) => unsubscribe` (the outbox, the sync engine, the E2EE router). */
export function signalOf(subscribe: ((cb: () => void) => () => void) | null | undefined): Signal {
  return { subscribe: (cb) => (subscribe ? subscribe(cb) : () => undefined) };
}

export interface QuerySourceOptions {
  kept?: KeptAnswers | null;
  /** Whether live answers may be written to the device (never for encrypted spaces: decrypted data stays in memory). */
  persist?: () => boolean;
}

/**
 * One live query. Watches only while someone listens. While the live answer hasn't come (offline, starting up),
 * the device's kept answer stands in, marked stale.
 */
export class QuerySource<T> implements Signal {
  readonly name: string;
  private emitter: Emitter;
  private live: { value: T | undefined; error: EngineError | null } = { value: undefined, error: null };
  private kept: T | undefined = undefined;
  private keptAsked = false;

  constructor(
    private client: EngineClient,
    private ref: FunctionReference<"query">,
    readonly args: Record<string, unknown>,
    private opts: QuerySourceOptions = {},
  ) {
    this.name = getFunctionName(ref);
    this.emitter = new Emitter((emit) => this.watch(emit));
  }

  subscribe(cb: () => void): () => void {
    return this.emitter.subscribe(cb);
  }

  snapshot(): Snapshot<T> {
    if (this.live.value !== undefined) return { value: this.live.value, stale: false, error: null };
    if (this.live.error) return { value: undefined, stale: false, error: this.live.error };
    if (this.kept !== undefined) return { value: this.kept, stale: true, error: null };
    return { value: undefined, stale: true, error: null };
  }

  private read(): void {
    try {
      const value = this.watcher?.localQueryResult() as T | undefined;
      this.live = { value, error: null };
      if (value !== undefined && this.opts.kept && (this.opts.persist?.() ?? true)) this.opts.kept.write(this.name, this.args, value);
    } catch (e) {
      this.live = { value: undefined, error: toEngineError(e) };
    }
  }

  private watcher: ReturnType<EngineClient["watchQuery"]> | null = null;

  private watch(emit: () => void): () => void {
    let w: ReturnType<EngineClient["watchQuery"]>;
    try {
      w = this.client.watchQuery(this.ref, this.args);
    } catch (e) {
      this.live = { value: undefined, error: toEngineError(e) };
      return () => undefined;
    }
    this.watcher = w;
    const off = w.onUpdate(() => {
      this.read();
      emit();
    });
    this.read();
    if (this.live.value === undefined && !this.keptAsked && this.opts.kept) {
      this.keptAsked = true;
      const kept = this.opts.kept;
      void kept.read(this.name, this.args).then(
        (value) => {
          if (value === undefined || this.live.value !== undefined) return;
          this.kept = value as T;
          emit();
        },
        () => undefined,
      );
    }
    return () => {
      off();
      this.watcher = null;
    };
  }
}

/** Subscribes to every signal; returns one function that ends them all. */
export function subscribeAll(signals: readonly (Signal | null | undefined)[], cb: () => void): () => void {
  const offs = signals.filter((s): s is Signal => Boolean(s)).map((s) => s.subscribe(cb));
  return () => {
    for (const off of offs) off();
  };
}
