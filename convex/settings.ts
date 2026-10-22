// Public, non-sensitive platform settings the clients need (maintenance banner, flags, templates).
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { optionalProfile } from "./lib/auth";
import { BUILT_IN_TEMPLATES } from "./lib/templates";
import { isShellVersion, MIN_SHELL_VERSIONS, newerFloor } from "./lib/shellVersions";

export const status = query({
  args: {},
  handler: async (ctx) => {
    const maintenance = await ctx.db
      .query("systemSettings")
      .withIndex("by_key", (q) => q.eq("key", "maintenance"))
      .unique();
    const value = (maintenance?.value as { bannerMessage?: string; readOnly?: boolean } | undefined) ?? {};
    const flags = await ctx.db.query("featureFlags").take(50);
    const shell = await ctx.db
      .query("systemSettings")
      .withIndex("by_key", (q) => q.eq("key", "min_shell_version"))
      .unique();
    const floor = (shell?.value as { mac?: string; ios?: string; android?: string } | undefined) ?? {};
    return {
      bannerMessage: value.bannerMessage || null,
      readOnly: Boolean(value.readOnly),
      flags: Object.fromEntries(flags.map((f) => [f.key, f.enabled])) as Record<string, boolean>,
      // The oldest app versions that may keep syncing (lib/shellVersions.ts); older ones show "Update Folevi".
      minShellVersion: {
        mac: newerFloor(MIN_SHELL_VERSIONS.mac, floor.mac),
        ios: newerFloor(MIN_SHELL_VERSIONS.ios, floor.ios),
        android: newerFloor(MIN_SHELL_VERSIONS.android, floor.android),
      },
    };
  },
});

/**
 * Sets the operators' app-version floor without a deploy (null clears it):
 * `npx convex run settings:setMinShellVersion '{"mac":"1.16.0"}'`. The newer of it and the floor in code applies.
 */
export const setMinShellVersion = internalMutation({
  args: { mac: v.optional(v.union(v.string(), v.null())), ios: v.optional(v.union(v.string(), v.null())), android: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    for (const value of [args.mac, args.ios, args.android]) {
      if (value != null && !isShellVersion(value)) throw new Error(`Not a version: ${value}`);
    }
    const row = await ctx.db
      .query("systemSettings")
      .withIndex("by_key", (q) => q.eq("key", "min_shell_version"))
      .unique();
    const before = (row?.value as { mac?: string | null; ios?: string | null; android?: string | null } | undefined) ?? {};
    const value = {
      mac: args.mac === undefined ? (before.mac ?? null) : args.mac,
      ios: args.ios === undefined ? (before.ios ?? null) : args.ios,
      android: args.android === undefined ? (before.android ?? null) : args.android,
    };
    if (row) await ctx.db.patch(row._id, { value, updatedAt: Date.now() });
    else await ctx.db.insert("systemSettings", { key: "min_shell_version", value, updatedAt: Date.now() });
    return value;
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

/** Built-in templates an admin switched off, for the public template gallery on folevi.com (keys only). */
export const disabledBuiltInTemplates = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("builtInTemplates").take(100)).filter((r) => !r.enabled).map((r) => r.key),
});

export const ping = query({ args: { at: v.optional(v.number()) }, handler: async () => ({ ok: true }) });
