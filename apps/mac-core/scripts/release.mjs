#!/usr/bin/env node
// Builds a release of Folevi Core for direct download: the production web export inside the app, signed with the
// team's Developer ID (hardened runtime, secure timestamp, Sparkle's helpers signed inside out), then a DMG with
// an Applications link. Nothing is notarized or uploaded here: publish.mjs does that, and only the owner runs it.
//
//   node apps/mac-core/scripts/release.mjs [--universal] [--web DIR] [--out DIR] [--launch-check]
//
//   1. the version: version.json (one version for every Folevi app; Core shows the same number)
//   2. the built-in interface, production build (apps/web build-shell.mjs --production --required)
//   3. XcodeGen, then `xcodebuild archive` (Release; automatic signing, team 7K32QQ2FX8)
//   4. Resources/web goes into the archived app; Sparkle's helpers and the app are signed again with Developer ID
//   5. checks (signature, hardened runtime, entitlements, the export's target) and the DMG
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CORE = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(CORE, "../..");
const TEAM = "7K32QQ2FX8";
const DERIVED = join(CORE, "build/release-dd");
export const SPARKLE_ACCOUNT = "folevi-core";

const run = (cmd, args, o = {}) => execFileSync(cmd, args, { stdio: "inherit", maxBuffer: 256 * 1024 * 1024, ...o });
const read = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout ?? "") + (r.stderr ?? "") };
};

export function currentVersion() {
  const v = JSON.parse(readFileSync(join(REPO, "version.json"), "utf8"));
  return { version: v.version, build: String(v.build) };
}

/** The Developer ID Application identity's SHA-1 in the login keychain. */
export function identity() {
  const m = /([0-9A-F]{40}) "Developer ID Application: [^"]*\(7K32QQ2FX8\)"/.exec(read("security", ["find-identity", "-v", "-p", "codesigning"]).out);
  if (!m) throw new Error(`No "Developer ID Application: … (${TEAM})" identity in the keychain.`);
  return m[1];
}

/** Sparkle's command line tools (generate_appcast, sign_update), from the package Xcode resolved. */
export function sparkleBin(tool) {
  for (const dd of [DERIVED, join(CORE, "build/dd")]) {
    const p = join(dd, "SourcePackages/artifacts/sparkle/Sparkle/bin", tool);
    if (existsSync(p)) return p;
  }
  throw new Error(`Sparkle's ${tool} isn't there yet: build once first.`);
}

