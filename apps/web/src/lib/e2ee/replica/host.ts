// The replicas of the e2ee-active spaces (docs/E2EE_DESIGN.md §6.5, WP7). One replica per space, opened after
// unlock: its store (store.ts), the local backend over it (the ported handlers answer device queries), and
// the feed from the server (e2ee.pull.head, pull, mine). On the Mac, several windows share one replica per
// space: the window holding the Web Lock `folevi-e2ee-<scopeKey>` runs it and the others reach it over a
// BroadcastChannel, through lib/local/host.ts.
import type { OpResult, SyncOp } from "@folevi/editor-schema";
import { LocalBackend } from "@/lib/local/backend";
import type { LocalClient, LocalExecutor } from "@/lib/local/client";
import { startLocalHost, type ChannelLike, type LocalHost, type LockManagerLike } from "@/lib/local/host";
import type { LocalProfile } from "@/lib/local/functions/shared";
import { Sealer } from "../seal";
import { scopeKeyOf, type E2eeSpace, type KeyRingLike, type KeySessionLike, type WireScope } from "../router/deps";
import type { E2eePullPage, PulledMine } from "../router/refs";
import { ReplicaIngest, type IngestedIds } from "./ingest";
import { openReplicaDb, SpaceReplicaStore, type ReplicaOverlay } from "./store";

export type ReplicaStatus = { state: "opening" | "downloading" | "ready" | "locked"; have: number; total: number | null };

/** §12 WP7. */
export interface SpaceReplica {
  backend: LocalExecutor;
  /** The same backend as a reactive client (what the router's device queries watch). */
  readonly client: LocalClient;
  status(): ReplicaStatus;
  whenSynced(): Promise<void>;
  /** Asks the server for anything newer now (the head, the pages, the person's marks) and applies it. */
  catchUp?(): Promise<void>;
  /** The person's profile changed. */
  setProfile?(profile: LocalProfile): Promise<void>;
  /** Applies the router's own accepted writes at once (resolves once a device query would see them). */
  applyAccepted(results: OpResult[], ops?: readonly SyncOp[]): void | Promise<void>;
  close(): Promise<void>;
}

/** §12 WP7. */
export interface ReplicaHub {
  open(scope: WireScope): Promise<SpaceReplica>;
  get(scope: WireScope): SpaceReplica | null;
  status(scope: WireScope): ReplicaStatus;
  /** The store of a replica this window runs (composers capture over it), or null. */
  hostedStore?(scope: WireScope): SpaceReplicaStore | null;
}

/** Where the replica's rows come from: the e2ee.pull functions, live. */
export interface PullSource {
  /** Calls `cb` with the scope's head seq now and whenever it moves. Returns the unsubscribe. */
  watchHead(scope: WireScope, cb: (seq: number) => void): () => void;
  page(scope: WireScope, cursor: number, limit: number): Promise<E2eePullPage>;
  watchMine(scope: WireScope, cb: (mine: PulledMine) => void): () => void;
  /** One-shot reads (catching up on demand). */
  profile?(): Promise<LocalProfile>;
  head?(scope: WireScope): Promise<number>;
  mine?(scope: WireScope): Promise<PulledMine>;
}

export interface ReplicaHubOptions {
  source: PullSource;
  keyring: KeyRingLike;
  session: KeySessionLike;
  /** The e2ee-active space for a scope (scope id, level), from the space index. */
  space(scope: WireScope): E2eeSpace | null;
  /** The person, as users.me gives it. */
  profile(): Promise<LocalProfile>;
  /** A workspace's name (answers name the place). */
  placeName?(scope: WireScope): Promise<string | undefined>;
  /** Keep the replica in IndexedDB (a trusted device) or only in memory (a public session, §6.10). */
  persist(): boolean;
  /** Ids each ingest saw (the router's space index). */
  onIds?(scope: WireScope, ids: IngestedIds): void;
  /** The engine's unsent edits for the replica's overlay, per space. */
  overlay?(scope: WireScope, store: SpaceReplicaStore): ReplicaOverlay | null;
  /** Rows per pull page (default 500). */
  pageSize?: number;
  /** Multi-window election (default: Web Locks and BroadcastChannel; null: this window always hosts). */
  locks?: LockManagerLike | null;
  channel?: (name: string) => ChannelLike;
  deviceId(): string;
}

