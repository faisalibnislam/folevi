#!/usr/bin/env node
// Builds Folevi's icons from the designed brand sources in packages/design-tokens/brand/source/:
//
//   favicon.svg   the mark: a black folio with a white clasp on a rounded tile (also the in-app mark)
//   logo.svg      the mark and the "Folevi" letterforms
//   app-icon.svg  the same artwork edge to edge, for app icons (the system or this script applies the shape)
//
// The artwork already carries its Liquid Glass lighting, so it's used as designed. Writes:
//   apps/web/public/icon.svg                       favicon
//   apps/web/public/brand/folevi-mark.svg, -256.png   the in-app mark (FoleviMark.tsx, the OG image)
//   apps/web/public/apple-icon.png                 180 px, full bleed (iOS rounds it)
//   apps/web/public/icons/icon-192.png, -512.png   rounded tile (install icons)
//   apps/web/public/icons/icon-maskable-512.png    full bleed (Android masks it)
//   apps/macos/…/Assets.xcassets/FoleviMark.imageset   the mark for the Mac app's UI
//   packages/design-tokens/brand/app-icon/
//     folevi-app-icon-1024.png                     iOS / iPadOS (full bleed)
//     folevi-macos-1024.png                        macOS: rounded tile on the 1024 canvas with margin and shadow
//     macos.iconset/ + Folevi.icns                 every macOS size (icns only when `iconutil` exists)
//
//   node packages/design-tokens/scripts/brand-icons.mjs
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const brand = resolve(here, "../brand");
const out = resolve(brand, "app-icon");
const web = resolve(here, "../../../apps/web/public");
const macAssets = resolve(here, "../../../apps/macos/Folevi/Resources/Assets.xcassets");
// sharp ships with Next (apps/web); borrow it rather than adding a second copy.
const fromWeb = createRequire(resolve(here, "../../../apps/web/package.json"));
const sharp = createRequire(fromWeb.resolve("next/package.json"))("sharp");

const favicon = readFileSync(resolve(brand, "source/favicon.svg"));
const appIcon = readFileSync(resolve(brand, "source/app-icon.svg"));

/** An SVG source rendered sharply at `px` square. */
const render = (svg, px) => sharp(svg, { density: Math.ceil((72 * px) / 236) + 1 }).resize(px, px).png();
const save = (img, file) => img.png({ compressionLevel: 9 }).toFile(file);

/** macOS: the artwork as an 824 px rounded tile inside the 1024 canvas, with a soft drop shadow. */
async function macIcon(px) {
  const k = px / 1024;
  const body = Math.round(824 * k);
  const margin = Math.round(100 * k);
  const r = 185.4 * k;
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${body}" height="${body}"><rect width="${body}" height="${body}" rx="${r}" fill="#fff"/></svg>`);
  const tile = await render(appIcon, body).composite([{ input: mask, blend: "dest-in" }]).toBuffer();
  const shadow = await sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"><rect x="${margin}" y="${margin + 12 * k}" width="${body}" height="${body}" rx="${r}" fill="rgb(0,0,0)" fill-opacity="0.28"/></svg>`),
  )
    .blur(Math.max(0.3, 14 * k))
    .toBuffer();
  return sharp({ create: { width: px, height: px, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([
    { input: shadow },
    { input: tile, left: margin, top: margin },
  ]);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(resolve(out, "macos.iconset"), { recursive: true });
mkdirSync(resolve(web, "icons"), { recursive: true });
mkdirSync(resolve(web, "brand"), { recursive: true });

// Apps.
await save(render(appIcon, 1024), resolve(out, "folevi-app-icon-1024.png"));
await save(await macIcon(1024), resolve(out, "folevi-macos-1024.png"));
for (const size of [16, 32, 128, 256, 512]) {
  await save(await macIcon(size), resolve(out, `macos.iconset/icon_${size}x${size}.png`));
  await save(await macIcon(size * 2), resolve(out, `macos.iconset/icon_${size}x${size}@2x.png`));
}
try {
  execFileSync("iconutil", ["-c", "icns", resolve(out, "macos.iconset"), "-o", resolve(out, "Folevi.icns")], { stdio: "ignore" });
} catch {
  console.warn("iconutil not available — skipped Folevi.icns (the .iconset has every size).");
}
// The Mac app: its icon and the in-app mark.
for (const size of [16, 32, 128, 256, 512]) {
  for (const suffix of ["", "@2x"]) {
    copyFileSync(resolve(out, `macos.iconset/icon_${size}x${size}${suffix}.png`), resolve(macAssets, `AppIcon.appiconset/icon_${size}x${size}${suffix}.png`));
  }
}
const markSet = resolve(macAssets, "FoleviMark.imageset");
mkdirSync(markSet, { recursive: true });
await save(render(favicon, 128), resolve(markSet, "folevi-mark.png"));
await save(render(favicon, 256), resolve(markSet, "folevi-mark@2x.png"));
writeFileSync(
  resolve(markSet, "Contents.json"),
  `${JSON.stringify(
    {
      images: [
        { filename: "folevi-mark.png", idiom: "universal", scale: "1x" },
        { filename: "folevi-mark@2x.png", idiom: "universal", scale: "2x" },
      ],
      info: { author: "xcode", version: 1 },
    },
    null,
    2,
  )}\n`,
);

// The web app.
copyFileSync(resolve(brand, "source/favicon.svg"), resolve(web, "icon.svg"));
copyFileSync(resolve(brand, "source/favicon.svg"), resolve(web, "brand/folevi-mark.svg"));
await save(render(favicon, 256), resolve(web, "brand/folevi-mark-256.png"));
await save(render(appIcon, 180), resolve(web, "apple-icon.png"));
await save(render(favicon, 192), resolve(web, "icons/icon-192.png"));
await save(render(favicon, 512), resolve(web, "icons/icon-512.png"));
await save(render(appIcon, 512), resolve(web, "icons/icon-maskable-512.png"));
console.log("Brand icons written.");
