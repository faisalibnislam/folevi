#!/usr/bin/env node
// Builds Folevi's brand marks from the designed sources in packages/design-tokens/brand/source/:
//
//   favicon.svg   the mark: a white F on a black disc (the in-app mark)
//   logo.svg      the mark and the "Folevi" letterforms (2021 x 512)
//   logo-dark.svg the same for dark mode: a black F on a white disc, and white letters
//   app-icon.svg  the F on a black square (its path draws the menu bar icon)
//
// The app icon (Mac, iOS, favicons and install icons) has its own script: app-icon.mjs. Writes:
//
//   apps/web/public/icon.svg                       the mark as an SVG (older links to it)
//   apps/web/public/brand/folevi-mark.svg, -256.png   the in-app mark (FoleviMark.tsx, the OG image)
//   apps/web/public/brand/folevi-mark-dark.svg        the mark in dark mode (from logo-dark.svg)
//   apps/mac/Folevi/Chrome/StatusItemTemplate.png, @2x.png  the F alone (template) for the menu bar, 16 and 32 px tall
//   apps/web/public/brand/email/folevi-logo@2x.png       the logo for emails (dark letters, light backgrounds)
//   apps/web/public/brand/email/folevi-logo-dark@2x.png  logo-dark.svg, for dark mode
//
//   node packages/design-tokens/scripts/brand-icons.mjs               everything
//   node packages/design-tokens/scripts/brand-icons.mjs --only=logos  just the email logos and the dark mark
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const brand = resolve(here, "../brand");
const repo = resolve(here, "../../..");
const web = resolve(repo, "apps/web/public");
const macChrome = resolve(repo, "apps/mac/Folevi/Chrome");
// sharp ships with Next (apps/web); borrow it rather than adding a second copy.
const fromWeb = createRequire(resolve(repo, "apps/web/package.json"));
const sharp = createRequire(fromWeb.resolve("next/package.json"))("sharp");

const favicon = readFileSync(resolve(brand, "source/favicon.svg"));
const appIconSvg = readFileSync(resolve(brand, "source/app-icon.svg"), "utf8");
const logoSvg = readFileSync(resolve(brand, "source/logo.svg"), "utf8");
const logoDarkSvg = readFileSync(resolve(brand, "source/logo-dark.svg"), "utf8");

/** The F: the one white path in the app icon (512-unit canvas). */
const glyphPath = appIconSvg.match(/<path d="([^"]+)" fill="white"\/>/)?.[1];
if (!glyphPath) throw new Error("app-icon.svg: couldn't find the white F path.");

/** An SVG source (512-unit canvas) rendered sharply at `px` square. */
const render = (svg, px) => sharp(svg, { density: Math.ceil((72 * px) / 512) + 1 }).resize(px, px).png();
const save = (img, file) => img.png({ compressionLevel: 9 }).toFile(file);

// ---------------------------------------------------------------- email

// Emails show the logo as an image, served from https://folevi.com/brand/email/ (packages/email). Each is a
// logo file itself at 240 px wide, shown at 120 px (2x for sharp text on high-density screens), on a
// transparent canvas: logo.svg for light mode, logo-dark.svg for dark mode.
const EMAIL_LOGO_WIDTH = 240;
const EMAIL_LOGO_HEIGHT = 61;

/** The dark mark: the disc, its edge and the F from logo-dark.svg (everything before the letters). */
function darkMark() {
  const parts = [...logoDarkSvg.matchAll(/<(rect|path)\b[^>]*\/>/g)].map((m) => m[0]);
  const letters = parts.findIndex((p) => p.startsWith("<path") && /fill="white"/.test(p));
  if (letters < 1) throw new Error("logo-dark.svg: couldn't find where the letters start.");
  return `<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">\n${parts.slice(0, letters).join("\n")}\n</svg>\n`;
}

async function logos() {
  const dir = resolve(web, "brand/email");
  mkdirSync(dir, { recursive: true });
  for (const [file, svg] of [["folevi-logo@2x.png", logoSvg], ["folevi-logo-dark@2x.png", logoDarkSvg]]) {
    await sharp(Buffer.from(svg), { density: 72 * 2 })
      .resize(EMAIL_LOGO_WIDTH, EMAIL_LOGO_HEIGHT, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9, palette: true, quality: 100, effort: 10 })
      .toFile(resolve(dir, file));
  }
  writeFileSync(resolve(web, "brand/folevi-mark-dark.svg"), darkMark());
}

if (process.argv.includes("--only=logos")) {
  await logos();
  console.log("Logos written.");
  process.exit(0);
}

mkdirSync(resolve(web, "brand"), { recursive: true });

// ---------------------------------------------------------------- Folevi for Mac's menu bar icon

// The F alone, trimmed to the glyph's bounds, black on transparent. The app marks it a template image (the
// system tints it, StatusItem.swift); the @2x file is picked up for Retina.
const glyphSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="150 90 260 340"><path d="${glyphPath}" fill="#000"/></svg>`);
for (const [file, h] of [["StatusItemTemplate.png", 16], ["StatusItemTemplate@2x.png", 32]]) {
  await save(sharp(glyphSvg, { density: 300 }).resize({ height: h, width: Math.round((h * 260) / 340) }), resolve(macChrome, file));
}

// ---------------------------------------------------------------- the web app

copyFileSync(resolve(brand, "source/favicon.svg"), resolve(web, "icon.svg"));
copyFileSync(resolve(brand, "source/favicon.svg"), resolve(web, "brand/folevi-mark.svg"));
await save(render(favicon, 256), resolve(web, "brand/folevi-mark-256.png"));

await logos();

console.log("Brand icons written.");
