import { expect, test, type Page } from "@playwright/test";
import { newPerson, waitForSaved } from "./helpers";

async function newPage(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  const t = page.getByRole("textbox", { name: "Title" });
  await expect(t).toBeFocused();
  await t.fill(title);
  await page.keyboard.press("Enter");
  return page.url().replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");
}

test("a [[ link to a page in Trash is crossed out, and comes back when it's restored", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await newPerson(browser, "Linker");
  const source = await newPage(page, "Source page");
  await page.keyboard.type("see [[Target");
  await page.getByRole("option", { name: /Create page “Target”/ }).click();
  await waitForSaved(page);
  const link = page.locator(".fb-editor a[data-page-link]");
  await expect(link).toBeVisible();
  await expect(link).not.toHaveClass(/fb-page-link-gone/);
  // Open the target and move it to Trash.
  await link.click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}$/);
  const target = page.url().replace(/^https?:\/\/[^/]+/, "");
  await page.getByRole("group", { name: "Page" }).getByRole("button", { name: "Document actions" }).click();
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  await expect(page.getByText("Moved to Trash")).toBeVisible();
  await page.goto(source);
  await expect(page.locator(".fb-editor a[data-page-link]")).toHaveClass(/fb-page-link-gone/, { timeout: 15_000 });
  await expect(page.locator(".fb-editor a[data-page-link]")).toHaveAttribute("title", "This page is in Trash");
  // Restored: a normal link again.
  await page.goto(target);
  await page.getByRole("group", { name: "Page" }).getByRole("button", { name: "Document actions" }).click();
  await page.getByRole("menuitem", { name: "Restore from Trash" }).click();
  await expect(page.getByText("Restored")).toBeVisible();
  await page.goto(source);
  await expect(page.locator(".fb-editor a[data-page-link]")).not.toHaveClass(/fb-page-link-gone/, { timeout: 15_000 });
  await context.close();
});
