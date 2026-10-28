#!/usr/bin/env node
// Whole screens, web vs native (docs/MAC_REBUILD_PLAN.md section 3.2), in the real Debug app on one scratch
// library: the app draws each screen twice, once in the native frame and once as the web app the shipped Mac
// app shows (FOLEVI_WEB_FRAME=1), with the same notes, the same engine, the same fonts and the same window size,
// light and dark; diff.mjs compares the two.
//
//   node apps/mac/scripts/screens.mjs [--fresh] [--only home,notes] [--size 1280x820]
//   node apps/mac/scripts/screens.mjs --gates [--only first-launch]   (the screens before the app, gates.mjs)
//   node apps/mac/scripts/screens.mjs --switch [--only home]   (the Mac switching light and dark with a screen open)
//   node apps/mac/scripts/screens.mjs --avatars   (the account's picture on the demo engine: initial, photo, new photo, logo)
//
// Everything lives in apps/mac/build/run/screens (the app's data) and apps/mac/build/run/screens-library (the
// library folder, FOLEVI_TEST_FOLDER): never the installed app's folder, Keychain or library. --fresh starts
// both again (first launch, library setup and the fixture notes). Needs the Debug build (build.mjs) and the shell
// export in apps/mac/web (apps/web/scripts/build-shell.mjs).
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

/** A folder's "…" menu in the web frame's sidebar, then one of its items (a dialog's `prepare`). */
function folderMenu(folder, item) {
  return `document.querySelector("[aria-label='Folder options for ${folder}']").click(); await new Promise((r) => setTimeout(r, 300)); [...document.querySelectorAll("[role='menuitem']")].find((e) => e.textContent.includes(${JSON.stringify(item)}))?.click(); return true`;
}
const CLOSE_DIALOGS = `document.querySelectorAll("dialog[open]").forEach((d) => d.close()); return true`;

