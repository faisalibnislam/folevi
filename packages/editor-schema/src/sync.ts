// Client sync reducer. Pure and deterministic so the Swift port (apps/macos/Folevi/Sync/SyncReducer.swift)
// can be verified against the same golden scenarios (fixtures/sync-scenarios.json).
// See docs/SYNC_PROTOCOL.md for the normative rules.
import type { WireBlock, WireDocumentCreate, WireDocumentPatch } from "./types";
import { canonicalJson } from "./parse";

export type ChangedField = "content" | "position";

export type SyncOp =
  | {
      opId: string;
      kind: "block.upsert";
      documentId: string;
      block: WireBlock;
      baseRevision: number | null;
      fields: ChangedField[];
      blockedBy?: string;
    }
  | { opId: string; kind: "block.delete"; documentId: string; blockId: string; baseRevision: number | null }
  | { opId: string; kind: "block.restore"; documentId: string; blockId: string }
  | { opId: string; kind: "document.create"; document: WireDocumentCreate }
  | { opId: string; kind: "document.update"; documentId: string; patch: WireDocumentPatch; baseRevision: number | null };

export type OpStatus = "applied" | "duplicate" | "conflict" | "rejected";

export interface OpResult {
  opId: string;
  status: OpStatus;
  revision?: number;
  block?: WireBlock | null;
  deleted?: boolean;
  conflict?: { reason: "content" | "deleted" | "exists"; server: WireBlock | null; client: WireBlock | null };
  error?: { code: string; message: string };
  normalized?: boolean;
}

export interface SyncEntity {
  documentId: string;
  block: WireBlock;
  serverRevision: number | null;
  deleted: boolean;
}

export interface ConflictRecord {
  id: string;
  documentId: string;
  blockId: string;
  /** "edited": this device deleted the block, and someone changed it meanwhile (it's kept until you choose). */
  reason: "content" | "deleted" | "exists" | "edited";
  server: WireBlock | null;
  client: WireBlock;
  /** The person moved the block (indent, drag) while the conflict was open: their position wins either way. */
  moved?: boolean;
}

export interface UploadRecord {
  uploadId: string;
  documentId: string;
  blockId: string;
  attempts: number;
  state: "queued" | "uploading" | "failed" | "done";
}

export interface SyncState {
  blocks: Record<string, SyncEntity>;
  pending: SyncOp[];
  inflight: SyncOp[];
  conflicts: ConflictRecord[];
  errors: { opId: string; code: string }[];
  uploads: UploadRecord[];
  connection: "online" | "offline";
  authRequired: boolean;
}

export type SyncStatus = "saved" | "saving" | "offline" | "syncing" | "conflict" | "error";

