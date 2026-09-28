import { expect, test } from "@playwright/test";
import { newPersonWithWorkspace, waitForSaved } from "./helpers";

test.describe("editor", () => {
  test("create a document, write with Markdown shortcuts and the slash menu, and it persists", async ({ browser }) => {
    const { page } = await newPersonWithWorkspace(browser, "Editor Tester");
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
    const title = page.getByRole("textbox", { name: "Title" });
    await expect(title).toHaveValue("");
    await expect(title).toBeFocused();
    await title.fill("Harbor notes");
    await page.keyboard.press("Enter");
    const body = page.getByRole("textbox", { name: "Document body" });
    await expect(body).toBeFocused();
    await page.keyboard.type("## Plan");
    await page.keyboard.press("Enter");
    await page.keyboard.type("- Pack wool socks");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Thermos");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter"); // empty list item ends the list
    await page.keyboard.type("[] Book the ferry");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/quote");
    await expect(page.getByRole("option", { name: /Quote/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await page.keyboard.type("Slow is smooth.");
    await waitForSaved(page);

    await expect(body.locator("h3")).toHaveText("Plan");
    await expect(body.locator('[data-block="bulleted"]')).toHaveCount(2);
    await expect(body.locator('[data-block="todo"]')).toHaveCount(1);
    await expect(body.locator("blockquote")).toHaveText("Slow is smooth.");

    await page.reload();
    const reloaded = page.getByRole("textbox", { name: "Document body" });
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Harbor notes");
    await expect(reloaded.locator("h3")).toHaveText("Plan");
    await expect(reloaded.locator('[data-block="bulleted"]').nth(1)).toHaveText("Thermos");
    await expect(reloaded.locator('[data-block="todo"]')).toContainText("Book the ferry");
    await expect(reloaded.locator("blockquote")).toHaveText("Slow is smooth.");
  });

  test("formatting shortcuts, nesting, moving and undo", async ({ browser }) => {
    const { page } = await newPersonWithWorkspace(browser, "Format Tester");
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("");
    await page.getByRole("textbox", { name: "Title" }).fill("Formatting");
    await page.keyboard.press("Enter");
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.type("first ");
    await page.keyboard.press(`${mod}+b`);
    await page.keyboard.type("bold");
    await page.keyboard.press(`${mod}+b`);
    await page.keyboard.press("Enter");
    await page.keyboard.type("- parent");
    await page.keyboard.press("Enter");
    await page.keyboard.type("child");
    await page.keyboard.press("Tab");
    const body = page.getByRole("textbox", { name: "Document body" });
    await expect(body.locator("strong")).toHaveText("bold");
    await expect(body.locator('[data-block="bulleted"][data-depth="1"]')).toHaveText("child");
    // Move the nested block up with Alt+Shift+Up: it becomes the first list item group's leader.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Alt+Shift+ArrowUp");
    await expect(body.locator('[data-block="bulleted"]').first()).toHaveText("child");
    await page.keyboard.press(`${mod}+z`);
    await expect(body.locator('[data-block="bulleted"]').first()).toHaveText("parent");
    await waitForSaved(page);
  });
});
