#!/usr/bin/env node
// Whole screens, web vs native (docs/MAC_REBUILD_PLAN.md section 3.2), in the real Debug app on one scratch
// library: the app draws each screen twice, once in the native frame and once as the web app the shipped Mac
// app shows (FOLEVI_WEB_FRAME=1), with the same notes, the same engine, the same fonts and the same window size,
// light and dark; diff.mjs compares the two.
//
//   node apps/mac/scripts/screens.mjs [--fresh] [--only home,notes] [--size 1280x820]
//
// Everything lives in apps/mac/build/run/screens (the app's data) and apps/mac/build/run/screens-library (the
// library folder, FOLEVI_TEST_FOLDER): never the installed app's folder, Keychain or library. --fresh starts
// both again (first launch, library setup and the fixture notes). Needs the Debug build (build.mjs) and the shell
// export in apps/mac/web (apps/web/scripts/build-shell.mjs).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { command, evaluate, launch, waitFor } from "./mac.mjs";
import { diffAll, writeReport } from "./diff.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MAC = resolve(here, "..");
const repo = resolve(MAC, "../..");
const require = createRequire(join(repo, "apps/web/package.json"));
const { webkit } = require("@playwright/test");

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const [width, height] = (arg("--size") ?? "1280x820").split("x").map(Number);
const dir = join(MAC, "build", "run", "screens");
const library = join(MAC, "build", "run", "screens-library");
const out = join(MAC, "screens-report");

/** The screens, by id: the folevi-dev:// link that opens each one. */
export const SCREENS = [
  { id: "home", link: "folevi-dev://documents" },
  { id: "notes", link: "folevi-dev://notes" },
  { id: "starred", link: "folevi-dev://starred" },
  { id: "drafts", link: "folevi-dev://drafts" },
  { id: "tasks-today", link: "folevi-dev://tasks/today" },
  { id: "tasks-upcoming", link: "folevi-dev://tasks/upcoming" },
  { id: "tasks-all", link: "folevi-dev://tasks/all" },
  { id: "tasks-completed", link: "folevi-dev://tasks/completed" },
  // The calendar's layout is kept per device: each frame is set to the one the screen shows (the web by its
  // switch, the native screen by a notification the Debug app posts).
  { id: "calendar", link: "folevi-dev://calendar", layout: "month" },
  { id: "calendar-week", link: "folevi-dev://calendar", layout: "week" },
  { id: "templates", link: "folevi-dev://templates" },
  { id: "archive", link: "folevi-dev://archive" },
  { id: "trash", link: "folevi-dev://trash" },
  // The first fixture note ("Kyoto in November"), by its id from fixture.json.
  { id: "note", link: (fx) => `folevi-dev://d/${fx.notes[0]}`, settle: 2500, ...noteTool("contents", "Table of contents") },
  // The note's own sidebar, each tool tab (the web's tab clicked, the native one chosen in its defaults).
  { id: "note-comments", link: (fx) => `folevi-dev://d/${fx.notes[0]}`, settle: 1200, ...noteTool("comments", "Comments") },
  { id: "note-tasks", link: (fx) => `folevi-dev://d/${fx.notes[0]}`, settle: 1200, ...noteTool("tasks", "Tasks in this page") },
  { id: "note-attachments", link: (fx) => `folevi-dev://d/${fx.notes[0]}`, settle: 1200, ...noteTool("attachments", "Attachments and links") },
  // A folder with a subfolder (Travel, with Japan), and the Folders and Tags pages.
  { id: "folder", link: (fx) => `folevi-dev://folders/${fx.folders?.travel}` },
  { id: "folders", link: "folevi-dev://folders" },
  { id: "tags", link: "folevi-dev://tags" },
  // The library's Vault (docs/MAC_REBUILD_PLAN.md §5.6), locked first, then opened with the fixture's PIN.
  { id: "vault-locked", link: "folevi-dev://vault", prepare: (kind) => vaultLock(kind), settle: 800 },
  { id: "vault-files", link: "folevi-dev://vault", prepare: (kind) => vaultOpen(kind, ["tab", "Files & Notes"]), settle: 800 },
  { id: "vault-passwords", link: "folevi-dev://vault/passwords", prepare: (kind) => vaultOpen(kind, ["tab", "Passwords & Credentials"]), settle: 800 },
  { id: "vault-health", link: "folevi-dev://vault/health", prepare: (kind) => vaultOpen(kind, ["more", "Health"]), settle: 800 },
  { id: "vault-trash", link: "folevi-dev://vault/trash", prepare: (kind) => vaultOpen(kind, ["more", "Trash"]), settle: 800 },
  { id: "vault-settings", link: "folevi-dev://vault/settings", prepare: (kind) => vaultOpen(kind, ["more", "Settings"]), settle: 800 },
  { id: "ai", link: "folevi-dev://ai" },
  // The fixture's Foli AI conversation (its id from fixture.json), and the floating chat open over Home.
  { id: "ai-chat", link: (fx) => `folevi-dev://ai/${fx.chat}` },
  { id: "ask-ai", link: "folevi-dev://documents", ask: true },
];

