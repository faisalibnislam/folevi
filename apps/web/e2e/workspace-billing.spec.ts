import { expect, test } from "@playwright/test";
import { APP, createWorkspace, newPerson, switcher, switchTo } from "./helpers";

// A workspace's own plan in Settings → (workspace) Plan & billing. Locally payments aren't connected, so
// upgrades are test purchases. Personal Plan & billing stays Personal-only.

test("the owner puts a workspace on Team (test purchase), sees seats and the estimate, and cancels", async ({ browser }) => {
  const { page, context } = await newPerson(browser, "Seat Owner");
  await createWorkspace(page, "Seat Studio");

  // The switcher shows your role and the workspace's plan.
  await switcher(page).click();
  await expect(page.getByRole("menuitemradio", { name: "Seat Studio", exact: true })).toContainText("Owner · Free");
  await page.keyboard.press("Escape");

  await page.goto(`${APP}/settings/workspace-billing`);
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  await expect(sections.getByRole("link", { name: "Plan & billing" })).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Choose a workspace plan" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Workspace plans are billed per member. Guests are free.")).toBeVisible();
  for (const name of ["Free", "Team", "Business"]) await expect(page.getByRole("region", { name: `${name} plan` })).toBeVisible();
  await expect(page.getByText("For simple collaboration.").first()).toBeVisible();
  await expect(page.getByText("For growing teams.")).toBeVisible();
  await expect(page.getByText("For organizations that need more room and AI.")).toBeVisible();
  await expect(page.getByText("Billable seats: 1")).toBeVisible();
  await expect(page.getByText("Guests: 0 · Not billed")).toBeVisible();

  // Monthly and yearly prices, per member.
  const team = page.getByRole("region", { name: "Team plan" });
  await expect(team.getByText("$5", { exact: true })).toBeVisible();
  await expect(team.getByText("per member / month")).toBeVisible();
  await page.getByRole("group", { name: "Billing period" }).getByRole("button", { name: /Yearly/ }).click();
  await expect(team.getByText("$49", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Business plan" }).getByText("$99", { exact: true })).toBeVisible();
  await page.getByRole("group", { name: "Billing period" }).getByRole("button", { name: "Monthly" }).click();

  await team.getByRole("button", { name: /Upgrade to Team/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Seat Studio is on Team (test purchase)." })).toBeVisible();
  await expect(page.getByText("1 × $5 = $5/month")).toBeVisible();
  await expect(page.getByText("Included for every member.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "$5 USD" })).toBeVisible();

  // Members: the seat count, and what another member costs.
  await page.goto(`${APP}/settings/members`);
  await expect(page.getByText(/Billable seats: 1 × \$5 per month on Team/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Adds a seat when they accept: +$5/month on Team.")).toBeVisible();

  // Personal Plan & billing is unchanged and shows only Personal plans.
  await switchTo(page, "Personal");
  await page.goto(`${APP}/settings/billing`);
  await expect(page.getByRole("heading", { name: "Choose a personal plan" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Team plan" })).toHaveCount(0);
  await expect(page.getByText("No payments yet.")).toBeVisible();

  // Back in the workspace: cancel at period end, then resume.
  await switchTo(page, "Seat Studio");
  await page.goto(`${APP}/settings/workspace-billing`);
  await page.getByRole("button", { name: "Cancel plan" }).click();
  await expect(page.getByText("Cancel scheduled", { exact: true })).toBeVisible();
  await expect(page.getByText(/Team features remain available until then\./)).toBeVisible();
  await page.getByRole("button", { name: "Resume subscription" }).click();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await context.close();
});

test("members don't see the workspace's Plan & billing, and can't open it by URL", async ({ browser }) => {
  const owner = await newPerson(browser, "Billing Owner");
  await createWorkspace(owner.page, "Private Billing");
  const member = await newPerson(browser, "Plain Member");
  // Invite and accept.
  await owner.page.goto(`${APP}/settings/members`);
  await owner.page.getByPlaceholder("name@example.com").fill(member.email);
  await owner.page.getByRole("button", { name: "Invite" }).click();
  await expect(owner.page.getByRole("status").filter({ hasText: /Invitation sent/ })).toBeVisible();
  await member.page.goto(`${APP}/documents`);
  await member.page.getByRole("button", { name: /Notifications/ }).click();
  await member.page.getByRole("button", { name: "Accept invitation" }).first().click();
  await switchTo(member.page, "Private Billing");

  await member.page.goto(`${APP}/settings/members`);
  const sections = member.page.getByRole("navigation", { name: "Settings sections" });
  await expect(sections.getByRole("link", { name: "Members" })).toBeVisible({ timeout: 30_000 });
  // Only the Personal "Plan & billing" link: none for this workspace.
  await expect(sections.getByRole("link", { name: "Plan & billing" })).toHaveCount(1);
  await member.page.goto(`${APP}/settings/workspace-billing`);
  await expect(member.page.getByRole("heading", { name: "Not found" })).toBeVisible({ timeout: 30_000 });
  await expect(member.page.getByRole("heading", { name: "Choose a workspace plan" })).toHaveCount(0);
  await owner.context.close();
  await member.context.close();
});
