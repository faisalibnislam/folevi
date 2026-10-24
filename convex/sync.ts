import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { SyncOp } from "@folevi/editor-schema";
import { assertWritable, requireProfile, resolveScope, documentAccess, accessAtLeast, getDocumentByPublicId, membership, PageReader } from "./lib/auth";
import { folderSubtree } from "./folderSharing";
import { consume } from "./lib/rateLimit";
import { fail } from "./lib/errors";
import { SyncEngine, MAX_BATCH } from "./lib/syncEngine";
import { IdResolver, liveBlocks, Placement, toWireBlock } from "./lib/documents";
import { sealedFieldsOf } from "./lib/e2ee/sealedRows";
import { ReaderLabels } from "./lib/linkLabels";
import { vSyncOp } from "./lib/validators";
import { headSeq } from "./lib/seq";
import { vScopeArg, type Scope, type ScopeArg } from "./lib/scope";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

const vDeviceId = v.string();

function checkDevice(deviceId: string) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) fail("invalid_argument", "Invalid device id.");
}

/**
 * Applies a batch of offline-capable operations. See docs/SYNC_PROTOCOL.md. `scope` is where a new page
 * without a parent goes (the caller's Personal or a workspace they belong to); every op is authorized
 * against the document it touches.
 */
export const push = mutation({
  args: { scope: vScopeArg, deviceId: vDeviceId, ops: v.array(vSyncOp) },
  handler: async (ctx, args) => {
    checkDevice(args.deviceId);
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    await consume(ctx, "syncBatch", profile._id);
    const engine = new SyncEngine(ctx, profile, args.deviceId);
    return await engine.applyAll(args.scope, args.ops as SyncOp[]);
  },
});

/**
 * JSON-string variant used by the native client: the payload is decoded and validated server-side so
 * Swift never has to match Convex's int64/float64 wire encoding for canonical block data.
 */
export const pushJson = mutation({
  args: { scope: vScopeArg, deviceId: vDeviceId, payload: v.string() },
  handler: async (ctx, args) => {
    checkDevice(args.deviceId);
    if (args.payload.length > 4_000_000) fail("limit_exceeded", "Batch too large.");
    let ops: unknown;
    try {
      ops = JSON.parse(args.payload);
    } catch {
      fail("invalid_argument", "Malformed payload.");
    }
    if (!Array.isArray(ops) || ops.length > MAX_BATCH) fail("invalid_argument", "Expected an array of operations.");
    for (const op of ops) {
      if (!op || typeof op !== "object" || typeof (op as { kind?: unknown }).kind !== "string") fail("invalid_argument", "Malformed operation.");
    }
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    await consume(ctx, "syncBatch", profile._id);
    const engine = new SyncEngine(ctx, profile, args.deviceId);
    const results = await engine.applyAll(args.scope, ops as SyncOp[]);
    return JSON.stringify(results);
  },
});

/** The scope's change counter. Native clients subscribe to this and pull when it advances. */
export const head = query({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    return { seq: await headSeq(ctx, scope) };
  },
});

async function docStream(ctx: QueryCtx, scope: Scope, cursor: number, cap: number) {
  const page = (after: number) => {
    const base = ctx.db.query("documents");
    return scope.kind === "personal"
      ? base.withIndex("by_owner_seq", (q) => q.eq("ownerProfileId", scope.profileId).gt("seq", after))
      : base.withIndex("by_workspace_seq", (q) => q.eq("workspaceId", scope.workspaceId).gt("seq", after));
  };
  const exactly = (seq: number) => {
    const base = ctx.db.query("documents");
    return scope.kind === "personal"
      ? base.withIndex("by_owner_seq", (q) => q.eq("ownerProfileId", scope.profileId).eq("seq", seq))
      : base.withIndex("by_workspace_seq", (q) => q.eq("workspaceId", scope.workspaceId).eq("seq", seq));
  };
  const rows = await page(cursor).take(cap);
  if (rows.length < cap) return { rows, upTo: Infinity };
  // The page may split the rows of its last seq; load that seq completely (bounded by one mutation's writes).
  const boundary = rows[rows.length - 1]!.seq;
  const rest = await exactly(boundary).collect();
  return { rows: [...rows.filter((r) => r.seq < boundary), ...rest], upTo: boundary };
}