/** The fixture Vault's PIN (made up for the scratch library). */
const VAULT_PIN = "246813";

/** Locks the fixture Vault if an earlier screen (the other scheme's pass) left it open. */
function vaultLock(kind) {
  if (kind === "native")
    return `
      const engine = window.__foleviEngine; const place = window.__foleviNativeChrome.place;
      const ask = async (k, name, args) => JSON.parse(await engine.handle({ v: 1, id: "vl" + Math.random(), kind: k, place, name, args }));
      const s = (await ask("query", "vault.summary", {})).value;
      if (s && s.state === "open") await ask("command", "vault.lock", { vaultId: s.vaultId });
      return true;`;
  return `
    const lock = [...document.querySelectorAll(".ui-invert main > header button")].find((b) => b.textContent.trim() === "Lock");
    if (lock) { lock.click(); for (let t = 0; t < 5000 && !document.querySelector(".ui-invert .rounded-panel.ui-card"); t += 100) await new Promise((r) => setTimeout(r, 100)); }
    return true;`;
}

/**
 * Opens the fixture Vault on the screen shown: in the native frame through the engine (the native screen follows
 * vault.summary), in the web frame by typing the PIN on the web's own unlock screen; then, in the web frame, the
 * tab or the ⋯ menu's section (the native screen opens it from the link's path).
 */
function vaultOpen(kind, section) {
  if (kind === "native")
    return `
      const engine = window.__foleviEngine; const place = window.__foleviNativeChrome.place;
      const ask = async (k, name, args) => JSON.parse(await engine.handle({ v: 1, id: "vo" + Math.random(), kind: k, place, name, args }));
      const s = (await ask("query", "vault.summary", {})).value;
      if (s && s.state === "locked") await ask("command", "vault.unlock", { vaultId: s.vaultId, passcode: ${JSON.stringify(VAULT_PIN)} });
      return true;`;
  return `
    const wait = async (fn, ms = 20000) => { for (let t = 0; t < ms; t += 100) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };
    const byText = (sel, text) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim() === text);
    const field = await wait(() => document.querySelector('[role="tablist"][aria-label="Vault sections"]') || [...document.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith("Passcode"))?.querySelector("input"));
    if (field && field.tagName === "INPUT") {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, ${JSON.stringify(VAULT_PIN)});
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      byText("button", "Unlock").click();
      await wait(() => document.querySelector('[role="tablist"][aria-label="Vault sections"]'));
    }
    const section = ${JSON.stringify(section)};
    if (section && section[0] === "tab") byText('[role="tab"]', section[1])?.click();
    if (section && section[0] === "more") {
      document.querySelector('button[aria-label="More in the Vault"]').click();
      (await wait(() => byText('[role="menuitemradio"]', section[1])))?.click();
    }
    await new Promise((r) => setTimeout(r, 300));
    return true;`;
}

