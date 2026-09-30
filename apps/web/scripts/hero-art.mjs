#!/usr/bin/env node
// Sized artwork for the home page hero (a note in one of a few styles), from the covers in public/covers.
// Run from apps/web after `pnpm --filter @folevi/design-tokens covers`: node scripts/hero-art.mjs
//   <id>-band.webp       1080 × 450: the note's cover band on regular (1×) screens
//   <id>-band-2x.webp    2160 × 900: the same on Retina (2×) screens
//   <id>-glow.webp        200 px: the backdrop behind the note, drawn heavily blurred
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// sharp ships with Next; borrow it rather than adding a second copy (as packages/design-tokens/scripts/covers.mjs does).
const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");

/** The styles the hero offers (keep in step with HERO_STYLES in components/marketing/home/HeroNote.tsx). */
const IDS = ["art-03", "art-01", "art-30", "art-49", "art-09"];
const src = resolve(import.meta.dirname, "../public/covers");
const out = resolve(import.meta.dirname, "../public/marketing/hero");
mkdirSync(out, { recursive: true });

const webp = { quality: 74, smartSubsample: true, effort: 6 };
for (const id of IDS) {
  const input = resolve(src, `${id}.webp`);
  await sharp(input).resize(1080, 450, { fit: "cover" }).webp(webp).toFile(resolve(out, `${id}-band.webp`));
  await sharp(input).resize(2160, 900, { fit: "cover" }).webp({ ...webp, quality: 62 }).toFile(resolve(out, `${id}-band-2x.webp`));
  await sharp(input).resize(200, 200, { fit: "cover" }).webp({ ...webp, quality: 55 }).toFile(resolve(out, `${id}-glow.webp`));
}
console.log(`wrote hero artwork for ${IDS.length} styles to ${out}`);
