import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { APP, completeOnboarding, createAccount, createWorkspace, grantPlatformRole, newPerson, pick, settle, switchTo } from "./helpers";

// One fresh super admin per run (granted through the local-only testSupport function), reused by every
// test through its saved browser session so nobody signs in twice in the same authenticator window.
let adminState: Awaited<ReturnType<import("@playwright/test").BrowserContext["storageState"]>> | null = null;
let adminEmail = "";

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const { page, account } = await createAccount(context, { name: "Ada Example" });
  await completeOnboarding(page);
  // A team workspace, so the workspaces list has one (Personal isn't a workspace and isn't listed).
  await createWorkspace(page, "Ada Studio");
  await switchTo(page, "Personal");
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
  const { page, context } = await newPerson(browser, "Not An Admin");
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
  const target = await newPerson(browser, "Audit Target");
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
  // (as a recipient hint only), with an honest status (never "delivered" without a webhook).
  await page.goto(`${APP}/admin/emails`);
  const table = page.getByRole("table", { name: "Email send attempts" });
  await expect(table.getByText("auth_verify_email").first()).toBeVisible();
  await expect(table.getByText(adminEmail)).toHaveCount(0);
  await expect(table.getByText(/delivered/i)).toHaveCount(0);
  await page.context().close();
});

