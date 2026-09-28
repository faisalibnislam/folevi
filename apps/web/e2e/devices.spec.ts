import { expect, test } from "@playwright/test";
import { APP, endTrial, newPersonWithWorkspace, signIn } from "./helpers";

// Free works on 2 devices at a time. A third sign-in waits on a "device limit" screen until another device
// is signed out there (or the plan is upgraded); the first two keep working.
test("Free: a third device waits until another is signed out", async ({ browser }) => {
  const first = await newPersonWithWorkspace(browser, "Device Person");
  const second = await browser.newContext();
  const secondPage = await signIn(second, first.account);
  await secondPage.goto(`${APP}/documents`);
  await expect(secondPage.getByRole("heading", { name: "Home", level: 1 })).toBeVisible({ timeout: 30_000 });
  endTrial(first.email);

  // Settings → Devices shows the limit.
  await first.page.goto(`${APP}/settings/devices`);
  await expect(first.page.getByText("2 of 2 devices connected")).toBeVisible({ timeout: 30_000 });

  const third = await browser.newContext();
  const thirdPage = await signIn(third, first.account);
  await expect(thirdPage.getByRole("heading", { name: "You’re on 2 devices already" })).toBeVisible({ timeout: 30_000 });
  await expect(thirdPage.getByRole("button", { name: /Upgrade to Basic/ })).toBeVisible();
  // Sign one of the other devices out from here; this one opens.
  await thirdPage.getByRole("button", { name: /^Sign out / }).first().click();
  await expect(thirdPage.getByRole("heading", { name: "You’re on 2 devices already" })).toHaveCount(0, { timeout: 30_000 });
  await thirdPage.goto(`${APP}/documents`);
  await expect(thirdPage.getByRole("heading", { name: "Home", level: 1 })).toBeVisible({ timeout: 30_000 });

  await Promise.all([first.context.close(), second.close(), third.close()]);
});
