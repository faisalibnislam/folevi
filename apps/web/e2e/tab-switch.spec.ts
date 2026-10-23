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

// A hidden tab's note isn't kept as a page; coming back to it shows it where it was left (lib/app/noteViewState.ts):
// the same scroll position, and the caret on the same line with the keyboard in the note.
test("a tab comes back where it was left: scroll and caret", async ({ browser }) => {
  test.setTimeout(150_000);
  const { page } = await newPerson(browser, "Place Person");
  const tabs = page.getByRole("navigation", { name: "Open pages" });
  await page.goto(`${APP}/documents`);
  await page.getByRole("link", { name: "Welcome to Folevi" }).first().click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Welcome to Folevi");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill("A long note");
  await page.keyboard.press("Enter");
  for (let i = 1; i <= 70; i++) {
    await page.keyboard.type(`Line ${i}`);
    await page.keyboard.press("Enter");
  }
  await expect(page.locator(".ProseMirror p", { hasText: /^Line 70$/ })).toBeVisible();
  // The caret on line 40, the page scrolled to show it a little way down.
  const line = page.locator(".ProseMirror p", { hasText: /^Line 40$/ });
  await line.scrollIntoViewIfNeeded();
  await line.click();
  await page.keyboard.press("End");
  const scroller = page.locator("#doc-scroll");
  const caretLine = () => page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest("p")?.textContent ?? window.getSelection()?.anchorNode?.textContent ?? null);
  expect(await caretLine()).toBe("Line 40");
  // Where the page settled, as the person leaves it.
  await page.waitForTimeout(500);
  const at = await scroller.evaluate((el) => el.scrollTop);
  expect(at).toBeGreaterThan(300);

  await tabs.getByRole("link", { name: "Welcome to Folevi" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Welcome to Folevi");
  await tabs.getByRole("link", { name: "A long note" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("A long note");

  await expect.poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 5000 }).toBeGreaterThan(at - 40);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeLessThan(at + 40);
  expect(await caretLine()).toBe("Line 40");
  await expect(page.locator(".ProseMirror")).toBeFocused();
  // Typing goes on where it stopped.
  await page.keyboard.type(" and more");
  await expect(page.locator(".ProseMirror p", { hasText: /^Line 40 and more$/ })).toBeVisible();
});
