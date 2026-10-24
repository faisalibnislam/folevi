"use client";

// The device copy (docs/NATIVE_APP_PLAN.md §11, R1): every note of each place this account works in, kept in
// the account's own IndexedDB (`folevi-<account>`, db.ts) so any note opens from the device at once and reads
// offline, then reconciles with the server. It fills the same stores the app already reads offline: `documents`
// (list rows, by scope) and `blocks` (a note's whole content), so offline lists, search and opening a note
// read it without changes of their own; the engine's queued edits and the outbox stay on top as before.
//
// Per scope (Personal, each team workspace) it goes through:
//   listing   sync.manifest a page at a time: every note's row and content head (resumable: `after`)
//   filling   sync.pullDocs for the notes whose content this device doesn't hold whole yet (recently changed
//             first, notes on screen and notes asked for first), a few at a time while the app is idle
//   live      sync.pullAll from the cursor whenever the scope's head moves (sync.head, while the page is
//             visible), on coming back to the app, and every few minutes; deleted notes are dropped
// and once a week it lists again (catching notes it can no longer open, and anything a cursor that slept past
// the server's retention could have missed), then drops what wasn't listed.
//
// It never competes with the open note: it waits while someone types or has just opened a note, works in
// idle time, and backs off when the network fails. Notes sealed by end-to-end encryption (or locked) are never
// kept here: their space's replica keeps them, encrypted at rest (lib/e2ee/replica, sealedReplicaDb.ts).
import { getFunctionName, type FunctionReference } from "convex/server";
import { scopeIdKey, type WireBlock, type WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { COPY_ORG_PREFIX, COPY_PREFIX, localDb, type CachedBlocks, type CachedDocument } from "./db";

/** What the copy needs of a backend client (the account's Convex client or the E2EE router passing it through). */
export interface CopyClient {
  query(ref: FunctionReference<"query">, args: Record<string, unknown>): Promise<unknown>;
}

export type CopyPhase = "listing" | "filling" | "live";

/** One scope's progress, kept in `meta` as `copy:<scope key>`. */
export interface ScopeCopyState {
  v: 1;
  phase: CopyPhase;
  /** Listing: the manifest's next `after`. */
  after: number;
  /** The listing pass (rows it saw carry it; the others are dropped when it completes). */
  generation: number;
  /** pullAll's cursor (0 until the first listing page set it from the scope's head). */
  cursor: number;
  /** When the last listing completed, and the last pull. */
  listedAt: number;
  pulledAt: number;
}

export interface ScopeCopyStatus {
  scopeKey: string;
  phase: CopyPhase;
  /** Notes kept whole on this device, of `total` (null until the listing is done). */
  have: number;
  total: number | null;
}

type ManifestNote = { id: string; head: number; sealed: boolean; summary: Summary | null };
type Summary = { id: string; title: string; icon: string | null; kind: string; updatedAt: number; excerpt: string; parentDocumentId: string | null; deletedAt?: number | null; archivedAt?: number | null };
type PulledDoc = { id: string; status: "ok"; summary: Summary; head: number; blocks: WireBlock[] } | { id: string; status: "missing" | "sealed" | "later" };
type PullPage = {
  documents: { id: string; sealed: boolean; summary: Summary | null }[];
  blocks: { documentId: string; block: WireBlock; deleted: boolean; seq: number }[];
  folders: { id: string; deletedAt: number | null }[];
  tags: { id: string }[];
  removed: { kind: "document" | "tag" | "folder"; id: string }[];
  nextCursor: number;
  hasMore: boolean;
};

export interface DeviceCopyDeps {
  client: CopyClient;
  accountKey: string;
  /** Whether a scope's notes are kept here (false for a space with end-to-end encryption: its replica keeps them). */
  isPlain?: (scope: WireScope) => boolean;
  /** A note with changes still on this device is never dropped by the copy. */
  hasLocalWork?: (documentId: string) => boolean;
  /** Ids of notes on screen now (cards, rows): their content comes first. */
  visibleIds?: () => string[];
  /** Waits for idle time before each piece of work (requestIdleCallback in the app; immediate in tests). */
  idle?: () => Promise<void>;
  now?: () => number;
  /** Heard after each piece of work (the attachments follow the notes, deviceFiles.ts). */
  onFilled?: (documentIds: string[]) => void;
}

const MANIFEST_PAGE = 300;
const FILL_BATCH = 20;
const PULL_PAGE = 300;
/** A new listing pass this often, and right away when the last pull is older (block tombstones go after 30 days). */
export const RELIST_AFTER_MS = 7 * 86_400_000;
/** Typing, or a note just opened, holds the copy back this long. */
const QUIET_MS = 1500;
/** How soon a moved head is pulled, and how often at most while changes keep coming (§11.2). */
const NUDGE_DELAY_MS = 1000;
const NUDGE_MIN_GAP_MS = 3000;
/** Every scope is checked this often while the app is open, head or not. */
const SWEEP_MS = 5 * 60_000;

const stateKey = (scopeKey: string) => `${COPY_PREFIX}${scopeKey}`;
const fresh = (): ScopeCopyState => ({ v: 1, phase: "listing", after: 0, generation: 1, cursor: 0, listedAt: 0, pulledAt: 0 });

const byRank = (a: WireBlock, b: WireBlock) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : 1);

