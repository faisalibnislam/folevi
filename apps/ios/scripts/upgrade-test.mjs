#!/usr/bin/env node
// The upgrade release gate (docs/NATIVE_APP_PLAN.md N1 and R6): an install of the shipped app, with a signed-in
// account, notes, an edit made offline and not sent, and local settings, is upgraded in place to this tree's build,
// and everything must still be there and the edit must reach the server.
//
//   node scripts/upgrade-test.mjs [--old-ref 5b7fc87d] [--work <dir>] [--new-app <App.app>] [--rebuild-old] [--keep-device] [--allow-other-simulators]
//
// 1. The shipped build from git (default 5b7fc87d, Folevi 1.0.02 build 6, the Capacitor app), built for the
//    Simulator (Debug, so scripts can run JavaScript in its page) with one test-only addition: a native hook that
//    stores a session token (what the sign-in sheet does at its end), since a script can't drive iOS's sign-in
//    sheet. Cached in --work by ref.
// 2. This tree's build (or --new-app), the same way: the dev shell export, sync-web.mjs, xcodebuild.
// 3. A new test account on the development deployment (never production: the script refuses), through the dev
//    server's /api/auth and its development mailbox.
// 4. A Simulator of its own ("Folevi Upgrade Test", erased each run): the shipped app installed and signed in, three
//    notes made with the REST API and seen by the app, then the network cut for the page (its WebSockets fail), a
//    line typed into a note, probes written (localStorage, a cookie, an IndexedDB database), everything recorded.
// 5. The new build installed over it (same bundle id, data kept, as an App Store update does), launched online:
//    the same storage, the session, the notes, the probes, and the offline edit on the server.
// The result is printed and written to <work>/upgrade-result.json; the exit code is 0 only when every check passed.
// The Simulator is shut down at the end (deleted unless --keep-device).
//
// Needs: the dev server on FOLEVI_SERVICE_URL (default http://app.localhost:3002) against the development Convex
// deployment, apps/web/.env.local for that deployment, Xcode, pnpm.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const here = import.meta.dirname;
const ios = resolve(here, "..");
const repo = resolve(ios, "../..");
const BUNDLE = "com.folevi.ios";
const DEVICE_NAME = "Folevi Upgrade Test";
const PRODUCTION_DEPLOYMENT = "fastidious-clownfish-123";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const OLD_REF = value("--old-ref", "5b7fc87d");
const WORK = resolve(value("--work", join(tmpdir(), "folevi-upgrade-test")));
const SERVICE = new URL(process.env.FOLEVI_SERVICE_URL ?? "http://app.localhost:3002");
mkdirSync(WORK, { recursive: true });

