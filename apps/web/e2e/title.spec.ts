import { expect, test } from "@playwright/test";
import { newPerson, waitForSaved } from "./helpers";

test("typing the title of an existing note in bursts keeps every word", async ({ browser }) => {
  test.setTimeout(240_000);
  const { page, context } = await newPerson(browser, "Title Typist");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  const title = page.getByRole("textbox", { name: "Title" });
  await page.keyboard.type("Start");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Body text");
  await waitForSaved(page);
  await page.reload();
  await expect(title).toHaveValue("Start");
  const log: string[] = [];
  for (const pause of [320, 360, 420, 500, 650, 800, 1000, 340, 380, 450]) {
    await title.click();
    await title.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
    await page.keyboard.type(` w${pause}`, { delay: 30 });
    await page.waitForTimeout(pause);
    log.push(await title.inputValue());
  }
  await page.waitForTimeout(3000);
  const v = await title.inputValue();
  expect(v).toBe("Start w320 w360 w420 w500 w650 w800 w1000 w340 w380 w450");
  await context.close();
});
