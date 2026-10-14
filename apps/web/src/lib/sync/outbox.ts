"use client";

import type { ConvexReactClient } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { ConvexError } from "convex/values";
import { ulid, type SyncOp } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { OUTBOX_PREFIX, localDb, outboxKeys } from "./db";

/**
 * The changes that wait in the outbox when there's no connection: folders, notes moved between them,
 * comments and collections. Page and block edits have the sync engine (engine.ts); these are ordinary
 * mutations, sent as they are, so each keeps the checks, notifications and limits the server already
 * applies. `done` lists the error codes that mean the change already landed (a delete sent twice).
 */
export const OUTBOX_MUTATIONS = {
  "organization.createFolder": { ref: api.organization.createFolder },
  "organization.renameFolder": { ref: api.organization.renameFolder },
  "organization.moveFolder": { ref: api.organization.moveFolder },
  "organization.setFolderColor": { ref: api.organization.setFolderColor },
  "organization.deleteFolder": { ref: api.organization.deleteFolder, done: ["not_found"] },
  "documents.bulkUpdate": { ref: api.documents.bulkUpdate },
  "documents.move": { ref: api.documents.move },
  "comments.create": { ref: api.comments.create },
  "comments.reply": { ref: api.comments.reply },
  "comments.edit": { ref: api.comments.edit },
  "comments.setResolved": { ref: api.comments.setResolved },
  "comments.remove": { ref: api.comments.remove, done: ["not_found"] },
  "comments.deleteThread": { ref: api.comments.deleteThread, done: ["not_found"] },
  "comments.react": { ref: api.comments.react },
  "collections.rename": { ref: api.collections.rename },
  "collections.addRow": { ref: api.collections.addRow },
  "collections.setValue": { ref: api.collections.setValue },
  "collections.renameRow": { ref: api.collections.renameRow },
  "collections.moveRow": { ref: api.collections.moveRow },
  "collections.deleteRow": { ref: api.collections.deleteRow, done: ["not_found"] },
  "collections.updateView": { ref: api.collections.updateView },
} as const satisfies Record<string, { ref: unknown; done?: readonly string[] }>;

export type OutboxName = keyof typeof OUTBOX_MUTATIONS;
export type OutboxArgs<N extends OutboxName> = FunctionArgs<(typeof OUTBOX_MUTATIONS)[N]["ref"]>;

/** One change waiting to be sent. Ids sort in the order entries were made (`orderedId`). */
export interface OutboxEntry<N extends OutboxName = OutboxName> {
  id: string;
  name: N;
  args: OutboxArgs<N>;
  /**
   * What the change touches ("folder:<id>", "thread:<id>", "collection:<id>"): an entry never goes before
   * an earlier one that shares a key, so a reply waits for its thread and a value for its row.
   */
  keys: string[];
  /** What it is, in a few words, for the sync details ("New folder “Trips”"). */
  label: string;
  /**
   * Pages (or lines in them) it names, whose own edits must reach the server first: a comment on a line
   * typed offline, a note made offline being filed in a folder. `blockId: null` waits for the page itself.
   */
  after?: OutboxAfter[];
  /** Ids it creates (a folder, a row's page): page edits that name them wait for it (`holds`). */
  creates?: string[];
  createdAt: number;
  attempts: number;
  /** Refused by the server: kept, and shown in the sync details, until the person retries or discards it. */
  failed?: { code: string; message: string };
}

export interface OutboxAfter {
  documentId: string;
  blockId: string | null;
}

/** What the caller knows about a change besides its mutation and arguments. */
export type OutboxMeta = Pick<OutboxEntry, "keys" | "label" | "after" | "creates">;

export type OutboxSender = (name: OutboxName, args: Record<string, unknown>) => Promise<unknown>;

let lastAt = 0;
let lastSeq = 0;

/**
 * An entry's id: it sorts in the order entries were made, even several in one millisecond (a ULID's random
 * part doesn't), and the clock stepping back never reorders what's queued. Unique by its random tail.
 */
function orderedId(): string {
  const now = Date.now();
  if (now > lastAt) {
    lastAt = now;
    lastSeq = 0;
  } else lastSeq++;
  return `${lastAt.toString(36).padStart(10, "0")}${lastSeq.toString(36).padStart(4, "0")}${ulid().slice(16)}`;
}

