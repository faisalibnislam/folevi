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
// With --platform ios (the iPhone and iPad rebuild, docs/IOS_REBUILD_PLAN.md section 3): the web as the iOS app
// shows it (<html data-native="ios">) at --scale (3, an iPhone's), and the native half drawn by the same suite
// in the iOS Simulator (--device, a simulator's name or id); report in apps/ios/match-report/.
//
//   node apps/mac/scripts/match.mjs [--base http://app.localhost:3012] [--only type-roles,icons] [--skip-native]
//   node apps/mac/scripts/match.mjs --platform ios [--scale 3] [--device "iPhone 18 Pro"]
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
const ios = arg("--platform") === "ios";
const device = arg("--device") ?? "iPhone 18 Pro";

const file = JSON.parse(readFileSync(join(repo, "packages/design-tokens/match/specimens.json"), "utf8"));
const specimens = file.specimens.filter((s) => (!only || only.includes(s.id)) && (!s.platforms || s.platforms.includes(ios ? "ios" : "mac")));
const scale = Number(arg("--scale") ?? (ios ? 3 : file.scale));
const out = join(repo, ios ? "apps/ios/match-report" : "apps/mac/match-report");
for (const d of ["web", "diff"]) {
  rmSync(join(out, d), { recursive: true, force: true });
  mkdirSync(join(out, d), { recursive: true });
}
mkdirSync(join(out, "native"), { recursive: true });

// 1. The web.
const browser = await webkit.launch();
for (const scheme of ["light", "dark"]) {
  const page = await browser.newPage({ deviceScaleFactor: scale, colorScheme: scheme, viewport: { width: 900, height: 1200 } });
  for (const s of specimens) {
    const res = await page.goto(`${base}/dev/match/${s.id}`, { waitUntil: "networkidle" });
    if (!res?.ok()) throw new Error(`${base}/dev/match/${s.id}: HTTP ${res?.status()}`);
    await page.evaluate(([theme, ios]) => {
      document.documentElement.dataset.theme = theme;
      if (ios) document.documentElement.dataset.native = "ios";
      // An iPhone (the iPad app has no data-iphone): the phone layout's rules (the tab bar's pills).
      if (ios === "iphone") document.documentElement.dataset.iphone = "";
      else document.documentElement.dataset.desktop = "mac";
      document.documentElement.dataset.chrome = "neutral";
    }, [scheme, ios && (/ipad/i.test(device) ? "ipad" : "iphone")]);
    await page.evaluate(() => document.fonts.ready);
    await page.locator("#specimen").screenshot({ path: join(out, "web", `${s.id}-${scheme}.png`), animations: "disabled", caret: "hide" });
  }
  await page.close();
}

// 2. The Mac, or the iOS Simulator.
if (!skipNative && ios) {
  rmSync(join(out, "native"), { recursive: true, force: true });
  execFileSync("xcodebuild", ["test", "-scheme", "FoleviKit-Package", "-destination", `platform=iOS Simulator,${/^[0-9A-F-]{36}$/.test(device) ? "id" : "name"}=${device}`, "-only-testing:FoleviDesignTests/MatchShotTests"], {
    cwd: join(repo, "apps/native-kit"),
    // xcodebuild hands TEST_RUNNER_-prefixed variables to the tests in the Simulator, without the prefix.
    env: { ...process.env, TEST_RUNNER_FOLEVI_MATCH_OUT: join(out, "native"), TEST_RUNNER_FOLEVI_MATCH_SCALE: String(scale) },
    stdio: ["ignore", "ignore", "inherit"],
  });
} else if (!skipNative) {
  rmSync(join(out, "native"), { recursive: true, force: true });
  execFileSync("swift", ["test", "--filter", "MatchShotTests"], {
    cwd: join(repo, "apps/native-kit"),
    env: { ...process.env, FOLEVI_MATCH_OUT: join(out, "native") },
    stdio: ["ignore", "ignore", "inherit"],
  });
}

// 3. The diff.
const threshold = ios ? { ...file.threshold, sizeSlack: 1 } : file.threshold;
const results = await diffAll(browser, out, specimens.flatMap((s) => ["light", "dark"].map((scheme) => ({ id: s.id, scheme }))), threshold);
await browser.close();
writeReport(out, {
  title: ios ? "Web vs Folevi for iPhone and iPad" : "Web vs Folevi for Mac",
  note: ios ? `Web from ${base} in WebKit as the iOS app shows it (data-native="ios"), at ${scale}x; native in the ${device} Simulator.` : `Web from ${base} in WebKit as the Mac app shows it (data-desktop="mac").`, threshold, results });
process.exit(results.every((r) => r.pass) ? 0 : 1);
