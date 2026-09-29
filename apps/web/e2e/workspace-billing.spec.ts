import { expect, test } from "@playwright/test";
import { APP, createWorkspace, newPerson, switcher, switchTo } from "./helpers";

// A workspace's own plan (Free, Core, Pro, Pro AI, per member seat) in Settings → (workspace) Plan & billing. Locally payments aren't connected, so
// upgrades are test purchases. Personal Plan & billing stays Personal-only.

test("the owner puts a workspace on Pro (test purchase), sees seats, storage and their credits, and cancels", async ({ browser }) => {
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
  const cards = page.getByRole("region", { name: /^(Free|Core|Pro|Pro AI) plan$/ });
  await expect(cards).toHaveCount(4);
  await expect(cards.locator("h4")).toHaveText(["Free", "Core", "Pro", "Pro AI"]);
  await expect(page.getByText("For simple collaboration.").first()).toBeVisible();
  await expect(page.getByText("Billable seats: 1")).toBeVisible();
  await expect(page.getByText("Guests: 0 · Not billed")).toBeVisible();

  // On Free: the owner's free 1 GB (shared with their Personal only once the trial is over), and members' own personal AI credits.
  const plan = page.getByRole("region", { name: "Workspace plan", exact: true });
  await expect(plan.getByText(/^Uses the owner's free 1 GB/)).toBeVisible();
  await expect(plan.getByText("On Free, each member uses their own personal AI credits here.")).toBeVisible();

  // Monthly and yearly prices, per member.
  const card = (name: string) => page.getByRole("region", { name: `${name} plan`, exact: true });
  await expect(card("Core").getByText("$1.99", { exact: true })).toBeVisible();
  await expect(card("Pro").getByText("$4.99", { exact: true })).toBeVisible();
  await expect(card("Pro").getByText(/^Per member\. 1 member × \$4\.99 = \$4\.99\/month$/)).toBeVisible();
  await expect(card("Pro AI").getByText("$12.99", { exact: true })).toBeVisible();
  await page.getByRole("group", { name: "Billing period" }).getByRole("button", { name: /Yearly/ }).click();
  await expect(card("Core").getByText("$19", { exact: true })).toBeVisible();
  await expect(card("Pro").getByText("$49", { exact: true })).toBeVisible();
  await expect(card("Pro AI").getByText("$149", { exact: true })).toBeVisible();
  await page.getByRole("group", { name: "Billing period" }).getByRole("button", { name: "Monthly" }).click();

  await card("Pro").getByRole("button", { name: "Upgrade to Pro (test)" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Seat Studio is on Pro (test purchase)." })).toBeVisible();
  await expect(page.getByText("1 × $4.99 = $4.99/month")).toBeVisible();
  await expect(card("Pro").getByRole("button", { name: "Current plan" })).toBeDisabled();
  await expect(card("Pro AI").getByRole("button", { name: "Upgrade to Pro AI (test)" })).toBeVisible();
  await expect(card("Core").getByRole("button", { name: "Change to Core (test)" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Pro · monthly · 1 seat" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "$4.99 USD" })).toBeVisible();
  // Storage per member, and your own AI credits here (with packs to buy).
  await expect(plan.getByText("Your storage here")).toBeVisible();
  await expect(plan.getByText(/Each member has 20 GB here/)).toBeVisible();
  await expect(plan.getByText("Yours in this workspace. Every member has their own.")).toBeVisible();
  await expect(plan.getByText("180 AI credits left")).toBeVisible();
  await expect(plan.getByRole("button", { name: "Buy credits" })).toBeVisible();

  // Members: the seat count, and what another member costs.
  await page.goto(`${APP}/settings/members`);
  await expect(page.getByText(/Billable seats: 1 × \$4\.99 per month on Pro/)).toBeVisible({ timeout: 30_000 });

  // Personal Plan & billing is unchanged and shows only Personal plans; the workspace seat's credits are listed there too.
  await switchTo(page, "Personal");
  await page.goto(`${APP}/settings/billing`);
  await expect(page.getByRole("heading", { name: "Choose a personal plan" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Workspace plan", exact: true })).toHaveCount(0);
  await expect(page.getByText("No payments yet.")).toBeVisible();
  const seat = page.getByRole("listitem", { name: "AI credits: Seat Studio" });
  await expect(seat).toContainText("Seat Studio · Workspace Pro");
  await expect(seat.getByRole("button", { name: "Buy credits" })).toBeVisible();

  // Back in the workspace: cancel at period end, then resume.
  await switchTo(page, "Seat Studio");
  await page.goto(`${APP}/settings/workspace-billing`);
  await page.getByRole("button", { name: "Cancel plan" }).click();
  await expect(page.getByText("Cancel scheduled", { exact: true })).toBeVisible();
  await expect(page.getByText(/Pro features remain available until then\./)).toBeVisible();
  await page.getByRole("button", { name: "Resume subscription" }).click();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await context.close();
});

test("buying a test credit pack for your seat in a Pro AI workspace", async ({ browser }) => {
  const { page, context } = await newPerson(browser, "Seat Buyer");
  await createWorkspace(page, "Pack Studio");
  await page.goto(`${APP}/settings/workspace-billing`);
  await page.getByRole("region", { name: "Pro AI plan", exact: true }).getByRole("button", { name: "Upgrade to Pro AI (test)" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Pack Studio is on Pro AI (test purchase)." })).toBeVisible();
  const plan = page.getByRole("region", { name: "Workspace plan", exact: true });
  await expect(plan.getByText("550 AI credits left")).toBeVisible();
  await plan.getByRole("button", { name: "Buy credits" }).click();
  const dialog = page.getByRole("dialog", { name: "Buy AI credits" });
  await expect(dialog.getByText(/^For Pack Studio\./)).toBeVisible();
  await dialog.getByRole("button", { name: "Buy 1,000 AI credits for $14.99 (test)" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added 1,000 AI credits to Pack Studio (test purchase)." })).toBeVisible();
  await expect(plan.getByText("1,550 AI credits left")).toBeVisible();
  await expect(plan.getByText(/Plus 1,000 extra credits/)).toBeVisible();
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
