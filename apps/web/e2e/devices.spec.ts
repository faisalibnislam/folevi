import { expect, test } from "@playwright/test";
import { APP, endTrial, newPerson, signIn } from "./helpers";

// No plan limits devices (the Free limit of 2 was removed on 2026-11-27, docs/PRICING_PLAN.md). After the
// trial, a Free account signs in on a third device and it opens straight away, with no "device limit" screen.
test("Free: a third device opens without waiting", async ({ browser }) => {
  const first = await newPerson(browser, "Device Person");
  const second = await browser.newContext();
  const secondPage = await signIn(second, first.account);
  await secondPage.goto(`${APP}/documents`);
  await expect(secondPage.getByRole("heading", { name: "Home", level: 1 })).toBeVisible({ timeout: 30_000 });
  endTrial(first.email);

  // Settings → Devices counts them, with no limit.
  await first.page.goto(`${APP}/settings/devices`);
  await expect(first.page.getByText("2 devices connected")).toBeVisible({ timeout: 30_000 });
  await expect(first.page.getByText(/of 2 devices/)).toHaveCount(0);

  const third = await browser.newContext();
  const thirdPage = await signIn(third, first.account);
  await thirdPage.goto(`${APP}/documents`);
  await expect(thirdPage.getByRole("heading", { name: "Home", level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(thirdPage.getByRole("heading", { name: /devices already/ })).toHaveCount(0);

  await first.page.reload();
  await expect(first.page.getByText("3 devices connected")).toBeVisible({ timeout: 30_000 });

  await Promise.all([first.context.close(), second.close(), third.close()]);
});
