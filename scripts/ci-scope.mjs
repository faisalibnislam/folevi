#!/usr/bin/env node
// Does a pull request need the end-to-end jobs? (.github/workflows/ci.yml, job "scope".)
//
//   git diff --name-only HEAD^1 HEAD | node scripts/ci-scope.mjs      prints e2e=true or e2e=false
//
// The end-to-end jobs build the web app against a local Convex backend and drive it in a browser, about 25 minutes
// on eight runners. A pull request that changes only files that build never reads (the Mac, iPhone, Android and
// desktop apps, the handoff, docs, the version files) can't change what they see, so they are skipped for it. The
// first job (lint, typecheck, unit tests, web build) always runs.
//
// The list names what is safe to skip. Any file outside it, and any doubt, runs the suite.

/** Folders the web app, Convex and the end-to-end suite never read. A trailing slash matches everything inside. */
export const UNAFFECTED_FOLDERS = [
  "handoff/",
  "docs/",
  "apps/mac/",
  "apps/ios/",
  "apps/native-kit/",
  "apps/android/",
  "apps/desktop/",
  "apps/mobile/",
];

/**
 * Single files that are safe too. version.json is read by the web app (apps/web/src/lib/version.ts), but only as
 * the version text it shows, and the web build in the first job still compiles with it.
 */
export const UNAFFECTED_FILES = ["version.json", "CHANGELOG.json", "CHANGELOG.md"];

/** True when a change to this path can't change what the end-to-end jobs see. */
export function unaffected(path) {
  const file = String(path).trim().replace(/^\.\//, "");
  if (!file) return true;
  if (UNAFFECTED_FILES.includes(file)) return true;
  // A Markdown file at the top of the repository (README.md, CLAUDE.md, HANDOFF.md), never one in a folder.
  if (!file.includes("/") && file.toLowerCase().endsWith(".md")) return true;
  return UNAFFECTED_FOLDERS.some((folder) => file.startsWith(folder));
}

/** The changed files that make the end-to-end jobs necessary. */
export function reasons(files) {
  return files.map((f) => String(f).trim()).filter(Boolean).filter((f) => !unaffected(f));
}

/** Whether to run the end-to-end jobs for these changed files. No files means the diff couldn't be read: run. */
export function needsE2e(files) {
  const changed = files.map((f) => String(f).trim()).filter(Boolean);
  return changed.length === 0 || reasons(changed).length > 0;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  const files = input.split("\n").map((l) => l.trim()).filter(Boolean);
  const run = needsE2e(files);
  const why = reasons(files);
  // The explanation goes to stderr (the job's log); stdout is the one line the workflow reads.
  if (files.length === 0) console.error("No changed files were read: running the end-to-end jobs.");
  else if (run) console.error(`End-to-end jobs run: ${why.length} of ${files.length} changed files can affect them, for example ${why.slice(0, 5).join(", ")}.`);
  else console.error(`End-to-end jobs skipped: none of the ${files.length} changed files can affect them.`);
  console.log(`e2e=${run}`);
}