/** The screens, by id: the folevi-dev:// link that opens each one. */
export const SCREENS = [
  // `card`: the first starred card is also compared on its own (its star tab is a few pixels of a whole screen).
  { id: "home", link: "folevi-dev://documents", card: true },
  { id: "notes", link: "folevi-dev://notes" },
  { id: "starred", link: "folevi-dev://starred", card: true },
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
  { id: "vault-locked", link: "folevi-dev://vault", step: (kind) => vaultLock(kind), settle: 800 },
  { id: "vault-files", link: "folevi-dev://vault", step: (kind) => vaultOpen(kind, ["tab", "Files & Notes"]), settle: 800 },
  { id: "vault-passwords", link: "folevi-dev://vault/passwords", step: (kind) => vaultOpen(kind, ["tab", "Passwords & Credentials"]), settle: 800 },
  { id: "vault-health", link: "folevi-dev://vault/health", step: (kind) => vaultOpen(kind, ["more", "Health"]), settle: 800 },
  { id: "vault-trash", link: "folevi-dev://vault/trash", step: (kind) => vaultOpen(kind, ["more", "Trash"]), settle: 800 },
  { id: "vault-settings", link: "folevi-dev://vault/settings", step: (kind) => vaultOpen(kind, ["more", "Settings"]), settle: 800 },
  { id: "ai", link: "folevi-dev://ai" },
  // The fixture's Foli AI conversation (its id from fixture.json), and the floating chat open over Home.
  { id: "ai-chat", link: (fx) => `folevi-dev://ai/${fx.chat}` },
  { id: "ask-ai", link: "folevi-dev://documents", ask: true },
  // Settings in local mode (the sections a library has), each opened on its own.
  { id: "settings-library", link: "folevi-dev://settings/library", settle: 1200 },
  { id: "settings-ai", link: "folevi-dev://settings/ai", settle: 1200 },
  { id: "settings-appearance", link: "folevi-dev://settings/appearance", settle: 800 },
  { id: "settings-data", link: "folevi-dev://settings/data", settle: 800 },
  { id: "settings-desktop", link: "folevi-dev://settings/desktop", settle: 1000 },
  // mr/more: Help, Graph, Reviews.
  { id: "help", link: "folevi-dev://help" },
  { id: "graph", link: "folevi-dev://graph" },
  { id: "review", link: "folevi-dev://review" },
  // Account-only pages: in local mode, "Sign in to Folevi to share and collaborate".
  { id: "shared", link: "folevi-dev://shared" },
  { id: "changes", link: "folevi-dev://changes" },
  // mr/more's dialogs: opened by `prepare` (a script in the web frame's page, a MacEval command in the native one)
  // over Home, closed again after the capture.
  { id: "palette", link: "folevi-dev://documents", prepare: { web: `document.querySelector("nav[aria-label='Folio'] button.ui-well").click(); return true`, native: { cmd: "more", do: "palette" } } },
  { id: "newfolder", link: "folevi-dev://documents", prepare: { web: `document.querySelector("nav[aria-label='Folio'] section > div:first-child > button").click(); return true`, native: { cmd: "more", do: "newFolder" } } },
  { id: "foldercolor", link: "folevi-dev://documents", prepare: { web: folderMenu("Travel", "Change color"), native: { cmd: "more", do: "color", folder: "Travel" } } },
  { id: "movefolder", link: "folevi-dev://documents", prepare: { web: folderMenu("Japan", "Move folder"), native: { cmd: "more", do: "moveFolder", folder: "Japan" } } },
  { id: "renamefolder", link: "folevi-dev://documents", prepare: { web: folderMenu("Work", "Rename"), native: { cmd: "more", do: "rename", folder: "Work" } } },
  // Last: the web's toast stays up for 8 seconds.
  { id: "toast", link: "folevi-dev://documents", prepare: { web: `window.dispatchEvent(new CustomEvent("folevi:error", { detail: "Something went wrong. Please try again." })); return true`, native: { cmd: "more", do: "toast", tone: "error", message: "Something went wrong. Please try again." } } },
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
/** The first starred card whose star corner is in the window (a carousel keeps some out of sight): its cover in
 *  the web frame, in points, with 6 pt round it, cut to the window (null when none is shown). */
const STARRED_CARD = `for (const star of document.querySelectorAll('main [aria-label="Starred"]')) { const cover = star.parentElement?.parentElement; if (!cover) continue; const r = cover.getBoundingClientRect(); if (r.left < 0 || r.top < 0 || r.right + 6 > innerWidth || r.top + 60 > innerHeight) continue; const top = r.top - 6, bottom = Math.min(innerHeight, r.bottom + 6); return { x: r.left - 6, y: top, width: r.width + 12, height: bottom - top }; } return null;`;

/** Cuts `rect` (points; the pictures are 2x) out of a picture, into `to`. */
async function crop(browser, from, rect, to) {
  if (!existsSync(from)) return;
  const page = await browser.newPage();
  const png = await page.evaluate(async ({ url, r }) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = Math.round(r.width * 2);
    c.height = Math.round(r.height * 2);
    c.getContext("2d").drawImage(img, Math.round(r.x * 2), Math.round(r.y * 2), c.width, c.height, 0, 0, c.width, c.height);
    return c.toDataURL("image/png").split(",")[1];
  }, { url: `data:image/png;base64,${readFileSync(from).toString("base64")}`, r: rect });
  await page.close();
  writeFileSync(to, Buffer.from(png, "base64"));
}

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
      // The size again for every screen: the window was once made screen-sized mid-run (2026-10-28), spoiling the rest.
      ensure(await command(dir, { cmd: "resize", width, height }));
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
      if (s.prepare) {
        if (kind === "web") await evaluate(dir, s.prepare.web);
        else ensure(await command(dir, s.prepare.native));
        await sleep(700);
      }
      await evaluate(dir, STILL).catch(() => undefined);
      // A screen that needs a step first (the Vault unlocked, a section opened): its script runs in the page.
      if (s.step) await evaluate(dir, s.step(kind)).catch((e) => console.warn(`${s.id}: ${e.message}`));
      await sleep(s.settle ?? 400);
      // The floating Ask Foli AI chat (⌘J): the menu item in the native frame, the page's shortcut in the web's.
      if (s.ask) {
        if (kind === "native") ensure(await command(dir, { cmd: "frame", do: "menu", item: "go.ask-ai" }));
        else await evaluate(dir, `window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", metaKey: true, bubbles: true })); return true;`);
        await sleep(1200);
        await evaluate(dir, STILL).catch(() => undefined);
      }
      // The window drawn by the app itself (MacEval windowShot), never a screen capture: capturing windows goes
      // through WindowServer's privacy checks, and many at once hung WindowServer and restarted the Mac (2026-10-28).
      ensure(await command(dir, { cmd: "windowShot", out: join(out, kind, `${s.id}-${scheme}.png`) }, 60_000));
      // Where the web draws the first starred card (its cover, with a few points round it): both frames' pictures
      // are cropped there after.
      if (s.card && kind === "web") {
        const rect = await evaluate(dir, STARRED_CARD).catch(() => null);
        if (rect) writeFileSync(join(out, `card-${s.id}-${scheme}.json`), JSON.stringify(rect));
      }
      if (s.ask) {
        if (kind === "native") await command(dir, { cmd: "frame", do: "menu", item: "go.ask-ai" });
        else await evaluate(dir, `window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); document.querySelector(".ai-chat [aria-label='Close chat']")?.click(); return true;`);
      }
      if (s.prepare) {
        if (kind === "web") await evaluate(dir, CLOSE_DIALOGS).catch(() => undefined);
        else await command(dir, { cmd: "more", do: "close" }).catch(() => undefined);
        await sleep(300);
      }
    }
  }
  await quit();
}