async function blockStream(ctx: QueryCtx, scope: Scope, cursor: number, cap: number) {
  const page = (after: number) => {
    const base = ctx.db.query("blocks");
    return scope.kind === "personal"
      ? base.withIndex("by_owner_seq", (q) => q.eq("ownerProfileId", scope.profileId).gt("seq", after))
      : base.withIndex("by_workspace_seq", (q) => q.eq("workspaceId", scope.workspaceId).gt("seq", after));
  };
  const exactly = (seq: number) => {
    const base = ctx.db.query("blocks");
    return scope.kind === "personal"
      ? base.withIndex("by_owner_seq", (q) => q.eq("ownerProfileId", scope.profileId).eq("seq", seq))
      : base.withIndex("by_workspace_seq", (q) => q.eq("workspaceId", scope.workspaceId).eq("seq", seq));
  };
  const rows = await page(cursor).take(cap);
  if (rows.length < cap) return { rows, upTo: Infinity };
  const boundary = rows[rows.length - 1]!.seq;
  const rest = await exactly(boundary).collect();
  return { rows: [...rows.filter((r) => r.seq < boundary), ...rest], upTo: boundary };
}

async function pullRows(ctx: QueryCtx, profile: Doc<"profiles">, arg: ScopeArg, cursor: number, limit: number) {
  const { scope } = await resolveScope(ctx, profile, arg);
  const head = await headSeq(ctx, scope);
  const cap = Math.max(1, Math.min(limit, 500));
  const docs = await docStream(ctx, scope, cursor, cap);
  const blocks = await blockStream(ctx, scope, cursor, cap);
  let upTo = Math.min(docs.upTo, blocks.upTo);
  const hasMore = upTo !== Infinity;
  if (!hasMore) upTo = head;
  const ids = new IdResolver(ctx);
  const access = new Map<Id<"documents">, boolean>();
  const canRead = async (doc: Doc<"documents">) => {
    if (!access.has(doc._id)) access.set(doc._id, accessAtLeast(await documentAccess(ctx, profile, doc), "read"));
    return access.get(doc._id)!;
  };
  // No parent page id the caller can't open (a page granted on its own under a restricted page).
  const place = new Placement(ctx, profile);
  const outDocs = [];
  for (const d of docs.rows) {
    if (d.seq > upTo) continue;
    if (!(await canRead(d))) continue;
    outDocs.push(await place.summary(ids, d));
  }
  const outBlocks = [];
  const docCache = new Map<Id<"documents">, Doc<"documents"> | null>();
  // Links to other pages carry their current title only when this person can open them.
  const labels = new ReaderLabels(ctx, profile);
  for (const b of blocks.rows) {
    if (b.seq > upTo) continue;
    if (!docCache.has(b.documentId)) docCache.set(b.documentId, await ctx.db.get(b.documentId));
    const d = docCache.get(b.documentId);
    if (!d || !(await canRead(d))) continue;
    outBlocks.push({ documentId: d.publicId, block: await labels.block(toWireBlock(b)), deleted: b.deletedAt !== undefined });
  }
  return { documents: outDocs, blocks: outBlocks, nextCursor: upTo, hasMore, head };
}

/** Rows of a scope changed since `cursor` (documents and blocks, tombstones included). */
export const pull = query({
  args: { scope: vScopeArg, cursor: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    return await pullRows(ctx, profile, args.scope, args.cursor, args.limit ?? 300);
  },
});

