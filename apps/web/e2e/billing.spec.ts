import { expect, test } from "@playwright/test";
import { APP, newPerson } from "./helpers";

// Personal plans in Settings → Plan & billing. Locally payments aren't connected, so upgrades are test purchases.
// The public pricing page has its own spec (pricing.spec.ts); AI credits and Core are in credits.spec.ts.

test("a new account is on a 7-day Pro AI trial, can take a test plan, and cancel it", async ({ browser }) => {
  const { page, context } = await newPerson(browser, "Plan Person");
  // Settings → Plan & billing shows the trial, its credits and its storage.
  await page.goto(`${APP}/settings/billing`);
  const plan = page.getByRole("region", { name: "Your plan", exact: true });
  await expect(plan).toBeVisible({ timeout: 30_000 });
  await expect(plan.getByText("Pro AI trial", { exact: true })).toBeVisible();
  await expect(plan.getByText("Trial", { exact: true })).toBeVisible();
  await expect(plan.getByText(/(7|6) days of Pro AI left/)).toBeVisible();
  await expect(plan.getByText("100 AI credits left")).toBeVisible();
  await expect(plan.getByText(/100 of 100 trial credits left\. Your trial ends on /)).toBeVisible();
  await expect(plan.getByText("Your own 50 GB during your trial.")).toBeVisible();
  await expect(plan.getByText(/Unlimited during your trial/)).toBeVisible();

  // Four personal plans, in order; yearly prices first.
  await expect(page.getByRole("heading", { name: "Choose a personal plan" })).toBeVisible();
  await expect(page.getByText("Your plan applies to your personal account. Workspaces have their own plans, members, limits and billing.")).toBeVisible();
  const cards = page.getByRole("region", { name: /^(Free|Core|Pro|Pro AI) plan$/ });
  await expect(cards).toHaveCount(4);
  await expect(cards.locator("h4")).toHaveText(["Free", "Core", "Pro", "Pro AI"]);
  const card = (name: string) => page.getByRole("region", { name: `${name} plan`, exact: true });
  await expect(card("Free").getByRole("button", { name: "Your plan" })).toBeDisabled();
  await expect(card("Core").getByText("$19", { exact: true })).toBeVisible();
  await expect(card("Core").getByText("$1.58/month, billed yearly")).toBeVisible();
  await expect(card("Pro").getByText("$49", { exact: true })).toBeVisible();
  await expect(card("Pro").getByText("$4.08/month, billed yearly")).toBeVisible();
  await expect(card("Pro AI").getByText("$149", { exact: true })).toBeVisible();
  await expect(card("Pro AI").getByText("$12.41/month, billed yearly")).toBeVisible();
  await expect(card("Core").getByText("No AI. Your notes stay yours: nothing is sent to an AI model")).toBeVisible();
  await page.getByRole("group", { name: "Billing period" }).getByRole("button", { name: "Monthly" }).click();
  await expect(card("Core").getByText("$1.99", { exact: true })).toBeVisible();
  await expect(card("Pro").getByText("$4.99", { exact: true })).toBeVisible();
  await expect(card("Pro AI").getByText("$12.99", { exact: true })).toBeVisible();

  // Choosing a plan ends the trial: Pro (test purchase), monthly.
  await card("Pro").getByRole("button", { name: "Choose Pro (test)" }).click();
  await expect(page.getByRole("status").filter({ hasText: "You're on Pro (test purchase)." })).toBeVisible();
  await expect(plan.getByText("Pro", { exact: true })).toBeVisible();
  await expect(plan.getByText("Active", { exact: true })).toBeVisible();
  await expect(plan.getByText("180 AI credits left")).toBeVisible();
  await expect(plan.getByText(/180 of 180 monthly credits left\. Resets on /)).toBeVisible();
  await expect(plan.getByText("Your own 20 GB on Pro.")).toBeVisible();
  await expect(card("Pro").getByRole("button", { name: "Your plan" })).toBeDisabled();
  await expect(card("Pro AI").getByRole("button", { name: "Upgrade to Pro AI (test)" })).toBeVisible();
  await expect(card("Core").getByRole("button", { name: "Change to Core (test)" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Pro · monthly" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "$4.99 USD" })).toBeVisible();

  // Cancel at the end of the period, then resume.
  await plan.getByRole("button", { name: "Cancel plan" }).click();
  await expect(plan.getByText("Cancel scheduled", { exact: true })).toBeVisible();
  await expect(plan.getByText(/Your Pro features remain available until then\./)).toBeVisible();
  await plan.getByRole("button", { name: "Resume subscription" }).click();
  await expect(plan.getByText("Active", { exact: true })).toBeVisible();

  // Switching to Free ends the plan at the close of the period.
  await card("Free").getByRole("button", { name: "Switch to Free" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Your plan will end at the close of this billing period." })).toBeVisible();
  await expect(plan.getByText("Cancel scheduled", { exact: true })).toBeVisible();
  await context.close();
});

test("Core: more room and no AI, said plainly on the plan page", async ({ browser }) => {
  const { page, context } = await newPerson(browser, "Core Planner");
  await page.goto(`${APP}/settings/billing`);
  const plan = page.getByRole("region", { name: "Your plan", exact: true });
  await expect(plan).toBeVisible({ timeout: 30_000 });
  await page.getByRole("region", { name: "Core plan", exact: true }).getByRole("button", { name: "Choose Core (test)" }).click();
  await expect(page.getByRole("status").filter({ hasText: "You're on Core (test purchase)." })).toBeVisible();
  await expect(plan.getByText("Core", { exact: true })).toBeVisible();
  await expect(plan.getByText("Annual", { exact: true })).toBeVisible();
  await expect(plan.getByText(/Core doesn't include AI, so nothing in your notes is sent to an AI model\./)).toBeVisible();
  await expect(plan.getByText("Your own 20 GB on Core.")).toBeVisible();
  const personal = page.getByRole("listitem", { name: "AI credits: Personal" });
  await expect(personal).toContainText("Not included in Core.");
  await expect(personal.getByRole("button", { name: "Buy credits" })).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "Core · yearly" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "$19 USD" })).toBeVisible();
  await context.close();
});
