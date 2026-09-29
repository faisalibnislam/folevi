import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { APP, createWorkspace, newPerson, showFolders, pick, settle } from "./helpers";

test("tasks: quick add with priority, My Tasks in Personal, edit/cancel from the list, schedule from the calendar", async ({ browser }) => {
  const { page } = await newPerson(browser, "Planner");
  await showFolders(page);
  await page.getByRole("link", { name: /^Tasks/ }).click();
  await page.getByRole("button", { name: "Add task" }).click();
  const dialog = page.getByRole("dialog", { name: "Quick add task" });
  await dialog.getByLabel("Task").fill("Plan the herb bed");
  await pick(dialog.getByLabel("Priority"), "High");
  await dialog.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task added to Inbox" })).toBeVisible();

  // Personal: unassigned tasks are mine.
  await page.getByRole("link", { name: /^My Tasks/ }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Plan the herb bed" });
  await expect(row).toBeVisible();
  await expect(row.getByText("High")).toBeVisible();

  // Edit metadata without opening the page: cancel it.
  await row.hover();
  await row.getByRole("button", { name: /^Edit “Plan the herb bed”/ }).click();
  const edit = page.getByRole("dialog", { name: "Edit task" });
  await edit.getByRole("button", { name: "Canceled" }).click();
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Plan the herb bed" })).toHaveCount(0);
  await page.getByRole("link", { name: /^Completed/ }).click();
  const closed = page.getByRole("listitem").filter({ hasText: "Plan the herb bed" });
  await expect(closed.getByText("Canceled")).toBeVisible();
  await closed.getByRole("checkbox", { name: /Reopen canceled task/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task reopened" })).toBeVisible();

  // Undated tasks can be scheduled from the calendar.
  await page.getByRole("link", { name: "Calendar" }).first().click();
  const unscheduled = page.getByRole("region", { name: "Unscheduled tasks" });
  await unscheduled.getByRole("button", { name: /Schedule “Plan the herb bed” for today/ }).click();
  await expect(page.getByRole("gridcell").filter({ hasText: "Plan the herb bed" })).toBeVisible();
  await expect(unscheduled.getByText("Plan the herb bed")).toHaveCount(0);

  // Quick Add can put a task into any page, found by search.
  await page.getByRole("link", { name: /^Tasks/ }).click();
  await page.getByRole("button", { name: "Add task" }).click();
  await dialog.getByLabel("Task").fill("Book the seed swap table");
  await dialog.getByRole("combobox", { name: "Add to" }).fill("Atlas Brief");
  await dialog.getByRole("option", { name: /Project Atlas Brief/ }).click();
  await dialog.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task added to Project Atlas Brief" })).toBeVisible();
});

test("organization: tags, templates, missing folders, team workspaces from the switcher", async ({ browser }) => {
  const { page } = await newPerson(browser, "Organizer Two");
  await showFolders(page);
  const nav = page.getByRole("navigation", { name: "Folio" });

  // Tags start collapsed; opened, they can be renamed, recolored and deleted.
  await expect(nav.getByRole("link", { name: "reading" })).toHaveCount(0);
  await nav.getByRole("button", { name: "Expand Tags" }).click();
  await expect(nav.getByRole("link", { name: "reading" })).toBeVisible();
  await nav.getByRole("link", { name: "reading" }).hover();
  await nav.getByRole("button", { name: "Tag options for reading" }).click();
  await page.getByRole("menuitem", { name: "Edit tag…" }).click();
  const tagDialog = page.getByRole("dialog", { name: "Edit tag" });
  await tagDialog.getByLabel("Name").fill("books");
  await tagDialog.getByText("Moss").click();
  await tagDialog.getByRole("button", { name: "Save" }).click();
  await expect(nav.getByRole("link", { name: "books" })).toBeVisible();
  await nav.getByRole("link", { name: "travel" }).hover();
  await nav.getByRole("button", { name: "Tag options for travel" }).click();
  await page.getByRole("menuitem", { name: "Delete tag…" }).click();
  await page.getByRole("dialog", { name: "Delete #travel?" }).getByRole("button", { name: "Delete tag" }).click();
  await expect(nav.getByRole("link", { name: "travel" })).toHaveCount(0);

  // A folder link that doesn't resolve shows a real not-found page.
  await page.goto(`${APP}/folders/01NOTAREALFOLDER0000000000`);
  await expect(page.getByRole("heading", { name: "This folder isn’t here" })).toBeVisible();

  // Start a page from a user template.
  await nav.getByRole("link", { name: "Templates" }).click();
  await page.getByRole("button", { name: "New page from template Weekly Reset" }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Weekly Reset");
  await expect(page.getByRole("textbox", { name: "Document body" })).not.toBeEmpty();

  // Personal has no members (single pages are shared instead); a workspace made from the switcher does.
  await page.goto(`${APP}/settings/members`);
  await expect(page.getByRole("heading", { name: "You're in Personal" })).toBeVisible();
  await expect(page.getByText(/Invite collaborators/)).toHaveCount(0);
  await expect(page.getByLabel("Email")).toHaveCount(0);
  await createWorkspace(page, "Garden Club");
  await page.goto(`${APP}/settings/members`);
  await expect(page.getByRole("navigation", { name: "Settings sections" }).getByText("Garden Club")).toBeVisible();
  await page.getByLabel("Email").fill("garden-friend@example.com");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Invitation sent to garden-friend@example.com" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "garden-friend@example.com" })).toBeVisible();
});

test("organization views have no serious accessibility violations (light and dark)", async ({ browser }) => {
  // Seven pages in two themes, each scanned by axe.
  test.setTimeout(300_000);
  const { page } = await newPerson(browser, "A11y Organizer");
  await showFolders(page);
  const views = ["/tasks/all", "/tasks/completed", "/settings/workspace", "/settings/members", "/templates", "/folders/01NOTAREALFOLDER0000000000", "/documents"];
  for (const scheme of ["light", "dark"] as const) {
    await page.evaluate((s) => localStorage.setItem("folevi:appearance", s), scheme);
    for (const path of views) {
      await page.goto(`${APP}${path}`);
      await page.waitForTimeout(1200);
      await settle(page);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).disableRules(["region"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${scheme} ${path}: ${v.id} — ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    }
  }
  // The task editor dialog.
  await page.goto(`${APP}/tasks/all`);
  const row = page.getByRole("listitem").first();
  await row.hover();
  await row.getByRole("button", { name: /^Edit/ }).click();
  await expect(page.getByRole("dialog", { name: "Edit task" })).toBeVisible();
  await page.waitForTimeout(500); // let the open animation finish before measuring contrast
  const dialog = await new AxeBuilder({ page }).include("dialog[open]").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(dialog.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} — ${v.nodes.map((n) => `${n.target.join(" ")} ${n.failureSummary ?? ""}`).slice(0, 4).join(" | ")}`)).toEqual([]);
});
