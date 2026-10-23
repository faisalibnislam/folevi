#!/usr/bin/env node
// Publishes Folevi for Mac for everyone (docs/MAC_WEBKIT_PLAN.md §9, docs/MAC_RELEASE.md). THE OWNER RUNS THIS: it
// uploads to Apple and to the update bucket. Builders never do (they use release.mjs's dry run).
//
//   node apps/mac/scripts/publish.mjs [--electron-feed] [--plan]
//
//   1. checks: the Developer ID identity, the notarization profile (`xcrun notarytool store-credentials
//      folevi-notary`), the Sparkle key in the login Keychain (account "folevi"), wrangler signed in
//   2. the universal release build (release.mjs's steps, into apps/mac/release-dist/<version>)
//   3. notarizes the app (notarytool, the keychain profile folevi-notary) and staples it
//   4. the ZIP Sparkle installs and the DMG (with an Applications link), the DMG signed, notarized, stapled
//   5. the appcast: generate_appcast signs the new ZIP (EdDSA, the Keychain's key) and makes deltas from the
//      versions kept in apps/mac/release-archive/ (the ZIPs of earlier releases), with the feed from the bucket as
//      its starting point
//   6. uploads with wrangler to the update bucket (folevi-updates, https://updates.folevi.com): mac/Folevi-<v>.zip,
//      the deltas, mac/Folevi-<v>.dmg, mac/Folevi.dmg (the download link), then mac/appcast.xml last
//   7. --electron-feed: also points the Electron app's Squirrel feed (mac/darwin-universal/RELEASES.json) at this
//      ZIP, so Electron copies update to the native app. Only once Electron 1.22 (the handover) has been the current
//      release long enough that the Electron copies out there run it (docs/MAC_RELEASE.md).
// --plan prints what it would do and stops.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAC } from "./project.mjs";
import { buildRelease, currentVersion, identity, SPARKLE_ACCOUNT, sparkleBin, unregister, verify } from "./release.mjs";

const argv = process.argv.slice(2);
const bucket = process.env.FOLEVI_UPDATE_BUCKET ?? "folevi-updates";
const base = (process.env.FOLEVI_UPDATE_URL ?? "https://updates.folevi.com").replace(/\/+$/, "");
const notary = process.env.FOLEVI_NOTARY_PROFILE ?? "folevi-notary";
const { version, build } = currentVersion();
const out = join(MAC, "release-dist", version);
const archiveDir = join(MAC, "release-archive");
const zipName = `Folevi-${version}.zip`;
const dmgName = `Folevi-${version}.dmg`;

const fail = (m) => {
  console.error(m);
  process.exit(1);
};
const run = (cmd, args, o = {}) => execFileSync(cmd, args, { stdio: "inherit", maxBuffer: 256 * 1024 * 1024, ...o });
const ok = (cmd, args) => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;

if (argv.includes("--plan")) {
  console.log(`Would publish Folevi ${version} (build ${build}, what Sparkle compares) from ${out}:
  notarize with the keychain profile ${notary}, staple, ZIP + DMG,
  sign the appcast with the Sparkle key (login Keychain, account ${SPARKLE_ACCOUNT}), deltas from ${archiveDir},
  upload to ${bucket}: mac/${zipName}, mac/${dmgName}, mac/Folevi.dmg, mac/appcast.xml${argv.includes("--electron-feed") ? ", mac/darwin-universal/RELEASES.json" : ""}`);
  process.exit(0);
}

// 1. What publishing needs.
identity();
if (!ok("xcrun", ["notarytool", "history", "--keychain-profile", notary])) fail(`No notarization profile "${notary}": run \`xcrun notarytool store-credentials ${notary} --apple-id <Apple ID> --team-id 7K32QQ2FX8\` once.`);
if (!ok("npx", ["wrangler", "whoami"])) fail("wrangler isn't signed in: run `npx wrangler login` with the Cloudflare account that owns the update bucket.");

// 2. The build (universal).
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const app = buildRelease({ out, universal: true, version });
const first = verify(app, { version, build, universal: true });
if (first.problems.length) fail(`The build isn't fit to publish:\n  ${first.problems.join("\n  ")}`);
const keyPub = spawnSync(join(sparkleBin(), "generate_keys"), ["-p", "--account", SPARKLE_ACCOUNT], { encoding: "utf8" }).stdout.trim();
if (!keyPub) fail(`No Sparkle key in the login Keychain (account ${SPARKLE_ACCOUNT}).`);

