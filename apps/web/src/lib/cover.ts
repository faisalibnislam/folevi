// Shared (server + client) cover/accent helpers.
import type { DocumentCover, DocumentStyle } from "@folevi/editor-schema";
import type { StylePalette } from "@/lib/palette";
import { allThemes, BUILT_IN_THEMES, themeById, type NoteTheme } from "@/lib/themes";

/**
 * One note theme: an image (packages/design-tokens/covers/source, or one an admin uploaded) and the colours
 * it gives a note: page, text, accent, five text colours and four highlights (packages/design-tokens/src/
 * palette.ts), plus what picking it sets and its typefaces (lib/themes.ts).
 */
export type CoverArt = NoteTheme;

/**
 * The shipped themes (images built by packages/design-tokens/scripts/covers.mjs, served from /covers: the
 * cover and page background at 1600 px (1×) and 3200 px (2×, Retina), and a 640 px thumbnail). The app's
 * live list, with the admins' changes, is allThemes() in lib/themes.ts.
 */
export const COVER_ART: readonly CoverArt[] = BUILT_IN_THEMES;

/**
 * The theme a stored id shows. Notes keep ids from art-01 to art-57 (and th-… for added themes); an art id
 * past the end of the built-ins wraps round onto the ones there are, so every note has a theme.
 */
function resolveArt(id: string | undefined): CoverArt | null {
  if (!id) return null;
  const direct = themeById(id);
  if (direct) return direct;
  const n = /^art-(\d+)$/.exec(id)?.[1];
  const builtIns = allThemes().filter((t) => t.builtIn);
  if (!n || !builtIns.length) return null;
  return builtIns[(Number(n) - 1) % builtIns.length] ?? null;
}
/** A theme's image as a CSS image: 1600 px on regular screens, 3200 px on Retina (2×) ones. */
const artUrl = (id: string | undefined) => {
  const a = resolveArt(id);
  if (!a) return null;
  if (a.image) return `image-set(url(${JSON.stringify(a.image.half)}) 1x, url(${JSON.stringify(a.image.full)}) 2x)`;
  return `image-set("/covers/${a.id}-1x.webp" 1x, "/covers/${a.id}.webp" 2x)`;
};
export const coverArtThumbUrl = (id: string) => {
  const a = resolveArt(id);
  return a?.image ? a.image.thumb : `/covers/${a?.id ?? id}-thumb.webp`;
};

// The "Accent" page accent renders ember (docs/DESIGN_SYSTEM.md); the Mac app loads the web, so it matches.
export const accentVar = (a: DocumentStyle["accent"]) => (a === "accent" ? "var(--color-ember)" : `var(--color-${a})`);
export const softVar = (a: DocumentStyle["accent"]) => (a === "accent" ? "var(--color-ember-soft)" : `var(--color-${a}-soft)`);

/**
 * A note style can also be the person's own image (cover.kind "image", value = its file id). Its signed URL
 * comes from the server (useCoverImageUrl on the client, the share payload on public pages); until it's
 * known the image shows as a quiet placeholder.
 */
export const COVER_IMAGE_PLACEHOLDER = "var(--color-surface-sunken)";
const imageCss = (url: string | null | undefined) => (url ? `url(${JSON.stringify(url)}) center / cover no-repeat` : COVER_IMAGE_PLACEHOLDER);

/** Recommended size for an uploaded note style image (the cover and the page background behind the note). */
export const COVER_IMAGE_HINT = "Best at 2400 × 1500 px (16:10, landscape). PNG, JPEG, WebP or GIF, up to 20 MB.";

export function coverBackground(cover: DocumentCover, style: DocumentStyle, imageUrl?: string | null): string | undefined {
  if (cover.kind === "image" && cover.value) return imageCss(imageUrl);
  // Artwork gets a soft theme tint (none in light, a little espresso in dark) so it sits in the page.
  if (cover.kind === "art" && artUrl(cover.value)) {
    return `linear-gradient(var(--cover-art-tint), var(--cover-art-tint)), ${artUrl(cover.value)} center / cover no-repeat`;
  }
  if (cover.kind === "art") return coverBackground({ kind: "gradient" }, style);
  if (cover.kind === "color") return softVar((cover.value as DocumentStyle["accent"]) ?? style.accent);
  if (cover.kind === "gradient") {
    const a = (cover.value as DocumentStyle["accent"]) ?? style.accent;
    return `radial-gradient(85% 150% at 100% 0%, color-mix(in oklab, ${accentVar(a)} 50%, transparent) 0%, transparent 62%), radial-gradient(70% 130% at 0% 100%, color-mix(in oklab, var(--color-glow-rose) 65%, transparent) 0%, transparent 66%), linear-gradient(135deg, ${softVar(a)} 0%, color-mix(in oklab, ${softVar(a)} 45%, var(--color-surface)) 100%)`;
  }
  return undefined;
}


