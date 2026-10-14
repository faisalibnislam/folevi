import { expect, test } from "@playwright/test";
import { createWorkspace, newPerson, pickDate, showFolders, switchTo } from "./helpers";

test("quick add a task with a due date, see it in Today and the calendar, complete it", async ({ browser }) => {
  const { page } = await newPerson(browser, "Task Tester");
  await showFolders(page);
  await page.getByRole("link", { name: /^Tasks( \d+)?$/ }).click();
  await page.getByRole("button", { name: "Add task" }).click();
  const dialog = page.getByRole("dialog", { name: "Quick add task" });
  await dialog.getByLabel("Task").fill("Water the tomatoes");
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  await dialog.getByRole("button", { name: /^Due date/ }).click();
  await pickDate(page.getByRole("dialog", { name: "Choose due date" }), today);
  await dialog.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task added" })).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: "Water the tomatoes" });
  await expect(row).toBeVisible();
  // The task lives in the person's Inbox page and links back to it; Daily Notes are gone.
  await expect(row.getByRole("link")).toContainText("Inbox");
  await expect(page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "Daily Notes" })).toHaveCount(0);

  await page.getByRole("link", { name: "Calendar" }).first().click();
  await expect(page.getByRole("gridcell").filter({ hasText: "Water the tomatoes" })).toBeVisible();

  await page.getByRole("link", { name: /^Tasks( \d+)?$/ }).click();
  await row.getByRole("checkbox").click();
  await expect(page.getByRole("status").filter({ hasText: "Task completed" })).toBeVisible();
  await page.getByRole("link", { name: "Completed" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Water the tomatoes" })).toBeVisible();
});

test("tasks follow the current context: a workspace's tasks aren't listed in Personal", async ({ browser }) => {
  const { page } = await newPerson(browser, "Task Switcher");
  await createWorkspace(page, "Task Studio");
  await page.getByRole("link", { name: /^Tasks( \d+)?$/ }).click();
  await page.getByRole("button", { name: "Add task" }).click();
  const dialog = page.getByRole("dialog", { name: "Quick add task" });
  await dialog.getByLabel("Task").fill("Order studio chairs");
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  await dialog.getByRole("button", { name: /^Due date/ }).click();
  await pickDate(page.getByRole("dialog", { name: "Choose due date" }), today);
  await dialog.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task added" })).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: "Order studio chairs" });
  await expect(row).toBeVisible();

  // Personal has its own Tasks and Calendar: the workspace's task isn't there.
  await switchTo(page, "Personal");
  await page.getByRole("link", { name: /^Tasks( \d+)?$/ }).click();
  await expect(page).toHaveURL(/\/tasks/);
  await expect(row).toHaveCount(0);
  await page.getByRole("link", { name: "Calendar" }).first().click();
  await expect(page).toHaveURL(/\/calendar/);
  await expect(page.getByRole("gridcell").filter({ hasText: "Order studio chairs" })).toHaveCount(0);

  // Back in the workspace, it's there again.
  await switchTo(page, "Task Studio");
  await page.getByRole("link", { name: /^Tasks( \d+)?$/ }).click();
  await expect(row).toBeVisible();
});

test("quick add reads a date written in the task", async ({ browser }) => {
  const { page } = await newPerson(browser, "Plain Words");
  await showFolders(page);
  await page.getByRole("link", { name: /^Tasks( \d+)?$/ }).click();
  await page.getByRole("button", { name: "Add task" }).click();
  const dialog = page.getByRole("dialog", { name: "Quick add task" });
  await dialog.getByLabel("Task").fill("Call the plumber tomorrow 4pm");
  await expect(dialog.getByText("Due Tomorrow, 16:00")).toBeVisible();
  await dialog.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task added" })).toBeVisible();
  // Saved without the date words, due tomorrow.
  await page.getByRole("link", { name: "Upcoming" }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Call the plumber" });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("tomorrow 4pm");

  // Words that only look like a date can be kept as text.
  await page.getByRole("button", { name: "Add task" }).click();
  await dialog.getByLabel("Task").fill("Read Friday Night Lights");
  await dialog.getByRole("button", { name: /^Keep “.*” as text$/ }).click();
  await expect(dialog.locator("#qa-when")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task added" }).last()).toBeVisible();
});

test("a task can be moved to another page from its menu", async ({ browser }) => {
  const { page } = await newPerson(browser, "Task Mover");
  await showFolders(page);
  await page.getByRole("link", { name: /^Tasks( \d+)?$/ }).click();
  await page.getByRole("button", { name: "Add task" }).click();
  const dialog = page.getByRole("dialog", { name: "Quick add task" });
  await dialog.getByLabel("Task").fill("Book the venue");
  await dialog.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task added" })).toBeVisible();
  await page.getByRole("link", { name: /^All( \d+)?$/ }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Book the venue" });
  await expect(row.getByRole("link")).toContainText("Inbox");

  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  const move = page.getByRole("dialog", { name: "Move task" });
  await move.getByLabel("Move to").fill("Atlas");
  await move.getByRole("option", { name: /Project Atlas Brief/ }).click();
  await move.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task moved to Project Atlas Brief" })).toBeVisible();
  await expect(row.getByRole("link")).toContainText("Project Atlas Brief");
});
