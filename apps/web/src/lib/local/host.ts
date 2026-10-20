// One window hosts the library (docs/LOCAL_MODE_PLAN.md §2.3, "Multi-window Mac"). The Mac app can have
// several windows on one library (Quick Add, ⇧⌘N), and two backends writing the same files would race, so the
// windows elect one with a Web Lock, `folevi-local-library`. The host runs the LocalBackend; every other
// window gets its calls answered by the host over a BroadcastChannel, and hears which dependency keys changed
// so its own query cache re-runs what it shows. When the host window closes its lock passes to the next
// window, which opens the backend itself; the app's client in that window stays the same object (its
// executor changes), so nothing on screen remounts.
//
// A call in flight when the host goes is sent again to the next one. Every mutation the sync engine and the
// outbox send carries its own op id, so a resend that had already landed is answered as a replay.
import { ConvexError } from "convex/values";
import { ulid } from "@folevi/editor-schema";
import { LocalClient, type LocalExecutor, type LocalHostApi } from "./client";
import type { LocalBackend } from "./backend";

export const LIBRARY_LOCK = "folevi-local-library";
export const LIBRARY_CHANNEL = "folevi-local-library";

/** The part of `navigator.locks` this uses. */
export interface LockManagerLike {
  request(name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, callback: (lock: unknown) => Promise<unknown> | unknown): Promise<unknown>;
}

/** The part of BroadcastChannel this uses. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  close(): void;
}

type CallKind = "query" | "mutation" | "action" | "putFile" | "setup";

type SerializedError = { convex: true; data: unknown; message: string } | { convex: false; name: string; message: string };

type Message =
  | { t: "call"; id: string; from: string; kind: CallKind; name: string; args: unknown }
  | { t: "reply"; id: string; to: string; ok: true; value: unknown; deps?: readonly string[] }
  | { t: "reply"; id: string; to: string; ok: false; error: SerializedError }
  | { t: "changed"; from: string; keys: readonly string[] }
  | { t: "host"; hostId: string }
  | { t: "hello"; from: string }
  | { t: "bye"; hostId: string };

function serializeError(e: unknown): SerializedError {
  if (e instanceof ConvexError) return { convex: true, data: e.data, message: e.message };
  const err = e instanceof Error ? e : new Error(String(e));
  return { convex: false, name: err.name, message: err.message };
}

function deserializeError(e: SerializedError): Error {
  if (e.convex) return new ConvexError(e.data as never);
  const err = new Error(e.message);
  err.name = e.name;
  return err;
}

/** Runs calls in the host window. Holds them until a host answers, and sends them again if the host changes. */
export class RemoteExecutor implements LocalExecutor {
  private pending = new Map<string, { message: Extract<Message, { t: "call" }>; resolve: (v: { value: unknown; deps?: readonly string[] }) => void; reject: (e: Error) => void }>();
  private listeners = new Set<(keys: readonly string[]) => void>();
  private hostId: string | null = null;
  private onMessage = (event: MessageEvent) => this.receive(event.data as Message);
  readonly local: LocalHostApi;

  constructor(
    private channel: ChannelLike,
    readonly windowId: string = ulid(),
  ) {
    channel.addEventListener("message", this.onMessage);
    channel.postMessage({ t: "hello", from: windowId } satisfies Message);
    this.local = {
      putFile: async (blob, meta) => (await this.call("putFile", "", { blob, meta })).value as { fileId: string; mimeType: string },
      setup: async (input) => (await this.call("setup", "", input)).value as { created: boolean },
    };
  }

  /** The window answering now (null until one has said so). */
  get host(): string | null {
    return this.hostId;
  }

