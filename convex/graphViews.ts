// Foli DNA's saved views: a person's named filters, colours and zoom for one place's map (the web's Foli DNA page,
// and the native apps through the engine). Private to the person who saved them; listed in the sidebar.
import { v } from "convex/values";
import { ulid } from "@folevi/editor-schema";
import { mutation, query } from "./_generated/server";
import { requireProfile, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { scopeKey, vScopeArg } from "./lib/scope";

/** Views one person keeps for one place, at most. */
export const GRAPH_VIEWS_LIMIT = 30;
const NAME_MAX = 60;
const SETTINGS_MAX = 8_000;

/** This place's saved views, most recently changed first. */
export const list = query({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    const rows = await ctx.db
      .query("graphViews")
      .withIndex("by_profile_scope", (q) => q.eq("profileId", profile._id).eq("scopeKey", scopeKey(scope)))
      .take(GRAPH_VIEWS_LIMIT);
    return rows.sort((a, b) => b.updatedAt - a.updatedAt).map((r) => ({ id: r.publicId, name: r.name, settings: r.settings, updatedAt: r.updatedAt }));
  },
});

/** Saves a view (a new one, or `id`'s again under its name). Returns its id. */
export const save = mutation({
  args: { scope: vScopeArg, id: v.optional(v.string()), name: v.string(), settings: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    const name = args.name.trim().slice(0, NAME_MAX);
    if (!name) fail("invalid_argument", "Give the view a name.");
    if (args.settings.length > SETTINGS_MAX) fail("invalid_argument", "That view has too much in it to save.");
    try {
      JSON.parse(args.settings);
    } catch {
      fail("invalid_argument", "That view couldn't be saved.");
    }
    const now = Date.now();
    if (args.id) {
      const row = await ctx.db
        .query("graphViews")
        .withIndex("by_public_id", (q) => q.eq("publicId", args.id!))
        .unique();
      if (!row || row.profileId !== profile._id) fail("not_found", "That view is gone.");
      await ctx.db.patch(row._id, { name, settings: args.settings, updatedAt: now });
      return { id: row.publicId };
    }
    const key = scopeKey(scope);
    const existing = await ctx.db
      .query("graphViews")
      .withIndex("by_profile_scope", (q) => q.eq("profileId", profile._id).eq("scopeKey", key))
      .take(GRAPH_VIEWS_LIMIT + 1);
    if (existing.length >= GRAPH_VIEWS_LIMIT) fail("limit_exceeded", `You can keep ${GRAPH_VIEWS_LIMIT} saved views here. Remove one first.`);
    const publicId = `gv_${ulid()}`;
    await ctx.db.insert("graphViews", { profileId: profile._id, scopeKey: key, publicId, name, settings: args.settings, createdAt: now, updatedAt: now });
    return { id: publicId };
  },
});

/** Removes one of this person's saved views. */
export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const row = await ctx.db
      .query("graphViews")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.id))
      .unique();
    if (!row || row.profileId !== profile._id) return { removed: false };
    await ctx.db.delete(row._id);
    return { removed: true };
  },
});
