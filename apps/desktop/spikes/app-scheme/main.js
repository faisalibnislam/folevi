// SPIKE S2 (docs/LOCAL_MODE.md): the bundled web app (apps/web/out-shell, built with FOLEVI_BUILD=shell) served
// from a privileged app://folevi scheme on the persist:folevi partition, and the web platform APIs local mode
// needs on that origin. The real Folevi for Mac (src/) is untouched: this is a separate Electron entry point
// with its own userData folder.
//
//   cd apps/desktop
//   SPIKE_USER_DATA=/tmp/folevi-s2 [S4_TOKENS=/path/s4-tokens.json] npx electron spikes/app-scheme/main.js write
//   SPIKE_USER_DATA=/tmp/folevi-s2 npx electron spikes/app-scheme/main.js read     (after a restart: IndexedDB kept?)
"use strict";
const { app, BrowserWindow, protocol, session } = require("electron");
const { existsSync, readFileSync, statSync } = require("node:fs");
const { extname, join, normalize, resolve } = require("node:path");

const PHASE = process.argv[process.argv.length - 1] === "read" ? "read" : "write";
const ROOT = resolve(__dirname, "../../../web/out-shell");
const FILES = resolve(__dirname, "fixtures");
const PARTITION = "persist:folevi";
if (process.env.SPIKE_USER_DATA) app.setPath("userData", process.env.SPIKE_USER_DATA);
const tokens = process.env.S4_TOKENS && existsSync(process.env.S4_TOKENS) ? JSON.parse(readFileSync(process.env.S4_TOKENS, "utf8")) : null;

// Before `ready`: standard + secure give app://folevi a real origin (IndexedDB, Web Locks, crypto.subtle).
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain", ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp", ".jpg": "image/jpeg", ".bin": "application/octet-stream" };