/** How long one send may take before it's tried again (the server takes a resend as the same change). */
const SEND_TIMEOUT = 45_000;
/** A change the server keeps failing on (not the connection) is set aside after this many tries. */
const MAX_SERVER_ATTEMPTS = 5;
const MAX_RETRY_DELAY = 60_000;

/**
 * A durable queue of mutations for one account. Every change is shown at once (see overlays.ts), written
 * to IndexedDB before anything is sent, and sent one at a time, in order, when there's a connection. The
 * server takes a resend as the change it already has (creates carry the ids this device chose, the rest
 * set a value), so a change whose answer was lost is simply sent again. A change the server refuses is
 * never dropped: it stays, marked, until the person retries or discards it, and nothing after it that
 * touches the same thing goes first.
 *
 * Tabs of one account share the queue: one tab sends at a time (a Web Lock), and the others reload it
 * when it changes (a BroadcastChannel).
 */
export class Outbox {
  entries: readonly OutboxEntry[] = [];
  /** The entry being sent right now, if any. */
  sending: string | null = null;
  /** The server wants a fresh sign-in before anything more is sent. */
  authRequired = false;
  lastError: string | null = null;
  private online = typeof navigator === "undefined" ? true : navigator.onLine;
  private listeners = new Set<() => void>();
  private flushing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushAt = 0;
  private retryDelay = 1000;
  private persistChain: Promise<void> = Promise.resolve();
  private results = new Map<string, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
  private waits: (after: OutboxAfter) => boolean = () => false;
  private channel: BroadcastChannel | null = null;
  /** Called when a change that created something is done or discarded (held page edits may go). */
  onReleased: (() => void) | null = null;

  constructor(
    private send: OutboxSender,
    private accountKey: string,
  ) {}

  /** Opens the account's outbox with what's waiting on this device. */
  static async open(client: Pick<ConvexReactClient, "mutation">, accountKey: string): Promise<Outbox> {
    const outbox = new Outbox((name, args) => client.mutation(OUTBOX_MUTATIONS[name].ref as never, args as never), accountKey);
    await outbox.reload();
    outbox.listen();
    return outbox;
  }

  /** Reads the queue as IndexedDB holds it (another tab may have added to it or sent some of it). */
  async reload(): Promise<void> {
    await this.persistChain;
    try {
      const db = await localDb(this.accountKey);
      const byId = new Map(((await db.getAll("meta", outboxKeys())) as OutboxEntry[]).map((e) => [e.id, e]));
      // Changes made here while it was being read aren't on disk yet: they count as made.
      for (const [id, entry] of this.unwritten) {
        if (entry) byId.set(id, entry);
        else byId.delete(id);
      }
      const stored = [...byId.values()];
      const ids = new Set(byId.keys());
      // Sent (or discarded) by another tab: anyone waiting on them here hears it went.
      for (const [id, r] of this.results) {
        if (!ids.has(id)) {
          r.resolve(undefined);
          this.results.delete(id);
        }
      }
      const before = new Set(this.entries.flatMap((e) => e.creates ?? []));
      this.entries = stored.sort((a, b) => (a.id < b.id ? -1 : 1));
      const after = new Set(this.entries.flatMap((e) => e.creates ?? []));
      this.emit();
      if ([...before].some((id) => !after.has(id))) this.onReleased?.();
    } catch {
      // Storage unavailable (private browsing): the queue lives in this tab only.
    }
  }

