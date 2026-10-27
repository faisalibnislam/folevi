#!/usr/bin/env node
// Screenshot diffs between the web app and Folevi for Mac (docs/MAC_REBUILD_PLAN.md section 3.2).
//
// For every specimen in packages/design-tokens/match/specimens.json, light and dark:
//   1. the web: Playwright in WebKit opens <base>/dev/match/<id> (the web's real CSS) as the Mac app shows the
//      web (<html data-desktop="mac">) and photographs #specimen at the file's scale;
//   2. the Mac: `swift test --filter MatchShotTests` in apps/native-kit draws the same specimen in a window;
//   3. a pixel diff: a pixel differs when no pixel of the other picture within `threshold.radius` (anti-aliasing)
//      is within `threshold.channel` on every channel; a specimen passes at most `threshold.maxRatio` of its
//      pixels differing (and the same size).
// Writes apps/mac/match-report/ (untracked): web/, native/, diff/ and index.html with the three side by side,
// and report.json. Exits 1 when a specimen fails.
//
//   node apps/mac/scripts/match.mjs [--base http://app.localhost:3012] [--only type-roles,icons] [--skip-native]
//
// The web dev server must be running (the "mac-rebuild-web-3012" entry in .claude/launch.json, or any
// `next dev` of apps/web).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { diffAll, writeReport } from "./diff.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(join(repo, "apps/web/package.json"));
const { webkit } = require("@playwright/test");

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const base = (arg("--base") ?? process.env.FOLEVI_MATCH_BASE ?? "http://app.localhost:3012").replace(/\/$/, "");
const only = arg("--only")?.split(",");
const skipNative = process.argv.includes("--skip-native");

const file = JSON.parse(readFileSync(join(repo, "packages/design-tokens/match/specimens.json"), "utf8"));
const specimens = file.specimens.filter((s) => !only || only.includes(s.id));
const out = join(repo, "apps/mac/match-report");
for (const d of ["web", "diff"]) {
  rmSync(join(out, d), { recursive: true, force: true });
  mkdirSync(join(out, d), { recursive: true });
}
mkdirSync(join(out, "native"), { recursive: true });

// 1. The web.
const browser = await webkit.launch();
for (const scheme of ["light", "dark"]) {
  const page = await browser.newPage({ deviceScaleFactor: file.scale, colorScheme: scheme, viewport: { width: 900, height: 1200 } });
  for (const s of specimens) {
    const res = await page.goto(`${base}/dev/match/${s.id}`, { waitUntil: "networkidle" });
    if (!res?.ok()) throw new Error(`${base}/dev/match/${s.id}: HTTP ${res?.status()}`);
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.desktop = "mac";
      document.documentElement.dataset.chrome = "neutral";
    }, scheme);
    await page.evaluate(() => document.fonts.ready);
    await page.locator("#specimen").screenshot({ path: join(out, "web", `${s.id}-${scheme}.png`), animations: "disabled", caret: "hide" });
  }
  await page.close();
}

// 2. The Mac.
if (!skipNative) {
  rmSync(join(out, "native"), { recursive: true, force: true });
  execFileSync("swift", ["test", "--filter", "MatchShotTests"], {
    cwd: join(repo, "apps/native-kit"),
    env: { ...process.env, FOLEVI_MATCH_OUT: join(out, "native") },
    stdio: ["ignore", "ignore", "inherit"],
  });
}

// 3. The diff.
const results = await diffAll(browser, out, specimens.flatMap((s) => ["light", "dark"].map((scheme) => ({ id: s.id, scheme }))), file.threshold);
await browser.close();
writeReport(out, { title: "Web vs Folevi for Mac", note: `Web from ${base} in WebKit as the Mac app shows it (data-desktop="mac").`, threshold: file.threshold, results });
process.exit(results.every((r) => r.pass) ? 0 : 1);
