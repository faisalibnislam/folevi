#!/usr/bin/env node
// Folevi's one version, for every platform (the website, Folevi for Mac, iPhone and iPad, Android). The owner's
// rule (2026-10-29): MAJOR.UPDATE.PATCH, no limit on any of them, PATCH at least two digits (1.0.00, 1.0.09, 1.0.10,
// 1.10.100, 1.100.1000), no other leading zeros (never 1.0.1, 1.0.001 or 1.01.00). Shown as "Folevi 1.0.00"
// everywhere, never with a build number. The numbers are BigInts, so they never overflow.
//
// Three kinds of release. The version changes only through one of them, never because work was committed:
//   major    Major release   MAJOR+1, UPDATE 0, PATCH 00  1.5.25 -> 2.0.00   only when the owner asks for one:
//                                                                            --authorize-major <the next version>
//   update   Big update      UPDATE+1, PATCH kept         1.0.05 -> 1.1.05, 1.9.99 -> 1.10.99 (no rollover)
//   patch    Small update    PATCH+1                      1.0.09 -> 1.0.10, 1.0.99 -> 1.0.100 (no rollover)
// The kind is chosen when a release is asked for (the owner names it, or the developer tools suggest Big or Small
// from the changes, never Major); everything here is plain arithmetic and never guesses.
//
// version.json at the repo root is the source of truth: the version, and the build, one whole number that goes up
// by one with every new version and is never shown (CFBundleVersion on the Mac, which Sparkle compares;
// CURRENT_PROJECT_VERSION on iOS; versionCode on Android). Apple and Android take the version as it is: Apple wants
// three period-separated integers (1.1.04 is read as 1, 1, 4, which orders the same way). CHANGELOG.json holds
// every release, newest first, and CHANGELOG.md is written from it. Its newest release is always version.json's,
// and `check` (and the web tests in CI) fail otherwise. This script writes the version and build into each project:
//   apps/mac/project.yml                          MARKETING_VERSION, CURRENT_PROJECT_VERSION
//   apps/ios/ios/App/App.xcodeproj/project.pbxproj MARKETING_VERSION, CURRENT_PROJECT_VERSION (app and extensions)
//   apps/android/android/app/build.gradle.kts     versionName, versionCode
// The website reads version.json itself (apps/web/src/lib/version.ts), and so does the built-in interface's
// shell/build.json (apps/web/scripts/build-shell.mjs). The Mac's About panel and Settings read Info.plist, which
// says $(MARKETING_VERSION); Sparkle's update dialog reads the appcast, which publish.mjs fills from here. The
// workspaces' package.json "version" fields are npm package versions, not Folevi's: npm needs semver there, and
// 1.0.00 isn't (the Web Clipper keeps its own store version for the same reason).
//
//   node scripts/version.mjs                      prints the version and build
//   node scripts/version.mjs history              every release, newest first
//   node scripts/version.mjs prepare              what changed since the last release and the next versions
//   node scripts/version.mjs release patch|update --summary "..." [--added ...] [--improved ...] [--fixed ...]
//        [--breaking ...] [--notes-file notes.md] [--date <ISO date and time>] [--plan]
//   node scripts/version.mjs release major --authorize-major 2.0.00 --summary "..." ...
//   node scripts/version.mjs build                the build only goes up by one (the same version uploaded again)
//   node scripts/version.mjs tag                  tags this commit v<version> (once; never moves a tag)
//   node scripts/version.mjs sync                 writes version.json's values into the projects and CHANGELOG.md
//   node scripts/version.mjs check                fails when a project, CHANGELOG.json or CHANGELOG.md disagrees
// A notes file has "## Summary", "## Added", "## Improved", "## Fixed" and "## Breaking changes" sections, each a
// paragraph or "- " items. "small" and "minor" also mean patch, "big" also means update.
import { execFileSync } from "node:child_process";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// MAJOR and UPDATE: no leading zero. PATCH: two digits below 10 (00 to 09), else no leading zero.
const FORMAT = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0\d|[1-9]\d+)$/;

