#!/usr/bin/env node
// How the Mac app feels signed in (docs/perf/feel-results.md): the Debug app, signed in to a test account on the local
// backend, with the backend a chosen distance away (apps/web/perf/latency-proxy.mjs). Everything is driven through
// the page (the eval hook): no mouse, no keyboard. Launching brings the app to the front once per launch: run it only
// with the owner's OK. Nothing here touches the installed app, its folder, its Keychain or the owner's library.
//
//   node apps/mac/scripts/perf-feel.mjs --user-data <dir> [--app <Folevi Dev.app>] [--shell <web export>]
//        [--email e --password p --site http://app.localhost:3000] [--delay 130] [--runs 3] [--label after] [--out f.json]
//
// The web export must talk to Convex over TLS: the app's page is a secure page, and WebKit refuses it a plain ws://
// connection ("The operation is insecure"), so a local backend can't be used here; the development deployment can.
// --email/--password sign a fresh data folder in (a session from the website, given to the Debug app); later runs on
// the same folder start signed in. Per run: launch to the first note on screen (warm), the host handing a Convex
// token to a page, a task checked off (click to the box showing it), a new window to its first note, and frame gaps
// while All notes scrolls (WebKit, composited for real).
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { command, evaluate, launch, userData, waitFor } from "./mac.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const ud = userData(arg("--user-data"));
const app = arg("--app");
const shell = arg("--shell");
// --delay: the relay's delay each way (apps/web/perf/latency-proxy.mjs); without it, the network as it is.
const delay = arg("--delay") === null ? null : Number(arg("--delay"));
const runs = Number(arg("--runs", "3"));
const label = arg("--label", "run");
const control = `http://127.0.0.1:${process.env.PERF_PROXY_CONTROL ?? 3399}/`;
const env = { ...(shell ? { FOLEVI_SHELL_DIR: shell } : {}) };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), label, ...a);
const setDelay = (ms) => (delay === null ? Promise.resolve({ delayMs: "none (real network)" }) : fetch(`${control}?ms=${ms}`).then((r) => r.json()));

const FIRST_NOTE = `return !!document.querySelector("main a[href^='/d/']")`;

async function quit() {
  await command(ud, { cmd: "quit" }).catch(() => undefined);
  await sleep(2500);
}

async function start() {
  const t0 = Date.now();
  await launch({ dir: ud, env, ...(app ? { app } : {}), timeoutMs: 90_000 });
  return t0;
}

/**
 * Signs the fresh data folder in: a session from the website's sign-in (Better Auth's bearer token), handed to the app
 * with the Debug `test-session` command (a Debug app keeps it in its own Keychain items, com.folevi.dev.*).
 */