  private listen() {
    if (typeof BroadcastChannel === "undefined") return;
    this.channel = new BroadcastChannel(`folevi-outbox:${this.accountKey}`);
    this.channel.onmessage = () => {
      void this.reload().then(() => this.scheduleFlush(0));
    };
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.channel?.close();
    this.channel = null;
    this.listeners.clear();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  /**
   * Queues a change: shown at once, saved on this device, then sent. `result` settles with the server's
   * answer (it may wait for a connection for as long as that takes); it rejects when the server refuses
   * the change or the person discards it.
   */
  enqueue<N extends OutboxName>(name: N, args: OutboxArgs<N>, meta: OutboxMeta): { id: string; result: Promise<unknown> } {
    const entry: OutboxEntry<N> = { id: orderedId(), name, args, ...meta, createdAt: Date.now(), attempts: 0 };
    const result = new Promise<unknown>((resolve, reject) => this.results.set(entry.id, { resolve, reject }));
    // Nobody has to listen for the answer.
    result.catch(() => undefined);
    this.entries = [...this.entries, entry as OutboxEntry];
    this.emit();
    this.write(entry as OutboxEntry);
    this.scheduleFlush(0);
    return { id: entry.id, result };
  }

  /** Sends a refused change again (the person chose Retry). */
  retry(id: string) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    const { failed: _failed, ...rest } = entry;
    this.replace({ ...rest, attempts: 0 });
    this.retryDelay = 1000;
    this.scheduleFlush(0);
  }

