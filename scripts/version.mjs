#!/usr/bin/env node
// Folevi's one version, for every platform (the website, Folevi for Mac, iPhone and iPad, Android). The owner's
// rule: MAJOR.UPDATE.PATCH shown as #.#.##, as 1.0.00. UPDATE is one digit (0 to 9), PATCH always two (00 to 99),
// so never 1.0.1, 1.0.001 or 1.10.00. It's shown as "Folevi 1.0.00" everywhere, never with a build number.
//
// Three kinds of release, chosen by hand, the next version worked out here (no other rule, nothing guessed):
//   major    Major release   MAJOR+1, then .0.00                      1.5.20 -> 2.0.00
//   update   Big update      UPDATE+1, PATCH 00; 9 rolls into MAJOR+1  1.0.25 -> 1.1.00, 1.9.20 -> 2.0.00
//   patch    Small update    PATCH+1; 99 rolls into UPDATE+1 (and on)  1.0.09 -> 1.0.10, 1.1.99 -> 1.2.00, 1.9.99 -> 2.0.00
//
// version.json at the repo root is the source of truth: the version, and the build, one whole number that goes up
// by one with every new version and is never shown (CFBundleVersion on the Mac, which Sparkle compares;
// CURRENT_PROJECT_VERSION on iOS; versionCode on Android). CHANGELOG.json holds every release, newest first
// (version, build, date, type, changes), and CHANGELOG.md is written from it. Its newest release is always
// version.json's: the version only changes through `release` below, never by editing a file, and `check` (and the
// web tests in CI) fail otherwise. This script writes the version and build into each app's project:
//   apps/mac/project.yml                          MARKETING_VERSION, CURRENT_PROJECT_VERSION
//   apps/ios/ios/App/App.xcodeproj/project.pbxproj MARKETING_VERSION, CURRENT_PROJECT_VERSION (app and extensions)
//   apps/android/android/app/build.gradle.kts     versionName, versionCode
// The website reads version.json itself (apps/web/src/lib/version.ts), and so does the built-in interface's
// shell/build.json (apps/web/scripts/build-shell.mjs). The Mac's About panel and Settings read Info.plist, which
// says $(MARKETING_VERSION). The workspaces' package.json "version" fields are npm package versions, not Folevi's:
// npm needs semver there, and 1.0.00 isn't (the Web Clipper keeps its own store version for the same reason).
//
//   node scripts/version.mjs                      prints the version and build
//   node scripts/version.mjs next                 the next version for each kind of release
//   node scripts/version.mjs release patch --change "What changed" [--change ...] [--date 2026-10-29] [--plan]
//   node scripts/version.mjs release update|major --changes-file notes.md   (one change per line, "- " optional)
//   node scripts/version.mjs set 1.1.05 --change ...  the same, naming the version (it must be one of `next`'s)
//   node scripts/version.mjs build                the build only goes up by one (the same version uploaded again)
//   node scripts/version.mjs sync                 writes version.json's values into the projects and CHANGELOG.md again
//   node scripts/version.mjs check                fails when a project, CHANGELOG.json or CHANGELOG.md says something else
// "bump" is another name for "release", and the old names still work: minor (patch), big (update), biggest (major).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FORMAT = /^(0|[1-9]\d{0,2})\.(\d)\.(\d{2})$/;
export const MAX_MAJOR = 999;

/** The kinds of release and what the owner calls them. */
export const RELEASE_TYPES = {
  major: "Major release",
  update: "Big update",
  patch: "Small update",
};
const ALIASES = {
  major: "major",
  biggest: "major",
  update: "update",
  big: "update",
  patch: "patch",
  small: "patch",
  minor: "patch",
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

/** Whether `v` is a version in the owner's format ("1.0.00"). */
export function isVersion(v) {
  return typeof v === "string" && FORMAT.test(v);
}

export function parseVersion(v) {
  const m = FORMAT.exec(String(v));
  if (!m)
    throw new Error(
      `"${v}" isn't a Folevi version: MAJOR.UPDATE.PATCH as #.#.##, one digit for UPDATE and two for PATCH, as 1.0.00.`,
    );
  return { major: Number(m[1]), update: Number(m[2]), patch: Number(m[3]) };
}

export function formatVersion({ major, update, patch }) {
  const whole = (n, max) => Number.isInteger(n) && n >= 0 && n <= max;
  if (!whole(major, MAX_MAJOR) || !whole(update, 9) || !whole(patch, 99))
    throw new Error(`${major}.${update}.${patch} can't be written as #.#.##.`);
  return `${major}.${update}.${String(patch).padStart(2, "0")}`;
}

/** Negative when a is older than b, 0 when the same, positive when newer (as numbers, never as text). */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  return x.major - y.major || x.update - y.update || x.patch - y.patch;
}

