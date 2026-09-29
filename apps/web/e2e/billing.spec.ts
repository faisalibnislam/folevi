import { expect, test } from "@playwright/test";
import { APP, newPersonWithWorkspace } from "./helpers";

// Personal plans in Settings → Plan & billing. Locally payments aren't connected, so upgrades are test purchases.

test("a new account is on a 7-day Pro trial, can take a test plan, and cancel it", async ({ browser }) => {
  const { page, context } = await newPersonWithWorkspace(browser, "Plan Person");
  // The workspace menu shows the trial.
  await page.goto(`${APP}/settings/billing`);
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Pro trial", { exact: true })).toBeVisible();
  await expect(page.getByText(/7 days left|6 days left/)).toBeVisible();
  await expect(page.getByText("Unlimited during your Pro trial.")).toBeVisible();

  // Three personal plans; yearly prices. Nothing about storage pooled across workspaces.
  await expect(page.getByRole("heading", { name: "Choose a personal plan" })).toBeVisible();
  await expect(page.getByText("Your plan applies to your personal account. Workspaces have their own plans, members, limits and billing.")).toBeVisible();
  await expect(page.getByText(/across (all|your personal)/)).toHaveCount(0);
  await expect(page.getByText("1 GB personal storage")).toBeVisible();
  await page.getByRole("group", { name: "Billing period" }).getByRole("button", { name: /Yearly/ }).click();
  await expect(page.getByText("$49", { exact: true })).toBeVisible();
  await expect(page.getByText("$0.75/month, billed yearly")).toBeVisible();
  await expect(page.getByText("$4.08/month, billed yearly")).toBeVisible();
  await page.getByRole("group", { name: "Billing period" }).getByRole("button", { name: "Monthly" }).click();

  await page.getByRole("button", { name: /Upgrade to Basic/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "You're on Basic (test purchase)." })).toBeVisible();
  await expect(page.getByText("Basic", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "$2" })).toBeVisible();

  await page.getByRole("button", { name: "Cancel plan" }).click();
  await expect(page.getByText("Cancel scheduled", { exact: true })).toBeVisible();
  await expect(page.getByText(/Your Basic features remain available until then\./)).toBeVisible();
  await page.getByRole("button", { name: "Resume subscription" }).click();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await context.close();
});

test("the public pricing page lists Free, Basic and Pro, then the workspace plans", async ({ page }) => {
  await page.goto("http://localhost:3000/pricing");
  const personal = page.getByRole("region", { name: "Personal plans" });
  for (const name of ["Free", "Basic", "Pro"]) await expect(personal.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
  await expect(personal.getByText("$0", { exact: true })).toBeVisible();
  await expect(personal.getByText("$2", { exact: true })).toBeVisible();
  await expect(personal.getByText("$5", { exact: true })).toBeVisible();
  await expect(personal.getByText("100 GB personal storage")).toBeVisible();
  await expect(personal.getByRole("link", { name: /Try Pro free for 7 days/ })).toBeVisible();
  // Workspaces: Free, and Team / Business per member (not on sale yet).
  const workspaces = page.getByRole("region", { name: "Workspaces" });
  for (const name of ["Free", "Team", "Business"]) await expect(workspaces.getByRole("heading", { level: 3, name, exact: true })).toBeVisible();
  await expect(workspaces.getByText("or $49 per member / year")).toBeVisible();
  await expect(workspaces.getByText("or $99 per member / year")).toBeVisible();
  await expect(workspaces.getByText("Coming soon", { exact: true })).toHaveCount(2);
  await expect(page.getByText(/across every workspace|workspaces you own/)).toHaveCount(0);
});