/** Colour backdrops behind the page (style.backdrop = "color:<id>"). Soft, painterly gradients. */
export const BACKDROP_COLORS: readonly { id: string; name: string; css: string; dark?: boolean }[] = [
  { id: "sky", name: "Sky", css: "linear-gradient(180deg, #7fa9ee 0%, #bcd3f5 42%, #efe1d7 100%)" },
  { id: "dawn", name: "Dawn", css: "linear-gradient(180deg, #f3b9a3 0%, #f4dcd0 50%, #e5e1f3 100%)" },
  { id: "sand", name: "Sand", css: "linear-gradient(180deg, #e2cfae 0%, #f2e9d9 100%)" },
  { id: "sage", name: "Sage", css: "linear-gradient(180deg, #afc6aa 0%, #e2ebdf 100%)" },
  { id: "rose", name: "Rose", css: "linear-gradient(180deg, #eeb2bf 0%, #f8e3e8 100%)" },
  { id: "lavender", name: "Lavender", css: "linear-gradient(180deg, #c2b8ea 0%, #ece8f8 100%)" },
  { id: "stone", name: "Stone", css: "linear-gradient(180deg, #cdcdd2 0%, #ededef 100%)" },
  { id: "slate", name: "Slate", css: "linear-gradient(180deg, #4f5968 0%, #8993a2 100%)", dark: true },
  { id: "forest", name: "Forest", css: "linear-gradient(180deg, #1d3a2d 0%, #3d6a51 100%)", dark: true },
  { id: "midnight", name: "Midnight", css: "linear-gradient(180deg, #0e1119 0%, #262f49 100%)", dark: true },
];

/** "color:none": the page opted out of a backdrop (it no longer follows the cover). */
export const NO_BACKDROP = "color:none";

/**
 * The page's backdrop. It follows the cover image unless the page picked its own backdrop (or none), so
 * choosing a cover sets the mood of the whole page.
 */
export function pageBackdrop(style: DocumentStyle, cover: DocumentCover, imageUrl?: string | null): string | undefined {
  if (style.backdrop === NO_BACKDROP) return undefined;
  if (style.backdrop) return backdropBackground(style.backdrop);
  if (cover.kind === "image" && cover.value) return imageCss(imageUrl);
  if (cover.kind === "art" && artUrl(cover.value)) return `${artUrl(cover.value)} center / cover no-repeat`;
  return cover.kind === "none" ? undefined : coverBackground(cover, style);
}

/** CSS background for a page backdrop value ("art:<id>" | "color:<id>"), or undefined for none. */
export function backdropBackground(backdrop: string | undefined): string | undefined {
  if (!backdrop) return undefined;
  const [kind, id] = backdrop.split(":");
  if (kind === "art" && artUrl(id)) return `${artUrl(id)} center / cover no-repeat`;
  if (kind === "color") return BACKDROP_COLORS.find((c) => c.id === id)?.css;
  return undefined;
}




/** The artwork a note's style uses, if any. */
export function coverArtOf(cover: DocumentCover): CoverArt | null {
  return cover.kind === "art" ? resolveArt(cover.value) : null;
}

/** The colours a note's style gives: its artwork's, or those picked from its own image. */
export type StyleColors = Pick<StylePalette, "paper" | "ink" | "paperDark" | "inkDark"> & Partial<Omit<StylePalette, "paper" | "ink" | "paperDark" | "inkDark" | "tone">>;
export function styleColorsOf(cover: DocumentCover, imagePalette?: StyleColors | null): StyleColors | null {
  if (cover.kind === "image") return imagePalette ?? null;
  return coverArtOf(cover);
}

/** The five text colours and four highlights, as mark ids (see components/editor/commands.ts). */
export const PALETTE_TEXT_SLOTS = ["accent", "moss", "marigold", "plum", "coral"] as const;
export const PALETTE_HIGHLIGHT_SLOTS = ["yellow", "green", "blue", "pink"] as const;

/** CSS variables carrying a style's accent, text and highlight colours (both themes); see editor.css. */
export function paletteVars(colors: StyleColors | null): Record<string, string> | undefined {
  if (!colors?.accent || !colors.accentDark || colors.text?.length !== 5 || colors.textDark?.length !== 5 || colors.highlight?.length !== 4 || colors.highlightDark?.length !== 4) return undefined;
  const vars: Record<string, string> = { "--pal-accent-l": colors.accent, "--pal-accent-d": colors.accentDark };
  PALETTE_TEXT_SLOTS.forEach((slot, i) => {
    vars[`--pal-${slot}-l`] = colors.text![i]!;
    vars[`--pal-${slot}-d`] = colors.textDark![i]!;
  });
  PALETTE_HIGHLIGHT_SLOTS.forEach((slot, i) => {
    vars[`--pal-hl-${slot}-l`] = colors.highlight![i]!;
    vars[`--pal-hl-${slot}-d`] = colors.highlightDark![i]!;
  });
  return vars;
}

/**
 * Attributes for a note's page (`.fb-sheet`): the chosen document and text colours, or (when they're on
 * Auto) a very light page and a dark, high-contrast text colour taken from the note's style (its artwork,
 * or the colours picked from its own image; with dark theme pairs). Plain notes use the theme's page and text.
 * While the page colour is on Auto, the style also colours the accents (checkboxes, quotes, links,
 * underlines, callouts, code) and the text colour and highlight choices (`data-palette`).
 */
export function sheetProps(style: DocumentStyle, cover: DocumentCover, imagePalette?: StyleColors | null): { "data-sheet"?: string; "data-text"?: string; "data-palette"?: string; style?: Record<string, string> } {
  const art = styleColorsOf(cover, imagePalette);
  const sheet = style.sheet ?? (art ? "art" : undefined);
  const text = style.text ?? (art && style.sheet !== "night" ? "art" : undefined);
  const pal = sheet === "art" ? paletteVars(art) : undefined;
  const vars = art ? { "--art-paper": art.paper, "--art-ink": art.ink, "--art-paper-dark": art.paperDark, "--art-ink-dark": art.inkDark, ...pal } : undefined;
  return { "data-sheet": sheet, "data-text": text, "data-palette": pal ? "" : undefined, style: vars };
}
