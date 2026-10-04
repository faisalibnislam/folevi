import { expect, test } from "@playwright/test";
import { newPerson } from "./helpers";

test("comments tab lists, jumps and manages threads", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Commenter");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.keyboard.type("Comments test");
  await page.keyboard.press("Enter");
  await page.keyboard.type("First line to discuss");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second line");
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(2500);
  await page.keyboard.press("ControlOrMeta+Alt+m");
  const thread = page.getByRole("textbox", { name: /comment|Reply/i }).first();
  await thread.fill("Is this right?");
  await page.keyboard.press("Enter");
  await expect(page.locator(".fb-comment-chip")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  // Dock: no Comments, Share or Info; the "…" menu has Share and Info.
  const dock = page.getByRole("toolbar", { name: "Page tools" });
  await expect(dock.getByRole("button", { name: /^Comments/ })).toHaveCount(0);
  await expect(dock.getByRole("button", { name: "Share" })).toHaveCount(0);
  await expect(dock.getByRole("button", { name: "Info" })).toHaveCount(0);
  await dock.getByRole("button", { name: "Document actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Share…" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Info" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Sidebar Comments tab.
  await page.getByRole("tab", { name: /^Comments/ }).click();
  const list = page.getByRole("tabpanel");
  await expect(list.getByText("Is this right?")).toBeVisible();
  await list.getByText("Is this right?").click();
  await expect(page.locator("section").filter({ hasText: "Is this right?" }).first()).toBeVisible();
  // Resolve from the list's menu.
  await list.getByRole("listitem").first().hover();
  await list.getByRole("button", { name: "Thread actions" }).first().click();
  await page.getByRole("menuitem", { name: "Resolve" }).click();
  await expect(list.getByText("No open comments.")).toBeVisible();
  await list.getByRole("button", { name: /^Resolved/ }).click();
  await expect(list.getByText("Is this right?")).toBeVisible();
  await context.close();
});
