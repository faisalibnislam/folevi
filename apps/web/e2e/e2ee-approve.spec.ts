import { expect, test } from "@playwright/test";
import { APP, newPerson, signIn } from "./helpers";
import { turnOnEncryption } from "./e2ee-helpers";

// §11.4 e2ee-approve: two browsers; the new one asks, the trusted one approves, both show the same code.
// "They don't match" cancels.

test("approve a new browser from a trusted one, and refuse one", async ({ browser }) => {
  test.setTimeout(300_000);
  const trusted = await newPerson(browser, "Approve Person");
  await turnOnEncryption(trusted.page);
  await trusted.page.goto(`${APP}/documents`);

  const fresh = await browser.newContext();
  const page = await signIn(fresh, trusted.account);
  await page.goto(`${APP}/documents`);
  await page.getByRole("button", { name: "Approve from another device" }).click();
  const waiting = page.getByRole("dialog", { name: "Waiting for approval" });
  const ask = trusted.page.getByRole("dialog", { name: "Approve a new device?" });
  await expect(ask).toBeVisible({ timeout: 30_000 });
  const code = (await ask.getByLabel(/^Code /).getAttribute("aria-label"))!;
  await expect(waiting.getByLabel(code)).toBeVisible({ timeout: 30_000 });
  await ask.getByRole("button", { name: "They match" }).click();
  await expect(page.getByRole("radiogroup", { name: "Your notes are unlocked" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Continue" }).click();

  const other = await browser.newContext();
  const second = await signIn(other, trusted.account);
  await second.goto(`${APP}/documents`);
  await second.getByRole("button", { name: "Approve from another device" }).click();
  await expect(ask).toBeVisible({ timeout: 30_000 });
  await ask.getByRole("button", { name: "They don't match" }).click();
  await expect(ask.getByRole("alert")).toContainText("Approval cancelled.");
  await expect(second.getByRole("dialog", { name: "Waiting for approval" }).getByRole("alert")).toBeVisible({ timeout: 30_000 });

  await Promise.all([trusted.context.close(), fresh.close(), other.close()]);
});
