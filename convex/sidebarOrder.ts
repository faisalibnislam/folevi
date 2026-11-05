// The sidebar's own folder order (the owner, 6 November 2026): one person's order of a place's folders in the
// sidebar, apart from the folders' rank (the Folders page's order, which everyone in a workspace shares). It follows
// the person to all their devices; their Personal and each workspace have their own. The list holds folder ids
// (public ids): the apps sort each level of the tree by a folder's place in it, and list the folders it doesn't
// name after the ones it does, in rank order (apps/web/src/lib/app/sidebarFolderSort.ts applySidebarOrder). No
// row (or none saved yet): the sidebar shows rank order. Only ids, never names, so encrypted spaces keep it here too.
import { v } from "convex/values";
import { isValidId } from "@folevi/editor-schema";
import { mutation, query } from "./_generated/server";
import { assertWritable, requireProfile, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { scopeKey, vScopeArg } from "./lib/scope";

/** Folder ids one order keeps, at most (far more folders than a place has). */
export const SIDEBAR_ORDER_MAX = 5000;

/** This person's sidebar order for a place, or null when they haven't arranged it (rank order). */
export const get = query({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    const row = await ctx.db
      .query("sidebarOrders")
      .withIndex("by_profile_scope", (q) => q.eq("profileId", profile._id).eq("scopeKey", scopeKey(scope)))
      .unique();
    return row ? row.folderIds : null;
  },
});

/**
 * Saves this person's sidebar order for a place: every folder id in the order the sidebar shows them (duplicates
 * keep their first place). Null forgets it, and the sidebar goes back to rank order. Sending the same list again
 * changes nothing, so a resend from the outbox is safe.
 */
export const set = mutation({
  args: { scope: vScopeArg, folderIds: v.union(v.array(v.string()), v.null()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    const key = scopeKey(scope);
    const row = await ctx.db
      .query("sidebarOrders")
      .withIndex("by_profile_scope", (q) => q.eq("profileId", profile._id).eq("scopeKey", key))
      .unique();
    if (args.folderIds === null) {
      if (row) await ctx.db.delete(row._id);
      return null;
    }
    if (args.folderIds.length > SIDEBAR_ORDER_MAX) fail("invalid_argument", "Too many folders in that order.");
    if (!args.folderIds.every(isValidId)) fail("invalid_argument", "Invalid folder id.");
    const folderIds = [...new Set(args.folderIds)];
    const now = Date.now();
    if (row) await ctx.db.patch(row._id, { folderIds, updatedAt: now });
    else await ctx.db.insert("sidebarOrders", { profileId: profile._id, scopeKey: key, folderIds, updatedAt: now });
    return null;
  },
});