async function signIn(email, password, site) {
  const res = await fetch(`${site}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: site }, body: JSON.stringify({ email, password }) });
  const token = res.headers.get("set-auth-token");
  if (!res.ok || !token) throw new Error(`sign-in failed: ${res.status}`);
  await start();
  const r = await command(ud, { cmd: "test-session", token });
  if (r.error) throw new Error(r.error);
  await sleep(1500);
  await evaluate(ud, `location.reload(); return 1`).catch(() => undefined);
  await waitFor(ud, FIRST_NOTE, 120_000);
  log("signed in");
  // The device copy downloads once; measure after it.
  await sleep(20_000);
  await quit();
}

/** In the page: time from `act` to the frame where `ready` holds. */
const timedInPage = (act, ready) => `
  const ready = () => { ${ready} };
  const t0 = performance.now();
  ${act}
  return await new Promise((resolve) => {
    const tick = () => { if (performance.now() - t0 > 15000) return resolve(-1); if (ready()) return resolve(Math.round(performance.now() - t0)); requestAnimationFrame(tick); };
    tick();
  });`;

async function go(path) {
  await evaluate(ud, `history.pushState(null, "", ${JSON.stringify(path)}); dispatchEvent(new PopStateEvent("popstate")); return true`);
}

async function measureOnce(out) {
  // ---- Launch, warm, signed in: to the first note on screen. ----
  await quit();
  const t0 = await start();
  await waitFor(ud, FIRST_NOTE, 60_000);
  const launchMs = Date.now() - t0;
  (out.launch ??= []).push(launchMs);
  log("launch to first note", launchMs);
  await sleep(6000);

  // ---- The host handing a page a Convex token (what every new window, floating note and Quick Add page waits for). ----
  const token = [];
  for (let i = 0; i < 3; i++) token.push(await evaluate(ud, `const t = performance.now(); await foleviShell.auth.convexToken(); return Math.round(performance.now() - t)`));
  (out.token ??= []).push(...token);
  log("host token", token);

  // ---- Task check-off. ----
  await go("/tasks");
  await waitFor(ud, `return !!document.querySelector('[role="checkbox"][aria-checked="false"][aria-label^="Mark"]')`, 30_000);
  await sleep(3000);
  const checks = [];
  for (let i = 0; i < 3; i++) {
    checks.push(
      await evaluate(
        ud,
        timedInPage(
          `const box = [...document.querySelectorAll('[role="checkbox"][aria-checked="false"][aria-label^="Mark"]')][0]; box.setAttribute("data-feel", "1"); box.click();`,
          `const el = document.querySelector('[data-feel="1"]'); return !el || el.getAttribute("aria-checked") === "true";`,
        ),
      ),
    );
    await evaluate(ud, `document.querySelector('[data-feel="1"]')?.removeAttribute("data-feel"); return true`);
    await sleep(1200);
  }
  (out.taskCheck ??= []).push(...checks);
  log("task check-off", checks);

  // ---- Scrolling All notes: rAF gaps while the list scrolls 30 px a frame, down and back. ----
  await go("/documents");
  await waitFor(ud, FIRST_NOTE, 30_000);
  await sleep(2500);
  const scroll = await evaluate(
    ud,
    `const link = document.querySelector("main a[href^='/d/']");
     let s = link.parentElement; while (s && !(s.scrollHeight > s.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
     if (!s) return null;
     const gaps = []; let last = performance.now(); let dir = 1; const end = last + 4000;
     await new Promise((resolve) => { const tick = (t) => { gaps.push(t - last); last = t; s.scrollTop += 30 * dir; if (s.scrollTop + s.clientHeight >= s.scrollHeight - 2) dir = -1; if (s.scrollTop <= 0) dir = 1; if (t < end) requestAnimationFrame(tick); else resolve(); }; requestAnimationFrame(tick); });
     gaps.shift(); gaps.sort((a, b) => a - b);
     const q = (p) => Math.round(gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))] * 10) / 10;
     return { frames: gaps.length, p50: q(0.5), p95: q(0.95), max: q(1), over17: gaps.filter((g) => g > 17.5).length, over33: gaps.filter((g) => g > 33.4).length, height: s.scrollHeight };`,
  );
  (out.scroll ??= []).push(scroll);
  log("scroll", JSON.stringify(scroll));

  // ---- A new window: to its first note. ----
  const before = (await command(ud, { cmd: "windows" })).value;
  const tw = Date.now();
  await command(ud, { cmd: "newWindow", path: "/documents" });
  const index = Array.isArray(before) ? before.length : 1;
  let windowMs = -1;
  for (let i = 0; i < 240; i++) {
    const ok = await evaluate(ud, FIRST_NOTE, index).catch(() => false);
    if (ok) {
      windowMs = Date.now() - tw;
      break;
    }
    await sleep(100);
  }
  const windowToken = await evaluate(ud, `const t = performance.now(); await foleviShell.auth.convexToken(); return Math.round(performance.now() - t)`, index).catch(() => -1);
  (out.newWindow ??= []).push(windowMs);
  log("new window to first note", windowMs, "its token", windowToken);
  await evaluate(ud, `window.close(); return true`, index).catch(() => undefined);
  await sleep(1500);
}

const email = arg("--email");
if (email) {
  await setDelay(0);
  await signIn(email, arg("--password", "quiet folio test password"), arg("--site", "http://app.localhost:3000"));
}
const proxy = await setDelay(delay);
log("backend delay each way", proxy.delayMs, "ms");
const out = { label, delayEachWayMs: delay, date: new Date().toISOString() };
for (let r = 0; r < runs; r++) await measureOnce(out);
await quit();
await setDelay(0);
console.log(JSON.stringify(out));
if (arg("--out")) writeFileSync(arg("--out"), JSON.stringify(out, null, 2));
