// `E2eeRouterClient`: the duck-typed client between the app and Convex (docs/E2EE_DESIGN.md §6.4 to §6.6,
// WP7). It has the surface convex/react uses (watchQuery, query, mutation, action, connectionState,
// subscribeToConnectionState, logger, setAuth, clearAuth, close; the same as LocalClient), so the 140
// component files, the sync engine and the outbox run unchanged. Per call it finds the space concerned
// (spaces.ts) and applies the function's route (routes.ts): straight to Convex, Convex then opened, the
// replica's local backend, the server's answer merged with the replica's, a sealed variant, a device
// composer, Foli AI's per-request rules, or refused. `sync.push` it seals itself (§6.6).
//
// Only accounts with E2EE set up get this client (lib/convex/provider.tsx); Standard accounts get the raw
// ConvexReactClient. Even here, a call about a Standard space is passed through untouched.
import { ConvexError } from "convex/values";
import { getFunctionName, type FunctionReference } from "convex/server";
import { canonicalJson, randomNoteEmoji, sanitizeTitle, type OpResult, type SyncOp, type WireBlock, type WireScope } from "@folevi/editor-schema";
import type { ConvexReactClient } from "convex/react";
import { api } from "@/lib/convex/api";
import type { SyncEngine } from "@/lib/sync/engine";
import type { LocalProfile } from "@/lib/local/functions/shared";
import type { LocalBlock, LocalDocument, LocalFile as LocalFileRow } from "@/lib/local/store";
import { toWireBytes } from "@folevi/local-store/e2ee";
import { Sealer, configureSealer, type DocumentMeta } from "../seal";
import { FileCache } from "../files";
import { Replicas, type PullSource, type ReplicaStatus } from "../replica/host";
import type { SpaceReplicaStore, ReplicaOverlay } from "../replica/store";
import { capture, project, type Captured, type CreateWithMeta, type Projection } from "../compose/capture";
import { openDeep } from "./decoders";
import { isEncryptedLevel, scopeKeyOf, type E2eeSpace, type KeyRingLike, type KeySessionLike } from "./deps";
import { pullHead, pullMine, pullPage, spacesMine, type MineSpaceRow } from "./refs";
import { routeOf } from "./routes";
import { SpaceIndex, type Resolution } from "./spaces";
import type { AiRouter, Call, CallKind, InnerClient, Merger, Route, RouterEnv } from "./types";

type AnyRef = FunctionReference<"query" | "mutation" | "action">;
type Args = Record<string, unknown>;

/** The error a call about an encrypted space gets while this device is locked (AccountGate shows the unlock screen). */
export function lockedSessionError(): ConvexError<{ code: string; message: string }> {
  return new ConvexError({ code: "e2ee_locked_session", message: "Unlock end-to-end encryption on this device to open this." });
}

/**
 * A call while this device is locked: about an encrypted space or a sealed note, it waits for the unlock
 * screen; about a Standard space that only has some locked notes, it goes to Convex as it is (Standard
 * stays usable; the locked notes show as the server has them, and opening one asks to unlock).
 */
function lockedMode(res: Resolution): { kind: "locked" } | { kind: "pass" } {
  return res.sealed || isEncryptedLevel(res.space) || res.space?.state === "disabling" ? { kind: "locked" } : { kind: "pass" };
}

/** What the router needs of the plain Convex client (a ConvexReactClient, or a test double with watchQuery). */
export type InnerReactClient = Pick<ConvexReactClient, "watchQuery" | "query" | "mutation" | "action" | "connectionState" | "subscribeToConnectionState" | "setAuth" | "clearAuth" | "close"> & {
  logger?: unknown;
  url?: string;
};

export interface RouterDeps {
  session: KeySessionLike;
  keyring: KeyRingLike;
  spaces?: SpaceIndex;
  replicas?: Replicas;
  engine?: () => SyncEngine | null;
  /** Foli AI per request (WP8's `aiRoute`); the default refuses until it's set. */
  ai?: AiRouter;
  /** Keep replicas in IndexedDB (a trusted device), or in memory (a public session). */
  persist?: () => boolean;
  /** Tests: the Web Lock and channel the replicas elect a host with (null: this window hosts). */
  locks?: ConstructorParameters<typeof Replicas>[0]["locks"];
  fetch?: typeof fetch;
}

/** A watch as convex/react uses it. */
interface WatchLike {
  onUpdate(cb: () => void): () => void;
  localQueryResult(): unknown;
  localQueryLogs?(): unknown;
  journal?(): unknown;
}

type Mode =
  | { kind: "pass" }
  | { kind: "locked" }
  | { kind: "waiting" }
  | { kind: "decode"; route: Extract<Route, { kind: "decode" | "ai" }>; res: Resolution }
  | { kind: "device"; scope: WireScope; res: Resolution }
  | { kind: "merge"; scopes: WireScope[]; merge: Merger; res: Resolution };

const modeKey = (m: Mode): string => (m.kind === "device" ? `device:${scopeKeyOf(m.scope)}` : m.kind === "merge" ? `merge:${m.scopes.map(scopeKeyOf).join(",")}` : m.kind);

/** The args a local handler takes: a replica is one space, which the handlers know as their only one. */
function deviceArgs(args: Args): Args {
  if (args.scope && typeof args.scope === "object") return { ...args, scope: { kind: "personal" } };
  return args;
}

const ENTRY_LINGER_MS = 5_000;

/** One decoded Convex query, shared by every watch of it (convex/react asks for watches on every render). */
class DecodeEntry {
  private subscribers = new Set<() => void>();
  private inner: WatchLike;
  private off: (() => void) | null = null;
  private lastRaw: unknown = undefined;
  private value: { value: unknown } | { error: unknown } | undefined;
  private gen = 0;
  private linger: ReturnType<typeof setTimeout> | null = null;

  constructor(
    router: E2eeRouterClient,
    private readonly key: string,
    ref: FunctionReference<"query">,
    args: Args,
    options: unknown,
    private readonly open: (raw: unknown) => Promise<unknown>,
    private readonly drop: (key: string) => void,
  ) {
    this.inner = (router.inner.watchQuery as (r: unknown, a: unknown, o?: unknown) => WatchLike)(ref, args, options);
  }

  read(): unknown {
    if (!this.off) this.refresh(false);
    const v = this.value;
    if (!v) return undefined;
    if ("error" in v) throw v.error;
    return v.value;
  }

  subscribe(cb: () => void): () => void {
    if (this.linger) clearTimeout(this.linger);
    this.linger = null;
    this.subscribers.add(cb);
    if (!this.off) {
      this.off = this.inner.onUpdate(() => this.refresh(true));
      this.refresh(true);
    }
    return () => {
      this.subscribers.delete(cb);
      if (this.subscribers.size || this.linger) return;
      this.linger = setTimeout(() => {
        this.linger = null;
        if (this.subscribers.size) return;
        this.off?.();
        this.off = null;
        this.drop(this.key);
      }, ENTRY_LINGER_MS);
    };
  }