/**
 * Takes blocks changed on the server into a note's kept content: a block is replaced or removed only by a
 * revision at least as new as the one kept (a page of changes read before the note was opened and saved
 * whole can't take it back).
 */
export function mergeBlocks(kept: readonly WireBlock[], changes: readonly { block: WireBlock; deleted: boolean }[]): WireBlock[] {
  const byId = new Map(kept.map((b) => [b.id, b]));
  for (const { block, deleted } of changes) {
    const have = byId.get(block.id);
    if (have && (have.revision ?? 0) > (block.revision ?? 0)) continue;
    if (deleted) byId.delete(block.id);
    else byId.set(block.id, block);
  }
  return [...byId.values()].sort(byRank);
}

function rowOf(scopeKey: string, s: Summary, prev: CachedDocument | undefined, extra: Partial<CachedDocument>, now: number): CachedDocument {
  // A list's own row (DocumentBrowser) carries more than the summary (stars, tags, home folder): kept.
  const summary = { ...(prev?.summary && typeof prev.summary === "object" ? prev.summary : {}), ...s };
  return { ...prev, id: s.id, scopeKey, title: s.title, icon: s.icon, kind: s.kind, updatedAt: s.updatedAt, excerpt: s.excerpt, parentDocumentId: s.parentDocumentId, cachedAt: now, summary, ...extra };
}

function defaultIdle(): Promise<void> {
  return new Promise((resolve) => {
    const w = typeof window !== "undefined" ? (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }) : null;
    if (w?.requestIdleCallback) w.requestIdleCallback(() => resolve(), { timeout: 2000 });
    else setTimeout(resolve, 30);
  });
}

/** One account's device copy. Start it with `start`, feed it the account's scopes, and `stop` it when done. */
export class DeviceCopy {
  private scopes: WireScope[] = [];
  private current: string | null = null;
  private enabled = true;
  private online = true;
  private stopped = true;
  private running = false;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private backoff = 0;
  private quietUntil = 0;
  /** Scopes whose head moved (or that were never pulled this visit). */
  private dirty = new Set<string>();
  private lastPull = new Map<string, number>();
  /** Notes asked for on intent (pointer down, touch, hover), first in, first served. */
  private asked: string[] = [];
  private askedWaiters = new Map<string, (() => void)[]>();
  /** Notes to fill per scope (computed when a scope's listing completes or the copy resumes). */
  private wants = new Map<string, string[]>();
  private totals = new Map<string, number>();
  private states = new Map<string, ScopeCopyState>();
  private listeners = new Set<() => void>();
  private snapshot: ScopeCopyStatus[] = [];
  private readonly now: () => number;
  private readonly idle: () => Promise<void>;
  lastError: string | null = null;

