#!/usr/bin/env node
// Folevi for Windows' icons, from the same artwork as the iPhone, iPad and Mac icon (apps/ios/ios/App/App/
// AppIcon.icon/Assets/artwork.png) and the round brand mark (apps/web/public/brand/folevi-mark-256.png):
//   build/icon.ico    the app, its installer and its Start menu shortcut: the artwork as a Windows 11 rounded
//                     square (a little margin, as Windows' own icons have), 16 to 256 px
//   assets/icon.ico   the same, for the window and notifications at run time
//   assets/tray.ico   the notification area icon: the round mark, 16 to 32 px (its white F reads on light and dark
//   assets/tray.png   taskbars alike), and a PNG of it for drags and development runs on a Mac
// Run after the artwork changes: node apps/desktop/scripts/icons.mjs (uses sharp from the workspace's dependencies).
// The outputs are committed, so a build needs neither sharp nor the artwork.
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const repo = resolve(root, "../..");
// sharp comes with the workspace (Next uses it); pnpm keeps it in its store rather than beside apps/web.
const sharpDir = readdirSync(join(repo, "node_modules/.pnpm")).find((d) => d.startsWith("sharp@"));
if (!sharpDir) throw new Error("icons: run pnpm install at the repo root first (sharp)");
const sharp = createRequire(join(repo, "node_modules/.pnpm", sharpDir, "node_modules/sharp/package.json"))("sharp");

const ARTWORK = join(repo, "apps/ios/ios/App/App/AppIcon.icon/Assets/artwork.png");
const MARK = join(repo, "apps/web/public/brand/folevi-mark-256.png");

/** An .ico holding PNG images (Windows Vista and later read PNG entries at every size). */
export function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir[o] = size >= 256 ? 0 : size;
    dir[o + 1] = size >= 256 ? 0 : size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

/** The artwork as a rounded square on a clear `size` px canvas (Windows 11's app icon shape). */
async function appIcon(size) {
  const margin = size <= 24 ? 0 : Math.round(size * 0.06);
  const inner = size - margin * 2;
  const radius = Math.round(inner * 0.2);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${inner}" height="${inner}"><rect width="${inner}" height="${inner}" rx="${radius}" ry="${radius}"/></svg>`);
  const art = await sharp(ARTWORK).resize(inner, inner, { kernel: "lanczos3" }).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  return await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: art, left: margin, top: margin }])
    .png()
    .toBuffer();
}

const markIcon = (size) => sharp(MARK).resize(size, size, { kernel: "lanczos3" }).png().toBuffer();

const APP_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const TRAY_SIZES = [16, 20, 24, 32];

const app = ico(await Promise.all(APP_SIZES.map(async (size) => ({ size, png: await appIcon(size) }))));
const tray = ico(await Promise.all(TRAY_SIZES.map(async (size) => ({ size, png: await markIcon(size) }))));
mkdirSync(join(root, "build"), { recursive: true });
mkdirSync(join(root, "assets"), { recursive: true });
writeFileSync(join(root, "build/icon.ico"), app);
writeFileSync(join(root, "assets/icon.ico"), app);
writeFileSync(join(root, "assets/tray.ico"), tray);
writeFileSync(join(root, "assets/tray.png"), await markIcon(32));
writeFileSync(join(root, "build/icon.png"), await appIcon(256));
console.log(`icons: build/icon.ico (${APP_SIZES.join(", ")} px), assets/tray.ico (${TRAY_SIZES.join(", ")} px)`);
