import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { APP, newPerson, settle } from "./helpers";
import { stubState, type StubName } from "./e2ee-stub";

// Axe on every end-to-end encryption screen (docs/E2EE_DESIGN.md §11.4), light and dark. Runs on the stubs
// now (components/e2ee/__stubs__.ts); at integration the same screens come from the real hooks.

let storage: Awaited<ReturnType<BrowserContext["storageState"]>>;
test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const { context } = await newPerson(browser, "Privacy A11y");
  storage = await context.storageState();
  await context.close();
});

async function scan(page: Page, where: string) {
  await page.waitForTimeout(600);
  await settle(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).disableRules(["region"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${where}: ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

for (const scheme of ["light", "dark"] as const) {
  test(`the encryption screens have no serious accessibility violations (${scheme})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const at = async (state: StubName, path: string) => {
      const context = await browser.newContext({ storageState: storage, colorScheme: scheme });
      await context.addInitScript((s) => localStorage.setItem("folevi:appearance", s), scheme);
      await stubState(context, state);
      const page = await context.newPage();
      await page.goto(`${APP}${path}`);
      return { context, page };
    };
    {
      const { context, page } = await at("none", "/settings/privacy");
      await expect(page.getByRole("radiogroup", { name: "How private your notes are" })).toBeVisible({ timeout: 30_000 });
      await scan(page, "privacy (standard)");
      await page.getByRole("button", { name: "What each choice means" }).click();
      await scan(page, "what each choice means");
      await page.keyboard.press("Escape");
      await page.getByRole("radio", { name: /^Encrypted, with the features you pick/ }).click();
      await page.getByRole("button", { name: "Turn on encryption" }).click();
      const w = page.getByRole("dialog", { name: "Turn on encryption" });
      await scan(page, "wizard: before you start");
      await w.getByRole("button", { name: "Continue" }).click();
      await expect(w.getByRole("status")).toBeVisible();
      await scan(page, "wizard: ways to unlock");
      await w.getByRole("button", { name: "Add Recovery key" }).click();
      await expect(w.getByRole("list", { name: "Your recovery key" })).toBeVisible();
      await scan(page, "wizard: recovery key");
      await w.getByRole("button", { name: "Back" }).click();
      await w.getByRole("button", { name: "Add Encryption passphrase" }).click();
      await scan(page, "wizard: passphrase");
      await context.close();
    }
    {
      const { context, page } = await at("encrypted", "/settings/privacy");
      await expect(page.getByText("Features that need to read your notes")).toBeVisible({ timeout: 30_000 });
      await scan(page, "privacy (encrypted)");
      await page.getByRole("radio", { name: /^Standard/ }).click();
      await page.getByRole("button", { name: "Change to Standard" }).click();
      await scan(page, "turn off encryption");
      await context.close();
    }
    {
      const { context, page } = await at("migrating", "/settings/privacy");
      await expect(page.getByRole("region", { name: /Encrypting your notes/ })).toBeVisible({ timeout: 30_000 });
      await scan(page, "migration progress");
      await context.close();
    }
    {
      const { context, page } = await at("locked", "/documents");
      await expect(page.getByRole("heading", { name: "Unlock your encrypted notes" })).toBeVisible({ timeout: 30_000 });
      await scan(page, "unlock");
      await page.getByRole("button", { name: "Approve from another device" }).click();
      await scan(page, "waiting for approval");
      await context.close();
    }
    {
      const { context, page } = await at("approval", "/documents");
      await expect(page.getByRole("dialog", { name: "Approve a new device?" })).toBeVisible({ timeout: 30_000 });
      await scan(page, "approve a new device");
      await context.close();
    }
    {
      const { context, page } = await at("consent", "/documents");
      await expect(page.getByRole("dialog", { name: "Send to Foli AI?" })).toBeVisible({ timeout: 30_000 });
      await scan(page, "Foli AI consent");
      await context.close();
    }
    {
      const { context, page } = await at("encrypted", "/settings/devices");
      await expect(page.getByText("Can unlock encrypted notes").first()).toBeVisible({ timeout: 30_000 });
      await scan(page, "devices");
      await context.close();
    }
  });
}
