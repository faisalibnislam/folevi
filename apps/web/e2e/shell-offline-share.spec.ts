import { expect, test, type Page } from "@playwright/test";
import { newPerson, waitForSaved } from "./helpers";

async function newDocument(page: Page) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await expect(page.getByRole("textbox", { name: "Title" })).toBeFocused();
}

test("phone-width navigation drawer is a modal dialog with a focus trap", async ({ browser }) => {
  const { page, context } = await newPerson(browser, "Drawer Tester");
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForSaved(page);
  const toggle = page.getByRole("button", { name: "Show sidebar" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.focus();
  await page.keyboard.press("Enter");

  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute("aria-modal", "true");
  // Focus moved into the drawer and Tab never leaves it (the page behind is inert).
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press(i % 7 === 6 ? "Shift+Tab" : "Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"][aria-label="Navigation"]')))).toBe(true);
  }
  // Escape closes it and focus returns to the toggle.
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await context.close();
});

test("the sync popover lists pages with changes waiting on this device", async ({ browser }) => {
  const { page, context } = await newPerson(browser, "Queue Viewer");
  await newDocument(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Notes from the ferry");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Written online.");
  await waitForSaved(page);

  await context.setOffline(true);
  await page.getByRole("textbox", { name: "Document body" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Then the signal dropped.");
  const status = page.getByTestId("sync-status");
  await expect(status).toHaveAttribute("data-status", "offline", { timeout: 15_000 });
  await expect(status).toHaveAccessibleName(/Sync status: Offline, \d+ changes? waiting/);

  await status.click();
  const details = page.getByRole("dialog", { name: "Sync details" });
  await expect(details.getByText("Waiting to sync")).toBeVisible();
  const row = details.getByRole("link", { name: /Notes from the ferry/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText(/\d+ changes?/);
  // Escape closes the popover and returns focus to the status button.
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
  await expect(status).toBeFocused();

  await context.setOffline(false);
  await waitForSaved(page);
  await status.click();
  await expect(page.getByRole("dialog", { name: "Sync details" }).getByText("Waiting to sync")).toHaveCount(0);
  await context.close();
});

test("password-protected links keep only a sealed grant, never the password, in cookies", async ({ browser }) => {
  const { page, context } = await newPerson(browser, "Link Owner");
  await newDocument(page);
  await page.getByRole("textbox", { name: "Title" }).fill("Protected plans");
  await waitForSaved(page);
  await page.getByRole("button", { name: "Share" }).click();
  const share = page.getByRole("dialog", { name: /Share/ });
  await share.getByLabel(/Password \(optional/).fill("correct horse battery");
  await share.getByRole("button", { name: "Create link" }).click();
  const link = await share.getByLabel("Public link").inputValue();

  const anon = await browser.newContext();
  const visitor = await anon.newPage();
  await visitor.goto(link);
  await expect(visitor.getByRole("heading", { name: "This page is protected" })).toBeVisible();
  await visitor.getByLabel("Password").fill("wrong password");
  await visitor.getByRole("button", { name: "Open page" }).click();
  await expect(visitor.getByRole("alert").filter({ hasText: "That password isn’t right." })).toBeVisible();
  await visitor.getByLabel("Password").fill("correct horse battery");
  await visitor.getByRole("button", { name: "Open page" }).click();
  await expect(visitor.getByRole("heading", { name: "Protected plans" })).toBeVisible();

  const cookies = await anon.cookies();
  expect(cookies.map((c) => c.name)).toContain("folevi_share_grant");
  for (const c of cookies) {
    expect(decodeURIComponent(c.value)).not.toContain("correct horse");
    expect(Buffer.from(c.value, "base64url").toString("latin1")).not.toContain("correct horse");
  }
  const grant = cookies.find((c) => c.name === "folevi_share_grant")!;
  expect(grant.httpOnly).toBe(true);
  expect(grant.sameSite).toBe("Strict");
  expect(grant.path).toMatch(/^\/s\//);
  // Protected pages are never indexed.
  await expect(visitor.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await anon.close();
  await context.close();
});