  private refresh(notify: boolean) {
    let raw: unknown;
    try {
      raw = this.inner.localQueryResult();
    } catch (error) {
      this.value = { error };
      if (notify) this.emit();
      return;
    }
    if (raw === undefined || raw === this.lastRaw) return;
    this.lastRaw = raw;
    const gen = ++this.gen;
    void this.open(raw).then(
      (value) => {
        if (gen !== this.gen) return;
        this.value = { value };
        this.emit();
      },
      (error) => {
        if (gen !== this.gen) return;
        this.value = { error };
        this.emit();
      },
    );
  }

  private emit() {
    for (const s of [...this.subscribers]) s();
  }
}

/** A watch handle: re-routed when the spaces or the lock state change, so nothing is stuck on a stale route. */
class RoutedWatch implements WatchLike {
  constructor(
    private readonly router: E2eeRouterClient,
    private readonly ref: FunctionReference<"query">,
    private readonly args: Args,
    private readonly options: unknown,
  ) {}

  private innerWatch(): WatchLike {
    return (this.router.inner.watchQuery as (r: unknown, a: unknown, o?: unknown) => WatchLike)(this.ref, this.args, this.options);
  }

  localQueryResult(): unknown {
    const m = this.router.modeOf(getFunctionName(this.ref), "query", this.args);
    switch (m.kind) {
      case "pass":
        return this.innerWatch().localQueryResult();
      case "locked":
        throw lockedSessionError();
      case "waiting":
        return undefined;
      default:
        return this.router.readMode(m, this.ref, this.args, this.options);
    }
  }

  onUpdate(cb: () => void): () => void {
    let current: { key: string; off: () => void } | null = null;
    const bind = (): boolean => {
      const m = this.router.modeOf(getFunctionName(this.ref), "query", this.args);
      const key = modeKey(m);
      if (current?.key === key) return false;
      current?.off();
      current = { key, off: m.kind === "pass" ? this.innerWatch().onUpdate(cb) : m.kind === "locked" || m.kind === "waiting" ? () => {} : this.router.subscribeMode(m, this.ref, this.args, this.options, cb) };
      return true;
    };
    bind();
    const offRoutes = this.router.onRoutesChanged(() => {
      if (bind()) cb();
    });
    return () => {
      offRoutes();
      current?.off();
      current = null;
    };
  }

  localQueryLogs(): unknown {
    const m = this.router.modeOf(getFunctionName(this.ref), "query", this.args);
    return m.kind === "pass" ? this.innerWatch().localQueryLogs?.() : undefined;
  }

  journal(): unknown {
    const m = this.router.modeOf(getFunctionName(this.ref), "query", this.args);
    return m.kind === "pass" ? this.innerWatch().journal?.() : undefined;
  }
}

/** The default Foli AI rule until WP8's per-request context is wired: locked never, switch off never, else not yet. */
const defaultAi: AiRouter = async (call, _env, forward) => {
  void _env;
  const space = call.res.space;
  if (call.kind === "query") return await forward();
  if (call.res.sealed && (!space || !isEncryptedLevel(space))) throw new ConvexError({ code: "e2ee_locked", message: "This note is always fully encrypted, so Foli AI can't use it." });
  if (!space || !isEncryptedLevel(space)) return await forward();
  if (space.switches.foliAi === "off") throw new ConvexError({ code: "e2ee_switch_off", message: "Turn on Foli AI in Settings > Privacy to use this here.", switch: "foliAi" });
  throw new ConvexError({ code: "e2ee_unavailable", message: "Foli AI isn't available in this encrypted space yet.", feature: "ai" });
};

export class E2eeRouterClient {
  readonly inner: InnerReactClient;
  readonly spaces: SpaceIndex;
  readonly replicas: Replicas;
  readonly sealer: Sealer;
  readonly files: FileCache;
  readonly env: RouterEnv;
  private readonly session: KeySessionLike;
  private readonly keyring: KeyRingLike;
  private engineOf: () => SyncEngine | null;
  private ai: AiRouter;
  private routeListeners = new Set<() => void>();
  private entries = new Map<string, DecodeEntry>();
  private spacesReady = false;
  private readyWaiters: (() => void)[] = [];
  private stops: (() => void)[] = [];
  private profile: Promise<LocalProfile> | null = null;
  /** Ops sealed once are sent the same way again (a resend is answered as a replay of the first). */
  private sealedOps = new Map<string, SyncOp>();
  private closed = false;

  constructor(inner: InnerReactClient | ConvexReactClient, deps: RouterDeps) {
    this.inner = inner as InnerReactClient;
    this.session = deps.session;
    this.keyring = deps.keyring;
    this.engineOf = deps.engine ?? (() => null);
    this.ai = deps.ai ?? defaultAi;
    this.spaces = deps.spaces ?? new SpaceIndex();
    this.sealer = configureSealer(deps.keyring)!;
    this.files = new FileCache(() => this.sealer, { fetch: deps.fetch });
    this.replicas =
      deps.replicas ??
      new Replicas({
        source: this.pullSource(),
        keyring: deps.keyring,
        session: deps.session,
        space: (scope) => this.spaces.get(scope),
        profile: () => this.me(),
        placeName: async (scope) => {
          if (scope.kind !== "workspace") return undefined;
          const mine = (await this.inner.query(api.workspaces.mine, {})) as { id: string; name: string }[] | null;
          return mine?.find((w) => w.id === scope.workspaceId)?.name;
        },
        persist: deps.persist ?? (() => true),
        deviceId: () => this.engineOf()?.deviceId ?? safeDeviceId(deps.session),
        locks: deps.locks,
        onIds: (scope, ids) => {
          for (const d of ids.documents) this.spaces.noteDocument(d.id, scope, d.sealed, d.title !== undefined ? { title: d.title, icon: d.icon ?? null } : undefined);
          for (const id of ids.removed) this.spaces.forgetDocument(id);
          for (const id of ids.folders) this.spaces.noteRef("folder", id, scope);
          for (const id of ids.tags) this.spaces.noteRef("tag", id, scope);
          for (const f of ids.files) this.spaces.noteRef("file", f.id, scope, f.documentId);
          for (const c of ids.collections) this.spaces.noteRef("collection", c.id, scope, c.documentId);
          for (const b of ids.blocks) this.spaces.noteRef("block", b.id, scope, b.documentId);
          this.routesChanged();
        },
        overlay: (scope, store) => this.overlayFor(scope, store),
      });
    this.env = {
      inner: this.inner as unknown as InnerClient,
      sealer: this.sealer,
      keyring: deps.keyring,
      session: deps.session,
      spaces: this.spaces,
      replicas: this.replicas,
      files: this.files,
      engine: () => this.engineOf(),
      push: (scope, ops) => this.pushOps(scope, this.engineOf()?.deviceId ?? safeDeviceId(deps.session), ops),
      call: (kind, name, args) => this.callByName(kind, name, args),
    };
    this.stops.push(this.spaces.subscribe(() => this.routesChanged()));
    this.stops.push(this.session.subscribe(() => this.onSession()));
    this.watchSpaces();
    this.watchProfile();
  }

