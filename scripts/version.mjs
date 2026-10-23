#!/usr/bin/env node
// Folevi's one version, for every platform (the website, Folevi for Mac, iPhone and iPad, Android). The owner's
// rule: biggest.big.minor with a two-digit last part, 1.0.00, 1.0.01 ... 1.0.99, then 1.1.00; 2.0.00 for the
// biggest changes. It's shown as "Folevi 1.0.00" everywhere, never with a build number.
//
// version.json at the repo root is the source of truth: the version, and the build, one whole number that goes up
// by one with every new version and is never shown (CFBundleVersion on the Mac, which Sparkle compares;
// CURRENT_PROJECT_VERSION on iOS; versionCode on Android). This script writes both into each app's project:
//   apps/mac/project.yml                          MARKETING_VERSION, CURRENT_PROJECT_VERSION
//   apps/ios/ios/App/App.xcodeproj/project.pbxproj MARKETING_VERSION, CURRENT_PROJECT_VERSION (app and extensions)
//   apps/android/android/app/build.gradle.kts     versionName, versionCode
// The website reads version.json itself (apps/web/src/lib/version.ts), and so does the built-in interface's
// shell/build.json (apps/web/scripts/build-shell.mjs).
//
//   node scripts/version.mjs                      prints the version and build
//   node scripts/version.mjs set 1.0.00           sets the version (the build goes up by one when it changes)
//   node scripts/version.mjs bump minor           1.0.04 -> 1.0.05
//   node scripts/version.mjs bump big             1.0.05 -> 1.1.00
//   node scripts/version.mjs bump biggest         1.3.07 -> 2.0.00
//   node scripts/version.mjs build                the build only goes up by one (the same version uploaded again)
//   node scripts/version.mjs sync                 writes version.json's values into the projects again
//   node scripts/version.mjs check                fails when a project says something else
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FORMAT = /^(\d{1,3})\.(\d{1,3})\.(\d{2})$/;

/** Whether `v` is a version in the owner's format ("1.0.00"). */
export function isVersion(v) {
  return typeof v === "string" && FORMAT.test(v);
}

export function parseVersion(v) {
  const m = FORMAT.exec(String(v));
  if (!m) throw new Error(`"${v}" isn't a Folevi version: biggest.big.minor with two digits last, as 1.0.00.`);
  return { biggest: Number(m[1]), big: Number(m[2]), minor: Number(m[3]) };
}

export function formatVersion({ biggest, big, minor }) {
  return `${biggest}.${big}.${String(minor).padStart(2, "0")}`;
}

/** Negative when a is older than b, 0 when the same, positive when newer. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  return x.biggest - y.biggest || x.big - y.big || x.minor - y.minor;
}

/** The next version: "minor" (1.0.04 -> 1.0.05), "big" (1.0.05 -> 1.1.00), "biggest" (1.3.07 -> 2.0.00). */
export function nextVersion(v, part) {
  const p = parseVersion(v);
  if (part === "minor") {
    if (p.minor >= 99) throw new Error(`${v} is the last minor version of ${p.biggest}.${p.big}: bump big instead.`);
    return formatVersion({ ...p, minor: p.minor + 1 });
  }
  if (part === "big") return formatVersion({ ...p, big: p.big + 1, minor: 0 });
  if (part === "biggest") return formatVersion({ biggest: p.biggest + 1, big: 0, minor: 0 });
  throw new Error(`bump minor, big or biggest (not "${part}").`);
}

/** Where each app keeps its version and build, and how to write them. */
export const TARGETS = [
  {
    file: "apps/mac/project.yml",
    write: (text, { version, build }) =>
      replaceAll(replaceAll(text, /^(\s*MARKETING_VERSION:\s*).*$/gm, `$1"${version}"`, "MARKETING_VERSION"), /^(\s*CURRENT_PROJECT_VERSION:\s*).*$/gm, `$1${build}`, "CURRENT_PROJECT_VERSION"),
  },
  {
    file: "apps/ios/ios/App/App.xcodeproj/project.pbxproj",
    write: (text, { version, build }) =>
      replaceAll(replaceAll(text, /(\bMARKETING_VERSION = )[^;]*;/g, `$1${version};`, "MARKETING_VERSION"), /(\bCURRENT_PROJECT_VERSION = )[^;]*;/g, `$1${build};`, "CURRENT_PROJECT_VERSION"),
  },
  {
    file: "apps/android/android/app/build.gradle.kts",
    write: (text, { version, build }) =>
      replaceAll(replaceAll(text, /^(\s*versionName\s*=\s*).*$/gm, `$1"${version}"`, "versionName"), /^(\s*versionCode\s*=\s*).*$/gm, `$1${build}`, "versionCode"),
  },
];

