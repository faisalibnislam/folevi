// Note themes in the app: the shared rules (convex/lib/themes.ts), the typefaces as CSS, and the live list
// of themes: the built-ins that ship with the app (packages/design-tokens/covers) with the admins' changes
// and added themes (api.themes.list) on top. lib/cover.ts draws a note from it.
import coverArt from "@folevi/design-tokens/covers.json";
import type { StylePalette } from "@/lib/palette";
import { builtInSetup, FONT_POOL, SLOT_OF, STANDARD_DEFAULTS, STANDARD_FONTS, type FontSlot, type FontType, type ThemeDefaults, type Sheet, type TextColor, type ThemeFonts, type ThemePlan, type ThemeStatus } from "../../../../convex/lib/themes";

export * from "../../../../convex/lib/themes";

/** A theme row from the server (convex/themes.ts themeForClient). */
export interface ThemeRow {
  key: string;
  name: string | null;
  status: ThemeStatus;
  order: number;
  plan: ThemePlan;
  image: { full: string | null; half: string | null; thumb: string | null; width: number; height: number } | null;
  palette: StylePalette | null;
  defaults: ThemeDefaults | null;
  fonts: ThemeFonts | null;
  updatedAt: number;
}

/** A theme as the app draws it: its colours (a StylePalette), image, defaults and typefaces. */
export interface NoteTheme extends Omit<StylePalette, "tone"> {
  id: string;
  name: string;
  tone: "deep" | "light";
  width?: number;
  height?: number;
  builtIn: boolean;
  status: ThemeStatus;
  plan: ThemePlan;
  order: number;
  defaults: ThemeDefaults;
  fonts: ThemeFonts;
  /** An uploaded image (added themes, or a built-in whose image an admin replaced); built-ins use /covers. */
  image: { full: string; half: string; thumb: string } | null;
}

type Shipped = Omit<StylePalette, "tone"> & { id: string; name: string; tone: "deep" | "light"; width?: number; height?: number };
const SHIPPED = coverArt as Shipped[];

/** The shipped themes alone (no admin changes): for the website, which shows what the app ships. */
export const BUILT_IN_THEMES: readonly NoteTheme[] = SHIPPED.map((a, i) => merge(a, null, i + 1));

function merge(shipped: Shipped | null, row: ThemeRow | null, order: number): NoteTheme {
  const setup = shipped ? builtInSetup(shipped.id) : null;
  const palette = row?.palette ?? shipped!;
  const image = row?.image?.full && row.image.half && row.image.thumb ? { full: row.image.full, half: row.image.half, thumb: row.image.thumb } : null;
  return {
    ...palette,
    id: shipped?.id ?? row!.key,
    name: row?.name ?? shipped?.name ?? "Untitled theme",
    tone: palette.tone,
    width: row?.image?.width ?? shipped?.width,
    height: row?.image?.height ?? shipped?.height,
    builtIn: Boolean(shipped),
    status: row?.status ?? "published",
    plan: row?.plan ?? "free",
    order: row?.order ?? order,
    defaults: row?.defaults ?? setup?.defaults ?? STANDARD_DEFAULTS,
    fonts: row?.fonts ?? setup?.fonts ?? STANDARD_FONTS,
    image,
  };
}

/** Built-ins with their rows applied, plus added themes (those with a palette), in picker order. */
export function themesFrom(rows: readonly ThemeRow[]): NoteTheme[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out = SHIPPED.map((a, i) => merge(a, byKey.get(a.id) ?? null, i + 1));
  for (const r of rows) if (!SHIPPED.some((a) => a.id === r.key) && r.palette) out.push(merge(null, r, r.order));
  return out.sort((a, b) => a.order - b.order);
}

// ---------------------------------------------------------------- the live list

const CACHE_KEY = "folevi:themes";
let rows: readonly ThemeRow[] = [];
let themes: NoteTheme[] = themesFrom([]);
let byId = new Map(themes.map((t) => [t.id, t]));
let version = 0;
const listeners = new Set<() => void>();

