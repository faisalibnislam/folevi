import { expect, test } from "@playwright/test";
import { APP, newPerson, pick } from "./helpers";

// Foli AI routines on the dev backend (no model key needed, a trial account counts as Pro AI): Settings > AI
// shows each routine's estimate before it's on, turns the Morning brief on, and changes its monthly limit.

test("routines in Settings > AI: the estimate, turning one on, and the monthly limit", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await newPerson(browser, "Routine Person");
  await page.goto(`${APP}/settings/ai`);
  const card = page.getByRole("region", { name: "Routines", exact: true });
  await expect(card.getByText("Morning brief", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText("Open loops", { exact: true })).toBeVisible();
  // The estimate shows before anything is on.
  await expect(card.getByText(/^About \d+ credits? a run, up to \d+ a month\. Capped at 30 a month\.$/)).toHaveCount(2);

  await card.getByRole("switch", { name: "Morning brief" }).click();
  await expect(page.getByText("Morning brief turned on")).toBeVisible();
  await expect(card.getByText(/Used 0 of 30 credits this month\. Next one: /)).toBeVisible();
  await expect(card.getByRole("button", { name: "Run now" })).toBeVisible();

  await pick(card.getByRole("combobox", { name: "Morning brief monthly limit" }), "60 credits");
  await expect(card.getByText(/Capped at 60 a month\./)).toBeVisible();
  await context.close();
});