export const pullJson = query({
  args: { scope: vScopeArg, cursor: v.float64(), limit: v.optional(v.float64()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    return JSON.stringify(await pullRows(ctx, profile, args.scope, args.cursor, args.limit ?? 300));
  },
});

// ---------------------------------------------------------------------------------------------------------
// The device copy (docs/NATIVE_APP_PLAN.md §11, R1): every note of a place kept on each device, opened from
// there first. Three reads, all bounded and permission-checked like `pull`:
//
//   manifest   the notes of a scope (summaries and content counters) a page at a time in seq order, for the
//              first fill and the weekly re-check; it reads no blocks
//   pullDocs   the whole content of up to 50 notes (any scope the caller can open: shared pages too), as
//              blocks.list returns it
//   pullAll    pull v2: everything of a scope changed since a cursor (notes, blocks, folders, tags and the
//              notes deleted for good), for keeping the copy fresh
//
// Notes sealed by end-to-end encryption (or locked) never travel here with content: their space's own replica
// (e2ee.pull) keeps them, encrypted at rest. The older `pull` and `pullJson` keep working unchanged.

/** A note sealed by end-to-end encryption, or locked ("Always fully encrypted"): left to its replica. */
function isSealedNote(d: Doc<"documents">): boolean {
  return d.sealedAt !== undefined || sealedFieldsOf(d) !== undefined || d.locked === true || d.lockedVia !== undefined;
}

const MANIFEST_MAX = 500;

/**
 * The highest seq among a note's block rows, deleted ones included (one indexed read): every change to its
 * content moves it, so a device's copy holding blocks up to this seq is whole. (The note's `contentSeq` only
 * settles every half minute while someone types, lib/editSettle.ts, so it can't say that.)
 */
async function contentHead(ctx: QueryCtx, documentId: Id<"documents">): Promise<number> {
  const last = await ctx.db
    .query("blocks")
    .withIndex("by_document_seq", (q) => q.eq("documentId", documentId))
    .order("desc")
    .first();
  return last?.seq ?? 0;
}

/**
 * The notes of a scope the caller can open, in seq order from `after` (0 to start), each with its summary and
 * its content head (contentHead). `next` is the `after` of the following page, or null after the last; `head`
 * is the scope's change counter when this page was read (the first page's head is where keeping the copy fresh
 * starts). Sealed notes come as ids only (`sealed: true`), so a device can tell a note it shouldn't keep from
 * one that's gone.
 */
export const manifest = query({
  args: { scope: vScopeArg, after: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    const head = await headSeq(ctx, scope);
    const cap = Math.max(1, Math.min(Math.floor(args.limit ?? 300), MANIFEST_MAX));
    const docs = await docStream(ctx, scope, Math.max(0, args.after), cap);
    const ids = new IdResolver(ctx);
    const place = new Placement(ctx, profile);
    const notes: { id: string; head: number; sealed: boolean; summary: Awaited<ReturnType<Placement["summary"]>> | null }[] = [];
    for (const d of docs.rows) {
      if (!accessAtLeast(await documentAccess(ctx, profile, d), "read")) continue;
      if (isSealedNote(d)) notes.push({ id: d.publicId, head: 0, sealed: true, summary: null });
      else notes.push({ id: d.publicId, head: await contentHead(ctx, d._id), sealed: false, summary: await place.summary(ids, d) });
    }
    return { notes, next: docs.upTo === Infinity ? null : docs.upTo, head };
  },
});

const PULL_DOCS_MAX = 50;
/** Blocks one pullDocs call reads before it leaves the remaining notes for the next call. */
const PULL_DOCS_BLOCKS = 3000;

/**
 * The whole content of each note named, as blocks.list has it, with its summary and content head. `status`:
 * "ok"; "missing" (gone, or the caller can't open it); "sealed" (end-to-end encrypted or locked: its replica
 * keeps it); "later" (this call read enough; ask again). The first note always comes, however long.
 */
export const pullDocs = query({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    if (args.ids.length > PULL_DOCS_MAX) fail("invalid_argument", `At most ${PULL_DOCS_MAX} notes at a time.`);
    const profile = await requireProfile(ctx);
    const ids = new IdResolver(ctx);
    const place = new Placement(ctx, profile);
    const labels = new ReaderLabels(ctx, profile);
    let budget = PULL_DOCS_BLOCKS;
    const notes = [];
    for (const id of [...new Set(args.ids)]) {
      if (budget <= 0) {
        notes.push({ id, status: "later" as const });
        continue;
      }
      const doc = await getDocumentByPublicId(ctx, id);
      if (!doc || !accessAtLeast(await documentAccess(ctx, profile, doc), "read")) {
        notes.push({ id, status: "missing" as const });
        continue;
      }
      if (isSealedNote(doc)) {
        notes.push({ id, status: "sealed" as const });
        continue;
      }
      const rows = await liveBlocks(ctx, doc._id);
      budget -= Math.max(1, rows.length);
      const blocks = await labels.blocks(rows.map(toWireBlock));
      notes.push({ id, status: "ok" as const, summary: await place.summary(ids, doc), revision: doc.revision, contentSeq: doc.contentSeq, head: await contentHead(ctx, doc._id), blocks });
    }
    return { notes };
  },
});

