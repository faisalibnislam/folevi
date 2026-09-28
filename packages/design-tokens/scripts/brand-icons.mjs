#!/usr/bin/env node
// Builds Folevi's icons from the brand sources in packages/design-tokens/brand/source/.
//
// The favicon stays flat (it must read at 16 px). The app icons — Mac, iPhone/iPad, the web's
// home-screen and install icons — get a Liquid Glass treatment: a softly lit background and a glass "F"
// with a bright rim along its top-left edges, a gloss on its upper faces, a lit lower edge and a soft
// contact shadow.
//
// Writes:
//   apps/web/public/icon.svg                       favicon (flat, as designed)
//   apps/web/public/apple-icon.png                 180 px, full bleed (iOS rounds it)
//   apps/web/public/icons/icon-192.png, -512.png   rounded tile (install icons)
//   apps/web/public/icons/icon-maskable-512.png    full bleed (Android masks it)
//   packages/design-tokens/brand/app-icon/
//     folevi-app-icon(.svg|-1024.png)              iOS / iPadOS, light (full bleed; the system rounds it)
//     folevi-app-icon-dark(.svg|-1024.png)         iOS dark appearance
//     folevi-macos(.svg|-1024.png)                 macOS: rounded tile on the 1024 canvas with margin and shadow
//     macos.iconset/ + Folevi.icns                 every macOS size (icns only when `iconutil` exists)
//     icon-composer/background.svg, glyph.svg      flat layers for Apple's Icon Composer, which applies the
//                                                  system's live Liquid Glass (the recommended route for the apps)
//   node packages/design-tokens/scripts/brand-icons.mjs
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const brand = resolve(here, "../brand");
const out = resolve(brand, "app-icon");
const web = resolve(here, "../../../apps/web/public");
// sharp ships with Next (apps/web); borrow it rather than adding a second copy.
const fromWeb = createRequire(resolve(here, "../../../apps/web/package.json"));
const sharp = createRequire(fromWeb.resolve("next/package.json"))("sharp");

// The "F" on the 109-unit tile (from source/app-icon.svg).
const STEM = "M109 19.4648V34.9625H40.1279C37.8455 34.9625 35.9952 36.8127 35.9952 39.0952V109H20.4976V25.6639C20.4976 22.2402 23.273 19.4648 26.6966 19.4648H109Z";
const BAR = "M69.8391 53.6592C71.5509 53.6592 72.9386 55.0469 72.9386 56.7587V66.0573C72.9386 67.7691 71.5509 69.1568 69.8391 69.1568H51.4931C49.7813 69.1568 48.3936 67.7691 48.3936 66.0573V56.7587C48.3936 55.0469 49.7813 53.6592 51.4931 53.6592L69.8391 53.6592Z";
// For the glass, the stem and top bar run past the canvas (which clips them) so their cut ends never get a
// rim of light — the "F" should read as continuing off the edge, as in the flat design.
const STEM_BLEED = STEM.replace("M109 19.4648", "M118 19.4648").replace("V109H20.4976", "V118H20.4976").replace("H109Z", "H118Z");
const GLYPH = `<path d="${STEM_BLEED}"/><path d="${BAR}"/>`;
const FLAT_GLYPH = `<path d="${STEM}"/><path d="${BAR}"/>`;

/** The glass artwork on the 109-unit square (no outer shape). */
function artwork(dark) {
  const c = dark
    ? { bgTop: "#2b2c33", bgBottom: "#0b0b0e", glow: 0.12, bodyA: "#ffffff", bodyB: "#c6c8d1", rim: 1, lowRim: 0.55, gloss: 0.9, shadow: 0.6, contact: 0.7 }
    : { bgTop: "#ffffff", bgBottom: "#e3e5eb", glow: 0.95, bodyA: "#43444d", bodyB: "#040405", rim: 0.9, lowRim: 0.32, gloss: 0.4, shadow: 0.22, contact: 0.28 };
  return `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.bgTop}"/><stop offset="1" stop-color="${c.bgBottom}"/></linearGradient>
    <radialGradient id="glow" cx="0.2" cy="0.1" r="0.8"><stop offset="0" stop-color="#fff" stop-opacity="${c.glow}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="body" gradientUnits="userSpaceOnUse" x1="22" y1="18" x2="78" y2="104"><stop offset="0" stop-color="${c.bodyA}"/><stop offset="1" stop-color="${c.bodyB}"/></linearGradient>
    <linearGradient id="rim" gradientUnits="userSpaceOnUse" x1="20" y1="19" x2="74" y2="104">
      <stop offset="0" stop-color="#fff" stop-opacity="${c.rim}"/><stop offset="0.3" stop-color="#fff" stop-opacity="0.12"/>
      <stop offset="0.75" stop-color="#fff" stop-opacity="0.04"/><stop offset="1" stop-color="#fff" stop-opacity="${c.lowRim}"/>
    </linearGradient>
    <linearGradient id="glossTop" gradientUnits="userSpaceOnUse" x1="0" y1="19.4" x2="0" y2="29"><stop offset="0" stop-color="#fff" stop-opacity="${c.gloss}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="glossBar" gradientUnits="userSpaceOnUse" x1="0" y1="53.6" x2="0" y2="61"><stop offset="0" stop-color="#fff" stop-opacity="${c.gloss}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="glossStem" gradientUnits="userSpaceOnUse" x1="20.4" y1="0" x2="27" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="${c.gloss * 0.7}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <clipPath id="glyph">${GLYPH}</clipPath>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur stdDeviation="2.6"/></filter>
    <filter id="contact" x="-10%" y="-10%" width="120%" height="130%"><feGaussianBlur stdDeviation="0.8"/></filter>
  </defs>
  <rect width="109" height="109" fill="url(#bg)"/>
  <rect width="109" height="109" fill="url(#glow)"/>
  <g fill="#000" opacity="${c.shadow}" transform="translate(0 3.2)" filter="url(#soft)">${GLYPH}</g>
  <g fill="#000" opacity="${c.contact}" transform="translate(0 0.9)" filter="url(#contact)">${GLYPH}</g>
  <g fill="url(#body)">${GLYPH}</g>
  <g clip-path="url(#glyph)">
    <rect x="0" y="19.4" width="109" height="10" fill="url(#glossTop)"/>
    <rect x="48" y="53.6" width="26" height="8" fill="url(#glossBar)"/>
    <rect x="20.4" y="19" width="7" height="90" fill="url(#glossStem)"/>
    <g fill="none" stroke="url(#rim)" stroke-width="2">${GLYPH}</g>
  </g>`;
}

