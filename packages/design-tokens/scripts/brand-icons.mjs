#!/usr/bin/env node
// Builds Folevi's icons from the designed brand sources in packages/design-tokens/brand/source/:
//
//   favicon.svg   the mark: a white F on a black disc (also the in-app mark)
//   logo.svg      the mark and the "Folevi" letterforms (2021 x 512)
//   logo-dark.svg the same for dark mode: a black F on a white disc, and white letters
//   app-icon.svg  the F on a black square, edge to edge, for the macOS and iOS icons
//
// The macOS / iOS icon gets Apple's Liquid Glass treatment as an Icon Composer document (Folevi.icon):
// a black background and the F as a glass layer (specular highlights, translucency, shadow), which the
// system renders in every appearance: default, dark, clear and tinted. When Icon Composer's `ictool`
// is installed (Xcode 26+), flat PNG renders of it are written too. Writes:
//
//   apps/web/public/icon.svg                       favicon
//   apps/web/public/brand/folevi-mark.svg, -256.png   the in-app mark (FoleviMark.tsx, the OG image)
//   apps/web/public/brand/folevi-mark-dark.svg        the mark in dark mode (from logo-dark.svg)
//   apps/web/public/apple-icon.png                 180 px, full bleed (iOS rounds it)
//   apps/web/public/icons/icon-192.png, -512.png   the round mark (install icons)
//   apps/web/public/icons/icon-maskable-512.png    full bleed (Android masks it)
//   apps/desktop/build/icon.icns                   Folevi for Mac's icon (a copy of Folevi.icns, below)
//   apps/desktop/assets/trayTemplate.png, @2x.png  the F alone (template) for the menu bar, 16 and 32 px tall
//   apps/web/public/brand/email/folevi-logo@2x.png       the logo for emails (dark letters, light backgrounds)
//   apps/web/public/brand/email/folevi-logo-dark@2x.png  logo-dark.svg, for dark mode
//   packages/design-tokens/brand/app-icon/
//     Folevi.icon                                  the Liquid Glass icon (macOS and iOS)
//     folevi-macos-1024.png, folevi-ios-1024.png   renders of it (default appearance)
//     previews/                                    macOS dark, clear and tinted renders
//     macos.iconset/ + Folevi.icns                 every macOS size, for DMGs and older tools
//
//   node packages/design-tokens/scripts/brand-icons.mjs               everything
//   node packages/design-tokens/scripts/brand-icons.mjs --only=logos  just the email logos and the dark mark
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const brand = resolve(here, "../brand");
const out = resolve(brand, "app-icon");
const repo = resolve(here, "../../..");
const web = resolve(repo, "apps/web/public");
const desktop = resolve(repo, "apps/desktop");
// sharp ships with Next (apps/web); borrow it rather than adding a second copy.
const fromWeb = createRequire(resolve(repo, "apps/web/package.json"));
const sharp = createRequire(fromWeb.resolve("next/package.json"))("sharp");
const ICTOOL = "/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool";

const favicon = readFileSync(resolve(brand, "source/favicon.svg"));
const appIconSvg = readFileSync(resolve(brand, "source/app-icon.svg"), "utf8");
const appIcon = Buffer.from(appIconSvg);
const logoSvg = readFileSync(resolve(brand, "source/logo.svg"), "utf8");
const logoDarkSvg = readFileSync(resolve(brand, "source/logo-dark.svg"), "utf8");

/** The F: the one white path in the app icon (512-unit canvas). */
const glyphPath = appIconSvg.match(/<path d="([^"]+)" fill="white"\/>/)?.[1];
if (!glyphPath) throw new Error("app-icon.svg: couldn't find the white F path.");

/** An SVG source (512-unit canvas) rendered sharply at `px` square. */
const render = (svg, px) => sharp(svg, { density: Math.ceil((72 * px) / 512) + 1 }).resize(px, px).png();
const save = (img, file) => img.png({ compressionLevel: 9 }).toFile(file);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

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

rmSync(out, { recursive: true, force: true });
mkdirSync(resolve(out, "macos.iconset"), { recursive: true });
mkdirSync(resolve(out, "previews"), { recursive: true });
mkdirSync(resolve(web, "icons"), { recursive: true });
mkdirSync(resolve(web, "brand"), { recursive: true });

// ---------------------------------------------------------------- the Liquid Glass icon (macOS, iOS)