/** The kinds of release and what the owner calls them. */
export const RELEASE_TYPES = {
  major: "Major release",
  update: "Big update",
  patch: "Small update",
};
const ALIASES = {
  major: "major",
  update: "update",
  big: "update",
  patch: "patch",
  small: "patch",
  minor: "patch",
};
/** The sections of a release's notes, in order, and their headings. */
export const NOTE_SECTIONS = {
  added: "Added",
  improved: "Improved",
  fixed: "Fixed",
  breaking: "Breaking changes",
};

/** "major", "update" or "patch" for any of their names; throws for anything else. */
export function releaseType(name) {
  const type = Object.hasOwn(ALIASES, String(name)) ? ALIASES[name] : undefined;
  if (!type)
    throw new Error(
      `A release is major, update or patch (Major release, Big update, Small update), not "${name}".`,
    );
  return type;
}

/** Whether `v` is a version written exactly as the format says ("1.0.00", "1.10.100"). */
export const validateVersion = (v) => typeof v === "string" && FORMAT.test(v);
/** Kept for the old name. */
export const isVersion = validateVersion;

/** { major, update, patch } as BigInts; throws for anything not in the format. */
export function parseVersion(v) {
  const m = FORMAT.exec(typeof v === "string" ? v : "");
  if (!m)
    throw new Error(
      `"${v}" isn't a Folevi version: MAJOR.UPDATE.PATCH with PATCH at least two digits and no other leading zeros, as 1.0.00 or 1.10.100.`,
    );
  return { major: BigInt(m[1]), update: BigInt(m[2]), patch: BigInt(m[3]) };
}

const whole = (n, name) => {
  const text =
    typeof n === "bigint"
      ? String(n)
      : typeof n === "number" && Number.isSafeInteger(n)
        ? String(n)
        : typeof n === "string"
          ? n
          : "";
  if (!/^\d+$/.test(text)) throw new Error(`${name} is a whole number from 0, not ${String(n)}.`);
  return BigInt(text);
};

/**
 * The version written in the format, from its three numbers (whole numbers from 0: numbers, BigInts or digits),
 * or from one string of three such numbers: formatVersion(1, 0, 9) and formatVersion("1.0.9") are "1.0.09".
 */
export function formatVersion(major, update, patch) {
  if (typeof major === "object" && major !== null) ({ major, update, patch } = major);
  else if (update === undefined && patch === undefined) {
    const parts = String(major).split(".");
    if (parts.length !== 3) throw new Error(`"${major}" isn't three numbers separated by periods.`);
    [major, update, patch] = parts;
  }
  const [a, b, c] = [whole(major, "MAJOR"), whole(update, "UPDATE"), whole(patch, "PATCH")];
  return `${a}.${b}.${String(c).padStart(2, "0")}`;
}

/** Negative when a is older than b, 0 when the same, positive when newer: as numbers, never as text. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  const cmp = (p, q) => (p < q ? -1 : p > q ? 1 : 0);
  return cmp(x.major, y.major) || cmp(x.update, y.update) || cmp(x.patch, y.patch);
}

/** Oldest first; newest first with `{ newest: true }`. */
export function sortVersions(versions, { newest = false } = {}) {
  return [...versions].sort((a, b) => (newest ? compareVersions(b, a) : compareVersions(a, b)));
}

/** A Small update: PATCH+1, MAJOR and UPDATE kept, no rollover. */
export function incrementPatch(v) {
  const p = parseVersion(v);
  return formatVersion(p.major, p.update, p.patch + 1n);
}

/** A Big update: UPDATE+1, MAJOR and PATCH kept, no rollover. */
export function incrementUpdate(v) {
  const p = parseVersion(v);
  return formatVersion(p.major, p.update + 1n, p.patch);
}