function fileResponse(file, request, extraHeaders = {}) {
  const size = statSync(file).size;
  const type = TYPES[extname(file)] ?? "application/octet-stream";
  const headers = { "content-type": type, "x-content-type-options": "nosniff", "accept-ranges": "bytes", ...extraHeaders };
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get("range") ?? "");
  const bytes = readFileSync(file);
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
    return new Response(bytes.subarray(start, end + 1), { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  return new Response(bytes, { status: 200, headers: { ...headers, "content-length": String(size) } });
}

function handle(request) {
  const url = new URL(request.url);
  if (url.host !== "folevi") return new Response("Not found", { status: 404 });
  const path = decodeURIComponent(url.pathname);
  if (/[\u0000-\u001f]|\.\./.test(path)) return new Response("Bad path", { status: 400 });
  // Attachments: /_files/<name> from the library (here a fixtures folder), with Range for audio and video.
  if (path.startsWith("/_files/")) {
    const file = normalize(join(FILES, path.slice("/_files/".length)));
    if (!file.startsWith(FILES) || !existsSync(file)) return new Response("Not found", { status: 404 });
    return fileResponse(file, request);
  }
  const file = normalize(join(ROOT, path));
  if (file.startsWith(ROOT) && existsSync(file) && statSync(file).isFile()) return fileResponse(file, request);
  if (path.startsWith("/api/") || path.startsWith("/_next/")) return new Response("Not found", { status: 404 });
  // SPA fallback. A local-mode page gets the strict CSP as a header (no Folevi or Convex hosts at all).
  const headers = path.startsWith("/local-csp/") ? { "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'" } : {};
  return fileResponse(join(ROOT, "index.html"), request, headers);
}

const debugLogs = [];
function open(path) {
  const win = new BrowserWindow({ show: false, width: 1000, height: 700, webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false } });
  const logs = [];
  win.webContents.on("console-message", (e) => {
    debugLogs.push(`${path} ${e.level}: ${String(e.message).slice(0, 200)}`);
    if (e.level === "error" || e.level === "warning") logs.push(`${e.level}: ${String(e.message).slice(0, 160)}`);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => debugLogs.push(`${path} did-fail-load ${code} ${desc} ${url}`));
  win.loadURL(`app://folevi${path}`);
  return { win, logs, eval: (js) => win.webContents.executeJavaScript(js, true) };
}

async function waitFor(w, expr, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await w.eval(`!!(${expr})`).catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const WS_PROBE = (convexUrl, jwt) => `new Promise((resolve) => {
  const out = { opened: false, messages: [] };
  let ws;
  try { ws = new WebSocket(${JSON.stringify(convexUrl.replace(/^http/, "ws") + "/api/1.46.0/sync")}); } catch (e) { resolve({ error: String(e) }); return; }
  const done = () => { clearTimeout(t); try { ws.close(); } catch {} resolve(out); };
  const t = setTimeout(() => { out.timeout = true; done(); }, 15000);
  ws.onopen = () => {
    out.opened = true;
    ws.send(JSON.stringify({ type: "Connect", sessionId: crypto.randomUUID(), connectionCount: 0, lastCloseReason: "InitialConnect", clientTs: 0 }));
    ${jwt ? `ws.send(JSON.stringify({ type: "Authenticate", baseVersion: 0, tokenType: "User", value: ${JSON.stringify(jwt)} }));` : ""}
    ws.send(JSON.stringify({ type: "ModifyQuerySet", baseVersion: 0, newVersion: 1, modifications: [{ type: "Add", queryId: 0, udfPath: ${JSON.stringify(jwt ? "users:me" : "settings:status")}, args: [{}] }] }));
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data); out.messages.push(m.type);
    const mod = (m.modifications || []).find((x) => x.queryId === 0);
    if (m.type === "Transition" && mod) { out.query = mod.type + (mod.errorMessage ? " " + mod.errorMessage : ""); done(); }
    if (m.type === "AuthError" || m.type === "FatalError") { out.error = m; done(); }
  };
  ws.onerror = () => { out.wsError = true; };
  ws.onclose = (e) => { out.close = e.code + " " + e.reason; if (!out.query) done(); };
})`;

app.whenReady().then(async () => {
  app.dock?.hide();
  const ses = session.fromPartition(PARTITION);
  ses.protocol.handle("app", handle);
  const result = { phase: PHASE, electron: process.versions.electron, chrome: process.versions.chrome };
  try {
    const a = open("/d/01JABCDEFGHJKMNPQRSTVWXYZ0");
    result.hydratedA = await waitFor(a, "window.__shellProbe && window.__shellProbe.hydrated");
    if (PHASE === "read") {
      result.persistedAfterRestart = await a.eval(`new Promise((res) => { const r = indexedDB.open("shell-persist", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => { const g = r.result.transaction("kv").objectStore("kv").get("marker"); g.onsuccess = () => res(g.result ?? null); g.onerror = () => res("error"); }; })`);
      console.log("S2 RESULT " + JSON.stringify(result, null, 2));
      app.quit();
      return;
    }
    result.probeA = await a.eval("window.__shellProbeRun()");
    await a.eval(`new Promise((res) => { const r = indexedDB.open("shell-persist", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put("written-" + ${JSON.stringify(new Date().toISOString())}, "marker"); tx.oncomplete = () => res(true); }; })`);

    // Second window on the same origin: Web Locks contention and handover, BroadcastChannel delivery.
    const b = open("/tasks/today");
    result.hydratedB = await waitFor(b, "window.__shellProbe && window.__shellProbe.hydrated");
    result.pathnameB = await b.eval("window.__shellProbe.pathname");
    await a.eval(`window.__release = new Promise((r) => (window.__releaseLock = r)); navigator.locks.request("folevi-local-library", () => window.__release); true`);
    result.lockWhileAHolds = await b.eval(`navigator.locks.request("folevi-local-library", { ifAvailable: true }, async (l) => (l ? "granted" : "busy"))`);
    await b.eval(`window.__got = null; navigator.locks.request("folevi-local-library", async () => { window.__got = Date.now(); await new Promise(() => {}); }); true`);
    await b.eval(`window.__bc = []; const c = new BroadcastChannel("folevi-local"); c.onmessage = (e) => window.__bc.push(e.data); true`);
    await a.eval(`new BroadcastChannel("folevi-local").postMessage({ keys: ["doc:1"], from: "A" }); true`);
    await waitFor(b, "window.__bc.length > 0", 3000);
    result.broadcastChannel = await b.eval("window.__bc");
    a.win.destroy(); // the host window closes: the lock passes to B
    result.lockHandoverToB = await waitFor(b, "window.__got !== null", 5000);
    result.pathnameAfterPush = await b.eval(`history.pushState(null, "", "/calendar/2026-10"); new Promise((r) => setTimeout(() => r(window.__shellProbe.pathname), 300))`);

    // Attachments through the scheme: Range and an <img>.
    result.filesRange = await b.eval(`fetch("/_files/sample.bin", { headers: { range: "bytes=2-5" } }).then(async (r) => ({ status: r.status, range: r.headers.get("content-range"), bytes: Array.from(new Uint8Array(await r.arrayBuffer())) }))`);
    result.filesImg = await b.eval(`new Promise((res) => { const i = new Image(); i.onload = () => res("loaded " + i.naturalWidth + "x" + i.naturalHeight); i.onerror = () => res("error"); i.src = "/_files/sample.svg"; })`);
    result.missingApi = await b.eval(`fetch("/api/auth/get-session").then((r) => r.status)`);

    // From this origin to Convex (dev): the WebSocket, and a storage upload (S4 wrote the URL and a JWT).
    const convexUrl = tokens?.convexUrl ?? null;
    if (convexUrl) {
      result.websocketAnon = await b.eval(WS_PROBE(convexUrl, null));
      result.websocketAuthed = await b.eval(WS_PROBE(convexUrl, tokens.jwt));
      result.upload = await b.eval(`fetch(${JSON.stringify(tokens.uploadUrls[0])}, { method: "POST", headers: { "content-type": "text/plain" }, body: "hello" }).then(async (r) => r.status + " " + (await r.text()).slice(0, 60), (e) => "blocked: " + e)`);
    }

    // A local-mode page with the strict CSP header: Folevi and Convex can't be reached from it.
    const c = open("/local-csp/documents");
    result.hydratedLocalCsp = await waitFor(c, "window.__shellProbe && window.__shellProbe.hydrated");
    result.localCspFetch = await c.eval(`fetch("https://app.folevi.com/api/auth/get-session").then((r) => "reached " + r.status, (e) => "blocked: " + e.message)`);
    if (convexUrl) result.localCspWebSocket = await c.eval(`new Promise((res) => { try { const w = new WebSocket(${JSON.stringify(convexUrl.replace(/^http/, "ws") + "/api/1.46.0/sync")}); w.onopen = () => res("opened"); w.onerror = () => res("blocked (error event)"); } catch (e) { res("blocked: " + e.message); } })`);
    result.logsA = a.logs.slice(0, 6);
    result.logsB = b.logs.slice(0, 6);
    result.logsLocalCsp = c.logs.slice(0, 6);
  } catch (e) {
    result.error = String(e && e.stack ? e.stack : e);
    result.debugLogs = debugLogs.slice(0, 20);
  }
  console.log("S2 RESULT " + JSON.stringify(result, null, 2));
  app.quit();
});