  constructor(private readonly deps: DeviceCopyDeps) {
    this.now = deps.now ?? Date.now;
    this.idle = deps.idle ?? defaultIdle;
  }

  // ---------------------------------------------------------------- control

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    for (const s of this.scopes) this.dirty.add(scopeIdKey(s));
    if (typeof setInterval !== "undefined" && !this.sweepTimer) {
      this.sweepTimer = setInterval(() => {
        for (const s of this.scopes) this.dirty.add(scopeIdKey(s));
        this.wake();
      }, SWEEP_MS);
    }
    this.wake();
  }

  stop(): void {
    this.stopped = true;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.wakeTimer = null;
    this.sweepTimer = null;
    for (const waiters of this.askedWaiters.values()) for (const w of waiters) w();
    this.askedWaiters.clear();
    this.asked = [];
  }

  /** The scopes to keep, the current one first (its notes are filled before the others'). */
  setScopes(scopes: readonly WireScope[], current: WireScope): void {
    const key = scopeIdKey(current);
    const all = [current, ...scopes.filter((s) => scopeIdKey(s) !== key)];
    const added = all.filter((s) => !this.scopes.some((x) => scopeIdKey(x) === scopeIdKey(s)));
    this.scopes = all;
    this.current = key;
    for (const s of added) this.dirty.add(scopeIdKey(s));
    this.wake();
  }

  /** "Keep all notes on this device": off stops filling (notes asked for on intent still come). */
  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    this.wake();
  }

  setOnline(online: boolean): void {
    if (this.online === online) return;
    this.online = online;
    if (online) {
      this.backoff = 0;
      for (const s of this.scopes) this.dirty.add(scopeIdKey(s));
    }
    this.wake();
  }

  /** Someone is typing, or a note just opened: bulk work waits a moment. */
  hold(ms = QUIET_MS): void {
    this.quietUntil = Math.max(this.quietUntil, this.now() + ms);
  }

  /** A scope's head moved (sync.head): pull after a second of quiet, at most every few seconds. */
  nudge(scope: WireScope | string): void {
    const key = typeof scope === "string" ? scope : scopeIdKey(scope);
    this.dirty.add(key);
    const since = this.now() - (this.lastPull.get(key) ?? 0);
    this.wake(Math.max(NUDGE_DELAY_MS, NUDGE_MIN_GAP_MS - since));
  }

  /** Back to the app (visible again): every scope is pulled. */
  foreground(): void {
    for (const s of this.scopes) this.dirty.add(scopeIdKey(s));
    this.wake();
  }

  /**
   * Notes someone is about to open (pointer down on a card, touch, hover): their content comes before anything
   * else, if this device doesn't hold it whole. Resolves when done (or given up).
   */
  prefetch(ids: readonly string[]): Promise<void> {
    const wanted = ids.filter((id) => /^[0-9A-Za-z_-]{8,64}$/.test(id));
    if (!wanted.length || this.stopped) return Promise.resolve();
    this.hold();
    const done = wanted.map(
      (id) =>
        new Promise<void>((resolve) => {
          const list = this.askedWaiters.get(id) ?? [];
          list.push(resolve);
          this.askedWaiters.set(id, list);
        }),
    );
    for (const id of wanted) if (!this.asked.includes(id)) this.asked.push(id);
    this.wake(0);
    return Promise.all(done).then(() => undefined);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Each scope's progress, for Settings ("Downloading notes, 412 of 1,530"). */
  status(): readonly ScopeCopyStatus[] {
    return this.snapshot;
  }

  private publish() {
    this.snapshot = this.scopes.map((s) => {
      const key = scopeIdKey(s);
      const st = this.states.get(key);
      const total = this.totals.get(key);
      const left = this.wants.get(key)?.length ?? 0;
      return { scopeKey: key, phase: st?.phase ?? "listing", have: total === undefined ? 0 : Math.max(0, total - left), total: st && st.phase !== "listing" && total !== undefined ? total : null };
    });
    for (const l of [...this.listeners]) l();
  }

  // ---------------------------------------------------------------- scheduling

  private wake(delay = 0) {
    if (this.stopped) return;
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      void this.run();
    }, delay);
  }

  private rerun = false;

  private async run() {
    if (this.running || this.stopped) return;
    this.running = true;
    this.rerun = false;
    try {
      for (;;) {
        if (this.stopped || !this.online) break;
        const wait = this.quietUntil - this.now();
        if (wait > 0 && !this.asked.length) {
          this.running = false;
          this.wake(wait);
          return;
        }
        if (!this.asked.length) await this.idle();
        if (this.stopped) break;
        const more = await this.step();
        this.backoff = 0;
        this.lastError = null;
        if (!more) break;
      }
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.backoff = Math.min(Math.max(2000, this.backoff * 2), 60_000);
      this.running = false;
      this.wake(this.backoff);
      return;
    }
    this.running = false;
    if (this.rerun) this.wake(0);
  }

  /** Runs every piece of work there is now (tests, and "Download now"). */
  async runUntilIdle(maxSteps = 10_000): Promise<void> {
    for (let i = 0; i < maxSteps; i++) if (!(await this.step())) return;
  }

  /** One piece of work; true when there's more to do right away. */
  async step(): Promise<boolean> {
    if (this.asked.length) {
      await this.fillAsked();
      return true;
    }
    const scopes = this.scopes.filter((s) => this.deps.isPlain?.(s) ?? true);
    // Fresh changes first (every scope), then the current scope's listing and filling, then the others'.
    for (const scope of scopes) {
      const key = scopeIdKey(scope);
      if (!this.dirty.has(key)) continue;
      const st = await this.state(key);
      if (!st.cursor) {
        this.dirty.delete(key);
        continue;
      }
      if (st.phase === "live" && this.now() - st.pulledAt > RELIST_AFTER_MS) {
        // Asleep too long for the deltas to be trusted: list again (the copy stays readable meanwhile).
        await this.relist(key, st);
        return true;
      }
      const more = await this.pullPage(scope, key, st);
      if (!more) this.dirty.delete(key);
      return true;
    }
    if (!this.enabled) return false;
    for (const scope of scopes) {
      const key = scopeIdKey(scope);
      const st = await this.state(key);
      if (st.phase === "live" && this.now() - st.listedAt > RELIST_AFTER_MS) {
        await this.relist(key, st);
        return true;
      }
      if (st.phase === "listing") {
        await this.listPage(scope, key, st);
        return true;
      }
      // Filling, or notes new or changed since (made elsewhere while this device held the scope whole).
      if (await this.fillBatch(key, st)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- state

  private async state(scopeKey: string): Promise<ScopeCopyState> {
    let st = this.states.get(scopeKey);
    if (st) return st;
    const db = await localDb(this.deps.accountKey);
    const kept = (await db.get("meta", stateKey(scopeKey))) as ScopeCopyState | undefined;
    st = kept?.v === 1 ? kept : fresh();
    this.states.set(scopeKey, st);
    if (st.phase === "filling") await this.computeWants(scopeKey);
    else if (st.phase === "live") await this.computeWants(scopeKey, true);
    this.publish();
    return st;
  }

  private async save(scopeKey: string, st: ScopeCopyState) {
    this.states.set(scopeKey, st);
    const db = await localDb(this.deps.accountKey);
    await db.put("meta", st, stateKey(scopeKey));
    this.publish();
  }

  private async relist(scopeKey: string, st: ScopeCopyState) {
    await this.save(scopeKey, { ...st, phase: "listing", after: 0, generation: st.generation + 1 });
  }

  // ---------------------------------------------------------------- listing

  private async listPage(scope: WireScope, scopeKey: string, st: ScopeCopyState) {
    const page = (await this.deps.client.query(api.sync.manifest, { scope, after: st.after, limit: MANIFEST_PAGE })) as { notes: ManifestNote[]; next: number | null; head: number };
    const now = this.now();
    const db = await localDb(this.deps.accountKey);
    const tx = db.transaction(["documents", "blocks"], "readwrite");
    const docs = tx.objectStore("documents");
    for (const n of page.notes) {
      if (n.sealed || !n.summary) {
        // Sealed (or locked since): no readable copy of it may stay on this device.
        await docs.delete(n.id);
        await tx.objectStore("blocks").delete(n.id);
        continue;
      }
      const prev = await docs.get(n.id);
      await docs.put(rowOf(scopeKey, n.summary, prev, { copyGen: st.generation, head: Math.max(n.head, prev?.head ?? 0) }, now));
    }
    await tx.done;
    // The first page's head is where keeping the copy fresh starts (a later listing keeps its cursor).
    const cursor = st.cursor || page.head;
    if (page.next !== null) {
      await this.save(scopeKey, { ...st, after: page.next, cursor });
      return;
    }
    await this.prune(scopeKey, st.generation);
    await this.save(scopeKey, { ...st, phase: "filling", after: 0, cursor, listedAt: now, pulledAt: st.pulledAt || now });
    await this.computeWants(scopeKey);
    this.publish();
  }

  /** Drops this scope's rows the listing didn't see (gone, or no longer yours to open), and their content. */
  private async prune(scopeKey: string, generation: number) {
    const db = await localDb(this.deps.accountKey);
    const rows = await db.getAllFromIndex("documents", "by_scope", scopeKey);
    const gone = rows.filter((r) => r.copyGen !== generation && !this.deps.hasLocalWork?.(r.id)).map((r) => r.id);
    if (!gone.length) return;
    const tx = db.transaction(["documents", "blocks"], "readwrite");
    for (const id of gone) {
      await tx.objectStore("documents").delete(id);
      await tx.objectStore("blocks").delete(id);
    }
    await tx.done;
  }

  /** The notes of a scope whose content this device doesn't hold whole: on screen first, then by last change. */
  private async computeWants(scopeKey: string, quiet = false) {
    const db = await localDb(this.deps.accountKey);
    const rows = await db.getAllFromIndex("documents", "by_scope", scopeKey);
    const kept = rows.filter((r) => r.copyGen !== undefined);
    const tx = db.transaction("blocks");
    const want: CachedDocument[] = [];
    for (const r of kept) {
      const entry = await tx.store.get(r.id);
      if (!entry || (entry.head ?? -1) < (r.head ?? 0)) want.push(r);
    }
    await tx.done;
    want.sort((a, b) => b.updatedAt - a.updatedAt);
    this.wants.set(
      scopeKey,
      want.map((r) => r.id),
    );
    this.totals.set(scopeKey, kept.length);
    if (!quiet) this.publish();
  }

  // ---------------------------------------------------------------- filling

  private async fillBatch(scopeKey: string, st: ScopeCopyState): Promise<boolean> {
    const want = this.wants.get(scopeKey) ?? [];
    if (!want.length) {
      if (st.phase === "filling") await this.save(scopeKey, { ...st, phase: "live" });
      return false;
    }
    // Notes on screen jump the queue.
    const visible = new Set(this.deps.visibleIds?.() ?? []);
    const first = want.filter((id) => visible.has(id));
    const batch = [...first, ...want.filter((id) => !visible.has(id))].slice(0, FILL_BATCH);
    const done = await this.pullDocs(batch, scopeKey);
    this.wants.set(
      scopeKey,
      want.filter((id) => !done.has(id)),
    );
    this.publish();
    return true;
  }

  private async fillAsked() {
    const ids = this.asked.splice(0, FILL_BATCH);
    try {
      const db = await localDb(this.deps.accountKey);
      const need: string[] = [];
      for (const id of ids) {
        const [entry, row] = await Promise.all([db.get("blocks", id), db.get("documents", id)]);
        if (!entry || (row?.head !== undefined && (entry.head ?? -1) < row.head)) need.push(id);
      }
      if (need.length) await this.pullDocs(need, null);
    } finally {
      for (const id of ids) {
        for (const w of this.askedWaiters.get(id) ?? []) w();
        this.askedWaiters.delete(id);
      }
    }
  }

  /** Takes whole notes from the server. Returns the ids settled (kept, or dropped as missing or sealed). */
  private async pullDocs(ids: string[], scopeKey: string | null): Promise<Set<string>> {
    const res = (await this.deps.client.query(api.sync.pullDocs, { ids })) as { notes: PulledDoc[] };
    const now = this.now();
    const settled = new Set<string>();
    const db = await localDb(this.deps.accountKey);
    const tx = db.transaction(["documents", "blocks"], "readwrite");
    const docs = tx.objectStore("documents");
    const blocks = tx.objectStore("blocks");
    const filled: string[] = [];
    for (const n of res.notes) {
      if (n.status === "later") continue;
      settled.add(n.id);
      if (n.status === "ok") {
        const prev = await docs.get(n.id);
        const key = prev?.scopeKey ?? scopeKey;
        // A note of a scope this copy keeps updates its row; one opened from elsewhere (shared) only its content.
        if (key) await docs.put(rowOf(key, n.summary, prev, { head: Math.max(n.head, prev?.head ?? 0) }, now));
        const entry: CachedBlocks = { documentId: n.id, blocks: n.blocks, cachedAt: now, head: n.head, by: "copy", ...(key ? { scopeKey: key } : {}) };
        await blocks.put(entry);
        filled.push(n.id);
      } else if (!this.deps.hasLocalWork?.(n.id)) {
        await docs.delete(n.id);
        await blocks.delete(n.id);
      }
    }
    await tx.done;
    if (filled.length) this.deps.onFilled?.(filled);
    return settled;
  }

  // ---------------------------------------------------------------- live

  private async pullPage(scope: WireScope, scopeKey: string, st: ScopeCopyState): Promise<boolean> {
    const page = (await this.deps.client.query(api.sync.pullAll, { scope, cursor: st.cursor, limit: PULL_PAGE })) as PullPage;
    const now = this.now();
    this.lastPull.set(scopeKey, now);
    const db = await localDb(this.deps.accountKey);
    const tx = db.transaction(["documents", "blocks", "meta"], "readwrite");
    const docs = tx.objectStore("documents");
    const blocks = tx.objectStore("blocks");
    const touched: string[] = [];
    const drop = async (id: string) => {
      if (this.deps.hasLocalWork?.(id)) return;
      await docs.delete(id);
      await blocks.delete(id);
    };
    for (const d of page.documents) {
      if (d.sealed || !d.summary) {
        await drop(d.id);
        continue;
      }
      const prev = await docs.get(d.id);
      // A note new to this scope (made elsewhere since the listing) joins the copy and gets filled.
      await docs.put(rowOf(scopeKey, d.summary, prev, { copyGen: prev?.copyGen ?? st.generation }, now));
    }
    const byDoc = new Map<string, PullPage["blocks"]>();
    for (const b of page.blocks) {
      const list = byDoc.get(b.documentId);
      if (list) list.push(b);
      else byDoc.set(b.documentId, [b]);
    }
    for (const [id, changes] of byDoc) {
      const top = Math.max(...changes.map((c) => c.seq));
      const row = await docs.get(id);
      if (row) await docs.put({ ...row, head: Math.max(row.head ?? 0, top) });
      const entry = await blocks.get(id);
      // Only a note held whole takes changes in; any other is filled whole later.
      if (entry && entry.head !== undefined) {
        await blocks.put({ ...entry, blocks: mergeBlocks(entry.blocks, changes), head: Math.max(entry.head, top), cachedAt: now });
        touched.push(id);
      } else if (entry && entry.by !== "copy") {
        // An open note's copy from before the device copy: merged too, and filled whole once the scope is listed.
        await blocks.put({ ...entry, blocks: mergeBlocks(entry.blocks, changes), cachedAt: now });
      }
    }
    for (const r of page.removed) if (r.kind === "document") await drop(r.id);
    if (page.folders.length || page.tags.length || page.removed.some((r) => r.kind !== "document")) {
      const orgKey = `${COPY_ORG_PREFIX}${scopeKey}`;
      const org = ((await tx.objectStore("meta").get(orgKey)) as { folders: Record<string, unknown>; tags: Record<string, unknown> } | undefined) ?? { folders: {}, tags: {} };
      for (const f of page.folders) {
        if (f.deletedAt) delete org.folders[f.id];
        else org.folders[f.id] = f;
      }
      for (const t of page.tags) org.tags[t.id] = t;
      for (const r of page.removed) {
        if (r.kind === "folder") delete org.folders[r.id];
        if (r.kind === "tag") delete org.tags[r.id];
      }
      await tx.objectStore("meta").put(org, orgKey);
    }
    const next: ScopeCopyState = { ...st, cursor: Math.max(st.cursor, page.nextCursor), pulledAt: now };
    await tx.objectStore("meta").put(next, stateKey(scopeKey));
    await tx.done;
    this.states.set(scopeKey, next);
    if (touched.length) this.deps.onFilled?.(touched);
    // New or changed notes this device doesn't hold whole join the queue.
    if (page.documents.length || byDoc.size) await this.computeWants(scopeKey);
    return page.hasMore;
  }

  // ---------------------------------------------------------------- clearing

  /**
   * Removes what the copy downloaded for this account ("Remove downloaded copy"): the notes it filled and its
   * progress. Never anything waiting to sync (that's the engine's and the outbox's), nor the copies of notes
   * opened here before. It fills again only if "Keep all notes" stays on.
   */
  async clear(): Promise<void> {
    const db = await localDb(this.deps.accountKey);
    const tx = db.transaction(["documents", "blocks", "meta"], "readwrite");
    let cursor = await tx.objectStore("blocks").openCursor();
    while (cursor) {
      if (cursor.value.by === "copy" && !this.deps.hasLocalWork?.(cursor.value.documentId)) await cursor.delete();
      cursor = await cursor.continue();
    }
    let rows = await tx.objectStore("documents").openCursor();
    while (rows) {
      if (rows.value.copyGen !== undefined) {
        const { copyGen: _gen, head: _head, ...rest } = rows.value;
        void _gen;
        void _head;
        await rows.update(rest as CachedDocument);
      }
      rows = await rows.continue();
    }
    let meta = await tx.objectStore("meta").openCursor(IDBKeyRange.bound(COPY_PREFIX, `${COPY_PREFIX}￿`));
    while (meta) {
      await meta.delete();
      meta = await meta.continue();
    }
    let org = await tx.objectStore("meta").openCursor(IDBKeyRange.bound(COPY_ORG_PREFIX, `${COPY_ORG_PREFIX}￿`));
    while (org) {
      await org.delete();
      org = await org.continue();
    }
    await tx.done;
    this.states.clear();
    this.wants.clear();
    this.totals.clear();
    this.publish();
  }
}

/** The function names the copy calls (for a test's fake server). */
export const COPY_FUNCTIONS = { manifest: getFunctionName(api.sync.manifest), pullDocs: getFunctionName(api.sync.pullDocs), pullAll: getFunctionName(api.sync.pullAll) } as const;
