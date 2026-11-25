#!/usr/bin/env node
// Folevi for Windows and Linux's icons, from the same artwork as the iPhone, iPad and Mac icon (apps/ios/ios/App/
// App/AppIcon.icon/Assets/artwork.png) and the round brand mark (apps/web/public/brand/folevi-mark-256.png):
//   build/icon-1024.png   the artwork as a rounded square on a clear canvas (Windows 11's and GNOME's app icon
//                         shape), which `tauri icon` turns into src-tauri/icons/ (icon.ico, the PNG sizes)
//   src-tauri/icons/tray.png  the notification area icon: the round mark (its white F reads on light and dark)
//   packaging/linux/icons/<n>x<n>.png  Linux's hicolor sizes (16 to 512) from build/icon-1024.png, for the .deb, .rpm,
//                         AppImage, Flatpak and Snap (tauri.linux.conf.json and the packaging read these)
// Run after the artwork changes: node apps/desktop/scripts/icons.mjs (sharp from the workspace's dependencies).
// The outputs are committed, so a build needs neither sharp nor the artwork.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const repo = resolve(root, "../..");
const sharpDir = readdirSync(join(repo, "node_modules/.pnpm")).find((d) => d.startsWith("sharp@"));
if (!sharpDir) throw new Error("icons: run pnpm install at the repo root first (sharp)");
const sharp = createRequire(join(repo, "node_modules/.pnpm", sharpDir, "node_modules/sharp/package.json"))("sharp");

const ARTWORK = join(repo, "apps/ios/ios/App/App/AppIcon.icon/Assets/artwork.png");
const MARK = join(repo, "apps/web/public/brand/folevi-mark-256.png");

const size = 1024;
const margin = Math.round(size * 0.06);
const inner = size - margin * 2;
const radius = Math.round(inner * 0.2);
const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${inner}" height="${inner}"><rect width="${inner}" height="${inner}" rx="${radius}" ry="${radius}"/></svg>`);
const art = await sharp(ARTWORK).resize(inner, inner, { kernel: "lanczos3" }).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
const icon = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: art, left: margin, top: margin }]).png().toBuffer();
mkdirSync(join(root, "build"), { recursive: true });
writeFileSync(join(root, "build/icon-1024.png"), icon);
const r = spawnSync(join(root, "node_modules/.bin/tauri"), ["icon", "build/icon-1024.png", "-o", "src-tauri/icons"], { cwd: root, stdio: "inherit" });
if (r.status !== 0) process.exit(r.status ?? 1);
writeFileSync(join(root, "src-tauri/icons/tray.png"), await sharp(MARK).resize(32, 32, { kernel: "lanczos3" }).png().toBuffer());
const linux = join(repo, "packaging/linux/icons");
mkdirSync(linux, { recursive: true });
for (const n of [16, 22, 24, 32, 48, 64, 128, 256, 512]) {
  writeFileSync(join(linux, `${n}x${n}.png`), await sharp(icon).resize(n, n, { kernel: "lanczos3" }).png().toBuffer());
}
console.log("icons: src-tauri/icons/ and packaging/linux/icons/ from build/icon-1024.png, and tray.png");
