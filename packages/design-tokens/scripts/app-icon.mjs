#!/usr/bin/env node
// Builds Folevi's app icon (the "Graphite solid" design: a white F, lit, on a graphite tile) for the Mac app,
// the iOS app and the web, from the designed sources in packages/design-tokens/brand/source/app-icon/:
//
//   artwork.png    the icon at 1024 px, already rounded (transparent corners)
//   favicon.ico    16 to 256 px, drawn for small sizes
//   favicon-16.png, favicon-32.png
//
// Apple's systems round the icon themselves, so the Mac and iOS icons use a full-bleed copy of the artwork:
// zoomed a little so its drawn corner falls outside the system's, with what remains of the corners filled
// with the tile's own colours. Writes:
//
//   packages/design-tokens/brand/app-icon/
//     Folevi.icon                                  the Icon Composer document (macOS 26+, iOS 26+)
//     folevi-macos-1024.png, folevi-ios-1024.png   renders of it (needs Icon Composer's ictool, Xcode 26+)
//     macos.iconset/ + Folevi.icns                 every macOS size, for DMGs and older tools
//   apps/desktop/build/Folevi.icon                 Folevi for Mac (electron-builder makes the older .icns from it)
//   apps/ios/ios/App/App/AppIcon.icon              iOS 26 and later
//   apps/ios/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png   iOS 17 to 25 (opaque)
//   apps/web/public/favicon.ico, favicon-16x16.png, favicon-32x32.png
//   apps/web/public/apple-icon.png                 180 px, full bleed (iOS rounds it)
//   apps/web/public/icons/icon-192.png, -512.png   the rounded icon (install icons)
//   apps/web/public/icons/icon-maskable-512.png    full bleed, the F inside Android's safe zone
//
//   node packages/design-tokens/scripts/app-icon.mjs
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const brand = resolve(here, "../brand");
const source = resolve(brand, "source/app-icon");
const out = resolve(brand, "app-icon");
const repo = resolve(here, "../../..");
const web = resolve(repo, "apps/web/public");
const desktop = resolve(repo, "apps/desktop");
const ios = resolve(repo, "apps/ios/ios/App/App");
// sharp ships with Next (apps/web); borrow it rather than adding a second copy.
const fromWeb = createRequire(resolve(repo, "apps/web/package.json"));
const sharp = createRequire(fromWeb.resolve("next/package.json"))("sharp");
const ICTOOL = "/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool";

const SIZE = 1024;
const artwork = resolve(source, "artwork.png");
const save = (img, file) => img.png({ compressionLevel: 9 }).toFile(file);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Fills the see-through parts of an RGBA image by carrying the colours around them outwards ("push-pull"):
 * averaged down to one pixel by coverage, then blended back up smoothly into every gap. Returns opaque RGB.
 */
function fillOut(rgba, size) {
  const levels = [];
  let n = size;
  let c = new Float64Array(n * n * 3);
  let w = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    w[i] = a;
    for (let k = 0; k < 3; k++) c[i * 3 + k] = rgba[i * 4 + k] * a;
  }
  levels.push({ n, c, w });
  while (n > 1) {
    const m = n >> 1;
    const c2 = new Float64Array(m * m * 3);
    const w2 = new Float64Array(m * m);
    for (let y = 0; y < m; y++)
      for (let x = 0; x < m; x++) {
        const j = y * m + x;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const i = (2 * y + dy) * n + 2 * x + dx;
          w2[j] += w[i];
          for (let k = 0; k < 3; k++) c2[j * 3 + k] += c[i * 3 + k];
        }
        // Coverage saturates at one: a fully covered pixel keeps its own colour.
        if (w2[j] > 1) {
          for (let k = 0; k < 3; k++) c2[j * 3 + k] /= w2[j];
          w2[j] = 1;
        }
      }
    n = m;
    c = c2;
    w = w2;
    levels.push({ n, c, w });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const fine = levels[l];
    const coarse = levels[l + 1];
    const cn = coarse.n;
    const at = (x, y, k) => {
      const cx = Math.min(cn - 1, Math.max(0, x));
      const cy = Math.min(cn - 1, Math.max(0, y));
      const i = cy * cn + cx;
      return k < 3 ? coarse.c[i * 3 + k] : coarse.w[i];
    };
    for (let y = 0; y < fine.n; y++)
      for (let x = 0; x < fine.n; x++) {
        const i = y * fine.n + x;
        const gap = 1 - fine.w[i];
        if (gap <= 0) continue;
        // Bilinear sample of the coarser level at this pixel's centre.
        const fx = (x + 0.5) / 2 - 0.5;
        const fy = (y + 0.5) / 2 - 0.5;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const lerp = (k) =>
          (at(x0, y0, k) * (1 - tx) + at(x0 + 1, y0, k) * tx) * (1 - ty) + (at(x0, y0 + 1, k) * (1 - tx) + at(x0 + 1, y0 + 1, k) * tx) * ty;
        for (let k = 0; k < 3; k++) fine.c[i * 3 + k] += gap * lerp(k);
        fine.w[i] += gap * lerp(3);
      }
  }
  const { c: c0, w: w0 } = levels[0];
  const rgb = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = Math.round(c0[i * 3 + k] / Math.max(w0[i], 1e-6));
  return rgb;
}

/** An RGBA image of SIZE px with every see-through pixel filled from its surroundings: opaque PNG. */
async function filled(rgba) {
  const wash = await sharp(fillOut(rgba, SIZE), { raw: { width: SIZE, height: SIZE, channels: 3 } }).blur(8).png().toBuffer();
  const top = await sharp(rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } }).png().toBuffer();
  return sharp(wash).composite([{ input: top }]).removeAlpha().png().toBuffer();
}