const LOCKED: ReplicaStatus = Object.freeze({ state: "locked", have: 0, total: null });
const OPENING: ReplicaStatus = Object.freeze({ state: "opening", have: 0, total: null });

/** A replica run by this window: store, backend, feed. */
class HostedReplica {
  readonly store: SpaceReplicaStore;
  readonly backend: LocalBackend;
  private ingest: ReplicaIngest;
  private cursor = 0;
  private head = 0;
  private draining: Promise<void> | null = null;
  private stops: (() => void)[] = [];
  private synced: Promise<void>;
  private markSynced: () => void = () => {};
  private firstPullDone = false;
  private closed = false;
  have = 0;
  state: ReplicaStatus["state"] = "opening";
  onStatus: () => void = () => {};

  private constructor(
    private readonly o: ReplicaHubOptions,
    readonly scope: WireScope,
    store: SpaceReplicaStore,
    profile: LocalProfile,
    scopeId: string,
    placeName?: string,
  ) {
    this.store = store;
    this.backend = new LocalBackend(store, { deviceId: o.deviceId() });
    this.ingest = new ReplicaIngest({
      store,
      sealer: new Sealer(o.keyring),
      keyring: o.keyring,
      scope,
      scopeId,
      profile,
      placeName,
      onIds: (ids) => o.onIds?.(scope, ids),
    });
    this.synced = new Promise((r) => (this.markSynced = r));
  }

  static async open(o: ReplicaHubOptions, scope: WireScope): Promise<HostedReplica> {
    const space = o.space(scope);
    if (!space) throw new Error("This space isn't end-to-end encrypted.");
    const store = new SpaceReplicaStore(await openReplicaDb(space.scopeId, o.persist()));
    await store.load();
    const replica = new HostedReplica(o, scope, store, await o.profile(), space.scopeId, scope.kind === "workspace" ? await o.placeName?.(scope).catch(() => undefined) : undefined);
    await replica.ingest.ensureProfile();
    replica.cursor = ((await store.readState("cursor")) as number | undefined) ?? 0;
    replica.have = (await store.list("documents")).length;
    // What the database kept is shown at once; ids reach the space index before the first pull.
    if (replica.have) {
      const docs = await store.list("documents");
      o.onIds?.(scope, { documents: docs.map((d) => ({ id: d.id, sealed: true, title: d.title, icon: d.icon })), removed: [], folders: (await store.list("folders")).map((f) => f.id), tags: [], files: [], collections: (await store.list("collections")).map((c) => ({ id: c.id, documentId: c.documentId })), blocks: (await Promise.all(docs.map((d) => store.list("blocks", d.id)))).flat().map((b) => ({ id: b.id, documentId: b.documentId })) });
    }
    const overlay = o.overlay?.(scope, store) ?? null;
    if (overlay) store.setOverlay(overlay);
    replica.start();
    return replica;
  }

  private start() {
    const run = () => {
      if (this.closed) return;
      if (this.o.session.state() !== "unlocked") {
        this.setState("locked");
        return;
      }
      if (this.stops.length) return;
      this.setState(this.cursor > 0 ? "ready" : "downloading");
      this.stops.push(
        this.o.source.watchHead(this.scope, (seq) => {
          this.head = Math.max(this.head, seq);
          if (this.head > this.cursor) void this.drain();
          else if (!this.firstPullDone) this.finishFirst();
        }),
      );
      this.stops.push(this.o.source.watchMine(this.scope, (mine) => void this.ingest.mine(mine).catch((e) => console.warn("[e2ee] Couldn't update stars and recents in the replica.", errorName(e)))));
    };
    const offSession = this.o.session.subscribe(() => {
      if (this.o.session.state() === "unlocked") run();
      else {
        for (const s of this.stops.splice(0)) s();
        this.setState("locked");
      }
    });
    this.offSession = offSession;
    run();
  }

