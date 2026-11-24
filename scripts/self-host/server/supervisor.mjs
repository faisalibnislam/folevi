#!/usr/bin/env node
// Folevi Server's supervisor (docs/SELF_HOSTING_PLAN.md §5.8, docs/self-hosting/SYNOLOGY.md). Plain Node, no
// dependencies. It runs from the server bundle (scripts/self-host/build-bundle.mjs) and:
//   - generates the server's secrets on first start and keeps them in the data folder
//   - starts Convex's backend program on loopback ports, with a short TMPDIR and the low-memory limits
//   - deploys Folevi's functions from the bundle's prebuilt push request when the bundle is new
//   - starts the web app (Next.js standalone) on a loopback port
//   - serves everything on one public port: the web app at /, Convex at /convex and /convex-site, its own
//     setup and diagnostics pages at /folevi-server/, and /.well-known/folevi.json
//   - makes a nightly backup (a Convex export with files) and keeps the newest 14
//   - writes logs into the data folder
//
// Environment (set by the launcher, bin/folevi-server):
//   FOLEVI_HOME   the bundle folder          FOLEVI_DATA  the data folder (a shared folder on a NAS)
//   FOLEVI_VAR    a short folder for temp files and the node wrapper (socket paths must stay short)
//   FOLEVI_PORT   the public port (8810)     FOLEVI_BIND  the address to listen on (0.0.0.0)
//   FOLEVI_RUNTIME  system | cxx | glibc: how to run the Linux programs (the launcher tests which works)
// Secrets are never printed or logged; diagnostics redact them.
import http from "node:http";
import net from "node:net";
import os from "node:os";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { setupPage, statusPage, diagnosticsPage, startingPage, keyPage } from "./pages.mjs";

const execFileP = promisify(execFile);
const HOME = path.resolve(process.env.FOLEVI_HOME ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const DATA = path.resolve(required("FOLEVI_DATA"));
const VAR = path.resolve(process.env.FOLEVI_VAR ?? path.join(DATA, ".var"));
const PORT = Number(process.env.FOLEVI_PORT ?? 8810);
const BIND = process.env.FOLEVI_BIND ?? "0.0.0.0";
const RUNTIME = process.env.FOLEVI_RUNTIME ?? "system";
const BACKEND_PORT = Number(process.env.FOLEVI_BACKEND_PORT ?? 38510);
const SITE_PORT = Number(process.env.FOLEVI_SITE_PORT ?? 38511);
const WEB_PORT = Number(process.env.FOLEVI_WEB_PORT ?? 38512);
const INSTANCE_NAME = "folevi-server";
const BUNDLE = readJson(path.join(HOME, "bundle.json"), { version: "dev", convexBackend: "unknown", node: process.version });
const ADMIN_KEY_PLACEHOLDER = "__FOLEVI_ADMIN_KEY__";
const BACKUPS_KEPT = 14;

const dirs = {
  secrets: path.join(DATA, "secrets"),
  convex: path.join(DATA, "convex"),
  storage: path.join(DATA, "convex", "storage"),
  backups: path.join(DATA, "backups"),
  logs: path.join(DATA, "logs"),
  tmp: path.join(VAR, "tmp"),
  bin: path.join(VAR, "bin"),
};

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is not set.`);
    process.exit(2);
  }
  return v;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonPrivate(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------------------------------
// Logs: one file per process in DATA/logs (5 MB, then .1), and the last errors for the diagnostics page.
// ---------------------------------------------------------------------------------------------------

const LOG_LIMIT = 5 * 1024 * 1024;
const recentErrors = [];
const recentLines = { supervisor: [], backend: [], web: [] };
const secretValues = new Set();

function redact(text) {
  let out = text;
  for (const s of secretValues) if (s && s.length >= 8) out = out.split(s).join("[redacted]");
  return out.replace(/(sig=)[0-9a-f]{16,}/gi, "$1[redacted]").replace(/(Convex |Bearer )[A-Za-z0-9|._-]{20,}/g, "$1[redacted]");
}

function logTo(name, text) {
  const file = path.join(dirs.logs, `${name}.log`);
  const stamp = new Date().toISOString();
  // eslint-disable-next-line no-control-regex
  const lines = redact(String(text).replace(/\x1b\[[0-9;]*m/g, "")).split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return;
  const block = lines.map((l) => `${stamp} ${l}`).join("\n") + "\n";
  try {
    const st = fs.statSync(file, { throwIfNoEntry: false });
    if (st && st.size > LOG_LIMIT) fs.renameSync(file, `${file}.1`);
    fs.appendFileSync(file, block);
  } catch {
    // The data folder may be missing while the NAS mounts it; keep going.
  }
  const ring = recentLines[name] ?? (recentLines[name] = []);
  for (const l of lines) {
    ring.push(`${stamp} ${l}`);
    if (ring.length > 60) ring.shift();
    if (/\b(error|panic|fatal|failed|refus|EADDRINUSE|ENOENT|EACCES|not found)\b/i.test(l) && !/\b(INFO|WARN|DEBUG)\b/.test(l) && !/bootstrapping and not yet available/.test(l)) {
      recentErrors.push(`${stamp} [${name}] ${l.slice(0, 500)}`);
      if (recentErrors.length > 50) recentErrors.shift();
    }
  }
}

const log = (msg) => {
  logTo("supervisor", msg);
  if (process.stdout.isTTY || process.env.FOLEVI_LOG_STDOUT === "1") console.log(redact(msg));
};

// ---------------------------------------------------------------------------------------------------
// Running the Linux programs: as they are, with our libstdc++ (cxx), or with our own glibc and loader (glibc).
// ---------------------------------------------------------------------------------------------------

const libDir = path.join(HOME, "lib", RUNTIME === "glibc" ? "glibc" : "cxx");
const loader = process.env.FOLEVI_LOADER ?? "";

/** [command, args, extra env] for running one of the bundle's programs under the chosen runtime. */
function program(binary, args) {
  if (RUNTIME === "glibc") return [loader, ["--library-path", libDir, binary, ...args], {}];
  if (RUNTIME === "cxx") return [binary, args, { LD_LIBRARY_PATH: libDir }];
  return [binary, args, {}];
}

const nodeBinary = process.env.FOLEVI_NODE ?? process.execPath;
const backendBinary = process.env.FOLEVI_BACKEND_BIN ?? path.join(HOME, "bin", "convex-local-backend");

/** A `node` on PATH for the backend's node actions (it runs `node local.cjs`) that uses the same runtime. */
function writeNodeWrapper() {
  fs.mkdirSync(dirs.bin, { recursive: true });
  const wrapper = path.join(dirs.bin, "node");
  const [cmd, args, env] = program(nodeBinary, []);
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const envPrefix = Object.entries(env).map(([k, v]) => `${k}=${q(v)} `).join("");
  fs.writeFileSync(wrapper, `#!/bin/sh\n${envPrefix ? `export ${envPrefix.trim()}\n` : ""}exec ${[cmd, ...args].map(q).join(" ")} "$@"\n`, { mode: 0o755 });
  return wrapper;
}

