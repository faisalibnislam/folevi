// Public, non-sensitive platform settings the clients need (maintenance banner, flags, templates).
import { v } from "convex/values";
import { query } from "./_generated/server";
import { optionalProfile } from "./lib/auth";
import { BUILT_IN_TEMPLATES } from "./lib/templates";

export const status = query({
  args: {},
  handler: async (ctx) => {
    const maintenance = await ctx.db
      .query("systemSettings")
      .withIndex("by_key", (q) => q.eq("key", "maintenance"))
      .unique();
    const value = (maintenance?.value as { bannerMessage?: string; readOnly?: boolean } | undefined) ?? {};
    const flags = await ctx.db.query("featureFlags").take(50);
    return {
      bannerMessage: value.bannerMessage || null,
      readOnly: Boolean(value.readOnly),
      flags: Object.fromEntries(flags.map((f) => [f.key, f.enabled])) as Record<string, boolean>,
    };
  },
});

export const builtInTemplates = query({
  args: {},
  handler: async (ctx) => {
    const profile = await optionalProfile(ctx);
    if (!profile) return [];
    const rows = await ctx.db.query("builtInTemplates").take(100);
    const disabled = new Set(rows.filter((r) => !r.enabled).map((r) => r.key));
    return BUILT_IN_TEMPLATES.filter((t) => !disabled.has(t.key)).map((t) => ({ key: `builtin:${t.key}`, name: t.name, description: t.description, icon: t.icon }));
  },
});

export const ping = query({ args: { at: v.optional(v.number()) }, handler: async () => ({ ok: true }) });
