// Builds the app's small Swift helpers as universal binaries (Apple silicon and Intel) into native-build/,
// which both electron-builder configs copy into the app's Resources (and sign with it):
// - folevi-text (native/recognize-text.swift): reads the words in an image with Apple's Vision, for search in files;
// - folevi-files (native/folevi-files.swift): coordinated reads and writes, placeholders and conflict versions
//   for a local library in iCloud Drive or a File Provider folder (src/library/helper.ts);
// - folevi-ai (native/folevi-ai.swift): Foli AI with Apple's on-device model (FoundationModels, src/ai.ts).
//   FoundationModels is weak-linked (the helper starts on macOS 13 and answers "notSupported" before 26), and
//   with an SDK that lacks it the helper still builds and says so.
// `node scripts/build-helper.mjs folevi-files` builds just the one named.
//
// folevi-files is also made into a small helper app, native-build/FoleviFiles.app (Contents/Helpers in the
// app), so it can carry Folevi's iCloud container entitlement (native/FoleviFiles.entitlements): macOS allows
// that only for code in a bundle with a provisioning profile, build/FoleviFiles.provisionprofile (Developer ID,
// App ID com.folevi.mac.files, team 7K32QQ2FX8, iCloud.com.folevi). It's signed here, with the hardened runtime and a
// timestamp, by the team's Developer ID Application certificate (FOLEVI_MAC_IDENTITY overrides the name); both
// electron-builder configs leave it as it is (signIgnore). Without that certificate or the profile it's signed
// ad hoc and without the entitlement: it works, but can't make the container.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  if (name === "folevi-files") helperApp(join(out, name));
}

function helperApp(binary) {
  const app = join(out, "FoleviFiles.app");
  rmSync(app, { recursive: true, force: true });
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  copyFileSync(binary, join(app, "Contents", "MacOS", "folevi-files"));
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  // Its own process with no window: no Dock icon, no menu bar. The bundle id is the profile's App ID.
  const info = {
    // Its own App ID: sharing the app's (com.folevi.mac) made macOS apply this helper's LSUIElement to Folevi
    // itself, which then ran with no Dock icon and no menu bar.
    CFBundleIdentifier: "com.folevi.mac.files",
    CFBundleName: "FoleviFiles",
    CFBundleDisplayName: "Folevi Files",
    CFBundleExecutable: "folevi-files",
    CFBundlePackageType: "APPL",
    CFBundleInfoDictionaryVersion: "6.0",
    CFBundleShortVersionString: version,
    CFBundleVersion: version,
    LSMinimumSystemVersion: "13.0",
    LSUIElement: true,
    LSBackgroundOnly: true,
    NSHumanReadableCopyright: "Copyright © 2026 Folevi",
  };
  writeFileSync(join(app, "Contents", "Info.plist"), plist(info));
  const profile = join(root, "build", "FoleviFiles.provisionprofile");
  const identity = process.env.FOLEVI_MAC_IDENTITY || "Developer ID Application: Abu Mohammad Faisal (7K32QQ2FX8)";
  const identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
  if (existsSync(profile) && identities.includes(`"${identity}"`)) {
    copyFileSync(profile, join(app, "Contents", "embedded.provisionprofile"));
    execFileSync("codesign", ["--force", "--options", "runtime", "--timestamp", "--entitlements", join(root, "native", "FoleviFiles.entitlements"), "--sign", identity, app], { stdio: "inherit" });
    execFileSync("codesign", ["--verify", "--strict", "--verbose=1", app], { stdio: "inherit" });
    console.log(`built native-build/FoleviFiles.app (signed by ${identity}, with Folevi's iCloud container)`);
  } else {
    execFileSync("codesign", ["--force", "--sign", "-", app], { stdio: "inherit" });
    console.warn(`built native-build/FoleviFiles.app signed ad hoc, without the iCloud container: ${existsSync(profile) ? `no "${identity}" in the keychain` : "no build/FoleviFiles.provisionprofile"}`);
  }
}

/** A property list of strings and booleans. */
function plist(dict) {
  const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = Object.entries(dict)
    .map(([k, v]) => `\t<key>${esc(k)}</key>\n\t${typeof v === "boolean" ? `<${v}/>` : `<string>${esc(v)}</string>`}`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>\n`;
}
