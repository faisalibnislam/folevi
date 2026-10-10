import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { APP, createWorkspace, newPerson, switchTo } from "./helpers";

// AI credits and Core, without calling Gemini: Core hides every AI entry point (in Personal and in a Core
// workspace), the AI panels say when credits run low, a refused request says what helps, and a test credit
// pack adds credits. Locally payments aren't connected, so plans and packs are test purchases.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Uses up someone's monthly (or trial) AI credits on the local deployment; bought credits stay. */
function exhaustCredits(email: string, workspaceId?: string) {
  execFileSync("npx", ["convex", "run", "testSupport:exhaustCredits", JSON.stringify(workspaceId ? { email, workspaceId } : { email })], {
    cwd: REPO_ROOT,
    stdio: "ignore",
    timeout: 60_000,
    env: { ...process.env, CONVEX_AGENT_MODE: process.env.CONVEX_AGENT_MODE ?? "anonymous" },
  });
}

const launcher = (page: Page) => page.getByRole("button", { name: "Ask Foli", exact: true });

/** No AI anywhere on Home or in a new note: no launcher, no Catch me up, no dock tab, toolbar, slash command, ⌘J or palette item. */
async function expectNoAi(page: Page) {
  await page.goto(`${APP}/documents`);
  await expect(page.getByRole("button", { name: "New note", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(launcher(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Catch me up" })).toHaveCount(0);
  await page.keyboard.press("Meta+j");
  await expect(page.getByRole("dialog", { name: "Foli" })).toHaveCount(0);

  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Some words to select");
  await expect(page.getByRole("toolbar", { name: "Page tools" }).getByRole("button", { name: "Foli" })).toHaveCount(0);
  await page.keyboard.press("Shift+Home");
  const formatting = page.getByRole("toolbar", { name: "Text formatting" });
  await expect(formatting).toBeVisible();
  await expect(formatting.getByRole("button", { name: /Ask Foli/ })).toHaveCount(0);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/ask ai");
  await expect(page.getByRole("option", { name: /Ask Foli|AI ·|Foli:/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+j");
  await expect(page.getByRole("dialog", { name: "Foli" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Foli" })).toHaveCount(0);
  await page.keyboard.press("Meta+k");
  await expect(page.getByRole("option", { name: /Ask Foli/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  // Templates: no "Generate with AI".
  await page.goto(`${APP}/templates`);
  await expect(page.getByRole("button", { name: "New template" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Generate with AI" })).toHaveCount(0);
}

test("Core hides every AI entry point in Personal, and the AI setting says it isn't included", async ({ browser }) => {
  const { page, context } = await newPerson(browser, "Core Writer");
  // The trial includes AI.
  await expect(page.getByRole("toolbar", { name: "Page tools" }).getByRole("button", { name: "Foli" })).toBeVisible();
  await page.goto(`${APP}/documents`);
  await expect(launcher(page)).toBeVisible({ timeout: 30_000 });

  await page.goto(`${APP}/settings/billing`);
  await page.getByRole("group", { name: "Billing period" }).getByRole("button", { name: "Monthly" }).click();
  await page.getByRole("region", { name: "Core plan", exact: true }).getByRole("button", { name: "Choose Core (test)" }).click();
  await expect(page.getByRole("status").filter({ hasText: "You're on Core (test purchase)." })).toBeVisible();
  await expect(launcher(page)).toHaveCount(0);

  await expectNoAi(page);

  // Settings → Account: the switch is off and can't be turned on, with the reason.
  await page.goto(`${APP}/settings/account`);
  const toggle = page.getByRole("switch", { name: "Foli" });
  await expect(toggle).toBeDisabled({ timeout: 30_000 });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("Not included in Core.")).toBeVisible();
  await expect(page.getByText(/nothing is sent to an AI model/)).toBeVisible();
  await context.close();
});

test("a Core workspace has no AI for anyone in it; Personal keeps its own plan", async ({ browser }) => {
  const { page, context } = await newPerson(browser, "Core Owner");
  await createWorkspace(page, "Core Studio");
  await page.goto(`${APP}/documents`);
  await expect(launcher(page)).toBeVisible({ timeout: 30_000 });

  await page.goto(`${APP}/settings/workspace-billing`);
  const core = page.getByRole("region", { name: "Core plan", exact: true });
  await expect(core).toBeVisible({ timeout: 30_000 });
  await core.getByRole("button", { name: "Upgrade to Core (test)" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Core Studio is on Core (test purchase)." })).toBeVisible();
  await expect(page.getByText("Core doesn't include AI, so nothing in this workspace is sent to an AI model.")).toBeVisible();
  await expect(launcher(page)).toHaveCount(0);

  await expectNoAi(page);

  // Personal is on the Pro AI trial, so AI is back there.
  await switchTo(page, "Personal");
  await page.goto(`${APP}/documents`);
  await expect(launcher(page)).toBeVisible({ timeout: 30_000 });
  await context.close();
});

test("out of credits: the panel says so, with Upgrade, and the request is refused before anything is sent", async ({ browser }) => {
  const { page, context, email } = await newPerson(browser, "Credit Spender");
  exhaustCredits(email);
  await page.goto(`${APP}/documents`);
  await launcher(page).click();
  const chat = page.getByRole("dialog", { name: "Foli" });
  await expect(chat).toBeVisible();

  // The low-credits note: none left in the trial, and a plan is what helps.
  const note = chat.getByTestId("ai-credits-note");
  await expect(note).toContainText("No AI credits left.");
  await expect(note).toContainText(/Your trial ends on /);
  await expect(note.getByRole("link", { name: "Upgrade" })).toBeVisible();

  // Asking anyway: the server refuses (no Gemini call) and the panel shows its message with Upgrade.
  await chat.getByRole("textbox", { name: /Ask about your notes/ }).fill("What am I working on this week?");
  await page.keyboard.press("Enter");
  const problem = chat.getByTestId("ai-credits-problem");
  await expect(problem).toContainText("You've used the AI credits in your trial.", { timeout: 30_000 });
  await expect(problem.getByRole("link", { name: "Upgrade" })).toBeVisible();
  await problem.getByRole("link", { name: "Upgrade" }).click();
  await expect(page).toHaveURL(/\/settings\/billing$/);
  await expect(page.getByRole("heading", { name: "Choose a personal plan" })).toBeVisible({ timeout: 30_000 });
  await context.close();
});

test("buying a test credit pack adds extra credits, used after the monthly ones", async ({ browser }) => {
  const { page, context, email } = await newPerson(browser, "Credit Buyer");
  await page.goto(`${APP}/settings/billing`);
  await page.getByRole("group", { name: "Billing period" }).getByRole("button", { name: "Monthly" }).click();
  await page.getByRole("region", { name: "Pro plan", exact: true }).getByRole("button", { name: "Choose Pro (test)" }).click();
  await expect(page.getByRole("status").filter({ hasText: "You're on Pro (test purchase)." })).toBeVisible();
  const personal = page.getByRole("listitem", { name: "AI credits: Personal" });
  await expect(personal).toContainText("Personal · Pro");
  await expect(personal.getByText(/^180 AI credits left/)).toBeVisible();

  // Monthly credits used up: the AI panel says so, and on Pro more can be bought.
  exhaustCredits(email);
  await expect(personal.getByText(/^0 AI credits left/)).toBeVisible({ timeout: 30_000 });
  await launcher(page).click();
  const chat = page.getByRole("dialog", { name: "Foli" });
  const note = chat.getByTestId("ai-credits-note");
  await expect(note).toContainText("No AI credits left.");
  await expect(note).toContainText(/Resets /);
  await expect(note.getByRole("link", { name: "Buy more" })).toBeVisible();
  await chat.getByRole("button", { name: "Close chat" }).click();

  // Buy 500 (a test purchase): they're available at once and listed in the billing history.
  await personal.getByRole("button", { name: "Buy credits" }).click();
  const dialog = page.getByRole("dialog", { name: "Buy AI credits" });
  await expect(dialog.getByText("$7.99, one time")).toBeVisible();
  await expect(dialog.getByText("$14.99, one time")).toBeVisible();
  await dialog.getByRole("button", { name: "Buy 500 AI credits for $7.99 (test)" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added 500 AI credits to Personal (test purchase)." })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(personal.getByText(/^500 AI credits left/)).toBeVisible();
  await expect(personal).toContainText(/500 extra credits, the first expiring on /);
  await expect(page.getByRole("region", { name: "Your plan", exact: true }).getByText(/Plus 500 extra credits/)).toBeVisible();
  await expect(page.getByRole("cell", { name: "500 AI credits" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "$7.99 USD" })).toBeVisible();

  // With extra credits to fall back on, the panel no longer warns.
  await launcher(page).click();
  await expect(chat).toBeVisible();
  await expect(chat.getByTestId("ai-credits-note")).toHaveCount(0);
  await context.close();
});