  /** The person's profile as the replicas' handlers read it (study's new cards a day, the time zone …). */
  private watchProfile() {
    const w = (this.inner.watchQuery as (r: unknown, a: unknown) => WatchLike)(api.users.me, {});
    let last = "";
    const read = () => {
      let me: { state?: string; profile?: Record<string, unknown> } | undefined;
      try {
        me = w.localQueryResult() as typeof me;
      } catch {
        return;
      }
      if (me?.state !== "ready" || !me.profile) return;
      const profile = omit(me.profile, ["avatarUrl", "entitlements"]) as LocalProfile;
      const json = JSON.stringify(profile);
      if (json === last) return;
      last = json;
      this.profile = Promise.resolve(profile);
      for (const s of this.spaces.list()) void this.replicas.get(s.scope)?.setProfile?.(profile);
    };
    this.stops.push(w.onUpdate(read));
    read();
  }

  // ---- state ------------------------------------------------------------------------------------------

  /** The account's sync engine, once the app has one (composers queue through it; the overlay reads it). */
  setEngine(engine: (() => SyncEngine | null) | SyncEngine | null): void {
    this.engineOf = typeof engine === "function" ? engine : () => engine;
    this.routesChanged();
  }

  /** Foli AI's router (WP8 `aiRoute`). */
  setAiRouter(ai: AiRouter | null): void {
    this.ai = ai ?? defaultAi;
  }

  /** AppStateProvider's current scope: calls naming nothing else concern it (§6.4 rule 3). */
  setScope(scope: WireScope | null): void {
    this.spaces.setContextScope(scope);
    this.routesChanged();
  }

  onRoutesChanged(cb: () => void): () => void {
    this.routeListeners.add(cb);
    return () => {
      this.routeListeners.delete(cb);
    };
  }

  private routesChanged() {
    for (const l of [...this.routeListeners]) l();
  }

  /** Resolves once e2ee.spaces.mine has answered (until then nothing about a space can be routed). */
  ready(): Promise<void> {
    if (this.spacesReady) return Promise.resolve();
    return new Promise((r) => this.readyWaiters.push(r));
  }

  private watchSpaces() {
    const w = (this.inner.watchQuery as (r: unknown, a: unknown) => WatchLike)(spacesMine, {});
    const read = () => {
      let rows: MineSpaceRow[] | undefined;
      try {
        rows = w.localQueryResult() as MineSpaceRow[] | undefined;
      } catch {
        // No answer (signed out, an older server): nothing is e2ee-active as far as this device knows.
        rows = [];
      }
      if (rows === undefined) return;
      this.applySpaces(rows);
    };
    this.stops.push(w.onUpdate(read));
    read();
  }

  /** The e2ee-active spaces changed: replicas open for new ones and close for those gone. */
  applySpaces(rows: readonly MineSpaceRow[]): void {
    const list: E2eeSpace[] = rows.map((r) => ({ scope: r.scope, scopeId: r.scopeId, level: r.level, state: r.state, switches: r.switches, currentKeyVersion: r.currentKeyVersion, lockedCount: r.lockedCount, seq: r.seq }));
    this.spaces.setSpaces(list);
    if (!this.spacesReady) {
      this.spacesReady = true;
      for (const w of this.readyWaiters.splice(0)) w();
    }
    const keep = new Set(list.map((s) => scopeKeyOf(s.scope)));
    void this.replicas.closeExcept((scope) => keep.has(scopeKeyOf(scope)));
    if (this.session.state() === "unlocked") for (const s of list) void this.openReplica(s.scope);
    this.routesChanged();
  }

  private openReplica(scope: WireScope) {
    return this.replicas.open(scope).then(
      () => this.routesChanged(),
      (e) => console.warn("[e2ee] An encrypted space couldn't be opened on this device.", e instanceof Error ? e.name : typeof e),
    );
  }

  private onSession() {
    if (this.session.state() === "unlocked") for (const s of this.spaces.list()) void this.openReplica(s.scope);
    else this.files.clear();
    this.routesChanged();
  }

  private me(): Promise<LocalProfile> {
    this.profile ??= (async () => {
      const me = (await this.inner.query(api.users.me, {})) as { state: string; profile?: LocalProfile & { avatarUrl?: unknown; entitlements?: unknown } };
      if (me.state !== "ready" || !me.profile) throw new Error("The profile isn't ready.");
      return omit(me.profile, ["avatarUrl", "entitlements"]) as LocalProfile;
    })();
    this.profile.catch(() => (this.profile = null));
    return this.profile;
  }

  private pullSource(): PullSource {
    const watch = <T>(ref: FunctionReference<"query">, args: Args, cb: (v: T) => void) => {
      const w = (this.inner.watchQuery as (r: unknown, a: unknown) => WatchLike)(ref, args);
      const read = () => {
        let v: unknown;
        try {
          v = w.localQueryResult();
        } catch {
          return;
        }
        if (v !== undefined) cb(v as T);
      };
      const off = w.onUpdate(read);
      read();
      return off;
    };
    return {
      watchHead: (scope, cb) => watch<{ seq: number }>(pullHead, { scope }, (h) => cb(h.seq)),
      page: async (scope, cursor, limit) => (await this.inner.query(pullPage, { scope, cursor, limit })) as Awaited<ReturnType<PullSource["page"]>>,
      watchMine: (scope, cb) => watch(pullMine, { scope }, cb),
      head: async (scope) => ((await this.inner.query(pullHead, { scope })) as { seq: number }).seq,
      profile: async () => {
        this.profile = null;
        return await this.me();
      },
      mine: async (scope) => (await this.inner.query(pullMine, { scope })) as Awaited<ReturnType<NonNullable<PullSource["mine"]>>>,
    };
  }

  // ---- routing ----------------------------------------------------------------------------------------

