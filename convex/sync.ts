import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { SyncOp } from "@folevi/editor-schema";
import { assertWritable, requireProfile, requireWorkspace, documentAccess, accessAtLeast } from "./lib/auth";
import { consume } from "./lib/rateLimit";
import { fail } from "./lib/errors";
import { SyncEngine, MAX_BATCH } from "./lib/syncEngine";
import { IdResolver, toSummary, toWireBlock } from "./lib/documents";
import { vSyncOp } from "./lib/validators";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

const vDeviceId = v.string();

function checkDevice(deviceId: string) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) fail("invalid_argument", "Invalid device id.");
}

/** Applies a batch of offline-capable operations. See docs/SYNC_PROTOCOL.md. */
export const push = mutation({
  args: { workspaceId: v.string(), deviceId: vDeviceId, ops: v.array(vSyncOp) },
  handler: async (ctx, args) => {
    checkDevice(args.deviceId);
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    await consume(ctx, "syncBatch", profile._id);
    const engine = new SyncEngine(ctx, profile, args.deviceId);
    return await engine.applyAll(args.workspaceId, args.ops as SyncOp[]);
  },
});

/**
 * JSON-string variant used by the native client: the payload is decoded and validated server-side so
 * Swift never has to match Convex's int64/float64 wire encoding for canonical block data.
 */
export const pushJson = mutation({
  args: { workspaceId: v.string(), deviceId: vDeviceId, payload: v.string() },
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
    const results = await engine.applyAll(args.workspaceId, ops as SyncOp[]);
    return JSON.stringify(results);
  },
});

/** The workspace change counter. Native clients subscribe to this and pull when it advances. */
export const head = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { workspace } = await requireWorkspace(ctx, profile, args.workspaceId);
    return { seq: workspace.changeSeq };
  },
});

async function docStream(ctx: QueryCtx, workspaceId: Id<"workspaces">, cursor: number, cap: number) {
  const rows = await ctx.db
    .query("documents")
    .withIndex("by_workspace_seq", (q) => q.eq("workspaceId", workspaceId).gt("seq", cursor))
    .take(cap);
  if (rows.length < cap) return { rows, upTo: Infinity };
  // The page may split the rows of its last seq; load that seq completely (bounded by one mutation's writes).
  const boundary = rows[rows.length - 1]!.seq;
  const rest = await ctx.db
    .query("documents")
    .withIndex("by_workspace_seq", (q) => q.eq("workspaceId", workspaceId).eq("seq", boundary))
    .collect();
  return { rows: [...rows.filter((r) => r.seq < boundary), ...rest], upTo: boundary };
}

async function blockStream(ctx: QueryCtx, workspaceId: Id<"workspaces">, cursor: number, cap: number) {
  const rows = await ctx.db
    .query("blocks")
    .withIndex("by_workspace_seq", (q) => q.eq("workspaceId", workspaceId).gt("seq", cursor))
    .take(cap);
  if (rows.length < cap) return { rows, upTo: Infinity };
  const boundary = rows[rows.length - 1]!.seq;
  const rest = await ctx.db
    .query("blocks")
    .withIndex("by_workspace_seq", (q) => q.eq("workspaceId", workspaceId).eq("seq", boundary))
    .collect();
  return { rows: [...rows.filter((r) => r.seq < boundary), ...rest], upTo: boundary };
}

async function pullRows(ctx: QueryCtx, profile: Doc<"profiles">, workspaceId: string, cursor: number, limit: number) {
  const { workspace } = await requireWorkspace(ctx, profile, workspaceId);
  const cap = Math.max(1, Math.min(limit, 500));
  const docs = await docStream(ctx, workspace._id, cursor, cap);
  const blocks = await blockStream(ctx, workspace._id, cursor, cap);
  let upTo = Math.min(docs.upTo, blocks.upTo);
  const hasMore = upTo !== Infinity;
  if (!hasMore) upTo = workspace.changeSeq;
  const ids = new IdResolver(ctx);
  const access = new Map<Id<"documents">, boolean>();
  const canRead = async (doc: Doc<"documents">) => {
    if (!access.has(doc._id)) access.set(doc._id, accessAtLeast(await documentAccess(ctx, profile, doc), "read"));
    return access.get(doc._id)!;
  };
  const outDocs = [];
  for (const d of docs.rows) {
    if (d.seq > upTo) continue;
    if (!(await canRead(d))) continue;
    outDocs.push(await toSummary(ids, d));
  }
  const outBlocks = [];
  const docCache = new Map<Id<"documents">, Doc<"documents"> | null>();
  for (const b of blocks.rows) {
    if (b.seq > upTo) continue;
    if (!docCache.has(b.documentId)) docCache.set(b.documentId, await ctx.db.get(b.documentId));
    const d = docCache.get(b.documentId);
    if (!d || !(await canRead(d))) continue;
    outBlocks.push({ documentId: d.publicId, block: toWireBlock(b), deleted: b.deletedAt !== undefined });
  }
  return { documents: outDocs, blocks: outBlocks, nextCursor: upTo, hasMore, head: workspace.changeSeq };
}

/** Rows changed since `cursor` (documents and blocks, tombstones included). */
export const pull = query({
  args: { workspaceId: v.string(), cursor: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    return await pullRows(ctx, profile, args.workspaceId, args.cursor, args.limit ?? 300);
  },
});

export const pullJson = query({
  args: { workspaceId: v.string(), cursor: v.float64(), limit: v.optional(v.float64()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    return JSON.stringify(await pullRows(ctx, profile, args.workspaceId, args.cursor, args.limit ?? 300));
  },
});
