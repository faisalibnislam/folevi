// Note themes for the app (lib/themes.ts explains them; adminThemes.ts is the admin's Theme manager).
import { v } from "convex/values";
import { internalMutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { accessAtLeast, documentAccess, getDocumentByPublicId, optionalProfile } from "./lib/auth";
import { effectiveTheme, scopePlan } from "./lib/noteThemes";
import { nextSeq } from "./lib/seq";
import { scopeOfRow } from "./lib/scope";
import { applyThemeDefaults, isCustomThemeKey } from "./lib/themes";

/** A theme row as the app reads it, with its image's URLs. */
export async function themeForClient(ctx: QueryCtx, row: Doc<"noteThemes">) {
  const image = row.image
    ? {
        full: await ctx.storage.getUrl(row.image.full),
        half: await ctx.storage.getUrl(row.image.half),
        thumb: await ctx.storage.getUrl(row.image.thumb),
        width: row.image.width,
        height: row.image.height,
      }
    : null;
  return {
    key: row.key,
    name: row.name ?? null,
    status: row.status,
    order: row.order,
    plan: row.plan,
    image,
    palette: row.palette ?? null,
    defaults: row.defaults ?? null,
    fonts: row.fonts ?? null,
    updatedAt: row.updatedAt,
  };
}

/**
 * Every theme change and every theme an admin added, for anyone (public pages draw themes too). The
 * built-ins nobody changed aren't listed; the app ships them. Drafts of new themes stay with the admins.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("noteThemes").withIndex("by_order").take(1000);
    const out = [];
    for (const row of rows) {
      if (row.status === "draft" && isCustomThemeKey(row.key)) continue;
      out.push(await themeForClient(ctx, row));
    }
    return out;
  },
});

/**
 * The plan where a note lives (its owner's Personal plan, or its workspace's): which themes its picker
 * offers. Null for anyone who can't edit the note. The server checks again when a theme is picked.
 */
export const planForDocument = query({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const profile = await optionalProfile(ctx);
    const doc = profile ? await getDocumentByPublicId(ctx, args.documentId) : null;
    if (!profile || !doc || !accessAtLeast(await documentAccess(ctx, profile, doc), "write")) return null;
    return await scopePlan(ctx, scopeOfRow(doc));
  },
});

/**
 * Puts notes on their theme's defaults (colours, separator, font type), batch by batch:
 * - no `from`: every themed note, on its own theme (once, when themes arrived; `npx convex run
 *   themes:resetNotesToThemeDefaults`);
 * - `from` and `to`: notes on theme `from` move to theme `to` (an admin deleting a theme for good).
 * Each changed note gets a new revision and sequence number, so open copies pick the change up.
 */
export const resetNotesToThemeDefaults = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), from: v.optional(v.string()), to: v.optional(v.string()), updated: v.optional(v.number()) },
  handler: async (ctx, args) => {
    // Moving off one theme only reads its notes; resetting every themed note reads them all once.
    const from = args.from;
    const query = from ? ctx.db.query("documents").withIndex("by_cover", (q) => q.eq("cover.kind", "art").eq("cover.value", from)) : ctx.db.query("documents");
    const page = await query.paginate({ numItems: 100, cursor: args.cursor ?? null });
    const target = args.to ? await effectiveTheme(ctx, args.to) : null;
    let updated = args.updated ?? 0;
    for (const d of page.page) {
      if (d.cover.kind !== "art" || !d.cover.value) continue;
      if (args.from && d.cover.value !== args.from) continue;
      const theme = target ?? (await effectiveTheme(ctx, d.cover.value));
      if (!theme) continue;
      const style = applyThemeDefaults(d.style, theme.defaults);
      const cover = target ? { kind: "art" as const, value: target.key } : d.cover;
      if (JSON.stringify(style) === JSON.stringify(d.style) && cover.value === d.cover.value) continue;
      await ctx.db.patch(d._id, { style, cover, revision: d.revision + 1, seq: await nextSeq(ctx, scopeOfRow(d)), updatedAt: Date.now() });
      updated++;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.themes.resetNotesToThemeDefaults, { cursor: page.continueCursor, from: args.from, to: args.to, updated });
    } else if (args.from) {
      // Moving notes off a theme deleted for good: once they're all moved, its row and image go.
      await ctx.scheduler.runAfter(0, internal.adminThemes.finishDelete, { key: args.from });
    }
    return { updated, done: page.isDone };
  },
});
