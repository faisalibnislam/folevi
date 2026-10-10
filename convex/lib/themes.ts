// Note themes: a style image plus everything a note takes from it (colours, separator, font type and the
// typefaces behind each font type). Shared by the server and the web app (apps/web/src/lib/themes.ts
// re-exports it), so both agree on what a theme sets.
//
// The 57 built-in themes ship with the app (packages/design-tokens/covers: image + extracted colours), and
// their setup below. A row in `noteThemes` is an admin's change to a built-in (name, order, status, plan,
// colours, defaults, typefaces, a replacement image) or a whole theme an admin added. People never see the
// typefaces: they pick a font type (Modern, Serif, Mono, Soft) and the theme decides which family draws it.
// A note with its own uploaded image keeps the app's standard families.

export type FontType = "sans" | "serif" | "mono" | "rounded";
export type FontSlot = "modern" | "serif" | "mono" | "soft";
export type Separator = "line" | "dots" | "doodle";
export type Sheet = "white" | "paper" | "ivory" | "mist" | "sage" | "blush" | "night";
export type TextColor = "ink" | "slate" | "navy" | "forest" | "plum" | "brown" | "white";
export type ThemeStatus = "draft" | "published" | "retired";
export type ThemePlan = "free" | "core" | "pro" | "pro_ai";

/** The font types people pick, with their names and the slot of a theme's typefaces that draws each. */
export const FONT_TYPES: readonly { id: FontType; name: string; slot: FontSlot }[] = [
  { id: "sans", name: "Modern", slot: "modern" },
  { id: "serif", name: "Serif", slot: "serif" },
  { id: "mono", name: "Mono", slot: "mono" },
  { id: "rounded", name: "Soft", slot: "soft" },
];
export const SLOT_OF: Record<FontType, FontSlot> = { sans: "modern", serif: "serif", mono: "mono", rounded: "soft" };

/**
 * The typefaces a theme can use, per font type. All are Google fonts with regular, bold and italic (self-hosted
 * by next/font in apps/web/src/app/fonts.ts, so no requests go to Google), and each loads only when a note
 * shows it. `system-rounded` is the app's original Soft (the system's rounded face where there is one).
 */
export const FONT_POOL: Record<FontSlot, readonly { id: string; name: string }[]> = {
  modern: [
    { id: "inter", name: "Inter" },
    { id: "dm-sans", name: "DM Sans" },
    { id: "plus-jakarta-sans", name: "Plus Jakarta Sans" },
    { id: "figtree", name: "Figtree" },
    { id: "ibm-plex-sans", name: "IBM Plex Sans" },
  ],
  serif: [
    { id: "spectral", name: "Spectral" },
    { id: "newsreader", name: "Newsreader" },
    { id: "fraunces", name: "Fraunces" },
    { id: "lora", name: "Lora" },
    { id: "source-serif-4", name: "Source Serif 4" },
  ],
  mono: [
    { id: "jetbrains-mono", name: "JetBrains Mono" },
    { id: "ibm-plex-mono", name: "IBM Plex Mono" },
    { id: "source-code-pro", name: "Source Code Pro" },
    { id: "roboto-mono", name: "Roboto Mono" },
    { id: "space-mono", name: "Space Mono" },
  ],
  soft: [
    { id: "system-rounded", name: "System rounded" },
    { id: "nunito", name: "Nunito" },
    { id: "rubik", name: "Rubik" },
    { id: "andika", name: "Andika" },
    { id: "mali", name: "Mali" },
  ],
};

export type ThemeFonts = Record<FontSlot, string>;

/** The app's standard typefaces: notes with their own image or no theme, and a new theme until it's set up. */
export const STANDARD_FONTS: ThemeFonts = { modern: "inter", serif: "spectral", mono: "jetbrains-mono", soft: "system-rounded" };

/** What picking a theme sets on a note. A missing sheet or text colour means Auto (the theme's own colours). */
export interface ThemeDefaults {
  font: FontType;
  separator: Separator;
  sheet?: Sheet;
  text?: TextColor;
}

export const STANDARD_DEFAULTS: ThemeDefaults = { font: "sans", separator: "line" };

/** What Plain (no theme) starts a note with: Serif, plain lines, the app's own page and text colours. */
export const PLAIN_DEFAULTS: ThemeDefaults = { font: "serif", separator: "line" };

export const isFontId = (slot: FontSlot, id: string) => FONT_POOL[slot].some((f) => f.id === id);

/** Plans in order: a theme marked for a plan is available on that plan and the ones above it. */
export const THEME_PLANS: readonly { id: ThemePlan; name: string }[] = [
  { id: "free", name: "Everyone" },
  { id: "core", name: "Core and up" },
  { id: "pro", name: "Pro and up" },
  { id: "pro_ai", name: "Pro AI" },
];
const PLAN_RANK: Record<ThemePlan, number> = { free: 0, core: 1, pro: 2, pro_ai: 3 };
export const planAllows = (have: ThemePlan, needs: ThemePlan) => PLAN_RANK[have] >= PLAN_RANK[needs];