/** A Major release: MAJOR+1, UPDATE 0, PATCH 00. Only for a release the owner asked for: `{ authorized: true }`. */
export function incrementMajor(v, { authorized = false } = {}) {
  if (authorized !== true)
    throw new Error(
      "A Major release needs the owner's explicit instruction: release major --authorize-major <version>.",
    );
  return formatVersion(parseVersion(v).major + 1n, 0, 0);
}

/** The next version for a kind of release; "major" needs `{ authorized: true }`. */
export function nextVersion(v, kind, { authorized = false } = {}) {
  const type = releaseType(kind);
  if (type === "patch") return incrementPatch(v);
  if (type === "update") return incrementUpdate(v);
  return incrementMajor(v, { authorized });
}

/** Where each app keeps its version and build, and how to write them. */
export const TARGETS = [
  {
    file: "apps/mac/project.yml",
    write: (text, { version, build }) =>
      replaceAll(
        replaceAll(text, /^(\s*MARKETING_VERSION:\s*).*$/gm, `$1"${version}"`, "MARKETING_VERSION"),
        /^(\s*CURRENT_PROJECT_VERSION:\s*).*$/gm,
        `$1${build}`,
        "CURRENT_PROJECT_VERSION",
      ),
  },
  {
    file: "apps/ios/ios/App/App.xcodeproj/project.pbxproj",
    write: (text, { version, build }) =>
      replaceAll(
        replaceAll(text, /(\bMARKETING_VERSION = )[^;]*;/g, `$1${version};`, "MARKETING_VERSION"),
        /(\bCURRENT_PROJECT_VERSION = )[^;]*;/g,
        `$1${build};`,
        "CURRENT_PROJECT_VERSION",
      ),
  },
  {
    file: "apps/android/android/app/build.gradle.kts",
    write: (text, { version, build }) =>
      replaceAll(
        replaceAll(text, /^(\s*versionName\s*=\s*).*$/gm, `$1"${version}"`, "versionName"),
        /^(\s*versionCode\s*=\s*).*$/gm,
        `$1${build}`,
        "versionCode",
      ),
  },
];

function replaceAll(text, re, to, name) {
  if (!re.test(text)) throw new Error(`no ${name} to set`);
  re.lastIndex = 0;
  return text.replace(re, to);
}

// Android's versionCode is the build, and it stops at 2,100,000,000.
const isBuild = (b) => Number.isInteger(b) && b >= 1 && b <= 2_100_000_000;

/** version.json: { version, build }. */
export function readVersion(root = REPO) {
  const info = JSON.parse(readFileSync(join(root, "version.json"), "utf8"));
  parseVersion(info.version);
  if (!isBuild(info.build)) throw new Error("version.json's build is a whole number from 1.");
  return { version: info.version, build: info.build };
}

/** The version every app shows. */
export const getCurrentVersion = (root = REPO) => readVersion(root).version;

/** The files that say the version and build, as they'd be written for `info`. */
function versionFiles(root, info) {
  parseVersion(info.version);
  if (!isBuild(info.build)) throw new Error("The build is a whole number from 1.");
  const files = new Map([
    ["version.json", `${JSON.stringify({ version: info.version, build: info.build }, null, 2)}\n`],
  ]);
  for (const t of TARGETS)
    files.set(t.file, t.write(readFileSync(join(root, t.file), "utf8"), info));
  return files;
}

const readOr = (path, fallback) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return fallback;
  }
};

/**
 * Writes every file or none: each goes to a temporary file first, then all are moved into place; if a move fails,
 * the ones already moved get their old text back. Returns the files that changed.
 */