/** Oldest first; newest first with `{ newest: true }`. */
export function sortVersions(versions, { newest = false } = {}) {
  return [...versions].sort((a, b) => (newest ? compareVersions(b, a) : compareVersions(a, b)));
}

/** The next version for a kind of release (see the top of this file), rolling over 9 and 99. */
export function nextVersion(v, kind) {
  const type = releaseType(kind);
  let { major, update, patch } = parseVersion(v);
  if (type === "major") [major, update, patch] = [major + 1, 0, 0];
  if (type === "update") [update, patch] = [update + 1, 0];
  if (type === "patch") patch += 1;
  if (patch > 99) [update, patch] = [update + 1, 0];
  if (update > 9) [major, update] = [major + 1, 0];
  if (major > MAX_MAJOR) throw new Error(`${v} is the last version the format can hold.`);
  return formatVersion({ major, update, patch });
}

/** Which kind of release takes `from` to `to`, or null when none of the three does. */
export function releaseTypeOf(from, to) {
  return Object.keys(RELEASE_TYPES).find((type) => nextVersion(from, type) === to) ?? null;
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

const isBuild = (b) => Number.isInteger(b) && b >= 1;

/** version.json: { version, build }. */
export function readVersion(root = REPO) {
  const info = JSON.parse(readFileSync(join(root, "version.json"), "utf8"));
  parseVersion(info.version);
  if (!isBuild(info.build)) throw new Error("version.json's build is a whole number from 1.");
  return { version: info.version, build: info.build };
}

/** The projects that don't say version.json's version and build (relative paths). */
export function outOfSync(root = REPO, info = readVersion(root)) {
  return TARGETS.filter((t) => {
    const text = readFileSync(join(root, t.file), "utf8");
    return t.write(text, info) !== text;
  }).map((t) => t.file);
}

/** Writes `text` when it differs; true when it did. */
function put(root, file, text) {
  let before = "";
  try {
    before = readFileSync(join(root, file), "utf8");
  } catch {
    /* A first write. */
  }
  if (before === text) return false;
  writeFileSync(join(root, file), text);
  return true;
}

/** Writes `info` into version.json and every project; returns the files that changed. */
export function writeVersion(root, info) {
  parseVersion(info.version);
  if (!isBuild(info.build)) throw new Error("The build is a whole number from 1.");
  const changed = [];
  if (
    put(
      root,
      "version.json",
      `${JSON.stringify({ version: info.version, build: info.build }, null, 2)}\n`,
    )
  )
    changed.push("version.json");
  for (const t of TARGETS) {
    const text = readFileSync(join(root, t.file), "utf8");
    if (put(root, t.file, t.write(text, info))) changed.push(t.file);
  }
  return changed;
}

// The changelog.

/** CHANGELOG.json's releases, newest first: { version, build, date, type, changes }. */
export function readChangelog(root = REPO) {
  const log = JSON.parse(readFileSync(join(root, "CHANGELOG.json"), "utf8"));
  if (!Array.isArray(log.releases)) throw new Error("CHANGELOG.json has no releases list.");
  return log.releases;
}

/** The release of `version` in the changelog, or undefined. */
export function findRelease(version, root = REPO) {
  return readChangelog(root).find((r) => r.version === version);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What's wrong with a changelog (empty when nothing): every field, newest first, no version or build twice. */
export function changelogProblems(releases, info) {
  const problems = [];
  const seen = new Set();
  releases.forEach((r, i) => {
    const at = `release ${i + 1} (${r?.version})`;
    if (!isVersion(r?.version)) return problems.push(`${at}: not a version in the format`);
    if (seen.has(r.version)) problems.push(`${r.version} is there twice`);
    seen.add(r.version);
    if (!isBuild(r.build)) problems.push(`${at}: the build is a whole number from 1`);
    if (!DATE.test(String(r.date)) || Number.isNaN(Date.parse(r.date)))
      problems.push(`${at}: the date is YYYY-MM-DD`);
    if (!Object.hasOwn(RELEASE_TYPES, r.type))
      problems.push(`${at}: the type is major, update or patch`);
    if (
      !Array.isArray(r.changes) ||
      !r.changes.length ||
      r.changes.some((c) => typeof c !== "string" || !c.trim())
    )
      problems.push(`${at}: no changes listed`);
    const older = releases[i + 1];
    if (older && isVersion(older.version)) {
      if (compareVersions(r.version, older.version) <= 0)
        problems.push(`${r.version} comes before ${older.version} but isn't newer`);
      if (!(r.build > older.build))
        problems.push(
          `${r.version}'s build ${r.build} isn't above ${older.version}'s ${older.build}`,
        );
      // Each release is exactly what its kind gives after the one before: nothing skipped.
      if (Object.hasOwn(RELEASE_TYPES, r.type) && nextVersion(older.version, r.type) !== r.version)
        problems.push(
          `a ${RELEASE_TYPES[r.type]} after ${older.version} is ${nextVersion(older.version, r.type)}, not ${r.version}`,
        );
      if (older.date > r.date) problems.push(`${r.version} is dated before ${older.version}`);
    }
  });
  const newest = releases[0];
  if (info && (!newest || newest.version !== info.version || newest.build !== info.build)) {
    problems.push(
      `version.json says ${info.version} (build ${info.build}) but the newest release in CHANGELOG.json is ${newest ? `${newest.version} (build ${newest.build})` : "none"}: release with node scripts/version.mjs release`,
    );
  }
  return problems;
}

/** CHANGELOG.md, written from CHANGELOG.json. */
export function renderChangelog(releases) {
  const lines = [
    "# Changelog",
    "",
    "Every Folevi release, newest first. Written by `node scripts/version.mjs` from `CHANGELOG.json`: edit that file, then run `node scripts/version.mjs sync`.",
    "",
    "Versions are MAJOR.UPDATE.PATCH, shown as `#.#.##`: a Major release, a Big update or a Small update.",
  ];
  for (const r of releases) {
    lines.push(
      "",
      `## ${r.version} (${r.date})`,
      "",
      `${RELEASE_TYPES[r.type] ?? r.type}, build ${r.build}`,
      "",
    );
    for (const c of r.changes) lines.push(`- ${c}`);
  }
  return `${lines.join("\n")}\n`;
}

/** The release notes Sparkle shows for an update: an HTML fragment (no body), which generate_appcast embeds. */
export function releaseNotesHtml(release) {
  const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<h2>Folevi ${esc(release.version)}</h2>\n<p>${esc(RELEASE_TYPES[release.type] ?? release.type)}, ${esc(release.date)}</p>\n<ul>\n${release.changes.map((c) => `  <li>${esc(c)}</li>`).join("\n")}\n</ul>\n`;
}

/** The versions and builds a Sparkle feed (appcast.xml) lists already: shortVersionString and version. */
export function appcastReleases(xml) {
  const all = (key) =>
    [...String(xml).matchAll(new RegExp(`sparkle:${key}(?:>|=")([^<"]+)`, "g"))].map((m) =>
      m[1].trim(),
    );
  return {
    versions: all("shortVersionString").filter(isVersion),
    builds: all("version")
      .filter((b) => /^\d+$/.test(b))
      .map(Number),
  };
}

/** Writes CHANGELOG.json and CHANGELOG.md; returns the files that changed. */
export function writeChangelog(root, releases) {
  const changed = [];
  if (put(root, "CHANGELOG.json", `${JSON.stringify({ releases }, null, 2)}\n`))
    changed.push("CHANGELOG.json");
  if (put(root, "CHANGELOG.md", renderChangelog(releases))) changed.push("CHANGELOG.md");
  return changed;
}

/** Today in the local time zone, YYYY-MM-DD. */
export function today(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Everything `release` would write, without writing it. */
export function planRelease(kind, { root = REPO, changes = [], date = today() } = {}) {
  const type = releaseType(kind);
  const current = readVersion(root);
  const releases = readChangelog(root);
  const before = changelogProblems(releases, current);
  if (before.length) throw new Error(`Fix the changelog first:\n  ${before.join("\n  ")}`);
  const version = nextVersion(current.version, type);
  // Never a version that exists already, and never an older one.
  if (compareVersions(version, current.version) <= 0)
    throw new Error(`${version} isn't newer than ${current.version}.`);
  if (releases.some((r) => r.version === version))
    throw new Error(`${version} was released already.`);
  const list = changes.map((c) => String(c).trim()).filter(Boolean);
  if (!list.length)
    throw new Error(
      'Say what changed: --change "..." (as many as needed) or --changes-file <file>.',
    );
  if (!DATE.test(date) || date < releases[0].date)
    throw new Error(`The date ${date} isn't YYYY-MM-DD on or after ${releases[0].date}.`);
  const release = { version, build: current.build + 1, date, type, changes: list };
  return { release, releases: [release, ...releases] };
}

/** A new release: the next version for its kind, the build up by one, its changelog entry, every project. */
export function release(kind, { root = REPO, changes = [], date = today() } = {}) {
  const plan = planRelease(kind, { root, changes, date });
  const { version, build } = plan.release;
  const changed = [
    ...writeVersion(root, { version, build }),
    ...writeChangelog(root, plan.releases),
  ];
  return { ...plan.release, changed };
}

/** A release naming its version, which must be what one of the three kinds gives (so none is skipped). */
export function setVersion(version, { root = REPO, changes = [], date = today() } = {}) {
  parseVersion(version);
  const current = readVersion(root);
  if (compareVersions(version, current.version) <= 0)
    throw new Error(
      `${version} isn't newer than ${current.version}: a version is never released twice or gone back to.`,
    );
  const type = releaseTypeOf(current.version, version);
  if (!type)
    throw new Error(
      `${version} isn't the next version after ${current.version} (${describeNext(current.version)}).`,
    );
  return release(type, { root, changes, date });
}

/** Kept for the old name: a release of that kind. */
export const bumpVersion = (kind, options) => release(kind, options);

/** The same version built again (a store needs a new build number for each upload); its changelog entry follows. */
export function bumpBuild({ root = REPO } = {}) {
  const current = readVersion(root);
  const info = { version: current.version, build: current.build + 1 };
  const releases = readChangelog(root);
  const newest =
    releases[0]?.version === current.version
      ? [{ ...releases[0], build: info.build }, ...releases.slice(1)]
      : releases;
  return { ...info, changed: [...writeVersion(root, info), ...writeChangelog(root, newest)] };
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
  let md = "";
  try {
    md = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  } catch {
    /* Missing, reported below. */
  }
  if (md !== renderChangelog(releases))
    out.push("CHANGELOG.md isn't CHANGELOG.json's: run node scripts/version.mjs sync");
  return out;
}

/** What every app shows: "Folevi 1.0.00". */
export const label = (version) => `Folevi ${version}`;

const describeNext = (v) =>
  Object.keys(RELEASE_TYPES)
    .map((t) => `${RELEASE_TYPES[t]} ${nextVersion(v, t)}`)
    .join(", ");

/** --name value pairs (repeatable) and the words around them. */
function parseArgs(argv) {
  const words = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      words.push(a);
      continue;
    }
    const [name, inline] = a.slice(2).split(/=(.*)/s);
    const takes = ["change", "changes-file", "date"].includes(name);
    const value = takes ? (inline ?? argv[++i]) : true;
    if (takes && value === undefined) throw new Error(`--${name} needs a value.`);
    (flags[name] ??= []).push(value);
  }
  return { words, flags };
}