  /** How a call is answered right now. */
  modeOf(name: string, kind: CallKind, args: Args): Mode {
    const route = routeOf(name);
    if (route.kind === "pass") return { kind: "pass" };
    if (!this.spacesReady) return { kind: "waiting" };
    if (!this.spaces.any) return { kind: "pass" };
    if (name === "search:everywhere" && kind === "query") {
      const scopes = this.spaces.list().map((s) => s.scope);
      if (this.session.state() !== "unlocked") return { kind: "pass" };
      return { kind: "merge", scopes, merge: (route as Extract<Route, { kind: "device" }>).merge ?? ((s) => s), res: this.spaces.resolve(args) };
    }
    const res = this.spaces.resolve(args);
    if (!res.active) return { kind: "pass" };
    if (this.session.state() !== "unlocked") return lockedMode(res);
    if (route.kind === "decode" || route.kind === "ai") return { kind: "decode", route, res };
    if (route.kind === "device" && res.space) {
      if (isEncryptedLevel(res.space) && !route.serverToo) return { kind: "device", scope: res.space.scope, res };
      return { kind: "merge", scopes: [res.space.scope], merge: route.merge ?? ((s) => s), res };
    }
    if (route.kind === "overlay") return { kind: "merge", scopes: res.space ? [res.space.scope] : [], merge: route.merge, res };
    if (route.kind === "append") return { kind: "merge", scopes: res.space ? [res.space.scope] : [], merge: route.merge, res };
    return { kind: "pass" };
  }

  private callOf(name: string, kind: CallKind, args: Args, res: Resolution): Call {
    return { name, kind, args, res };
  }

  private decoderFor(m: Extract<Mode, { kind: "decode" | "merge" }>, name: string, args: Args): (raw: unknown) => Promise<unknown> {
    const call = this.callOf(name, "query", args, m.res);
    if (m.kind === "decode" && m.route.kind === "decode") return (raw) => m.route.kind === "decode" ? m.route.open(raw, call, this.env) : Promise.resolve(raw);
    return (raw) => openDeep(raw, this.env, { documentId: (typeof args.documentId === "string" ? args.documentId : null) ?? m.res.documentId, space: m.res.space });
  }

  private entry(m: Extract<Mode, { kind: "decode" | "merge" }>, ref: FunctionReference<"query">, args: Args, options: unknown): DecodeEntry {
    const name = getFunctionName(ref);
    const key = `${name}|${canonicalJson(args)}`;
    let e = this.entries.get(key);
    if (!e) {
      e = new DecodeEntry(this, key, ref, args, options, this.decoderFor(m, name, args), (k) => this.entries.delete(k));
      this.entries.set(key, e);
    }
    return e;
  }

  private replicaWatch(scope: WireScope, ref: FunctionReference<"query">, args: Args): WatchLike | null {
    const replica = this.replicas.get(scope);
    if (!replica) {
      void this.openReplica(scope);
      return null;
    }
    return (replica.client.watchQuery as (r: unknown, a: unknown) => WatchLike)(ref, deviceArgs(args));
  }

  /** The current value of a routed (not passed) query; undefined while loading. */
  readMode(m: Exclude<Mode, { kind: "pass" | "locked" | "waiting" }>, ref: FunctionReference<"query">, args: Args, options: unknown): unknown {
    if (m.kind === "device") return this.ownersOf(m.scope, this.replicaWatch(m.scope, ref, args)?.localQueryResult());
    if (m.kind === "decode") return this.entry(m, ref, args, options).read();
    let server: unknown;
    let refused = false;
    try {
      server = this.entry(m, ref, args, options).read();
    } catch (e) {
      if (!(m.res.space && isEncryptedLevel(m.res.space))) throw e;
      refused = true;
    }
    if (server === undefined && !refused) return undefined;
    let device: unknown = undefined;
    for (const scope of m.scopes) {
      let v: unknown;
      try {
        v = this.ownersOf(scope, this.replicaWatch(scope, ref, args)?.localQueryResult());
      } catch {
        v = undefined;
      }
      if (v !== undefined) device = device === undefined ? v : m.merge(device, v, this.callOf(getFunctionName(ref), "query", args, m.res));
    }
    if (refused) return device;
    return m.merge(server, device, this.callOf(getFunctionName(ref), "query", args, m.res));
  }

  subscribeMode(m: Exclude<Mode, { kind: "pass" | "locked" | "waiting" }>, ref: FunctionReference<"query">, args: Args, options: unknown, cb: () => void): () => void {
    const offs: (() => void)[] = [];
    if (m.kind === "device" || m.kind === "merge") {
      for (const scope of m.kind === "device" ? [m.scope] : m.scopes) {
        const w = this.replicaWatch(scope, ref, args);
        if (w) offs.push(w.onUpdate(cb));
      }
    }
    if (m.kind === "decode" || m.kind === "merge") offs.push(this.entry(m, ref, args, options).subscribe(cb));
    return () => offs.forEach((o) => o());
  }

  private owned = new WeakMap<object, unknown>();

  /**
   * A replica's handlers answer as local mode does, for the one place it has (a Personal: `workspaceId` null,
   * `ownerProfileId` the person). A workspace's replica answers for the workspace: those fields are set as the
   * server sets them. The same answer gives the same object (React compares them).
   */
  ownersOf<T>(scope: WireScope, value: T): T {
    if (scope.kind !== "workspace" || !value || typeof value !== "object") return value;
    const hit = this.owned.get(value as object);
    if (hit !== undefined) return hit as T;
    const workspaceId = scope.workspaceId;
    const walk = (v: unknown, depth: number): unknown => {
      if (depth > 12 || !v || typeof v !== "object") return v;
      if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
      if (v instanceof Blob || ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return v;
      const o = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(o)) out[k] = x && typeof x === "object" ? walk(x, depth + 1) : x;
      if ("workspaceId" in o && o.workspaceId === null) {
        out.workspaceId = workspaceId;
        if ("ownerProfileId" in o) out.ownerProfileId = null;
      }
      return out;
    };
    const fixed = walk(value, 0) as T;
    this.owned.set(value as object, fixed);
    return fixed;
  }

  // ---- the ConvexReactClient surface -------------------------------------------------------------------

  /** usePaginatedQuery reads `client.logger`. */
  get logger(): unknown {
    return this.inner.logger;
  }

  get url(): string | undefined {
    return this.inner.url;
  }

  watchQuery(ref: FunctionReference<"query">, args: Args = {}, options?: unknown): WatchLike {
    const name = getFunctionName(ref);
    // Calls that never concern content go to the inner client's own watch, untouched.
    if (routeOf(name).kind === "pass") return (this.inner.watchQuery as (r: unknown, a: unknown, o?: unknown) => WatchLike)(ref, args, options);
    return new RoutedWatch(this, ref, args, options);
  }

  /** Only usePaginatedQuery_experimental calls this; the app uses the stable usePaginatedQuery (watchQuery). */
  watchPaginatedQuery(...a: unknown[]): unknown {
    return (this.inner as unknown as { watchPaginatedQuery: (...x: unknown[]) => unknown }).watchPaginatedQuery(...a);
  }

