import { expect, test } from "@playwright/test";
import { APP, newPersonWithWorkspace } from "./helpers";

// Plans in Settings → Plan & billing. Locally payments aren't connected, so upgrades are test purchases.

test("a new account is on a 7-day Pro trial, can take a test plan, and cancel it", async ({ browser }) => {
  const { page, context } = await newPersonWithWorkspace(browser, "Plan Person");
  // The workspace menu shows the trial.
  await page.goto(`${APP}/settings/billing`);
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Pro trial", { exact: true })).toBeVisible();
  await expect(page.getByText(/7 days left|6 days left/)).toBeVisible();
  await expect(page.getByText("Unlimited during your Pro trial.")).toBeVisible();

  // Three plans; yearly prices.
  await page.getByRole("group", { name: "Billing period" }).getByRole("button", { name: /Yearly/ }).click();
  await expect(page.getByText("$49", { exact: true })).toBeVisible();
  await page.getByRole("group", { name: "Billing period" }).getByRole("button", { name: "Monthly" }).click();

  await page.getByRole("button", { name: /Upgrade to Basic/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "You're on Basic (test purchase)." })).toBeVisible();
  await expect(page.getByText("Basic", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "$2" })).toBeVisible();

  await page.getByRole("button", { name: "Cancel plan" }).click();
  await expect(page.getByRole("button", { name: "Keep my plan" })).toBeVisible();
  await expect(page.getByText(/then Free\./)).toBeVisible();
  await context.close();
});

test("the public pricing page lists Free, Basic and Pro", async ({ page }) => {
  await page.goto("http://localhost:3000/pricing");
  for (const name of ["Free", "Basic", "Pro"]) await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
  await expect(page.getByText("$0", { exact: true })).toBeVisible();
  await expect(page.getByText("$2", { exact: true })).toBeVisible();
  await expect(page.getByText("$5", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Try Pro free for 7 days/ })).toBeVisible();
});