// The last list seen on this device, so themes draw right away (and offline) before the server answers.
if (typeof window !== "undefined") {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as ThemeRow[] | null;
    if (Array.isArray(cached)) install(cached);
  } catch {
    // A missing or unreadable cache just means the shipped themes until the list arrives.
  }
}

function install(next: readonly ThemeRow[]) {
  rows = next;
  themes = themesFrom(next);
  byId = new Map(themes.map((t) => [t.id, t]));
  version++;
}

/** Takes the server's list (ThemesSync, and public pages on the server). */
export function setThemeRows(next: readonly ThemeRow[]) {
  if (JSON.stringify(next) === JSON.stringify(rows)) return;
  install(next);
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(next));
    } catch {
      // Private windows may refuse; the list still applies for this visit.
    }
  }
  for (const l of listeners) l();
}

/** Every theme, in picker order (drafts and retired ones included: notes may still use them). */
export const allThemes = () => themes;
export const themeById = (id: string) => byId.get(id) ?? null;

/** For useThemesVersion (lib/useThemes.ts): follow changes to the list, and its current version. */
export function subscribeThemes(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export const themesVersion = () => version;

// ---------------------------------------------------------------- colours

/** The document colours people can pick (and a theme can start with). */
export const SHEETS: { id: Sheet; name: string; color: string }[] = [
  { id: "white", name: "White", color: "#ffffff" },
  { id: "paper", name: "Paper", color: "#fbf8f2" },
  { id: "ivory", name: "Ivory", color: "#f4ecdb" },
  { id: "mist", name: "Mist", color: "#edf1f6" },
  { id: "sage", name: "Sage", color: "#ecf2ea" },
  { id: "blush", name: "Blush", color: "#f8ecec" },
  { id: "night", name: "Night", color: "#161618" },
];
/** The text colours people can pick (and a theme can start with). */
export const TEXTS: { id: TextColor; name: string; color: string }[] = [
  { id: "ink", name: "Ink", color: "#1c1c1f" },
  { id: "slate", name: "Slate", color: "#3a4758" },
  { id: "navy", name: "Navy", color: "#23406f" },
  { id: "forest", name: "Forest", color: "#25543a" },
  { id: "plum", name: "Plum", color: "#5a2d66" },
  { id: "brown", name: "Brown", color: "#5b3b23" },
  { id: "white", name: "White", color: "#f2f2f4" },
];

// ---------------------------------------------------------------- typefaces

const FALLBACK: Record<FontSlot, string> = {
  modern: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  serif: "var(--font-spectral), ui-serif, Georgia, serif",
  mono: "var(--font-jetbrains-mono), ui-monospace, Menlo, Consolas, monospace",
  soft: "var(--font-nunito), var(--font-inter), sans-serif",
};

/** The CSS font-family for a typeface id from FONT_POOL. */
export function fontFamily(slot: FontSlot, id: string): string {
  if (id === "system-rounded") return `ui-rounded, "SF Pro Rounded", ${FALLBACK.soft}`;
  if (!FONT_POOL[slot].some((f) => f.id === id)) return FALLBACK[slot];
  return `var(--font-${id}), ${FALLBACK[slot]}`;
}

/** The typeface a note's font type uses under a theme (the standard ones without a theme). */
export const familyFor = (font: FontType, fonts: ThemeFonts = STANDARD_FONTS) => fontFamily(SLOT_OF[font], fonts[SLOT_OF[font]]);

/** CSS variables that point a note's font types at a theme's typefaces (editor.css reads --note-*). */
export function themeFontVars(fonts: ThemeFonts | null | undefined): Record<string, string> | undefined {
  if (!fonts) return undefined;
  return {
    "--note-modern": fontFamily("modern", fonts.modern),
    "--note-serif": fontFamily("serif", fonts.serif),
    "--note-mono": fontFamily("mono", fonts.mono),
    "--note-soft": fontFamily("soft", fonts.soft),
  };
}
