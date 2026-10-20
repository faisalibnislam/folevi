// themes.* in local mode (convex/themes.ts), from the snapshot bundled with the app (lib/shell/snapshot.ts):
// the theme rows admins changed or added, with their images copied into the shell, and the built-in
// templates admins switched off. Both stay as the build saw them until the app updates.
//
// Also the snapshot's other readers here: whether a built-in template is on (settings.builtInTemplates, a
// note made from a template, onboarding's starter pages) and what a theme key means (the built-in setup with
// an admin's change on top, convex/lib/noteThemes.ts effectiveTheme).
import { api } from "@/lib/convex/api";
import { EMPTY_SNAPSHOT, loadShellSnapshot, type ShellSnapshot } from "@/lib/shell/snapshot";
import { builtInSetup, isCustomThemeKey, STANDARD_DEFAULTS, STANDARD_FONTS, type ThemeDefaults, type ThemeFonts, type ThemePlan, type ThemeStatus } from "@/lib/themes";
import { defineLocal } from "../registry";
import { getProfile } from "./shared";

let testSnapshot: ShellSnapshot | null = null;

/** Tests: answer from this snapshot instead of the build's (null goes back to the build's). */
export function setBundledSnapshotForTests(snapshot: ShellSnapshot | null): void {
  testSnapshot = snapshot;
}

/** The build's snapshot: empty on the website, in tests and when the build had none. */
export async function bundledSnapshot(): Promise<ShellSnapshot> {
  if (testSnapshot) return testSnapshot;
  try {
    return await loadShellSnapshot();
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

/** Whether a built-in template is switched on (convex/lib/syncEngine.ts builtInTemplateEnabled). */
export async function builtInTemplateEnabled(key: string): Promise<boolean> {
  return !(await bundledSnapshot()).templates.disabled.includes(key);
}

export interface LocalTheme {
  key: string;
  builtIn: boolean;
  status: ThemeStatus;
  plan: ThemePlan;
  defaults: ThemeDefaults;
  fonts: ThemeFonts;
}

/** The theme a key names, or null when there's no such theme. */
export async function effectiveTheme(key: string): Promise<LocalTheme | null> {
  const row = (await bundledSnapshot()).themes.find((t) => t.key === key) ?? null;
  const shipped = builtInSetup(key);
  if (!row && !shipped) return null;
  return {
    key,
    builtIn: Boolean(shipped),
    status: row?.status ?? "published",
    plan: row?.plan ?? "free",
    defaults: row?.defaults ?? shipped?.defaults ?? STANDARD_DEFAULTS,
    fonts: row?.fonts ?? shipped?.fonts ?? STANDARD_FONTS,
  };
}

/**
 * Every theme change and added theme the build saw, in the admins' order. The built-ins nobody changed
 * aren't listed (the app ships them); drafts of new themes stay with the admins.
 */
defineLocal(api.themes.list, "query", async () => {
  const rows = [...(await bundledSnapshot()).themes].sort((a, b) => a.order - b.order);
  return rows.filter((r) => !(r.status === "draft" && isCustomThemeKey(r.key)));
});

/**
 * Which themes a note's picker offers. Local mode has no plans: everything the app ships is the person's,
 * so it's the plan that offers every theme. Null for a note that isn't there, as on the server.
 */
defineLocal(api.themes.planForDocument, "query", async (ctx, args) => {
  if (!(await getProfile(ctx.db))) return null;
  const doc = await ctx.db.get("documents", args.documentId);
  return doc ? ("pro_ai" as const) : null;
});
