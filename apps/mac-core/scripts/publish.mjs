#!/usr/bin/env node
// Publishes Folevi for everyone. THE OWNER RUNS THIS: it sends the app to Apple's notary service and uploads
// to the update bucket. Builders never do (they use release.mjs, which stops before both).
//
//   node apps/mac-core/scripts/publish.mjs [--plan] [--universal]
//
//   1. checks: version.json's version is newer than the live Core feed's, the Developer ID identity, the notary
//      profile (FOLEVI_NOTARY_PROFILE, default folevi-notary), Core's Sparkle key (login Keychain, account
//      folevi, the same key as the AppKit Folevi), wrangler signed in
//   2. the release build (release.mjs, into apps/mac-core/release-dist/<version>)
//   3. notarizes the app and staples it
//   4. the ZIP Sparkle installs and the DMG (Applications link), the DMG notarized and stapled too
//   5. the appcast: generate_appcast signs the ZIP with Core's own key, deltas from apps/mac-core/release-archive/
//   6. uploads to R2 `folevi-updates` under core/ (served at https://folevi.com/download/core/): the ZIP, deltas,
//      FoleviCore-<v>.dmg, FoleviCore.dmg (the stable link), then core/appcast.xml last
// --plan prints what it would do and stops.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORE, buildRelease, currentVersion, identity, makeDmg, SPARKLE_ACCOUNT, sparkleBin, verify } from "./release.mjs";

const argv = process.argv.slice(2);
const bucket = process.env.FOLEVI_UPDATE_BUCKET ?? "folevi-updates";
const base = (process.env.FOLEVI_UPDATE_URL ?? "https://folevi.com/download").replace(/\/+$/, "") + "/mac";
const bucketUrl = (process.env.FOLEVI_BUCKET_URL ?? "https://pub-e55d5e1b47314fcbbbe3664ed7aed1c2.r2.dev").replace(/\/+$/, "") + "/mac";
const notary = process.env.FOLEVI_NOTARY_PROFILE ?? "folevi-notary";
const { version, build } = currentVersion();
const universal = argv.includes("--universal");
const out = join(CORE, "release-dist", version);
const archiveDir = join(CORE, "release-archive");
const zipName = `Folevi-${version}.zip`;
const dmgName = `Folevi-${version}.dmg`;
const run = (cmd, args, o = {}) => execFileSync(cmd, args, { stdio: "inherit", maxBuffer: 256 * 1024 * 1024, ...o });
const ok = (cmd, args) => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const fail = (m) => {
  console.error(m);
  process.exit(1);
};

if (argv.includes("--plan")) {
  console.log(`Would publish Folevi ${version} (build ${build}) from ${out}:
  build (release.mjs${universal ? ", universal" : ""}), notarize with the keychain profile ${notary}, staple, ZIP + DMG,
  sign the appcast with Core's Sparkle key (login Keychain, account ${SPARKLE_ACCOUNT}), deltas from ${archiveDir},
  upload to ${bucket}: mac/${zipName}, mac/${dmgName}, mac/Folevi.dmg, then mac/appcast.xml,
  downloads at ${base}/Folevi.dmg, the feed at ${base}/appcast.xml`);
  process.exit(0);
}

// 1. What publishing needs.
const feed = spawnSync("curl", ["-fsSL", `${bucketUrl}/appcast.xml`], { encoding: "utf8" });
if (feed.status === 0) {
  const builds = [...feed.stdout.matchAll(/<sparkle:version>(\d+)<\/sparkle:version>/g)].map((m) => Number(m[1]));
  if (builds.some((b) => b >= Number(build))) fail(`The live Mac feed already has build ${Math.max(...builds)}; version.json's is ${build}.`);
}
identity();
if (!ok("xcrun", ["notarytool", "history", "--keychain-profile", notary])) fail(`No notary profile "${notary}" (xcrun notarytool store-credentials ${notary} --team-id 7K32QQ2FX8 ...).`);
if (!ok(sparkleBin("generate_keys"), ["--account", SPARKLE_ACCOUNT, "-p"])) fail(`No Sparkle key for account ${SPARKLE_ACCOUNT} in the login Keychain.`);
if (!ok("npx", ["wrangler", "whoami"])) fail("wrangler isn't signed in (npx wrangler login).");

// 2. The build.
mkdirSync(out, { recursive: true });
const app = buildRelease({ out, universal, version, build });
const checked = verify(app, { version, build, universal });
if (checked.problems.length) fail("Problems:\n  " + checked.problems.join("\n  "));

// 3. Notarize and staple the app.
const appZip = join(out, "notarize.zip");
run("ditto", ["-c", "-k", "--keepParent", app, appZip]);
run("xcrun", ["notarytool", "submit", appZip, "--keychain-profile", notary, "--wait"]);
run("xcrun", ["stapler", "staple", app]);
rmSync(appZip, { force: true });

// 4. The ZIP Sparkle installs and the DMG.
const updates = join(out, "updates");
rmSync(updates, { recursive: true, force: true });
mkdirSync(updates, { recursive: true });
run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, join(updates, zipName)]);
const dmg = makeDmg(app, join(out, dmgName));
run("xcrun", ["notarytool", "submit", dmg, "--keychain-profile", notary, "--wait"]);
run("xcrun", ["stapler", "staple", dmg]);

// 5. The appcast, from the live feed and the ZIPs kept for deltas.
if (feed.status === 0) writeFileSync(join(updates, "appcast.xml"), feed.stdout);
if (existsSync(archiveDir)) for (const f of readdirSync(archiveDir).filter((f) => f.endsWith(".zip"))) cpSync(join(archiveDir, f), join(updates, f));
run(sparkleBin("generate_appcast"), ["--account", SPARKLE_ACCOUNT, "--download-url-prefix", `${base}/`, "--maximum-deltas", "3", updates]);
mkdirSync(archiveDir, { recursive: true });
cpSync(join(updates, zipName), join(archiveDir, zipName));

// 6. Upload: everything but the feed, then the feed.
const put = (file, key, type) => run("npx", ["wrangler", "r2", "object", "put", `${bucket}/mac/${key}`, "--file", file, "--content-type", type, "--remote"]);
put(join(updates, zipName), zipName, "application/zip");
for (const f of readdirSync(updates).filter((f) => f.endsWith(".delta"))) put(join(updates, f), f, "application/octet-stream");
put(dmg, dmgName, "application/x-apple-diskimage");
put(dmg, "Folevi.dmg", "application/x-apple-diskimage");
put(join(updates, "appcast.xml"), "appcast.xml", "application/xml");
console.log(`\nPublished Folevi ${version}: ${base}/Folevi.dmg (feed ${base}/appcast.xml)`);
