"use client";

import type { ConvexReactClient } from "convex/react";
import { ConvexError } from "convex/values";
import { randomNoteEmoji, sync, type ChangedField, type OpResult, type SyncOp, type SyncState, type WireBlock, type WireDocumentCreate, type WireDocumentPatch, type WireScope, ulid } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { ACCOUNT_SYNC_KEY, localDb } from "./db";

export type EngineEvent =
  | { type: "state" }
  | { type: "upload-complete"; blockId: string; documentId: string; fileId: string }
  | { type: "document-result"; opId: string; result: OpResult & { document?: unknown } }
  | { type: "remote"; documentId: string };

type Listener = (e: EngineEvent) => void;

/**
 * One engine per account. Implements the client side of docs/SYNC_PROTOCOL.md on top of the shared
 * reducer: every local change is applied optimistically and persisted to IndexedDB before any network
 * call; batches go to `sync.push` in order; results are reconciled; failures keep ops.
 *
 * The queue is account-wide, not per scope: a page shared from someone's Personal or another workspace
 * (or opened from a deep link while a different context is selected) is edited through the same durable
 * queue, and the server authorizes every op against the document it touches (§Routing). The current
 * context's scope (Personal or a team workspace) only routes new top-level pages, and each
 * `document.create` is stamped with it when queued so switching contexts before it syncs can't move it.
 */
export class SyncEngine {
  state: SyncState = sync.emptySyncState();
  private listeners = new Set<Listener>();
  private flushing = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 1000;
  private persistChain: Promise<void> = Promise.resolve();
  lastError: string | null = null;
  private editing = new Set<string>();

  private _scope: WireScope;

  private constructor(
    private client: ConvexReactClient,
    private accountKey: string,
    scope: WireScope,
    readonly deviceId: string,
  ) {
    this._scope = scope;
  }

  /** The current context's scope: where new top-level pages are created (the batch's routing scope). */
  get scope(): WireScope {
    return this._scope;
  }

  setScope(scope: WireScope) {
    this._scope = scope;
  }

  /**
   * Opens the account's engine. `teamWorkspaceIds` (the workspaces the person belongs to) lets page
   * creates queued by older builds, which named a workspace id (possibly the old personal workspace,
   * which no longer exists), to be re-stamped with a scope before anything is sent (`adoptLegacyCreates`).
   */
  static async open(client: ConvexReactClient, accountKey: string, scope: WireScope, deviceId: string, teamWorkspaceIds?: readonly string[]): Promise<SyncEngine> {
    const engine = new SyncEngine(client, accountKey, scope, deviceId);
    const saved = await loadAccountState(accountKey);
    if (saved) {
      // Anything in flight when the page closed may or may not have landed: resend (ops are idempotent).
      engine.state = { ...sync.emptySyncState(), ...saved, pending: [...saved.inflight, ...saved.pending], inflight: [] };
    }
    // This tab's own journal (a reload), and those left by tabs that have since closed.
    const journals = readJournals(accountKey);
    if (journals.length) {
      for (const j of journals) engine.state = mergeJournal(engine.state, j.ops);
      engine.commit(engine.state);
      // Removed only once IndexedDB holds what they added.
      void engine.persisted().then(() => journals.forEach((j) => removeJournal(j.key)));
    }
    engine.watchUnload();
    if (teamWorkspaceIds) {
      const adopted = adoptLegacyCreates(engine.state, teamWorkspaceIds);
      if (adopted !== engine.state) engine.commit(adopted);
    }
    engine.state = sync.setConnection(engine.state, typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "online");
    return engine;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: EngineEvent) {
    for (const l of this.listeners) l(e);
  }

  /** Inside `batch`: changes collect in memory and are saved and announced once at the end. */
  private batching = 0;
  private batchDirty = false;

  /** Runs several local changes (one editor flush) as a single save and a single update to listeners. */
  batch(fn: () => void) {
    this.batching++;
    try {
      fn();
    } finally {
      this.batching--;
      if (!this.batching && this.batchDirty) {
        this.batchDirty = false;
        this.commit(this.state);
      }
    }
  }

