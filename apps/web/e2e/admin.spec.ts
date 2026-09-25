import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { APP, newPersonWithWorkspace, signIn } from "./helpers";

// The admin used by these tests. Locally, the first super admin is granted with
// `npx convex run admin:bootstrapSuperAdmin '{"email":"ada@example.com"}'` (see docs/ADMIN.md).
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "ada@example.com";
const ADMIN_NAME = process.env.E2E_ADMIN_NAME ?? "Ada Example";
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

test.beforeAll(() => {
  // Idempotent in practice: it refuses once any super admin exists, which is fine.
  try {
    execFileSync("npx", ["convex", "run", "admin:bootstrapSuperAdmin", JSON.stringify({ email: ADMIN_EMAIL })], { cwd: REPO_ROOT, stdio: "ignore", timeout: 60_000 });
  } catch {
    /* a super admin already exists (or the CLI isn't available in this environment) */
  }
});

async function adminPage(browser: Browser, path: string): Promise<Page> {
  const context = await browser.newContext();
  // Visit the product once so the admin's profile exists, then open the console.
  const page = await signIn(context, { email: ADMIN_EMAIL, name: ADMIN_NAME });
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
  await page.getByRole("combobox", { name: "Target type" }).selectOption("profile");
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

for (const scheme of ["light", "dark"] as const) {
  test(`admin pages have no serious accessibility violations (${scheme})`, async ({ browser }) => {
    const page = await adminPage(browser, "/admin");
    await page.evaluate((s) => localStorage.setItem("folevi:appearance", s), scheme);
    for (const path of ["/admin", "/admin/users?q=", "/admin/workspaces", "/admin/emails", "/admin/audit", "/admin/deletion-jobs", "/admin/configuration"]) {
      await page.goto(`${APP}${path}`);
      await expect(page.getByRole("navigation", { name: "Admin" })).toBeVisible();
      await page.waitForTimeout(1500);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${path}: ${v.id} — ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    }
    await page.context().close();
  });
}