  readonly query = (async (ref: FunctionReference<"query">, args: Args = {}) => await this.runQuery(ref, args)) as ConvexReactClient["query"];

  readonly mutation = (async (ref: FunctionReference<"mutation">, args: Args = {}, options?: unknown) => await this.runMutation(ref, args, options)) as ConvexReactClient["mutation"];

  readonly action = (async (ref: FunctionReference<"action">, args: Args = {}) => await this.runAction(ref, args)) as ConvexReactClient["action"];

  connectionState() {
    return this.inner.connectionState();
  }

  subscribeToConnectionState(cb: Parameters<ConvexReactClient["subscribeToConnectionState"]>[0]) {
    return this.inner.subscribeToConnectionState(cb);
  }

  setAuth(...a: Parameters<ConvexReactClient["setAuth"]>) {
    return this.inner.setAuth(...a);
  }

  clearAuth() {
    return this.inner.clearAuth();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const s of this.stops.splice(0)) s();
    this.files.clear();
    await this.replicas.closeExcept(() => false);
    configureSealer(null);
    await this.inner.close();
  }

  /** Closes what the router holds (replicas, decrypted files) without closing the Convex client (lock, switch). */
  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const s of this.stops.splice(0)) s();
    this.files.clear();
    await this.replicas.closeExcept(() => false);
    configureSealer(null);
  }

  // ---- one-shot calls ------------------------------------------------------------------------------------

  private async runQuery(ref: FunctionReference<"query">, args: Args): Promise<unknown> {
    const name = getFunctionName(ref);
    let m = this.modeOf(name, "query", args);
    if (m.kind === "waiting") {
      await this.ready();
      m = this.modeOf(name, "query", args);
    }
    switch (m.kind) {
      case "pass":
      case "waiting":
        return await this.inner.query(ref, args);
      case "locked":
        throw lockedSessionError();
      case "device":
        return this.ownersOf(m.scope, await (await this.replicas.open(m.scope)).client.query(ref, deviceArgs(args)));
      case "decode": {
        const raw = await this.inner.query(ref, args);
        if (m.route.kind === "ai") return await this.ai(this.callOf(name, "query", args, m.res), this.env, async () => await openDeep(raw, this.env, { documentId: m.res.documentId, space: m.res.space }));
        return await m.route.open(raw, this.callOf(name, "query", args, m.res), this.env);
      }
      case "merge": {
        const call = this.callOf(name, "query", args, m.res);
        const [raw, ...device] = await Promise.all([
          // In an encrypted space the replica can answer alone if the server refuses (a guard for old clients).
          this.inner.query(ref, args).catch((e) => {
            if (m.res.space && isEncryptedLevel(m.res.space)) return undefined;
            throw e;
          }),
          ...m.scopes.map(async (s) => this.ownersOf(s, await (await this.replicas.open(s)).client.query(ref, deviceArgs(args)).catch(() => undefined))),
        ]);
        let merged: unknown = undefined;
        for (const d of device) if (d !== undefined) merged = merged === undefined ? d : m.merge(merged, d, call);
        if (raw === undefined) return merged;
        const server = await openDeep(raw, this.env, { documentId: m.res.documentId, space: m.res.space });
        return m.merge(server, merged, call);
      }
    }
  }

  private async runMutation(ref: FunctionReference<"mutation">, args: Args, options?: unknown): Promise<unknown> {
    const name = getFunctionName(ref);
    if (name === "sync:push") return await this.pushSealed(args as { scope: WireScope; deviceId: string; ops: SyncOp[] }, ref, options);
    return await this.routed(ref, "mutation", name, args, () => (this.inner.mutation as (r: unknown, a: unknown, o?: unknown) => Promise<unknown>)(ref, args, options));
  }

  private async runAction(ref: FunctionReference<"action">, args: Args): Promise<unknown> {
    const name = getFunctionName(ref);
    return await this.routed(ref, "action", name, args, () => this.inner.action(ref, args));
  }

  private async routed(ref: AnyRef, kind: "mutation" | "action", name: string, args: Args, forward: () => Promise<unknown>): Promise<unknown> {
    return await this.routedCall(ref, kind, name, args, forward);
  }

  private async routedCall(ref: AnyRef, kind: "mutation" | "action", name: string, args: Args, forward: () => Promise<unknown>): Promise<unknown> {
    const route = routeOf(name);
    if (route.kind === "pass") return await forward();
    if (!this.spacesReady) await this.ready();
    if (!this.spaces.any) return await forward();
    let res = this.spaces.resolve(args);
    if (!res.active && route.kind === "compose" && route.personal) res = this.spaces.resolve({ scope: { kind: "personal" } });
    if (!res.active) return await forward();
    if (this.session.state() !== "unlocked") {
      if (lockedMode(res).kind === "pass") return await forward();
      throw lockedSessionError();
    }
    const call = this.callOf(name, kind, args, res);
    switch (route.kind) {
      case "sealed": {
        const { calls, result } = await route.seal(call, this.env);
        const results: unknown[] = [];
        for (const c of calls) results.push(await (this.inner.mutation as (r: unknown, a: unknown) => Promise<unknown>)(c.ref, c.args));
        // Device-made answers (records) are a workspace's when the call was about one.
        return res.space ? this.ownersOf(res.space.scope, result(results)) : result(results);
      }
      case "compose":
        return res.space ? this.ownersOf(res.space.scope, await route.run(call, this.env)) : await route.run(call, this.env);
      case "ai":
        return await (route.run ?? this.ai)(call, this.env, forward);
      case "off":
        if (res.space && isEncryptedLevel(res.space)) throw new ConvexError({ code: "e2ee_unavailable", message: "This isn't available in an end-to-end encrypted space.", feature: route.feature });
        if (res.sealed) throw new ConvexError({ code: "e2ee_locked", message: "This note is always fully encrypted, so this can't use it.", feature: route.feature });
        return await forward();
      case "device":
        if (kind === "action" && res.space && isEncryptedLevel(res.space)) {
          const replica = await this.replicas.open(res.space.scope);
          // An export takes the attachments' bytes: fetched and opened first, kept in memory only.
          if (name === "exports:exportScope") await this.hydrateFiles(res.space.scope);
          return this.ownersOf(res.space.scope, await replica.backend.action(name, deviceArgs(args)));
        }
        return await forward();
      default:
        void ref;
        return await forward();
    }
  }

  private async callByName(kind: CallKind, name: string, args: Args): Promise<unknown> {
    const [mod, fn] = name.split(":") as [string, string];
    const ref = (api as unknown as Record<string, Record<string, AnyRef>>)[mod]?.[fn];
    if (!ref) throw new Error(`Unknown function ${name}.`);
    if (kind === "query") return await this.runQuery(ref as FunctionReference<"query">, args);
    if (kind === "mutation") return await this.runMutation(ref as FunctionReference<"mutation">, args);
    return await this.runAction(ref as FunctionReference<"action">, args);
  }

  // ---- sync.push (§6.6) -----------------------------------------------------------------------------------

  /** Whether an op's note is sealed, or the note it creates must be. Null: this device can't tell yet. */
  private opSealing(op: SyncOp, routing: WireScope): { sealed: boolean; space: E2eeSpace | null } | null {
    if (op.kind === "document.create") {
      const d = op.document;
      if (d.parentDocumentId) {
        const parent = this.spaces.document(d.parentDocumentId);
        if (parent) return { sealed: parent.sealed, space: this.spaces.get(parent.scope) };
        return { sealed: false, space: null };
      }
      const scope = d.scope ?? routing;
      const space = this.spaces.get(scope);
      const lockedFolder = d.folderId ? this.spaces.ref("folder", d.folderId) : null;
      return { sealed: isEncryptedLevel(space) || (lockedFolder !== null && !!space), space };
    }
    const doc = this.spaces.document(op.documentId);
    if (doc) return { sealed: doc.sealed, space: this.spaces.get(doc.scope) };
    // A note the index doesn't know: a Standard one, unless an encrypted space's copy hasn't caught up yet.
    for (const s of this.spaces.list()) if (isEncryptedLevel(s) && this.replicas.status(s.scope).state !== "ready") return null;
    return { sealed: false, space: null };
  }

  /** The current look of a sealed note (a patch changes part of it; the whole is sealed again). */
  private async appearanceOf(space: E2eeSpace | null, documentId: string): Promise<{ icon: string | null; cover?: unknown; style?: unknown }> {
    const store = space ? this.replicas.hostedStore(space.scope) : null;
    const doc = (await store?.get("documents", documentId)) as LocalDocument | undefined;
    return { icon: doc?.icon ?? this.spaces.label(documentId)?.icon ?? null, cover: doc?.cover, style: doc?.style };
  }

  private async sealOp(op: SyncOp, space: E2eeSpace | null, routing: WireScope): Promise<SyncOp[]> {
    const cached = this.sealedOps.get(op.opId);
    if (cached) return [cached];
    let out: SyncOp[];
    switch (op.kind) {
      case "block.upsert": {
        const preview = space?.switches.notificationPreviews && isEncryptedLevel(space) ? { title: this.spaces.label(op.documentId)?.title ?? "", line: plainLine(op.block) } : null;
        out = [{ ...op, block: (await this.sealer.sealBlock(op.documentId, op.block, { preview })) as unknown as WireBlock }];
        break;
      }
      case "document.update": {
        const patch = { ...op.patch } as Record<string, unknown>;
        const sealedPatch: Record<string, unknown> = {};
        if (patch.title !== undefined) {
          const t = await this.sealer.sealTitle(op.documentId, sanitizeTitle(String(patch.title)));
          sealedPatch.sealedTitle = { c: t.c, mac: t.mac };
        }
        if (patch.icon !== undefined || patch.cover !== undefined || patch.style !== undefined) {
          const now = await this.appearanceOf(space, op.documentId);
          sealedPatch.sealedAppearance = await this.sealer.sealAppearance(op.documentId, {
            icon: patch.icon !== undefined ? (patch.icon as string | null) : now.icon,
            cover: patch.cover !== undefined ? patch.cover : now.cover,
            style: patch.style !== undefined ? patch.style : now.style,
          });
        }
        const plain: Record<string, unknown> = {};
        if (patch.folderId !== undefined) plain.folderId = patch.folderId;
        if (patch.parentDocumentId !== undefined) plain.parentDocumentId = patch.parentDocumentId;
        out = [{ ...op, patch: { ...plain, ...sealedPatch } as never }];
        break;
      }
      case "document.create": {
        const d = op.document as CreateWithMeta;
        const scope = space?.scope ?? d.scope ?? routing;
        const known = this.spaces.document(d.id);
        let spaceVersion: number;
        let wrapped: ArrayBuffer;
        if (known) {
          // Already created (a resend after a reload): the note's key is the one the server holds.
          const nk = await this.keyring.noteKeys(d.id);
          spaceVersion = space?.currentKeyVersion ?? 1;
          wrapped = new ArrayBuffer(0);
          void nk;
        } else {
          const nk = await this.keyring.newNoteKey(d.id, scope);
          spaceVersion = nk.spaceVersion;
          wrapped = toWireBytes(nk.wrapped);
        }
        // The server's own rules for a new note, applied here because it can't read these (§5.5).
        const title = await this.sealer.sealTitle(d.id, sanitizeTitle(d.title ?? ""));
        const icon = d.icon ?? (d.kind === "document" ? randomNoteEmoji() : null);
        const appearance = await this.sealer.sealAppearance(d.id, { icon, cover: d.cover, style: d.style });
        const meta: DocumentMeta | undefined = d.e2eeMeta;
        const sealedMeta = meta ? await this.sealer.sealMeta(d.id, meta) : undefined;
        const templateId = d.templateId;
        const rest = omit(d, ["e2eeMeta", "templateId", "title", "icon", "style", "cover", "collectionId"]);
        const lockedOwn = undefined;
        const create = {
          ...rest,
          title: "",
          icon: null,
          sealed: { title: title.c, titleMac: title.mac, appearance, ...(sealedMeta ? { meta: sealedMeta } : {}), noteKey: { v: 1 as const, spaceVersion, wrapped }, ...(lockedOwn ? { lockedOwn } : {}) },
        };
        out = [{ ...op, document: create as never }];
        // A template's content is copied on the device after the create (sideEffects), never by the server.
        void templateId;
        break;
      }
      default:
        out = [op];
    }
    if (out.length === 1) {
      this.sealedOps.set(op.opId, out[0]!);
      if (this.sealedOps.size > 2000) this.sealedOps.delete(this.sealedOps.keys().next().value!);
    }
    return out;
  }

  /** Opens what the server answered for sealed ops, into the plaintext shapes the engine expects. */
  private async openResults(results: (OpResult & { document?: unknown })[], sent: Map<string, SyncOp>): Promise<(OpResult & { document?: unknown })[]> {
    return await Promise.all(
      results.map(async (r) => {
        const op = sent.get(r.opId);
        if (!op) return r;
        const documentId = op.kind === "document.create" ? op.document.id : op.documentId;
        if (!this.spaces.isSealed(documentId) && op.kind !== "document.create") return r;
        return (await openDeep(r, this.env, { documentId })) as OpResult & { document?: unknown };
      }),
    );
  }

  private async pushSealed(args: { scope: WireScope; deviceId: string; ops: SyncOp[] }, ref: FunctionReference<"mutation">, options?: unknown): Promise<unknown> {
    if (args.scope) this.spaces.setContextScope(this.spaces.context ?? args.scope);
    if (!this.spacesReady) await this.ready();
    if (!this.spaces.any) return await (this.inner.mutation as (r: unknown, a: unknown, o?: unknown) => Promise<unknown>)(ref, args, options);
    return await this.pushOps(args.scope, args.deviceId, args.ops);
  }

  /** Whether an op has effects the server would derive and can't for a sealed note (§6.7): a template's
   * content copied in, a repeating to-do coming back after it's checked off. */
  private static needsDevice(op: SyncOp): boolean {
    if (op.kind === "document.create") return Boolean(op.document.templateId);
    if (op.kind !== "block.upsert" || op.block.type !== "todo") return false;
    const p = op.block.props as { checked?: unknown; repeat?: unknown };
    return p.checked === true && typeof p.repeat === "string" && p.repeat !== "";
  }

  /**
   * What local mode's sync.push would also write for these ops (its triggers and template copies), run over
   * the replica before they're sent: blocks and records the server can't make for a sealed note.
   */
  private async deviceEffects(space: E2eeSpace, deviceId: string, ops: SyncOp[]): Promise<Captured | null> {
    const store = this.replicas.hostedStore(space.scope);
    if (!store) return null;
    const c = await capture(store, "mutation", "sync:push", { scope: { kind: "personal" }, deviceId, ops }, deviceId);
    const created = new Set(ops.filter((o) => o.kind === "document.create").map((o) => (o as { document: { id: string } }).document.id));
    const sent = new Map(ops.filter((o) => o.kind === "block.upsert").map((o) => [(o as { block: WireBlock }).block.id, (o as { block: WireBlock }).block]));
    const writes = c.writes.filter(({ w, before }) => {
      if (w.table === "documents") return !created.has(w.id) && !before && w.value !== null;
      if (w.table === "blocks") {
        const b = w.value as LocalBlock | null;
        const op = sent.get(w.id);
        if (!op || !b) return !!b;
        // The op's own block, unless something changed it after (a repeat brought it back).
        return canonicalJson({ t: b.type, x: b.text, p: b.props }) !== canonicalJson({ t: op.type, x: op.text, p: op.props });
      }
      return w.table === "collections" || w.table === "fileTexts";
    });
    if (!writes.length) return null;
    // Rows written into notes this batch creates count as new (their creates go first).
    for (const x of writes) if (x.w.table === "blocks" && created.has(x.w.partition ?? "")) x.before = undefined;
    return { result: null, writes };
  }

  /** Seals what has to be, sends one sync.push, opens the answers and keeps the replicas in step. */
  async pushOps(scope: WireScope, deviceId: string, ops: SyncOp[]): Promise<OpResult[]> {
    if (!this.spacesReady) await this.ready();
    const effects: { space: E2eeSpace; c: Captured }[] = [];
    for (const s of this.spaces.list()) {
      if (!isEncryptedLevel(s)) continue;
      const mine = ops.filter((o) => E2eeRouterClient.needsDevice(o) && this.opSealing(o, scope)?.space === s);
      if (!mine.length) continue;
      const c = await this.deviceEffects(s, deviceId, mine);
      if (c) effects.push({ space: s, c });
    }
    const results = await this.pushOnce(scope, deviceId, ops);
    for (const { space, c } of effects) {
      // Sealed only now: a note this batch created has its key once its create went through.
      const p: Projection = await project(c, space, this.env);
      // Follow-ups to blocks just written are based on the revision the server just gave them.
      const revs = new Map(results.map((r, i) => [ops[i] && ops[i]!.kind === "block.upsert" ? (ops[i] as { block: WireBlock }).block.id : "", r.revision ?? null]));
      const follow = p.ops.map((o) => (o.kind === "block.upsert" && revs.get(o.block.id) != null ? { ...o, baseRevision: revs.get(o.block.id)! } : o));
      if (follow.length) await this.pushOnce(space.scope, deviceId, follow);
      for (const call of p.after) await this.inner.mutation(call.ref as never, call.args as never);
    }
    return results;
  }

  /**
   * A note an encrypting space hasn't sealed yet takes no plaintext edit (the server refuses it, §5.4): it's
   * sealed now, out of order, by WP8's runner (§6.9 "Edits during a migration"), then the edit goes sealed.
   */
  private async sealBeforeEditing(ops: SyncOp[]): Promise<void> {
    const ids = new Set<string>();
    for (const op of ops) {
      if (op.kind === "document.create") continue;
      const d = this.spaces.document(op.documentId);
      if (d && !d.sealed && isEncryptedLevel(this.spaces.get(d.scope))) ids.add(op.documentId);
    }
    if (!ids.size) return;
    const { sealNow } = await import("../migrate");
    for (const id of ids) {
      await sealNow(id);
      const d = this.spaces.document(id);
      if (d) this.spaces.noteDocument(id, d.scope, true);
    }
  }

  private async pushOnce(scope: WireScope, deviceId: string, ops: SyncOp[]): Promise<OpResult[]> {
    await this.sealBeforeEditing(ops);
    const wire: SyncOp[] = [];
    const sent = new Map<string, SyncOp>();
    const touched = new Map<string, { scope: WireScope; ops: SyncOp[] }>();
    const extra = new Map<string, string>();
    for (const op of ops) {
      const s = this.opSealing(op, scope);
      // This device can't tell yet whether the note is sealed: the batch waits (the engine retries it).
      if (s === null) throw new Error("This encrypted space is still downloading on this device.");
      if (!s.sealed) {
        wire.push(op);
        if (s.space) track(touched, s.space.scope, op);
        continue;
      }
      if (this.session.state() !== "unlocked") throw lockedSessionError();
      const sealed = await this.sealOp(op, s.space, scope);
      wire.push(...sealed);
      sent.set(op.opId, op);
      for (const extraOp of sealed.slice(1)) {
        sent.set(extraOp.opId, extraOp);
        extra.set(extraOp.opId, op.opId);
      }
      if (s.space) {
        track(touched, s.space.scope, op);
        if (op.kind === "document.create") this.spaces.noteDocument(op.document.id, s.space.scope, true, { title: op.document.title, icon: op.document.icon });
        if (op.kind === "block.upsert") this.spaces.noteRef("block", op.block.id, s.space.scope, op.documentId);
      }
    }
    const raw = (await this.inner.mutation(api.sync.push, { scope, deviceId, ops: wire as never })) as (OpResult & { document?: unknown })[];
    const opened = await this.openResults(raw, sent);
    // Template blocks this router added aren't the engine's: their results stay here.
    const answer = opened.filter((r) => !extra.has(r.opId));
    const extras = [...sent.values()].filter((o) => extra.has(o.opId));
    // A device query right after this mutation already sees the change (§6.5).
    await Promise.all([...touched.values()].map(async ({ scope: s, ops: list }) => await this.replicas.get(s)?.applyAccepted(opened, [...list, ...extras])));
    return answer;
  }

  // ---- the engine's unsent edits over the replica (§6.5 "Pending edits") -------------------------------------

  private overlayFor(scope: WireScope, store: SpaceReplicaStore): ReplicaOverlay | null {
    const engineOf = () => this.engineOf();
    let engineOff: (() => void) | null = null;
    let lastEngine: SyncEngine | null = null;
    const ensure = () => {
      const engine = engineOf();
      if (engine === lastEngine) return engine;
      engineOff?.();
      lastEngine = engine;
      engineOff = engine ? engine.subscribe((e) => {
        if (e.type !== "state") return;
        const ids = new Set<string>();
        for (const op of [...engine.state.pending, ...engine.state.inflight]) ids.add(op.kind === "document.create" ? op.document.id : op.documentId);
        if (ids.size) store.overlayChanged([...ids]);
      }) : null;
      return engine;
    };
    this.stops.push(() => engineOff?.());
    return {
      blocks(documentId, base) {
        const engine = ensure();
        if (!engine || !engine.hasLocalWork(documentId)) return null;
        const byId = new Map(base.map((b) => [b.id, b]));
        for (const e of Object.values(engine.state.blocks)) {
          if (e.documentId !== documentId) continue;
          const prev = byId.get(e.block.id);
          const now = Date.now();
          if (e.deleted) {
            if (prev && prev.deletedAt === null) byId.set(prev.id, { ...prev, deletedAt: now });
            continue;
          }
          byId.set(e.block.id, { ...(prev ?? { documentId, revision: 0, contentRev: 0, positionRev: 0, seq: 0, createdAt: now, updatedAt: now }), ...e.block, revision: prev?.revision ?? 0, documentId, deletedAt: null } as LocalBlock);
        }
        return [...byId.values()];
      },
      document(id, replica) {
        const engine = ensure();
        if (!engine) return null;
        let doc = replica ?? null;
        for (const op of [...engine.state.inflight, ...engine.state.pending]) {
          if (op.kind === "document.create" && op.document.id === id && !doc) doc = pendingDocument(op.document);
          else if (op.kind === "document.update" && op.documentId === id && doc) {
            const p = op.patch;
            doc = { ...doc, ...(p.title !== undefined ? { title: p.title } : {}), ...(p.icon !== undefined ? { icon: p.icon } : {}), ...(p.folderId !== undefined ? { folderId: p.folderId } : {}), ...(p.parentDocumentId !== undefined ? { parentDocumentId: p.parentDocumentId } : {}) };
          }
        }
        return doc === replica ? null : doc;
      },
      extraDocuments() {
        const engine = ensure();
        if (!engine) return [];
        const out: LocalDocument[] = [];
        for (const op of [...engine.state.inflight, ...engine.state.pending]) {
          if (op.kind !== "document.create") continue;
          const target = op.document.scope ?? scope;
          if (scopeKeyOf(target) !== scopeKeyOf(scope) || op.document.parentDocumentId) continue;
          out.push(pendingDocument(op.document));
        }
        return out;
      },
    };
  }

  /** Puts the opened bytes of a space's sealed files into its replica (not persisted): exports read them. */
  private async hydrateFiles(scope: WireScope): Promise<void> {
    const store = this.replicas.hostedStore(scope);
    if (!store) return;
    const files = ((await store.list("files")) as (LocalFileRow & { blob: Blob })[]).filter((f) => f.blob.size === 0 && f.size > 0);
    for (let i = 0; i < files.length; i += 200) {
      const chunk = files.slice(i, i + 200);
      const urls = (await this.inner.query(api.files.urls, { fileIds: chunk.map((f) => f.id), now: Date.now() })) as Record<string, { url: string; sealed?: { key: ArrayBuffer; meta: ArrayBuffer; k: number; plainSize: number } } | undefined>;
      const writes = [];
      for (const f of chunk) {
        const entry = urls[f.id];
        if (!entry?.sealed || !f.documentId) continue;
        try {
          const { bytes, meta } = await this.files.bytes(f.id, f.documentId, entry.url, entry.sealed);
          writes.push({ table: "files" as const, id: f.id, value: { ...f, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: meta.mime }) } });
        } catch {
          console.warn(`[e2ee] A file couldn't be downloaded for the export (${f.id}).`);
        }
      }
      await store.ingest(writes as never, undefined, { persist: false });
    }
  }

  /** §12 WP7: the replica's status for a scope. */
  status(scope: WireScope): ReplicaStatus {
    return this.replicas.status(scope);
  }
}