// ---------------------------------------------------------------------------------------------------
// Secrets and settings (DATA/secrets, mode 700)
// ---------------------------------------------------------------------------------------------------

const hex = (n) => crypto.randomBytes(n).toString("hex");

function loadSecrets() {
  fs.mkdirSync(dirs.secrets, { recursive: true, mode: 0o700 });
  fs.chmodSync(dirs.secrets, 0o700);
  const file = path.join(dirs.secrets, "secrets.json");
  const s = readJson(file, {});
  let changed = false;
  const ensure = (k, make) => {
    if (!s[k]) {
      s[k] = make();
      changed = true;
    }
  };
  ensure("instanceSecret", () => hex(32));
  ensure("betterAuthSecret", () => crypto.randomBytes(32).toString("base64"));
  ensure("hashSalt", () => hex(16));
  ensure("fileUrlSecret", () => hex(32));
  ensure("serverSecret", () => hex(32));
  // 12 characters people can read back: no 0/O or 1/I/L.
  ensure("setupKey", () => Array.from(crypto.randomBytes(12), (b) => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[b % 31]).join(""));
  if (changed) writeJsonPrivate(file, s);
  for (const v of Object.values(s)) if (typeof v === "string") secretValues.add(v);
  return s;
}

async function adminKey(secrets) {
  const file = path.join(dirs.secrets, "admin_key");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const [cmd, args, env] = program(backendBinary, ["keygen", "admin-key", "--instance-name", INSTANCE_NAME, "--instance-secret", secrets.instanceSecret]);
  const { stdout } = await execFileP(cmd, args, { env: { ...process.env, ...env }, maxBuffer: 1 << 20 });
  const key = stdout.trim().split(/\s+/).pop();
  if (!key || !key.includes("|")) throw new Error("the backend didn't print an admin key");
  fs.writeFileSync(file, `${key}\n`, { mode: 0o600 });
  return key;
}

const settingsFile = () => path.join(dirs.secrets, "settings.json");
function loadSettings() {
  return { name: "Folevi Server", address: "", extraAddresses: [], aiKey: "", setupDone: false, ...readJson(settingsFile(), {}) };
}
function saveSettings(s) {
  writeJsonPrivate(settingsFile(), s);
  if (s.aiKey) secretValues.add(s.aiKey);
}

const stateFile = () => path.join(DATA, "state.json");
const loadState = () => readJson(stateFile(), {});
const saveState = (patch) => writeJsonPrivate(stateFile(), { ...loadState(), ...patch });

/** The server's likely LAN address, for the address field before the owner confirms one. */
function guessAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) return `http://${a.address}:${PORT}`;
    }
  }
  return `http://localhost:${PORT}`;
}

