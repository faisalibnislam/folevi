// The sidebar's layout (the owner, 2026-11-27): which of the app's own sidebar items (Home, Tasks, Templates...)
// one person keeps on the sidebar and which they keep under its "More" section, and in what order. One row per
// person, the same on every device and in every place. The apps own the item ids and their default places
// (apps/web/src/lib/app/sidebarLayout.ts): `order` is the person's order of the items they arranged, `more` the
// ones under More. An item the list doesn't name (one added to the apps later) goes to its default place. No row:
// the default layout. Only item ids, never note content.
import { v } from "convex/values";
import { query } from "./_generated/server";
import { mutation } from "./lib/functions";
import { assertWritable, requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";

/** Item ids one layout keeps, at most (far more than the sidebar has). */
export const SIDEBAR_LAYOUT_MAX = 100;
const ITEM_ID = /^[a-z][a-z0-9-]{0,39}$/;

/** This person's sidebar layout, or null when they haven't changed it (the default). */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const row = await ctx.db
      .query("sidebarLayouts")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .unique();
    return row ? { order: row.order, more: row.more } : null;
  },
});

/**
 * Saves this person's sidebar layout (duplicates keep their first place). Null forgets it, and the sidebar goes
 * back to the default. Sending the same layout again changes nothing, so a resend is safe.
 */
export const set = mutation({
  args: { layout: v.union(v.object({ order: v.array(v.string()), more: v.array(v.string()) }), v.null()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const row = await ctx.db
      .query("sidebarLayouts")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .unique();
    if (args.layout === null) {
      if (row) await ctx.db.delete(row._id);
      return null;
    }
    const { order, more } = args.layout;
    if (order.length > SIDEBAR_LAYOUT_MAX || more.length > SIDEBAR_LAYOUT_MAX) fail("invalid_argument", "Too many sidebar items.");
    if (![...order, ...more].every((id) => ITEM_ID.test(id))) fail("invalid_argument", "Invalid sidebar item.");
    const next = { order: [...new Set(order)], more: [...new Set(more)] };
    const now = Date.now();
    if (row) await ctx.db.patch(row._id, { ...next, updatedAt: now });
    else await ctx.db.insert("sidebarLayouts", { profileId: profile._id, ...next, updatedAt: now });
    return null;
  },
});
