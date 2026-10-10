import type { CoverArt } from "@/lib/cover";
import { artById } from "../product/Replica";

/** The themes the home page's note offers, by their ids in covers.json (their sized artwork: scripts/hero-art.mjs). */
export const HERO_STYLES = ["art-03", "art-01", "art-30", "art-49", "art-09"].map(artById);

/** The note's cover band: 1080 and 1440 px wide, and 2160 px for Retina screens. */
export const heroBand = (art: CoverArt) => `/marketing/hero/${art.id}-band.webp`;
export const heroBandSet = (art: CoverArt) =>
  `${heroBand(art)} 1080w, /marketing/hero/${art.id}-band-lg.webp 1440w, /marketing/hero/${art.id}-band-2x.webp 2160w`;
/** The cover on phones (narrower than 640 px): cropped to the phone's shape, 720 × 520. */
export const heroPhone = (art: CoverArt) => `/marketing/hero/${art.id}-phone.webp`;
/** Below this width the hero shows the phone crop. */
export const HERO_PHONE_MEDIA = "(max-width: 639px)";
/** A 200 px copy for the light behind the note (drawn heavily blurred) and the theme picker's tiles. */
export const heroGlow = (art: CoverArt) => `/marketing/hero/${art.id}-glow.webp`;