export function writeFiles(root, files) {
  const changed = [...files]
    .filter(([file, text]) => readOr(join(root, file), null) !== text)
    .map(([file]) => file);
  const tmp = (file) => join(root, `${file}.version-tmp`);
  const before = new Map(changed.map((file) => [file, readOr(join(root, file), null)]));
  const moved = [];
  try {
    for (const file of changed) writeFileSync(tmp(file), files.get(file));
    for (const file of changed) {
      renameSync(tmp(file), join(root, file));
      moved.push(file);
    }
  } catch (e) {
    for (const file of moved) {
      const old = before.get(file);
      if (old === null) rmSync(join(root, file), { force: true });
      else writeFileSync(join(root, file), old);
    }
    throw e;
  } finally {
    for (const file of changed) rmSync(tmp(file), { force: true });
  }
  return changed;
}

/** The projects that don't say version.json's version and build (relative paths). */
export function outOfSync(root = REPO, info = readVersion(root)) {
  return [...versionFiles(root, info)]
    .filter(([file, text]) => file !== "version.json" && readOr(join(root, file), "") !== text)
    .map(([file]) => file);
}

/** Writes `info` into version.json and every project; returns the files that changed. */
export const writeVersion = (root, info) => writeFiles(root, versionFiles(root, info));

// The changelog.

/** CHANGELOG.json's releases, newest first. */
export function readChangelog(root = REPO) {
  const log = JSON.parse(readFileSync(join(root, "CHANGELOG.json"), "utf8"));
  if (!Array.isArray(log.releases)) throw new Error("CHANGELOG.json has no releases list.");
  return log.releases;
}

/** Every release, newest first: { version, build, released, type, summary, added, improved, fixed, breaking, tag?, commit? }. */
export const getReleaseHistory = (root = REPO) => readChangelog(root);

/** The release of `version` in the changelog, or undefined. */
export function findRelease(version, root = REPO) {
  return readChangelog(root).find((r) => r.version === version);
}

const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/;
const isText = (s) => typeof s === "string" && s.trim() !== "";
const isList = (l) => Array.isArray(l) && l.every(isText);

/** How `r` follows `older` for its kind ("" when it does): nothing skipped, MAJOR never moved by a smaller kind. */
function sequenceProblem(older, r) {
  const a = parseVersion(older.version);
  const b = parseVersion(r.version);
  const name = RELEASE_TYPES[r.type];
  if (r.type === "major")
    return b.major === a.major + 1n && b.update === 0n && b.patch === 0n
      ? ""
      : `a ${name} after ${older.version} is ${formatVersion(a.major + 1n, 0, 0)}, not ${r.version}`;
  if (b.major !== a.major)
    return `a ${name} never changes MAJOR (${older.version} to ${r.version})`;
  // A Big update keeps PATCH; the releases before 2026-10-29 set it to 00 (1.0.05 to 1.1.00), which stays valid.
  if (r.type === "update")
    return b.update === a.update + 1n && (b.patch === a.patch || b.patch === 0n)
      ? ""
      : `a ${name} after ${older.version} is ${incrementUpdate(older.version)}, not ${r.version}`;
  return b.update === a.update && b.patch === a.patch + 1n
    ? ""
    : `a ${name} after ${older.version} is ${incrementPatch(older.version)}, not ${r.version}`;
}

