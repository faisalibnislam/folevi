import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createAccount, settle } from "./helpers";

/** Scans the current step with axe: no serious or critical issues. */
async function scan(page: Page, label: string) {
  await settle(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).disableRules(["region"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${label}: ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

const heading = (page: Page, name: string) => page.getByRole("heading", { name, level: 1 });

test("onboarding: choices are saved, a reload resumes, and the Welcome page opens in its new style", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext();
  const { page } = await createAccount(context, { name: "Onboarding Tester" });

  // 1. Welcome
  await expect(heading(page, "Welcome, Onboarding.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("list", { name: "Setup progress" }).getByRole("listitem")).toHaveCount(6);
  await scan(page, "welcome");
  await page.getByRole("button", { name: "Get started" }).click();

  // 2. Use cases: real checkboxes; each adds starter pages.
  const uses = heading(page, "What will you use Folevi for?");
  await expect(uses).toBeFocused();
  await page.getByRole("checkbox", { name: /Work projects/ }).check();
  await page.getByRole("checkbox", { name: /Trips and events/ }).check();
  await expect(page.getByText("Adds 4 pages: Project Brief, Meeting Notes, Travel Plan and Event Plan.")).toBeVisible();
  await scan(page, "uses");
  await page.getByRole("button", { name: "Continue" }).click();

  // 3. Note style. A reload resumes here, and Back shows the saved use cases.
  await expect(heading(page, "Pick a style for your first page")).toBeFocused();
  await page.reload();
  await expect(heading(page, "Pick a style for your first page")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("checkbox", { name: /Work projects/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Work projects/ })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /Journaling/ })).not.toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(heading(page, "Pick a style for your first page")).toBeVisible();
  const styles = page.getByRole("group", { name: "Pick a style for your first page" });
  await expect(styles.getByRole("radio")).toHaveCount(9);
  await expect(styles.getByRole("radio", { name: "Plain" })).toBeChecked();
  // A real radio group: arrow keys move the choice.
  await styles.getByRole("radio", { name: "Plain" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(styles.getByRole("radio", { name: "Irises" })).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(styles.getByRole("radio", { name: "Cypresses" })).toBeChecked();
  await scan(page, "style");
  await page.getByRole("button", { name: "Continue" }).click();

  // 4. Appearance applies at once.
  await expect(heading(page, "Light or dark?")).toBeFocused();
  await page.getByRole("radio", { name: "Dark" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await scan(page, "appearance (dark)");
  await page.getByRole("button", { name: "Continue" }).click();

  // 5. AI Assistant: on by default, switched off here.
  await expect(heading(page, "Meet your AI Assistant")).toBeFocused();
  const ai = page.getByRole("switch", { name: "AI Assistant" });
  await expect(ai).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/Included in your 7-day Pro AI trial, with 100 AI credits/)).toBeVisible();
  await ai.click();
  await expect(ai).toHaveAttribute("aria-checked", "false");
  await scan(page, "ai");
  await page.getByRole("button", { name: "Continue" }).click();

  // 6. The summary reads back what the server saved, after a reload too.
  await expect(heading(page, "Your Folevi is ready.")).toBeFocused();
  await page.reload();
  await expect(heading(page, "Your Folevi is ready.")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByText("4 starter pages")).toBeVisible();
  await expect(page.getByText("Project Brief, Meeting Notes, Travel Plan and Event Plan")).toBeVisible();
  await expect(page.getByText("In the Cypresses style")).toBeVisible();
  await expect(page.getByText("Off. Turn it on in Settings any time.")).toBeVisible();
  await scan(page, "ready");
  await page.getByRole("button", { name: "Open “Welcome to Folevi”" }).click();

  // The Welcome page wears the chosen style; AI is off (no AI in the page tools).
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Welcome to Folevi");
  await expect(page.locator("article.fb-sheet header [data-cover-image]")).toHaveAttribute("style", /\/covers\/art-39/);
  await expect(page.getByRole("button", { name: /^(Show|Hide) page tools/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "AI Assistant", exact: true })).toHaveCount(0);

  // The starter pages exist.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await page.getByRole("combobox", { name: /Search documents/ }).fill("Event Plan");
  await expect(page.getByRole("option", { name: /Event Plan/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // Onboarding runs once.
  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await context.close();
});

test("onboarding: every step can be skipped, and passes axe in dark mode", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ colorScheme: "dark" });
  const { page } = await createAccount(context, { name: "Skip Tester" });
  await expect(heading(page, "Welcome, Skip.")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await scan(page, "welcome (dark)");
  await page.getByRole("button", { name: "Get started" }).click();
  for (const name of ["What will you use Folevi for?", "Pick a style for your first page", "Light or dark?", "Meet your AI Assistant"]) {
    await expect(heading(page, name)).toBeFocused();
    await scan(page, `${name} (dark)`);
    await page.getByRole("button", { name: "Skip", exact: true }).click();
  }
  await expect(heading(page, "Your Folevi is ready.")).toBeFocused();
  await expect(page.getByText("None this time. You’ll find templates in the sidebar.")).toBeVisible();
  await expect(page.getByText("Plain, like every new page")).toBeVisible();
  await expect(page.getByText("Matches your system")).toBeVisible();
  await expect(page.getByText("On. Press ⌘J in a note to ask.")).toBeVisible();
  await scan(page, "ready (dark)");
  await page.getByRole("button", { name: "Open “Welcome to Folevi”" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Welcome to Folevi");
  await expect(page.locator("article.fb-sheet header [data-cover-image]")).toHaveCount(0);
  await context.close();
});

test("onboarding: phone width, with the preview above the choices", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const { page } = await createAccount(context, { name: "Phone Tester" });
  await expect(heading(page, "Welcome, Phone.")).toBeVisible({ timeout: 30_000 });
  // Nothing scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("checkbox", { name: /Journaling/ }).check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(heading(page, "Pick a style for your first page")).toBeVisible();
  await page.getByRole("button", { name: "Skip setup" }).click();
  await expect(heading(page, "Your Folevi is ready.")).toBeVisible();
  await expect(page.getByText("Journal Entry and Habit Tracker")).toBeVisible();
  await context.close();
});