const iconDoc = resolve(out, "Folevi.icon");
mkdirSync(resolve(iconDoc, "Assets"), { recursive: true });
// Icon Composer layers are drawn on a 1024-point canvas.
writeFileSync(
  resolve(iconDoc, "Assets/glyph.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 512 512"><path d="${glyphPath}" fill="#FFFFFF"/></svg>\n`,
);
writeFileSync(
  resolve(iconDoc, "icon.json"),
  json({
    fill: { solid: "srgb:0.00000,0.00000,0.00000,1.00000" },
    groups: [
      {
        layers: [{ glass: true, "image-name": "glyph.svg", name: "F" }],
        shadow: { kind: "neutral", opacity: 0.5 },
        specular: true,
        translucency: { enabled: true, value: 0.5 },
      },
    ],
    "supported-platforms": { squares: "shared" },
  }),
);

/** macOS without Icon Composer: the artwork as an 824 px rounded tile on the 1024 canvas, with a shadow. */
async function flatMacIcon(px) {
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

const glass = existsSync(ICTOOL);
/** Renders the Icon Composer document with Apple's own renderer. */
function glassRender(platform, rendition, px, file) {
  execFileSync(ICTOOL, [iconDoc, "--export-image", "--output-file", file, "--platform", platform, "--rendition", rendition, "--width", `${px}`, "--height", `${px}`, "--scale", "1"], { stdio: "ignore" });
}
if (glass) {
  glassRender("macOS", "Default", 1024, resolve(out, "folevi-macos-1024.png"));
  glassRender("iOS", "Default", 1024, resolve(out, "folevi-ios-1024.png"));
  for (const r of ["Dark", "ClearLight", "ClearDark", "TintedLight", "TintedDark"]) glassRender("macOS", r, 512, resolve(out, `previews/macos-${r}.png`));
  for (const size of [16, 32, 128, 256, 512]) {
    glassRender("macOS", "Default", size, resolve(out, `macos.iconset/icon_${size}x${size}.png`));
    glassRender("macOS", "Default", size * 2, resolve(out, `macos.iconset/icon_${size}x${size}@2x.png`));
  }
} else {
  console.warn("Icon Composer's ictool isn't installed. Wrote flat PNG icons (the .icon document is still complete).");
  await save(await flatMacIcon(1024), resolve(out, "folevi-macos-1024.png"));
  await save(render(appIcon, 1024), resolve(out, "folevi-ios-1024.png"));
  for (const size of [16, 32, 128, 256, 512]) {
    await save(await flatMacIcon(size), resolve(out, `macos.iconset/icon_${size}x${size}.png`));
    await save(await flatMacIcon(size * 2), resolve(out, `macos.iconset/icon_${size}x${size}@2x.png`));
  }
}
try {
  execFileSync("iconutil", ["-c", "icns", resolve(out, "macos.iconset"), "-o", resolve(out, "Folevi.icns")], { stdio: "ignore" });
  // Folevi for Mac (Electron, apps/desktop) is packaged with it.
  mkdirSync(resolve(desktop, "build"), { recursive: true });
  copyFileSync(resolve(out, "Folevi.icns"), resolve(desktop, "build/icon.icns"));
} catch {
  console.warn("iconutil not available. Skipped Folevi.icns and apps/desktop/build/icon.icns (the .iconset has every size).");
}

// ---------------------------------------------------------------- Folevi for Mac's menu bar icon

// The F alone, trimmed to the glyph's bounds, black on transparent. Electron treats files named
// *Template.png as template images (the system tints them); the @2x file is picked up for Retina.
const glyphSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="150 90 260 340"><path d="${glyphPath}" fill="#000"/></svg>`);
mkdirSync(resolve(desktop, "assets"), { recursive: true });
for (const [file, h] of [["trayTemplate.png", 16], ["trayTemplate@2x.png", 32]]) {
  await save(sharp(glyphSvg, { density: 300 }).resize({ height: h, width: Math.round((h * 260) / 340) }), resolve(desktop, "assets", file));
}

// ---------------------------------------------------------------- the web app

copyFileSync(resolve(brand, "source/favicon.svg"), resolve(web, "icon.svg"));
copyFileSync(resolve(brand, "source/favicon.svg"), resolve(web, "brand/folevi-mark.svg"));
await save(render(favicon, 256), resolve(web, "brand/folevi-mark-256.png"));
await save(render(appIcon, 180), resolve(web, "apple-icon.png"));
await save(render(favicon, 192), resolve(web, "icons/icon-192.png"));
await save(render(favicon, 512), resolve(web, "icons/icon-512.png"));
await save(render(appIcon, 512), resolve(web, "icons/icon-maskable-512.png"));

await logos();

console.log(`Brand icons written${glass ? " (Liquid Glass renders by Icon Composer)" : ""}.`);