// 3. Notarize and staple the app.
const notarize = (file) => run("xcrun", ["notarytool", "submit", file, "--keychain-profile", notary, "--wait"]);
const forApple = join(out, "Folevi-notarize.zip");
run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, forApple]);
notarize(forApple);
run("xcrun", ["stapler", "staple", app]);
rmSync(forApple, { force: true });
const checked = verify(app, { version, build, universal: true, notarized: true });
if (checked.problems.length) fail(`After notarizing:\n  ${checked.problems.join("\n  ")}`);

// 4. The ZIP (what Sparkle and Squirrel install) and the DMG.
const updates = join(out, "updates");
mkdirSync(updates, { recursive: true });
run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, join(updates, zipName)]);
const stage = join(out, "dmg");
mkdirSync(stage, { recursive: true });
run("ditto", [app, join(stage, "Folevi.app")]);
symlinkSync("/Applications", join(stage, "Applications"));
const dmg = join(out, dmgName);
run("hdiutil", ["create", "-volname", "Folevi", "-srcfolder", stage, "-ov", "-format", "UDZO", dmg]);
run("codesign", ["--sign", identity(), "--timestamp", dmg]);
notarize(dmg);
run("xcrun", ["stapler", "staple", dmg]);
unregister(app, join(stage, "Folevi.app"));

// 5. The appcast: the bucket's feed as it is, earlier ZIPs for deltas, the new ZIP signed.
try {
  const res = await fetch(`${base}/mac/appcast.xml`, { cache: "no-store" });
  if (res.ok) writeFileSync(join(updates, "appcast.xml"), await res.text());
} catch {
  /* The first native release. */
}
mkdirSync(archiveDir, { recursive: true });
for (const f of readdirSync(archiveDir).filter((f) => /^Folevi-[0-9.]+\.zip$/.test(f) && f !== zipName)) cpSync(join(archiveDir, f), join(updates, f));
run(join(sparkleBin(), "generate_appcast"), ["--account", SPARKLE_ACCOUNT, "--download-url-prefix", `${base}/mac/`, "--maximum-deltas", "3", updates]);
const appcast = readFileSync(join(updates, "appcast.xml"), "utf8");
if (!appcast.includes(`sparkle:shortVersionString>${version}<`) && !appcast.includes(`sparkle:shortVersionString="${version}"`)) fail("generate_appcast didn't add this version.");
// Sparkle compares the hidden build (sparkle:version, CFBundleVersion); 1.0.00 is only what people see.
if (!appcast.includes(`sparkle:version>${build}<`) && !appcast.includes(`sparkle:version="${build}"`)) fail(`generate_appcast didn't give this version the build ${build} (sparkle:version).`);
cpSync(join(updates, zipName), join(archiveDir, zipName));

// 6. Upload, the feed last so it never names a file that isn't there yet.
const put = (key, file, type, cache) => run("npx", ["wrangler", "r2", "object", "put", `${bucket}/${key}`, "--file", file, "--content-type", type, "--cache-control", cache, "--remote"]);
const immutable = "public, max-age=31536000, immutable";
put(`mac/${zipName}`, join(updates, zipName), "application/zip", immutable);
for (const delta of readdirSync(updates).filter((f) => f.endsWith(".delta"))) put(`mac/${delta}`, join(updates, delta), "application/octet-stream", immutable);
put(`mac/${dmgName}`, dmg, "application/x-apple-diskimage", immutable);
put("mac/Folevi.dmg", dmg, "application/x-apple-diskimage", "no-cache");
put("mac/appcast.xml", join(updates, "appcast.xml"), "application/xml", "no-cache");

// 7. Electron copies update to this one (Squirrel accepts it: same bundle id, team and designated requirement).
if (argv.includes("--electron-feed")) {
  const prefix = "mac/darwin-universal";
  let earlier = [];
  try {
    const res = await fetch(`${base}/${prefix}/RELEASES.json`, { cache: "no-store" });
    if (res.ok) earlier = ((await res.json()).releases ?? []).filter((r) => r.version !== version);
  } catch {
    /* none */
  }
  const feed = { currentRelease: version, releases: [{ version, updateTo: { version, name: version, notes: "", pub_date: new Date().toISOString(), url: `${base}/mac/${zipName}` } }, ...earlier].slice(0, 20) };
  const feedFile = join(out, "RELEASES.json");
  writeFileSync(feedFile, `${JSON.stringify(feed, null, 2)}\n`);
  put(`${prefix}/RELEASES.json`, feedFile, "application/json", "no-cache");
}
console.log(`Published Folevi for Mac ${version}: ${base}/mac/Folevi.dmg, feed ${base}/mac/appcast.xml${existsSync(join(out, "RELEASES.json")) ? ", and the Electron feed" : ""}`);