  /**
   * While the page is hidden or closing, every change is also written straight to localStorage (the
   * IndexedDB save is asynchronous and doesn't finish during unload): what was typed just before a reload
   * or a closed tab is merged back in when the engine opens.
   */
  private journaling = false;
  private unwatch: (() => void) | null = null;
  private watchUnload() {
    if (typeof window === "undefined") return;
    const key = journalKey(this.accountKey, tabId());
    const hide = (closing: boolean) => {
      this.journaling = true;
      this.journalClosing = closing;
      writeJournal(key, this.state, closing);
    };
    // Capture, so this runs before the editor's own flush on the same event (which writes the journal again).
    // A page kept for back/forward (persisted) isn't closing: its journal stays its own.
    const onPageHide = (e: PageTransitionEvent) => hide(!e.persisted);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hide(false);
      else {
        this.journaling = false;
        removeJournal(key);
      }
    };
    const onPageShow = () => {
      this.journaling = false;
      removeJournal(key);
    };
    // Another tab of this account closed with changes IndexedDB may not have: take them over.
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === key || !e.key.startsWith(journalPrefix(this.accountKey)) || !e.newValue) return;
      const j = parseJournal(e.key, e.newValue);
      if (!j?.closed) return;
      const touched = new Set(j.ops.flatMap((op) => ("documentId" in op ? [op.documentId] : [])));
      this.commit(mergeJournal(this.state, j.ops));
      void this.persisted().then(() => removeJournal(e.key!));
      for (const documentId of touched) this.emit({ type: "remote", documentId });
      this.scheduleFlush(0);
    };
    window.addEventListener("pagehide", onPageHide, { capture: true });
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibility, { capture: true });
    this.unwatch = () => {
      window.removeEventListener("pagehide", onPageHide, { capture: true });
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility, { capture: true });
    };
  }
  private journalClosing = false;

  /** Stops listening to the page (an engine that's been replaced, or opened and then not used). */
  dispose() {
    this.unwatch?.();
    this.unwatch = null;
    this.journaling = false;
  }

  private commit(next: SyncState) {
    this.state = next;
    if (this.journaling) writeJournal(journalKey(this.accountKey, tabId()), next, this.journalClosing);
    if (this.batching) {
      this.batchDirty = true;
      return;
    }
    const snapshot = next;
    this.persistChain = this.persistChain
      .then(async () => {
        const db = await localDb(this.accountKey);
        await db.put("syncState", snapshot, ACCOUNT_SYNC_KEY);
      })
      .catch(() => undefined);
    this.emit({ type: "state" });
  }

  /** Resolves once everything committed so far is on disk. */
  persisted(): Promise<void> {
    return this.persistChain;
  }

  status() {
    const s = sync.syncStatus(this.state);
    // Keystrokes still being debounced by an editor are not saved yet either.
    return s === "saved" && this.editing.size ? "saving" : s;
  }

  /** An editor has (or no longer has) local changes it hasn't handed to the engine yet. */
  setEditing(key: string, unflushed: boolean) {
    if (unflushed === this.editing.has(key)) return;
    if (unflushed) this.editing.add(key);
    else this.editing.delete(key);
    this.emit({ type: "state" });
  }

  pendingCount(): number {
    return this.state.pending.length + this.state.inflight.length;
  }

  // ------------------------------------------------------------------ local changes

  upsertBlock(documentId: string, block: WireBlock, fields: ChangedField[]) {
    // A block with an open conflict keeps the person's own version in the conflict (that's what the editor
    // shows, and what "Keep mine" saves) until they choose: queuing it would overwrite the other version unseen.
    const at = this.openConflictIndex(block.id);
    if (at >= 0) {
      const conflicts = [...this.state.conflicts];
      const { revision: _revision, ...client } = block;
      conflicts[at] = { ...conflicts[at]!, client, ...(fields.includes("position") ? { moved: true } : {}) };
      this.commit({ ...this.state, conflicts });
      return;
    }
    // Blocks whose attachment is still uploading are held back until the upload finishes.
    const upload = this.state.uploads.find((u) => u.blockId === block.id && u.state !== "done");
    this.commit(sync.localUpsert(this.state, { opId: ulid(), documentId, block, fields, blockedBy: upload?.uploadId }));
    this.scheduleFlush();
  }

  queueUpload(documentId: string, blockId: string, uploadId: string) {
    this.commit(sync.queueUpload(this.state, { uploadId, documentId, blockId }));
  }

  uploadFailed(uploadId: string) {
    this.commit(sync.uploadFailed(this.state, uploadId));
  }

  uploadCompleted(uploadId: string, fileId: string) {
    const record = this.state.uploads.find((u) => u.uploadId === uploadId);
    this.commit(sync.uploadCompleted(this.state, { uploadId, fileId }));
    if (record) this.emit({ type: "upload-complete", blockId: record.blockId, documentId: record.documentId, fileId });
    this.scheduleFlush(0);
  }

  /** Drops a stuck upload and the block waiting on it (e.g. the file can't be read any more). */
  abandonUpload(uploadId: string) {
    const record = this.state.uploads.find((u) => u.uploadId === uploadId);
    if (!record) return;
    const next = { ...this.state, uploads: this.state.uploads.filter((u) => u.uploadId !== uploadId) };
    this.commit(sync.localDelete(next, { opId: ulid(), documentId: record.documentId, blockId: record.blockId }));
  }

  /** Blocks deleted on this device (in this session): only these come back when the person undoes. */
  private deletedHere = new Set<string>();

  /** The block's open conflict that keeps a version of the person's own (not "edited": that one was deleted here). */
  private openConflictIndex(blockId: string): number {
    return this.state.conflicts.findIndex((c) => c.blockId === blockId && c.reason !== "edited");
  }

  deleteBlock(documentId: string, blockId: string) {
    // Deleting it again after "Edited elsewhere" brought it back: that question is answered.
    if (this.state.conflicts.some((c) => c.blockId === blockId && c.reason === "edited")) {
      this.commit({ ...this.state, conflicts: this.state.conflicts.filter((c) => !(c.blockId === blockId && c.reason === "edited")) });
    }
    // Deleting a block with an open conflict settles it: if the other version was a delete too, nothing's left to do.
    const at = this.openConflictIndex(blockId);
    if (at >= 0) {
      const record = this.state.conflicts[at]!;
      this.commit({ ...this.state, conflicts: this.state.conflicts.filter((_, i) => i !== at) });
      if (record.reason === "deleted" || this.state.blocks[blockId]?.deleted) return;
    }
    this.deletedHere.add(blockId);
    this.commit(sync.localDelete(this.state, { opId: ulid(), documentId, blockId }));
    this.scheduleFlush();
  }

  /**
   * Whether this document's block was deleted by the person on this device, so undoing can bring it back
   * with `restoreBlock`. A block someone else deleted (or one with an open conflict) never is: it comes back
   * only through the conflict's "Keep mine".
   */
  isBlockDeleted(documentId: string, blockId: string): boolean {
    const entity = this.state.blocks[blockId];
    if (!entity?.deleted || entity.documentId !== documentId || !this.deletedHere.has(blockId)) return false;
    return !this.state.conflicts.some((c) => c.blockId === blockId);
  }

  restoreBlock(documentId: string, blockId: string) {
    this.deletedHere.delete(blockId);
    this.commit(sync.localRestore(this.state, { opId: ulid(), documentId, blockId }));
    this.scheduleFlush();
  }

  createDocument(document: WireDocumentCreate): string {
    const opId = ulid();
    // Pin the target scope now; a nested page always follows its parent (server-side).
    // Every note has an icon: a new one starts with a random emoji (shown right away, even offline).
    const withIcon: WireDocumentCreate = document.icon ? document : { ...document, icon: randomNoteEmoji() };
    const routed: WireDocumentCreate = withIcon.parentDocumentId || withIcon.scope || withIcon.workspaceId ? withIcon : { ...withIcon, scope: this._scope };
    this.commit({ ...this.state, pending: [...this.state.pending, { opId, kind: "document.create", document: routed }] });
    this.scheduleFlush();
    return opId;
  }

  /**
   * The newest revision of each document this device's own edits produced. A page's revision (from the server
   * query) can lag a moment behind our last applied edit; basing the next edit on that older revision made the
   * server see a conflict with ourselves and the title snap back to an earlier version while typing.
   */
  private docRevisions = new Map<string, number>();

  updateDocument(documentId: string, patch: WireDocumentPatch, baseRevision: number | null): string {
    const known = this.docRevisions.get(documentId);
    if (baseRevision !== null && known !== undefined && known > baseRevision) baseRevision = known;
    // Coalesce with a queued (not yet sent) update of the same document.
    const idx = this.state.pending.findIndex((op) => op.kind === "document.update" && op.documentId === documentId);
    if (idx >= 0) {
      const prev = this.state.pending[idx] as Extract<SyncOp, { kind: "document.update" }>;
      const pending = [...this.state.pending];
      pending[idx] = { ...prev, patch: { ...prev.patch, ...patch } };
      this.commit({ ...this.state, pending });
      this.scheduleFlush();
      return prev.opId;
    }
    const opId = ulid();
    this.commit({ ...this.state, pending: [...this.state.pending, { opId, kind: "document.update", documentId, patch, baseRevision }] });
    this.scheduleFlush();
    return opId;
  }

  resolveConflict(conflictId: string, choice: "theirs" | "mine" | "both", newRank?: string) {
    const documentId = this.state.conflicts.find((c) => c.id === conflictId)?.documentId;
    this.commit(
      sync.resolveConflict(this.state, {
        conflictId,
        choice,
        opId: ulid(),
        newBlockId: choice === "both" ? ulid() : undefined,
        newRank,
      }),
    );
    // The open editor shows the chosen version.
    if (documentId) this.emit({ type: "remote", documentId });
    this.scheduleFlush();
  }

  clearErrors() {
    this.commit(sync.clearErrors(this.state));
  }

  // ------------------------------------------------------------------ remote changes

  /** Server rows for one document (subscription). Also drops rows the server no longer has. */
  reconcileDocument(documentId: string, serverBlocks: WireBlock[]) {
    let next = this.state;
    const present = new Set<string>();
    for (const b of serverBlocks) {
      present.add(b.id);
      next = sync.remoteUpdate(next, { documentId, block: b, deleted: false });
    }
    const outstanding = new Set(
      [...next.pending, ...next.inflight].flatMap((op) =>
        op.kind === "block.upsert" ? [op.block.id] : op.kind === "block.delete" || op.kind === "block.restore" ? [op.blockId] : [],
      ),
    );
    let blocks = next.blocks;
    for (const [id, entity] of Object.entries(next.blocks)) {
      if (entity.documentId !== documentId || present.has(id) || outstanding.has(id)) continue;
      if (entity.serverRevision === null) continue;
      if (!entity.deleted) {
        if (blocks === next.blocks) blocks = { ...next.blocks };
        blocks[id] = { ...entity, deleted: true };
        // Deleted elsewhere: undo here must not bring it back.
        this.deletedHere.delete(id);
      }
    }
    if (blocks !== next.blocks) next = { ...next, blocks };
    if (next !== this.state) {
      this.commit(next);
      this.emit({ type: "remote", documentId });
    }
  }

  /**
   * The document's blocks as the person sees them: a block with an open conflict shows their own version
   * (kept in the conflict, even when the other side deleted it) until they choose.
   */
  documentBlocks(documentId: string): WireBlock[] {
    const mine = new Map<string, WireBlock>();
    for (const c of this.state.conflicts) if (c.documentId === documentId && c.reason !== "edited") mine.set(c.blockId, c.client);
    const out: WireBlock[] = [];
    for (const [id, entity] of Object.entries(this.state.blocks)) {
      if (entity.documentId !== documentId) continue;
      const own = mine.get(id);
      if (own) {
        out.push(own);
        mine.delete(id);
      } else if (!entity.deleted) out.push(entity.block);
    }
    out.push(...mine.values());
    return out;
  }

  serverRevision(blockId: string): number | null {
    return this.state.blocks[blockId]?.serverRevision ?? null;
  }

  /**
   * Resolves once a document created on this device exists on the server (its queued `document.create`
   * has been acknowledged). Server-only features on a brand-new page (e.g. creating a collection hosted
   * by it) await this instead of failing with "Document not found". Rejects when offline, when the create
   * is rejected, or after `timeoutMs`.
   */
  whenDocumentOnServer(documentId: string, timeoutMs = 20_000): Promise<void> {
    const queued = () => [...this.state.inflight, ...this.state.pending].find((op) => op.kind === "document.create" && op.document.id === documentId);
    const op = queued();
    if (!op) return Promise.resolve();
    if (this.state.connection === "offline") return Promise.reject(new Error("You’re offline. This page needs to sync before you can add that here."));
    return new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => {
        clearTimeout(timer);
        unsubscribe();
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => done(new Error("This page hasn’t synced yet. Try again in a moment.")), timeoutMs);
      const unsubscribe = this.subscribe((e) => {
        if (e.type === "document-result" && e.opId === op.opId) {
          if (e.result.status === "applied" || e.result.status === "duplicate") done();
          else done(new Error(e.result.error?.message ?? "This page couldn’t be saved."));
        } else if (e.type === "state" && !queued()) done();
      });
      this.scheduleFlush(0);
    });
  }

  hasLocalWork(documentId: string): boolean {
    return [...this.state.pending, ...this.state.inflight].some((op) => ("documentId" in op ? op.documentId === documentId : false));
  }

  // ------------------------------------------------------------------ network

  setOnline(online: boolean) {
    const next = sync.setConnection(this.state, online ? "online" : "offline");
    if (next !== this.state) this.commit(next);
    if (online) this.scheduleFlush(0);
  }

  authRefreshed() {
    this.commit(sync.authRefreshed(this.state));
    this.scheduleFlush(0);
  }

  scheduleFlush(delay = 150) {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.flush(), delay);
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (let rounds = 0; rounds < 20; rounds++) {
        const batched = sync.takeBatch(this.state, 50);
        if (batched === this.state || batched.inflight.length === 0) break;
        this.commit(batched);
        await this.persisted();
        let results: (OpResult & { document?: unknown })[];
        try {
          results = (await withTimeout(
            this.client.mutation(api.sync.push, { scope: this._scope, deviceId: this.deviceId, ops: batched.inflight as never }),
            45_000,
          )) as (OpResult & { document?: unknown })[];
        } catch (error) {
          const code = error instanceof ConvexError ? (error.data as { code?: string })?.code : undefined;
          this.lastError = code ?? "network";
          if (code === "unauthenticated" || code === "profile_missing") this.commit(sync.batchFailed(this.state, "unauthenticated"));
          else if (!code) this.commit(sync.batchFailed(this.state, navigator.onLine ? "server" : "network"));
          else this.commit(sync.batchFailed(this.state, "server"));
          this.retryDelay = Math.min(this.retryDelay * 2, 60_000);
          if (code !== "unauthenticated") this.scheduleFlush(this.retryDelay);
          return;
        }
        this.retryDelay = 1000;
        this.lastError = null;
        let next = sync.applyResults(this.state, results);
        for (const r of results) {
          const op = batched.inflight.find((o) => o.opId === r.opId);
          if (!op || (op.kind !== "document.create" && op.kind !== "document.update")) continue;
          // Rebase queued title/style edits onto the revision we just produced (never conflict with ourselves).
          if (r.status === "applied" || r.status === "duplicate") {
            const docId = op.kind === "document.create" ? op.document.id : op.documentId;
            if (typeof r.revision === "number") this.docRevisions.set(docId, Math.max(r.revision, this.docRevisions.get(docId) ?? 0));
            next = {
              ...next,
              pending: next.pending.map((p) => (p.kind === "document.update" && p.documentId === docId ? { ...p, baseRevision: r.revision ?? p.baseRevision } : p)),
            };
          }
          this.emit({ type: "document-result", opId: r.opId, result: r });
        }
        this.commit(next);
        // A block change the server didn't take as sent (a conflict, a rejection, a normalised value) leaves the
        // engine holding a different version than the editor shows: tell the open editor to re-read it.
        const touched = new Set<string>();
        for (const r of results) {
          if (r.status === "applied" && !r.normalized) continue;
          if (r.status === "duplicate") continue;
          const op = batched.inflight.find((o) => o.opId === r.opId);
          if (op && (op.kind === "block.upsert" || op.kind === "block.delete" || op.kind === "block.restore")) touched.add(op.documentId);
        }
        for (const documentId of touched) this.emit({ type: "remote", documentId });
      }
    } finally {
      this.flushing = false;
    }
  }
}

