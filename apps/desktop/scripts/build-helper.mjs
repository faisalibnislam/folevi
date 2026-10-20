// Builds the app's small Swift helpers as universal binaries (Apple silicon and Intel) into native-build/,
// which both electron-builder configs copy into the app's Resources (and sign with it):
// - folevi-text (native/recognize-text.swift): reads the words in an image with Apple's Vision, for search in files;
// - folevi-files (native/folevi-files.swift): coordinated reads and writes, placeholders and conflict versions
//   for a local library in iCloud Drive or a File Provider folder (src/library/helper.ts);
// - folevi-ai (native/folevi-ai.swift): Foli AI with Apple's on-device model (FoundationModels, src/ai.ts).
//   FoundationModels is weak-linked (the helper starts on macOS 13 and answers "notSupported" before 26), and
//   with an SDK that lacks it the helper still builds and says so.
// `node scripts/build-helper.mjs folevi-files` builds just the one named.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "native-build");
const HELPERS = { "folevi-text": "recognize-text.swift", "folevi-files": "folevi-files.swift", "folevi-ai": "folevi-ai.swift" };
const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(HELPERS);
mkdirSync(out, { recursive: true });
for (const name of names) {
  const file = HELPERS[name];
  if (!file) throw new Error(`Unknown helper ${name} (${Object.keys(HELPERS).join(", ")})`);
  const source = join(root, "native", file);
  const parts = [];
  for (const arch of ["arm64", "x86_64"]) {
    const part = join(out, `${name}-${arch}`);
    execFileSync("xcrun", ["swiftc", "-O", "-target", `${arch}-apple-macos13.0`, source, "-o", part], { stdio: "inherit" });
    parts.push(part);
  }
  execFileSync("xcrun", ["lipo", "-create", ...parts, "-output", join(out, name)], { stdio: "inherit" });
  for (const p of parts) rmSync(p);
  console.log(`built native-build/${name}`);
}
