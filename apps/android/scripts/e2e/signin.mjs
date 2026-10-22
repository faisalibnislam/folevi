#!/usr/bin/env node
// Signs the Android app on an emulator in to an account on the local dev server, the way a person would:
// "Sign in to Folevi" in the app, the website's sign-in in the Custom Tab (tapped and typed through UI Automator,
// ui.mjs), Continue on /connect, back in the app signed in. Debug builds and the dev server only.
//
//   node scripts/e2e/signin.mjs [serial] [--account <file>]
// Without --account it makes a new verified account on the dev server first (sign up, the dev mailbox's
// confirmation link) and writes it to apps/android/.e2e-account.json (git-ignored) for the other checks.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { evaluate } from "../emulator.mjs";
import { fill, find, has, key, sleep, tapText } from "./ui.mjs";

const require = createRequire(resolve(import.meta.dirname, "../../../web/package.json"));
const { chromium } = require("@playwright/test");

export const APP = process.env.E2E_BASE_URL ?? "http://app.localhost:3002";
const accountFile = resolve(import.meta.dirname, "../../.e2e-account.json");

/** A new verified account on the dev server (no two-step verification). */
export async function makeAccount() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const email = `android-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = `android folio ${Math.random().toString(36).slice(2, 10)} test`;
  await page.goto(`${APP}/signup`);
  await page.getByLabel("Your name").fill("Android Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { name: "Check your inbox" }).waitFor({ timeout: 30_000 });
  let link = null;
  for (let i = 0; i < 60 && !link; i++) {
    const res = await page.request.get(`${APP}/api/dev/mailbox?to=${encodeURIComponent(email)}`);
    const { messages } = await res.json();
    link = messages.find((m) => m.key === "auth_verify_email")?.actionUrl ?? null;
    if (!link) await sleep(300);
  }
  if (!link) throw new Error("no confirmation email");
  const u = new URL(link);
  u.port = new URL(APP).port;
  await page.goto(u.toString());
  await page.waitForURL((url) => !/^\/(signin|signup|verify-email)/.test(url.pathname), { timeout: 30_000 });
  await browser.close();
  const account = { email, password, name: "Android Tester" };
  writeFileSync(accountFile, `${JSON.stringify(account, null, 2)}\n`, { mode: 0o600 });
  return account;
}

/** Chrome's own prompts on a fresh emulator (notifications, sign-in to Chrome): declined. */
async function declineChromePrompts(serial) {
  for (const label of ["No thanks", "Use without an account", "No, thanks"]) if (await has(serial, label)) await tapText(serial, label);
}

export async function signIn(serial, account) {
  // What "Sign in to Folevi" (the first-launch choice, Settings > Account) runs.
  await evaluate(serial, "window.__signedIn = null; window.foleviShell.auth.signIn().then(ok => (window.__signedIn = ok)); return true");
  await sleep(4000);
  await declineChromePrompts(serial);
  // The website in the Custom Tab: /signin first when the browser has no session, then /connect.
  const first = await Promise.race([find(serial, "Welcome back", 40_000).then(() => "signin"), find(serial, "Continue", 40_000).then(() => "connect")]);
  if (first === "signin") {
    await fill(serial, "Email", account.email);
    await fill(serial, "Password", account.password);
    // Enter in the password field sends the form.
    key(serial, "KEYCODE_ENTER");
    await declineChromePrompts(serial);
  }
  await find(serial, /^Sign in to Folevi for Android/, 40_000);
  await tapText(serial, "Continue");
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const signed = await evaluate(serial, "return window.__signedIn ?? null").catch(() => null);
    if (signed === true || signed === false) return signed;
  }
  return false;
}

if (import.meta.main ?? process.argv[1] === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2);
  const serial = args.find((a) => !a.startsWith("--") && !a.endsWith(".json")) ?? "emulator-5554";
  const i = args.indexOf("--account");
  const account = i >= 0 ? JSON.parse(readFileSync(args[i + 1], "utf8")) : existsSync(accountFile) && args.includes("--reuse") ? JSON.parse(readFileSync(accountFile, "utf8")) : await makeAccount();
  const ok = await signIn(serial, account);
  console.log(ok ? `signed in as ${account.email.replace(/^(.{6}).*@/, "$1…@")}` : "sign-in didn't finish");
  process.exit(ok ? 0 : 1);
}
