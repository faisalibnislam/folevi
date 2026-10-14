// Folevi for Windows' icons, from the round mark (packages/design-tokens/brand/source/favicon.svg, a white F on
// a black disc: the same mark the installed web app uses). Writes:
//
//   build/icon.ico        the app, its installer and shortcuts: 16, 24, 32, 48, 64, 128 and 256 px
//   assets/tray.ico       the system tray icon: 16, 20, 24, 32, 40 and 48 px (100% to 300% scaling)
//   assets/icon-48.png    the About box
//
// Each .ico holds every size as its own image (Windows picks the one for the screen's scaling): classic
// 32-bit bitmaps up to 128 px, which every Windows tool reads (NSIS included), and a PNG for 256 px.
//
//   node scripts/windows-icons.mjs      (from apps/desktop; uses the sharp that ships with apps/web's Next)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..");
const repo = resolve(desktop, "../..");
const fromWeb = createRequire(resolve(repo, "apps/web/package.json"));
const sharp = createRequire(fromWeb.resolve("next/package.json"))("sharp");

const mark = readFileSync(resolve(repo, "packages/design-tokens/brand/source/favicon.svg"));
/** The mark at `px` square: raw RGBA pixels, or a PNG. */
const render = (px) => sharp(mark, { density: Math.ceil((72 * px) / 512) + 1 }).resize(px, px);

/** One icon image as a 32-bit bitmap: the header, BGRA rows bottom up, and an all-clear AND mask. */
async function bitmap(px) {
  const rgba = await render(px).ensureAlpha().raw().toBuffer();
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(px, 4);
  header.writeInt32LE(px * 2, 8); // The colour rows and the mask's, stacked.
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(px * px * 4);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const from = (y * px + x) * 4;
      const to = ((px - 1 - y) * px + x) * 4;
      pixels[to] = rgba[from + 2];
      pixels[to + 1] = rgba[from + 1];
      pixels[to + 2] = rgba[from];
      pixels[to + 3] = rgba[from + 3];
    }
  }
  // 1 bit a pixel, rows padded to 4 bytes; all zero (the alpha channel decides).
  const mask = Buffer.alloc(Math.ceil(px / 32) * 4 * px);
  return Buffer.concat([header, pixels, mask]);
}

async function ico(sizes) {
  const images = [];
  for (const px of sizes) images.push({ px, data: px >= 256 ? await render(px).png({ compressionLevel: 9 }).toBuffer() : await bitmap(px) });
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // An icon (not a cursor).
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ px, data }, i) => {
    const at = 6 + 16 * i;
    head.writeUInt8(px >= 256 ? 0 : px, at); // 0 means 256.
    head.writeUInt8(px >= 256 ? 0 : px, at + 1);
    head.writeUInt16LE(1, at + 4);
    head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(data.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map((x) => x.data)]);
}

mkdirSync(resolve(desktop, "build"), { recursive: true });
mkdirSync(resolve(desktop, "assets"), { recursive: true });
writeFileSync(resolve(desktop, "build/icon.ico"), await ico([16, 24, 32, 48, 64, 128, 256]));
writeFileSync(resolve(desktop, "assets/tray.ico"), await ico([16, 20, 24, 32, 40, 48]));
await render(48).png({ compressionLevel: 9 }).toFile(resolve(desktop, "assets/icon-48.png"));
console.log("Wrote build/icon.ico, assets/tray.ico and assets/icon-48.png.");
