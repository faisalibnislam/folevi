// Builds folevi-text (native/recognize-text.swift), the small helper that reads the words in an image with
// Apple's Vision for search in files. A universal binary (Apple silicon and Intel), into native-build/,
// which both electron-builder configs copy into the app's Resources (and sign with it).
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "native-build");
const source = join(root, "native", "recognize-text.swift");
mkdirSync(out, { recursive: true });
const parts = [];
for (const arch of ["arm64", "x86_64"]) {
  const part = join(out, `folevi-text-${arch}`);
  execFileSync("xcrun", ["swiftc", "-O", "-target", `${arch}-apple-macos13.0`, source, "-o", part], { stdio: "inherit" });
  parts.push(part);
}
execFileSync("xcrun", ["lipo", "-create", ...parts, "-output", join(out, "folevi-text")], { stdio: "inherit" });
for (const p of parts) rmSync(p);
console.log("built native-build/folevi-text");
