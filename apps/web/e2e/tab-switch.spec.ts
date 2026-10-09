import { expect, test } from "@playwright/test";
import { APP, newPerson } from "./helpers";

// Switching to a tab shows its note straight away: its details are kept ready for the recent tabs, and its
// lines come from this device's copy (the note catches up with the server once it's showing).
test("switching tabs shows the note at once, without a loading placeholder", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page } = await newPerson(browser, "Switch Person");
  const tabs = page.getByRole("navigation", { name: "Open pages" });
  await page.goto(`${APP}/documents`);
  await page.getByRole("link", { name: /Trip Sketch/ }).first().click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(/Trip Sketch/);

  for (const [name, title] of [["Welcome to Folevi", "Welcome to Folevi"], [/Trip Sketch/, /Trip Sketch/], ["Welcome to Folevi", "Welcome to Folevi"]] as const) {
    // Every frame from the click until the note shows: none may be the empty placeholder.
    await page.evaluate(() => {
      const w = window as unknown as { __placeholder: boolean; __watch: boolean };
      w.__placeholder = false;
      w.__watch = true;
      const tick = () => {
        if (document.querySelector('[aria-label="Loading document"]')) w.__placeholder = true;
        if (w.__watch) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await tabs.getByRole("link", { name }).click();
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(title);
    await expect(page.locator(".ProseMirror > *").first()).toBeVisible();
    expect(await page.evaluate(() => ((window as unknown as { __watch: boolean }).__watch = false, (window as unknown as { __placeholder: boolean }).__placeholder)), `placeholder while switching to ${String(title)}`).toBe(false);
  }
});