/** What's wrong with a changelog (empty when nothing): every field, newest first, nothing twice or skipped. */
export function changelogProblems(releases, info) {
  const problems = [];
  const seen = new Set();
  releases.forEach((r, i) => {
    const at = `release ${i + 1} (${r?.version})`;
    if (!validateVersion(r?.version)) return problems.push(`${at}: not a version in the format`);
    if (seen.has(r.version)) problems.push(`${r.version} is there twice`);
    seen.add(r.version);
    if (!isBuild(r.build)) problems.push(`${at}: the build is a whole number from 1`);
    if (!DATETIME.test(String(r.released)) || Number.isNaN(Date.parse(r.released)))
      problems.push(
        `${at}: released is a date and time with its zone, as 2026-10-29T06:18:23+06:00`,
      );
    if (!Object.hasOwn(RELEASE_TYPES, r.type))
      problems.push(`${at}: the type is major, update or patch`);
    if (!isText(r.summary)) problems.push(`${at}: no summary`);
    for (const key of Object.keys(NOTE_SECTIONS))
      if (!isList(r[key] ?? [])) problems.push(`${at}: ${key} is a list of text`);
    if (!Object.keys(NOTE_SECTIONS).some((key) => r[key]?.length))
      problems.push(`${at}: nothing added, improved, fixed or broken`);
    for (const key of ["tag", "commit"])
      if (r[key] !== undefined && !isText(r[key])) problems.push(`${at}: ${key} is text`);
    const older = releases[i + 1];
    if (older && validateVersion(older.version)) {
      if (compareVersions(r.version, older.version) <= 0)
        problems.push(`${r.version} comes before ${older.version} but isn't newer`);
      else if (Object.hasOwn(RELEASE_TYPES, r.type)) {
        const wrong = sequenceProblem(older, r);
        if (wrong) problems.push(wrong);
      }
      if (!(r.build > older.build))
        problems.push(
          `${r.version}'s build ${r.build} isn't above ${older.version}'s ${older.build}`,
        );
      if (Date.parse(older.released) > Date.parse(r.released))
        problems.push(`${r.version} is dated before ${older.version}`);
    }
  });
  const newest = releases[0];
  if (info && (!newest || newest.version !== info.version || newest.build !== info.build)) {
    problems.push(
      `version.json says ${info.version} (build ${info.build}) but the newest release in CHANGELOG.json is ${newest ? `${newest.version} (build ${newest.build})` : "none"}: versions change only through node scripts/version.mjs release`,
    );
  }
  return problems;
}