const journalPrefix = (accountKey: string) => `folevi:sync-journal:${accountKey}:`;
const journalKey = (accountKey: string, tab: string) => `${journalPrefix(accountKey)}${tab}`;

/** This tab's id: kept in sessionStorage, so a reload is the same tab and reads its own journal back. */
function tabId(): string {
  try {
    let id = sessionStorage.getItem("folevi:tab-id");
    if (!id) {
      id = ulid();
      sessionStorage.setItem("folevi:tab-id", id);
    }
    return id;
  } catch {
    return "tab";
  }
}

interface Journal {
  key: string;
  ops: SyncOp[];
  /** Written as the tab closed (not just hidden): another tab may take it over. */
  closed: boolean;
}

function parseJournal(key: string, raw: string): Journal | null {
  try {
    const parsed = JSON.parse(raw) as { ops?: SyncOp[]; closed?: boolean };
    return Array.isArray(parsed.ops) ? { key, ops: parsed.ops, closed: Boolean(parsed.closed) } : null;
  } catch {
    return null;
  }
}

function writeJournal(key: string, state: SyncState, closed: boolean) {
  try {
    const ops = [...state.inflight, ...state.pending];
    if (!ops.length) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ ops, closed, at: Date.now() }));
  } catch {
    // Storage full or blocked: the IndexedDB save is still on its way.
  }
}