  /** Drops a change for good (the person chose Discard). Changes after it that depended on it are sent and refused in turn. */
  discard(id: string) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry || this.sending === id) return;
    this.remove(entry);
    this.results.get(id)?.reject(new Error("Discarded."));
    this.results.delete(id);
    this.scheduleFlush(0);
  }

  setOnline(online: boolean) {
    this.online = online;
    if (online) this.scheduleFlush(0);
  }

  /** Signed in again: what's waiting goes now. */
  authRefreshed() {
    this.authRequired = false;
    this.retryDelay = 1000;
    this.emit();
    this.scheduleFlush(0);
  }

  /** Says whether a line a change names still has edits on their way to the server (engine.waitsToSync). */
  setWaits(waits: (after: OutboxAfter) => boolean) {
    this.waits = waits;
  }

  /** Whether any change waits for page edits (so the engine's progress should wake the outbox). */
  waitsForPages(): boolean {
    return this.entries.some((e) => e.after?.length);
  }

  /** Ids made by changes still in the queue (sent or not, refused or not). */
  createdIds(): Set<string> {
    return new Set(this.entries.flatMap((e) => e.creates ?? []));
  }

  /**
   * Whether a page edit must wait for the outbox: it files a page in a folder, or names a page, that a
   * change still in the queue creates. (The server would refuse it as not found.)
   */
  holds(op: SyncOp): boolean {
    if (!this.entries.length) return false;
    const ids = this.createdIds();
    if (!ids.size) return false;
    const has = (id: string | null | undefined) => typeof id === "string" && ids.has(id);
    if (op.kind === "document.create") return has(op.document.folderId) || has(op.document.parentDocumentId);
    if (op.kind === "document.update") return has(op.documentId) || has(op.patch.folderId) || has(op.patch.parentDocumentId);
    return has(op.documentId);
  }

  /**
   * Resolves once nothing queued for `key` is still to be sent (refused changes don't count): a change that
   * can't wait in the outbox (it needs the server's answer) goes after the ones made before it.
   */
  settled(key: string): Promise<void> {
    const busy = () => this.entries.some((e) => !e.failed && e.keys.includes(key));
    if (!busy()) return Promise.resolve();
    return new Promise((resolve) => {
      const off = this.subscribe(() => {
        if (busy()) return;
        off();
        resolve();
      });
    });
  }

  /** Resolves once every change made so far is on disk. */
  persisted(): Promise<void> {
    return this.persistChain;
  }

  /** Entries changed (or, as null, removed) here and not yet written to IndexedDB. */
  private unwritten = new Map<string, OutboxEntry | null>();

  private write(entry: OutboxEntry) {
    this.store(entry.id, entry);
  }

  private store(id: string, entry: OutboxEntry | null) {
    this.unwritten.set(id, entry);
    this.persistChain = this.persistChain
      .then(async () => {
        const db = await localDb(this.accountKey);
        if (entry) await db.put("meta", entry, OUTBOX_PREFIX + id);
        else await db.delete("meta", OUTBOX_PREFIX + id);
        this.channel?.postMessage("changed");
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.unwritten.get(id) === entry) this.unwritten.delete(id);
      });
  }

  private replace(entry: OutboxEntry) {
    this.entries = this.entries.map((e) => (e.id === entry.id ? entry : e));
    this.emit();
    this.write(entry);
  }

  private remove(entry: OutboxEntry) {
    this.entries = this.entries.filter((e) => e.id !== entry.id);
    this.emit();
    this.store(entry.id, null);
    if (entry.creates?.length) this.onReleased?.();
  }

  scheduleFlush(delay = 0) {
    const at = Date.now() + delay;
    if (this.timer) {
      if (this.flushAt <= at) return;
      clearTimeout(this.timer);
    }
    this.flushAt = at;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  /** The first change that may go now: not refused, not waiting on page edits, and nothing before it shares a key. */
  next(): OutboxEntry | null {
    const blocked = new Set<string>();
    for (const e of this.entries) {
      if (!e.failed && !e.keys.some((k) => blocked.has(k)) && !e.after?.some((a) => this.waits(a))) return e;
      for (const k of e.keys) blocked.add(k);
    }
    return null;
  }

  async flush(): Promise<void> {
    if (this.flushing || !this.online || this.authRequired || !this.entries.length) return;
    this.flushing = true;
    try {
      await withLock(`folevi-outbox:${this.accountKey}`, async () => {
        // Another tab may have sent some of it while this one waited for the lock.
        await this.reload();
        for (let rounds = 0; rounds < 500; rounds++) {
          if (!this.online || this.authRequired) return;
          const entry = this.next();
          if (!entry) return;
          if ((await this.sendOne(entry)) === "stop") return;
        }
        this.scheduleFlush(0);
      });
    } finally {
      this.flushing = false;
    }
  }

  private async sendOne(entry: OutboxEntry): Promise<"next" | "stop"> {
    this.sending = entry.id;
    this.emit();
    let result: unknown;
    try {
      result = await withTimeout(this.send(entry.name, entry.args as Record<string, unknown>), SEND_TIMEOUT);
    } catch (error) {
      this.sending = null;
      return this.failed(entry, error);
    }
    this.sending = null;
    this.retryDelay = 1000;
    this.lastError = null;
    this.remove(entry);
    this.results.get(entry.id)?.resolve(result);
    this.results.delete(entry.id);
    return "next";
  }

  private failed(entry: OutboxEntry, error: unknown): "next" | "stop" {
    const data = error instanceof ConvexError ? (error.data as { code?: string; message?: string } | undefined) : undefined;
    const code = data?.code;
    const done = (OUTBOX_MUTATIONS[entry.name] as { done?: readonly string[] }).done;
    if (code && done?.includes(code)) {
      // Already the way it was meant to be (a delete that landed before its answer was lost).
      this.remove(entry);
      this.results.get(entry.id)?.resolve(null);
      this.results.delete(entry.id);
      return "next";
    }
    this.lastError = code ?? "network";
    if (code === "unauthenticated" || code === "profile_missing") {
      this.authRequired = true;
      this.emit();
      return "stop";
    }
    const timedOut = error instanceof Error && error.message === "timeout";
    const attempts = entry.attempts + 1;
    // A refusal (anything but being busy or briefly down) won't change by trying again: set it aside.
    const refused = code !== undefined && code !== "rate_limited" && code !== "maintenance";
    if (refused || (!code && !timedOut && attempts >= MAX_SERVER_ATTEMPTS)) {
      const message = data?.message ?? "The server couldn’t take this change.";
      this.replace({ ...entry, attempts, failed: { code: code ?? "server", message } });
      this.results.get(entry.id)?.reject(error);
      this.results.delete(entry.id);
      return "next";
    }
    // The connection, a timeout, or the server being busy: the whole queue waits, then tries again.
    this.replace({ ...entry, attempts });
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_DELAY);
    this.scheduleFlush(this.retryDelay);
    return "stop";
  }

  /** Whether anything is waiting, being sent, or set aside. */
  status(): "idle" | "waiting" | "sending" | "failed" {
    if (this.entries.some((e) => e.failed) || this.authRequired) return "failed";
    if (this.sending) return "sending";
    return this.entries.length ? "waiting" : "idle";
  }
}

/** Runs `fn` holding a Web Lock (one tab at a time), or straight away where there are none. */
async function withLock(name: string, fn: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return fn();
  await locks.request(name, fn);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
