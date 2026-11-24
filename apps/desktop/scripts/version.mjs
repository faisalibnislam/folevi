#!/usr/bin/env node
// Folevi for Windows takes Folevi's one version (version.json at the repo root, scripts/version.mjs; the owner's
// rule: MAJOR.UPDATE.PATCH, PATCH at least two digits). It never changes it: it only copies it into
// package.json, twice:
//   "foleviVersion"  as Folevi writes it ("1.5.68", "2.0.00"): what the app shows (main.ts FOLEVI_VERSION);
//   "version"        its semver form ("2.0.00" -> "2.0.0"), which Electron, electron-builder, the installer's file
//                    version and electron-updater need. Same numbers, so updates order the same way.
// Run by `pnpm build` and the desktop workflow. `--check` only reports whether package.json is up to date.
// A release cut on this branch before version.json catches up names its version in apps/desktop/RELEASE_VERSION
// (one line, e.g. 1.5.73, agreed with the owner): that wins over version.json for this app only.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");

/** Folevi's version as semver: each part as a plain number (no leading zeros). Throws on anything else. */
export function toSemver(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  if (!m) throw new Error(`Not a Folevi version: ${version}`);
  return m.slice(1, 4).map((n) => BigInt(n).toString()).join(".");
}

export function readFoleviVersion(repo = resolve(root, "../..")) {
  return JSON.parse(readFileSync(join(repo, "version.json"), "utf8")).version;
}

function main() {
  const file = join(root, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  const release = existsSync(join(root, "RELEASE_VERSION")) ? readFileSync(join(root, "RELEASE_VERSION"), "utf8").trim() : "";
  const folevi = release || readFoleviVersion();
  const semver = toSemver(folevi);
  const current = pkg.version === semver && pkg.foleviVersion === folevi;
  if (process.argv.includes("--check")) {
    if (!current) {
      console.error(`apps/desktop/package.json says ${pkg.foleviVersion} (${pkg.version}); version.json says ${folevi}. Run node apps/desktop/scripts/version.mjs.`);
      process.exit(1);
    }
    return;
  }
  if (current) return;
  // Keep the key order (version, then foleviVersion right after it).
  const next = {};
  for (const [k, v] of Object.entries(pkg)) {
    if (k === "foleviVersion") continue;
    next[k] = k === "version" ? semver : v;
    if (k === "version") next.foleviVersion = folevi;
  }
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`apps/desktop: Folevi ${folevi} (${semver})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