/** CHANGELOG.md, written from CHANGELOG.json. */
export function renderChangelog(releases) {
  const lines = [
    "# Changelog",
    "",
    "Every Folevi release, newest first, written by `node scripts/version.mjs` from `CHANGELOG.json`.",
    "",
    "Versions are MAJOR.UPDATE.PATCH, PATCH at least two digits: a Major release (2.0.00), a Big update (1.1.05 after 1.0.05) or a Small update (1.0.06 after 1.0.05).",
  ];
  for (const r of releases) {
    const where = [`build ${r.build}`, r.tag && `tag ${r.tag}`, r.commit && `commit ${r.commit}`]
      .filter(Boolean)
      .join(", ");
    lines.push(
      "",
      `## Version ${r.version}: ${RELEASE_TYPES[r.type] ?? r.type}`,
      "",
      `Released ${String(r.released).replace("T", " ")} (${where})`,
      "",
      r.summary,
    );
    for (const [key, heading] of Object.entries(NOTE_SECTIONS)) {
      if (!r[key]?.length) continue;
      lines.push("", `### ${heading}`, "");
      for (const item of r[key]) lines.push(`- ${item}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** The release notes Sparkle shows for an update: an HTML fragment (no body), which generate_appcast embeds. */
export function releaseNotesHtml(release) {
  const esc = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const out = [
    `<h2>Folevi ${esc(release.version)}</h2>`,
    `<p>${esc(RELEASE_TYPES[release.type] ?? release.type)}. ${esc(release.summary)}</p>`,
  ];
  for (const [key, heading] of Object.entries(NOTE_SECTIONS)) {
    if (!release[key]?.length) continue;
    out.push(
      `<h3>${heading}</h3>`,
      "<ul>",
      ...release[key].map((c) => `  <li>${esc(c)}</li>`),
      "</ul>",
    );
  }
  return `${out.join("\n")}\n`;
}

/** The versions and builds a Sparkle feed (appcast.xml) lists already: shortVersionString and version. */
export function appcastReleases(xml) {
  const all = (key) =>
    [...String(xml).matchAll(new RegExp(`sparkle:${key}(?:>|=")([^<"]+)`, "g"))].map((m) =>
      m[1].trim(),
    );
  return {
    versions: all("shortVersionString").filter(validateVersion),
    builds: all("version")
      .filter((b) => /^\d+$/.test(b))
      .map(Number),
  };
}

const changelogFiles = (releases) =>
  new Map([
    ["CHANGELOG.json", `${JSON.stringify({ releases }, null, 2)}\n`],
    ["CHANGELOG.md", renderChangelog(releases)],
  ]);

/** Writes CHANGELOG.json and CHANGELOG.md; returns the files that changed. */
export const writeChangelog = (root, releases) => writeFiles(root, changelogFiles(releases));

/** Now in the local time zone, as 2026-10-29T06:18:23+06:00. */
export function now(date = new Date()) {
  const two = (n) => String(n).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const zone = `${offset >= 0 ? "+" : "-"}${two(Math.floor(Math.abs(offset) / 60))}:${two(Math.abs(offset) % 60)}`;
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}${zone}`;
}

/** The notes of a release from options: summary, and the lists, each trimmed. */
function notesFrom({ summary = "", added = [], improved = [], fixed = [], breaking = [] }) {
  const clean = (l) => l.map((s) => String(s).trim()).filter(Boolean);
  return {
    summary: String(summary).trim(),
    added: clean(added),
    improved: clean(improved),
    fixed: clean(fixed),
    breaking: clean(breaking),
  };
}

/**
 * Everything `release` would write, without writing it. `kind` is the kind the owner asked for (or the kind chosen
 * for a release they asked for); a Major release also needs `authorizeMajor`, the version it gives.
 */
export function planRelease(
  kind,
  { root = REPO, authorizeMajor, released = now(), ...notes } = {},
) {
  const type = releaseType(kind);
  const current = readVersion(root);
  const releases = readChangelog(root);
  const before = changelogProblems(releases, current);
  if (before.length) throw new Error(`Fix the changelog first:\n  ${before.join("\n  ")}`);
  if (type === "major") {
    const expected = incrementMajor(current.version, { authorized: true });
    if (authorizeMajor !== expected)
      throw new Error(
        `A Major release happens only when the owner asks for one: pass --authorize-major ${expected} to confirm they did.`,
      );
  } else if (authorizeMajor !== undefined)
    throw new Error("--authorize-major is only for a Major release.");
  const version = nextVersion(current.version, type, { authorized: type === "major" });
  // Never a version that exists already, and never an older one.
  if (compareVersions(version, current.version) <= 0)
    throw new Error(`${version} isn't newer than ${current.version}.`);
  if (releases.some((r) => r.version === version))
    throw new Error(`${version} was released already.`);
  const n = notesFrom(notes);
  if (!n.summary)
    throw new Error(
      'Give the release a summary: --summary "..." (or a "## Summary" section in --notes-file).',
    );
  if (!Object.keys(NOTE_SECTIONS).some((key) => n[key].length))
    throw new Error(
      "Say what changed: --added, --improved, --fixed or --breaking (as many as needed), or --notes-file.",
    );
  if (
    !DATETIME.test(released) ||
    Number.isNaN(Date.parse(released)) ||
    Date.parse(released) < Date.parse(releases[0].released)
  ) {
    throw new Error(
      `The release time ${released} isn't a date and time with its zone, on or after ${releases[0].released}.`,
    );
  }
  const release = { version, build: current.build + 1, released, type, summary: n.summary };
  for (const key of Object.keys(NOTE_SECTIONS)) if (n[key].length) release[key] = n[key];
  release.tag = `v${version}`;
  return { release, releases: [release, ...releases] };
}

/** A new release: the next version for its kind, the build up by one, its changelog entry, every project, all or nothing. */
export function release(kind, options = {}) {
  const root = options.root ?? REPO;
  const plan = planRelease(kind, options);
  const { version, build } = plan.release;
  const files = new Map([
    ...versionFiles(root, { version, build }),
    ...changelogFiles(plan.releases),
  ]);
  return { ...plan.release, changed: writeFiles(root, files) };
}

/** The same version built again (a store needs a new build number for each upload); its changelog entry follows. */
export const bumpBuild = ({ root = REPO } = {}) => setBuild(readVersion(root).build + 1, { root });

/** The same version with a higher build (never a lower one); its changelog entry follows. */
export function setBuild(build, { root = REPO } = {}) {
  const current = readVersion(root);
  if (!isBuild(build) || build <= current.build)
    throw new Error(`The build ${build} isn't a whole number above ${current.build}.`);
  const info = { version: current.version, build };
  const releases = readChangelog(root);
  if (releases[0]?.version !== current.version)
    throw new Error(`Fix the changelog first: its newest release isn't ${current.version}.`);
  const next = [{ ...releases[0], build: info.build }, ...releases.slice(1)];
  return {
    ...info,
    changed: writeFiles(root, new Map([...versionFiles(root, info), ...changelogFiles(next)])),
  };
}

/** Everything that doesn't say version.json's version: projects, CHANGELOG.json, CHANGELOG.md. */
export function problems(root = REPO) {
  const info = readVersion(root);
  const out = outOfSync(root, info).map(
    (f) =>
      `${f} doesn't say ${info.version} (build ${info.build}): run node scripts/version.mjs sync`,
  );
  const releases = readChangelog(root);
  out.push(...changelogProblems(releases, info));
  if (readOr(join(root, "CHANGELOG.md"), "") !== renderChangelog(releases))
    out.push("CHANGELOG.md isn't CHANGELOG.json's: run node scripts/version.mjs sync");
  return out;
}

/** What every app shows: "Folevi 1.0.00". */
export const label = (version) => `Folevi ${version}`;

const git = (args, root = REPO) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

/** The commits since the last release (the last commit that changed version.json), oldest first. */
export function changesSinceRelease(root = REPO) {
  const last = git(["log", "-n1", "--format=%H", "--", "version.json"], root);
  const log = git(["log", "--first-parent", "--reverse", "--format=%h %s", `${last}..HEAD`], root);
  return { since: last.slice(0, 8), commits: log ? log.split("\n") : [] };
}

/** Tags HEAD v<version> (annotated); refuses when the tag exists or HEAD isn't that release. */
export function tagRelease(root = REPO) {
  if (problems(root).length) throw new Error("Run node scripts/version.mjs check first.");
  const { version } = readVersion(root);
  const head = JSON.parse(git(["show", "HEAD:version.json"], root));
  if (head.version !== version)
    throw new Error(`The commit says ${head.version}: commit the release of ${version} first.`);
  const tag = findRelease(version, root)?.tag ?? `v${version}`;
  if (git(["tag", "--list", tag], root))
    throw new Error(`${tag} exists already: a tag is never moved or made twice.`);
  git(["tag", "-a", tag, "-m", label(version)], root);
  return tag;
}

/** "## Summary" / "## Added" / ... sections of a notes file, each a paragraph or "- " items. */
export function parseNotes(text) {
  const notes = { summary: [], added: [], improved: [], fixed: [], breaking: [] };
  const keys = {
    summary: "summary",
    added: "added",
    improved: "improved",
    fixed: "fixed",
    "breaking changes": "breaking",
    breaking: "breaking",
  };
  let at = null;
  for (const line of String(text).split("\n")) {
    const heading = /^#+\s*(.+?)\s*$/.exec(line);
    if (heading) {
      at = keys[heading[1].toLowerCase()] ?? null;
      if (!at)
        throw new Error(
          `Unknown section "${heading[1]}": Summary, Added, Improved, Fixed or Breaking changes.`,
        );
      continue;
    }
    const item = line.replace(/^\s*[-*]\s+/, "").trim();
    if (!item) continue;
    if (!at) throw new Error(`"${item}" isn't under a section heading.`);
    notes[at].push(item);
  }
  return { ...notes, summary: notes.summary.join(" ") };
}

const describeNext = (v) =>
  `Small update ${incrementPatch(v)}, Big update ${incrementUpdate(v)}; a Major release (${incrementMajor(v, { authorized: true })}) only when the owner asks for one`;

/** --name value pairs (repeatable) and the words around them. */
function parseArgs(argv) {
  const words = [];
  const flags = {};
  const valued = [
    "summary",
    "added",
    "improved",
    "fixed",
    "breaking",
    "notes-file",
    "date",
    "authorize-major",
  ];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      words.push(a);
      continue;
    }
    const [name, inline] = a.slice(2).split(/=(.*)/s);
    const takes = valued.includes(name);
    const value = takes ? (inline ?? argv[++i]) : true;
    if (takes && value === undefined) throw new Error(`--${name} needs a value.`);
    (flags[name] ??= []).push(value);
  }
  return { words, flags };
}

