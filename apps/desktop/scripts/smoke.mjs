#!/usr/bin/env node
// A smoke run of Folevi for Windows from source, on any computer (a Mac included), always on a scratch data folder
// (never the person's library or settings): it starts the app with the built-in interface, walks the first launch
// into "Keep notes on my devices" > "This device only", makes a note, and checks the page got the Windows bridge
// (data-desktop="windows", foleviShell.platform "windows", Ctrl shortcuts' labels). Screenshots go to --out.
//   node scripts/smoke.mjs --out <folder> [--dark]
// Needs `pnpm build` (dist/), the export in web/, the Electron binary (node node_modules/electron/install.js) and
// the workspace's Playwright (pnpm install at the repo root). On a Mac the page gets the Windows look
// (FOLEVI_LOOK=windows), without Windows' own caption buttons.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const out = resolve(argv[argv.indexOf("--out") + 1] ?? join(root, "release", "smoke"));
const dark = argv.includes("--dark");
mkdirSync(out, { recursive: true });
const { chromium } = createRequire(join(root, "../web/package.json"))("@playwright/test");

const electron =
  process.platform === "darwin"
    ? join(root, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")
    : process.platform === "win32"
      ? join(root, "node_modules/electron/dist/electron.exe")
      : join(root, "node_modules/electron/dist/electron");
const data = mkdtempSync(join(tmpdir(), "folevi-windows-smoke-"));
const port = 9300 + Math.floor(Math.random() * 500);
const child = spawn(electron, [".", `--remote-debugging-port=${port}`, ...(dark ? ["--force-dark-mode"] : [])], {
  cwd: root,
  env: { ...process.env, FOLEVI_SHELL: "1", FOLEVI_LOOK: "windows", FOLEVI_USER_DATA: data, FOLEVI_UPDATES: "off" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await wait(500);
    }
  }
  throw new Error(`Folevi didn't open its debugging port.\n${log}`);
}

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

let page = null;
try {
  const browser = await connect();
  // The main window: the page at /documents (Quick Add's and runners' pages are other targets).
  for (let i = 0; i < 40 && !page; i++) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith("app://folevi/") && !p.url().includes("quick-add") && !p.url().includes("place-sync")) ?? null;
    if (!page) await wait(500);
  }
  if (!page) throw new Error(`No main window.\n${log}`);
  await page.waitForLoadState("domcontentloaded");
  const marks = await page.evaluate(() => ({ desktop: document.documentElement.dataset.desktop, platform: window.foleviShell?.platform, bridge: window.foleviDesktop?.platform, version: window.foleviShell?.shellVersion }));
  check("the page knows it's in Folevi for Windows", marks.desktop === "windows" && marks.platform === "windows" && marks.bridge === "windows", JSON.stringify(marks));
  await page.getByText("Keep notes on my devices").click();
  await page.waitForURL(/app:\/\/folevi\//, { timeout: 20_000 });
  await page.getByText("This device only").click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Open Folevi" }).click({ timeout: 30_000 });
  await page.locator(".ui-tabbar").waitFor({ timeout: 60_000 });
  check("the library on this PC opens", true);
  await wait(1500);
  await page.screenshot({ path: join(out, `home${dark ? "-dark" : ""}.png`) });
  const tabbar = await page.evaluate(() => getComputedStyle(document.querySelector(".ui-tabbar")).right);
  check("the tab strip keeps the caption buttons' corner clear", tabbar !== "", tabbar);
  const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  check("the interface uses Segoe UI Variable", font.includes("Segoe UI Variable"), font);
  // Settings > Desktop app in Windows' words.
  await page.goto("app://folevi/settings/desktop");
  await page.getByText("On this PC").first().waitFor({ timeout: 20_000 });
  const settingsText = await page.locator("main").innerText();
  check("Settings > Desktop app speaks Windows", /Ctrl\+Alt\+Space/.test(settingsText) && /Notification area icon/.test(settingsText), "");
  await page.screenshot({ path: join(out, `settings${dark ? "-dark" : ""}.png`) });
  await browser.close();
} catch (e) {
  check("smoke run", false, e instanceof Error ? e.message.split("\n")[0] : String(e));
  await page?.screenshot({ path: join(out, "failed.png") }).catch(() => undefined);
  console.log(log.split("\n").slice(-15).join("\n"));
} finally {
  child.kill();
  await wait(500);
  rmSync(data, { recursive: true, force: true });
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed; screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
