// Client sync reducer. Pure and deterministic so the Swift port (apps/macos/Folevi/Sync/SyncReducer.swift)
// can be verified against the same golden scenarios (fixtures/sync-scenarios.json).
// See docs/SYNC_PROTOCOL.md for the normative rules.
import type { WireBlock, WireDocumentCreate, WireDocumentPatch } from "./types";
import { canonicalJson } from "./parse";

/**
 * What an upsert changes. "collapsed" is a toggle opened or closed, and nothing else: it's taken last-writer-wins,
 * so it never conflicts with someone editing the toggle's text (and a text edit never undoes it).
 */
export type ChangedField = "content" | "position" | "collapsed";

/**
 * `sent`: the op has gone to the server at least once (it may have landed even if no answer came back). Its
 * content never changes after that: the server answers a resend of the same op id as a replay of what it got
 * the first time, so anything merged into it later would be dropped.
 */
export type SyncOp = (
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
  | { opId: string; kind: "document.update"; documentId: string; patch: WireDocumentPatch; baseRevision: number | null }
) & { sent?: boolean };

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
 * milliseconds per block. A draft (below) is changed in place instead.
 */
const shallow = (prev: SyncState): SyncState => (drafts.has(prev) ? prev : copyState(prev));

const copyState = (prev: SyncState): SyncState => ({
  ...prev,
  blocks: { ...prev.blocks },
  pending: [...prev.pending],
  inflight: [...prev.inflight],
  conflicts: [...prev.conflicts],
  errors: [...prev.errors],
  uploads: [...prev.uploads],
});

/** States owned by a batch of local changes (see `draft`). */
const drafts = new WeakSet<SyncState>();

/**
 * A private copy of `state` for a batch of local changes (one editor flush, a paste): `localUpsert`,
 * `localDelete` and `localRestore` change it in place rather than copying the account's block map again for
 * every block (a 200-block paste in a 25,000-block account took about a second). Nothing else may keep it
 * until `settle` is called; from then on it's an ordinary state, copied before any change like the others.
 */
export function draft(state: SyncState): SyncState {
  const copy = copyState(state);
  drafts.add(copy);
  return copy;
}

export function settle(state: SyncState): void {
  drafts.delete(state);
}

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

/** The ops on a block that may already be on the server: in flight, or sent and queued again. */
function sentTouches(state: SyncState, blockId: string): boolean {
  return state.inflight.some((op) => opBlockId(op) === blockId) || state.pending.some((op) => op.sent && opBlockId(op) === blockId);
}

/**
 * `baseRevision`: the version the edit was made on, when that's older than what this device holds (an editor
 * that hadn't shown a newer server version yet). Without it, the edit is based on the latest one held.
 */
export function localUpsert(
  prev: SyncState,
  input: { opId: string; documentId: string; block: WireBlock; fields: ChangedField[]; blockedBy?: string; baseRevision?: number | null },
): SyncState {
  const state = shallow(prev);
  const block = clone(input.block);
  delete block.revision;
  const entity = state.blocks[block.id];
  const serverRevision = entity?.serverRevision ?? null;
  state.blocks[block.id] = { documentId: input.documentId, block, serverRevision, deleted: false };

  // Coalesce with the latest not-yet-sent upsert for the same block, provided nothing touching this
  // block (a delete/restore) sits after it in the queue. One that was sent already stays as it went.
  let lastIdx = -1;
  for (let i = state.pending.length - 1; i >= 0; i--) {
    if (opBlockId(state.pending[i]!) === block.id) {
      lastIdx = i;
      break;
    }
  }
  const last = lastIdx >= 0 ? state.pending[lastIdx]! : null;
  if (last && last.kind === "block.upsert" && !last.sent && !input.blockedBy) {
    const fields = [...new Set<ChangedField>([...last.fields, ...input.fields])].sort() as ChangedField[];
    state.pending[lastIdx] = { ...last, block, fields };
    return state;
  }
  const op: SyncOp = {
    opId: input.opId,
    kind: "block.upsert",
    documentId: input.documentId,
    block,
    baseRevision: input.baseRevision !== undefined ? input.baseRevision : serverRevision,
    fields: [...input.fields].sort() as ChangedField[],
  };
  if (input.blockedBy) op.blockedBy = input.blockedBy;
  state.pending.push(op);
  return state;
}

