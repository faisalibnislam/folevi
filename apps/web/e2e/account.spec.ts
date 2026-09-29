import { expect, test } from "@playwright/test";
import {
  APP,
  PASSWORD,
  completeOnboarding,
  confirmEmail,
  createAccount,
  enrollTwoFactor,
  mailboxLink,
  newPerson,
  signIn,
  signUp,
  totpCode,
  uniqueEmail,
} from "./helpers";

test("sign-up requires a confirmed email before signing in", async ({ page }) => {
  const email = uniqueEmail("unverified");
  await signUp(page, { email, name: "Unverified Person" });
  await page.goto(`${APP}/signin`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Verify your email address first" })).toBeVisible();
  // Signing in unverified re-sends the link; confirming it signs them straight in (no two-step setup).
  await confirmEmail(page, email);
  await expect(page.getByRole("heading", { name: "Protect your account" })).toHaveCount(0);
});

test("two-step verification is optional: use Folevi without it, turn it on and off in Settings", async ({ page }) => {
  const email = uniqueEmail("nomfa");
  await signUp(page, { email, name: "No Second Factor" });
  await confirmEmail(page, email);
  await completeOnboarding(page);

  await page.goto(`${APP}/settings/security`);
  await expect(page.getByText("Off", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Turn on two-step verification" }).click();
  await expect(page.getByRole("heading", { name: "Protect your account" })).toBeVisible();
  await page.getByRole("link", { name: "Not now" }).click();
  await page.waitForURL(/\/settings\/security/);

  await page.getByRole("button", { name: "Turn on two-step verification" }).click();
  await enrollTwoFactor(page, { onPage: true });
  await page.waitForURL(/\/settings\/security/);
  await expect(page.getByText("On (authenticator app)")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Turn off" }).click();
  const dialog = page.getByRole("dialog", { name: "Turn off two-step verification?" });
  await dialog.getByLabel("Current password").fill(PASSWORD);
  await dialog.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByText("Off", { exact: true })).toBeVisible({ timeout: 20_000 });
});

test("signed-out visitors are sent to sign in, and product URLs keep their return path", async ({ page }) => {
  await page.goto("/tasks/today");
  await expect(page).toHaveURL(/\/signin\?returnTo=%2Ftasks%2Ftoday/);
});

test("sign-in: generic errors, authenticator code, single-use backup codes, trusted device", async ({ browser }) => {
  const first = await browser.newContext();
  const { page: firstPage, account } = await createAccount(first, { name: "Code Person" });
  await completeOnboarding(firstPage);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${APP}/signin`);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill("not the password at all");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "incorrect" })).toHaveText("The email or password is incorrect.");
  // Same message for an address that has no account (no enumeration).
  await page.getByLabel("Email").fill(uniqueEmail("nobody"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "incorrect" })).toHaveText("The email or password is incorrect.");

  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/two-factor\?/);
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "code" })).toContainText("That code didn't work");
  // A backup code works once…
  await page.getByRole("button", { name: "Use a backup code instead" }).click();
  await page.getByLabel("Backup code").fill(account.backupCodes[0]!);
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForURL(/\/documents/);
  await ctx.close();

  // …and never again.
  const again = await browser.newContext();
  const p2 = await again.newPage();
  await p2.goto(`${APP}/signin`);
  await p2.getByLabel("Email").fill(account.email);
  await p2.getByLabel("Password", { exact: true }).fill(account.password);
  await p2.getByRole("button", { name: "Sign in" }).click();
  await p2.waitForURL(/\/two-factor\?/);
  await p2.getByRole("button", { name: "Use a backup code instead" }).click();
  await p2.getByLabel("Backup code").fill(account.backupCodes[0]!);
  await p2.getByRole("button", { name: "Verify" }).click();
  await expect(p2.getByRole("alert").filter({ hasText: "code" })).toContainText("backup code didn't work");

  // Trusting the device skips the code on the next sign-in in that browser.
  await p2.getByRole("button", { name: "Use my authenticator app" }).click();
  await p2.getByLabel("6-digit code").fill(totpCode(account.totpSecret));
  await p2.getByRole("checkbox", { name: /Trust this device/ }).check();
  await p2.getByRole("button", { name: "Verify" }).click();
  await p2.waitForURL(/\/documents/);
  await p2.goto(`${APP}/settings/account`);
  await p2.getByRole("navigation", { name: "Folio" }).getByRole("button", { name: /Personal, workspaces and account$/ }).click();
  await p2.getByRole("menuitem", { name: "Sign out" }).click();
  await p2.waitForURL(/\/signin/);
  await p2.getByLabel("Email").fill(account.email);
  await p2.getByLabel("Password", { exact: true }).fill(account.password);
  await p2.getByRole("button", { name: "Sign in" }).click();
  await p2.waitForURL((url) => !/\/(signin|two-factor)/.test(url.pathname));
});

test("sessions can be listed and revoked, and a revoked session stops working at once", async ({ browser }) => {
  const { page: pageA, account } = await newPerson(browser, "Session Person");
  const b = await browser.newContext();
  const pageB = await signIn(b, account);
  await pageB.goto(`${APP}/documents`);
  await expect(pageB.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();

  await pageA.goto(`${APP}/settings/devices`);
  await expect(pageA.getByText("2 devices connected")).toBeVisible();
  const other = pageA.getByRole("listitem").filter({ hasNotText: "This device" }).filter({ has: pageA.getByRole("button", { name: /^Sign out / }) });
  await expect(other).toHaveCount(1);
  await other.first().getByRole("button", { name: /^Sign out / }).click();
  await expect(pageA.getByRole("status").filter({ hasText: "Device signed out" })).toBeVisible();
  // The open tab on B is signed out without a reload: its live queries fail and it goes to sign in.
  await pageB.waitForURL(/\/signin\?notice=session_ended/, { timeout: 20_000 });
  await expect(pageB.getByText("Your session ended")).toBeVisible();
});

test("forgotten password: reset by email, other sessions end, sign in with the new password", async ({ browser }) => {
  const { page: pageA, account } = await newPerson(browser, "Reset Person");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${APP}/forgot-password`);
  await page.getByLabel("Email").fill(account.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("a reset link is on its way");
  await page.goto(await mailboxLink(ctx.request, account.email, "auth_password_reset"));
  await page.waitForURL(/\/reset-password\?token=/);
  const newPassword = "a brand new folio password";
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Repeat new password").fill(newPassword);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible();
  // The session that was open elsewhere has ended.
  await pageA.reload();
  await pageA.waitForURL(/\/signin/, { timeout: 20_000 });
  const fresh = await signIn(await browser.newContext(), { ...account, password: newPassword });
  await expect(fresh).toHaveURL(/\/documents/);
});

test("settings: change password, new backup codes, move to a new authenticator", async ({ browser }) => {
  const { page, account } = await newPerson(browser, "Settings Person");
  await page.goto(`${APP}/settings/security`);
  await expect(page.getByText("On (authenticator app)")).toBeVisible();

  await page.getByRole("button", { name: "Get new backup codes" }).click();
  await page.getByRole("dialog").getByLabel("Current password").fill(account.password);
  await page.getByRole("button", { name: "Create new codes" }).click();
  await expect(page.getByRole("list", { name: "Backup codes" }).locator("li")).toHaveCount(10);
  const codes = await page.getByRole("list", { name: "Backup codes" }).locator("li").allTextContents();
  expect(codes).toHaveLength(10);
  expect(codes).not.toContain(account.backupCodes[0]);
  await page.getByRole("checkbox", { name: /I saved these codes/ }).check();
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Move to a new authenticator app" }).click();
  await page.getByRole("dialog").getByLabel("Current password").fill(account.password);
  await page.getByRole("button", { name: "Show my key" }).click();
  await expect(page.getByTestId("totp-secret")).toHaveText(account.totpSecret.replace(/(.{4})/g, "$1 ").trim());
  await page.getByRole("button", { name: "Done" }).click();

  const newPassword = "another quiet folio password";
  await page.getByLabel("Current password").fill(account.password);
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Repeat new password").fill(newPassword);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Password changed" })).toBeVisible();
  // Still signed in here; the new password works for new sign-ins.
  await page.goto(`${APP}/documents`);
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  const other = await signIn(await browser.newContext(), { ...account, password: newPassword });
  await expect(other).toHaveURL(/\/documents/);
});

test("onboarding runs once for a new account", async ({ browser }) => {
  const ctx = await browser.newContext();
  const { page } = await createAccount(ctx, { name: "Onboarding Person" });
  await completeOnboarding(page);
  await page.goto(`${APP}/documents`);
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
});