test("an admin upgrades a person straight from the users list (reason required, audited)", async ({ browser }) => {
  const target = await newPerson(browser, "List Upgrade");
  const page = await adminPage(browser, "/admin/users");
  await page.getByRole("searchbox", { name: "Email or name" }).fill(target.email);
  await page.getByRole("button", { name: "Search" }).click();
  const row = page.getByRole("row").filter({ hasText: "List Upgrade" });
  await expect(row.getByText("Free · trial")).toBeVisible();

  // The row's Upgrade opens the plan dialog right there.
  await row.getByRole("button", { name: "Upgrade for List Upgrade" }).click();
  const dialog = page.getByRole("dialog", { name: "Change plan for List Upgrade" });
  await expect(dialog).toContainText("Currently Free");
  // The four plans, in order.
  await expect(dialog.getByRole("radio")).toHaveCount(4);
  await dialog.getByRole("radio", { name: "Pro", exact: true }).check();
  await dialog.getByRole("button", { name: "Yearly" }).click();
  await pick(dialog.getByRole("combobox", { name: "Ends" }), "In 3 months");
  const changes = dialog.getByRole("region", { name: "What changes" });
  await expect(changes).toContainText("Pro, yearly");
  await expect(changes).toContainText("20 GB");
  await expect(changes).toContainText("180 a month");
  await settle(page);
  const scan = await new AxeBuilder({ page }).include("dialog[open]").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(scan.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  // No reason, no change.
  await dialog.getByRole("button", { name: "Upgrade to Pro" }).click();
  const reason = dialog.getByRole("textbox", { name: "Reason" });
  await expect(reason).toHaveAttribute("aria-invalid", "true");
  await expect(reason).toBeFocused();
  await reason.fill("E2E: upgraded from the users list");
  await dialog.getByRole("button", { name: "Upgrade to Pro" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Plan set to Pro, yearly" })).toBeVisible();
  await expect(dialog).toBeHidden();

  // The list shows the new plan, and the row now offers Change plan; reopening it changes nothing yet.
  await expect(row.getByText("Pro", { exact: true })).toBeVisible();
  await expect(row.getByText(/Yearly · ends /)).toBeVisible();
  await row.getByRole("button", { name: "Change plan for List Upgrade" }).click();
  await expect(dialog.getByRole("radio", { name: "Pro", exact: true })).toBeChecked();
  await expect(dialog.getByRole("button", { name: "Save plan" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // The change is in the person's admin history with its reason.
  await row.getByRole("link", { name: "List Upgrade" }).click();
  const history = page.getByRole("table", { name: "Admin audit history for this user" });
  await expect(history.getByText("billing.set_plan")).toBeVisible();
  await expect(history.getByText("E2E: upgraded from the users list")).toBeVisible();
  await page.context().close();
  await target.context.close();
});

test("an owner manages a person's plan and AI credits from their page; analytics and revenue load", async ({ browser }) => {
  const target = await newPerson(browser, "Plan Target");
  const page = await adminPage(browser, "/admin/users");
  await page.getByRole("searchbox", { name: "Email or name" }).fill(target.email);
  await page.getByRole("button", { name: "Search" }).click();
  const row = page.getByRole("row").filter({ hasText: "Plan Target" });
  await expect(row.getByText("Free · trial")).toBeVisible();
  await row.getByRole("link", { name: "Plan Target" }).click();
  await expect(page.getByRole("heading", { name: "Plan & billing" })).toBeVisible();

  // Set Pro AI by hand (a comp) from the page's own Upgrade button, with a reason.
  await page.getByRole("button", { name: "Upgrade", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Change plan for Plan Target" });
  await dialog.getByRole("radio", { name: "Pro AI", exact: true }).check();
  await expect(dialog.getByRole("region", { name: "What changes" })).toContainText("550 a month");
  await dialog.getByRole("textbox", { name: "Reason" }).fill("E2E: comped for a support issue");
  await dialog.getByRole("button", { name: "Upgrade to Pro AI" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Plan set to Pro AI, monthly" })).toBeVisible();
  // Now on a paid plan, the same button changes it.
  await expect(page.getByRole("button", { name: "Change plan", exact: true })).toBeEnabled();

  // Grant AI credits: a reason is required, and the grant shows with its expiry.
  await page.getByRole("button", { name: "Grant credits…" }).click();
  dialog = page.getByRole("dialog", { name: "Grant AI credits to Plan Target" });
  await expect(dialog.getByRole("spinbutton", { name: "Lasts" })).toHaveValue("12");
  await dialog.getByRole("spinbutton", { name: "Credits" }).fill("20000");
  await dialog.getByRole("button", { name: "Grant credits" }).click();
  await expect(dialog.getByRole("spinbutton", { name: "Credits" })).toHaveAttribute("aria-invalid", "true");
  await dialog.getByRole("spinbutton", { name: "Credits" }).fill("500");
  await dialog.getByRole("button", { name: "Grant credits" }).click();
  const creditReason = dialog.getByRole("textbox", { name: "Reason" });
  await expect(creditReason).toHaveAttribute("aria-invalid", "true");
  await creditReason.fill("E2E: beta tester gets extra credits");
  await dialog.getByRole("button", { name: "Grant credits" }).click();
  await expect(page.getByRole("status").filter({ hasText: "500 AI credits granted" })).toBeVisible();
  await expect(dialog).toBeHidden();
  const grants = page.getByRole("table", { name: "AI credit packs and grants" });
  const grantRow = grants.getByRole("row").filter({ hasText: "Granted" }).first();
  await expect(grantRow).toContainText("Personal");
  await expect(grantRow).toContainText("500 of 500");
  await expect(grantRow).toContainText("Active");
  await page.getByRole("button", { name: /^Reload user/ }).click();
  await expect(page.getByRole("table", { name: "Admin audit history for this user" }).getByText("E2E: beta tester gets extra credits")).toBeVisible();

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

test("an admin puts a workspace on Pro by hand (audited), and its plan, seats and payments show", async ({ browser }) => {
  const page = await adminPage(browser, "/admin/workspaces");
  await page.getByRole("table", { name: "Workspaces, newest first" }).getByRole("link", { name: "Ada Studio" }).first().click();
  await expect(page.getByRole("heading", { name: "Plan & billing" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Workspace Free").first()).toBeVisible();

  await page.getByRole("button", { name: "Upgrade", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Change plan for Ada Studio" });
  await expect(dialog.getByRole("radio")).toHaveCount(4);
  await dialog.getByRole("radio", { name: "Pro", exact: true }).check();
  const changes = dialog.getByRole("region", { name: "What changes" });
  await expect(changes).toContainText("1 seat × $4.99 = $4.99 / month, not billed");
  await expect(changes).toContainText("20 GB per member");
  await dialog.getByRole("textbox", { name: "Reason" }).fill("E2E: comped Pro for a design partner");
  await dialog.getByRole("button", { name: "Upgrade to Pro" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Plan set to Workspace Pro, monthly" })).toBeVisible();
  await expect(page.getByText("Workspace Pro").first()).toBeVisible();
  await expect(page.getByText("1 × $4.99 = $4.99/month")).toBeVisible();
  await expect(page.getByRole("table", { name: "Workspace payments" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Admin audit history for this workspace" }).getByText("billing.set_workspace_plan").first()).toBeVisible();
  // The workspaces list shows the plan too, with Change plan on the row.
  await page.getByRole("link", { name: "Up to Workspaces" }).click();
  const wsRow = page.getByRole("table", { name: "Workspaces, newest first" }).getByRole("row").filter({ hasText: "Ada Studio" }).first();
  await expect(wsRow.getByText("Workspace Pro", { exact: true })).toBeVisible();
  await expect(wsRow.getByRole("button", { name: "Change plan for Ada Studio" })).toBeEnabled();

  // The workspace's owner sees it in the workspace's Plan & billing; their Personal plan is unchanged.
  const owner = await browser.newContext({ storageState: adminState ?? undefined });
  const ownerPage = await owner.newPage();
  await ownerPage.goto(`${APP}/documents`);
  await switchTo(ownerPage, "Ada Studio");
  await ownerPage.goto(`${APP}/settings/workspace-billing`);
  await expect(ownerPage.getByText("Set by the Folevi team.")).toBeVisible({ timeout: 30_000 });
  await switchTo(ownerPage, "Personal");
  await ownerPage.goto(`${APP}/settings/billing`);
  await expect(ownerPage.getByRole("heading", { name: "Choose a personal plan" })).toBeVisible({ timeout: 30_000 });
  await expect(ownerPage.getByRole("region", { name: "Team plan" })).toHaveCount(0);
  await owner.close();
  await page.context().close();
});

test("the owner sees Billing setup: Polar's connection and all 14 products, not created while Polar isn't set up", async ({ browser }) => {
  const page = await adminPage(browser, "/admin");
  await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Billing setup" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Billing setup" })).toBeVisible({ timeout: 30_000 });
  // This backend has no Polar settings: nothing is (or can be) sent to Polar from here.
  await expect(page.getByText("Polar isn't connected on this server")).toBeVisible();
  const connection = page.getByRole("region", { name: "Polar connection" });
  await expect(connection.getByText("Sandbox", { exact: true })).toBeVisible();
  await expect(connection.getByText("Not set", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Check Polar…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Create missing products…" })).toBeDisabled();
  const products = page.getByRole("table", { name: "Polar products" });
  await expect(products.getByRole("row")).toHaveCount(15);
  await expect(products.getByText("Not created")).toHaveCount(14);
  await expect(products.getByRole("rowheader", { name: /Folevi Core \(monthly\)/ })).toBeVisible();
  await expect(products.getByRole("row", { name: /Folevi Team Pro AI \(yearly\)/ })).toContainText("$149 per seat a year");
  await expect(products.getByRole("row", { name: /Folevi AI credits: 1,000/ })).toContainText("$14.99 once");
  await page.context().close();
});

test("support staff see analytics but not revenue, and can't set plans", async ({ browser }) => {
  const staff = await newPerson(browser, "Support Person");
  grantPlatformRole(staff.email, "support_admin");
  const page = staff.page;
  await page.goto(`${APP}/admin`);
  const nav = page.getByRole("navigation", { name: "Admin" });
  await expect(nav).toBeVisible({ timeout: 30_000 });
  await expect(nav.getByRole("link", { name: "User analytics" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Revenue" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Billing setup" })).toHaveCount(0);
  await expect(page.getByText("Support staff").first()).toBeVisible();
  await page.goto(`${APP}/admin/users?q=`);
  await page.getByRole("searchbox", { name: "Email or name" }).fill(staff.email);
  await page.getByRole("button", { name: "Search" }).click();
  // No plan actions on the list for support staff; on the person's page the button is there but off.
  const results = page.getByRole("table", { name: `Users matching “${staff.email}”` });
  await expect(results.getByRole("link", { name: "Support Person" })).toBeVisible();
  await expect(results.getByRole("button")).toHaveCount(0);
  await results.getByRole("link", { name: "Support Person" }).click();
  await expect(page.getByRole("button", { name: /^(Upgrade|Change plan)$/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Extend trial…|Give Pro AI trial…/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Grant credits…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Suspend…" })).toBeDisabled();
  await staff.context.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`admin pages have no serious accessibility violations (${scheme})`, async ({ browser }) => {
    // Eleven pages, each compiled on first visit in CI's dev server and scanned by axe.
    test.setTimeout(240_000);
    const page = await adminPage(browser, "/admin");
    await page.evaluate((s) => localStorage.setItem("folevi:appearance", s), scheme);
    for (const path of ["/admin", "/admin/users?q=", "/admin/workspaces", "/admin/emails", "/admin/audit", "/admin/deletion-jobs", "/admin/configuration", "/admin/billing-setup", "/admin/analytics", "/admin/revenue", "/admin/support"]) {
      await page.goto(`${APP}${path}`);
      await expect(page.getByRole("navigation", { name: "Admin" })).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(1500);
      await settle(page);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${path}: ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    }
    await page.context().close();
  });
}