  private offSession: () => void = () => {};

  private setState(s: ReplicaStatus["state"]) {
    if (this.state === s) return;
    this.state = s;
    this.onStatus();
  }

  private finishFirst() {
    this.firstPullDone = true;
    this.setState("ready");
    this.markSynced();
  }

  /** Pages through e2ee.pull until it has caught up with the head. */
  private drain(): Promise<void> {
    this.draining ??= (async () => {
      try {
        for (let guard = 0; guard < 100_000 && !this.closed; guard++) {
          const page = await this.o.source.page(this.scope, this.cursor, this.o.pageSize ?? 500);
          await this.ingest.page(page);
          this.cursor = Math.max(this.cursor, page.nextCursor);
          this.head = Math.max(this.head, page.head);
          await this.store.writeState([["cursor", this.cursor]]);
          this.have = (await this.store.list("documents")).length;
          this.onStatus();
          if (!page.hasMore) break;
        }
        if (this.cursor >= this.head) this.finishFirst();
      } catch (e) {
        console.warn("[e2ee] The encrypted space's copy couldn't be brought up to date; trying again.", errorName(e));
        setTimeout(() => void this.drain(), 5000);
      } finally {
        this.draining = null;
      }
      if (!this.closed && this.head > this.cursor) await this.drain();
    })();
    return this.draining;
  }

  whenSynced(): Promise<void> {
    return this.synced;
  }

  async setProfile(profile: LocalProfile): Promise<void> {
    await this.ingest.setProfile(profile);
  }

  async catchUp(): Promise<void> {
    if (this.closed || this.o.session.state() !== "unlocked") return;
    if (this.o.source.head) this.head = Math.max(this.head, await this.o.source.head(this.scope));
    while (this.draining) await this.draining;
    if (this.head > this.cursor) await this.drain();
    if (this.o.source.mine) await this.ingest.mine(await this.o.source.mine(this.scope));
    if (this.o.source.profile) await this.ingest.setProfile(await this.o.source.profile());
  }

  status(): ReplicaStatus {
    if (this.state === "locked") return LOCKED;
    return { state: this.state, have: this.have, total: this.state === "ready" ? this.have : null };
  }

  applyAccepted(results: OpResult[], ops: readonly SyncOp[] = []): Promise<void> {
    return this.ingest.accepted(results, ops).catch((e) => console.warn("[e2ee] Couldn't apply accepted changes to the replica.", errorName(e)));
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.offSession();
    for (const s of this.stops.splice(0)) s();
    await this.backend.close();
  }
}

function errorName(e: unknown): string {
  return e instanceof Error ? e.name : typeof e;
}

/** One space's replica as this window sees it: hosted here, or reached in the window that hosts it. */
class WindowReplica implements SpaceReplica {
  hosted: HostedReplica | null = null;
  private waiting: { results: OpResult[]; ops: readonly SyncOp[] }[] = [];
  private syncedWaiters: (() => void)[] = [];

  constructor(
    readonly host: LocalHost,
    private readonly onStatus: () => void,
  ) {}

  get client(): LocalClient {
    return this.host.client;
  }

  get backend(): LocalExecutor {
    return this.hosted?.backend ?? (this.host.client as unknown as LocalExecutor);
  }

  adopt(h: HostedReplica) {
    this.hosted = h;
    h.onStatus = this.onStatus;
    for (const w of this.waiting.splice(0)) void h.applyAccepted(w.results, w.ops);
    for (const w of this.syncedWaiters.splice(0)) void h.whenSynced().then(w);
    this.onStatus();
  }

  status(): ReplicaStatus {
    if (this.hosted) return this.hosted.status();
    // Another window runs this space's replica: it answers, and is as up to date as that window.
    return this.host.role === "follower" ? { state: "ready", have: 0, total: null } : OPENING;
  }

