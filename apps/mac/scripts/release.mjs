#!/usr/bin/env node
// Builds the release Folevi for Mac (docs/MAC_WEBKIT_PLAN.md §9.1): com.folevi.mac, Developer ID, hardened runtime,
// iCloud and the Keychain group from the Developer ID profile, Sparkle inside, the production interface in
// Resources/web. A DRY RUN BY DEFAULT: the build goes to a scratch folder and is checked; nothing is bumped, installed
// or opened, and /Applications is never touched. Only the owner passes --install.
//
//   node apps/mac/scripts/release.mjs [--out DIR] [--universal] [--launch-check] [--web DIR]   dry run (builders)
//   node apps/mac/scripts/release.mjs --install [--universal]                       the owner's release
//
//   1. the version: kept in a dry run; with --install bumped once the current one was released (bump-version.mjs)
//   2. the built-in interface, production build (apps/web build-shell.mjs --production, this app's version)
//   3. XcodeGen, then `xcodebuild archive` (Release; arm64, or arm64 + x86_64 with --universal)
//   4. Resources/web goes into the archived app, which is signed again (the outer bundle only, with the archive's
//      own entitlements; Sparkle's nested code keeps Xcode's signatures)
//   5. checks: the signature (deep, strict), Gatekeeper's view (unnotarized until publish.mjs), the entitlements
//      (iCloud container, Keychain group, microphone, no JIT), the embedded profile, Resources/web's build.json,
//      Sparkle (framework, feed, public key = the key in the login Keychain), the designated requirement the
//      Electron app's Keychain item and Squirrel's update check ask for, the architectures
//   6. --launch-check: opens the build once on a scratch FOLEVI_USER_DATA (no updates, no migration of real data).
//      Its folder, Keychain names and web storage are the run's own, but AppKit still keeps small window state in
//      com.folevi.mac's preferences, which the installed Folevi shares: leave it off on the owner's Mac
//   7. --install (owner only): replaces /Applications/Folevi.app (an Electron copy is kept as "Folevi (previous).app"),
//      tags mac-v<version>, opens it
// publish.mjs (owner only) notarizes, staples, makes the DMG and ZIP, signs the appcast and uploads.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bump, currentVersion } from "./bump-version.mjs";
import { MAC, generateProject } from "./project.mjs";

export const TEAM = "7K32QQ2FX8";
export const BUNDLE_ID = "com.folevi.mac";
export const PROFILE_NAME = "Folevi for Mac Developer ID iCloud";
export const PROFILE_FILE = join(MAC, "signing", "Folevi.provisionprofile");
export const SPARKLE_ACCOUNT = "folevi";
export const FEED_URL = "https://updates.folevi.com/mac/appcast.xml";
/** The designated requirement both the Electron app (installed today) and this one carry: Squirrel.Mac checks an update
 * against the running app's, and the Keychain hands Electron's safeStorage item to an app that meets it (R1). */
export const ELECTRON_REQUIREMENT = `identifier "${BUNDLE_ID}" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and certificate leaf[subject.OU] = "${TEAM}"`;
const REPO = resolve(MAC, "../..");
const DERIVED = join(MAC, "build", "DerivedData-release");
export const sparkleBin = () => join(DERIVED, "SourcePackages", "artifacts", "sparkle", "Sparkle", "bin");

const run = (cmd, args, o = {}) => execFileSync(cmd, args, { stdio: "inherit", maxBuffer: 256 * 1024 * 1024, ...o });
const read = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

/** The Developer ID Application identity's SHA-1 in the login keychain. */
export function identity() {
  const m = /([0-9A-F]{40}) "Developer ID Application: [^"]*\(7K32QQ2FX8\)"/.exec(read("security", ["find-identity", "-v", "-p", "codesigning"]).out);
  if (!m) throw new Error(`No "Developer ID Application: … (${TEAM})" identity in the keychain.`);
  return m[1];
}