function replaceAll(text, re, to, name) {
  if (!re.test(text)) throw new Error(`no ${name} to set`);
  re.lastIndex = 0;
  return text.replace(re, to);
}

/** version.json: { version, build }. */
export function readVersion(root = REPO) {
  const info = JSON.parse(readFileSync(join(root, "version.json"), "utf8"));
  parseVersion(info.version);
  if (!Number.isInteger(info.build) || info.build < 1) throw new Error("version.json's build is a whole number from 1.");
  return { version: info.version, build: info.build };
}

/** The projects that don't say version.json's version and build (relative paths). */
export function outOfSync(root = REPO, info = readVersion(root)) {
  return TARGETS.filter((t) => {
    const text = readFileSync(join(root, t.file), "utf8");
    return t.write(text, info) !== text;
  }).map((t) => t.file);
}

/** Writes `info` into version.json and every project; returns the files that changed. */
export function writeVersion(root, info) {
  parseVersion(info.version);
  if (!Number.isInteger(info.build) || info.build < 1) throw new Error("The build is a whole number from 1.");
  const changed = [];
  const json = `${JSON.stringify({ version: info.version, build: info.build }, null, 2)}\n`;
  let before = "";
  try {
    before = readFileSync(join(root, "version.json"), "utf8");
  } catch {
    /* A first write. */
  }
  if (before !== json) {
    writeFileSync(join(root, "version.json"), json);
    changed.push("version.json");
  }
  for (const t of TARGETS) {
    const path = join(root, t.file);
    const text = readFileSync(path, "utf8");
    const next = t.write(text, info);
    if (next !== text) {
      writeFileSync(path, next);
      changed.push(t.file);
    }
  }
  return changed;
}

/** A new version: the build goes up by one (the same version again only writes the projects). */
export function setVersion(version, { root = REPO, force = false } = {}) {
  parseVersion(version);
  const current = readVersion(root);
  const order = compareVersions(version, current.version);
  if (order < 0 && !force) throw new Error(`${version} is older than ${current.version} (pass --force to go back).`);
  const info = { version, build: order === 0 ? current.build : current.build + 1 };
  return { ...info, changed: writeVersion(root, info) };
}

export function bumpVersion(part, { root = REPO } = {}) {
  return setVersion(nextVersion(readVersion(root).version, part), { root });
}

/** The same version built again (a store needs a new build number for each upload). */
export function bumpBuild({ root = REPO } = {}) {
  const current = readVersion(root);
  const info = { version: current.version, build: current.build + 1 };
  return { ...info, changed: writeVersion(root, info) };
}

/** What every app shows: "Folevi 1.0.00". */
export const label = (version) => `Folevi ${version}`;

function main(argv) {
  const [cmd = "print", arg] = argv.filter((a) => !a.startsWith("--"));
  const say = (r) => console.log(`${label(r.version)} (build ${r.build}, never shown)${r.changed?.length ? `\n  ${r.changed.join("\n  ")}` : ""}`);
  if (cmd === "print") return say(readVersion());
  if (cmd === "set") return say(setVersion(arg, { force: argv.includes("--force") }));
  if (cmd === "bump") return say(bumpVersion(arg));
  if (cmd === "build") return say(bumpBuild());
  if (cmd === "sync") return say({ ...readVersion(), changed: writeVersion(REPO, readVersion()) });
  if (cmd === "check") {
    const off = outOfSync();
    if (off.length) throw new Error(`Not ${readVersion().version} (${readVersion().build}): ${off.join(", ")}. Run node scripts/version.mjs sync.`);
    return say(readVersion());
  }
  throw new Error(`Unknown command "${cmd}": print, set <version>, bump minor|big|biggest, build, sync or check.`);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
}
