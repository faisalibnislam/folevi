#!/usr/bin/env node
// Phase 0 spike: a browser walk through Folevi on a self-hosted backend, with a throwaway account.
// Run from apps/web (where Playwright is installed):
//   cd apps/web && APP=http://localhost:3500 SHOTS=/some/folder node ../../scripts/self-host/smoke.mjs [step...]
// Steps: signup signin notes search upload share ai (default: all). Each step prints what happened;
// failures are printed and the walk continues. Writes nothing outside SHOTS.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

// Playwright is a dependency of apps/web, not of the repo root.
const { chromium } = createRequire(new URL("../../apps/web/package.json", import.meta.url))("@playwright/test");

const APP = (process.env.APP ?? "http://localhost:3500").replace(/\/$/, "");
const SHOTS = process.env.SHOTS ?? "/tmp";
mkdirSync(SHOTS, { recursive: true });
const steps = process.argv.slice(2);
const want = (s) => steps.length === 0 || steps.includes(s);
// The throwaway account is kept in SHOTS/state.json between runs, so later steps can sign in again.
const saved = existsSync(`${SHOTS}/state.json`) && !steps.includes("signup") ? JSON.parse(readFileSync(`${SHOTS}/state.json`, "utf8")) : {};
const email = saved.email ?? `phase0-${Date.now()}@example.com`;
const password = saved.password ?? `pw-${randomBytes(9).toString("hex")}`;
const results = [];
const log = (step, ok, note) => {
  results.push({ step, ok, note });
  console.log(`${ok ? "PASS" : "FAIL"} ${step}: ${note}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 300)));
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`));
const badResponses = [];
page.on("response", (r) => r.status() >= 400 && badResponses.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 160)}`));
const shot = async (name) => page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {});
const headings = async () => (await page.getByRole("heading").allTextContents().catch(() => [])).slice(0, 5).join(" | ");

async function run(step, fn) {
  if (!want(step)) return;
  try {
    await fn();
  } catch (e) {
    log(step, false, `${String(e.message ?? e).split("\n")[0].slice(0, 300)} (url ${page.url()}, headings: ${await headings()})`);
    await shot(`fail-${step}`);
  }
}

await run("signup", async () => {
  await page.goto(`${APP}/signup`);
  await page.getByLabel("Your name").fill("Phase Zero");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForTimeout(4000);
  await shot("signup");
  log("signup", !/\/signup/.test(new URL(page.url()).pathname), `landed on ${page.url()} (headings: ${await headings()})`);
});

await run("signin", async () => {
  await context.clearCookies();
  await page.goto(`${APP}/signin`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !/\/signin/.test(u.pathname), { timeout: 20_000 });
  await page.waitForTimeout(3000);
  const skip = page.getByRole("button", { name: "Skip setup" });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.waitForTimeout(2000);
  await shot("signin");
  log("signin", true, `landed on ${page.url()} (headings: ${await headings()})`);
});

// 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const word = `zebrafjord${Date.now().toString(36)}`;
const saved_ = async () =>
  page.getByTestId("sync-status").waitFor({ state: "attached", timeout: 20_000 }).then(async () => {
    for (let i = 0; i < 40 && (await page.getByTestId("sync-status").getAttribute("data-status")) !== "saved"; i++) await page.waitForTimeout(500);
    return page.getByTestId("sync-status").getAttribute("data-status");
  });
let noteUrl = "";

/** On a note, the sidebar shows the page's own contents; switch it to the folders view (as e2e/helpers.ts does). */
async function showFolders() {
  if (!/\/d\/[0-9A-Z]{26}/.test(page.url())) return;
  await page.getByRole("button", { name: "Sidebar", exact: true }).click({ timeout: 10_000 });
  await page.getByRole("menuitemradio", { name: "Show folders" }).click({ timeout: 5000 });
  await page.getByRole("navigation", { name: "Folio" }).waitFor({ timeout: 10_000 });
}

async function ensureApp() {
  if (!/\/(documents|d\/)/.test(page.url())) await page.goto(`${APP}/documents`);
  const open = page.getByRole("button", { name: /^Open “Welcome to Folevi”/ });
  if (await open.isVisible({ timeout: 3000 }).catch(() => false)) await open.click();
  await page.getByRole("button", { name: "New note", exact: true }).first().waitFor({ timeout: 30_000 });
}

/** The note made by the notes step, or (when run alone) the first "Self-host note" on Home. */
async function openNote() {
  if (noteUrl) return void (await page.goto(noteUrl));
  await ensureApp();
  await page.goto(`${APP}/documents`);
  await page.getByRole("link", { name: /Self-host note/ }).first().click({ timeout: 20_000 });
  await page.waitForURL(/\/d\/[0-9A-Z]{26}/, { timeout: 20_000 });
  noteUrl = page.url().replace(/\?.*$/, "");
}

await run("notes", async () => {
  await ensureApp();
  await page.getByRole("button", { name: "New note", exact: true }).first().click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}/, { timeout: 20_000 });
  noteUrl = page.url().replace(/\?.*$/, "");
  await page.getByRole("textbox", { name: "Title" }).fill("Self-host note");
  await page.keyboard.press("Enter");
  await page.keyboard.type(`The ${word} sails at nine.`);
  const status = await saved_();
  await page.reload();
  await page.getByRole("textbox", { name: "Document body" }).waitFor({ timeout: 20_000 });
  const body = await page.getByRole("textbox", { name: "Document body" }).textContent();
  log("notes", status === "saved" && body.includes(word), `note saved (${status}), body after reload has the word: ${body.includes(word)}`);
  await showFolders();
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Phase zero folder");
  await page.getByRole("button", { name: "Create folder" }).click();
  const nav = page.getByRole("navigation", { name: "Folio" });
  await nav.getByRole("link", { name: "Phase zero folder", exact: true }).first().waitFor({ timeout: 15_000 });
  await shot("folder-before-reload");
  await page.reload();
  await page.waitForTimeout(3000);
  await shot("folder-after-reload");
  await showFolders();
  const there = await nav.getByRole("link", { name: "Phase zero folder", exact: true }).first().isVisible({ timeout: 15_000 }).catch(() => false);
  await shot("notes");
  log("folders", there, `folder created and still there after reload: ${there}`);
});

await run("search", async () => {
  await openNote();
  await page.getByRole("textbox", { name: "Document body" }).waitFor({ timeout: 20_000 });
  await page.keyboard.press("Meta+k");
  const input = page.getByRole("combobox", { name: /Search notes/ });
  await input.waitFor({ timeout: 10_000 });
  const palette = page.getByRole("dialog", { name: "Search and commands" });
  const t0 = Date.now();
  let found = false;
  while (!found && Date.now() - t0 < 30_000) {
    await input.fill("");
    await input.fill(word);
    found = await palette.getByRole("option").filter({ hasText: "Self-host note" }).first().isVisible({ timeout: 2000 }).catch(() => false);
  }
  await shot("search");
  log("search", found, `full-text search for a word in the body found the note: ${found} (${Date.now() - t0} ms)`);
  await page.keyboard.press("Escape");
});

await run("upload", async () => {
  await openNote();
  const body = page.getByRole("textbox", { name: "Document body" });
  await body.waitFor({ timeout: 20_000 });
  await body.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/image");
  const chooser = page.waitForEvent("filechooser", { timeout: 10_000 });
  await page.keyboard.press("Enter");
  await (await chooser).setFiles({ name: "dot.png", mimeType: "image/png", buffer: PNG });
  const img = page.locator(".fb-editor img").first();
  let src = "";
  for (let i = 0; i < 40 && !/\/files\//.test(src); i++) {
    await page.waitForTimeout(500);
    src = (await img.getAttribute("src").catch(() => "")) ?? "";
  }
  await saved_();
  await page.reload();
  await page.locator(".fb-editor img").first().waitFor({ timeout: 20_000 });
  src = (await page.locator(".fb-editor img").first().getAttribute("src")) ?? "";
  const loaded = await page.locator(".fb-editor img").first().evaluate((el) => el.complete && el.naturalWidth > 0).catch(() => false);
  const fetched = src.startsWith("http") ? await page.request.get(src) : null;
  await shot("upload");
  log("upload", /\/files\//.test(src) && loaded, `image src ${src.replace(/sig=[^&]+/, "sig=…").slice(0, 140)}; decoded in page: ${loaded}; direct GET: ${fetched?.status()} ${fetched?.headers()["content-type"]}`);
});

await run("share", async () => {
  await openNote();
  await page.getByRole("textbox", { name: "Document body" }).waitFor({ timeout: 20_000 });
  await page.getByRole("group", { name: "Page" }).getByRole("button", { name: /^Share/ }).click();
  const share = page.getByRole("dialog", { name: /Share/ });
  await share.getByRole("switch", { name: "Public link" }).click();
  await page.waitForTimeout(1500);
  const link = await share.getByLabel("Public link address").inputValue();
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(link);
  const h1 = anonPage.getByRole("heading", { level: 1 }).first();
  const ok = await h1.isVisible({ timeout: 20_000 }).catch(() => false);
  const sharedTitle = ok ? await h1.textContent() : "";
  const imgOk = await anonPage.locator("img").filter({ has: anonPage.locator("xpath=self::*[contains(@src,'/files/')]") }).count().catch(() => 0);
  await anonPage.screenshot({ path: `${SHOTS}/share-anon.png` });
  await anon.close();
  log("share", ok, `public link ${link.replace(/\/s\/.*/, "/s/…")} opened signed-out: ${ok} (title "${sharedTitle}"); images from /files/ on it: ${imgOk}`);
});

await run("ai", async () => {
  await openNote();
  await page.getByRole("textbox", { name: "Document body" }).waitFor({ timeout: 20_000 });
  // The note's Foli AI panel (Write tab): ask it to write something, which needs the model.
  const button = page.getByRole("toolbar", { name: "Page tools" }).getByRole("button", { name: "Foli AI", exact: true });
  const shown = await button.isVisible({ timeout: 15_000 }).catch(() => false);
  let answer = "";
  if (shown) {
    if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
    const box = page.getByPlaceholder(/Write a friendly intro/);
    await box.fill("Write one sentence about ferries.");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(10_000);
    const panel = page.locator("aside, [role=complementary], [role=region]").filter({ has: page.getByText("FOR THIS NOTE", { exact: false }) }).first();
    answer = ((await panel.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").slice(0, 400);
    const alerts = (await page.getByRole("alert").allTextContents().catch(() => [])).join(" | ");
    const status = (await page.getByRole("status").allTextContents().catch(() => [])).join(" | ");
    answer = `alerts: ${alerts || "-"}; status: ${status || "-"}; panel: ${answer}`;
  }
  await shot("ai");
  log("ai", true, `Foli AI button shown: ${shown}; after asking: ${answer || "(none)"}`);
});

writeFileSync(`${SHOTS}/state.json`, JSON.stringify({ email, password }));
await context.storageState({ path: `${SHOTS}/storage.json` });
console.log(`console errors (${consoleErrors.length}):\n  ${[...new Set(consoleErrors)].slice(0, 15).join("\n  ")}`);
console.log(`HTTP >= 400 (${badResponses.length}):\n  ${[...new Set(badResponses)].slice(0, 15).join("\n  ")}`);
await browser.close();
