// One person's Home (the owner, 28 November 2026): the order of Home's blocks, which of them are hidden, and their
// scratch pad, the same on every device and in every place. The apps own the block ids and the default order
// (apps/web/src/lib/app/homeLayout.ts); a block the order doesn't name (one added later) takes its default place.
// No row: the default Home and an empty scratch pad. The scratch pad is a person's own plain text, never part of a
// space, so it is not end-to-end encrypted.
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { mutation } from "./lib/functions";
import { assertWritable, requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";

/** Block ids one layout keeps, at most (far more than Home has). */
export const HOME_LAYOUT_MAX = 50;
/** The scratch pad's length, at most. */
export const SCRATCH_MAX = 4000;
const BLOCK_ID = /^[a-z][a-z0-9-]{0,39}$/;

async function rowOf(ctx: QueryCtx, profileId: Doc<"profiles">["_id"]) {
  return await ctx.db
    .query("homePrefs")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .unique();
}

/** This person's Home: their block order and hidden blocks (null: the default) and their scratch pad. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const row = await rowOf(ctx, profile._id);
    return {
      layout: row?.order || row?.hidden ? { order: row.order ?? [], hidden: row.hidden ?? [] } : null,
      scratch: row?.scratch ?? "",
    };
  },
});

/**
 * Saves this person's Home layout (duplicates keep their first place). Null forgets it, and Home goes back to the
 * default. Sending the same layout again changes nothing, so a resend is safe.
 */
export const setLayout = mutation({
  args: { layout: v.union(v.object({ order: v.array(v.string()), hidden: v.array(v.string()) }), v.null()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const row = await rowOf(ctx, profile._id);
    const now = Date.now();
    if (args.layout === null) {
      if (row) await ctx.db.patch(row._id, { order: undefined, hidden: undefined, updatedAt: now });
      return null;
    }
    const { order, hidden } = args.layout;
    if (order.length > HOME_LAYOUT_MAX || hidden.length > HOME_LAYOUT_MAX) fail("invalid_argument", "Too many Home blocks.");
    if (![...order, ...hidden].every((id) => BLOCK_ID.test(id))) fail("invalid_argument", "Invalid Home block.");
    const next = { order: [...new Set(order)], hidden: [...new Set(hidden)] };
    if (row) await ctx.db.patch(row._id, { ...next, updatedAt: now });
    else await ctx.db.insert("homePrefs", { profileId: profile._id, ...next, updatedAt: now });
    return null;
  },
});

/** Saves this person's scratch pad (the whole text; the last save wins). */
export const setScratch = mutation({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    if (args.text.length > SCRATCH_MAX) fail("invalid_argument", "The scratch pad is full.");
    const row = await rowOf(ctx, profile._id);
    const now = Date.now();
    if (row) await ctx.db.patch(row._id, { scratch: args.text, updatedAt: now });
    else await ctx.db.insert("homePrefs", { profileId: profile._id, scratch: args.text, updatedAt: now });
    return null;
  },
});