const log = (...a) => console.log("[upgrade-test]", ...a);
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: opts.quiet ? "pipe" : "inherit", maxBuffer: 64 * 1024 * 1024, ...opts });
const simctl = (...a) => sh("xcrun", ["simctl", ...a], { quiet: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the development deployment only

const envLocal = join(repo, "apps/web/.env.local");
if (!existsSync(envLocal)) throw new Error("apps/web/.env.local is missing (the development deployment's settings).");
const env = Object.fromEntries(
  readFileSync(envLocal, "utf8")
    .split(/\r?\n/)
    .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim().replace(/^(['"])(.*)\1$/, "$2")]),
);
const CONVEX = env.NEXT_PUBLIC_CONVEX_URL;
const SITE = env.NEXT_PUBLIC_CONVEX_SITE_URL;
if (!CONVEX || !SITE) throw new Error(".env.local has no NEXT_PUBLIC_CONVEX_URL / NEXT_PUBLIC_CONVEX_SITE_URL.");
if (CONVEX.includes(PRODUCTION_DEPLOYMENT) || SITE.includes(PRODUCTION_DEPLOYMENT)) throw new Error("upgrade-test runs on the development deployment only, never production.");
if (!/(^|\.)localhost$/.test(SERVICE.hostname)) throw new Error(`upgrade-test signs in on a local dev server only (FOLEVI_SERVICE_URL is ${SERVICE.origin}).`);
log(`deployment ${new URL(CONVEX).host}, service ${SERVICE.origin}`);

// ---------------------------------------------------------------- builds

/** The DEBUG-only hook added to the old build: stores a session the way the sign-in sheet ends (ShellAuth). */
const SEED_HOOK = `        case "seedSession":
            // upgrade-test.mjs only (a script can't drive iOS's sign-in sheet): what the sheet's end stores.
            guard let token = input["token"] as? String, let u = await ShellAuth.shared.userOf(token) else { return ["error": "That session isn't valid."] }
            ShellAuth.shared.setToken(token, for: u.userId)
            guard let a = ShellPlaces.addAccount(userId: u.userId, name: u.name, email: u.email, avatarUrl: u.avatarUrl) else { return ["error": "No place for that account."] }
            ShellMode.current = "account"
            ShellPlaces.setCurrent(a.id)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { FoleviViewController.restart() }
            return ["userId": u.userId, "place": a.id]
`;

const shellEnv = { ...process.env, NEXT_PUBLIC_APP_URL: SERVICE.origin, FOLEVI_SERVICE_URL: SERVICE.origin };
delete shellEnv.FOLEVI_URL;
delete shellEnv.FOLEVI_SHELL_URL;

function xcodebuild(projectDir, derived) {
  sh("xcodebuild", ["-quiet", "-project", join(projectDir, "App.xcodeproj"), "-scheme", "App", "-configuration", "Debug", "-destination", "generic/platform=iOS Simulator", "-derivedDataPath", derived, "build"]);
  return join(derived, "Build/Products/Debug-iphonesimulator/App.app");
}

function buildOld() {
  const out = join(WORK, `old-${OLD_REF}.app`);
  if (existsSync(out) && !flag("--rebuild-old")) {
    log(`old build: cached ${out}`);
    return out;
  }
  const src = join(WORK, `old-${OLD_REF}-src`);
  log(`old build: ${OLD_REF} into ${src}`);
  rmSync(src, { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  sh("sh", ["-c", `git -C "${repo}" archive ${OLD_REF} | tar -x -C "${src}"`]);
  cpSync(envLocal, join(src, "apps/web/.env.local"));
  sh("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: src });
  sh("pnpm", ["install", "--ignore-workspace", "--frozen-lockfile", "--prefer-offline"], { cwd: join(src, "apps/ios") });
  sh("node", [join(src, "apps/web/scripts/build-shell.mjs"), "--platform", "ios"], { cwd: src, env: shellEnv });
  sh("node", [join(src, "apps/ios/scripts/bundle-cloud.mjs")], { cwd: join(src, "apps/ios") });
  const hooks = join(src, "apps/ios/ios/App/Native/DebugHooks.swift");
  const text = readFileSync(hooks, "utf8");
  const anchor = '        case "status":\n';
  if (!text.includes(anchor)) throw new Error("The old DebugHooks.swift has no status case to put the seed hook before.");
  writeFileSync(hooks, text.replace(anchor, SEED_HOOK + anchor));
  sh("npx", ["cap", "sync", "ios"], { cwd: join(src, "apps/ios"), env: shellEnv });
  const app = xcodebuild(join(src, "apps/ios/ios/App"), join(WORK, "dd-old"));
  rmSync(out, { recursive: true, force: true });
  cpSync(app, out, { recursive: true });
  return out;
}

function buildNew() {
  const given = value("--new-app");
  if (given) return resolve(given);
  log("new build: this tree");
  sh("node", [join(repo, "apps/web/scripts/build-shell.mjs"), "--platform", "ios"], { cwd: repo, env: shellEnv });
  sh("node", [join(here, "bundle-cloud.mjs")], { cwd: ios });
  sh("node", [join(here, "sync-web.mjs")], { cwd: ios, env: shellEnv });
  return xcodebuild(join(ios, "ios/App"), join(WORK, "dd-new"));
}

// ---------------------------------------------------------------- the test account (development deployment)

const PASSWORD = "quiet folio test password";
const json = async (res) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 400) };
  }
};

async function newAccount() {
  const email = `upgrade-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const headers = { "content-type": "application/json", origin: SERVICE.origin };
  let res = await fetch(new URL("/api/auth/sign-up/email", SERVICE), { method: "POST", headers, body: JSON.stringify({ email, password: PASSWORD, name: "Upgrade Test" }) });
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

async function convexJwt(token) {
  const res = await fetch(new URL("/api/auth/convex/token", SERVICE), { headers: { authorization: `Bearer ${token}`, origin: SERVICE.origin } });
  const jwt = (await json(res)).token;
  if (!jwt) throw new Error(`convex token: ${res.status}`);
  return jwt;
}

/** A personal access token for the REST API, once the app has set the account up (its profile). */
async function accessToken(session) {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${CONVEX}/api/mutation`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await convexJwt(session)}` },
      body: JSON.stringify({ path: "apiTokens:create", args: { name: "Upgrade test", scopes: ["notes:read", "notes:write"], personal: true, workspaceIds: [], expiresInDays: 30 }, format: "json" }),
    });
    const body = await json(res);
    const token = body.status === "success" ? JSON.stringify(body.value).match(/fvpat_[A-Za-z0-9_-]+/)?.[0] : null;
    if (token) return token;
    await sleep(1000);
  }
  throw new Error("No access token: the app never set the account up.");
}

const rest = async (pat, method, path, body) => {
  const res = await fetch(`${SITE}/api/v1/${path}`, { method, headers: { authorization: `Bearer ${pat}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const out = await json(res);
  if (!res.ok) throw new Error(`REST ${method} ${path}: ${res.status} ${JSON.stringify(out).slice(0, 300)}`);
  return out;
};

// ---------------------------------------------------------------- the Simulator

function device() {
  const { devices } = JSON.parse(simctl("list", "devices", "--json"));
  const all = Object.values(devices).flat();
  // At most one Simulator running: this test's own.
  const booted = all.filter((d) => d.state === "Booted" && d.name !== DEVICE_NAME);
  if (booted.length && !flag("--allow-other-simulators")) throw new Error(`Another Simulator is running (${booted.map((d) => d.name).join(", ")}): shut it down first.`);
  let found = all.find((d) => d.name === DEVICE_NAME && d.isAvailable);
  if (!found) {
    const runtime = JSON.parse(simctl("list", "runtimes", "--json")).runtimes.filter((r) => r.platform === "iOS" && r.isAvailable).at(-1);
    const type = runtime.supportedDeviceTypes.find((t) => /iPhone \d+ Pro$/.test(t.name)) ?? runtime.supportedDeviceTypes.find((t) => t.productFamily === "iPhone");
    const udid = simctl("create", DEVICE_NAME, type.identifier, runtime.identifier).trim();
    found = { udid, state: "Shutdown" };
  }
  if (found.state === "Booted") simctl("shutdown", found.udid);
  simctl("erase", found.udid);
  simctl("boot", found.udid);
  sh("xcrun", ["simctl", "bootstatus", found.udid, "-b"], { quiet: true });
  return found.udid;
}

const container = (udid) => join(simctl("get_app_container", udid, BUNDLE, "data").trim(), "tmp");

/** Runs JavaScript in the app's page (SimulatorEval in Debug builds): an async function body's value. */
async function evalJs(udid, script, timeout = 15000) {
  const tmp = container(udid);
  const out = join(tmp, "eval-result.json");
  rmSync(out, { force: true });
  writeFileSync(join(tmp, "eval.js"), script);
  simctl("spawn", udid, "notifyutil", "-p", "com.folevi.ios.eval");
  for (let t = 0; t < timeout; t += 100) {
    if (existsSync(out)) {
      await sleep(30);
      const r = JSON.parse(readFileSync(out, "utf8"));
      if (r.error) throw new Error(`page: ${r.error}`);
      return r.value;
    }
    await sleep(100);
  }
  throw new Error("The page didn't answer (is a Debug build open?).");
}

/** A native hook (DebugHooks in Debug builds). */
async function native(udid, input, timeout = 20000) {
  const tmp = container(udid);
  const out = join(tmp, "native-result.json");
  rmSync(out, { force: true });
  writeFileSync(join(tmp, "native.json"), JSON.stringify(input));
  simctl("spawn", udid, "notifyutil", "-p", "com.folevi.ios.native");
  for (let t = 0; t < timeout; t += 100) {
    if (existsSync(out)) {
      await sleep(30);
      return JSON.parse(readFileSync(out, "utf8"));
    }
    await sleep(100);
  }
  throw new Error("No native answer.");
}

/** Polls `script` (returning truthy when done) until it is, or fails after `timeout`. */
async function waitFor(udid, what, script, timeout = 60000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await evalJs(udid, script, 5000);
      if (last) return last;
    } catch (e) {
      last = String(e.message ?? e);
    }
    await sleep(700);
  }
  throw new Error(`Timed out waiting for ${what} (last: ${JSON.stringify(last)?.slice(0, 300)})`);
}

// What the page has stored: every IndexedDB database with its stores' record counts, localStorage, the probes, the
// account's sync state (pending edits, and whether the offline line is in it).
const SNAPSHOT = (nonce) => `
const out = { origin: location.origin, path: location.pathname, dbs: {}, local: {}, cookie: document.cookie };
for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out.local[k] = (localStorage.getItem(k) || "").length; }
out.probeLocal = localStorage.getItem("folevi-upgrade-probe");
const list = indexedDB.databases ? await indexedDB.databases() : [];
const open = (name) => new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onupgradeneeded = () => {}; });
const all = (db, store) => new Promise((res) => { const t = db.transaction(store, "readonly"); const s = t.objectStore(store); const k = s.getAllKeys(); const v = s.getAll(); t.oncomplete = () => res({ keys: k.result, values: v.result }); t.onerror = () => res({ keys: [], values: [] }); });
for (const d of list) {
  const db = await open(d.name);
  const info = { version: db.version, stores: {} };
  for (const store of Array.from(db.objectStoreNames)) {
    const { keys, values } = await all(db, store);
    info.stores[store] = keys.length;
    if (d.name.startsWith("folevi-") && d.name !== "folevi-upgrade-probe" && (store === "meta" || store === "syncState")) {
      const sync = info.sync || (info.sync = { pending: 0, inflight: 0, outbox: 0, hasEdit: false });
      keys.forEach((k, i) => {
        const v = values[i];
        // The edit queue: syncState's "account" record (older states kept it in meta's).
        if (k === "account" && v && Array.isArray(v.pending)) { sync.pending += v.pending.length; sync.inflight += (v.inflight || []).length; }
        if (store === "meta" && String(k).startsWith("outbox:")) sync.outbox++;
        if (JSON.stringify(v).includes(${JSON.stringify(nonce)})) sync.hasEdit = true;
      });
    }
    if (d.name === "folevi-upgrade-probe" && store === "probe") info.probe = values;
  }
  db.close();
  out.dbs[d.name] = info;
}
return out;`;

/** Presses onboarding's "Skip setup" when it's on screen (a step of a poll). */
const SKIP_ONBOARDING_STEP = "const btns = [...document.querySelectorAll('button')]; const skip = btns.find(b => (b.textContent || '').trim() === 'Skip setup') || btns.find(b => /^Open .Welcome to Folevi/.test((b.textContent || '').trim())); if (skip) { skip.click(); window.__upgradeSkipped = true; return false; }";
/** Done once onboarding has been skipped (its screen is gone) and the app shows its own pages. */
const SKIP_ONBOARDING = `${SKIP_ONBOARDING_STEP} return window.__upgradeSkipped === true && !/\\d of 6/.test(document.body.innerText);`;

// ---------------------------------------------------------------- the run

const result = { oldRef: OLD_REF, startedAt: new Date().toISOString(), checks: [], notes: [], remarks: [] };
const check = (name, ok, detail) => {
  result.checks.push({ name, ok: !!ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined ? `: ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 300)}` : ""}`);
};

let udid;
try {
  const oldApp = buildOld();
  const newApp = buildNew();
  const version = (app) => sh("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", "-c", "Print :CFBundleVersion", join(app, "Info.plist")], { quiet: true }).trim().replace("\n", " build ");
  result.oldVersion = version(oldApp);
  result.newVersion = version(newApp);
  log(`old ${result.oldVersion}, new ${result.newVersion}`);

  udid = device();
  result.device = udid;
  const nonce = `UPGRADE-EDIT-${Date.now().toString(36)}`;

  // ---- the shipped app, signed in
  simctl("install", udid, oldApp);
  simctl("launch", udid, BUNDLE);
  await waitFor(udid, "the old app's page", "return !!window.foleviShell && document.readyState === 'complete'");
  const account = await newAccount();
  result.account = account.email;
  log(`account ${account.email}`);
  const seeded = await native(udid, { command: "seedSession", token: account.token });
  if (seeded.error) throw new Error(`seed: ${seeded.error}`);
  await sleep(2500);
  await waitFor(udid, "the old app signed in", "return !!foleviShell.places && String(foleviShell.places.current || '').startsWith('acct:') && !document.body.innerText.includes('Where should your notes live')", 90000);

  // ---- notes, made on the server and seen by the app
  const pat = await accessToken(account.token);
  for (const n of ["A", "B", "C"]) {
    const made = await rest(pat, "POST", "notes", { title: `Upgrade note ${n}`, markdown: `Written before the upgrade (${n}).` });
    result.notes.push({ id: made.id, title: `Upgrade note ${n}` });
  }
  // Onboarding (it shows once the account is set up): skipped as a person would, then the notes list.
  await waitFor(udid, "the old app past onboarding", SKIP_ONBOARDING, 60000).catch((e) => log(`onboarding: ${e.message}`));
  await evalJs(udid, "//open folevi://documents").catch(() => null);
  await waitFor(udid, "the notes in the old app", `${SKIP_ONBOARDING_STEP} return ${JSON.stringify(result.notes.map((n) => n.title))}.every(t => document.body.innerText.includes(t))`, 90000);

  // ---- local settings and probes
  await evalJs(
    udid,
    `localStorage.setItem("folevi-upgrade-probe", ${JSON.stringify(nonce)});
     document.cookie = "folevi_upgrade_probe=${nonce}; path=/; max-age=31536000";
     await new Promise((res, rej) => { const r = indexedDB.open("folevi-upgrade-probe", 1); r.onupgradeneeded = () => r.result.createObjectStore("probe"); r.onsuccess = () => { const t = r.result.transaction("probe", "readwrite"); t.objectStore("probe").put(${JSON.stringify(nonce)}, "nonce"); t.oncomplete = () => { r.result.close(); res(); }; }; r.onerror = () => rej(r.error); });
     return true;`,
  );

  // ---- offline: the page's WebSockets fail from now on (the Convex connection with them), then a line is typed
  const target = result.notes[0];
  await evalJs(udid, `//open folevi://d/${target.id}`).catch(() => null);
  await waitFor(udid, "the note's editor", "const e = document.querySelector('.ProseMirror[contenteditable=true]'); return !!e && e.innerText.includes('Written before the upgrade')", 60000);
  await evalJs(
    udid,
    `class Offline extends EventTarget {
       constructor(url) { super(); this.url = String(url); this.readyState = 0; this.binaryType = "blob"; this.bufferedAmount = 0; this.protocol = ""; this.extensions = "";
         setTimeout(() => { this.readyState = 3; const e = new Event("error"); this.onerror && this.onerror(e); this.dispatchEvent(e); const c = new CloseEvent("close", { code: 1006, reason: "offline", wasClean: false }); this.onclose && this.onclose(c); this.dispatchEvent(c); }, 10); }
       send() {} close() {} }
     Offline.CONNECTING = 0; Offline.OPEN = 1; Offline.CLOSING = 2; Offline.CLOSED = 3;
     const send = WebSocket.prototype.send;
     WebSocket.prototype.send = function () { try { this.close(4000, "offline"); } catch (e) {} };
     window.WebSocket = Offline;
     window.__upgradeOffline = true;
     return true;`,
  );
  await sleep(1500);
  await evalJs(
    udid,
    `const e = document.querySelector('.ProseMirror[contenteditable=true]');
     e.focus();
     const sel = window.getSelection(); const range = document.createRange(); const last = e.lastElementChild || e; range.selectNodeContents(last); range.collapse(false); sel.removeAllRanges(); sel.addRange(range);
     document.execCommand("insertText", false, " ${nonce}");
     return e.innerText.includes(${JSON.stringify(nonce)});`,
  );
  await sleep(4000);
  const before = await evalJs(udid, SNAPSHOT(nonce), 30000);
  const beforeNative = await native(udid, { command: "status" });
  result.before = before;
  const acct = Object.entries(before.dbs).find(([n, d]) => n.startsWith("folevi-") && d.sync);
  check("old app: the offline edit is kept on the device, not sent", acct && acct[1].sync.hasEdit && acct[1].sync.pending + acct[1].sync.inflight > 0, acct?.[1].sync);
  const serverBefore = await rest(pat, "GET", `notes/${target.id}`);
  check("server: hasn't got the offline edit before the upgrade", !serverBefore.markdown.includes(nonce));

  // ---- the upgrade: the new build over the old one (data kept), launched online
  simctl("terminate", udid, BUNDLE);
  await sleep(1000);
  simctl("install", udid, newApp);
  simctl("launch", udid, BUNDLE);
  await waitFor(udid, "the new app's page", "return !!window.foleviShell && document.readyState === 'complete'", 60000);
  const host = await evalJs(udid, "return { origin: location.origin, ua: navigator.userAgent, capacitor: typeof window.Capacitor, transport: typeof (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.folevi) }");
  check("new app: page on the same origin (capacitor://localhost)", host.origin === "capacitor://localhost", host);
  check("new app: no Capacitor runtime in the page", host.capacitor === "undefined" && host.transport === "object", host);
  await waitFor(udid, "the new app signed in", "return String(foleviShell.places.current || '').startsWith('acct:') && !document.body.innerText.includes('Where should your notes live')", 60000);
  check("new app: still signed in to the same account", true);

  // The edit reaches the server (the outbox drains).
  let synced = false;
  for (let i = 0; i < 60 && !synced; i++) {
    synced = (await rest(pat, "GET", `notes/${target.id}`)).markdown.includes(nonce);
    if (!synced) await sleep(2000);
  }
  check("server: the offline edit arrived after the upgrade", synced);
  await sleep(2000);
  const after = await evalJs(udid, SNAPSHOT(nonce), 30000);
  const afterNative = await native(udid, { command: "status" });
  result.after = after;

  check("storage: every IndexedDB database is still there, same versions", Object.entries(before.dbs).every(([n, d]) => after.dbs[n] && after.dbs[n].version === d.version), { before: Object.keys(before.dbs), after: Object.keys(after.dbs) });
  check("storage: the IndexedDB probe kept its record", JSON.stringify(after.dbs["folevi-upgrade-probe"]?.probe) === JSON.stringify([nonce]));
  check("storage: localStorage kept every key", Object.keys(before.local).every((k) => k in after.local), { missing: Object.keys(before.local).filter((k) => !(k in after.local)) });
  check("storage: the localStorage probe", after.probeLocal === nonce);
  // WebKit keeps no document.cookie for a custom scheme like capacitor://: then there's nothing to carry over.
  if (before.cookie.includes(`folevi_upgrade_probe=${nonce}`)) check("storage: the cookie probe", after.cookie.includes(`folevi_upgrade_probe=${nonce}`), after.cookie);
  else result.remarks.push("cookie probe skipped: the shipped app's page can't keep cookies on capacitor:// (WebKit), so there are none to lose");
  const acctAfter = after.dbs[acct?.[0]];
  check("storage: the account's database kept its documents", acctAfter && (acctAfter.stores.documents ?? 0) >= (acct[1].stores.documents ?? 0), { before: acct?.[1].stores, after: acctAfter?.stores });
  check("sync: nothing left waiting after the upgrade", acctAfter && acctAfter.sync.pending + acctAfter.sync.inflight === 0 && acctAfter.sync.outbox === 0, acctAfter?.sync);
  check("native: same session, App Group and places", beforeNative.signedIn === afterNative.signedIn && JSON.stringify(beforeNative.places) === JSON.stringify(afterNative.places) && beforeNative.appGroup !== null && beforeNative.keychainGroup === afterNative.keychainGroup, { before: { signedIn: beforeNative.signedIn, places: beforeNative.places }, after: { signedIn: afterNative.signedIn, places: afterNative.places } });

  // The notes, in the upgraded app.
  await evalJs(udid, "//open folevi://documents").catch(() => null);
  const seen = await waitFor(udid, "the notes in the new app", `return ${JSON.stringify(result.notes.map((n) => n.title))}.every(t => document.body.innerText.includes(t))`, 60000).catch(() => false);
  check("new app: the notes are listed", seen);
  await evalJs(udid, `//open folevi://d/${target.id}`).catch(() => null);
  const opened = await waitFor(udid, "the edited note in the new app", `const e = document.querySelector('.ProseMirror'); return !!e && e.innerText.includes(${JSON.stringify(nonce)})`, 60000).catch(() => false);
  check("new app: the edited note shows the offline line", opened);
} catch (e) {
  check("run", false, String(e?.stack ?? e));
} finally {
  if (udid) {
    try {
      simctl("io", udid, "screenshot", join(WORK, "upgrade-final.png"));
    } catch {}
    try {
      simctl("shutdown", udid);
      if (!flag("--keep-device")) simctl("delete", udid);
    } catch {}
  }
  result.finishedAt = new Date().toISOString();
  result.passed = result.checks.length > 0 && result.checks.every((c) => c.ok);
  writeFileSync(join(WORK, "upgrade-result.json"), JSON.stringify(result, null, 2));
  log(`${result.passed ? "PASSED" : "FAILED"}: ${result.checks.filter((c) => c.ok).length}/${result.checks.length} checks (${join(WORK, "upgrade-result.json")})`);
  process.exit(result.passed ? 0 : 1);
}
