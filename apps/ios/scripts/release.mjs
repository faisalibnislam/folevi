#!/usr/bin/env node
// Builds Folevi for iPhone and iPad for TestFlight and uploads it to App Store Connect (app 6825699028), for
// internal testing only. Never submits for external TestFlight review or App Store review.
//
//   node scripts/release.mjs [--build <n>] [--no-upload] [--skip-shell]
//
// 1. The built-in interface for production (apps/web build-shell.mjs --platform ios --production) into web/.
// 2. scripts/sync-web.mjs with the production settings (https://app.folevi.com, bundled).
// 3. The version and build: version.json's (scripts/version.mjs at the repo root writes them into the project for
//    every target); --build <n> raises the hidden build there first (App Store Connect needs a new one per upload).
//    "Folevi 1.0.00" is what people see; the build number is never shown.
// 4. A Release archive, signed automatically on team 7K32QQ2FX8 (-allowProvisioningUpdates with the App Store
//    Connect API key), then exported for App Store Connect with App Store profiles, which the API makes when
//    they're missing (the key can't use cloud-managed distribution certificates, so the profiles name the
//    "Apple Distribution" certificate in this Mac's keychain).
// 5. The upload (altool with the same key). Processing at Apple takes a few minutes; the build then shows
//    in TestFlight for the internal group.
//
// The key: FOLEVI_ASC_KEY_ID (default HS88CK5RQF), FOLEVI_ASC_ISSUER, and the .p8 in
// ~/.appstoreconnect/private_keys/AuthKey_<id>.p8 (read here only to sign API requests; never printed).
import { execFileSync } from "node:child_process";
import { createPrivateKey, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO, outOfSync, readVersion, writeVersion } from "../../../scripts/version.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ios = resolve(here, "..");
const project = join(ios, "ios/App");
const out = join(ios, "release");
const TEAM = "7K32QQ2FX8";
const KEY_ID = process.env.FOLEVI_ASC_KEY_ID ?? "HS88CK5RQF";
const ISSUER = process.env.FOLEVI_ASC_ISSUER ?? "9479ebb4-e44a-45b4-bfef-e625408057ae";
const KEY_PATH = join(homedir(), ".appstoreconnect/private_keys", `AuthKey_${KEY_ID}.p8`);
const TARGETS = { "com.folevi.ios": "Folevi App Store com.folevi.ios", "com.folevi.ios.share": "Folevi App Store com.folevi.ios.share", "com.folevi.ios.widgets": "Folevi App Store com.folevi.ios.widgets" };
const PROFILES_DIR = join(homedir(), "Library/Developer/Xcode/UserData/Provisioning Profiles");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });
const authArgs = ["-allowProvisioningUpdates", "-authenticationKeyPath", KEY_PATH, "-authenticationKeyID", KEY_ID, "-authenticationKeyIssuerID", ISSUER];

if (!existsSync(KEY_PATH)) throw new Error(`No App Store Connect key at ${KEY_PATH}.`);

// ---------------------------------------------------------------- App Store Connect API

function jwt() {
  const key = createPrivateKey(readFileSync(KEY_PATH));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "ES256", kid: KEY_ID, typ: "JWT" });
  const body = b64({ iss: ISSUER, iat: now, exp: now + 600, aud: "appstoreconnect-v1" });
  return `${head}.${body}.${sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

async function api(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, { method, headers: { authorization: `Bearer ${jwt()}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`App Store Connect ${method} ${path}: ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

/** The App Store profiles for the app and its extensions: installed for Xcode, made through the API if missing. */
async function ensureProfiles() {
  const certs = (await api("GET", "/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=20")).data;
  if (!certs.length) throw new Error("No Apple Distribution certificate on the team.");
  const profiles = (await api("GET", "/v1/profiles?filter[profileType]=IOS_APP_STORE&filter[profileState]=ACTIVE&limit=100")).data;
  mkdirSync(PROFILES_DIR, { recursive: true });
  for (const [bundle, name] of Object.entries(TARGETS)) {
    let profile = profiles.find((p) => p.attributes.name === name);
    if (!profile) {
      const ids = (await api("GET", `/v1/bundleIds?filter[identifier]=${bundle}&limit=5`)).data.filter((b) => b.attributes.identifier === bundle);
      if (!ids.length) throw new Error(`No App ID ${bundle}.`);
      profile = (await api("POST", "/v1/profiles", { data: { type: "profiles", attributes: { name, profileType: "IOS_APP_STORE" }, relationships: { bundleId: { data: { type: "bundleIds", id: ids[0].id } }, certificates: { data: [{ type: "certificates", id: certs[0].id }] } } } })).data;
      console.log(`  made the profile "${name}"`);
    }
    writeFileSync(join(PROFILES_DIR, `${profile.attributes.uuid}.mobileprovision`), Buffer.from(profile.attributes.profileContent, "base64"));
  }
}

// ---------------------------------------------------------------- the build

if (!flag("--skip-shell")) {
  console.log("build-shell: the built-in interface for production");
  run("node", [resolve(ios, "../web/scripts/build-shell.mjs"), "--platform", "ios", "--production", "--required"]);
}
run("node", [join(here, "bundle-cloud.mjs")]);
const env = { ...process.env };
delete env.FOLEVI_URL;
delete env.FOLEVI_SHELL_URL;
delete env.FOLEVI_SERVICE_URL;
run("node", [join(here, "sync-web.mjs")], { cwd: ios, env });

const build = value("--build");
if (build) {
  if (!/^\d+$/.test(build)) throw new Error("--build is a whole number.");
  const current = readVersion();
  if (Number(build) <= current.build) throw new Error(`--build ${build} isn't newer than version.json's ${current.build}.`);
  writeVersion(REPO, { version: current.version, build: Number(build) });
}
if (outOfSync().length) throw new Error(`The projects don't say version.json's version (${outOfSync().join(", ")}): run node scripts/version.mjs sync.`);
const { version, build: buildNumber } = readVersion();
console.log(`Folevi ${version} (build ${buildNumber}, never shown)`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const archive = join(out, "Folevi.xcarchive");
run("xcodebuild", ["-quiet", "-project", join(project, "App.xcodeproj"), "-scheme", "App", "-configuration", "Release", "-destination", "generic/platform=iOS", "-archivePath", archive, "-derivedDataPath", join(project, "build/DerivedDataRelease"), ...authArgs, "archive"]);

await ensureProfiles();
const options = join(out, "ExportOptions.plist");
writeFileSync(
  options,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key><string>app-store-connect</string>
	<key>teamID</key><string>${TEAM}</string>
	<key>signingStyle</key><string>manual</string>
	<key>signingCertificate</key><string>Apple Distribution</string>
	<key>provisioningProfiles</key>
	<dict>
${Object.entries(TARGETS)
  .map(([b, n]) => `		<key>${b}</key><string>${n}</string>`)
  .join("\n")}
	</dict>
	<key>destination</key><string>export</string>
	<key>uploadSymbols</key><true/>
	<key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
`,
);
run("xcodebuild", ["-exportArchive", "-archivePath", archive, "-exportPath", out, "-exportOptionsPlist", options]);
const ipa = readdirSync(out).find((f) => f.endsWith(".ipa"));
if (!ipa) throw new Error("The export made no .ipa.");
console.log(`  ${join(out, ipa)}`);

if (!flag("--no-upload")) {
  run("xcrun", ["altool", "--upload-app", "--type", "ios", "--file", join(out, ipa), "--apiKey", KEY_ID, "--apiIssuer", ISSUER]);
  console.log("Uploaded. TestFlight shows the build to the internal group once Apple has processed it.");
}
