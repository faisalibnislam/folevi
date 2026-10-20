// Builds Folevi for Mac for everyone and puts it in the update bucket (Cloudflare R2):
//   1. checks for a Developer ID Application certificate and Apple's notarization credentials,
//   2. builds the universal DMG and ZIP (electron-builder.dist.yml: signed, notarized, stapled),
//   3. uploads them to <bucket>/mac/darwin-universal/, then RELEASES.json (the feed src/updates.ts reads,
//      newest first, earlier versions kept), and the DMG again as mac/Folevi.dmg (the download link).
// Uses wrangler (signed in to the Cloudflare account that owns the bucket). Bump the version first
// (`pnpm bump`). Options: --dry-run builds and writes RELEASES.json without uploading.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMac } from "./builder.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dryRun = process.argv.includes("--dry-run");
const bucket = process.env.FOLEVI_UPDATE_BUCKET ?? "folevi-updates";
const base = (process.env.FOLEVI_UPDATE_URL ?? "https://updates.folevi.com").replace(/\/+$/, "");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const prefix = "mac/darwin-universal";

function fail(message) {
  console.error(message);
  process.exit(1);
}

// 1. Certificate and notarization credentials.
const identities = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" }).stdout ?? "";
if (!/Developer ID Application:/.test(identities) && !process.env.CSC_LINK) {
  fail("No Developer ID Application certificate in the keychain (or CSC_LINK). Create one at developer.apple.com > Certificates, install it, and run this again.");
}
const apiKey = process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER;
const appleId = process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID;
if (!apiKey && !appleId) fail("Notarizing needs APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER (or APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID).");

// 2. Build (the interface built into the app first: the production build of apps/web build-shell into
// web-release/, shipped in Resources/web; web/ keeps the development one).
const web = join(root, "web-release");
execFileSync("node", [resolve(root, "../web/scripts/build-shell.mjs"), "--production", "--required", "--dest", web], { cwd: root, stdio: "inherit" });
execFileSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });
execFileSync("pnpm", ["helper"], { cwd: root, stdio: "inherit" });
await buildMac({ config: "electron-builder.dist.yml", web, targets: null, universal: true });
const out = join(root, "release-dist");
const zip = `Folevi-${version}-universal-mac.zip`;
const dmg = `Folevi-${version}-mac.dmg`;
for (const f of [zip, dmg]) if (!existsSync(join(out, f))) fail(`The build didn't make ${f}.`);
// The app in the DMG must pass Gatekeeper as a notarized Developer ID app.
const app = join(out, "mac-universal", "Folevi.app");
const assess = spawnSync("spctl", ["--assess", "--type", "execute", "--verbose=2", app], { encoding: "utf8" });
if (assess.status !== 0 || !/Notarized Developer ID/.test(assess.stderr ?? "")) fail(`Gatekeeper doesn't accept the build:\n${assess.stderr}`);

// 3. The feed: this version first, earlier ones kept.
let earlier = [];
try {
  const res = await fetch(`${base}/${prefix}/RELEASES.json`, { cache: "no-store" });
  if (res.ok) earlier = ((await res.json()).releases ?? []).filter((r) => r.version !== version);
} catch {
  /* The first release. */
}
const feed = {
  currentRelease: version,
  releases: [{ version, updateTo: { version, name: version, notes: "", pub_date: new Date().toISOString(), url: `${base}/${prefix}/${zip}` } }, ...earlier].slice(0, 20),
};
const feedFile = join(out, "RELEASES.json");
writeFileSync(feedFile, `${JSON.stringify(feed, null, 2)}\n`);
console.log(`RELEASES.json: ${version} (${feed.releases.length} versions)`);
if (dryRun) {
  console.log("Dry run: nothing uploaded.");
  process.exit(0);
}

const put = (key, file, type, cache) =>
  execFileSync("npx", ["wrangler", "r2", "object", "put", `${bucket}/${key}`, "--file", file, "--content-type", type, "--cache-control", cache, "--remote"], { stdio: "inherit" });
put(`${prefix}/${zip}`, join(out, zip), "application/zip", "public, max-age=31536000, immutable");
put(`${prefix}/${dmg}`, join(out, dmg), "application/x-apple-diskimage", "public, max-age=31536000, immutable");
// The feed last, so it never points at a ZIP that isn't there yet.
put(`${prefix}/RELEASES.json`, feedFile, "application/json", "no-cache");
put("mac/Folevi.dmg", join(out, dmg), "application/x-apple-diskimage", "no-cache");
console.log(`Published Folevi ${version}: ${base}/mac/Folevi.dmg`);