type SeqRow = { seq: number };

/** Rows of a scope-partitioned table with seq > cursor (the `by_*_seq` indexes), never splitting one seq. */
async function seqRows<T extends "folders" | "tags" | "e2eeTombstones">(ctx: QueryCtx, table: T, scope: Scope, cursor: number, cap: number): Promise<{ rows: Doc<T>[]; upTo: number }> {
  type Q = { withIndex(name: string, f: (q: { eq(f: string, v: unknown): { gt(f: string, v: number): unknown; eq(f: string, v: unknown): unknown } }) => unknown): { take(n: number): Promise<Doc<T>[]>; collect(): Promise<Doc<T>[]> } };
  const base = () => ctx.db.query(table) as unknown as Q;
  const page = (after: number) =>
    scope.kind === "personal"
      ? base().withIndex("by_owner_seq", (q) => q.eq("ownerProfileId", scope.profileId).gt("seq", after))
      : base().withIndex("by_workspace_seq", (q) => q.eq("workspaceId", scope.workspaceId).gt("seq", after));
  const exactly = (seq: number) =>
    scope.kind === "personal"
      ? base().withIndex("by_owner_seq", (q) => q.eq("ownerProfileId", scope.profileId).eq("seq", seq))
      : base().withIndex("by_workspace_seq", (q) => q.eq("workspaceId", scope.workspaceId).eq("seq", seq));
  const rows = await page(cursor).take(cap);
  if (rows.length < cap) return { rows, upTo: Infinity };
  const boundary = (rows[rows.length - 1] as unknown as SeqRow).seq;
  const rest = await exactly(boundary).collect();
  return { rows: [...rows.filter((r) => (r as unknown as SeqRow).seq < boundary), ...rest], upTo: boundary };
}

/**
 * Pull v2: what changed in a scope since `cursor`, as `pull` returns it plus each block row's `seq` (a device's
 * copy of a note is whole up to the highest one it has taken in, compared with the manifest's `head`), the
 * scope's folders and tags, and `removed`: notes,
 * folders and tags deleted for good. Sealed notes come without content (`sealed: true` on their row and none
 * of their blocks). Pages never split one change; `hasMore` asks for the next page at once.
 */
