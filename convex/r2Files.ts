// Files on Cloudflare R2, first stage (docs/PRICING_PROPOSAL.md, section 5; lib/r2.ts). Uploads still land in
// Convex storage exactly as before; each stored blob is then copied to R2 once (`r2Blobs` records the
// verified copy), and the /files/ route sends downloads to a short-lived R2 link, so Convex no longer serves
// the bytes. Convex keeps its copy for now, so everything that reads files on the server works unchanged;
// when a Convex blob is deleted (anywhere), the daily sweep deletes its R2 copy.
//
// Off until R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are set. Then run
// `r2Files:backfill` once to copy existing files; new uploads are copied as they're committed.
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { r2Config, r2Delete, r2KeyFor, r2Put, r2Size } from "./lib/r2";

/** Schedules the R2 copy of a newly stored blob, when R2 is set up. */
export async function scheduleR2Copy(ctx: MutationCtx, storageId: Id<"_storage">): Promise<void> {
  if (r2Config()) await ctx.scheduler.runAfter(0, internal.r2Files.copy, { storageId });
}

/** The R2 key of a blob's verified copy, or null (not copied, or R2 is off). */
export const keyFor = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<string | null> => {
    if (!r2Config()) return null;
    const row = await ctx.db
      .query("r2Blobs")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .unique();
    return row?.key ?? null;
  },
});

export const recorded = internalMutation({
  args: { storageId: v.id("_storage"), key: v.string(), size: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("r2Blobs")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .unique();
    if (existing) return;
    await ctx.db.insert("r2Blobs", { storageId: args.storageId, key: args.key, size: args.size, copiedAt: Date.now() });
  },
});

/** Copies one Convex blob to R2 and records it once R2 reports the same size. Safe to run twice. */
export const copy = internalAction({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const config = r2Config();
    if (!config) return { copied: false };
    if (await ctx.runQuery(internal.r2Files.keyFor, { storageId: args.storageId })) return { copied: false };
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) return { copied: false };
    const key = r2KeyFor(args.storageId);
    await r2Put(config, key, new Uint8Array(await blob.arrayBuffer()), blob.type || "application/octet-stream");
    const size = await r2Size(config, key);
    if (size !== blob.size) throw new Error(`R2 copy of ${args.storageId} has ${size} bytes, expected ${blob.size}`);
    await ctx.runMutation(internal.r2Files.recorded, { storageId: args.storageId, key, size });
    return { copied: true };
  },
});

/** Copies every existing file's bytes to R2, a page at a time (run once after R2 is set up). */
export const backfill = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    if (!r2Config()) return { scheduled: 0, done: true, note: "R2 isn't set up on this deployment." };
    const page = await ctx.db.query("files").paginate({ cursor: args.cursor ?? null, numItems: 100 });
    const seen = new Set<string>();
    let scheduled = 0;
    for (const f of page.page) {
      if (f.status !== "ready" || seen.has(f.storageId)) continue;
      seen.add(f.storageId);
      const done = await ctx.db
        .query("r2Blobs")
        .withIndex("by_storage", (q) => q.eq("storageId", f.storageId))
        .unique();
      if (done) continue;
      // Spread out so a big library doesn't start hundreds of copies at once.
      await ctx.scheduler.runAfter(scheduled * 200, internal.r2Files.copy, { storageId: f.storageId });
      scheduled++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(scheduled * 200, internal.r2Files.backfill, { cursor: page.continueCursor });
    return { scheduled, done: page.isDone };
  },
});

/** A page of R2 copies whose Convex blob is gone. */
export const orphans = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("r2Blobs").paginate({ cursor: args.cursor, numItems: 100 });
    const gone: { id: Id<"r2Blobs">; key: string }[] = [];
    for (const r of page.page) if (!(await ctx.db.system.get(r.storageId))) gone.push({ id: r._id, key: r.key });
    return { gone, cursor: page.continueCursor, done: page.isDone };
  },
});

export const forget = internalMutation({
  args: { id: v.id("r2Blobs") },
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.id)) await ctx.db.delete(args.id);
  },
});

/** Daily: deletes the R2 copy of every blob Convex no longer has. */
export const sweep = internalAction({
  args: {},
  handler: async (ctx) => {
    const config = r2Config();
    if (!config) return { deleted: 0 };
    let cursor: string | null = null;
    let deleted = 0;
    for (let i = 0; i < 1000; i++) {
      const page: { gone: { id: Id<"r2Blobs">; key: string }[]; cursor: string; done: boolean } = await ctx.runQuery(internal.r2Files.orphans, { cursor });
      for (const g of page.gone) {
        await r2Delete(config, g.key);
        await ctx.runMutation(internal.r2Files.forget, { id: g.id });
        deleted++;
      }
      if (page.done) break;
      cursor = page.cursor;
    }
    if (deleted) console.log(JSON.stringify({ event: "r2.orphans_swept", deleted }));
    return { deleted };
  },
});