  async catchUp(): Promise<void> {
    await this.hosted?.catchUp();
  }

  async setProfile(profile: LocalProfile): Promise<void> {
    await this.hosted?.setProfile(profile);
  }

  whenSynced(): Promise<void> {
    if (this.hosted) return this.hosted.whenSynced();
    if (this.host.role === "follower") return Promise.resolve();
    return new Promise((r) => this.syncedWaiters.push(r));
  }

  async applyAccepted(results: OpResult[], ops: readonly SyncOp[] = []): Promise<void> {
    // In a follower window the host window hears of these through the pull.
    if (this.hosted) await this.hosted.applyAccepted(results, ops);
    else if (this.host.role !== "follower") this.waiting.push({ results, ops });
  }

  async close(): Promise<void> {
    await this.host.close();
  }
}

export class Replicas implements ReplicaHub {
  private replicas = new Map<string, WindowReplica>();
  private opening = new Map<string, Promise<SpaceReplica>>();
  private listeners = new Set<() => void>();

  constructor(private readonly o: ReplicaHubOptions) {}

  open(scope: WireScope): Promise<SpaceReplica> {
    const key = scopeKeyOf(scope);
    // Still opening: the same wait (the window may not be hosting it yet).
    let p = this.opening.get(key);
    if (p) return p;
    const have = this.replicas.get(key);
    if (have) return Promise.resolve(have);
    if (!p) {
      p = this.start(scope).finally(() => this.opening.delete(key));
      this.opening.set(key, p);
    }
    return p;
  }

  private async start(scope: WireScope): Promise<SpaceReplica> {
    const key = scopeKeyOf(scope);
    const space = this.o.space(scope);
    if (!space) throw new Error("This space isn't end-to-end encrypted.");
    const name = `folevi-e2ee-${space.scopeId}`;
    let win: WindowReplica | null = null;
    const host = startLocalHost({
      lockName: name,
      locks: this.o.locks,
      // No election (locks: null) means this window always hosts: it needs no channel to the others.
      channel: this.o.channel ? () => this.o.channel!(name) : this.o.locks !== null && typeof BroadcastChannel !== "undefined" ? () => new BroadcastChannel(name) as unknown as ChannelLike : () => memoryChannel(),
      target: null,
      openBackend: async () => {
        const h = await HostedReplica.open(this.o, scope);
        win?.adopt(h);
        return h.backend;
      },
    });
    win = new WindowReplica(host, () => this.emit());
    this.replicas.set(key, win);
    this.emit();
    await host.ready;
    return win;
  }

  get(scope: WireScope): SpaceReplica | null {
    return this.replicas.get(scopeKeyOf(scope)) ?? null;
  }

  /** The hosted replica's store (tests, and the export's file hydration). */
  hostedStore(scope: WireScope): SpaceReplicaStore | null {
    return this.replicas.get(scopeKeyOf(scope))?.hosted?.store ?? null;
  }

  status(scope: WireScope): ReplicaStatus {
    if (this.o.session.state() !== "unlocked") return LOCKED;
    return this.replicas.get(scopeKeyOf(scope))?.status() ?? OPENING;
  }

  /** Closes the replicas of spaces no longer e2ee-active (or all, on lock or sign-out). */
  async closeExcept(keep: (scope: WireScope) => boolean): Promise<void> {
    for (const [key, r] of [...this.replicas]) {
      const scope: WireScope = key === "personal" ? { kind: "personal" } : { kind: "workspace", workspaceId: key.slice("workspace:".length) };
      if (keep(scope)) continue;
      this.replicas.delete(key);
      await r.close();
    }
    this.emit();
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit() {
    for (const l of [...this.listeners]) l();
  }
}

/** A channel that reaches nobody (one window, no BroadcastChannel: tests, old runtimes). */
function memoryChannel(): ChannelLike {
  return { postMessage() {}, addEventListener() {}, removeEventListener() {}, close() {} };
}
