import { COVER_ART, type CoverArt } from "@/lib/cover";
import { artById } from "../product/Replica";

/**
 * The themes with artwork sized for the home page's note (scripts/hero-art.mjs): the first is the site's
 * default. Every other note theme works too (picked from the Style panel's gallery), drawn from its cover.
 */
export const HERO_STYLES = ["art-03", "art-01", "art-30", "art-49", "art-09"].map(artById);
const SIZED = new Set(HERO_STYLES.map((a) => a.id));
const sized = (art: CoverArt) => SIZED.has(art.id);

/** The site's theme from a stored id: any shipped note theme, else the default. */
export const siteArt = (id: string | null | undefined): CoverArt => COVER_ART.find((a) => a.id === id) ?? HERO_STYLES[0]!;

/** The note's cover band: 1080 and 1440 px wide, and 2160 px for Retina screens (a cover's 1600 and 2400 px squares otherwise). */
export const heroBand = (art: CoverArt) => (sized(art) ? `/marketing/hero/${art.id}-band.webp` : `/covers/${art.id}-1x.webp`);
export const heroBandSet = (art: CoverArt) =>
  sized(art)
    ? `${heroBand(art)} 1080w, /marketing/hero/${art.id}-band-lg.webp 1440w, /marketing/hero/${art.id}-band-2x.webp 2160w`
    : `/covers/${art.id}-1x.webp 1600w, /covers/${art.id}.webp 2400w`;
/** The cover on phones (narrower than 640 px): cropped to the phone's shape, 720 × 520 (a cover's 640 px copy otherwise). */
export const heroPhone = (art: CoverArt) => (sized(art) ? `/marketing/hero/${art.id}-phone.webp` : `/covers/${art.id}-thumb.webp`);
/** Below this width the hero shows the phone crop. */
export const HERO_PHONE_MEDIA = "(max-width: 639px)";
/** A small copy for the light behind the page (drawn heavily blurred). */
export const heroGlow = (art: CoverArt) => (sized(art) ? `/marketing/hero/${art.id}-glow.webp` : `/covers/${art.id}-thumb.webp`);