/** The fixture Vault: set up with the PIN, a few passwords, a folder with a note, and a file. */
const VAULT_FIXTURE = `
  const engine = window.__foleviEngine;
  const place = window.__foleviNativeChrome && window.__foleviNativeChrome.place;
  let n = 0;
  const run = async (name, args) => {
    const reply = JSON.parse(await engine.handle({ v: 1, id: "vf" + n++, kind: "command", place, name, args }));
    if (reply.error) throw new Error(name + ": " + JSON.stringify(reply.error));
    return reply.value;
  };
  await run("vault.setUp", { passcode: ${JSON.stringify(VAULT_PIN)} });
  const s = JSON.parse(await engine.handle({ v: 1, id: "vfs", kind: "query", place, name: "vault.summary", args: {} })).value;
  const vaultId = s.vaultId;
  await run("vault.recoverySaved", { vaultId });
  await run("vault.item.save", { vaultId, kind: "wifi", title: "Studio Wi-Fi", values: { network: "Studio", password: "abc123", security: "WPA3" }, notes: "" });
  await run("vault.item.save", { vaultId, kind: "apiKey", title: "Maps API key", values: { service: "Maps", key: "made-up-key-for-screens", environment: "Production" }, notes: "" });
  await run("vault.item.save", { vaultId, kind: "login", title: "Bank of Kyoto", values: { username: "sam@example.com", password: "Plum-Lantern-42-Harbor", website: "bank.example" }, notes: "" });
  const folder = await run("vault.folder.create", { vaultId, parentId: null, name: "Contracts" });
  await run("vault.folder.create", { vaultId, parentId: null, name: "Passports" });
  await run("vault.note.create", { vaultId, folderId: null, title: "Safe deposit box" });
  await run("vault.file.upload", { vaultId, folderId: null, name: "packing-list.txt", mime: "text/plain", data: btoa("Passport\\nAdapters\\nRain jacket\\n") });
  const old = await run("vault.item.save", { vaultId, kind: "secureNote", title: "Old alarm code", values: { text: "1234" }, notes: "" });
  await run("vault.item.remove", { vaultId, itemId: old.id });
  await run("vault.lock", { vaultId });
  return folder.id;
`;

/** A note screen showing one tab of the note's sidebar: `defaults` for the native frame, `web` run in the web frame. */
function noteTool(tab, title) {
  return {
    defaults: { "folevi.noteSidebar.tab": tab },
    web: `for (let i = 0; i < 40 && !document.querySelector('[aria-label="Page tools"]'); i++) await new Promise((r) => setTimeout(r, 100)); document.querySelector('[aria-label="Page tools"] > button[title="${title}"]')?.click(); return true;`,
  };
}
const only = arg("--only")?.split(",");
const screens = SCREENS.filter((s) => !only || only.includes(s.id));

/** The fixture library: folders, notes with text, stars and tasks, made through the engine's own commands. */
const FIXTURE = `
  const engine = window.__foleviEngine;
  const place = window.__foleviNativeChrome && window.__foleviNativeChrome.place;
  if (!engine || !place) throw new Error("no engine in this page");
  let n = 0;
  const run = async (name, args) => {
    const reply = JSON.parse(await engine.handle({ v: 1, id: "fx" + n++, kind: "command", place, name, args }));
    if (reply.error) throw new Error(name + ": " + JSON.stringify(reply.error));
    return reply.result ?? reply.value;
  };
  const travel = await run("folder.create", { name: "Travel", parentId: null, color: null });
  const japan = await run("folder.create", { name: "Japan", parentId: travel.id, color: null });
  const work = await run("folder.create", { name: "Work", parentId: null, color: null });
  const notes = [
    ["Kyoto in November\\nTemples to see, the moss garden at Saiho-ji, and where to eat near Nishiki market.", japan.id],
    ["Packing list\\nPassport\\nAdapters\\nRain jacket", travel.id],
    ["Quarterly plan\\nShip the Mac app, then the iPhone app. Hire one designer.", work.id],
    ["Meeting with Sam\\nAgenda: budget, launch dates, the new office.", work.id],
    ["Reading list\\nThe Remains of the Day\\nPiranesi\\nKlara and the Sun", null],
    ["Recipes to try\\nMiso soup, okonomiyaki, matcha cookies.", null],
  ];
  const ids = [];
  for (const [text, folderId] of notes) {
    const r = await run("note.create", { text, open: false });
    ids.push(r.id);
    if (folderId) await run("note.move", { ids: [r.id], folderId });
  }
  await run("note.star", { ids: [ids[0], ids[2]], starred: true });
  for (const t of ["Book the ryokan tomorrow", "Call Sam on Friday 3pm", "Renew passport next week", "Buy matcha today"]) await run("task.create", { text: t });
  window.__fxFolders = { travel: travel.id, japan: japan.id, work: work.id };
  return ids;
`;

/**
 * Foli AI's fixture conversation: one question, answered by the Debug app's stand-in model (FOLEVI_FAKE_AI=1,
 * apps/mac/Folevi/Bridge/FakeAI.swift: the same answer every time, offline, nothing sent anywhere).
 */