function track(map: Map<string, { scope: WireScope; ops: SyncOp[] }>, scope: WireScope, op: SyncOp) {
  const key = scopeKeyOf(scope);
  const t = map.get(key) ?? { scope, ops: [] };
  t.ops.push(op);
  map.set(key, t);
}

function plainLine(block: WireBlock): string {
  return (Array.isArray(block.text) ? block.text : [])
    .map((n) => String((n as { text?: unknown; label?: unknown }).text ?? (n as { label?: unknown }).label ?? ""))
    .join("")
    .slice(0, 140);
}

function pendingDocument(d: { id: string; parentDocumentId: string | null; folderId: string | null; kind: LocalDocument["kind"]; title: string; icon: string | null }): LocalDocument {
  const now = Date.now();
  return {
    id: d.id,
    parentDocumentId: d.parentDocumentId,
    folderId: d.folderId,
    kind: d.kind,
    title: d.title,
    icon: d.icon,
    cover: { kind: "none" } as LocalDocument["cover"],
    style: undefined as unknown as LocalDocument["style"],
    dailyDate: null,
    templateKey: null,
    collectionId: null,
    rank: "",
    createdAt: now,
    ordinal: Number.MAX_SAFE_INTEGER,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    inTrash: false,
    revision: 0,
    titleRev: 0,
    seq: 0,
    contentSeq: 0,
    searchText: d.title,
    wordCount: 0,
    charCount: 0,
    blockCount: 0,
    excerpt: "",
    preview: null,
    starred: false,
    tagIds: [],
  };
}

/** A copy of an object without some keys. */
function omit<T extends object>(o: T, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (!keys.includes(k)) out[k] = v;
  return out;
}

function safeDeviceId(session: KeySessionLike): string {
  try {
    return session.deviceId();
  } catch {
    return "e2ee-device";
  }
}