export const pullAll = query({
  args: { scope: vScopeArg, cursor: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const standing = await resolveScope(ctx, profile, args.scope);
    const { scope } = standing;
    const head = await headSeq(ctx, scope);
    const cap = Math.max(1, Math.min(Math.floor(args.limit ?? 300), 500));
    const cursor = Math.max(0, args.cursor);
    const docs = await docStream(ctx, scope, cursor, cap);
    const blocks = await blockStream(ctx, scope, cursor, cap);
    const folders = await seqRows(ctx, "folders", scope, cursor, cap);
    const tags = await seqRows(ctx, "tags", scope, cursor, cap);
    const tombstones = await seqRows(ctx, "e2eeTombstones", scope, cursor, cap);
    let upTo = Math.min(docs.upTo, blocks.upTo, folders.upTo, tags.upTo, tombstones.upTo);
    const hasMore = upTo !== Infinity;
    if (!hasMore) upTo = Math.max(head, cursor);

    const ids = new IdResolver(ctx);
    const place = new Placement(ctx, profile);
    const docCache = new Map<Id<"documents">, Doc<"documents"> | null>();
    const access = new Map<Id<"documents">, boolean>();
    const canRead = async (d: Doc<"documents">) => {
      if (!access.has(d._id)) access.set(d._id, accessAtLeast(await documentAccess(ctx, profile, d), "read"));
      return access.get(d._id)!;
    };
    const outDocs = [];
    for (const d of docs.rows) {
      if (d.seq > upTo || !(await canRead(d))) continue;
      docCache.set(d._id, d);
      if (isSealedNote(d)) outDocs.push({ id: d.publicId, sealed: true as const, summary: null });
      else outDocs.push({ id: d.publicId, sealed: false as const, summary: await place.summary(ids, d) });
    }
    const labels = new ReaderLabels(ctx, profile);
    const outBlocks = [];
    for (const b of blocks.rows) {
      if (b.seq > upTo) continue;
      if (!docCache.has(b.documentId)) docCache.set(b.documentId, await ctx.db.get(b.documentId));
      const d = docCache.get(b.documentId);
      if (!d || isSealedNote(d) || !(await canRead(d))) continue;
      outBlocks.push({ documentId: d.publicId, block: await labels.block(toWireBlock(b)), deleted: b.deletedAt !== undefined, seq: b.seq });
    }
    const folderIds = new IdResolver(ctx);
    const outFolders = [];
    for (const f of folders.rows) {
      if (f.seq > upTo) continue;
      outFolders.push({
        id: f.publicId,
        parentFolderId: await folderIds.folder(f.parentFolderId),
        rank: f.rank,
        color: f.color ?? null,
        name: f.sealedName ? "" : f.name,
        sealed: f.sealedName !== undefined,
        locked: f.locked === true,
        updatedAt: f.updatedAt,
        deletedAt: f.deletedAt ?? null,
      });
    }
    const outTags = tags.rows.filter((t) => t.seq <= upTo).map((t) => ({ id: t.publicId, name: t.sealedName ? "" : t.name, sealed: t.sealedName !== undefined, color: t.color }));
    // A restricted page's id goes only to people who open everything in the scope (as e2ee.pull's `removed`).
    const reader = new PageReader(ctx, profile, standing);
    const removed = tombstones.rows.filter((r) => r.seq <= upTo && (!r.restricted || reader.opensEverything)).map((r) => ({ kind: r.kind, id: r.publicId }));
    return { documents: outDocs, blocks: outBlocks, folders: outFolders, tags: outTags, removed, nextCursor: upTo, hasMore, head };
  },
});

// ---------------------------------------------------------------------------------------------------------
// Shared with the caller (docs/SHARING.md): the device copy also keeps the notes people shared with this
// person outside their own places, pages shared on their own (with the pages under them) and every note in a
// folder shared with them (its subfolders too). They have no scope of their own to stream, so the copy lists
// them whole (sharedManifest), keeps what's listed and drops the rest (a share that was revoked, a note moved
// out of a shared folder); sharedHead moves whenever that list could have changed, so it lists again.

const SHARED_MAX = 1000;
const SHARED_WALK = 2000;