/** `image` scaled to `scale` of SIZE, centred on a see-through SIZE px canvas (cropped when larger). */
async function placed(image, scale) {
  const side = Math.round(SIZE * scale);
  let img = sharp(image).resize(side, side);
  if (side > SIZE) {
    const cut = Math.floor((side - SIZE) / 2);
    img = sharp(await img.png().toBuffer()).extract({ left: cut, top: cut, width: SIZE, height: SIZE });
  }
  const at = Math.max(0, Math.round((SIZE - side) / 2));
  return sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await img.png().toBuffer(), left: at, top: at }])
    .raw()
    .toBuffer();
}

// The drawn corner sits about 77 px in along the diagonal, with a bright bevel just inside it; Apple's mask
// corner is about 67 px in. Zoomed 6%, both fall outside the mask (the sides are a plain gradient, so the
// crop loses nothing), and what's left of the corners is filled with the tile's own colours.
const ZOOM = 1.06;

/** The artwork's tile without its rounded corners: 1024 px, opaque. */
async function fullBleed() {
  const { data } = await sharp(artwork).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < SIZE * SIZE; i++) {
    // Drop the faint shadow outside the drawn edge, and the white under every see-through pixel.
    if (data[i * 4 + 3] < 200) data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = data[i * 4 + 3] = 0;
  }
  const art = await sharp(data, { raw: { width: SIZE, height: SIZE, channels: 4 } }).png().toBuffer();
  return filled(await placed(art, ZOOM));
}

const bleed = await fullBleed();

rmSync(out, { recursive: true, force: true });
mkdirSync(resolve(out, "macos.iconset"), { recursive: true });
mkdirSync(resolve(web, "icons"), { recursive: true });

// ---------------------------------------------------------------- the Icon Composer document (macOS, iOS)

// One layer, the full-bleed artwork. Its light and depth are drawn in, so the layer gets no glass of its own;
// the system still adds the edge highlight and draws the dark, clear and tinted appearances from it.
const iconDoc = resolve(out, "Folevi.icon");
mkdirSync(resolve(iconDoc, "Assets"), { recursive: true });
writeFileSync(resolve(iconDoc, "Assets/artwork.png"), bleed);
writeFileSync(
  resolve(iconDoc, "icon.json"),
  json({
    fill: { solid: "srgb:0.10980,0.10980,0.10980,1.00000" },
    groups: [{ layers: [{ "image-name": "artwork.png", name: "Graphite" }] }],
    "supported-platforms": { squares: "shared" },
  }),
);

/** Renders the Icon Composer document with Apple's own renderer. */
function glassRender(platform, rendition, px, file) {
  execFileSync(ICTOOL, [iconDoc, "--export-image", "--output-file", file, "--platform", platform, "--rendition", rendition, "--width", `${px}`, "--height", `${px}`, "--scale", "1"], { stdio: "ignore" });
}
if (existsSync(ICTOOL)) {
  mkdirSync(resolve(out, "previews"), { recursive: true });
  glassRender("macOS", "Default", 1024, resolve(out, "folevi-macos-1024.png"));
  glassRender("iOS", "Default", 1024, resolve(out, "folevi-ios-1024.png"));
  for (const r of ["Dark", "ClearLight", "ClearDark", "TintedLight", "TintedDark"]) glassRender("macOS", r, 512, resolve(out, `previews/macos-${r}.png`));
  for (const size of [16, 32, 128, 256, 512]) {
    glassRender("macOS", "Default", size, resolve(out, `macos.iconset/icon_${size}x${size}.png`));
    glassRender("macOS", "Default", size * 2, resolve(out, `macos.iconset/icon_${size}x${size}@2x.png`));
  }
  try {
    execFileSync("iconutil", ["-c", "icns", resolve(out, "macos.iconset"), "-o", resolve(out, "Folevi.icns")], { stdio: "ignore" });
  } catch {
    console.warn("iconutil not available. Skipped Folevi.icns (the .iconset has every size).");
  }
} else {
  console.warn("Icon Composer's ictool isn't installed. Skipped the renders (the .icon document is still complete).");
}

for (const target of [resolve(desktop, "build/Folevi.icon"), resolve(ios, "AppIcon.icon")]) {
  rmSync(target, { recursive: true, force: true });
  cpSync(iconDoc, target, { recursive: true });
}
// iOS 17 to 25: one opaque 1024 px image (App Store Connect refuses transparency); Xcode makes the rest.
writeFileSync(resolve(ios, "Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"), bleed);

// ---------------------------------------------------------------- the web app

copyFileSync(resolve(source, "favicon.ico"), resolve(web, "favicon.ico"));
copyFileSync(resolve(source, "favicon-16.png"), resolve(web, "favicon-16x16.png"));
copyFileSync(resolve(source, "favicon-32.png"), resolve(web, "favicon-32x32.png"));
await save(sharp(bleed).resize(180, 180), resolve(web, "apple-icon.png"));
await save(sharp(artwork).resize(192, 192), resolve(web, "icons/icon-192.png"));
await save(sharp(artwork).resize(512, 512), resolve(web, "icons/icon-512.png"));
// Android crops a maskable icon to as little as the middle 80% circle, so the F is drawn smaller there.
await save(sharp(await filled(await placed(bleed, 0.9))).resize(512, 512), resolve(web, "icons/icon-maskable-512.png"));

console.log("App icon written.");