  private receive(m: Message) {
    if (!m || typeof m !== "object") return;
    if (m.t === "reply" && m.to === this.windowId) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve({ value: m.value, deps: m.deps });
      else p.reject(deserializeError(m.error));
    } else if (m.t === "changed") {
      for (const l of [...this.listeners]) l(m.keys);
    } else if (m.t === "host") {
      const changed = m.hostId !== this.hostId;
      this.hostId = m.hostId;
      // A host that's new to this window: everything still unanswered goes to it (the old one may have
      // closed mid-call, or the call went out while no window was hosting). The host runs each call id once.
      if (changed) for (const p of this.pending.values()) this.channel.postMessage(p.message);
    } else if (m.t === "bye" && m.hostId === this.hostId) {
      this.hostId = null;
    }
  }

  private call(kind: CallKind, name: string, args: unknown): Promise<{ value: unknown; deps?: readonly string[] }> {
    const message: Extract<Message, { t: "call" }> = { t: "call", id: ulid(), from: this.windowId, kind, name, args };
    return new Promise((resolve, reject) => {
      this.pending.set(message.id, { message, resolve, reject });
      this.channel.postMessage(message);
    });
  }

  /** The calls still waiting for an answer (handed to this window's own backend when it becomes the host). */
  takePending(): { kind: CallKind; name: string; args: unknown; resolve: (v: { value: unknown; deps?: readonly string[] }) => void; reject: (e: Error) => void }[] {
    const out = [...this.pending.values()].map((p) => ({ kind: p.message.kind, name: p.message.name, args: p.message.args, resolve: p.resolve, reject: p.reject }));
    this.pending.clear();
    return out;
  }

  async query(name: string, args: Record<string, unknown>) {
    const r = await this.call("query", name, args);
    return { value: r.value, deps: r.deps ?? [] };
  }
  async mutation(name: string, args: Record<string, unknown>) {
    return (await this.call("mutation", name, args)).value;
  }
  async action(name: string, args: Record<string, unknown>) {
    return (await this.call("action", name, args)).value;
  }

  subscribe(listener: (keys: readonly string[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose() {
    this.channel.removeEventListener("message", this.onMessage);
    for (const p of this.pending.values()) p.reject(new Error("The local library closed."));
    this.pending.clear();
  }
}

/** A client for a window that never hosts the library itself: every call goes to the host window. */
export class RemoteLocalClient extends LocalClient {
  constructor(channel: ChannelLike) {
    super(new RemoteExecutor(channel));
  }
}

async function runOn(backend: LocalBackend, kind: CallKind, name: string, args: unknown): Promise<{ value: unknown; deps?: readonly string[] }> {
  switch (kind) {
    case "query":
      return await backend.query(name, args as Record<string, unknown>);
    case "mutation":
      return { value: await backend.mutation(name, args as Record<string, unknown>) };
    case "action":
      return { value: await backend.action(name, args as Record<string, unknown>) };
    case "putFile": {
      const { blob, meta } = args as { blob: Blob; meta: Parameters<LocalHostApi["putFile"]>[1] };
      return { value: await backend.local.putFile(blob, meta) };
    }
    case "setup":
      return { value: await backend.local.setup(args as Parameters<LocalHostApi["setup"]>[0]) };
  }
}

export type HostRole = "starting" | "host" | "follower" | "closed";

export interface LocalHostOptions {
  /** Opens the library's backend (its store loaded) when this window becomes the host. */
  openBackend: () => Promise<LocalBackend>;
  /** Default: navigator.locks. Without Web Locks, every window hosts (one window on iOS). */
  locks?: LockManagerLike | null;
  /** Default: new BroadcastChannel(LIBRARY_CHANNEL). */
  channel?: () => ChannelLike;
  /** Where `pagehide` is heard, to hand the library over (default: window). */
  target?: Pick<Window, "addEventListener" | "removeEventListener"> | null;
  windowId?: string;
}

export interface LocalHost {
  /** The app's client in this window: the same object whichever window hosts. */
  readonly client: LocalClient;
  readonly role: HostRole;
  readonly windowId: string;
  /** Resolves once this window is either the host (backend open) or a follower. */
  readonly ready: Promise<HostRole>;
  onRoleChange(cb: (role: HostRole) => void): () => void;
  /** Lets the library go (the window closing): followers take over. */
  close(): Promise<void>;
}

/** Starts this window's part in the library: hosting it, or following the window that does. */
export function startLocalHost(opts: LocalHostOptions): LocalHost {
  const windowId = opts.windowId ?? ulid();
  const locks = opts.locks === undefined ? (typeof navigator !== "undefined" ? (navigator.locks as unknown as LockManagerLike | undefined) : undefined) : opts.locks;
  const channel = (opts.channel ?? (() => new BroadcastChannel(LIBRARY_CHANNEL) as unknown as ChannelLike))();
  const target = opts.target === undefined ? (typeof window !== "undefined" ? window : null) : opts.target;
  const remote = new RemoteExecutor(channel, windowId);
  const client = new LocalClient(remote);
  const roleListeners = new Set<(role: HostRole) => void>();
  let role: HostRole = "starting";
  let backend: LocalBackend | null = null;
  let unwatchBackend: (() => void) | null = null;
  let release: (() => void) | null = null;
  const abort = new AbortController();
  let markReady: (r: HostRole) => void = () => {};
  const ready = new Promise<HostRole>((r) => (markReady = r));

  const setRole = (next: HostRole) => {
    if (role === next) return;
    role = next;
    for (const cb of [...roleListeners]) cb(next);
    if (next === "host" || next === "follower") markReady(next);
  };

  // As host: answer other windows' calls (queued until the backend is open) and tell them what changed.
  let opened: Promise<LocalBackend> | null = null;
  const handled = new Set<string>();
  const onMessage = (event: MessageEvent) => {
    const m = event.data as Message;
    if (!m || typeof m !== "object" || role === "closed") return;
    if (m.t === "hello" && role === "host") channel.postMessage({ t: "host", hostId: windowId } satisfies Message);
    if (m.t !== "call" || !opened) return;
    // A window sends what's unanswered again whenever it hears of a host; each call runs once here.
    if (handled.has(m.id)) return;
    handled.add(m.id);
    if (handled.size > 2000) handled.delete(handled.values().next().value!);
    void opened
      .then((b) => runOn(b, m.kind, m.name, m.args))
      .then(
        (r) => channel.postMessage({ t: "reply", id: m.id, to: m.from, ok: true, value: r.value, deps: r.deps } satisfies Message),
        (e) => channel.postMessage({ t: "reply", id: m.id, to: m.from, ok: false, error: serializeError(e) } satisfies Message),
      );
  };
  channel.addEventListener("message", onMessage);

  const host = async () => {
    if (role === "closed") return;
    opened = opts.openBackend();
    const b = await opened;
    // (The window may have closed while the library opened.)
    if ((role as HostRole) === "closed") {
      await b.close();
      return;
    }
    backend = b;
    unwatchBackend = b.subscribe((keys) => channel.postMessage({ t: "changed", from: windowId, keys } satisfies Message));
    // What this window had asked the old host and never heard back about runs here now.
    for (const p of remote.takePending()) runOn(b, p.kind, p.name, p.args).then(p.resolve, p.reject);
    client.setExecutor(b);
    setRole("host");
    channel.postMessage({ t: "host", hostId: windowId } satisfies Message);
    // Held until this window lets the library go.
    await new Promise<void>((r) => (release = r));
  };

  if (!locks) {
    void host();
  } else {
    void locks
      .request(LIBRARY_LOCK, { ifAvailable: true }, async (lock) => {
        if (lock) return await host();
        setRole("follower");
        // In line for the lock: when the host window goes, this one takes over.
        void locks.request(LIBRARY_LOCK, { signal: abort.signal }, () => host()).catch(() => undefined);
      })
      .catch(() => undefined);
  }

  const onPageHide = () => void api.close();
  target?.addEventListener("pagehide", onPageHide);

  const api: LocalHost = {
    client,
    get role() {
      return role;
    },
    windowId,
    ready,
    onRoleChange(cb) {
      roleListeners.add(cb);
      return () => {
        roleListeners.delete(cb);
      };
    },
    async close() {
      if (role === "closed") return;
      const wasHost = role === "host";
      setRole("closed");
      target?.removeEventListener("pagehide", onPageHide);
      abort.abort();
      unwatchBackend?.();
      channel.removeEventListener("message", onMessage);
      if (wasHost) channel.postMessage({ t: "bye", hostId: windowId } satisfies Message);
      remote.dispose();
      await client.close();
      if (backend) await backend.close();
      // Last: the next window opens the library only once this one has let go of it.
      release?.();
      channel.close();
    },
  };
  return api;
}
