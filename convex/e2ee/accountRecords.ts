// A person's own sealed records (docs/E2EE_DESIGN.md §3, "Account record"): sealed on a device with the account
// master key, kept here so their other devices can open them, never opened by the server. Today these are the
// person's own Foli AI keys (kind "aiKey", one record per provider and one for the provider and model in use:
// lib/ai/ownKey.ts on the client,
// convex/lib/ai/ownKey.ts for how a request uses one). Only the owner reads or writes their rows.
import { v } from "convex/values";
import { query } from "../_generated/server";
import { mutation } from "../lib/functions";
import type { Doc } from "../_generated/dataModel";
import { requireProfile } from "../lib/auth";
import { fail } from "../lib/errors";
import { consume } from "../lib/rateLimit";
import type { MutationCtx, QueryCtx } from "../_generated/server";

const vKind = v.literal("aiKey");
/** One record per provider, and "choice": which provider and model Foli AI uses (or none). */
const AI_KEY_RECORDS = new Set(["anthropic", "openai", "gemini", "choice"]);
/** A sealed key is small: the envelope, the key and its model. */
const MAX_SEALED = 4096;

async function activeEpoch(ctx: QueryCtx | MutationCtx, profileId: Doc<"profiles">["_id"]): Promise<number | null> {
  const rows = await ctx.db
    .query("e2eeAccounts")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .collect();
  const active = rows.filter((r) => r.status === "active").sort((a, b) => b.epoch - a.epoch)[0];
  return active ? active.epoch : null;
}

const rowOf = (ctx: QueryCtx | MutationCtx, profileId: Doc<"profiles">["_id"], kind: "aiKey", recordId: string) =>
  ctx.db
    .query("e2eeAccountRecords")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId).eq("kind", kind).eq("recordId", recordId))
    .unique();

/** The person's records of a kind, removed ones included (with no content), for their devices to apply. */
export const list = query({
  args: { kind: vKind },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const rows = await ctx.db
      .query("e2eeAccountRecords")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id).eq("kind", args.kind))
      .take(50);
    return rows.map((r) => ({ recordId: r.recordId, epoch: r.epoch, sealed: r.sealed ?? null, updatedAt: r.updatedAt, deletedAt: r.deletedAt ?? null }));
  },
});

/** Stores a sealed record (only for an account with encryption set up, under its current epoch). */
export const put = mutation({
  args: { kind: vKind, recordId: v.string(), epoch: v.number(), sealed: v.bytes() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!AI_KEY_RECORDS.has(args.recordId)) fail("invalid_argument", "Folevi doesn't keep that.");
    if (args.sealed.byteLength === 0 || args.sealed.byteLength > MAX_SEALED) fail("invalid_argument", "That record is too large.");
    const epoch = await activeEpoch(ctx, profile._id);
    if (epoch === null) fail("forbidden", "Encryption isn't set up for this account.");
    if (args.epoch !== epoch) fail("conflict", "Your encryption key changed. Unlock again and try again.");
    await consume(ctx, "e2eeAccountRecords", profile._id);
    const now = Date.now();
    const row = await rowOf(ctx, profile._id, args.kind, args.recordId);
    const fields = { epoch: args.epoch, sealed: args.sealed, updatedAt: now, deletedAt: undefined };
    if (row) await ctx.db.patch(row._id, fields);
    else await ctx.db.insert("e2eeAccountRecords", { profileId: profile._id, kind: args.kind, recordId: args.recordId, ...fields });
    return { updatedAt: now };
  },
});

/** Removes a record's content; the row stays (no content) so the person's other devices remove their copy. */
export const remove = mutation({
  args: { kind: vKind, recordId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const row = await rowOf(ctx, profile._id, args.kind, args.recordId);
    const now = Date.now();
    if (row) await ctx.db.patch(row._id, { sealed: undefined, updatedAt: now, deletedAt: now });
    return { updatedAt: now };
  },
});
