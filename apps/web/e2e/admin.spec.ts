import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { APP, completeOnboarding, createAccount, grantPlatformRole, newPersonWithWorkspace, pick, settle } from "./helpers";

// One fresh super admin per run (granted through the local-only testSupport function), reused by every
// test through its saved browser session so nobody signs in twice in the same authenticator window.
let adminState: Awaited<ReturnType<import("@playwright/test").BrowserContext["storageState"]>> | null = null;
let adminEmail = "";

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const { page, account } = await createAccount(context, { name: "Ada Example" });
  await completeOnboarding(page);
  grantPlatformRole(account.email, "super_admin");
  adminEmail = account.email;
  adminState = await context.storageState();
  await context.close();
});

async function adminPage(browser: Browser, path: string): Promise<Page> {
  const context = await browser.newContext({ storageState: adminState ?? undefined });
  const page = await context.newPage();
  await page.goto(`${APP}${path}`);
  await expect(page.getByRole("navigation", { name: "Admin" })).toBeVisible({ timeout: 30_000 });
  return page;
}

test("a signed-in person without a platform role gets a plain 404 at /admin", async ({ browser }) => {
  const { page, context } = await newPersonWithWorkspace(browser, "Not An Admin");
  const response = await page.goto(`${APP}/admin`);
  expect(response?.status()).toBe(404);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0);
  await expect(page.getByText(/audit log/i)).toHaveCount(0);
  // Deep links behave the same.
  const deep = await page.goto(`${APP}/admin/users`);
  expect(deep?.status()).toBe(404);
  await context.close();
});

test("signed-out visitors are sent to sign in", async ({ page }) => {
  await page.goto(`${APP}/admin`);
  await expect(page).toHaveURL(/\/signin\?returnTo=%2Fadmin/);
});

