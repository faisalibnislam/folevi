#!/usr/bin/env node
// The handoff, kept as many small files so sessions working at the same time never edit the same one
// (handoff/README.md). Until 2026-11-26 everything was appended to HANDOFF.md, and every merged pull request made
// every other open one conflict there.
//
//   node scripts/handoff.mjs show [--area <a>] [--last <n>]    the state files and the newest log entries
//   node scripts/handoff.mjs log "<title>" --area <a> [--body "<text>"]
//                                                              a new entry in handoff/log/ (prints its path)
//   node scripts/handoff.mjs areas                             the areas (one file each in handoff/state/)
//   node scripts/handoff.mjs check                             what CI runs: HANDOFF.md is only the pointer, and
//                                                              every entry and state file is well formed
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** HANDOFF.md, whole: a pointer and nothing else. Anything added to it fails `check`. */
export const POINTER = `# Folevi: handoff

Read this first if you are a Claude (or any agent) picking this project up.

The handoff is a folder now, not this file, so sessions working at the same time never edit the same file:

1. \`handoff/guide.md\`: what Folevi is, where it lives, setup, architecture, build and test, release, secrets,
   rules and gotchas (the numbered sections 1 to 8 and 11 that used to be here).
2. \`handoff/state/<area>.md\`: the current state and next steps of one area (\`node scripts/handoff.mjs areas\`).
   Read \`release.md\` and the areas you will touch.
3. \`node scripts/handoff.mjs show\`: the state files and the newest log entries in one read
   (\`--area mac\` for one area, \`--last 30\` for more entries).

After every change:

- \`node scripts/handoff.mjs log "<what changed>" --area <area>\`, then fill in the file it makes in \`handoff/log/\`.
- Update your area's \`handoff/state/<area>.md\` when its current state or next steps changed.
- Never add to this file, and never edit another session's log entry. CI fails a pull request that changes this
  file (\`node scripts/handoff.mjs check\`).

How it works and why: \`handoff/README.md\`. Everything written here before 2026-11-26 is in \`handoff/archive/\`.
`;

const STATE = "handoff/state";
const LOG = "handoff/log";
/** A log entry's file: UTC date and time, the branch, a few words of the title. Sorting by name is by time. */
const ENTRY_NAME = /^\d{4}-\d{2}-\d{2}-\d{4}Z-[a-z0-9][a-z0-9-]*\.md$/;

const read = (root, file) => readFileSync(join(root, file), "utf8");
const list = (root, dir) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((f) => f.endsWith(".md")).sort() : []);

/** The areas: one state file each. */
export const areas = (root = REPO) => list(root, STATE).map((f) => f.slice(0, -3));

/** Lowercase words joined by dashes, at most `max` characters. */
export function slug(text, max = 40) {
  const s = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, max).replace(/-+$/g, "") || "entry";
}

