#!/usr/bin/env node
// The native iPhone frame's smoke run on the Simulator (docs/NATIVE_APP_PLAN.md N5/N17):
//
//   node scripts/native-smoke.mjs [--out <dir>] [--device "iPhone 18 Pro"] [--skip-build] [--only <test>] [--keep]
//
// 1. A scratch test account on the development deployment (sign-up through the local dev server, the confirmation
//    from its development mailbox), never production, never the owner's account.
// 2. The Debug build (DerivedData in --dd or the scratch folder) installed on one Simulator (reusing a booted one,
//    else booting the named device; the software keyboard on, as a person types).
// 3. The app launched with the session (FOLEVI_TEST_SESSION, DebugHooks.seedFromEnvironment), onboarding finished
//    on the server for that account (the native onboarding screens come with N14).
// 4. FoleviUITests/NativeFrameUITests with screenshots into --out, then the app's own timings (native-metrics.json).
//
// Needs: the dev server on FOLEVI_SERVICE_URL (default http://app.localhost:3002), apps/web/.env.local for the
// development deployment, the shell export synced (pnpm shell && pnpm sync with FOLEVI_SERVICE_URL), Xcode.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const here = import.meta.dirname;
const ios = resolve(here, "..");
const repo = resolve(ios, "../..");
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const value = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const OUT = resolve(value("--out", join(ios, "build/native-smoke")));
const DD = resolve(value("--dd", join(ios, "build/dd-native")));
const DEVICE = value("--device", "iPhone 18 Pro");
const BUNDLE = "com.folevi.ios";
const SERVICE = new URL(process.env.FOLEVI_SERVICE_URL ?? "http://app.localhost:3002");
const PRODUCTION_DEPLOYMENT = "fastidious-clownfish-123";
mkdirSync(OUT, { recursive: true });
const log = (m) => console.log(`[native-smoke] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, args, o = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: o.quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"], ...o });
const simctl = (...a) => sh("xcrun", ["simctl", ...a], { quiet: true });

const env = Object.fromEntries(
  readFileSync(join(repo, "apps/web/.env.local"), "utf8")
    .split("\n")
    .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim().replace(/^(['"])(.*)\1$/, "$2")]),
);
const CONVEX = env.NEXT_PUBLIC_CONVEX_URL;
if (!CONVEX || CONVEX.includes(PRODUCTION_DEPLOYMENT)) throw new Error("native-smoke runs on the development deployment only.");
if (!/(^|\.)localhost$/.test(SERVICE.hostname)) throw new Error("native-smoke signs up on a local dev server only.");

// ---- the scratch account
const PASSWORD = "quiet folio native smoke";
const json = async (res) => {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return { raw: t.slice(0, 300) }; }
};
async function newAccount() {
  const email = `native-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const headers = { "content-type": "application/json", origin: SERVICE.origin };
  let res = await fetch(new URL("/api/auth/sign-up/email", SERVICE), { method: "POST", headers, body: JSON.stringify({ email, password: PASSWORD, name: "Native Smoke" }) });
  if (!res.ok) throw new Error(`sign-up: ${res.status} ${JSON.stringify(await json(res))}`);
  let link;
  for (let i = 0; i < 60 && !link; i++) {
    const box = await json(await fetch(new URL(`/api/dev/mailbox?to=${encodeURIComponent(email)}`, SERVICE)));
    link = box.messages?.find((m) => m.key === "auth_verify_email")?.actionUrl;
    if (!link) await sleep(250);
  }
  if (!link) throw new Error("No confirmation email in the development mailbox.");
  const verify = new URL(link);
  verify.host = SERVICE.host;
  await fetch(verify, { redirect: "manual" });
  res = await fetch(new URL("/api/auth/sign-in/email", SERVICE), { method: "POST", headers, body: JSON.stringify({ email, password: PASSWORD }) });
  const token = res.headers.get("set-auth-token");
  if (!res.ok || !token) throw new Error(`sign-in: ${res.status}`);
  return { email, token };
}
async function convex(token, path, args) {
  const r = await fetch(new URL("/api/auth/convex/token", SERVICE), { headers: { authorization: `Bearer ${token}`, origin: SERVICE.origin } });
  const jwt = (await json(r)).token;
  if (!jwt) throw new Error(`convex token: ${r.status}`);
  const res = await fetch(`${CONVEX}/api/mutation`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` }, body: JSON.stringify({ path, args, format: "json" }) });
  return json(res);
}

// ---- the Simulator
function device() {
  const all = Object.values(JSON.parse(simctl("list", "devices", "--json")).devices).flat();
  const booted = all.filter((d) => d.state === "Booted");
  if (booted.length) {
    log(`reusing the booted Simulator ${booted[0].name}`);
    return { udid: booted[0].udid, bootedHere: false };
  }
  const d = all.find((x) => x.name === DEVICE && x.isAvailable);
  if (!d) throw new Error(`No Simulator named ${DEVICE}.`);
  // The software keyboard (the Simulator's I/O > Keyboard > Connect Hardware Keyboard off), set before booting.
  const before = spawnSync("defaults", ["read", "com.apple.iphonesimulator", "ConnectHardwareKeyboard"], { encoding: "utf8" });
  result.hardwareKeyboardBefore = before.status === 0 ? before.stdout.trim() : null;
  spawnSync("defaults", ["write", "com.apple.iphonesimulator", "ConnectHardwareKeyboard", "-bool", "false"]);
  simctl("boot", d.udid);
  sh("xcrun", ["simctl", "bootstatus", d.udid, "-b"], { quiet: true });
  return { udid: d.udid, bootedHere: true };
}

const project = join(ios, "ios/App/App.xcodeproj");
const destination = (udid) => `platform=iOS Simulator,id=${udid}`;

const result = { startedAt: new Date().toISOString(), out: OUT };
let dev;
try {
  if (!flag("--skip-build")) {
    log("building (Debug, Simulator)");
    sh("xcodebuild", ["-quiet", "-project", project, "-scheme", "FoleviUITests", "-configuration", "Debug", "-destination", "generic/platform=iOS Simulator", "-derivedDataPath", DD, "build-for-testing"]);
  }
  const app = join(DD, "Build/Products/Debug-iphonesimulator/App.app");
  dev = device();
  // A fresh install: nothing from an earlier run (the Simulator's own app container, never the owner's data).
  spawnSync("xcrun", ["simctl", "uninstall", dev.udid, BUNDLE]);
  simctl("install", dev.udid, app);
  const account = await newAccount();
  result.account = account.email;
  log(`scratch account ${account.email}`);
  sh("xcrun", ["simctl", "launch", dev.udid, BUNDLE], { quiet: true, env: { ...process.env, SIMCTL_CHILD_FOLEVI_TEST_SESSION: account.token } });
  // Onboarding, finished on the server once the app has made the profile.
  let done = false;
  for (let i = 0; i < 90 && !done; i++) {
    await sleep(1000);
    const a = await convex(account.token, "users:completeOnboardingStep", { step: "ai" });
    if (a.status === "success") {
      const b = await convex(account.token, "users:completeOnboardingStep", { step: "welcome" });
      done = b.status === "success";
    }
  }
  result.onboarded = done;
  log(done ? "onboarding finished on the server" : "onboarding still open (the profile never appeared)");
  await sleep(4000);
  simctl("io", dev.udid, "screenshot", join(OUT, "00-after-seed.png"));
  simctl("terminate", dev.udid, BUNDLE);

  const only = value("--only", "FoleviUITests/NativeFrameUITests");
  log(`running ${only}`);
  // xcodebuild sometimes stays up for minutes after the last test ends (the runner's teardown on this Xcode):
  // once the selected tests' suite has reported, it gets 30 s to finish, then it's stopped.
  const t = await new Promise((done) => {
    const child = spawn("xcodebuild", ["-project", project, "-scheme", "FoleviUITests", "-configuration", "Debug", "-destination", destination(dev.udid), "-derivedDataPath", DD, "-resultBundlePath", join(OUT, `results-${Date.now()}.xcresult`), "-only-testing:" + only, "test-without-building"], {
      env: { ...process.env, TEST_RUNNER_FOLEVI_SHOTS: OUT },
    });
    let stdout = "";
    let status = null;
    let killer;
    child.stdout.on("data", (b) => {
      stdout += b;
      const m = /Test Suite '(?:Selected tests|All tests)' (passed|failed)/.exec(stdout);
      if (m && status === null) {
        status = m[1] === "passed" ? 0 : 1;
        killer = setTimeout(() => child.kill("SIGTERM"), 30000);
      }
    });
    child.stderr.on("data", (b) => (stdout += b));
    const cap = setTimeout(() => child.kill("SIGTERM"), 40 * 60 * 1000);
    child.on("close", (code) => {
      clearTimeout(killer);
      clearTimeout(cap);
      done({ stdout, status: status ?? code });
    });
  });
  writeFileSync(join(OUT, "xcodebuild.log"), (t.stdout ?? "") + (t.stderr ?? ""));
  const lines = (t.stdout ?? "").split("\n").filter((l) => /Test Case|error:|measured|TEST (SUCCEEDED|FAILED)|XCTAssert/.test(l));
  result.tests = lines;
  result.passed = t.status === 0;
  lines.forEach((l) => log(l.trim()));
  const container = simctl("get_app_container", dev.udid, BUNDLE, "data").trim();
  const metrics = join(container, "tmp/native-metrics.json");
  if (existsSync(metrics)) result.metrics = JSON.parse(readFileSync(metrics, "utf8"));
} finally {
  writeFileSync(join(OUT, "result.json"), JSON.stringify(result, null, 2));
  if (dev?.bootedHere && !flag("--keep")) simctl("shutdown", dev.udid);
  // The Simulator's keyboard setting as it was.
  if (result.hardwareKeyboardBefore === "1") spawnSync("defaults", ["write", "com.apple.iphonesimulator", "ConnectHardwareKeyboard", "-bool", "true"]);
  else if (result.hardwareKeyboardBefore === null && dev?.bootedHere) spawnSync("defaults", ["delete", "com.apple.iphonesimulator", "ConnectHardwareKeyboard"]);
  log(`result in ${join(OUT, "result.json")}`);
}
