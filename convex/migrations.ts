// One-off data backfills. Each runs in small batches and reschedules itself until done, so it is safe on
// large deployments. Run with `npx convex run migrations:<name>`.
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { refreshDerived } from "./lib/documents";
import { randomNoteEmoji, randomNoteCover } from "@folevi/editor-schema";
import { isFolderColor, randomFolderColor } from "./lib/folderColors";
import { startTrial } from "./lib/billing";
import { PERSONAL_WORKSPACE_NAME } from "./seed";

/** Fills in the card preview (documents.preview) for pages saved before previews existed. */
export const backfillDocumentPreviews = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("documents").paginate({ numItems: 50, cursor: args.cursor ?? null });
    let updated = 0;
    for (const doc of page.page) {
      if (doc.preview !== undefined) continue;
      await refreshDerived(ctx, doc);
      updated++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.backfillDocumentPreviews, { cursor: page.continueCursor });
    return { updated, done: page.isDone };
  },
});

/** Gives every note without an icon a random emoji (notes always have an icon now). */
export const backfillNoteIcons = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("documents").paginate({ numItems: 100, cursor: args.cursor ?? null });
    let updated = 0;
    for (const doc of page.page) {
      if (doc.icon || doc.kind !== "document") continue;
      await ctx.db.patch(doc._id, { icon: randomNoteEmoji() });
      updated++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.backfillNoteIcons, { cursor: page.continueCursor });
    return { updated, done: page.isDone };
  },
});

/** Gives every folder without a colour a random pastel (folders show a coloured folder, not an emoji). */
export const backfillFolderColors = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;
    for (const f of await ctx.db.query("folders").collect()) {
      if (f.color) continue;
      await ctx.db.patch(f._id, { color: randomFolderColor(), icon: undefined });
      updated++;
    }
    return { updated };
  },
});

/** Renames every personal workspace to "Personal" (the fixed name; they used to be "<First>'s Folio"). */
export const renamePersonalWorkspaces = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("workspaces").paginate({ numItems: 100, cursor: args.cursor ?? null });
    let updated = 0;
    for (const w of page.page) {
      if (w.kind !== "personal" || w.name === PERSONAL_WORKSPACE_NAME) continue;
      await ctx.db.patch(w._id, { name: PERSONAL_WORKSPACE_NAME, updatedAt: Date.now() });
      updated++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.renamePersonalWorkspaces, { cursor: page.continueCursor });
    return { updated, done: page.isDone };
  },
});

/** Wide page became the default: notes on the old default (or the seed's narrow) width become wide. */
export const wideByDefault = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("documents").paginate({ numItems: 200, cursor: args.cursor ?? null });
    let updated = 0;
    for (const d of page.page) {
      if (d.style.width === "wide") continue;
      await ctx.db.patch(d._id, { style: { ...d.style, width: "wide" } });
      updated++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.wideByDefault, { cursor: page.continueCursor });
    return { updated, done: page.isDone };
  },
});

/**
 * The 40 mesh-gradient note styles replaced the old artwork: every note gets a random one, with its page and
 * text colours back on Auto (taken from the style) and no separate page backdrop.
 */
export const randomizeNoteStyles = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("documents").paginate({ numItems: 200, cursor: args.cursor ?? null });
    let updated = 0;
    for (const d of page.page) {
      if (d.kind !== "document") continue;
      const { sheet: _sheet, text: _text, backdrop: _backdrop, ...style } = d.style as typeof d.style & { sheet?: string; text?: string; backdrop?: string };
      await ctx.db.patch(d._id, { cover: randomNoteCover(), style: { ...style, width: "wide" } });
      updated++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.randomizeNoteStyles, { cursor: page.continueCursor });
    return { updated, done: page.isDone };
  },
});

/**
 * Folder colours became the note styles' light page colours. Moves each folder from its old colour to the
 * new one closest in hue (neutrals to neutrals); anything unknown gets a random new colour.
 */
const OLD_FOLDER_COLOR_TO_STYLE: Record<string, string> = {"rose":"deco","blush":"red-lacquer","peach":"rust","apricot":"peeling-paint","butter":"runners","raspberry":"deco","coral":"red-lacquer","terracotta":"rust","tangerine":"peeling-paint","honey":"runners","lemon":"cypresses","pistachio":"crackle-green","mint":"irises","seafoam":"irises","aqua":"summer-sky","olive":"cypresses","sage":"crackle-green","jade":"irises","teal":"irises","steel":"summer-sky","sky":"tarp-blue","periwinkle":"navy-crackle","lavender":"ultramarine","lilac":"ultramarine","orchid":"deco","powder":"tarp-blue","cornflower":"navy-crackle","iris":"ultramarine","plum":"ultramarine","mauve":"deco","sand":"weathered-wood","stone":"wood-thrush","clay":"poppy-print","graphite":"watercolour-marsh","slate":"midnight-rose"};
export const folderColorsFromStyles = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("folders").paginate({ cursor: args.cursor ?? null, numItems: 200 });
    let updated = 0;
    for (const f of page.page) {
      if (f.color && isFolderColor(f.color)) continue;
      const mapped = f.color ? OLD_FOLDER_COLOR_TO_STYLE[f.color] : undefined;
      await ctx.db.patch(f._id, { color: mapped && isFolderColor(mapped) ? mapped : randomFolderColor() });
      updated++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.folderColorsFromStyles, { cursor: page.continueCursor });
    return { updated, done: page.isDone };
  },
});

/**
 * Billing arrived: every existing account gets a billing row with the same 7-day Pro trial new accounts
 * get (so nobody loses AI the moment plans start). Accounts that already have one are left alone.
 */
export const startBillingForExistingUsers = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("profiles").paginate({ cursor: args.cursor ?? null, numItems: 200 });
    let created = 0;
    for (const p of page.page) {
      if (p.status === "deleted") continue;
      const has = await ctx.db
        .query("subscriptions")
        .withIndex("by_profile", (q) => q.eq("profileId", p._id))
        .unique();
      if (has) continue;
      await startTrial(ctx, p._id);
      created++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.startBillingForExistingUsers, { cursor: page.continueCursor });
    return { created, done: page.isDone };
  },
});
