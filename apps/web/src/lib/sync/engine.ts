"use client";

import type { ConvexReactClient } from "convex/react";
import { ConvexError } from "convex/values";
import { sync, type ChangedField, type OpResult, type SyncOp, type SyncState, type WireBlock, type WireDocumentCreate, type WireDocumentPatch, ulid } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { localDb } from "./db";

export type EngineEvent =
  | { type: "state" }
  | { type: "upload-complete"; blockId: string; documentId: string; fileId: string }
  | { type: "document-result"; opId: string; result: OpResult & { document?: unknown } }
  | { type: "remote"; documentId: string };

type Listener = (e: EngineEvent) => void;

/**
 * One engine per (account, workspace). Implements the client side of docs/SYNC_PROTOCOL.md on top of
 * the shared reducer: every local change is applied optimistically and persisted to IndexedDB before
 * any network call; batches go to `sync.push` in order; results are reconciled; failures keep ops.
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

  private constructor(
    private client: ConvexReactClient,
    private accountKey: string,
    readonly workspaceId: string,
    readonly deviceId: string,
  ) {}

  static async open(client: ConvexReactClient, accountKey: string, workspaceId: string, deviceId: string): Promise<SyncEngine> {
    const engine = new SyncEngine(client, accountKey, workspaceId, deviceId);
    const db = await localDb(accountKey);
    const saved = await db.get("syncState", workspaceId);
    if (saved) {
      // Anything in flight when the page closed may or may not have landed: resend (ops are idempotent).
      engine.state = { ...sync.emptySyncState(), ...saved, pending: [...saved.inflight, ...saved.pending], inflight: [] };
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

  private commit(next: SyncState) {
    this.state = next;
    const snapshot = next;
    this.persistChain = this.persistChain
      .then(async () => {
        const db = await localDb(this.accountKey);
        await db.put("syncState", snapshot, this.workspaceId);
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

  deleteBlock(documentId: string, blockId: string) {
    this.commit(sync.localDelete(this.state, { opId: ulid(), documentId, blockId }));
    this.scheduleFlush();
  }

  restoreBlock(documentId: string, blockId: string) {
    this.commit(sync.localRestore(this.state, { opId: ulid(), documentId, blockId }));
    this.scheduleFlush();
  }

  createDocument(document: WireDocumentCreate): string {
    const opId = ulid();
    this.commit({ ...this.state, pending: [...this.state.pending, { opId, kind: "document.create", document }] });
    this.scheduleFlush();
    return opId;
  }

  updateDocument(documentId: string, patch: WireDocumentPatch, baseRevision: number | null): string {
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
    this.commit(
      sync.resolveConflict(this.state, {
        conflictId,
        choice,
        opId: ulid(),
        newBlockId: choice === "both" ? ulid() : undefined,
        newRank,
      }),
    );
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
      }
    }
    if (blocks !== next.blocks) next = { ...next, blocks };
    if (next !== this.state) {
      this.commit(next);
      this.emit({ type: "remote", documentId });
    }
  }

  documentBlocks(documentId: string): WireBlock[] {
    const out: WireBlock[] = [];
    for (const entity of Object.values(this.state.blocks)) {
      if (entity.documentId === documentId && !entity.deleted) out.push(entity.block);
    }
    return out;
  }

  serverRevision(blockId: string): number | null {
    return this.state.blocks[blockId]?.serverRevision ?? null;
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
            this.client.mutation(api.sync.push, { workspaceId: this.workspaceId, deviceId: this.deviceId, ops: batched.inflight as never }),
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
            next = {
              ...next,
              pending: next.pending.map((p) => (p.kind === "document.update" && p.documentId === docId ? { ...p, baseRevision: r.revision ?? p.baseRevision } : p)),
            };
          }
          this.emit({ type: "document-result", opId: r.opId, result: r });
        }
        this.commit(next);
      }
    } finally {
      this.flushing = false;
    }
  }
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