export function localDelete(prev: SyncState, input: { opId: string; documentId: string; blockId: string; baseRevision?: number | null }): SyncState {
  const state = shallow(prev);
  if (!state.blocks[input.blockId]) return state;
  const entity = (state.blocks[input.blockId] = { ...state.blocks[input.blockId]! });
  if (entity.serverRevision === null && !sentTouches(state, input.blockId)) {
    // Never reached the server: forget it entirely.
    state.pending = state.pending.filter((op) => opBlockId(op) !== input.blockId);
    state.uploads = state.uploads.filter((u) => u.blockId !== input.blockId);
    delete state.blocks[input.blockId];
    return state;
  }
  entity.deleted = true;
  // Edits to it that haven't been sent yet go with it: sent first, they'd make the server see the delete
  // as based on an older version than its own edit, and refuse it as a conflict with ourselves.
  // (One that was sent may have landed: it stays, and the delete is based on it once it's answered.)
  state.pending = state.pending.filter((op) => !(op.kind === "block.upsert" && op.block.id === input.blockId && !op.sent));
  state.pending.push({
    opId: input.opId,
    kind: "block.delete",
    documentId: input.documentId,
    blockId: input.blockId,
    baseRevision: input.baseRevision !== undefined ? input.baseRevision : entity.serverRevision,
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
  if (last && last.kind === "block.delete" && last.blockId === input.blockId && !last.sent) {
    // Delete never sent: cancel it instead of sending delete+restore.
    state.pending.pop();
    return state;
  }
  state.pending.push({ opId: input.opId, kind: "block.restore", documentId: input.documentId, blockId: input.blockId });
  return state;
}

export function setConnection(prev: SyncState, connection: "online" | "offline"): SyncState {
  return { ...prev, connection };
}

/**
 * Moves up to `max` sendable ops to `inflight`. Returns the same state when a batch is already in flight.
 *
 * A new block's children never go before the block itself: the server would find no parent, file the child
 * at the top level, and the note would lose its nesting. (Typing in a line, then making a new line above it
 * and tabbing the first under it, queues the child's edit first.) So an upsert waits for its parent's
 * create in the same batch, and stays back with it when that create is held (an upload, a full batch).
 *
 * A second change to a block (or page) that already has an upsert (or update) in the batch waits for the next
 * one: it was written on top of the first, and only once the first is answered can it be based on the revision
 * that produced (sent together, the server would see it as based on an older version, a conflict with ourselves).
 * Ops taken are marked `sent`.
 */
export function takeBatch(prev: SyncState, max = 100): SyncState {
  if (prev.inflight.length || prev.connection === "offline" || prev.authRequired) return prev;
  // Only the queues are replaced below (nothing is changed in place): the rest is shared with `prev`.
  const state = { ...prev };
  const order = new Map(state.pending.map((op, i) => [op, i]));
  const unsentNew = new Set(state.pending.flatMap((op) => (op.kind === "block.upsert" && state.blocks[op.block.id]?.serverRevision == null ? [op.block.id] : [])));
  const created = new Set<string>();
  const blocked = new Set<string>();
  const advanced = new Set<string>();
  const entityKey = (op: SyncOp) => (op.kind === "document.update" ? `document:${op.documentId}` : opBlockId(op));
  const take: SyncOp[] = [];
  const keep: SyncOp[] = [];
  const hold = (op: SyncOp) => {
    const bid = opBlockId(op);
    if (bid) blocked.add(bid);
    keep.push(op);
  };
  let queue = state.pending;
  while (queue.length) {
    const later: SyncOp[] = [];
    const waiting = new Set<string>();
    let moved = false;
    for (const op of queue) {
      const bid = opBlockId(op);
      if ((op.kind === "block.upsert" && op.blockedBy) || (bid !== null && blocked.has(bid))) {
        hold(op);
        continue;
      }
      const parent = op.kind === "block.upsert" ? op.block.parentId : null;
      const parentUnsent = parent !== null && unsentNew.has(parent) && !created.has(parent);
      if (parentUnsent && blocked.has(parent)) {
        hold(op);
        continue;
      }
      const key = entityKey(op);
      if (key !== null && advanced.has(key) && op.kind !== "block.restore") {
        hold(op);
        continue;
      }
      if (parentUnsent || (bid !== null && waiting.has(bid))) {
        // After its parent (and so are later ops on the same block, to keep their order).
        if (bid) waiting.add(bid);
        later.push(op);
        continue;
      }
      if (take.length >= max) {
        hold(op);
        continue;
      }
      take.push(op.sent ? op : { ...op, sent: true });
      moved = true;
      if (op.kind === "block.upsert" && unsentNew.has(op.block.id)) created.add(op.block.id);
      if (key !== null && (op.kind === "block.upsert" || op.kind === "document.update")) advanced.add(key);
    }
    if (!moved) {
      for (const op of later) hold(op);
      break;
    }
    queue = later;
  }
  keep.sort((a, b) => order.get(a)! - order.get(b)!);
  state.inflight = take;
  state.pending = keep;
  return state;
}

export function applyResults(prev: SyncState, results: OpResult[]): SyncState {
  // Copied as it changes (each entity before it's written to), not as a whole: a deep copy of a large
  // account cost tens of milliseconds for every answer from the server.
  const state: SyncState = { ...prev, blocks: { ...prev.blocks }, pending: [...prev.pending], conflicts: [...prev.conflicts], errors: [...prev.errors] };
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
    const held = state.blocks[blockId];
    const entity = held ? (state.blocks[blockId] = { ...held }) : undefined;
    switch (result.status) {
      case "applied":
      case "duplicate": {
        if (!entity) break;
        const oldRevision = entity.serverRevision;
        if (result.revision !== undefined) entity.serverRevision = result.revision;
        // Rebase queued ops that were written on top of this (now acknowledged) change.
        state.pending = state.pending.map((p) =>
          opBlockId(p) === blockId && (p.kind === "block.upsert" || p.kind === "block.delete") && p.baseRevision === oldRevision ? { ...p, baseRevision: entity.serverRevision } : p,
        );
        const stillOutstanding =
          state.pending.some((p) => opBlockId(p) === blockId) ||
          state.inflight.some((p) => p !== op && opBlockId(p) === blockId && !byId.has(p.opId));
        // A replay answered with something other than what the op carried: the server kept an earlier copy of
        // this op id (its content changed after it was first sent, as older builds allowed) or the block changed
        // since. What this device has is queued again, based on the version the op was written on, so the
        // server applies it or asks (never quietly keeps the other text).
        if (
          result.status === "duplicate" &&
          op.kind === "block.upsert" &&
          op.fields.includes("content") &&
          result.block &&
          !result.deleted &&
          !stillOutstanding &&
          !entity.deleted &&
          !sameWrittenContent(result.block, op.block)
        ) {
          state.pending.push({ opId: `${op.opId}-again`, kind: "block.upsert", documentId: op.documentId, block: clone(entity.block), baseRevision: op.baseRevision, fields: op.fields });
          break;
        }
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
        // What the person did to it after this op (queued behind it) decides the question: deleted since, it's
        // "deleted here, changed elsewhere"; a delete they took back is an ordinary edit; a move they made stays.
        const later = state.pending.filter((p) => opBlockId(p) === blockId);
        const deletedSince = Boolean(entity?.deleted) && later.some((p) => p.kind === "block.delete");
        const restoredSince = op.kind === "block.delete" && !entity?.deleted && later.some((p) => p.kind === "block.restore");
        const movedSince = later.some((p) => p.kind === "block.upsert" && p.fields.includes("position"));
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
        // Deleted on both sides: nothing to ask.
        if (deletedSince && c?.reason === "deleted") break;
        if (latestLocal) {
          let reason: ConflictRecord["reason"] = op.kind === "block.delete" && c?.reason === "content" ? "edited" : (c?.reason ?? "content");
          if (deletedSince && op.kind === "block.upsert") reason = "edited";
          if (restoredSince && reason === "edited") reason = "content";
          state.conflicts.push({
            id: op.opId,
            documentId: (op as { documentId: string }).documentId,
            blockId,
            reason,
            server: c?.server ? stripRevision(c.server) : null,
            client: stripRevision(latestLocal),
            ...(movedSince ? { moved: true } : {}),
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

/**
 * Same content as written, ignoring the labels of links to other pages: those are served as each reader may
 * see them (the current title, or a neutral label), not as stored.
 */
function sameWrittenContent(a: WireBlock, b: WireBlock): boolean {
  const unlabel = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(unlabel);
    if (!value || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!(k === "label" && (value as { type?: unknown }).type === "pageLink")) out[k] = unlabel(v);
    return out;
  };
  const written = (block: WireBlock) => {
    const props = { ...(block.props as Record<string, unknown>) };
    // (A toggle's open or closed state is merged on its own, last writer wins: not text that could be lost.)
    delete props.collapsed;
    if (block.type === "page") {
      delete props.titleCache;
      delete props.iconCache;
    }
    return canonicalJson({ t: block.type, x: unlabel(block.text), p: unlabel(props) });
  };
  return written(a) === written(b);
}

function stripRevision(b: WireBlock): WireBlock {
  const c = clone(b);
  delete c.revision;
  return c;
}

export function batchFailed(prev: SyncState, reason: "network" | "unauthenticated" | "server"): SyncState {
  const state = { ...prev, pending: [...prev.inflight, ...prev.pending], inflight: [] };
  if (reason === "unauthenticated") state.authRequired = true;
  if (reason === "network") state.connection = "offline";
  return state;
}

/** Dismisses surfaced errors (after the person has seen them). */
export function clearErrors(prev: SyncState, opIds?: string[]): SyncState {
  return { ...prev, errors: opIds ? prev.errors.filter((e) => !opIds.includes(e.opId)) : [] };
}

export function authRefreshed(prev: SyncState): SyncState {
  return { ...prev, authRequired: false };
}

export interface RemoteRow {
  documentId: string;
  block: WireBlock;
  deleted: boolean;
}

/** A server row arrived via subscription or pull. Local unsent work always wins until acknowledged. */
export function remoteUpdate(prev: SyncState, input: RemoteRow): SyncState {
  return remoteUpdates(prev, [input]);
}

/**
 * Several server rows at once (a document's subscription), with the same result as applying them one by
 * one through `remoteUpdate`. The state is copied once for the whole batch, and only its block map: a
 * deep copy per row made a large account cost blocks × rows to reconcile.
 */
export function remoteUpdates(prev: SyncState, inputs: readonly RemoteRow[]): SyncState {
  let state: SyncState | null = null;
  // Rows never change the queues, so what's outstanding is the same for every row.
  let outstanding: Set<string> | null = null;
  for (const input of inputs) {
    const rev = input.block.revision ?? 0;
    const existing = (state ?? prev).blocks[input.block.id];
    if (existing && existing.serverRevision !== null && existing.serverRevision >= rev) continue;
    outstanding ??= new Set([...prev.pending, ...prev.inflight].flatMap((op) => opBlockId(op) ?? []));
    if (outstanding.has(input.block.id)) continue;
    state ??= { ...prev, blocks: { ...prev.blocks } };
    const b = clone(input.block);
    delete b.revision;
    state.blocks[b.id] = { documentId: input.documentId, block: b, serverRevision: rev, deleted: input.deleted };
  }
  return state ?? prev;
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
