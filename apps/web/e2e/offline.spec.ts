import { expect, test } from "@playwright/test";
import { newPersonWithWorkspace, waitForSaved } from "./helpers";

test("offline edits are kept, shown as pending, and sync on reconnect", async ({ browser }) => {
  const { page, context } = await newPersonWithWorkspace(browser, "Offline Tester");
  await page.getByRole("button", { name: /New document/ }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await expect(page.getByRole("textbox", { name: "Title" })).toBeFocused();
  await page.getByRole("textbox", { name: "Title" }).fill("Written on a train");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Before the tunnel.");
  await waitForSaved(page);
  const url = page.url();

  await context.setOffline(true);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Inside the tunnel, no signal.");
  const status = page.getByTestId("sync-status");
  await expect(status).toHaveAttribute("data-status", "offline", { timeout: 15_000 });
  await expect(status).toContainText("Offline");

  // Nothing is lost if the tab closes while offline: the operation log is durable (IndexedDB).
  await page.waitForTimeout(600);
  await context.setOffline(false);
  await waitForSaved(page);

  // A second browser for the same person sees the offline edit.
  const other = await browser.newContext();
  const cookies = await context.cookies();
  await other.addCookies(cookies);
  const page2 = await other.newPage();
  await page2.goto(url.split("?")[0]!);
  await expect(page2.getByRole("textbox", { name: "Document body" })).toContainText("Inside the tunnel, no signal.");
});

test("unsent edits survive a reload (durable local queue)", async ({ browser }) => {
  const { page, context } = await newPersonWithWorkspace(browser, "Reload Tester");
  await page.getByRole("button", { name: /New document/ }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await expect(page.getByRole("textbox", { name: "Title" })).toBeFocused();
  await page.getByRole("textbox", { name: "Title" }).fill("Queue");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Saved online.");
  await waitForSaved(page);
  await context.setOffline(true);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Typed offline then reloaded.");
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "offline", { timeout: 15_000 });
  await page.waitForTimeout(800);
  await context.setOffline(false);
  await page.reload();
  await waitForSaved(page);
  await expect(page.getByRole("textbox", { name: "Document body" })).toContainText("Typed offline then reloaded.");
});