// Each built-in theme's setup, chosen to suit its image: [font type, separator, sheet or "", modern, serif,
// mono, soft]. Text colours stay on Auto (the image's own ink); a few very dark images get a night page.
type Row = [FontType, Separator, Sheet | "", string, string, string, string];
const BUILT_IN_ROWS: Record<string, Row> = {
  "art-01": ["serif", "doodle", "", "figtree", "fraunces", "space-mono", "rubik"], // Poppy print
  "art-02": ["serif", "line", "", "ibm-plex-sans", "newsreader", "ibm-plex-mono", "nunito"], // Studio collage
  "art-03": ["serif", "doodle", "", "dm-sans", "lora", "source-code-pro", "nunito"], // Irises
  "art-04": ["sans", "dots", "", "plus-jakarta-sans", "fraunces", "space-mono", "rubik"], // Runners
  "art-05": ["serif", "doodle", "", "figtree", "lora", "jetbrains-mono", "nunito"], // Watercolour marsh
  "art-06": ["serif", "line", "", "dm-sans", "spectral", "ibm-plex-mono", "rubik"], // Procession
  "art-07": ["serif", "dots", "", "plus-jakarta-sans", "fraunces", "space-mono", "rubik"], // Deco
  "art-08": ["serif", "line", "", "ibm-plex-sans", "newsreader", "ibm-plex-mono", "andika"], // Parchment
  "art-09": ["rounded", "doodle", "", "figtree", "lora", "jetbrains-mono", "nunito"], // Blossoms
  "art-10": ["rounded", "doodle", "", "dm-sans", "newsreader", "ibm-plex-mono", "mali"], // Ripple sketch
  "art-11": ["serif", "dots", "", "dm-sans", "fraunces", "space-mono", "rubik"], // Woven rust
  "art-12": ["sans", "line", "", "ibm-plex-sans", "source-serif-4", "ibm-plex-mono", "nunito"], // Grey sand
  "art-13": ["sans", "line", "", "inter", "newsreader", "jetbrains-mono", "nunito"], // Blue haze
  "art-14": ["sans", "line", "night", "inter", "source-serif-4", "roboto-mono", "nunito"], // Night dunes
  "art-15": ["serif", "doodle", "", "plus-jakarta-sans", "fraunces", "space-mono", "rubik"], // Copper fronds
  "art-16": ["sans", "line", "", "dm-sans", "newsreader", "roboto-mono", "rubik"], // Harbor blue
  "art-17": ["serif", "line", "", "inter", "newsreader", "jetbrains-mono", "nunito"], // Winter canvas
  "art-18": ["sans", "line", "", "ibm-plex-sans", "source-serif-4", "ibm-plex-mono", "nunito"], // Plaster
  "art-19": ["rounded", "dots", "", "figtree", "fraunces", "space-mono", "rubik"], // Festival
  "art-20": ["mono", "dots", "", "ibm-plex-sans", "newsreader", "ibm-plex-mono", "rubik"], // Dusk tiles
  "art-21": ["sans", "doodle", "", "figtree", "fraunces", "space-mono", "nunito"], // Coral drift
  "art-22": ["sans", "dots", "", "dm-sans", "lora", "source-code-pro", "rubik"], // Peeling paint
  "art-23": ["serif", "line", "", "plus-jakarta-sans", "fraunces", "jetbrains-mono", "rubik"], // Red lacquer
  "art-24": ["serif", "line", "", "figtree", "lora", "source-code-pro", "nunito"], // Terracotta
  "art-25": ["serif", "doodle", "", "dm-sans", "spectral", "ibm-plex-mono", "andika"], // Crackle green
  "art-26": ["serif", "line", "", "ibm-plex-sans", "lora", "source-code-pro", "andika"], // Weathered wood
  "art-27": ["sans", "doodle", "", "plus-jakarta-sans", "fraunces", "space-mono", "rubik"], // Ultramarine
  "art-28": ["rounded", "doodle", "", "figtree", "fraunces", "space-mono", "rubik"], // Sunburst
  "art-29": ["serif", "line", "", "dm-sans", "newsreader", "roboto-mono", "nunito"], // Ember sand
  "art-30": ["rounded", "doodle", "", "figtree", "lora", "jetbrains-mono", "nunito"], // Summer sky
  "art-31": ["mono", "dots", "", "ibm-plex-sans", "source-serif-4", "space-mono", "rubik"], // Rust
  "art-32": ["sans", "line", "", "inter", "source-serif-4", "roboto-mono", "rubik"], // Tarp blue
  "art-33": ["serif", "doodle", "", "plus-jakarta-sans", "fraunces", "jetbrains-mono", "rubik"], // Midnight rose
  "art-34": ["mono", "dots", "", "inter", "source-serif-4", "jetbrains-mono", "rubik"], // Galvanized
  "art-35": ["serif", "line", "", "inter", "newsreader", "ibm-plex-mono", "nunito"], // Linen waves
  "art-36": ["serif", "line", "", "dm-sans", "spectral", "ibm-plex-mono", "nunito"], // Navy crackle
  "art-37": ["serif", "line", "", "figtree", "fraunces", "space-mono", "rubik"], // Abstract head
  "art-38": ["serif", "line", "", "dm-sans", "lora", "source-code-pro", "nunito"], // Old street
  "art-39": ["serif", "doodle", "", "dm-sans", "spectral", "ibm-plex-mono", "nunito"], // Cypresses
  "art-40": ["serif", "doodle", "", "figtree", "newsreader", "source-code-pro", "andika"], // Wood thrush
  "art-41": ["rounded", "line", "", "figtree", "lora", "jetbrains-mono", "nunito"], // Amber mint
  "art-42": ["sans", "line", "", "inter", "newsreader", "jetbrains-mono", "nunito"], // Seafoam drift
  "art-43": ["sans", "line", "", "ibm-plex-sans", "source-serif-4", "ibm-plex-mono", "andika"], // Grey fibre
  "art-44": ["serif", "line", "", "inter", "source-serif-4", "ibm-plex-mono", "nunito"], // Folded mist
  "art-45": ["mono", "dots", "", "dm-sans", "lora", "ibm-plex-mono", "andika"], // Kraft
  "art-46": ["rounded", "line", "", "inter", "newsreader", "jetbrains-mono", "mali"], // Ruled page
  "art-47": ["sans", "line", "night", "inter", "newsreader", "jetbrains-mono", "nunito"], // Night feather
  "art-48": ["serif", "line", "", "dm-sans", "lora", "source-code-pro", "andika"], // Ribbed linen
  "art-49": ["sans", "line", "", "plus-jakarta-sans", "fraunces", "jetbrains-mono", "rubik"], // Aurora
  "art-50": ["rounded", "doodle", "", "figtree", "lora", "jetbrains-mono", "nunito"], // Peach haze
  "art-51": ["serif", "line", "night", "inter", "spectral", "jetbrains-mono", "nunito"], // Black satin
  "art-52": ["serif", "line", "", "inter", "newsreader", "ibm-plex-mono", "andika"], // Cold press
  "art-53": ["sans", "line", "", "inter", "source-serif-4", "jetbrains-mono", "nunito"], // White gloss
  "art-54": ["mono", "dots", "", "ibm-plex-sans", "source-serif-4", "jetbrains-mono", "rubik"], // Indigo scratch
  "art-55": ["sans", "line", "", "dm-sans", "newsreader", "roboto-mono", "nunito"], // Deep teal
  "art-56": ["sans", "line", "", "figtree", "lora", "source-code-pro", "nunito"], // Blue plaster
  "art-57": ["sans", "dots", "", "plus-jakarta-sans", "fraunces", "space-mono", "rubik"], // Neon silk
};