// --gates: the screens before the app instead (gates.mjs: first launch, library setup, offline), each from a
// fresh scratch folder of its own, into apps/mac/screens-report/gates.
if (process.argv.includes("--gates")) {
  const { GATES, enterGate, quitGate } = await import("./gates.mjs");
  const gates = GATES.filter((g) => !only || only.includes(g.id));
  const gout = join(out, "gates");
  for (const d of ["web", "native", "diff"]) {
    rmSync(join(gout, d), { recursive: true, force: true });
    mkdirSync(join(gout, d), { recursive: true });
  }
  for (const kind of ["native", "web"]) {
    for (const g of gates) {
      const gdir = await enterGate(g, { web: kind === "web" });
      try {
        ensure(await command(gdir, { cmd: "resize", width, height }));
        for (const scheme of ["light", "dark"]) {
          ensure(await command(gdir, { cmd: "appearance", value: scheme }));
          await evaluate(gdir, STILL).catch(() => undefined);
          await sleep(1200);
          // The app draws its own window (windowShot), never a screen capture (see shoot above).
          ensure(await command(gdir, { cmd: "windowShot", out: join(gout, kind, `${g.id}-${scheme}.png`) }, 60_000));
        }
      } finally {
        await quitGate(gdir);
      }
    }
  }
  const threshold = { channel: 24, radius: 1, maxRatio: 0.01 };
  const browser = await webkit.launch();
  const results = await diffAll(browser, gout, gates.flatMap((g) => ["light", "dark"].map((scheme) => ({ id: g.id, scheme }))), threshold);
  await browser.close();
  writeReport(gout, { title: "Screens before the app: web vs Folevi for Mac", note: `Each from a fresh scratch folder, ${width} x ${height} pt, the web frame vs the native frame.`, threshold, results, imageWidth: 520 });
  for (const r of results) console.log(`${r.id} ${r.scheme}: ${(r.ratio * 100).toFixed(2)}%${r.pass ? "" : " (over)"}${r.reason ? ` ${r.reason}` : ""}`);
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

// --switch: the Mac's appearance changed while a screen is open, into apps/mac/screens-report/switch. Each screen
// opens in one appearance, the Mac switches, and the window is drawn after: light to dark and dark to light with
// the library on Match System, and the Mac switching under a library set to Light or Dark (the page keeps the
// library's theme, so must everything native around it: the dark bar's glass over a light page, 2026-10-28).
// The library's Appearance is set through the native frame's engine (the web frame has none) and put back.
if (process.argv.includes("--switch")) {
  const CASES = [
    { name: "light-to-dark", library: "system", from: "light", to: "dark" },
    { name: "dark-to-light", library: "system", from: "dark", to: "light" },
    { name: "library-light-mac-to-dark", library: "light", from: "light", to: "dark" },
    { name: "library-dark-mac-to-light", library: "dark", from: "dark", to: "light" },
  ];
  const SWITCH = ["home", "notes", "note"];
  const picked = SCREENS.filter((s) => (only ? only.includes(s.id) : SWITCH.includes(s.id)));
  const sout = join(out, "switch");
  for (const d of ["web", "native", "diff"]) {
    rmSync(join(sout, d), { recursive: true, force: true });
    mkdirSync(join(sout, d), { recursive: true });
  }
  const env = { FOLEVI_TEST_FOLDER: library, ...FAKE_AI };
  const setLibrary = async (value) => {
    await launch({ dir, env });
    await waitFor(dir, `return !!window.__foleviEngine && !!window.__foleviNativeChrome`, 90_000);
    await evaluate(dir, `const r = JSON.parse(await window.__foleviEngine.handle({ v: 1, id: "switch-appearance", kind: "command", place: window.__foleviNativeChrome.place, name: "settings.update", args: { appearance: ${JSON.stringify(value)} } })); if (r.error) throw new Error(JSON.stringify(r.error)); return true;`);
    await sleep(1500);
    await quit();
  };
  try {
    stopOwnApp();
    if (!existsSync(join(dir, "fixture.json"))) await setUp();
    const fixture = JSON.parse(readFileSync(join(dir, "fixture.json"), "utf8"));
    for (const lib of [...new Set(CASES.map((c) => c.library))]) {
      await setLibrary(lib);
      for (const kind of ["native", "web"]) {
        await launch({ dir, env: { ...env, ...(kind === "web" ? { FOLEVI_WEB_FRAME: "1" } : {}) } });
        await waitFor(dir, kind === "web" ? `return document.readyState === "complete" && !!document.querySelector('nav[aria-label="Folio"]')` : `return !!window.__foleviEngine`, 90_000);
        await sleep(2000);
        for (const c of CASES.filter((c) => c.library === lib)) {
          for (const s of picked) {
            ensure(await command(dir, { cmd: "appearance", value: c.from }));
            ensure(await command(dir, { cmd: "resize", width, height }));
            ensure(await command(dir, { cmd: "open", url: typeof s.link === "function" ? s.link(fixture) : s.link }));
            await sleep(1600 + (s.settle ?? 400));
            await evaluate(dir, STILL).catch(() => undefined);
            // The switch, as the Mac makes it (MacEval sets the app's appearance; the page follows a frame later).
            ensure(await command(dir, { cmd: "appearance", value: c.to }));
            await sleep(1500);
            ensure(await command(dir, { cmd: "windowShot", out: join(sout, kind, `${s.id}-${c.name}.png`) }, 60_000));
          }
        }
        await command(dir, { cmd: "appearance", value: "system" }).catch(() => undefined);
        await quit();
      }
    }
  } catch (e) {
    console.error(`stopped: ${e.message}`);
    stopOwnApp();
    process.exitCode = 2;
  } finally {
    // The suite's library is on Match System for every other run.
    await setLibrary("system").catch((e) => console.error(`the library's Appearance wasn't put back: ${e.message}`));
  }
  if (process.exitCode) process.exit(process.exitCode);
  const threshold = { channel: 24, radius: 1, maxRatio: 0.01 };
  const browser = await webkit.launch();
  const results = await diffAll(browser, sout, picked.flatMap((s) => CASES.map((c) => ({ id: s.id, scheme: c.name }))), threshold);
  await browser.close();
  writeReport(sout, { title: "Appearance switches: web vs Folevi for Mac", note: `The Mac's appearance switched with each screen open, ${width} x ${height} pt, the web frame vs the native frame.`, threshold, results, imageWidth: 520 });
  for (const r of results) console.log(`${r.id} ${r.scheme}: ${(r.ratio * 100).toFixed(2)}%${r.pass ? "" : " (over)"}${r.reason ? ` ${r.reason}` : ""}`);
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

// --avatars: the account's picture, into apps/mac/screens-report/avatars. A picture needs a signed-in account,
// which a scratch run doesn't have, so this runs the native frame on its demo engine (FOLEVI_FRAME_DEMO=1) with
// real https pictures from folevi.com: the sidebar's account button and the account menu with no picture (the
// initial), with a photo, after the photo changes (the engine's next session, as an upload brings), and in a team
// workspace with and without a logo, light and dark. Each step must change the button's pixels as it should
// (the photo replaces the initial, a new photo replaces the old, a logo replaces the workspace's initial).
if (process.argv.includes("--avatars")) {
  const adir = join(MAC, "build", "run", "avatars");
  const aout = join(out, "avatars");
  rmSync(aout, { recursive: true, force: true });
  mkdirSync(aout, { recursive: true });
  const PHOTO = "https://folevi.com/marketing/people/alex@2x.webp";
  const NEW_PHOTO = "https://folevi.com/marketing/people/ines@2x.webp";
  const STEPS = [
    { name: "initial", space: "personal", avatar: null, logo: null },
    { name: "photo", space: "personal", avatar: PHOTO, logo: null },
    { name: "photo-changed", space: "personal", avatar: NEW_PHOTO, logo: null },
    { name: "workspace", space: "ws_airly", avatar: NEW_PHOTO, logo: null },
    { name: "workspace-logo", space: "ws_airly", avatar: NEW_PHOTO, logo: PHOTO },
  ];
  // The account button: the sidebar's foot (its 28 pt mark and the two lines beside it).
  const FOOT = { x: 0, y: height - 64, width: 256, height: 64 };
  const browser = await webkit.launch();
  /** The share of pixels that differ between two pictures of the same size (any channel over 24). */
  const differ = async (a, b) => {
    const page = await browser.newPage();
    const r = await page.evaluate(async ({ a, b }) => {
      const load = async (u) => {
        const img = new Image();
        img.src = u;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const [x, y] = [await load(a), await load(b)];
      let n = 0;
      for (let i = 0; i < x.length; i += 4) if (Math.abs(x[i] - y[i]) > 24 || Math.abs(x[i + 1] - y[i + 1]) > 24 || Math.abs(x[i + 2] - y[i + 2]) > 24) n++;
      return n / (x.length / 4);
    }, { a: `data:image/png;base64,${readFileSync(a).toString("base64")}`, b: `data:image/png;base64,${readFileSync(b).toString("base64")}` });
    await page.close();
    return r;
  };
  const checks = [];
  try {
    await launch({ dir: adir, env: { FOLEVI_FRAME_DEMO: "1" } });
    await waitFor(adir, `return true`, 30_000).catch(() => undefined);
    await sleep(2500);
    ensure(await command(adir, { cmd: "resize", width, height }));
    for (const scheme of ["light", "dark"]) {
      ensure(await command(adir, { cmd: "appearance", value: scheme }));
      for (const step of STEPS) {
        ensure(await command(adir, { cmd: "frame", do: "demoPictures", avatar: step.avatar, logo: step.logo, space: step.space }));
        // The picture's download.
        await sleep(step.avatar || step.logo ? 3500 : 1200);
        const shot = join(aout, `window-${step.name}-${scheme}.png`);
        ensure(await command(adir, { cmd: "windowShot", out: shot }, 60_000));
        await crop(browser, shot, FOOT, join(aout, `foot-${step.name}-${scheme}.png`));
        ensure(await command(adir, { cmd: "frame", do: "popover", which: "account" }));
        await sleep(step.avatar || step.logo ? 3000 : 800);
        ensure(await command(adir, { cmd: "frameShot", menu: true, out: join(aout, `menu-${step.name}-${scheme}.png`) }, 60_000));
        await command(adir, { cmd: "frame", do: "popover", which: "account" }).catch(() => undefined);
        await sleep(400);
      }
      const foot = (n) => join(aout, `foot-${n}-${scheme}.png`);
      for (const [a, b, what] of [
        ["initial", "photo", "the photo replaces the initial"],
        ["photo", "photo-changed", "a new photo replaces the old"],
        ["workspace", "workspace-logo", "the logo replaces the workspace's initial"],
      ]) {
        const ratio = await differ(foot(a), foot(b));
        // The 28 pt mark is about 5% of the foot; the photo changes most of it.
        checks.push({ scheme, what, ratio, pass: ratio > 0.02 });
      }
    }
  } catch (e) {
    console.error(`stopped: ${e.message}`);
    process.exitCode = 2;
  } finally {
    await command(adir, { cmd: "quit" }).catch(() => undefined);
    await browser.close();
  }
  writeFileSync(join(aout, "report.json"), JSON.stringify({ steps: STEPS, checks }, null, 2));
  for (const c of checks) console.log(`${c.pass ? "pass" : "FAIL"}  ${c.scheme}  ${c.what}  ${(c.ratio * 100).toFixed(2)}% of the button changed`);
  console.log(`pictures: ${aout}`);
  process.exit(process.exitCode || (checks.length && checks.every((c) => c.pass) ? 0 : 1));
}

try {
  stopOwnApp();
  if (process.argv.includes("--fresh") || !existsSync(join(dir, "fixture.json"))) await setUp();
  for (const d of ["web", "native", "diff"]) {
    rmSync(join(out, d), { recursive: true, force: true });
    mkdirSync(join(out, d), { recursive: true });
  }
  for (const s of SCREENS.filter((s) => s.card)) for (const scheme of ["light", "dark"]) rmSync(join(out, `card-${s.id}-${scheme}.json`), { force: true });
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
const cards = [];
for (const s of screens.filter((s) => s.card)) {
  for (const scheme of ["light", "dark"]) {
    const at = join(out, `card-${s.id}-${scheme}.json`);
    if (!existsSync(at)) continue;
    const rect = JSON.parse(readFileSync(at, "utf8"));
    for (const kind of ["web", "native"]) await crop(browser, join(out, kind, `${s.id}-${scheme}.png`), rect, join(out, kind, `${s.id}-card-${scheme}.png`));
    cards.push({ id: `${s.id}-card`, scheme });
  }
}
const results = await diffAll(browser, out, [...screens.flatMap((s) => ["light", "dark"].map((scheme) => ({ id: s.id, scheme }))), ...cards], threshold);
await browser.close();
writeReport(out, { title: "Screens: web vs Folevi for Mac", note: `The Debug app on one scratch library, ${width} x ${height} pt, the web frame (FOLEVI_WEB_FRAME=1) vs the native frame.`, threshold, results, imageWidth: 520 });
process.exit(results.every((r) => r.pass) ? 0 : 1);