export function emptySyncState(): SyncState {
  return { blocks: {}, pending: [], inflight: [], conflicts: [], errors: [], uploads: [], connection: "online", authRequired: false };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * A copy for the local edits (one per keystroke pause): new top-level collections, with entities shared
 * with `prev` until one is changed (copy it first). A deep clone of a large account cost tens of
 * milliseconds per block.
 */
const shallow = (prev: SyncState): SyncState => ({
  ...prev,
  blocks: { ...prev.blocks },
  pending: [...prev.pending],
  inflight: [...prev.inflight],
  conflicts: [...prev.conflicts],
  errors: [...prev.errors],
  uploads: [...prev.uploads],
});

function opBlockId(op: SyncOp): string | null {
  switch (op.kind) {
    case "block.upsert":
      return op.block.id;
    case "block.delete":
    case "block.restore":
      return op.blockId;
    default:
      return null;
  }
}

function hasOutstanding(state: SyncState, blockId: string): boolean {
  return [...state.pending, ...state.inflight].some((op) => opBlockId(op) === blockId);
}

export function localUpsert(
  prev: SyncState,
  input: { opId: string; documentId: string; block: WireBlock; fields: ChangedField[]; blockedBy?: string },
): SyncState {
  const state = shallow(prev);
  const block = clone(input.block);
  delete block.revision;
  const entity = state.blocks[block.id];
  const serverRevision = entity?.serverRevision ?? null;
  state.blocks[block.id] = { documentId: input.documentId, block, serverRevision, deleted: false };

  // Coalesce with the latest not-yet-sent upsert for the same block, provided nothing touching this
  // block (a delete/restore) sits after it in the queue.
  let lastIdx = -1;
  for (let i = state.pending.length - 1; i >= 0; i--) {
    if (opBlockId(state.pending[i]!) === block.id) {
      lastIdx = i;
      break;
    }
  }
  const last = lastIdx >= 0 ? state.pending[lastIdx]! : null;
  if (last && last.kind === "block.upsert" && !input.blockedBy) {
    const fields = [...new Set<ChangedField>([...last.fields, ...input.fields])].sort() as ChangedField[];
    state.pending[lastIdx] = { ...last, block, fields };
    return state;
  }
  const op: SyncOp = {
    opId: input.opId,
    kind: "block.upsert",
    documentId: input.documentId,
    block,
    baseRevision: serverRevision,
    fields: [...input.fields].sort() as ChangedField[],
  };
  if (input.blockedBy) op.blockedBy = input.blockedBy;
  state.pending.push(op);
  return state;
}

export function localDelete(prev: SyncState, input: { opId: string; documentId: string; blockId: string }): SyncState {
  const state = shallow(prev);
  if (!state.blocks[input.blockId]) return state;
  const entity = (state.blocks[input.blockId] = { ...state.blocks[input.blockId]! });
  const inflightTouches = state.inflight.some((op) => opBlockId(op) === input.blockId);
  if (entity.serverRevision === null && !inflightTouches) {
    // Never reached the server: forget it entirely.
    state.pending = state.pending.filter((op) => opBlockId(op) !== input.blockId);
    state.uploads = state.uploads.filter((u) => u.blockId !== input.blockId);
    delete state.blocks[input.blockId];
    return state;
  }
  entity.deleted = true;
  // Edits to it that haven't been sent yet go with it: sent first, they'd make the server see the delete
  // as based on an older version than its own edit, and refuse it as a conflict with ourselves.
  state.pending = state.pending.filter((op) => !(op.kind === "block.upsert" && op.block.id === input.blockId));
  state.pending.push({
    opId: input.opId,
    kind: "block.delete",
    documentId: input.documentId,
    blockId: input.blockId,
    baseRevision: entity.serverRevision,
  });
  return state;
}

export function localRestore(prev: SyncState, input: { opId: string; documentId: string; blockId: string }): SyncState {
  const state = shallow(prev);
  if (!state.blocks[input.blockId]?.deleted) return state;
  const entity = (state.blocks[input.blockId] = { ...state.blocks[input.blockId]! });
  entity.deleted = false;
  const lastIdx = state.pending.length - 1;
  const last = state.pending[lastIdx];
  if (last && last.kind === "block.delete" && last.blockId === input.blockId) {
    // Delete never sent: cancel it instead of sending delete+restore.
    state.pending.pop();
    return state;
  }
  state.pending.push({ opId: input.opId, kind: "block.restore", documentId: input.documentId, blockId: input.blockId });
  return state;
}

export function setConnection(prev: SyncState, connection: "online" | "offline"): SyncState {
  const state = clone(prev);
  state.connection = connection;
  return state;
}

/** Moves up to `max` sendable ops to `inflight`. Returns the same state when a batch is already in flight. */
export function takeBatch(prev: SyncState, max = 100): SyncState {
  if (prev.inflight.length || prev.connection === "offline" || prev.authRequired) return prev;
  const state = clone(prev);
  const blocked = new Set<string>();
  const take: SyncOp[] = [];
  const keep: SyncOp[] = [];
  for (const op of state.pending) {
    const bid = opBlockId(op);
    const isBlocked = (op.kind === "block.upsert" && op.blockedBy) || (bid !== null && blocked.has(bid));
    if (isBlocked) {
      if (bid) blocked.add(bid);
      keep.push(op);
    } else if (take.length < max) take.push(op);
    else keep.push(op);
  }
  state.inflight = take;
  state.pending = keep;
  return state;
}

export function applyResults(prev: SyncState, results: OpResult[]): SyncState {
  const state = clone(prev);
  const byId = new Map(results.map((r) => [r.opId, r]));
  const unanswered: SyncOp[] = [];
  for (const op of state.inflight) {
    const result = byId.get(op.opId);
    if (!result) {
      unanswered.push(op);
      continue;
    }
    const blockId = opBlockId(op);
    if (!blockId) continue;
    const entity = state.blocks[blockId];
    switch (result.status) {
      case "applied":
      case "duplicate": {
        if (!entity) break;
        const oldRevision = entity.serverRevision;
        if (result.revision !== undefined) entity.serverRevision = result.revision;
        // Rebase queued ops that were written on top of this (now acknowledged) change.
        for (const p of state.pending) {
          if (opBlockId(p) !== blockId) continue;
          if ((p.kind === "block.upsert" || p.kind === "block.delete") && p.baseRevision === oldRevision) {
            p.baseRevision = entity.serverRevision;
          }
        }
        const stillOutstanding =
          state.pending.some((p) => opBlockId(p) === blockId) ||
          state.inflight.some((p) => p !== op && opBlockId(p) === blockId && !byId.has(p.opId));
        if (!stillOutstanding && result.block) {
          const b = clone(result.block);
          delete b.revision;
          entity.block = b;
        }
        if (result.deleted !== undefined && !stillOutstanding) entity.deleted = result.deleted;
        break;
      }
      case "conflict": {
        const c = result.conflict;
        // The most recent local content is what the person would want to keep.
        const latestLocal = entity?.block ?? (op.kind === "block.upsert" ? op.block : null);
        state.pending = state.pending.filter((p) => opBlockId(p) !== blockId);
        if (c?.server) {
          const server = clone(c.server);
          const rev = server.revision ?? null;
          delete server.revision;
          state.blocks[blockId] = {
            documentId: entity?.documentId ?? (op as { documentId: string }).documentId,
            block: server,
            serverRevision: rev,
            deleted: c.reason === "deleted",
          };
        }
        if (latestLocal) {
          state.conflicts.push({
            id: op.opId,
            documentId: (op as { documentId: string }).documentId,
            blockId,
            reason: op.kind === "block.delete" && c?.reason === "content" ? "edited" : (c?.reason ?? "content"),
            server: c?.server ? stripRevision(c.server) : null,
            client: stripRevision(latestLocal),
          });
        }
        break;
      }
      case "rejected": {
        state.errors.push({ opId: op.opId, code: result.error?.code ?? "rejected" });
        if (!entity) break;
        if (result.block) {
          const b = clone(result.block);
          const rev = b.revision ?? entity.serverRevision;
          delete b.revision;
          entity.block = b;
          entity.serverRevision = rev ?? null;
          entity.deleted = Boolean(result.deleted);
        } else if (entity.serverRevision === null && !hasOutstandingExcept(state, blockId, op.opId)) {
          delete state.blocks[blockId];
        }
        break;
      }
    }
  }
  state.inflight = [];
  // Ops the server did not answer are retried first, in their original order.
  state.pending = [...unanswered, ...state.pending];
  if (results.length) state.authRequired = false;
  return state;
}

function hasOutstandingExcept(state: SyncState, blockId: string, opId: string): boolean {
  return [...state.pending, ...state.inflight].some((op) => op.opId !== opId && opBlockId(op) === blockId);
}

function stripRevision(b: WireBlock): WireBlock {
  const c = clone(b);
  delete c.revision;
  return c;
}

export function batchFailed(prev: SyncState, reason: "network" | "unauthenticated" | "server"): SyncState {
  const state = clone(prev);
  state.pending = [...state.inflight, ...state.pending];
  state.inflight = [];
  if (reason === "unauthenticated") state.authRequired = true;
  if (reason === "network") state.connection = "offline";
  return state;
}

/** Dismisses surfaced errors (after the person has seen them). */
export function clearErrors(prev: SyncState, opIds?: string[]): SyncState {
  const state = clone(prev);
  state.errors = opIds ? state.errors.filter((e) => !opIds.includes(e.opId)) : [];
  return state;
}

export function authRefreshed(prev: SyncState): SyncState {
  const state = clone(prev);
  state.authRequired = false;
  return state;
}

/** A server row arrived via subscription or pull. Local unsent work always wins until acknowledged. */
export function remoteUpdate(prev: SyncState, input: { documentId: string; block: WireBlock; deleted: boolean }): SyncState {
  const rev = input.block.revision ?? 0;
  const existing = prev.blocks[input.block.id];
  if (existing && existing.serverRevision !== null && existing.serverRevision >= rev) return prev;
  if (hasOutstanding(prev, input.block.id)) return prev;
  const state = clone(prev);
  const b = clone(input.block);
  delete b.revision;
  state.blocks[b.id] = { documentId: input.documentId, block: b, serverRevision: rev, deleted: input.deleted };
  return state;
}

export function queueUpload(prev: SyncState, input: { uploadId: string; documentId: string; blockId: string }): SyncState {
  const state = clone(prev);
  state.uploads.push({ ...input, attempts: 0, state: "queued" });
  return state;
}

export function uploadFailed(prev: SyncState, uploadId: string): SyncState {
  const state = clone(prev);
  const u = state.uploads.find((x) => x.uploadId === uploadId);
  if (u) {
    u.attempts += 1;
    u.state = "failed";
  }
  return state;
}

export function uploadCompleted(prev: SyncState, input: { uploadId: string; fileId: string }): SyncState {
  const state = clone(prev);
  const u = state.uploads.find((x) => x.uploadId === input.uploadId);
  if (!u) return state;
  u.state = "done";
  const entity = state.blocks[u.blockId];
  if (entity) entity.block.props = { ...entity.block.props, fileId: input.fileId };
  for (const op of state.pending) {
    if (op.kind === "block.upsert" && op.blockedBy === input.uploadId) {
      op.block = clone(entity?.block ?? op.block);
      delete op.blockedBy;
    }
  }
  state.uploads = state.uploads.filter((x) => x.state !== "done");
  return state;
}

export function resolveConflict(
  prev: SyncState,
  input: { conflictId: string; choice: "theirs" | "mine" | "both"; opId: string; newBlockId?: string; newRank?: string },
): SyncState {
  const record = prev.conflicts.find((c) => c.id === input.conflictId);
  if (!record) return prev;
  let state = clone(prev);
  state.conflicts = state.conflicts.filter((c) => c.id !== input.conflictId);
  if (input.choice === "theirs") {
    // Their text, but where the person put it meanwhile.
    const server = state.blocks[record.blockId];
    if (record.moved && server && !server.deleted) {
      return localUpsert(state, {
        opId: input.opId,
        documentId: record.documentId,
        block: { ...server.block, parentId: record.client.parentId, rank: record.client.rank },
        fields: ["position"],
      });
    }
    return state;
  }
  // Deleted here, edited elsewhere: "mine" deletes it after all; there's nothing to keep twice.
  if (record.reason === "edited") {
    return input.choice === "mine" ? localDelete(state, { opId: input.opId, documentId: record.documentId, blockId: record.blockId }) : state;
  }
  if (input.choice === "mine") {
    if (record.reason === "deleted") {
      state = localRestore(state, { opId: `${input.opId}-restore`, documentId: record.documentId, blockId: record.blockId });
    }
    const current = state.blocks[record.blockId]?.block ?? record.server ?? record.client;
    return localUpsert(state, {
      opId: input.opId,
      documentId: record.documentId,
      block: record.moved ? record.client : { ...record.client, parentId: current.parentId, rank: current.rank },
      fields: record.moved ? ["content", "position"] : ["content"],
    });
  }
  if (!input.newBlockId || !input.newRank) throw new Error("keep both requires newBlockId and newRank");
  const base = state.blocks[record.blockId]?.block ?? record.client;
  return localUpsert(state, {
    opId: input.opId,
    documentId: record.documentId,
    block: { ...record.client, id: input.newBlockId, parentId: base.parentId, rank: input.newRank },
    fields: ["content", "position"],
  });
}

export function syncStatus(state: SyncState): SyncStatus {
  if (state.conflicts.length) return "conflict";
  if (state.errors.length || state.authRequired) return "error";
  if (state.connection === "offline") return "offline";
  if (state.inflight.length) return "syncing";
  if (state.pending.length || state.uploads.length) return "saving";
  return "saved";
}

/** Canonical projection used by contract tests (identical in Swift). */
export function canonicalSyncState(state: SyncState): string {
  return canonicalJson({
    blocks: Object.fromEntries(
      Object.entries(state.blocks)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([id, e]) => [id, { block: e.block, deleted: e.deleted, documentId: e.documentId, serverRevision: e.serverRevision }]),
    ),
    pending: state.pending.map((op) => opSummary(op)),
    inflight: state.inflight.map((op) => opSummary(op)),
    conflicts: state.conflicts.map((c) => ({ blockId: c.blockId, client: c.client, id: c.id, reason: c.reason })),
    errors: state.errors,
    uploads: state.uploads,
    connection: state.connection,
    authRequired: state.authRequired,
    status: syncStatus(state),
  });
}

function opSummary(op: SyncOp): Record<string, unknown> {
  const base: Record<string, unknown> = { opId: op.opId, kind: op.kind };
  if (op.kind === "block.upsert") {
    base.blockId = op.block.id;
    base.baseRevision = op.baseRevision;
    base.fields = op.fields;
    if (op.blockedBy) base.blockedBy = op.blockedBy;
  } else if (op.kind === "block.delete") {
    base.blockId = op.blockId;
    base.baseRevision = op.baseRevision;
  } else if (op.kind === "block.restore") {
    base.blockId = op.blockId;
  }
  return base;
}