const normalizeOrigin = (url) => {
  try {
    const u = new URL(String(url).trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.origin;
  } catch {
    return "";
  }
};

// ---------------------------------------------------------------------------------------------------
// Child processes, restarted with backoff
// ---------------------------------------------------------------------------------------------------

const children = new Map();
let stopping = false;
const groupsFile = () => path.join(VAR, "children.json");

/** Remembers each child's process group, so a later start can clean up after a crash (orphans hold the ports). */
function rememberGroups() {
  const groups = [...children.values()].filter((c) => c.proc?.pid).map((c) => ({ name: c.name, pgid: c.proc.pid }));
  try {
    fs.writeFileSync(groupsFile(), JSON.stringify(groups));
  } catch {
    // best effort
  }
}

/** The command lines of a process group's members (from /proc on Linux, ps elsewhere). */
async function groupCommands(pgid) {
  if (fs.existsSync("/proc/self/stat")) {
    const out = [];
    for (const pid of fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
      const stat = readText(`/proc/${pid}/stat`);
      // Fields after the command name (which may contain spaces): state, ppid, pgrp, ...
      const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (Number(rest[2]) !== pgid) continue;
      // The program file too: Next.js renames its process ("next-server (v16…)"), but /proc/<pid>/exe stays.
      let exe = "";
      try {
        exe = fs.readlinkSync(`/proc/${pid}/exe`);
      } catch {
        // not ours to read
      }
      out.push(`${exe} ${readText(`/proc/${pid}/cmdline`).replace(/\0/g, " ")}`);
    }
    return out;
  }
  const ps = await run("ps", ["-A", "-o", "pgid=,command="]);
  return ps.split("\n").map((l) => l.trim().match(/^(\d+)\s+(.*)$/)).filter((m) => m && Number(m[1]) === pgid).map((m) => m[2]);
}

/** Ends what a previous run left behind: its children's process groups, if every member is one of ours. */
async function endLeftovers() {
  const groups = readJson(groupsFile(), []);
  for (const { name, pgid } of groups) {
    const cmds = await groupCommands(pgid);
    const ours = (c) => c.includes(HOME) || c.includes(VAR) || (name === "web" && /^next-server \(v/.test(c));
    if (!cmds.length || !cmds.every(ours)) continue;
    log(`ending ${name} left over from the last run (process group ${pgid}, ${cmds.length} processes)`);
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  fs.rmSync(groupsFile(), { force: true });
  await new Promise((r) => setTimeout(r, 500));
}

/** Whether something already answers on a loopback port (another program, or a process we couldn't end). */
function portBusy(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => resolve(false));
  });
}