/** The profile's plist (security cms decodes it; a profile isn't secret). */
export function profileInfo(file = PROFILE_FILE) {
  const xml = execFileSync("security", ["cms", "-D", "-i", file], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const tmp = join(mkdtempSync(join(tmpdir(), "folevi-profile-")), "p.plist");
  writeFileSync(tmp, xml);
  const get = (key) => read("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, tmp]).out.trim();
  const info = { uuid: get("UUID"), name: get("Name"), expires: new Date(get("ExpirationDate")), appId: get("Entitlements:com.apple.application-identifier"), xml };
  rmSync(join(tmp, ".."), { recursive: true, force: true });
  return info;
}

/** Xcode finds a manual signing profile by name in its profiles folder: the committed one is put there (by UUID). */
export function installProfile() {
  const p = profileInfo();
  if (p.name !== PROFILE_NAME || p.appId !== `${TEAM}.${BUNDLE_ID}`) throw new Error(`signing/Folevi.provisionprofile is "${p.name}" for ${p.appId}`);
  if (p.expires < new Date()) throw new Error(`The Developer ID profile expired on ${p.expires.toISOString().slice(0, 10)}: make a new one (docs/MAC_RELEASE.md).`);
  const dir = join(homedir(), "Library", "Developer", "Xcode", "UserData", "Provisioning Profiles");
  const target = join(dir, `${p.uuid}.provisionprofile`);
  if (!existsSync(target)) {
    mkdirSync(dir, { recursive: true });
    cpSync(PROFILE_FILE, target);
  }
  return p;
}

/** The Info.plist value of a bundle. */
const plist = (app, key) => read("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, join(app, "Contents", "Info.plist")]).out.trim();

/** Launch Services notices bundles as they're written: a build outside /Applications must never answer folevi:// links. */
export function unregister(...apps) {
  const ls = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  for (const a of apps) if (existsSync(a)) spawnSync(ls, ["-u", a], { stdio: "ignore" });
}

/** Every check of step 5; returns the problems (empty when the build is fit). */
export function verify(app, { version, universal = false, notarized = false } = {}) {
  const problems = [];
  const notes = [];
  const sig = read("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  if (!sig.ok) problems.push(`codesign --verify: ${sig.out.trim()}`);
  const details = read("codesign", ["-dv", "--verbose=4", app]).out;
  if (!details.includes("Authority=Developer ID Application:") || !details.includes(`TeamIdentifier=${TEAM}`)) problems.push("not signed with the team's Developer ID Application certificate");
  if (!/flags=0x10000\(runtime\)/.test(details)) problems.push("no hardened runtime");
  if (!/Timestamp=/.test(details)) notes.push("no secure timestamp (notarization needs one; publish.mjs signs with it)");
  const dr = read("codesign", ["-d", "-r-", app]).out;
  const designated = /designated => (.*)/.exec(dr)?.[1]?.trim();
  if (designated !== ELECTRON_REQUIREMENT) problems.push(`designated requirement differs from the Electron app's:\n    ${designated}\n    ${ELECTRON_REQUIREMENT}`);
  // What Squirrel.Mac asks of an update (it must meet the running Electron app's requirement).
  if (!read("codesign", ["--verify", `-R=${ELECTRON_REQUIREMENT}`, app]).ok) problems.push("doesn't meet the Electron app's designated requirement");
  const installed = "/Applications/Folevi.app";
  if (existsSync(installed)) {
    const theirs = /designated => (.*)/.exec(read("codesign", ["-d", "-r-", installed]).out)?.[1]?.trim();
    if (theirs && theirs !== designated) problems.push(`the installed Folevi's designated requirement is different (${theirs})`);
    else if (theirs) notes.push("same designated requirement as the installed Folevi (its Keychain item and Squirrel accept this build)");
  }
  const gate = read("spctl", ["-a", "-t", "exec", "-vv", app]).out;
  if (notarized ? !/source=Notarized Developer ID/.test(gate) : !/source=(Unnotarized|Notarized) Developer ID/.test(gate)) problems.push(`Gatekeeper: ${gate.trim()}`);
  else notes.push(`Gatekeeper: ${/source=([^\n]*)/.exec(gate)?.[1] ?? gate.trim()}`);
  const ent = read("codesign", ["-d", "--entitlements", "-", "--xml", app]).out;
  for (const want of ["iCloud.com.folevi", `${TEAM}.com.folevi.mac`, "com.apple.security.device.audio-input", "CloudDocuments", "com.apple.developer.icloud-container-environment", `${TEAM}.${BUNDLE_ID}`]) {
    if (!ent.includes(want)) problems.push(`entitlements lack ${want}`);
  }
  for (const banned of ["com.apple.security.cs.allow-jit", "com.apple.security.cs.allow-unsigned-executable-memory", "com.apple.security.app-sandbox", "get-task-allow"]) {
    if (ent.includes(banned)) problems.push(`entitlements have ${banned}`);
  }
  const embedded = join(app, "Contents", "embedded.provisionprofile");
  if (!existsSync(embedded)) problems.push("no embedded.provisionprofile");
  else if (profileInfo(embedded).uuid !== profileInfo().uuid) problems.push("the embedded profile isn't signing/Folevi.provisionprofile");
  if (plist(app, "CFBundleIdentifier") !== BUNDLE_ID) problems.push(`bundle id ${plist(app, "CFBundleIdentifier")}`);
  if (version && plist(app, "CFBundleShortVersionString") !== version) problems.push(`Info.plist says ${plist(app, "CFBundleShortVersionString")}, project.yml ${version}`);
  if (plist(app, "LSMinimumSystemVersion") !== "15.0") problems.push(`minimum macOS ${plist(app, "LSMinimumSystemVersion")}`);
  // The built-in interface, production, for this version.
  try {
    const info = JSON.parse(readFileSync(join(app, "Contents", "Resources", "web", "shell", "build.json"), "utf8"));
    if (info.target !== "production") problems.push(`Resources/web is a ${info.target} build`);
    if (info.convexUrl !== "https://fastidious-clownfish-123.convex.cloud") problems.push(`Resources/web talks to ${info.convexUrl}`);
    if (info.siteUrl !== "https://app.folevi.com") problems.push(`Resources/web signs in at ${info.siteUrl}`);
    if (info.platform !== "mac") problems.push(`Resources/web is for ${info.platform}`);
    if (version && info.appVersion !== version) problems.push(`Resources/web was built for ${info.appVersion}, the app is ${version}`);
    if (!existsSync(join(app, "Contents", "Resources", "web", "index.html"))) problems.push("Resources/web has no index.html");
    notes.push(`Resources/web: production, ${info.convexUrl}, IndexedDB v${info.dbVersion}`);
  } catch {
    problems.push("Resources/web/shell/build.json is missing");
  }
  if (!existsSync(join(app, "Contents", "Resources", "handover-kit.js"))) problems.push("Resources/handover-kit.js is missing (the migration's import)");
  // Sparkle.
  const sparkle = join(app, "Contents", "Frameworks", "Sparkle.framework");
  if (!existsSync(sparkle)) problems.push("no Sparkle.framework");
  else if (!read("codesign", ["-dv", "--verbose=2", sparkle]).out.includes(`TeamIdentifier=${TEAM}`)) problems.push("Sparkle.framework isn't signed by the team");
  if (plist(app, "SUFeedURL") !== FEED_URL) problems.push(`SUFeedURL is ${plist(app, "SUFeedURL")}`);
  const pub = plist(app, "SUPublicEDKey");
  const keychainPub = existsSync(join(sparkleBin(), "generate_keys")) ? read(join(sparkleBin(), "generate_keys"), ["-p", "--account", SPARKLE_ACCOUNT]).out.trim() : "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(pub)) problems.push("SUPublicEDKey isn't an EdDSA public key");
  else if (keychainPub && keychainPub !== pub) problems.push(`SUPublicEDKey isn't the login Keychain's Sparkle key (account ${SPARKLE_ACCOUNT})`);
  else if (keychainPub) notes.push("SUPublicEDKey is the login Keychain's Sparkle key");
  const archs = read("lipo", ["-archs", join(app, "Contents", "MacOS", plist(app, "CFBundleExecutable"))]).out.trim().split(/\s+/).sort().join(" ");
  if (archs !== (universal ? "arm64 x86_64" : "arm64")) problems.push(`architectures: ${archs}`);
  notes.push(`architectures: ${archs}`);
  return { problems, notes };
}

/** Steps 2 to 5: the export, the archive, Resources/web, the signature; returns the app's path. */
export function buildRelease({ out, universal = false, version, web: given = null }) {
  console.log("\n== the built-in interface, production build");
  const web = given ?? join(out, "web");
  if (given) console.log(`Using the export in ${given} (checked with the app below)`);
  else run("node", [join(REPO, "apps/web/scripts/build-shell.mjs"), "--production", "--required", "--dest", web, "--app-version", version], { cwd: join(REPO, "apps/web") });

  console.log("\n== the archive");
  const profile = installProfile();
  console.log(`Signing with "${profile.name}" (${profile.uuid}), expires ${profile.expires.toISOString().slice(0, 10)}`);
  const project = generateProject({ quiet: true });
  const archive = join(out, "Folevi.xcarchive");
  rmSync(archive, { recursive: true, force: true });
  run("xcodebuild", ["-project", project, "-scheme", "Folevi", "-configuration", "Release", "-destination", "generic/platform=macOS", "-derivedDataPath", DERIVED,
    "-archivePath", archive, `ARCHS=${universal ? "arm64 x86_64" : "arm64"}`, "ONLY_ACTIVE_ARCH=NO", "archive"], { cwd: MAC });
  const archived = join(archive, "Products", "Applications", "Folevi.app");
  if (!existsSync(archived)) throw new Error(`The archive has no ${archived}`);

  console.log("\n== Resources/web, and the signature again");
  const app = join(out, "Folevi.app");
  rmSync(app, { recursive: true, force: true });
  run("ditto", [archived, app]);
  run("ditto", [web, join(app, "Contents", "Resources", "web")]);
  const entitlements = join(out, "Folevi.entitlements.plist");
  writeFileSync(entitlements, execFileSync("codesign", ["-d", "--entitlements", "-", "--xml", archived]));
  run("codesign", ["--force", "--options", "runtime", "--timestamp", "--entitlements", entitlements, "--sign", identity(), app]);
  // Xcode registers what it builds with Launch Services too: none of these copies may answer folevi:// links.
  const built = spawnSync("find", [DERIVED, "-name", "Folevi.app", "-type", "d", "-prune"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  unregister(archived, app, ...built);
  return app;
}

/** Opens the build once on a scratch data folder and checks it keeps running. */
async function launchCheck(app, out) {
  const data = join(out, "launch-check");
  mkdirSync(data, { recursive: true });
  const exe = join(app, "Contents", "MacOS", plist(app, "CFBundleExecutable"));
  const child = spawn(exe, [], { env: { ...process.env, FOLEVI_USER_DATA: data, FOLEVI_UPDATES: "off" }, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 8000));
  const alive = child.exitCode === null;
  child.kill();
  unregister(app);
  return alive;
}

async function main() {
  const argv = process.argv.slice(2);
  const install = argv.includes("--install");
  const universal = argv.includes("--universal");
  const outFlag = argv.indexOf("--out");
  const out = resolve(outFlag >= 0 && argv[outFlag + 1] ? argv[outFlag + 1] : install ? join(MAC, "release") : mkdtempSync(join(tmpdir(), "folevi-mac-release-")));
  mkdirSync(out, { recursive: true });
  console.log(`== the version${install ? "" : " (dry run: kept)"}`);
  const { version, build } = install ? bump() : currentVersion();
  console.log(`Folevi for Mac ${version} (${build})`);

  // --web <dir>: an export already made by build-shell.mjs --production --app-version <version> (dry runs only).
  const webFlag = argv.indexOf("--web");
  const web = !install && webFlag >= 0 && argv[webFlag + 1] ? resolve(argv[webFlag + 1]) : null;
  const app = buildRelease({ out, universal, version, web });

  console.log("\n== checks");
  const { problems, notes } = verify(app, { version, universal });
  for (const n of notes) console.log(`  ok  ${n}`);
  if (argv.includes("--launch-check")) {
    const alive = await launchCheck(app, out);
    if (!alive) problems.push("the build quit within 8 seconds of opening");
    else console.log("  ok  opens and keeps running (scratch data folder)");
  }
  writeFileSync(join(out, "checks.json"), `${JSON.stringify({ version, build, universal, problems, notes, at: new Date().toISOString() }, null, 2)}\n`);
  if (problems.length) {
    console.error(`\nThe build isn't fit to release:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  if (!install) {
    console.log(`\nDry run done, nothing installed or opened: ${out}\n  app     ${app}\n  checks  ${join(out, "checks.json")}`);
    return;
  }

  console.log("\n== install (/Applications)");
  const installed = "/Applications/Folevi.app";
  spawnSync("osascript", ["-e", `if application id "${BUNDLE_ID}" is running then tell application id "${BUNDLE_ID}" to quit`], { stdio: "ignore" });
  for (let i = 0; i < 60 && read("pgrep", ["-f", `${installed}/Contents/MacOS/`]).ok; i++) execFileSync("sleep", ["0.5"]);
  if (read("pgrep", ["-f", `${installed}/Contents/MacOS/`]).ok) throw new Error("Folevi didn't quit: quit it and run this again.");
  if (existsSync(installed)) {
    const electron = existsSync(join(installed, "Contents", "Frameworks", "Electron Framework.framework"));
    if (electron) {
      // Kept until the owner says it can go (phase 3): opened once, it sends what it hadn't (docs/MAC_RELEASE.md).
      const previous = "/Applications/Folevi (previous).app";
      if (existsSync(previous)) spawnSync("osascript", ["-e", `tell application "Finder" to delete POSIX file "${previous}"`], { stdio: "ignore" });
      run("mv", [installed, previous]);
      console.log(`The Electron Folevi is kept as ${previous}.`);
    } else {
      spawnSync("osascript", ["-e", `tell application "Finder" to delete POSIX file "${installed}"`], { stdio: "ignore" });
      if (existsSync(installed)) rmSync(installed, { recursive: true, force: true });
    }
  }
  run("ditto", [app, installed]);
  unregister(app);
  spawnSync("git", ["tag", `mac-v${version}`], { cwd: MAC, stdio: "inherit" });
  run("open", [installed]);
  console.log(`Folevi ${version} is in /Applications (tagged mac-v${version}; commit apps/mac/project.yml if the version moved).`);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}
