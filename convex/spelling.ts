// Folevi's spelling and prediction settings and the personal dictionary (docs/SPELLING_PLAN.md): one row per
// person, the same on every device. The apps keep a copy on each device (apps/web/src/lib/spelling/settings.ts)
// so a note is checked the same way offline. Words from end-to-end encrypted notes never come here.
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { mutation } from "./lib/functions";
import { assertWritable, requireProfile } from "./lib/auth";
import { isValidId } from "@folevi/editor-schema";
import { fail } from "./lib/errors";

/** Words one list keeps, at most (the oldest go first). */
export const SPELLING_WORDS_MAX = 5000;
const vEnglish = v.union(v.literal("en-US"), v.literal("en-GB"));
const vKind = v.union(v.literal("learnt"), v.literal("ignored"));

/** This person's settings and words; null settings mean the defaults (on, the browser's English). */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const row = await ctx.db
      .query("spelling")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .unique();
    return {
      spellcheck: row?.spellcheck ?? null,
      predictions: row?.predictions ?? null,
      english: row?.english ?? null,
      learnt: row?.learnt ?? [],
      ignored: row?.ignored ?? [],
      offNotes: row?.offNotes ?? [],
    };
  },
});

async function rowOf(ctx: QueryCtx, profileId: Id<"profiles">) {
  return ctx.db
    .query("spelling")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .unique();
}

/** Spell check on or off, prediction on or off, American or British English. */
export const setPrefs = mutation({
  args: { spellcheck: v.optional(v.boolean()), predictions: v.optional(v.boolean()), english: v.optional(vEnglish) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const row = await rowOf(ctx, profile._id);
    const patch = Object.fromEntries(Object.entries(args).filter(([, x]) => x !== undefined));
    if (row) await ctx.db.patch(row._id, { ...patch, updatedAt: Date.now() });
    else await ctx.db.insert("spelling", { profileId: profile._id, learnt: [], ignored: [], ...patch, updatedAt: Date.now() });
    return null;
  },
});

/** Notes spell check is off for, at most. */
export const SPELLING_OFF_NOTES_MAX = 2000;

/** Spell check on or off for one note (only for this person: it's their own setting for that note). */
export const setNote = mutation({
  args: { documentId: v.string(), on: v.boolean() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    if (!isValidId(args.documentId)) fail("invalid_argument", "Invalid note id.");
    const row = await rowOf(ctx, profile._id);
    const list = (row?.offNotes ?? []).filter((id) => id !== args.documentId);
    if (!args.on) list.push(args.documentId);
    const offNotes = list.slice(-SPELLING_OFF_NOTES_MAX);
    if (row) await ctx.db.patch(row._id, { offNotes, updatedAt: Date.now() });
    else await ctx.db.insert("spelling", { profileId: profile._id, learnt: [], ignored: [], offNotes, updatedAt: Date.now() });
    return null;
  },
});

/** Adds a word to (or takes it off) the dictionary or the ignore list. Safe to send twice. */
export const setWord = mutation({
  args: { word: v.string(), kind: vKind, add: v.boolean() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const word = args.word.trim();
    if (!word || word.length > 64 || /\s/.test(word)) fail("invalid_argument", "That isn't a word.");
    const row = await rowOf(ctx, profile._id);
    const list = (row?.[args.kind] ?? []).filter((w) => w !== word);
    if (args.add) list.push(word);
    const next = list.slice(-SPELLING_WORDS_MAX);
    if (row) await ctx.db.patch(row._id, { [args.kind]: next, updatedAt: Date.now() });
    else await ctx.db.insert("spelling", { profileId: profile._id, learnt: [], ignored: [], [args.kind]: next, updatedAt: Date.now() });
    return null;
  },
});
