import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { SyncOp } from "@folevi/editor-schema";
import { assertWritable, requireProfile, resolveScope, documentAccess, accessAtLeast } from "./lib/auth";
import { consume } from "./lib/rateLimit";
import { fail } from "./lib/errors";
import { SyncEngine, MAX_BATCH } from "./lib/syncEngine";
import { IdResolver, Placement, toWireBlock } from "./lib/documents";
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
