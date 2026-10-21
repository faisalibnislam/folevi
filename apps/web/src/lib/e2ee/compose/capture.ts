// Device versions of server mutations (docs/E2EE_DESIGN.md §6.7, WP7). A composer reads the replica and
// writes through the engine and sealed calls. Most of them already exist: local mode ported every one
// (lib/local/functions), against the same LocalStore the replica is. So a composer runs that handler over a
// scratch transaction on the replica, takes the rows it would have written, and sends them as what they are:
// new and changed notes and blocks as sync ops (sealed by the transport), collections, found text and study
// schedules as sealed records, a row's values as its note's sealed meta, tags as e2ee.content.setDocumentTags.
//
// Settled while building WP7 (docs/E2EE_DESIGN.md §6.7): the design rejected projecting *every* mutation
// from row writes (intent is lost: a trash cascade, a star); composers are only the functions that derive
// content on the server, and their writes are content (notes, blocks, records), so they project cleanly.
// Anything else a handler writes (stars, recents, meta bookkeeping) is ignored: a composer never sends it.
import { ConvexError } from "convex/values";
import { ulid, type SyncOp, type WireBlock, type WireDocumentCreate, type WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { LocalBackend } from "@/lib/local/backend";
import type { CommitHints, LocalBlock, LocalDocument, LocalStore, LocalTable, LocalTables, StoreWrite } from "@/lib/local/store";
import type { LocalMutationCtx } from "@/lib/local/registry";
import type { DocumentMeta } from "../seal";
import { content } from "../router/refs";
import type { E2eeSpace } from "../router/deps";
import type { RouterEnv } from "../router/types";
import type { SpaceReplicaStore } from "../replica/store";

/** A store that reads the replica and keeps what a handler commits instead of writing it. */
class ScratchStore implements LocalStore {
  readonly writes: StoreWrite[] = [];
  private own = new Map<string, StoreWrite>();
  constructor(private readonly base: SpaceReplicaStore) {}

  private slot(table: LocalTable, id: string, partition?: string) {
    return `${table}\u0000${partition ?? ""}\u0000${id}`;
  }

  async get<T extends LocalTable>(table: T, id: string, partition?: string): Promise<LocalTables[T] | undefined> {
    const w = this.own.get(this.slot(table, id, partition));
    if (w) return w.value === null ? undefined : (structuredClone(w.value) as LocalTables[T]);
    return await this.base.get(table, id, partition);
  }

  async list<T extends LocalTable>(table: T, partition?: string): Promise<LocalTables[T][]> {
    const rows = await this.base.list(table, partition);
    const own = [...this.own.values()].filter((w) => w.table === table && (partition === undefined || w.partition === partition));
    if (!own.length) return rows;
    const changed = new Set(own.map((w) => w.id));
    const kept = rows.filter((r) => !changed.has((r as { id?: string }).id ?? ""));
    for (const w of own) if (w.value !== null) kept.push(structuredClone(w.value) as LocalTables[T]);
    return kept;
  }

  async commit(writes: readonly StoreWrite[], _hints?: CommitHints): Promise<void> {
    void _hints;
    for (const w of writes) {
      this.own.set(this.slot(w.table, w.id, w.partition), w);
      this.writes.push(w);
    }
  }

  subscribe(): () => void {
    return () => {};
  }
}

/** What a handler run on the replica would have written: the last write per row, with the row before it. */
export interface Captured {
  result: unknown;
  writes: { w: StoreWrite; before: unknown }[];
}

/** Runs a ported local handler against the replica without changing it. */
export async function capture(store: SpaceReplicaStore, kind: "mutation" | "action", name: string, args: Record<string, unknown>, deviceId: string): Promise<Captured> {
  return await captureWith(store, deviceId, (backend) => (kind === "mutation" ? backend.mutation(name, args) : backend.action(name, args)));
}

/** Runs `fn` as one mutation of the local backend over the replica without changing it (a handler's helpers). */
export async function captureRun(store: SpaceReplicaStore, deviceId: string, fn: (ctx: LocalMutationCtx) => Promise<unknown>): Promise<Captured> {
  return await captureWith(store, deviceId, (backend) => backend.run(fn));
}

async function captureWith(store: SpaceReplicaStore, deviceId: string, go: (backend: LocalBackend) => Promise<unknown>): Promise<Captured> {
  const scratch = new ScratchStore(store);
  const backend = new LocalBackend(scratch, { deviceId });
  try {
    const result = await go(backend);
    await backend.idle();
    const last = new Map<string, StoreWrite>();
    for (const w of scratch.writes) last.set(`${w.table}\u0000${w.partition ?? ""}\u0000${w.id}`, w);
    const writes: Captured["writes"] = [];
    for (const w of last.values()) writes.push({ w, before: await store.get(w.table, w.id, w.partition) });
    return { result, writes };
  } finally {
    await backend.close();
  }
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function wire(b: LocalBlock): WireBlock {
  return { id: b.id, type: b.type, parentId: b.parentId, rank: b.rank, schemaVersion: b.schemaVersion, text: b.text, props: b.props };
}

/** A create op that carries the sealed meta it needs (a collection row's values): read by the transport. */
export type CreateWithMeta = WireDocumentCreate & { e2eeMeta?: DocumentMeta };

/** The calls a capture stands for, in the order they must happen. */
export interface Projection {
  ops: SyncOp[];
  /** Mutations after the ops reached the server (records, tags, row metas, trash). */
  after: { ref: Parameters<RouterEnv["inner"]["mutation"]>[0]; args: Record<string, unknown> }[];
  createdDocuments: string[];
}

const opId = () => ulid();

/** Turns captured row writes into sync ops and sealed calls (see the file comment). */
export async function project(c: Captured, space: E2eeSpace, env: RouterEnv): Promise<Projection> {
  const ops: SyncOp[] = [];
  const after: Projection["after"] = [];
  const createdDocuments: string[] = [];
  const scope: WireScope = space.scope;
  const docs = c.writes.filter((x) => x.w.table === "documents");
  const blocks = c.writes.filter((x) => x.w.table === "blocks");
  for (const { w, before } of docs) {
    const next = w.value as LocalDocument | null;
    const prev = before as LocalDocument | undefined;
    if (!next) {
      if (prev) after.push({ ref: api.documents.deletePermanently, args: { documentId: w.id, confirmTitle: "sealed" } });
      continue;
    }
    if (!prev) {
      const create: CreateWithMeta = {
        id: next.id,
        parentDocumentId: next.parentDocumentId,
        folderId: next.folderId,
        kind: next.kind,
        title: next.title,
        icon: next.icon,
        style: next.style,
        cover: next.cover,
        dailyDate: next.dailyDate,
        collectionId: next.collectionId,
        scope,
      };
      if (next.row || next.templateKey) create.e2eeMeta = { ...(next.templateKey ? { templateKey: next.templateKey } : {}), ...(next.row ? { row: { collectionId: next.row.collectionId, rank: next.row.rank, values: next.row.values } } : {}) };
      ops.push({ opId: opId(), kind: "document.create", document: create });
      createdDocuments.push(next.id);
      if (next.tagIds.length) after.push({ ref: content.setDocumentTags, args: { documentId: next.id, tagIds: next.tagIds } });
      continue;
    }
    const patch: Record<string, unknown> = {};
    if (next.title !== prev.title) patch.title = next.title;
    if (next.icon !== prev.icon) patch.icon = next.icon;
    if (!sameJson(next.cover, prev.cover)) patch.cover = next.cover;
    if (!sameJson(next.style, prev.style)) patch.style = next.style;
    if (next.folderId !== prev.folderId) patch.folderId = next.folderId;
    if (next.parentDocumentId !== prev.parentDocumentId) patch.parentDocumentId = next.parentDocumentId;
    if (Object.keys(patch).length) ops.push({ opId: opId(), kind: "document.update", documentId: next.id, patch, baseRevision: prev.revision });
    if (!sameJson(next.row ?? null, prev.row ?? null) || next.templateKey !== prev.templateKey) {
      const meta: DocumentMeta = { ...(next.templateKey ? { templateKey: next.templateKey } : {}), ...(next.row ? { row: { collectionId: next.row.collectionId, rank: next.row.rank, values: next.row.values } } : {}) };
      after.push({ ref: content.setDocumentRowMeta, args: { documentId: next.id, sealedMeta: await env.sealer.sealMeta(next.id, meta) } });
    }
    if (!sameJson(next.tagIds, prev.tagIds)) after.push({ ref: content.setDocumentTags, args: { documentId: next.id, tagIds: next.tagIds } });
    if (next.inTrash !== prev.inTrash) after.push({ ref: next.inTrash ? api.documents.moveToTrash : api.documents.restoreFromTrash, args: { documentId: next.id } });
    if ((next.archivedAt === null) !== (prev.archivedAt === null)) after.push({ ref: api.documents.setArchived, args: { documentId: next.id, archived: next.archivedAt !== null } });
  }
  for (const { w, before } of blocks) {
    const documentId = w.partition!;
    const next = w.value as LocalBlock | null;
    const prev = before as LocalBlock | undefined;
    if (!next || next.deletedAt !== null) {
      if (prev && prev.deletedAt === null) ops.push({ opId: opId(), kind: "block.delete", documentId, blockId: w.id, baseRevision: prev.revision });
      continue;
    }
    if (prev && prev.deletedAt !== null) ops.push({ opId: opId(), kind: "block.restore", documentId, blockId: w.id });
    if (prev && prev.deletedAt === null && sameJson(wire(prev), wire(next))) continue;
    const contentChanged = !prev || prev.type !== next.type || !sameJson(prev.text, next.text) || !sameJson(prev.props, next.props);
    const moved = !prev || prev.parentId !== next.parentId || prev.rank !== next.rank;
    const fields: ("content" | "position")[] = [...(contentChanged ? (["content"] as const) : []), ...(moved ? (["position"] as const) : [])];
    ops.push({ opId: opId(), kind: "block.upsert", documentId, block: wire(next), baseRevision: prev?.revision ?? null, fields: fields.length ? fields : ["content", "position"] });
  }
  for (const { w } of c.writes) {
    if (w.table === "collections") {
      const rev = ((await storeMeta(env, scope, `record:collection:${w.id}`)) as { rev?: number } | undefined)?.rev ?? 0;
      if (w.value === null) after.push({ ref: content.deleteRecord, args: { scope, kind: "collection", recordId: w.id, baseRev: rev } });
      else {
        const value = w.value as LocalTables["collections"];
        const sealed = await env.sealer.sealRecordValue({ documentId: value.documentId }, space.scopeId, "collection", w.id, value);
        after.push({ ref: content.putRecord, args: { scope, kind: "collection", recordId: w.id, documentId: value.documentId, sealed: sealed.sealed, keyVersion: sealed.keyVersion, baseRev: rev } });
      }
    } else if (w.table === "fileTexts" || w.table === "studyReviews") {
      const kind = w.table === "fileTexts" ? "fileText" : "studyReview";
      const documentId = w.partition!;
      const rev = ((await storeMeta(env, scope, `record:${kind}:${w.id}`)) as { rev?: number } | undefined)?.rev ?? 0;
      if (w.value === null) after.push({ ref: content.deleteRecord, args: { scope, kind, recordId: w.id, documentId, baseRev: rev } });
      else {
        const sealed = await env.sealer.sealRecordValue({ documentId }, space.scopeId, kind, w.id, w.value);
        after.push({ ref: content.putRecord, args: { scope, kind, recordId: w.id, documentId, sealed: sealed.sealed, keyVersion: sealed.keyVersion, baseRev: rev } });
      }
    }
  }
  return { ops, after, createdDocuments };
}

async function storeMeta(env: RouterEnv, scope: WireScope, key: string): Promise<unknown> {
  const store = env.replicas.hostedStore?.(scope) ?? null;
  return store ? await store.get("meta", key) : undefined;
}

/** Sends a projection: the ops (through the engine when there is one, else straight), then the rest in order. */
export async function send(p: Projection, space: E2eeSpace, env: RouterEnv): Promise<void> {
  const engine = env.engine();
  if (p.ops.length) {
    if (engine) {
      for (const op of p.ops) {
        if (op.kind === "document.create") engine.createDocument(op.document);
        else if (op.kind === "document.update") engine.updateDocument(op.documentId, op.patch, op.baseRevision);
        else if (op.kind === "block.upsert") engine.upsertBlock(op.documentId, op.block, op.fields, op.baseRevision);
        else if (op.kind === "block.delete") engine.deleteBlock(op.documentId, op.blockId, op.baseRevision);
        else engine.restoreBlock(op.documentId, op.blockId);
      }
      if (p.after.length) {
        await engine.flush();
        for (const id of p.createdDocuments) await engine.whenDocumentOnServer(id);
      }
    } else {
      const results = await env.push(space.scope, p.ops);
      const refused = results.find((r) => r.status === "rejected");
      if (refused) throw new ConvexError({ code: refused.error?.code ?? "rejected", message: refused.error?.message ?? "This change couldn't be saved." });
    }
  }
  for (const call of p.after) await env.inner.mutation(call.ref, call.args);
}

/** The hosted replica's store for a space, or the error a composer gives without one. */
export function replicaStoreFor(env: RouterEnv, space: E2eeSpace): SpaceReplicaStore {
  const store = env.replicas.hostedStore?.(space.scope) ?? null;
  if (!store) throw new ConvexError({ code: "e2ee_unavailable", message: "This encrypted space is still opening on this device. Try again in a moment.", feature: "compose" });
  return store;
}
