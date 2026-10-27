import { expect, test } from "@playwright/test";
import { newPerson, showFolders, waitForSaved } from "./helpers";

test("a folder inside a folder: make it, file a note in it, and it's all still there after a reload", async ({ browser }) => {
  const { page } = await newPerson(browser, "Nester");
  await showFolders(page);
  const nav = page.getByRole("navigation", { name: "Folio" });

  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Work");
  await page.getByRole("button", { name: "Create folder" }).click();
  await expect(nav.getByRole("link", { name: "Work", exact: true })).toBeVisible();

  // "New folder inside…" from the folder's menu.
  await nav.getByRole("button", { name: "Folder options for Work" }).click();
  await page.getByRole("menuitem", { name: "New folder inside…" }).click();
  await page.getByRole("dialog", { name: "New folder in “Work”" }).getByLabel("Folder name").fill("Clients");
  await page.getByRole("button", { name: "Create folder" }).click();
  const inWork = nav.getByRole("group", { name: "In Work" });
  await expect(inWork.getByRole("link", { name: "Clients" })).toBeVisible();

  // A note filed into the subfolder from its Move dialog, which lists folders as a tree.
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill("Kickoff notes");
  await waitForSaved(page);
  await page.getByRole("button", { name: "Document actions" }).click();
  await page.getByRole("menuitem", { name: "Move…" }).click();
  const picker = page.getByRole("dialog", { name: /^Move “/ });
  await expect(picker.getByRole("option", { name: /^Clients\b.*in Work/ })).toBeVisible();
  await picker.getByRole("option", { name: /^Clients/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Moved to Clients" })).toBeVisible();

  // The folder page: breadcrumbs up to Work, and the note.
  await showFolders(page);
  await inWork.getByRole("link", { name: "Clients" }).click();
  await expect(page.getByRole("main").getByText("Kickoff notes")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Work" })).toBeVisible();

  // Work's page lists the folder inside it.
  await nav.getByRole("link", { name: "Work", exact: true }).click();
  await page.getByRole("list", { name: "Folders inside" }).getByRole("link", { name: /^Clients,/ }).click();
  await expect(page.getByRole("main").getByText("Kickoff notes")).toBeVisible();

  // After a reload: still nested, the note still inside. Closing Work hides Clients, and that's remembered.
  await page.reload();
  await expect(inWork.getByRole("link", { name: "Clients" })).toBeVisible();
  await expect(page.getByRole("main").getByText("Kickoff notes")).toBeVisible();
  await nav.getByRole("link", { name: "Work", exact: true }).click();
  await nav.getByRole("button", { name: "Collapse Work" }).click();
  await expect(nav.getByRole("link", { name: "Clients" })).toHaveCount(0);
  await page.reload();
  await expect(nav.getByRole("button", { name: "Expand Work" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Clients" })).toHaveCount(0);
  await nav.getByRole("button", { name: "Expand Work" }).click();

  // Move folder…: Work can't go inside Clients (its own subfolder); Clients can go to the top level.
  await nav.getByRole("button", { name: "Folder options for Work" }).click();
  await page.getByRole("menuitem", { name: "Move folder…" }).click();
  const moveFolder = page.getByRole("dialog", { name: "Move “Work”" });
  await expect(moveFolder.getByRole("option", { name: /^Clients/ })).toHaveAttribute("aria-disabled", "true");
  await moveFolder.getByRole("button", { name: "Close" }).click();
  await nav.getByRole("button", { name: "Folder options for Clients" }).click();
  await page.getByRole("menuitem", { name: "Move folder…" }).click();
  await page.getByRole("dialog", { name: "Move “Clients”" }).getByRole("option", { name: "Top level" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Moved to the top level" })).toBeVisible();
  await expect(nav.getByRole("group", { name: "In Work" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Clients" })).toBeVisible();

  // Dragging a folder onto another nests it again.
  await nav.getByRole("link", { name: "Clients" }).dragTo(nav.getByRole("link", { name: "Work", exact: true }));
  await expect(nav.getByRole("group", { name: "In Work" }).getByRole("link", { name: "Clients" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Moved “Clients” to Work" })).toBeVisible();
});