function changesFrom(flags) {
  const list = [...(flags.change ?? [])];
  for (const file of flags["changes-file"] ?? []) {
    list.push(
      ...readFileSync(resolve(file), "utf8")
        .split("\n")
        .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
        .filter(Boolean),
    );
  }
  return list;
}

function main(argv) {
  const { words, flags } = parseArgs(argv);
  const [cmd = "print", arg] = words;
  const say = (r) =>
    console.log(
      `${label(r.version)} (build ${r.build}, never shown)${r.type ? `, ${RELEASE_TYPES[r.type]} on ${r.date}` : ""}${r.changed?.length ? `\n  ${r.changed.join("\n  ")}` : ""}`,
    );
  const options = {
    changes: changesFrom(flags),
    ...(flags.date ? { date: flags.date.at(-1) } : {}),
  };
  if (cmd === "print") return say(readVersion());
  if (cmd === "next") return console.log(describeNext(readVersion().version));
  if (cmd === "release" || cmd === "bump") {
    if (flags.plan) {
      const { release: r } = planRelease(arg, options);
      return console.log(
        `Would release ${label(r.version)} (build ${r.build}), a ${RELEASE_TYPES[r.type]} on ${r.date}:\n  ${r.changes.join("\n  ")}`,
      );
    }
    return say(release(arg, options));
  }
  if (cmd === "set") return say(setVersion(arg, options));
  if (cmd === "build") return say(bumpBuild());
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
    `Unknown command "${cmd}": print, next, release major|update|patch, set <version>, build, sync or check.`,
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
