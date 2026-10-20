// `pnpm release`: the personal build of Folevi for Mac, from source to /Applications.
//   1. bump the version (bump-version.mjs),
//   2. the interface built into the app, as the production build (apps/web build-shell.mjs --production
//      --required): Folevi's production deployment and website, never .env.local's development values; into
//      web-release/, so web/ keeps the development export `pnpm start` and the e2e specs use,
//   3. the app (tsc), its native helpers, and electron-builder with Resources/web from web-release/,
//   4. checks the packaged interface is that production build, for this version,
//   5. installs it in /Applications and opens it (install-app.mjs).
// --dry-run does all of it without touching anything installed or versioned: no bump, and the export, the
// build and the installed copy all go to a temporary folder (or --out <dir>), which it prints. Nothing is
// opened and /Applications/Folevi.app is left alone.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildMac } from "./builder.mjs";

const root = resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const outFlag = argv.indexOf("--out");
const out = dryRun ? resolve(outFlag >= 0 && argv[outFlag + 1] ? argv[outFlag + 1] : mkdtempSync(join(tmpdir(), "folevi-release-"))) : null;
if (out) mkdirSync(out, { recursive: true });

const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const step = (n, what) => console.log(`\n== ${n}. ${what}${dryRun ? " (dry run)" : ""}`);

step(1, "version");
if (dryRun) console.log(`Keeping ${JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version}`);
else run("node", ["scripts/bump-version.mjs"]);
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

step(2, "the built-in interface, production build");
const web = out ? join(out, "web") : join(root, "web-release");
run("node", [resolve(root, "../web/scripts/build-shell.mjs"), "--production", "--required", "--dest", web]);

step(3, "the app");
run("pnpm", ["build"]);
run("pnpm", ["helper"]);
const output = out ? join(out, "release") : join(root, "release");
await buildMac({ config: "electron-builder.yml", web, output, targets: ["dir"], arch: "arm64" });
const built = join(output, "mac-arm64", "Folevi.app");
if (!existsSync(built)) throw new Error(`The build didn't make ${built}`);

step(4, "checks");
const info = JSON.parse(readFileSync(join(built, "Contents/Resources/web/shell/build.json"), "utf8"));
const problems = [];
if (info.target !== "production") problems.push(`Resources/web is a ${info.target} build`);
if (info.convexUrl !== "https://fastidious-clownfish-123.convex.cloud") problems.push(`Resources/web talks to ${info.convexUrl}`);
if (info.siteUrl !== "https://app.folevi.com") problems.push(`Resources/web signs in at ${info.siteUrl}`);
if (info.appVersion !== version) problems.push(`Resources/web was built for ${info.appVersion}, the app is ${version}`);
const plist = execFileSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", join(built, "Contents/Info.plist")], { encoding: "utf8" }).trim();
if (plist !== version) problems.push(`Info.plist says ${plist}, package.json ${version}`);
for (const helper of ["folevi-text", "folevi-files"]) if (!existsSync(join(built, "Contents/Resources", helper))) problems.push(`Resources/${helper} is missing`);
if (problems.length) {
  console.error(`The build isn't fit to install:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`Folevi ${version}: Resources/web is the production build (${info.convexUrl}, ${info.siteUrl}, IndexedDB v${info.dbVersion}).`);

step(5, "install");
run("node", ["scripts/install-app.mjs", "--from", built, ...(out ? ["--to", join(out, "Applications"), "--no-open"] : [])]);
if (out) {
  // Launch Services notices app bundles as they're written: the copies of a dry run mustn't be the ones macOS
  // picks to open folevi:// links (the installed app is).
  const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  for (const app of [built, join(out, "Applications", "Folevi.app")]) spawnSync(lsregister, ["-u", app], { stdio: "ignore" });
}
if (out) console.log(`\nDry run done: ${out}\n  export   ${web}\n  build    ${built}\n  install  ${join(out, "Applications", "Folevi.app")}`);