function supervise(name, makeSpawn, { onExit } = {}) {
  let delay = 1000;
  const entry = { name, proc: null, startedAt: 0, restarts: 0, lastExit: null, status: "starting" };
  children.set(name, entry);
  const start = () => {
    if (stopping) return;
    const [cmd, args, opts] = makeSpawn();
    entry.status = "running";
    entry.startedAt = Date.now();
    // Its own process group, so stopping it also stops what it started (the backend's node helper).
    const proc = spawn(cmd, args, { ...opts, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    entry.proc = proc;
    rememberGroups();
    proc.stdout.on("data", (d) => logTo(name, d));
    proc.stderr.on("data", (d) => logTo(name, d));
    proc.on("error", (e) => logTo(name, `could not start: ${e.message}`));
    proc.on("exit", (code, signal) => {
      entry.lastPid = proc.pid;
      // Whatever it left in its group (the backend's node helper) goes with it.
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {
        // nothing left
      }
      entry.proc = null;
      entry.lastExit = { code, signal, at: new Date().toISOString() };
      if (stopping) return void (entry.status = "stopped");
      entry.status = "restarting";
      entry.restarts++;
      log(`${name} exited (code ${code}, signal ${signal}); restarting in ${Math.round(delay / 1000)} s`);
      onExit?.();
      if (Date.now() - entry.startedAt > 60_000) delay = 1000;
      setTimeout(start, delay);
      delay = Math.min(delay * 2, 60_000);
    });
  };
  start();
  return entry;
}

function stopChild(name, signal = "SIGTERM") {
  const c = children.get(name);
  if (!c?.proc) return;
  try {
    process.kill(-c.proc.pid, signal);
  } catch {
    c.proc.kill(signal);
  }
}

// ---------------------------------------------------------------------------------------------------
// The backend
// ---------------------------------------------------------------------------------------------------

const backendUrl = `http://127.0.0.1:${BACKEND_PORT}`;
const siteUrl = `http://127.0.0.1:${SITE_PORT}`;

function startBackend(secrets) {
  fs.mkdirSync(dirs.storage, { recursive: true });
  fs.mkdirSync(dirs.tmp, { recursive: true });
  if (dirs.tmp.length > 80) log(`warning: the temp folder path is ${dirs.tmp.length} characters; node actions need it short`);
  return supervise("backend", () => {
    const [cmd, args, env] = program(backendBinary, [
      path.join(dirs.convex, "convex.sqlite3"),
      "--db", "sqlite",
      "--interface", "127.0.0.1",
      "--port", String(BACKEND_PORT),
      "--site-proxy-port", String(SITE_PORT),
      // Loopback addresses: the backend never needs to reach the address people use (docs/self-hosting/PHASE0.md).
      "--convex-origin", backendUrl,
      "--convex-site", siteUrl,
      "--instance-name", INSTANCE_NAME,
      "--instance-secret", secrets.instanceSecret,
      "--local-storage", dirs.storage,
      "--disable-beacon",
      "--redact-logs-to-client",
    ]);
    return [cmd, args, {
      cwd: dirs.convex,
      env: {
        ...process.env,
        ...env,
        TMPDIR: dirs.tmp,
        PATH: `${dirs.bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        DISABLE_BEACON: "1",
        // Phase 0's low-memory limits: peak about 570 MB, idle about 260 MB for one person.
        APPLICATION_MAX_CONCURRENT_QUERIES: "4",
        APPLICATION_MAX_CONCURRENT_MUTATIONS: "4",
        APPLICATION_MAX_CONCURRENT_V8_ACTIONS: "4",
        APPLICATION_MAX_CONCURRENT_NODE_ACTIONS: "2",
        ISOLATE_IDLE_TIMEOUT_SECONDS: "30",
        RUST_LOG: process.env.RUST_LOG ?? "info",
      },
    }];
  });
}

async function waitFor(url, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function adminFetch(key, pathname, init = {}) {
  return fetch(`${backendUrl}${pathname}`, {
    ...init,
    headers: { Authorization: `Convex ${key}`, "Content-Type": "application/json", "Convex-Client": "folevi-server-1.0.0", ...(init.headers ?? {}) },
  });
}

async function expectOk(res, what) {
  const text = await res.text();
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${redact(text).slice(0, 600)}`);
  return text ? JSON.parse(text) : null;
}

/** The backend's environment: everything Folevi reads, from the secrets and the owner's settings. */
function backendEnv(secrets, settings) {
  const address = settings.address || guessAddress();
  const extras = (settings.extraAddresses ?? []).map(normalizeOrigin).filter((o) => o && o !== address);
  return {
    FOLEVI_ENV: "production",
    FOLEVI_EDITION: "server",
    SITE_URL: address,
    FOLEVI_APP_URL: address,
    FOLEVI_PUBLIC_SITE_URL: `${address}/convex-site`,
    // Upload addresses stay on the page's own origin (convex/lib/fileUrls.ts publicUploadUrl).
    FOLEVI_PUBLIC_CONVEX_URL: "/convex",
    FOLEVI_TRUSTED_ORIGINS: extras.join(","),
    FOLEVI_REQUIRE_VERIFIED_EMAIL: "false",
    BETTER_AUTH_SECRET: secrets.betterAuthSecret,
    FOLEVI_HASH_SALT: secrets.hashSalt,
    FOLEVI_FILE_URL_SECRET: secrets.fileUrlSecret,
    FOLEVI_SERVER_SECRET: secrets.serverSecret,
    GEMINI_API_KEY: settings.aiKey || null,
  };
}

async function applyBackendEnv(key, secrets, settings) {
  const env = backendEnv(secrets, settings);
  const changes = Object.entries(env).map(([name, value]) => ({ name, value: value === "" ? null : value }));
  await expectOk(await adminFetch(key, "/api/update_environment_variables", { method: "POST", body: JSON.stringify({ changes }) }), "setting the backend's environment");
  log(`backend environment set (address ${env.SITE_URL}, Foli AI ${env.GEMINI_API_KEY ? "on" : "off"})`);
}

/**
 * Deploys Folevi's functions from the bundle's push request (made by `convex deploy --write-push-request` when
 * the bundle was built), the way the Convex CLI does: start_push, wait_for_schema, finish_push.
 */
async function pushFunctions(key) {
  const file = path.join(HOME, "functions", "push-request.json.br");
  const json = zlib.brotliDecompressSync(fs.readFileSync(file)).toString("utf8");
  if (!json.includes(ADMIN_KEY_PLACEHOLDER)) throw new Error("the bundle's push request has no admin key placeholder");
  const body = zlib.brotliCompressSync(Buffer.from(json.split(ADMIN_KEY_PLACEHOLDER).join(key)), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } });
  const t0 = Date.now();
  log("deploying Folevi's functions");
  const start = await expectOk(
    await adminFetch(key, "/api/deploy2/start_push", { method: "POST", body, headers: { "Content-Encoding": "br" }, signal: AbortSignal.timeout(20 * 60_000) }),
    "start_push",
  );
  for (;;) {
    const status = await expectOk(
      await adminFetch(key, "/api/deploy2/wait_for_schema", { method: "POST", body: JSON.stringify({ adminKey: key, schemaChange: start.schemaChange, timeoutMs: 10_000, dryRun: false }) }),
      "wait_for_schema",
    );
    if (status.type === "complete") break;
    if (status.type === "failed") throw new Error(`schema check failed${status.componentPath ? ` in ${status.componentPath}` : ""}: ${status.error}`);
    if (status.type === "raceDetected") throw new Error("another deploy overwrote the schema");
  }
  const finishBody = zlib.brotliCompressSync(Buffer.from(JSON.stringify({ adminKey: key, startPush: start, dryRun: false })), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } });
  await expectOk(await adminFetch(key, "/api/deploy2/finish_push", { method: "POST", body: finishBody, headers: { "Content-Encoding": "br" } }), "finish_push");
  log(`deployed Folevi's functions in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// ---------------------------------------------------------------------------------------------------
// The web app
// ---------------------------------------------------------------------------------------------------

function startWeb(secrets, nodeWrapper) {
  const dir = path.join(HOME, "web", "apps", "web");
  return supervise("web", () => [nodeWrapper, ["server.js"], {
    cwd: dir,
    env: {
      ...process.env,
      PORT: String(WEB_PORT),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_OPTIONS: "--max-old-space-size=384",
      FOLEVI_INTERNAL_CONVEX_URL: backendUrl,
      FOLEVI_INTERNAL_CONVEX_SITE_URL: siteUrl,
      FOLEVI_SERVER_SECRET: secrets.serverSecret,
    },
  }]);
}

// ---------------------------------------------------------------------------------------------------
// Backups: a Convex export with files, nightly, newest 14 kept in DATA/backups
// ---------------------------------------------------------------------------------------------------

const backupState = { running: false, last: null, lastError: null };

async function systemQuery(key, name) {
  const res = await expectOk(await adminFetch(key, "/api/query", { method: "POST", body: JSON.stringify({ path: name, args: {}, format: "json" }) }), name);
  if (res?.status !== "success") throw new Error(`${name}: ${res?.errorMessage ?? "failed"}`);
  return res.value;
}

async function backupNow(key) {
  if (backupState.running) return;
  backupState.running = true;
  const t0 = Date.now();
  try {
    fs.mkdirSync(dirs.backups, { recursive: true });
    const req = await adminFetch(key, "/api/export/request/zip?includeStorage=true", { method: "POST" });
    if (!req.ok) {
      const text = await req.text();
      if (!/ExportInProgress/.test(text)) throw new Error(`export request: HTTP ${req.status} ${text.slice(0, 300)}`);
    }
    let st;
    for (let i = 0; i < 60 * 60; i++) {
      st = await systemQuery(key, "_system/cli/exports:getLatest");
      if (st?.state === "completed" || st?.state === "failed") break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (st?.state !== "completed") throw new Error(`export ${st?.state ?? "timed out"}`);
    const name = `folevi-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.zip`;
    const out = path.join(dirs.backups, name);
    const res = await adminFetch(key, `/api/export/zip/${st.start_ts}`, { method: "GET" });
    if (!res.ok || !res.body) throw new Error(`export download: HTTP ${res.status}`);
    await pipeline(res.body, fs.createWriteStream(`${out}.part`));
    fs.renameSync(`${out}.part`, out);
    const all = fs.readdirSync(dirs.backups).filter((f) => /^folevi-backup-.*\.zip$/.test(f)).sort();
    for (const old of all.slice(0, Math.max(0, all.length - BACKUPS_KEPT))) fs.rmSync(path.join(dirs.backups, old), { force: true });
    const size = fs.statSync(out).size;
    backupState.last = { file: name, at: new Date().toISOString(), bytes: size, seconds: Math.round((Date.now() - t0) / 1000) };
    backupState.lastError = null;
    saveState({ lastBackup: backupState.last });
    log(`backup written: ${name} (${(size / 1e6).toFixed(1)} MB)`);
  } catch (e) {
    backupState.lastError = { at: new Date().toISOString(), message: redact(String(e.message ?? e)) };
    log(`backup failed: ${e.message ?? e}`);
  } finally {
    backupState.running = false;
  }
}

/** Nightly at 03:30 local time. */
function scheduleBackups(key) {
  const next = () => {
    const now = new Date();
    const at = new Date(now);
    at.setHours(3, 30, 0, 0);
    if (at <= now) at.setDate(at.getDate() + 1);
    return at.getTime() - now.getTime();
  };
  const arm = () => setTimeout(async () => {
    await backupNow(key);
    arm();
  }, next());
  arm();
}

// ---------------------------------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------------------------------

async function run(cmd, args) {
  try {
    const { stdout, stderr } = await execFileP(cmd, args, { timeout: 5000, maxBuffer: 1 << 20 });
    return (stdout || stderr).trim();
  } catch (e) {
    return `(${redact(String(e.stderr || e.message || e).trim().split("\n")[0])})`;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function rssOf(pid) {
  if (!pid) return null;
  const status = readText(`/proc/${pid}/status`);
  const m = status.match(/VmRSS:\s+(\d+) kB/);
  if (m) return Number(m[1]) * 1024;
  return null;
}

async function psRss(pid) {
  const fromProc = rssOf(pid);
  if (fromProc !== null || !pid) return fromProc;
  const out = await run("ps", ["-o", "rss=", "-p", String(pid)]);
  const kb = Number(out.trim());
  return Number.isFinite(kb) && kb > 0 ? kb * 1024 : null;
}

async function diagnostics() {
  const dsm = readText("/etc.defaults/VERSION");
  const dsmField = (k) => dsm.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1] ?? "";
  const synoinfo = readText("/etc/synoinfo.conf");
  const model = synoinfo.match(/^upnpmodelname="?([^"\n]*)"?/m)?.[1] || readText("/proc/sys/kernel/syno_hw_version").trim();
  const report = process.report?.getReport?.() ?? {};
  let disk = null;
  try {
    const s = await fsp.statfs(DATA);
    disk = { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  } catch {
    // statfs isn't everywhere
  }
  const settings = loadSettings();
  const state = loadState();
  const procs = {};
  for (const [name, c] of children) {
    procs[name] = { status: c.status, pid: c.proc?.pid ?? null, rssBytes: await psRss(c.proc?.pid), restarts: c.restarts, lastExit: c.lastExit, upSeconds: c.proc ? Math.round((Date.now() - c.startedAt) / 1000) : 0 };
  }
  let backendVersion = "";
  try {
    backendVersion = (await (await fetch(`${backendUrl}/version`, { signal: AbortSignal.timeout(2000) })).text()).trim();
  } catch {
    backendVersion = "(not answering)";
  }
  return {
    generatedAt: new Date().toISOString(),
    server: { name: settings.name, version: BUNDLE.version, builtAt: BUNDLE.builtAt, commit: BUNDLE.commit, address: settings.address || `(not set; guess ${guessAddress()})`, extraAddresses: settings.extraAddresses, setupDone: settings.setupDone, foliAi: Boolean(settings.aiKey), email: "not set up (sign-up skips email confirmation)" },
    phase: boot.phase,
    phaseError: boot.error,
    deploy: { deployedVersion: state.deployedVersion ?? null, deployedAt: state.deployedAt ?? null },
    backup: { running: backupState.running, last: backupState.last ?? state.lastBackup ?? null, lastError: backupState.lastError, folder: dirs.backups },
    system: {
      nas: model ? `${model}` : "(not a Synology, or not readable)",
      dsm: dsm ? `${dsmField("productversion")} build ${dsmField("buildnumber")} update ${dsmField("smallfixnumber")}` : "(not DSM)",
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      cpus: os.cpus().length,
      memory: { totalBytes: os.totalmem(), freeBytes: os.freemem(), loadavg: os.loadavg().map((n) => n.toFixed(2)) },
      ldd: (await run("ldd", ["--version"])).split("\n")[0],
      glibcRuntime: report.header?.glibcVersionRuntime ?? null,
      runtimeMode: RUNTIME,
      node: process.version,
      convexBackend: `${BUNDLE.convexBackend} (${backendVersion})`,
      dataFolder: DATA,
      disk,
      varFolder: VAR,
      user: `${os.userInfo().username} (uid ${process.getuid?.() ?? "?"})`,
    },
    processes: { supervisor: { pid: process.pid, rssBytes: process.memoryUsage().rss }, ...procs },
    recentErrors: recentErrors.slice(-25),
    logs: Object.fromEntries(Object.entries(recentLines).map(([k, v]) => [k, v.slice(-30)])),
  };
}

// ---------------------------------------------------------------------------------------------------
// The one public port: the web app, Convex, and the server's own pages
// ---------------------------------------------------------------------------------------------------

const boot = { phase: "starting", error: null, key: null, secrets: null };
const ADMIN_COOKIE = "folevi_server_admin";
const adminToken = () => crypto.createHmac("sha256", boot.secrets.setupKey).update("folevi-server-admin").digest("hex");

function cookies(req) {
  return Object.fromEntries((req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=")).filter((p) => p.length >= 2).map(([k, ...v]) => [k, v.join("=")]));
}

/** The owner: before setup is done anyone on the network; afterwards a browser that set it up or knows the setup key. */
function isAdmin(req) {
  if (!loadSettings().setupDone) return true;
  const got = cookies(req)[ADMIN_COOKIE] ?? "";
  const want = adminToken();
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

function adminCookie(req) {
  const secure = (req.headers["x-forwarded-proto"] ?? "").startsWith("https") ? "; Secure" : "";
  return `${ADMIN_COOKIE}=${adminToken()}; Path=/folevi-server; HttpOnly; SameSite=Strict; Max-Age=31536000${secure}`;
}

function originOf(req) {
  const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? `localhost:${PORT}`).split(",")[0].trim();
  return `${proto}://${host}`;
}

function send(res, status, body, type = "text/html; charset=utf-8", extra = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Frame-Options": "SAMEORIGIN", "X-Content-Type-Options": "nosniff", ...extra });
  res.end(body);
}

const json = (res, status, value, extra) => send(res, status, JSON.stringify(value, null, 2), "application/json", extra);

async function readBody(req, limit = 64 * 1024) {
  let size = 0;
  const parts = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("too large");
    parts.push(chunk);
  }
  const text = Buffer.concat(parts).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function wellKnown(req) {
  const settings = loadSettings();
  const origin = originOf(req);
  return {
    name: settings.name,
    edition: "server",
    version: BUNDLE.version,
    convexUrl: `${origin}/convex`,
    convexSiteUrl: `${origin}/convex-site`,
    signIn: { emailPassword: true, emailVerification: false, google: false, apple: false, passkeys: true },
    features: { ai: Boolean(settings.aiKey), email: false, billing: false, push: false },
    minAppVersion: null,
    ready: boot.phase === "ready",
  };
}

/** Same-origin check for the server's own POST endpoints (a page elsewhere can't change settings). */
function sameOrigin(req) {
  const o = req.headers.origin;
  return !o || o === originOf(req);
}

async function serverPages(req, res, url) {
  const p = url.pathname.replace(/\/+$/, "") || "/folevi-server";
  const settings = loadSettings();
  if (req.method === "GET" && (p === "/folevi-server" || p === "/folevi-server/setup")) {
    if (!settings.setupDone) return send(res, 200, setupPage({ settings, suggested: originOf(req), guess: guessAddress(), phase: boot.phase, error: boot.error }));
    if (!isAdmin(req)) return send(res, 200, keyPage({ name: settings.name }));
    return send(res, 200, statusPage({ settings, phase: boot.phase, version: BUNDLE.version, backup: backupState.last ?? loadState().lastBackup ?? null }));
  }
  if (req.method === "GET" && p === "/folevi-server/diagnostics") {
    if (!isAdmin(req)) return send(res, 200, keyPage({ name: settings.name, next: "/folevi-server/diagnostics" }));
    return send(res, 200, diagnosticsPage(await diagnostics()));
  }
  if (req.method === "GET" && p === "/folevi-server/api/diagnostics") {
    if (!isAdmin(req)) return json(res, 403, { error: "Enter the setup key first." });
    return json(res, 200, await diagnostics());
  }
  if (req.method === "GET" && p === "/folevi-server/api/status") return json(res, 200, { phase: boot.phase, error: boot.error, setupDone: settings.setupDone });
  if (req.method === "POST" && sameOrigin(req)) {
    if (p === "/folevi-server/api/unlock") {
      const body = await readBody(req);
      const ok = typeof body.key === "string" && body.key.trim().toUpperCase() === boot.secrets.setupKey;
      return ok ? json(res, 200, { ok: true }, { "Set-Cookie": adminCookie(req) }) : json(res, 403, { error: "That isn't the setup key." });
    }
    if (!isAdmin(req)) return json(res, 403, { error: "Enter the setup key first." });
    if (p === "/folevi-server/api/settings") {
      const body = await readBody(req);
      const address = normalizeOrigin(body.address ?? "");
      if (!address) return json(res, 400, { error: "Type the address you open this page with, starting with http:// or https://." });
      const name = String(body.name ?? "").trim().slice(0, 60) || "Folevi Server";
      const extraAddresses = String(body.extraAddresses ?? "").split(/[\s,]+/).map(normalizeOrigin).filter(Boolean).slice(0, 10);
      const next = { ...settings, name, address, extraAddresses, setupDone: true };
      if (typeof body.aiKey === "string" && body.aiKey.trim() !== "••••••••") next.aiKey = body.aiKey.trim();
      const first = !settings.setupDone;
      saveSettings(next);
      if (boot.key) {
        try {
          await applyBackendEnv(boot.key, boot.secrets, next);
        } catch (e) {
          return json(res, 500, { error: `Saved, but the backend didn't take the new settings: ${redact(String(e.message ?? e))}` });
        }
      }
      return json(res, 200, { ok: true, setupKey: first ? boot.secrets.setupKey : undefined }, { "Set-Cookie": adminCookie(req) });
    }
    if (p === "/folevi-server/api/backup") {
      if (!boot.key) return json(res, 409, { error: "The server is still starting." });
      void backupNow(boot.key);
      return json(res, 202, { ok: true });
    }
    if (p === "/folevi-server/api/redeploy") {
      if (!boot.key) return json(res, 409, { error: "The server is still starting." });
      try {
        await pushFunctions(boot.key);
        saveState({ deployedVersion: BUNDLE.version, deployedAt: new Date().toISOString() });
        return json(res, 200, { ok: true });
      } catch (e) {
        return json(res, 500, { error: redact(String(e.message ?? e)) });
      }
    }
  }
  return send(res, 404, "Not found", "text/plain");
}

const routes = [
  { prefix: "/convex-site", port: SITE_PORT },
  { prefix: "/convex", port: BACKEND_PORT },
];

function route(urlPath) {
  for (const r of routes) {
    if (urlPath === r.prefix || urlPath.startsWith(`${r.prefix}/`) || urlPath.startsWith(`${r.prefix}?`)) {
      const rest = urlPath.slice(r.prefix.length);
      return { port: r.port, path: rest.startsWith("/") ? rest : `/${rest}` };
    }
  }
  return { port: WEB_PORT, path: urlPath };
}

function forwardedHeaders(req) {
  const headers = { ...req.headers };
  const ip = req.socket.remoteAddress ?? "";
  headers["x-forwarded-for"] = headers["x-forwarded-for"] ? `${headers["x-forwarded-for"]}, ${ip}` : ip;
  headers["x-real-ip"] = headers["x-real-ip"] ?? ip;
  headers["x-forwarded-host"] = headers["x-forwarded-host"] ?? req.headers.host ?? "";
  headers["x-forwarded-proto"] = headers["x-forwarded-proto"] ?? "http";
  return headers;
}

// Paths that start the product: before setup they go to the setup page instead.
const PRODUCT_ENTRY = /^\/(?:$|documents|signin|signup|onboarding)(?:\/|$|\?)/;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  try {
    if (url.pathname === "/.well-known/folevi.json") return json(res, 200, wellKnown(req), { "Access-Control-Allow-Origin": "*" });
    if (url.pathname === "/folevi-server" || url.pathname.startsWith("/folevi-server/")) return await serverPages(req, res, url);
    const settings = loadSettings();
    if (!settings.setupDone && req.method === "GET" && PRODUCT_ENTRY.test(url.pathname)) return send(res, 302, "", "text/plain", { Location: "/folevi-server/" });
    if (boot.phase !== "ready" && req.method === "GET" && !url.pathname.startsWith("/convex") && !url.pathname.startsWith("/_next/")) {
      return send(res, 503, startingPage({ phase: boot.phase, error: boot.error }), "text/html; charset=utf-8", { "Retry-After": "5" });
    }
  } catch (e) {
    return send(res, 500, `Folevi Server: ${redact(String(e.message ?? e))}`, "text/plain");
  }
  const { port, path: target } = route(req.url ?? "/");
  const upstream = http.request({ hostname: "127.0.0.1", port, method: req.method, path: target, headers: forwardedHeaders(req) }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on("error", (e) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(`Folevi Server: ${port === WEB_PORT ? "the web app" : "the backend"} isn't answering yet (${e.code ?? e.message}). It may still be starting.`);
  });
  req.pipe(upstream);
});

// WebSockets (the Convex sync protocol): replay the upgrade request to the backend, then splice the sockets.
server.on("upgrade", (req, socket, head) => {
  const { port, path: target } = route(req.url ?? "/");
  const up = net.connect(port, "127.0.0.1", () => {
    const headers = forwardedHeaders(req);
    const lines = [`${req.method} ${target} HTTP/1.1`, ...Object.entries(headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : [`${k}: ${v}`]))];
    up.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head?.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  const close = () => {
    socket.destroy();
    up.destroy();
  };
  up.on("error", close);
  socket.on("error", close);
});

// ---------------------------------------------------------------------------------------------------
// Start and stop
// ---------------------------------------------------------------------------------------------------

async function main() {
  for (const d of [dirs.logs, dirs.backups, dirs.convex, dirs.tmp, dirs.bin]) fs.mkdirSync(d, { recursive: true });
  log(`Folevi Server ${BUNDLE.version} starting (runtime ${RUNTIME}, data ${DATA}, port ${PORT})`);
  boot.secrets = loadSecrets();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, BIND, resolve);
  });
  log(`listening on ${BIND}:${PORT}`);
  try {
    const nodeWrapper = writeNodeWrapper();
    boot.phase = "starting the database";
    const key = await adminKey(boot.secrets);
    secretValues.add(key);
    await endLeftovers();
    for (const port of [BACKEND_PORT, SITE_PORT, WEB_PORT]) {
      if (await portBusy(port)) throw new Error(`another program is using port ${port} on this NAS, which Folevi Server needs`);
    }
    startBackend(boot.secrets);
    if (!(await waitFor(`${backendUrl}/version`, 120_000))) throw new Error("the backend didn't start within 2 minutes (see the backend log)");
    boot.key = key;
    boot.phase = "setting up";
    await applyBackendEnv(key, boot.secrets, loadSettings());
    const state = loadState();
    if (state.deployedVersion !== BUNDLE.version || process.env.FOLEVI_FORCE_DEPLOY === "1") {
      boot.phase = "installing Folevi (first start or update; this can take a few minutes)";
      await pushFunctions(key);
      saveState({ deployedVersion: BUNDLE.version, deployedAt: new Date().toISOString() });
    }
    boot.phase = "starting the web app";
    startWeb(boot.secrets, nodeWrapper);
    if (!(await waitFor(`http://127.0.0.1:${WEB_PORT}/signin`, 180_000))) {
      throw new Error("the web app didn't start within 2 minutes (see the web log)");
    }
    boot.phase = "ready";
    boot.error = null;
    log("ready");
    scheduleBackups(key);
  } catch (e) {
    boot.phase = "failed";
    boot.error = redact(String(e.message ?? e));
    log(`start failed: ${e.stack ?? e}`);
  }
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log(`stopping (${signal})`);
  for (const name of children.keys()) stopChild(name, "SIGTERM");
  server.close();
  const deadline = Date.now() + 15_000;
  const check = setInterval(() => {
    const alive = [...children.values()].filter((c) => c.proc);
    if (!alive.length || Date.now() > deadline) {
      for (const c of alive) stopChild(c.name, "SIGKILL");
      // The groups' other members (helpers that outlive their parent) go too.
      for (const c of children.values()) if (c.lastPid) try { process.kill(-c.lastPid, "SIGKILL"); } catch { /* gone */ }
      clearInterval(check);
      log("stopped");
      process.exit(0);
    }
  }, 250);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (e) => log(`uncaught: ${e.stack ?? e}`));
process.on("unhandledRejection", (e) => log(`unhandled: ${e?.stack ?? e}`));

void main();