/** The notes shared with `profile` outside their own places: candidates only (access is checked by the caller). */
async function sharedCandidates(ctx: QueryCtx, profile: Doc<"profiles">): Promise<{ docs: Doc<"documents">[]; folders: Doc<"folders">[]; pageGrants: Doc<"documentPermissions">[]; folderGrants: Doc<"folderPermissions">[] }> {
  const pageGrants = await ctx.db
    .query("documentPermissions")
    .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
    .take(500);
  const folderGrants = await ctx.db
    .query("folderPermissions")
    .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
    .take(200);
  const seen = new Set<string>();
  const docs: Doc<"documents">[] = [];
  const add = (d: Doc<"documents"> | null) => {
    if (!d || seen.has(d._id) || docs.length >= SHARED_WALK) return;
    seen.add(d._id);
    docs.push(d);
  };
  for (const g of pageGrants) add(await ctx.db.get(g.documentId));
  const folders: Doc<"folders">[] = [];
  for (const g of folderGrants) {
    const root = await ctx.db.get(g.folderId);
    if (!root || root.deletedAt !== undefined) continue;
    for (const f of await folderSubtree(ctx, root)) {
      if (folders.some((x) => x._id === f._id)) continue;
      folders.push(f);
      for (const d of await ctx.db
        .query("documents")
        .withIndex("by_folder", (q) => q.eq("folderId", f._id))
        .take(SHARED_WALK)) {
        add(d);
      }
    }
  }
  // The pages under each of them (a grant and a folder both reach nested pages).
  for (let i = 0; i < docs.length && docs.length < SHARED_WALK; i++) {
    for (const kid of await ctx.db
      .query("documents")
      .withIndex("by_parent", (q) => q.eq("parentDocumentId", docs[i]!._id))
      .take(200)) {
      add(kid);
    }
  }
  return { docs, folders, pageGrants, folderGrants };
}

/** Whether a row is in one of the caller's own places (their Personal, a workspace they're a member of). */
function ownPlaces(ctx: QueryCtx, profile: Doc<"profiles">) {
  const members = new Map<string, boolean>();
  return async (row: { ownerProfileId?: Id<"profiles">; workspaceId?: Id<"workspaces"> }) => {
    if (row.ownerProfileId !== undefined) return row.ownerProfileId === profile._id;
    if (row.workspaceId === undefined) return false;
    let m = members.get(row.workspaceId);
    if (m === undefined) {
      m = (await membership(ctx, profile._id, row.workspaceId)) !== null;
      members.set(row.workspaceId, m);
    }
    return m;
  };
}

/**
 * Every note shared with the caller outside their own places, as `manifest` lists a scope's: id, content head
 * and summary (sealed notes as ids only). `complete` is false when there were more than a device keeps.
 */
export const sharedManifest = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const { docs } = await sharedCandidates(ctx, profile);
    const mine = ownPlaces(ctx, profile);
    const ids = new IdResolver(ctx);
    const place = new Placement(ctx, profile);
    const notes: { id: string; head: number; sealed: boolean; summary: Awaited<ReturnType<Placement["summary"]>> | null }[] = [];
    let complete = true;
    for (const d of docs) {
      if (d.inTrash || d.kind === "synced" || (await mine(d))) continue;
      if (!accessAtLeast(await documentAccess(ctx, profile, d), "read")) continue;
      if (notes.length >= SHARED_MAX) {
        complete = false;
        break;
      }
      if (isSealedNote(d)) notes.push({ id: d.publicId, head: 0, sealed: true, summary: null });
      else notes.push({ id: d.publicId, head: await contentHead(ctx, d._id), sealed: false, summary: await place.summary(ids, d) });
    }
    return { notes, complete };
  },
});

/** A small fingerprint (FNV-1a) of what decides the shared list, so the device copy knows when to list it again. */
function fingerprint(parts: string[]): string {
  let h = 0x811c9dc5;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      h ^= part.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x2c;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${parts.length}:${h.toString(36)}`;
}

/**
 * Moves whenever the notes shared with the caller could have changed: a page or folder shared, changed or
 * revoked, a note added to, moved out of or removed from a shared folder. Subscribed to while the app is open.
 */
export const sharedHead = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const { docs, folders, pageGrants, folderGrants } = await sharedCandidates(ctx, profile);
    const parts = [
      ...pageGrants.map((g) => `p${g._id}${g.role}`),
      ...folderGrants.map((g) => `f${g._id}${g.role}`),
      ...folders.map((f) => `d${f._id}${f.parentFolderId ?? ""}`),
      ...docs.map((d) => `n${d._id}${d.inTrash ? 1 : 0}${d.folderId ?? ""}${d.accessMode}${d.sealedAt ?? ""}`),
    ];
    return { key: fingerprint(parts) };
  },
});
