import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { APP, newPerson, settle } from "./helpers";
import { PASSPHRASE, migrationDone } from "./e2ee-helpers";

// Axe on every end-to-end encryption screen (docs/E2EE_DESIGN.md §11.4), light and dark, against the real
// keys and server on the dev deployment. Each colour scheme has an account of its own (the wizard gives an
// account keys); its browser stays open as the trusted one.

type Storage = Awaited<ReturnType<BrowserContext["storageState"]>>;

async function scan(page: Page, where: string) {
  await page.waitForTimeout(600);
  await settle(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).disableRules(["region"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${where}: ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

for (const scheme of ["light", "dark"] as const) {
  test(`the encryption screens have no serious accessibility violations (${scheme})`, async ({ browser }) => {
    test.setTimeout(480_000);
    const person = await newPerson(browser, "Privacy A11y");
    const storage: Storage = await person.context.storageState();
    await person.context.close();
    const context = await browser.newContext({ storageState: storage, colorScheme: scheme });
    await context.addInitScript((s) => localStorage.setItem("folevi:appearance", s), scheme);
    const page = await context.newPage();

    await page.goto(`${APP}/settings/privacy`);
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
    await expect(page.locator('[data-e2ee-step="methods"]')).toBeVisible({ timeout: 60_000 });
    await scan(page, "wizard: ways to unlock");
    await w.getByRole("button", { name: "Add Recovery key" }).click();
    const key = w.getByRole("list", { name: "Your recovery key" });
    await expect(key).toBeVisible({ timeout: 30_000 });
    await scan(page, "wizard: recovery key");
    const groups = (await key.getByRole("listitem").allTextContents()).map((t) => t.replace(/^Group \d+: /, "").trim());
    await w.getByLabel("Group 3").fill(groups[2]!);
    await w.getByLabel("Group 7").fill(groups[6]!);
    await w.getByRole("button", { name: "Check and continue" }).click();
    await w.getByRole("button", { name: "Add Encryption passphrase" }).click({ timeout: 30_000 });
    await scan(page, "wizard: passphrase");
    await w.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
    await w.getByLabel("Type it again").fill(PASSPHRASE);
    await w.getByRole("button", { name: "Save passphrase" }).click();
    await expect(w.getByRole("status")).toHaveText("2 of 2 needed", { timeout: 60_000 });
    await w.getByRole("button", { name: "Continue" }).click();
    await scan(page, "wizard: confirm");
    await w.getByRole("button", { name: "Turn on encryption" }).click();
    await expect(w.getByText("Encryption is on", { exact: true })).toBeVisible({ timeout: 60_000 });
    await scan(page, "wizard: done");
    await w.getByRole("button", { name: "Done" }).click();
    await migrationDone(page);
    await expect(page.getByText("Features that need to read your notes")).toBeVisible({ timeout: 30_000 });
    await scan(page, "privacy (encrypted)");
    await page.getByRole("radio", { name: /^Standard/ }).click();
    await page.getByRole("button", { name: "Change to Standard" }).click();
    await page.getByRole("dialog", { name: "Turn off encryption?" }).getByRole("button", { name: "Enter passphrase" }).click();
    await scan(page, "turn off encryption");
    await page.keyboard.press("Escape");

    const fresh = await browser.newContext({ storageState: storage, colorScheme: scheme });
    await fresh.addInitScript((s) => localStorage.setItem("folevi:appearance", s), scheme);
    const locked = await fresh.newPage();
    await locked.goto(`${APP}/documents`);
    await expect(locked.getByRole("heading", { name: "Unlock your encrypted notes" })).toBeVisible({ timeout: 30_000 });
    await scan(locked, "unlock");
    // The trusted browser's tab answers (one tab per browser shows the request).
    await page.goto(`${APP}/documents`);
    await locked.getByRole("button", { name: "Approve from another device" }).click();
    await scan(locked, "waiting for approval");
    const ask = page.getByRole("dialog", { name: "Approve a new device?" });
    await expect(ask.getByLabel(/^Code /)).toBeVisible({ timeout: 60_000 });
    await scan(page, "approve a new device");
    await ask.getByRole("button", { name: "They don't match" }).click();
    await fresh.close();

    await page.goto(`${APP}/settings/devices`);
    await expect(page.getByText("Can unlock encrypted notes").first()).toBeVisible({ timeout: 30_000 });
    await scan(page, "devices");
    await context.close();
  });
}
