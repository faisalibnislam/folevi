// Every Mac app build gets the next version: 1.1.0, 1.2.0, 1.3.0… (the number after "1." goes up by one).
// electron-builder takes the app's version (CFBundleShortVersionString and CFBundleVersion, what About
// Folevi shows) from package.json, so this runs first in `pnpm release`.
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(path, "utf8"));
const [major, minor] = String(pkg.version).split(".").map(Number);
pkg.version = `${major || 1}.${(minor || 0) + 1}.0`;
writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`Folevi for Mac ${pkg.version}`);
