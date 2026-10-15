// The classic app icon for iOS 17 to 25, from the same white F the Mac app's Icon Composer file uses
// (apps/desktop/build/Folevi.icon/Assets/glyph.svg) on a black square. iOS 26 and later draw AppIcon.icon
// (that same .icon, copied into the app) instead. Writes ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png:
// one 1024 px image, opaque (App Store Connect refuses an icon with transparency); Xcode makes every other size.
//
//   node scripts/app-icon.mjs      (from apps/ios; uses the sharp that ships with apps/web's Next)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ios = resolve(here, "..");
const repo = resolve(ios, "../..");
const fromWeb = createRequire(resolve(repo, "apps/web/package.json"));
const sharp = createRequire(fromWeb.resolve("next/package.json"))("sharp");

const glyph = readFileSync(resolve(repo, "apps/desktop/build/Folevi.icon/Assets/glyph.svg"));
const out = resolve(ios, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png");

const mark = await sharp(glyph, { density: 72 }).resize(1024, 1024).png().toBuffer();
await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#000000" } })
  .composite([{ input: mark }])
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toFile(out);
console.log(`Wrote ${out}`);
