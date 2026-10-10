// Server side of note themes (lib/themes.ts has the shared rules): what a theme key means right now (the
// built-in setup with an admin's changes on top, or an admin's own theme), and who may pick it.
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { personalEntitlements, workspaceEntitlements } from "./entitlements";
import { fail } from "./errors";
import { PLAN_CATALOG } from "./plans";
import type { Scope } from "./scope";
import { builtInSetup, planAllows, STANDARD_DEFAULTS, STANDARD_FONTS, type ThemeDefaults, type ThemeFonts, type ThemePlan, type ThemeStatus } from "./themes";

type Ctx = QueryCtx | MutationCtx;

export interface EffectiveTheme {
  key: string;
  builtIn: boolean;
  status: ThemeStatus;
  plan: ThemePlan;
  defaults: ThemeDefaults;
  fonts: ThemeFonts;
  row: Doc<"noteThemes"> | null;
}

export const themeRow = (ctx: Ctx, key: string) =>
  ctx.db
    .query("noteThemes")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();

/** The theme a key names, or null when there's no such theme (deleted, or never existed). */
export async function effectiveTheme(ctx: Ctx, key: string): Promise<EffectiveTheme | null> {
  const row = await themeRow(ctx, key);
  const shipped = builtInSetup(key);
  if (!row && !shipped) return null;
  return {
    key,
    builtIn: Boolean(shipped),
    status: row?.status ?? "published",
    plan: row?.plan ?? "free",
    defaults: row?.defaults ?? shipped?.defaults ?? STANDARD_DEFAULTS,
    fonts: row?.fonts ?? shipped?.fonts ?? STANDARD_FONTS,
    row,
  };
}

/** The plan in effect where a note lives: the owner's Personal plan, or the workspace's. */
export async function scopePlan(ctx: Ctx, scope: Scope): Promise<ThemePlan> {
  if (scope.kind === "personal") return (await personalEntitlements(ctx, scope.profileId)).plan;
  return PLAN_CATALOG[(await workspaceEntitlements(ctx, scope.workspaceId)).planId].tier;
}

/**
 * Checks that a note in `scope` may switch to theme `key`: it has to be published and on the scope's plan.
 * A note that already uses the theme keeps it whatever happens to the theme later (retired, gated, or the
 * plan going down); this only runs when the theme changes.
 */
export async function checkThemePick(ctx: Ctx, scope: Scope, key: string): Promise<EffectiveTheme> {
  const theme = await effectiveTheme(ctx, key);
  if (!theme || theme.status !== "published") fail("not_found", "That note theme is no longer available.");
  if (theme.plan !== "free" && !planAllows(await scopePlan(ctx, scope), theme.plan)) {
    fail("forbidden", "That note theme comes with a higher plan.");
  }
  return theme;
}