const AI_FIXTURE = `
  const engine = window.__foleviEngine;
  const place = window.__foleviNativeChrome && window.__foleviNativeChrome.place;
  let n = 0;
  const call = async (kind, name, args) => {
    const reply = JSON.parse(await engine.handle({ v: 1, id: "ai" + n++, kind, place, name, args }));
    if (reply.error) throw new Error(name + ": " + JSON.stringify(reply.error));
    return reply.result ?? reply.value;
  };
  const sent = await call("command", "ai.send", { text: "Plan three days in Kyoto" });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const c = await call("query", "ai.conversation", { conversationId: sent.conversationId }).catch(() => null);
    const last = c && c.messages && c.messages[c.messages.length - 1];
    if (last && last.role === "assistant" && last.status !== "streaming") return sent.conversationId;
  }
  throw new Error("the fixture answer didn't finish");
`;
/** The Debug app's stand-in model for Foli AI (never a real request). */
const FAKE_AI = { FOLEVI_FAKE_AI: "1" };
const STILL = `if (!document.getElementById("__screensStill")) { const s = document.createElement("style"); s.id = "__screensStill"; s.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; }"; document.documentElement.appendChild(s); } return true;`;

const ensure = (r) => {
  if (r && r.error) throw new Error(r.error);
  return r?.value;
};

/** Ends this script's own app, if one is still running from an earlier run (its pid in the data folder). */
function stopOwnApp() {
  try {
    const app = JSON.parse(readFileSync(join(dir, "Debug", "app.json"), "utf8"));
    process.kill(app.pid, "SIGTERM");
  } catch {
    // Not running.
  }
}

async function setUp() {
  stopOwnApp();
  await sleep(1000);
  rmSync(dir, { recursive: true, force: true });
  rmSync(library, { recursive: true, force: true });
  mkdirSync(library, { recursive: true });
  // The first launch in the web frame: the library on the test folder, local mode.
  await launch({ dir, env: { FOLEVI_TEST_FOLDER: library, FOLEVI_WEB_FRAME: "1" } });
  await waitFor(dir, `return /Where should your (notes|library) live\?/.test(document.body.innerText)`, 90_000);
  const info = await evaluate(dir, `return await foleviShell.library.setup({ kind: "folder" })`);
  if (!String(info?.displayPath ?? "").endsWith(library.split("/").pop())) throw new Error(`Not the script's own library: ${JSON.stringify(info)}. Stopped.`);
  await evaluate(dir, `await foleviShell.setMode("local"); setTimeout(() => location.reload(), 50); return true;`);
  await sleep(3000);
  await waitFor(dir, `return document.readyState === "complete" && !!document.querySelector('nav[aria-label="Folio"]')`, 90_000);
  await quit();
  // The fixture notes, through the native frame's engine.
  await launch({ dir, env: { FOLEVI_TEST_FOLDER: library, ...FAKE_AI } });
  await waitFor(dir, `return !!window.__foleviEngine && !!window.__foleviNativeChrome`, 90_000);
  await sleep(1500);
  const made = await evaluate(dir, FIXTURE);
  const folders = await evaluate(dir, `return window.__fxFolders`).catch(() => null);
  await sleep(1500);
  await evaluate(dir, VAULT_FIXTURE);
  await sleep(1500);
  const chat = await evaluate(dir, AI_FIXTURE);
  await sleep(1000);
  await quit();
  writeFileSync(join(dir, "fixture.json"), JSON.stringify({ notes: made, folders, chat, at: new Date().toISOString() }));
}

/** A library made before the Foli AI fixture: its conversation is added. */
async function ensureAiFixture() {
  const fixture = JSON.parse(readFileSync(join(dir, "fixture.json"), "utf8"));
  if (fixture.chat) return fixture;
  await launch({ dir, env: { FOLEVI_TEST_FOLDER: library, ...FAKE_AI } });
  await waitFor(dir, `return !!window.__foleviEngine && !!window.__foleviNativeChrome`, 90_000);
  await sleep(1500);
  fixture.chat = await evaluate(dir, AI_FIXTURE);
  await sleep(1000);
  await quit();
  writeFileSync(join(dir, "fixture.json"), JSON.stringify(fixture));
  return fixture;
}

async function quit() {
  await command(dir, { cmd: "quit" }).catch(() => undefined);
  const app = JSON.parse(readFileSync(join(dir, "Debug", "app.json"), "utf8"));
  for (let i = 0; i < 60; i++) {
    try {
      process.kill(app.pid, 0);
    } catch {
      return;
    }
    await sleep(250);
  }
  throw new Error("the app didn't quit");
}

