// Visual QA helper (not a test): captures key screens in light and dark at several widths.
// Usage: node e2e/visual.mjs <outDir>
// Signs in with a local test account (created on first run through sign-up, the development mailbox and
// two-step setup, then remembered in e2e/.visual-account.json, which is git-ignored). Local only.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { URL } from "node:url";
import { chromium } from "@playwright/test";
import { TOTP } from "otpauth";

const out = process.argv[2] ?? "/tmp/folevi-shots";
const APP = "http://app.localhost:3000";
const ACCOUNT_FILE = new URL("./.visual-account.json", import.meta.url);
const PASSWORD = "quiet folio visual password";
const browser = await chromium.launch();

const code = (secret) => new TOTP({ secret, digits: 6, period: 30 }).generate();

async function mailboxLink(request, email) {
  for (let i = 0; i < 40; i++) {
    const { messages } = await (await request.get(`${APP}/api/dev/mailbox?to=${encodeURIComponent(email)}`)).json();
    const hit = messages.find((m) => m.key === "auth_verify_email");
    if (hit) return hit.actionUrl;
    await sleep(250);
  }
  throw new Error("no verification email in the development mailbox");
}

async function createAccount(page) {
  const email = process.env.SHOT_EMAIL ?? "ada@example.com";
  await page.goto(`${APP}/signup`);
  await page.getByLabel("Your name").fill("Ada Example");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { name: "Check your inbox" }).waitFor({ timeout: 20_000 });
  await page.goto(await mailboxLink(page.context().request, email));
  await page.waitForURL((url) => !/\/(signup|verify-email)/.test(url.pathname), { timeout: 20_000 });
  // Two-step verification is optional; the visual account turns it on so it matches real sign-ins.
  await page.goto(`${APP}/two-factor/setup?returnTo=%2Fdocuments`);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  const secret = ((await page.getByTestId("totp-secret").textContent({ timeout: 20_000 })) ?? "").replace(/\s/g, "");
  await page.getByLabel("6-digit code").fill(code(secret));
  await page.getByRole("button", { name: "Turn on two-step verification" }).click();
  await page.getByRole("checkbox", { name: /I saved these codes/ }).check({ timeout: 20_000 });
  await page.getByRole("button", { name: "Continue to Folevi" }).click();
  await page.waitForURL(/\/documents/, { timeout: 20_000 });
  const account = { email, password: PASSWORD, totpSecret: secret };
  writeFileSync(ACCOUNT_FILE, JSON.stringify(account, null, 2));
  return account;
}

async function signIn(page, account) {
  await page.goto(`${APP}/signin`);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/two-factor(\?|$)/, { timeout: 20_000 });
  await page.getByLabel("6-digit code").fill(code(account.totpSecret));
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForURL((url) => !/\/(signin|two-factor)/.test(url.pathname), { timeout: 20_000 });
}

// One sign-in; every screenshot context reuses its cookies.
const setup = await browser.newContext();
const setupPage = await setup.newPage();
if (existsSync(ACCOUNT_FILE)) await signIn(setupPage, JSON.parse(readFileSync(ACCOUNT_FILE, "utf8")));
else await createAccount(setupPage);
const storageState = await setup.storageState();
await setup.close();

async function shoot(theme, width, height, label, paths) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, deviceScaleFactor: Number(process.env.SHOT_SCALE ?? 1), storageState });
  const page = await context.newPage();
  await page.addInitScript((t) => localStorage.setItem("folevi:appearance", t), theme);
  for (const [name, path] of paths) {
    await page.goto(`${APP}${path}`);
    await page.waitForTimeout(2500);
    // The Next.js dev-mode badge is not part of the product.
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.screenshot({ path: `${out}/${label}-${theme}-${width}-${name}.png` });
  }
  await context.close();
}
const paths = JSON.parse(process.env.SHOT_PATHS ?? '[["docs","/documents"]]');
for (const theme of (process.env.SHOT_THEMES ?? "light,dark").split(",")) {
  for (const w of (process.env.SHOT_WIDTHS ?? "1440").split(",").map(Number)) {
    await shoot(theme, w, w < 800 ? 844 : 900, "app", paths);
  }
}
await browser.close();
console.log("done");