function branch(root) {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** A new entry's file name and text. */
export function newEntry({ title, area, body = "", now = new Date(), branchName }) {
  const iso = now.toISOString();
  const stamp = `${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}Z`;
  const name = `${stamp}-${slug(`${slug(branchName.replace(/^claude\//, ""), 24)}-${title}`, 70)}.md`;
  const text = `# ${title.trim()}

- Date: ${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC
- Area: ${area}
- Branch: ${branchName}

${body.trim() || "What changed, what was checked (and how), and what is left."}
`;
  return { name, text };
}

/** Everything wrong with the handoff's files ([] when it is fine). */
export function problems(root = REPO) {
  const out = [];
  if (read(root, "HANDOFF.md") !== POINTER)
    out.push(
      "HANDOFF.md is only a pointer and must not change. Put what you wrote there in a new file instead: " +
        'node scripts/handoff.mjs log "<what changed>" --area <area> (and update handoff/state/<area>.md). ' +
        "To restore the pointer: git checkout origin/main -- HANDOFF.md",
    );
  const known = areas(root);
  if (!known.length) out.push(`${STATE}/ has no area files.`);
  const marker = /^(<<<<<<<|=======$|>>>>>>>)/m;
  for (const f of list(root, STATE)) {
    const text = read(root, `${STATE}/${f}`);
    if (!text.startsWith("# ")) out.push(`${STATE}/${f} doesn't start with a "# " title.`);
    if (marker.test(text)) out.push(`${STATE}/${f} has merge conflict markers.`);
    if (text.includes("—")) out.push(`${STATE}/${f} has an em dash (the repo's rule: none).`);
  }
  for (const f of list(root, LOG)) {
    if (f === "README.md") continue;
    const text = read(root, `${LOG}/${f}`);
    if (!ENTRY_NAME.test(f)) out.push(`${LOG}/${f}: the name isn't <date>-<time>Z-<words>.md (make entries with node scripts/handoff.mjs log).`);
    if (!text.startsWith("# ")) out.push(`${LOG}/${f} doesn't start with a "# " title.`);
    const area = /^- Area: (.+)$/m.exec(text)?.[1]?.trim();
    if (!area) out.push(`${LOG}/${f} has no "- Area: <area>" line.`);
    else if (!area.split(/,\s*/).every((a) => known.includes(a))) out.push(`${LOG}/${f}: unknown area "${area}" (areas: ${known.join(", ")}).`);
    if (marker.test(text)) out.push(`${LOG}/${f} has merge conflict markers.`);
    if (text.includes("—")) out.push(`${LOG}/${f} has an em dash (the repo's rule: none).`);
  }
  return out;
}

/** The state files (all, or one area's and the release's) and the newest `last` log entries, newest first. */
export function show({ root = REPO, area = null, last = 12 } = {}) {
  const known = areas(root);
  const wanted = area ? known.filter((a) => a === area || a === "release") : known;
  const parts = [];
  for (const a of wanted) parts.push(read(root, `${STATE}/${a}.md`).trim());
  const entries = list(root, LOG)
    .filter((f) => f !== "README.md")
    .filter((f) => {
      if (!area) return true;
      const tagged = /^- Area: (.+)$/m.exec(read(root, `${LOG}/${f}`))?.[1] ?? "";
      return tagged.split(/,\s*/).includes(area);
    })
    .reverse()
    .slice(0, last);
  parts.push(`# Log: the newest ${entries.length} ${entries.length === 1 ? "entry" : "entries"}${area ? ` for ${area}` : ""} (handoff/log/, newest first)`);
  for (const f of entries) parts.push(`<!-- ${LOG}/${f} -->\n${read(root, `${LOG}/${f}`).trim()}`);
  return parts.join("\n\n---\n\n") + "\n";
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const value = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const fail = (m) => {
    console.error(m);
    process.exit(1);
  };
  if (command === "areas") {
    console.log(areas().join("\n"));
  } else if (command === "show") {
    const area = value("--area") ?? null;
    if (area && !areas().includes(area)) fail(`No area "${area}". Areas: ${areas().join(", ")}`);
    process.stdout.write(show({ area, last: Number(value("--last") ?? 12) }));
  } else if (command === "log") {
    const title = argv[1];
    const area = value("--area");
    if (!title || title.startsWith("--")) fail('Usage: node scripts/handoff.mjs log "<what changed>" --area <area> [--body "<text>"]');
    if (!area || !area.split(/,\s*/).every((a) => areas().includes(a))) fail(`Give --area, one of: ${areas().join(", ")} (several: --area "mac, web")`);
    const { name, text } = newEntry({ title, area, body: value("--body") ?? "", branchName: branch(REPO) });
    const file = join(REPO, LOG, name);
    if (existsSync(file)) fail(`${LOG}/${name} exists already: change the title a little.`);
    mkdirSync(join(REPO, LOG), { recursive: true });
    writeFileSync(file, text);
    console.log(`${LOG}/${name}`);
  } else if (command === "check") {
    const found = problems();
    if (found.length) fail(found.map((p) => `handoff: ${p}`).join("\n"));
    console.log(`handoff: ok (${areas().length} areas, ${list(REPO, LOG).filter((f) => f !== "README.md").length} log entries)`);
  } else {
    fail("Usage: node scripts/handoff.mjs show|log|areas|check (see the top of scripts/handoff.mjs)");
  }
}