/** Every screen, light and dark, in one frame (native, or the web frame). */
async function shoot(kind) {
  await launch({ dir, env: { FOLEVI_TEST_FOLDER: library, ...FAKE_AI, ...(kind === "web" ? { FOLEVI_WEB_FRAME: "1" } : {}) } });
  await waitFor(dir, kind === "web" ? `return document.readyState === "complete" && !!document.querySelector('nav[aria-label="Folio"]')` : `return !!window.__foleviEngine`, 90_000);
  await sleep(2000);
  ensure(await command(dir, { cmd: "resize", width, height }));
  mkdirSync(join(out, kind), { recursive: true });
  for (const scheme of ["light", "dark"]) {
    ensure(await command(dir, { cmd: "appearance", value: scheme }));
    for (const s of screens) {
      const fixture = JSON.parse(readFileSync(join(dir, "fixture.json"), "utf8"));
      if (kind === "native") for (const [key, value] of Object.entries(s.defaults ?? {})) ensure(await command(dir, { cmd: "setDefault", key, value }));
      ensure(await command(dir, { cmd: "open", url: typeof s.link === "function" ? s.link(fixture) : s.link }));
      await sleep(1600);
      if (kind === "web" && s.web) await evaluate(dir, s.web).catch(() => undefined);
      if (s.layout) {
        if (kind === "web") await evaluate(dir, `const b = [...document.querySelectorAll("[role=radio]")].find((b) => b.textContent.trim() === ${JSON.stringify(s.layout)}); if (b) b.click(); return true;`).catch(() => undefined);
        else await command(dir, { cmd: "frame", do: "post", name: "folevi.calendar.layout", value: s.layout }).catch(() => undefined);
        await sleep(600);
      }
      // A window behind others doesn't run CSS animations (a note's sheet would stay at its first, invisible
      // frame): the end state at once, in both frames alike.
      await evaluate(dir, STILL).catch(() => undefined);
      // A screen that needs a step first (the Vault unlocked, a section opened): its script runs in the page.
      if (s.prepare) await evaluate(dir, s.prepare(kind)).catch((e) => console.warn(`${s.id}: ${e.message}`));
      await sleep(s.settle ?? 400);
      // The floating Ask Foli AI chat (⌘J): the menu item in the native frame, the page's shortcut in the web's.
      if (s.ask) {
        if (kind === "native") ensure(await command(dir, { cmd: "frame", do: "menu", item: "go.ask-ai" }));
        else await evaluate(dir, `window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", metaKey: true, bubbles: true })); return true;`);
        await sleep(1200);
        await evaluate(dir, STILL).catch(() => undefined);
      }
      // The window as the screen shows it (macOS's own capture, no window shadow): the same path for both frames.
      const number = ensure(await command(dir, { cmd: "windows" }))[0].number;
      execFileSync("screencapture", ["-x", "-o", "-l", String(number), join(out, kind, `${s.id}-${scheme}.png`)]);
      if (s.ask) {
        if (kind === "native") await command(dir, { cmd: "frame", do: "menu", item: "go.ask-ai" });
        else await evaluate(dir, `window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); document.querySelector(".ai-chat [aria-label='Close chat']")?.click(); return true;`);
      }
    }
  }
  await quit();
}

try {
  stopOwnApp();
  if (process.argv.includes("--fresh") || !existsSync(join(dir, "fixture.json"))) await setUp();
  for (const d of ["web", "native", "diff"]) {
    rmSync(join(out, d), { recursive: true, force: true });
    mkdirSync(join(out, d), { recursive: true });
  }
  await ensureAiFixture();
  await shoot("native");
  await shoot("web");
} catch (e) {
  const text = await evaluate(dir, `return document.body.innerText.slice(0, 400)`).catch(() => "(no page)");
  console.error(`stopped: ${e.message}\npage: ${JSON.stringify(text)}`);
  stopOwnApp();
  process.exit(2);
}
const threshold = { channel: 24, radius: 1, maxRatio: 0.01 };
const browser = await webkit.launch();
const results = await diffAll(browser, out, screens.flatMap((s) => ["light", "dark"].map((scheme) => ({ id: s.id, scheme }))), threshold);
await browser.close();
writeReport(out, { title: "Screens: web vs Folevi for Mac", note: `The Debug app on one scratch library, ${width} x ${height} pt, the web frame (FOLEVI_WEB_FRAME=1) vs the native frame.`, threshold, results, imageWidth: 520 });
process.exit(results.every((r) => r.pass) ? 0 : 1);