test("an admin sees the dashboard with aggregate metrics", async ({ browser }) => {
  const page = await adminPage(browser, "/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("recorded in the immutable audit log");
  await expect(page.getByText("Users", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("figure", { name: "Signups" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Retention by signup week" })).toBeVisible();
  await page.context().close();
});

test("user search and view are written to the audit log; suspending requires a reason", async ({ browser }) => {
  const target = await newPersonWithWorkspace(browser, "Audit Target");
  const page = await adminPage(browser, "/admin/users");

  // Search by exact email.
  await page.getByRole("searchbox", { name: "Email or name" }).fill(target.email);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: "Audit Target" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Audit Target" })).toBeVisible();
  const profileId = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);

  // The view appears in the audit log, filtered to this user.
  await page.getByRole("link", { name: "Audit log" }).click();
  await pick(page.getByRole("combobox", { name: "Target type" }), "profile");
  await page.getByRole("textbox", { name: "Target ID" }).fill(profileId);
  await page.getByRole("button", { name: "Apply" }).click();
  const log = page.getByRole("table", { name: `Audit entries for profile ${profileId}` });
  await expect(log.getByText("user.view").first()).toBeVisible();
  // …and the search itself is in the full log (the query is stored hashed).
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByRole("table", { name: "Audit entries, newest first" }).getByText("user.search").first()).toBeVisible();

  // Suspend: the dialog refuses to submit without a reason.
  await page.goto(`${APP}/admin/users/${profileId}`);
  await page.getByRole("button", { name: "Suspend…" }).click();
  const dialog = page.getByRole("dialog", { name: /Suspend Audit Target/ });
  await dialog.getByRole("textbox", { name: /Type .* to confirm/ }).fill(target.email);
  await dialog.getByRole("button", { name: "Suspend account" }).click();
  const reason = dialog.getByRole("textbox", { name: "Reason" });
  await expect(reason).toHaveAttribute("aria-invalid", "true");
  await expect(reason).toHaveAccessibleDescription(/Give a reason of at least 8 characters/);
  await expect(reason).toBeFocused();
  await expect(dialog).toBeVisible();
  await expect(page.getByText("Account suspended")).toHaveCount(0);

  // With a reason it goes through and is audited with that reason.
  await reason.fill("E2E: verifying the suspension flow");
  await dialog.getByRole("button", { name: "Suspend account" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Account suspended" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Admin audit history for this user" }).getByText("E2E: verifying the suspension flow")).toBeVisible();
  await expect(page.getByText("Suspended", { exact: true }).first()).toBeVisible();

  await page.context().close();
  await target.context.close();
});

test("listing workspaces is audited, and identity emails appear in the email log", async ({ browser }) => {
  const page = await adminPage(browser, "/admin/workspaces");
  await expect(page.getByRole("table", { name: "Workspaces, newest first" }).getByRole("link").first()).toBeVisible();
  await page.goto(`${APP}/admin/audit`);
  await expect(page.getByRole("table", { name: "Audit entries, newest first" }).getByText("workspace.list").first()).toBeVisible();

  // The admin's own sign-up verification email went through Folevi's pipeline, so it is in the log
  // (as a recipient hint only), with an honest status — never "delivered" without a webhook.
  await page.goto(`${APP}/admin/emails`);
  const table = page.getByRole("table", { name: "Email send attempts" });
  await expect(table.getByText("auth_verify_email").first()).toBeVisible();
  await expect(table.getByText(adminEmail)).toHaveCount(0);
  await expect(table.getByText(/delivered/i)).toHaveCount(0);
  await page.context().close();
});

test("an owner manages a person's plan and AI from their page; analytics and revenue load", async ({ browser }) => {
  const target = await newPersonWithWorkspace(browser, "Plan Target");
  const page = await adminPage(browser, "/admin/users");
  await page.getByRole("searchbox", { name: "Email or name" }).fill(target.email);
  await page.getByRole("button", { name: "Search" }).click();
  const row = page.getByRole("row").filter({ hasText: "Plan Target" });
  await expect(row.getByText("Free · trial")).toBeVisible();
  await row.getByRole("link", { name: "Plan Target" }).click();
  await expect(page.getByRole("heading", { name: "Plan & billing" })).toBeVisible();

  // Set Basic by hand (a comp), with a reason.
  await page.getByRole("button", { name: "Set plan…" }).click();
  let dialog = page.getByRole("dialog", { name: /Set .*plan/ });
  await pick(dialog.getByRole("combobox", { name: "Plan" }), "Basic — 20 GB");
  await dialog.getByRole("textbox", { name: "Reason" }).fill("E2E: comped for a support issue");
  await dialog.getByRole("button", { name: "Save plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Plan set to Basic" })).toBeVisible();

  // Grant AI.
  await page.getByRole("button", { name: /Grant AI…|AI access…/ }).click();
  dialog = page.getByRole("dialog", { name: /AI/ });
  await dialog.getByRole("textbox", { name: "Reason" }).fill("E2E: beta tester gets AI");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "AI access granted" })).toBeVisible();
  await expect(page.getByText("AI granted")).toBeVisible();

  // The person sees it in their settings.
  await target.page.goto(`${APP}/settings/billing`);
  await expect(target.page.getByText(/Included by the Folevi team/)).toBeVisible({ timeout: 30_000 });

  // Prepare an export for the person: delivered to them, never to staff.
  await page.getByRole("button", { name: "Prepare export for user…" }).click();
  dialog = page.getByRole("dialog", { name: /Prepare an export/ });
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("textbox", { name: "Reason" }).fill("E2E: user asked support for an export");
  await dialog.getByRole("button", { name: "Prepare export" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Export started/ })).toBeVisible();

  await page.getByRole("link", { name: "User analytics" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "User analytics" })).toBeVisible();
  await expect(page.getByRole("figure", { name: "Signups" })).toBeVisible();
  await page.getByRole("link", { name: "Revenue" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Revenue" })).toBeVisible();
  await expect(page.getByText("MRR", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("table", { name: "Net revenue by month" })).toBeVisible();
  await page.context().close();
  await target.context.close();
});

test("support staff see analytics but not revenue, and can't set plans", async ({ browser }) => {
  const staff = await newPersonWithWorkspace(browser, "Support Person");
  grantPlatformRole(staff.email, "support_admin");
  const page = staff.page;
  await page.goto(`${APP}/admin`);
  const nav = page.getByRole("navigation", { name: "Admin" });
  await expect(nav).toBeVisible({ timeout: 30_000 });
  await expect(nav.getByRole("link", { name: "User analytics" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Revenue" })).toHaveCount(0);
  await expect(page.getByText("Support staff").first()).toBeVisible();
  await page.goto(`${APP}/admin/users?q=`);
  await page.getByRole("searchbox", { name: "Email or name" }).fill(staff.email);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: "Support Person" }).click();
  await expect(page.getByRole("button", { name: "Set plan…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Extend trial…|Give Pro trial…/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Suspend…" })).toBeDisabled();
  await staff.context.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`admin pages have no serious accessibility violations (${scheme})`, async ({ browser }) => {
    // Nine pages, each compiled on first visit in CI's dev server and scanned by axe.
    test.setTimeout(240_000);
    const page = await adminPage(browser, "/admin");
    await page.evaluate((s) => localStorage.setItem("folevi:appearance", s), scheme);
    for (const path of ["/admin", "/admin/users?q=", "/admin/workspaces", "/admin/emails", "/admin/audit", "/admin/deletion-jobs", "/admin/configuration", "/admin/analytics", "/admin/revenue"]) {
      await page.goto(`${APP}${path}`);
      await expect(page.getByRole("navigation", { name: "Admin" })).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(1500);
      await settle(page);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${path}: ${v.id} — ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    }
    await page.context().close();
  });
}