export interface ThemeSetup {
  defaults: ThemeDefaults;
  fonts: ThemeFonts;
}

/** A built-in theme's setup as shipped (before any admin changes); null for keys that aren't built in. */
export function builtInSetup(key: string): ThemeSetup | null {
  const row = BUILT_IN_ROWS[key];
  if (!row) return null;
  const [font, separator, sheet, modern, serif, mono, soft] = row;
  return { defaults: { font, separator, ...(sheet ? { sheet } : {}) }, fonts: { modern, serif, mono, soft } };
}

export const BUILT_IN_THEME_KEYS: readonly string[] = Object.keys(BUILT_IN_ROWS);

/** Keys of themes an admin added ("th-" + a ulid); built-in keys are art-01 to art-57. */
export const isCustomThemeKey = (key: string) => /^th-[0-9A-Z]{26}$/.test(key);

/**
 * What a note's style becomes when a theme is picked: the theme's font type, separator and colours (Auto
 * when the theme leaves them open). Width, blur and the rest stay as they were.
 */
export function applyThemeDefaults<S extends { font: string; sheet?: string; text?: string; separator?: string }>(style: S, defaults: ThemeDefaults): S {
  const next = { ...style, font: defaults.font, separator: defaults.separator } as S;
  if (defaults.sheet) next.sheet = defaults.sheet;
  else delete next.sheet;
  if (defaults.text) next.text = defaults.text;
  else delete next.text;
  return next;
}