/** A rim of light around a rounded tile: bright along the top, faint along the bottom (Liquid Glass edge). */
const tileEdge = (x, y, size, r, dark) => `
  <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${dark ? 0.35 : 1}"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="${dark ? 0.12 : 0.6}"/></linearGradient>
  <rect x="${x + 0.6}" y="${y + 0.6}" width="${size - 1.2}" height="${size - 1.2}" rx="${r - 0.6}" fill="none" stroke="url(#edge)" stroke-width="1.2"/>
  <rect x="${x + 0.25}" y="${y + 0.25}" width="${size - 0.5}" height="${size - 0.5}" rx="${r - 0.25}" fill="none" stroke="${dark ? "#ffffff" : "#000000"}" stroke-opacity="${dark ? 0.12 : 0.08}" stroke-width="0.5"/>`;

/** iOS / maskable: the artwork edge to edge — the system applies its own shape. */
const bleedSvg = (px, dark = false) => `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 109 109">${artwork(dark)}</svg>`;

/** A rounded tile with transparent corners (web install icons). */
const tileSvg = (px) => `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 109 109">
  <defs><clipPath id="tile"><rect width="109" height="109" rx="24"/></clipPath></defs>
  <g clip-path="url(#tile)">${artwork(false)}</g>${tileEdge(0, 0, 109, 24, false)}</svg>`;

/** macOS: the tile sits inside the 1024 canvas (824 px body, 100 px margin) with a soft drop shadow. */
function macSvg(px) {
  const k = 109 / 824; // canvas units per pixel of the 824 px body
  const margin = 100 * k;
  const canvas = 1024 * k;
  const r = 185.4 * k; // Apple's macOS icon corner radius at 1024
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${-margin} ${-margin} ${canvas} ${canvas}">
  <defs>
    <clipPath id="tile"><rect width="109" height="109" rx="${r}"/></clipPath>
    <filter id="drop" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur stdDeviation="${10 * k}"/></filter>
  </defs>
  <rect width="109" height="109" rx="${r}" fill="#000" opacity="0.28" transform="translate(0 ${10 * k})" filter="url(#drop)"/>
  <g clip-path="url(#tile)">${artwork(false)}</g>${tileEdge(0, 0, 109, r, false)}</svg>`;
}

const png = (svg, file) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(file);

rmSync(out, { recursive: true, force: true });
mkdirSync(resolve(out, "macos.iconset"), { recursive: true });
mkdirSync(resolve(out, "icon-composer"), { recursive: true });
mkdirSync(resolve(web, "icons"), { recursive: true });

// Sources for design tools.
writeFileSync(resolve(out, "folevi-app-icon.svg"), bleedSvg(1024));
writeFileSync(resolve(out, "folevi-app-icon-dark.svg"), bleedSvg(1024, true));
writeFileSync(resolve(out, "folevi-macos.svg"), macSvg(1024));
writeFileSync(resolve(out, "icon-composer/background.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 109 109"><rect width="109" height="109" fill="#fff"/></svg>`);
writeFileSync(resolve(out, "icon-composer/glyph.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 109 109"><g fill="#000">${FLAT_GLYPH}</g></svg>`);

await png(bleedSvg(1024), resolve(out, "folevi-app-icon-1024.png"));
await png(bleedSvg(1024, true), resolve(out, "folevi-app-icon-dark-1024.png"));
await png(macSvg(1024), resolve(out, "folevi-macos-1024.png"));
for (const size of [16, 32, 128, 256, 512]) {
  await png(macSvg(size), resolve(out, `macos.iconset/icon_${size}x${size}.png`));
  await png(macSvg(size * 2), resolve(out, `macos.iconset/icon_${size}x${size}@2x.png`));
}
try {
  execFileSync("iconutil", ["-c", "icns", resolve(out, "macos.iconset"), "-o", resolve(out, "Folevi.icns")], { stdio: "ignore" });
} catch {
  console.warn("iconutil not available — skipped Folevi.icns (the .iconset has every size).");
}

// The web app.
copyFileSync(resolve(brand, "source/favicon.svg"), resolve(web, "icon.svg"));
await png(bleedSvg(180), resolve(web, "apple-icon.png"));
await png(tileSvg(192), resolve(web, "icons/icon-192.png"));
await png(tileSvg(512), resolve(web, "icons/icon-512.png"));
await png(bleedSvg(512), resolve(web, "icons/icon-maskable-512.png"));
console.log("Brand icons written.");