/**
 * The journals this tab should merge as it opens: its own (left by a reload), and any written by tabs
 * that closed. A tab that's only hidden keeps its journal: it may still change those ops.
 */
function readJournals(accountKey: string): Journal[] {
  try {
    const own = journalKey(accountKey, tabId());
    const out: Journal[] = [];
    // The one shared journal an earlier version wrote.
    const legacy = `folevi:sync-journal:${accountKey}`;
    const old = parseJournal(legacy, localStorage.getItem(legacy) ?? "");
    if (old) out.push(old);
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(journalPrefix(accountKey))) continue;
      const j = parseJournal(key, localStorage.getItem(key) ?? "");
      if (j && (key === own || j.closed)) out.push(j);
    }
    return out;
  } catch {
    return [];
  }
}

function removeJournal(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Ops written to the journal as the page was closing: newer than (or the same as) what IndexedDB holds.
 * An op already queued is replaced by its journal copy (the same op, with later coalesced content);
 * others are added, and the blocks they carry become the local version.
 */
export function mergeJournal(state: SyncState, ops: SyncOp[]): SyncState {
  if (!ops.length) return state;
  const pending = [...state.pending];
  const blocks = { ...state.blocks };
  for (const op of ops) {
    const at = pending.findIndex((p) => p.opId === op.opId);
    if (at >= 0) pending[at] = op;
    else pending.push(op);
    if (op.kind === "block.upsert") {
      const prev = blocks[op.block.id];
      blocks[op.block.id] = { documentId: op.documentId, block: op.block, serverRevision: prev?.serverRevision ?? op.baseRevision ?? null, deleted: false };
    } else if (op.kind === "block.delete" && blocks[op.blockId]) {
      blocks[op.blockId] = { ...blocks[op.blockId]!, deleted: true };
    }
  }
  return { ...state, pending, blocks };
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

/**
 * Reads the account-wide sync state, first folding in any per-workspace states written by older builds
 * (they were keyed by workspace id). The fold happens in one IndexedDB transaction, so a crash leaves
 * either the old keys or the merged state, never neither. Legacy `document.create` ops are stamped
 * with the workspace they were queued in, preserving where they land.
 */
async function loadAccountState(accountKey: string): Promise<SyncState | undefined> {
  const db = await localDb(accountKey);
  const tx = db.transaction("syncState", "readwrite");
  const keys = (await tx.store.getAllKeys()).filter((k) => k !== ACCOUNT_SYNC_KEY);
  let merged = await tx.store.get(ACCOUNT_SYNC_KEY);
  for (const key of keys) {
    const legacy = await tx.store.get(key);
    if (legacy) merged = mergeSyncStates(merged, legacy, key);
    await tx.store.delete(key);
  }
  if (keys.length && merged) await tx.store.put(merged, ACCOUNT_SYNC_KEY);
  await tx.done;
  return merged;
}

/**
 * Page creates queued by older builds name a workspace id (`document.workspaceId`) instead of a scope.
 * Personal used to be a workspace, and that workspace no longer exists, so a create naming it would be
 * refused. Each such create is re-stamped: a workspace the person still belongs to stays
 * (`scope: workspace`); anything else lands in their own Personal, the only place a create naming a
 * vanished workspace can go without losing what they wrote. Returns `state` itself when there's nothing
 * to adopt. Exported for tests.
 */
export function adoptLegacyCreates(state: SyncState, teamWorkspaceIds: readonly string[]): SyncState {
  const teams = new Set(teamWorkspaceIds);
  let changed = false;
  const adopt = (op: SyncOp): SyncOp => {
    if (op.kind !== "document.create" || op.document.scope || !op.document.workspaceId) return op;
    changed = true;
    const { workspaceId, ...document } = op.document;
    if (document.parentDocumentId) return { ...op, document }; // a nested page follows its parent
    const scope: WireScope = teams.has(workspaceId) ? { kind: "workspace", workspaceId } : { kind: "personal" };
    return { ...op, document: { ...document, scope } };
  };
  const pending = state.pending.map(adopt);
  const inflight = state.inflight.map(adopt);
  return changed ? { ...state, pending, inflight } : state;
}

/** Folds a legacy per-workspace state into the account state. Exported for tests. */
export function mergeSyncStates(base: SyncState | undefined, legacy: SyncState, legacyWorkspaceId: string): SyncState {
  // Stamped with the legacy workspace id; `adoptLegacyCreates` turns it into a scope when the engine opens.
  const stamp = (op: SyncOp): SyncOp =>
    op.kind === "document.create" && !op.document.parentDocumentId && !op.document.workspaceId && !op.document.scope
      ? { ...op, document: { ...op.document, workspaceId: legacyWorkspaceId } }
      : op;
  const into = base ?? sync.emptySyncState();
  const blocks = { ...legacy.blocks, ...into.blocks };
  const seenConflicts = new Set(into.conflicts.map((c) => c.id));
  const seenUploads = new Set(into.uploads.map((u) => u.uploadId));
  const seenErrors = new Set(into.errors.map((e) => e.opId));
  return {
    ...into,
    blocks,
    // In-flight ops of either state are resent first (idempotent); per-document order is preserved.
    pending: [...into.inflight, ...into.pending, ...[...legacy.inflight, ...legacy.pending].map(stamp)],
    inflight: [],
    conflicts: [...into.conflicts, ...legacy.conflicts.filter((c) => !seenConflicts.has(c.id))],
    errors: [...into.errors, ...legacy.errors.filter((e) => !seenErrors.has(e.opId))],
    uploads: [...into.uploads, ...legacy.uploads.filter((u) => !seenUploads.has(u.uploadId))],
    authRequired: into.authRequired || legacy.authRequired,
  };
}
