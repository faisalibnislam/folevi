import { expect, test } from "@playwright/test";
import { newPersonWithWorkspace, showFolders } from "./helpers";

test("quick add a task with a due date, see it in Today and the calendar, complete it", async ({ browser }) => {
  const { page } = await newPersonWithWorkspace(browser, "Task Tester");
  await showFolders(page);
  await page.getByRole("link", { name: /^Tasks/ }).click();
  await page.getByRole("button", { name: "Add task" }).click();
  const dialog = page.getByRole("dialog", { name: "Quick add task" });
  await dialog.getByLabel("Task").fill("Water the tomatoes");
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  await dialog.getByLabel("Due date").fill(today);
  await dialog.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task added" })).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: "Water the tomatoes" });
  await expect(row).toBeVisible();
  // The task lives in the person's Inbox page and links back to it; Daily Notes are gone.
  await expect(row.getByRole("link")).toContainText("Inbox");
  await expect(page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Daily Notes" })).toHaveCount(0);

  await page.getByRole("link", { name: "Calendar" }).first().click();
  await expect(page.getByRole("gridcell").filter({ hasText: "Water the tomatoes" })).toBeVisible();

  await page.getByRole("link", { name: /^Tasks/ }).click();
  await row.getByRole("checkbox").click();
  await expect(page.getByRole("status").filter({ hasText: "Task completed" })).toBeVisible();
  await page.getByRole("link", { name: "Completed" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Water the tomatoes" })).toBeVisible();
});
