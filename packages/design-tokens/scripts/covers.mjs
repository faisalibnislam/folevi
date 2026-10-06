#!/usr/bin/env node
// Builds Folevi's note styles from the images in packages/design-tokens/covers/source/.
//   NN-name-in-words.jpg  →  style art-NN, named "Name in words"
// For each image it writes, into apps/web/public/covers/:
//   art-NN.webp        up to 2400 px (never upscaled): the cover and page background on Retina (2×) screens
//   art-NN-1x.webp     up to 1600 px: the same on regular (1×) screens; picked by CSS image-set()
//   art-NN-thumb.webp  640 px: picker tiles and note-card spines (sharp at 2× for their size)
// and a manifest, packages/design-tokens/covers/covers.json, with each style's colours picked from the image
// by the same engine that reads a person's uploaded image (src/palette.ts): page, text, accent, five text
// colours, four highlights, and whether the cover reads deep or light behind the title.
//   node packages/design-tokens/scripts/covers.mjs
// To add styles, drop more NN-name.jpg files into covers/source and run it again.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { paletteFromPixels } from "../src/palette.ts";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../covers/source");
const out = resolve(here, "../covers");
const webOut = resolve(here, "../../../apps/web/public/covers");
// sharp ships with Next (apps/web); borrow it rather than adding a second copy.
const fromWeb = createRequire(resolve(here, "../../../apps/web/package.json"));
const sharp = createRequire(fromWeb.resolve("next/package.json"))("sharp");

// 2400 px covers the widest page on a 2× screen; 3200 px files ran to 3 MB with no visible gain. Quality is
// lower for the big and small sizes, where the difference doesn't show at the size they're drawn.
const FULL = 2400;
const HALF = 1600;
const THUMB = 640;
const QUALITY = { full: 75, half: 80, thumb: 75 };

const files = readdirSync(source)
  .filter((f) => /^\d{2}-.+\.(jpe?g|png|webp)$/i.test(f))
  .sort();
if (!files.length) throw new Error(`No images in ${source}`);

mkdirSync(webOut, { recursive: true });
// Replace the previous set entirely (older builds wrote SVG meshes).
for (const dir of [out, webOut]) for (const f of readdirSync(dir)) if (/^art-\d+(-thumb|-1x)?\.(svg|webp|png|jpe?g)$/.test(f)) rmSync(resolve(dir, f));

const manifest = [];
for (const file of files) {
  const num = file.slice(0, 2);
  const id = `art-${num}`;
  const words = file.replace(/^\d{2}-/, "").replace(/\.[^.]+$/, "").replace(/-/g, " ");
  const name = words.charAt(0).toUpperCase() + words.slice(1);
  const input = resolve(source, file);
  const meta = await sharp(input).metadata();

  const webp = (quality) => ({ quality, smartSubsample: true, effort: 6 });
  const fit = (px) => ({ width: px, height: px, fit: "inside", withoutEnlargement: true });
  await sharp(input).rotate().resize(fit(FULL)).webp(webp(QUALITY.full)).toFile(resolve(webOut, `${id}.webp`));
  await sharp(input).rotate().resize(fit(HALF)).webp(webp(QUALITY.half)).toFile(resolve(webOut, `${id}-1x.webp`));
  await sharp(input).rotate().resize(THUMB, THUMB, { fit: "cover" }).webp(webp(QUALITY.thumb)).toFile(resolve(webOut, `${id}-thumb.webp`));

  // Colours from a small sample. The cover shows a wide middle strip of the image, so the sample is the
  // image as a 16:10 landscape crop, like the cover.
  const W = 64;
  const H = 40;
  const { data } = await sharp(input).rotate().resize(W, H, { fit: "cover" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const palette = paletteFromPixels(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), W, H);
  manifest.push({ id, name, width: meta.width, height: meta.height, ...palette });
  console.log(`${id}  ${name.padEnd(20)} ${meta.width}×${meta.height}  ${palette.tone}`);
}
writeFileSync(resolve(out, "covers.json"), `${JSON.stringify(manifest, null, 2)}\n`);

// Folder colours are their own palette now (covers/folder-colors.json, edited by hand), not the styles' page colours.
console.log(`wrote ${manifest.length} styles`);