function optionsFrom(flags) {
  const notes = {
    summary: [...(flags.summary ?? [])],
    added: [...(flags.added ?? [])],
    improved: [...(flags.improved ?? [])],
    fixed: [...(flags.fixed ?? [])],
    breaking: [...(flags.breaking ?? [])],
  };
  for (const file of flags["notes-file"] ?? []) {
    const n = parseNotes(readFileSync(resolve(file), "utf8"));
    if (n.summary) notes.summary.push(n.summary);
    for (const key of Object.keys(NOTE_SECTIONS)) notes[key].push(...n[key]);
  }
  return {
    ...notes,
    summary: notes.summary.join(" "),
    ...(flags.date ? { released: flags.date.at(-1) } : {}),
    ...(flags["authorize-major"] ? { authorizeMajor: flags["authorize-major"].at(-1) } : {}),
  };
}

function main(argv) {
  const { words, flags } = parseArgs(argv);
  const [cmd = "print", arg] = words;
  const say = (r) =>
    console.log(
      `${label(r.version)} (build ${r.build}, never shown)${r.type ? `, a ${RELEASE_TYPES[r.type]} at ${r.released}` : ""}${r.changed?.length ? `\n  ${r.changed.join("\n  ")}` : ""}`,
    );
  if (cmd === "print") return say(readVersion());
  if (cmd === "history")
    return console.log(
      getReleaseHistory()
        .map((r) => `${r.version}  ${RELEASE_TYPES[r.type]}  ${r.released}  ${r.summary}`)
        .join("\n"),
    );
  if (cmd === "next") return console.log(describeNext(getCurrentVersion()));
  if (cmd === "prepare") {
    const { since, commits } = changesSinceRelease();
    return console.log(
      `${label(getCurrentVersion())}, released at ${since}. ${commits.length} commits since:\n  ${commits.join("\n  ") || "(none)"}\nNext: ${describeNext(getCurrentVersion())}.`,
    );
  }
  if (cmd === "release" || cmd === "bump") {
    const options = optionsFrom(flags);
    if (flags.plan) {
      const { release: r } = planRelease(arg, options);
      return console.log(
        `Would release ${label(r.version)} (build ${r.build}), a ${RELEASE_TYPES[r.type]}, tag ${r.tag}:\n${renderChangelog([r]).split("\n").slice(6).join("\n")}`,
      );
    }
    return say(release(arg, options));
  }
  if (cmd === "build") return say(bumpBuild());
  if (cmd === "tag") return console.log(`Tagged ${tagRelease()} (not pushed).`);
  if (cmd === "sync") {
    const info = readVersion();
    return say({
      ...info,
      changed: [...writeVersion(REPO, info), ...writeChangelog(REPO, readChangelog())],
    });
  }
  if (cmd === "check") {
    const found = problems();
    if (found.length)
      throw new Error(`Folevi's version isn't consistent:\n  ${found.join("\n  ")}`);
    return say(readVersion());
  }
  throw new Error(
    `Unknown command "${cmd}": print, history, next, prepare, release patch|update|major, build, tag, sync or check.`,
  );
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
}
