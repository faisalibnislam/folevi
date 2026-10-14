import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { newPerson, waitForSaved } from "./helpers";

/**
 * A second window on the account with only its sign-in cookies: no IndexedDB queue and no journal of this
 * device, so it shows what the server holds.
 */
async function serverView(browser: Browser, context: BrowserContext, url: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const { cookies } = await context.storageState();
  const viewer = await browser.newContext({ storageState: { cookies, origins: [] } });
  const page = await viewer.newPage();
  await page.goto(url);
  return { page, close: () => viewer.close() };
}

/** New note, from wherever the page is; returns the note's address (without ?new=1) once its title has the caret. */
async function openNewNote(page: Page): Promise<string> {
  const before = page.url();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL((u) => /\/d\/[0-9A-Z]{26}\?new=1/.test(u.toString()) && u.toString() !== before);
  await expect(page.getByRole("textbox", { name: "Title" })).toBeFocused();
  return page.url().replace(/\?.*$/, "");
}

test("what's typed straight after a new note's title is saved, every time", async ({ browser }) => {
  test.setTimeout(240_000);
  const { page, context } = await newPerson(browser, "Quick Typist");
  const body = page.getByRole("textbox", { name: "Document body" });
  // A slower device: the editor finishes opening a moment after the note does, while the first keys are already
  // arriving. They used to count as what the note opened with, were never saved, and the server's first answer
  // then took the line away again.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  for (let i = 0; i < 5; i++) {
    const url = await openNewNote(page);
    const line = `First line ${i} typed without a pause`;
    await page.keyboard.type(`Quick note ${i}`);
    await page.keyboard.press("Enter");
    await page.keyboard.type(line);
    await waitForSaved(page);
    await expect(body).toContainText(line);
    const server = await serverView(browser, context, url);
    await expect(server.page.getByRole("textbox", { name: "Title" })).toHaveValue(`Quick note ${i}`, { timeout: 15_000 });
    await expect(server.page.getByRole("textbox", { name: "Document body" })).toContainText(line, { timeout: 15_000 });
    await server.close();
  }
  await context.close();
});

test("a comment on a line typed a moment ago is kept, with the line", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Quick Commenter");
  const url = await openNewNote(page);
  await page.keyboard.type("Comment straight away");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A line to discuss");
  // No pause: the line's save is still waiting when the comment is sent.
  await page.keyboard.press("ControlOrMeta+Alt+m");
  await page.getByRole("textbox", { name: /comment|Reply/i }).first().fill("Is this right?");
  await page.keyboard.press("Enter");
  await expect(page.locator(".fb-comment-chip")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Block not found|hasn’t synced/)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await waitForSaved(page);
  // A line added to the note once it's saved: nothing else is being sent, and line edits wait a moment to go.
  const body = page.getByRole("textbox", { name: "Document body" });
  await body.getByText("A line to discuss").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Another thought");
  await page.keyboard.press("ControlOrMeta+Alt+m");
  await page.getByRole("textbox", { name: /comment|Reply/i }).first().fill("And this one?");
  await page.keyboard.press("Enter");
  await expect(page.locator(".fb-comment-chip")).toHaveCount(2, { timeout: 15_000 });
  await expect(page.getByText(/Block not found|hasn’t synced/)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await waitForSaved(page);
  const server = await serverView(browser, context, url);
  const serverBody = server.page.getByRole("textbox", { name: "Document body" });
  await expect(serverBody).toContainText("A line to discuss", { timeout: 15_000 });
  await expect(serverBody).toContainText("Another thought");
  await expect(server.page.locator(".fb-comment-chip")).toHaveCount(2, { timeout: 15_000 });
  await server.close();
  await context.close();
});