export function buildRelease({ out, universal = false, version, build, web: given = null }) {
  console.log("\n== the built-in interface, production build");
  const web = given ?? join(out, "web");
  if (!given) run("node", [join(REPO, "apps/web/scripts/build-shell.mjs"), "--production", "--required", "--dest", web, "--app-version", version], { cwd: join(REPO, "apps/web") });

  console.log("\n== the archive");
  const xcodegen = ["/opt/homebrew/bin/xcodegen", "/usr/local/bin/xcodegen"].find((p) => existsSync(p)) ?? "xcodegen";
  run(xcodegen, ["generate", "--spec", join(CORE, "project.yml"), "--project", CORE, "--quiet"], { cwd: CORE });
  const archive = join(out, "FoleviCore.xcarchive");
  rmSync(archive, { recursive: true, force: true });
  // Provisioning through Xcode's signed-in account (the team's Admin): the App Store Connect API key's Developer
  // role can't register the iCloud capability or make Developer ID profiles.
  const auth = ["-allowProvisioningUpdates"];
  run("xcodebuild", ["-project", join(CORE, "FoleviCore.xcodeproj"), "-scheme", "FoleviCore", "-configuration", "Release", "-destination", "generic/platform=macOS", "-derivedDataPath", DERIVED,
    "-archivePath", archive, `ARCHS=${universal ? "arm64 x86_64" : "arm64"}`, "ONLY_ACTIVE_ARCH=NO", `MARKETING_VERSION=${version}`, `CURRENT_PROJECT_VERSION=${build}`, ...auth, "archive"], { cwd: CORE });
  if (!existsSync(join(archive, "Products/Applications/Folevi Core.app"))) throw new Error("The archive has no Folevi Core.app");

  console.log("\n== the Developer ID export (Xcode makes the Developer ID profile, with iCloud)");
  const exportDir = join(out, "export");
  rmSync(exportDir, { recursive: true, force: true });
  const options = join(out, "ExportOptions.plist");
  writeFileSync(options, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>developer-id</string>
<key>signingStyle</key><string>automatic</string>
<key>teamID</key><string>${TEAM}</string>
<key>destination</key><string>export</string>
</dict></plist>`);
  run("xcodebuild", ["-exportArchive", "-archivePath", archive, "-exportPath", exportDir, "-exportOptionsPlist", options, ...auth], { cwd: CORE });
  const archived = join(exportDir, "Folevi Core.app");
  if (!existsSync(archived)) throw new Error(`The export has no ${archived}`);

  console.log("\n== Resources/web, and the Developer ID signature");
  const app = join(out, "Folevi Core.app");
  rmSync(app, { recursive: true, force: true });
  run("ditto", [archived, app]);
  run("ditto", [web, join(app, "Contents/Resources/web")]);
  const entitlements = join(out, "FoleviCore.entitlements.plist");
  writeFileSync(entitlements, execFileSync("codesign", ["-d", "--entitlements", "-", "--xml", archived]));
  const id = identity();
  const sign = (path, ...extra) => existsSync(path) && run("codesign", ["--force", "--options", "runtime", "--timestamp", ...extra, "--sign", id, path]);
  const sparkle = join(app, "Contents/Frameworks/Sparkle.framework");
  if (existsSync(sparkle)) {
    const b = join(sparkle, "Versions/B");
    sign(join(b, "XPCServices/Installer.xpc"));
    sign(join(b, "XPCServices/Downloader.xpc"), "--preserve-metadata=entitlements");
    sign(join(b, "Autoupdate"));
    sign(join(b, "Updater.app"));
    sign(sparkle);
  }
  for (const f of read("find", [join(app, "Contents/Frameworks"), "-maxdepth", "1", "-name", "*.framework", "!", "-name", "Sparkle.framework"]).out.split("\n").filter(Boolean)) sign(f);
  run("codesign", ["--force", "--options", "runtime", "--timestamp", "--entitlements", entitlements, "--sign", id, app]);
  return app;
}

/** Checks a built app: its signature, hardened runtime, team, entitlements, version and built-in interface. */
export function verify(app, { version, build, universal = false } = {}) {
  const problems = [];
  const notes = [];
  const sig = read("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  if (!sig.ok) problems.push(`codesign --verify: ${sig.out.trim()}`);
  const details = read("codesign", ["-dv", "--verbose=4", app]).out;
  if (!details.includes("Authority=Developer ID Application")) problems.push("not signed with Developer ID Application");
  if (!details.includes(`TeamIdentifier=${TEAM}`)) problems.push(`not team ${TEAM}`);
  if (!/flags=.*runtime/.test(details)) problems.push("no hardened runtime");
  if (!details.includes("Timestamp=")) problems.push("no secure timestamp");
  const plist = (k) => read("/usr/libexec/PlistBuddy", ["-c", `Print :${k}`, join(app, "Contents/Info.plist")]).out.trim();
  if (plist("CFBundleIdentifier") !== "app.folevicore.FoleviCore") problems.push(`bundle id ${plist("CFBundleIdentifier")}`);
  if (version && plist("CFBundleShortVersionString") !== version) problems.push(`version ${plist("CFBundleShortVersionString")}, expected ${version}`);
  if (build && plist("CFBundleVersion") !== build) problems.push(`build ${plist("CFBundleVersion")}, expected ${build}`);
  if (!plist("SUPublicEDKey") || plist("SUPublicEDKey").includes("$(")) problems.push("no SUPublicEDKey");
  if (!plist("SUFeedURL").startsWith("https://folevi.com/download/core/")) problems.push(`feed ${plist("SUFeedURL")}`);
  const ent = read("codesign", ["-d", "--entitlements", "-", "--xml", app]).out;
  if (ent.includes("com.apple.security.cs.allow-jit")) problems.push("JIT entitlement present");
  if (ent.includes("get-task-allow")) problems.push("get-task-allow present (a development signature)");
  if (!ent.includes("iCloud.com.folevi")) problems.push("no iCloud container (iCloud.com.folevi) in the entitlements");
  if (!existsSync(join(app, "Contents/embedded.provisionprofile"))) problems.push("no embedded Developer ID profile");
  try {
    const info = JSON.parse(readFileSync(join(app, "Contents/Resources/web/shell/build.json"), "utf8"));
    if (info.target !== "production") problems.push(`Resources/web is a ${info.target} build`);
    if (info.convexUrl !== "https://fastidious-clownfish-123.convex.cloud") problems.push(`Resources/web talks to ${info.convexUrl}`);
    notes.push(`Resources/web: ${info.target}, ${info.convexUrl}, built for ${info.appVersion}`);
  } catch {
    problems.push("Resources/web/shell/build.json is missing");
  }
  const archs = read("lipo", ["-archs", join(app, "Contents/MacOS/Folevi Core")]).out.trim();
  if (archs !== (universal ? "x86_64 arm64" : "arm64") && archs !== (universal ? "arm64 x86_64" : "arm64")) problems.push(`architectures: ${archs}`);
  return { problems, notes };
}

/** A DMG with the app and an Applications link, signed (notarized later, by publish.mjs). */
export function makeDmg(app, dmg) {
  const stage = join(dirname(dmg), "dmg-stage");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  run("ditto", [app, join(stage, "Folevi Core.app")]);
  run("ln", ["-s", "/Applications", join(stage, "Applications")]);
  rmSync(dmg, { force: true });
  run("hdiutil", ["create", "-volname", "Folevi Core", "-srcfolder", stage, "-ov", "-format", "UDZO", dmg]);
  run("codesign", ["--force", "--timestamp", "--sign", identity(), dmg]);
  rmSync(stage, { recursive: true, force: true });
  return dmg;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes(n);
  const value = (n) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : null);
  const { version, build } = currentVersion();
  const out = resolve(value("--out") ?? join(CORE, "release-dist", version));
  mkdirSync(out, { recursive: true });
  console.log(`== Folevi Core ${version} (build ${build}) into ${out}`);
  const app = buildRelease({ out, universal: flag("--universal"), version, build, web: value("--web") });
  const { problems, notes } = verify(app, { version, build, universal: flag("--universal") });
  notes.forEach((n) => console.log("  " + n));
  if (problems.length) {
    console.error("\nProblems:\n  " + problems.join("\n  "));
    process.exit(1);
  }
  const dmg = makeDmg(app, join(out, `FoleviCore-${version}.dmg`));
  if (flag("--launch-check")) {
    const data = join(out, "launch-check");
    mkdirSync(data, { recursive: true });
    const child = spawn(join(app, "Contents/MacOS/Folevi Core"), [], { env: { ...process.env, FOLEVI_USER_DATA: data, FOLEVI_UPDATES: "off" }, stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 8000));
    const alive = child.exitCode === null;
    child.kill();
    if (!alive) {
      console.error("The release build quit within 8 seconds of launching.");
      process.exit(1);
    }
    console.log("  launch check: still running after 8 s");
  }
  console.log(`\nBuilt and checked (not notarized): ${app}\nDMG: ${dmg}\nTo ship it: node apps/mac-core/scripts/publish.mjs (the owner runs it).`);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
