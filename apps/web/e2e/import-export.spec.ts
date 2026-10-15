import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { newPerson, showFolders } from "./helpers";

test("import Markdown with a warning report, then export a page as Markdown", async ({ browser }) => {
  const { page } = await newPerson(browser, "Importer");
  await page.goto("/settings/data");
  const md = ["---", "title: Garden log", "---", "", "## Beds", "", "- [x] Compost", "- [ ] Sow beans", "", "```python", "print('hi')", "```", "", "<div>raw html</div>", ""].join("\n");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "garden.md", mimeType: "text/markdown", buffer: Buffer.from(md) });
  await expect(page.getByRole("link", { name: "garden.md" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Raw HTML was imported as plain text/)).toBeVisible();
  await page.getByRole("link", { name: "garden.md" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Garden log");
  const body = page.getByRole("textbox", { name: "Document body" });
  await expect(body.locator('[data-block="todo"][data-checked="true"]')).toHaveText("Compost");
  await expect(body.locator("pre")).toContainText("print('hi')");

  await page.getByRole("button", { name: "Document actions" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export…" }).click();
  await page.getByRole("dialog", { name: /^Export “/ }).getByRole("button", { name: "Export Markdown" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Garden log.md");
  const text = await (await download.createReadStream()).toArray();
  const content = Buffer.concat(text).toString("utf8");
  expect(content).toContain("# Garden log");
  expect(content).toContain("- [x] Compost");
  expect(content).toContain("```python");
});

test("import a folder: its subfolders come along, three levels deep, and a second import reuses them", async ({ browser }, testInfo) => {
  const { page } = await newPerson(browser, "Folder Importer");
  // A folder on disk, as the folder picker hands it over (each file with its path inside the folder).
  const root = testInfo.outputPath("Vault");
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  write("readme.md", "# Readme\n\nStart here.");
  write("Projects/notes.md", "# Project notes\n\nOne.");
  write("Projects/2026/plan.md", "# Plan for 2026\n\nTwo.");
  await page.goto("/settings/data");
  await page.locator('input[type="file"][webkitdirectory]').setInputFiles(root);
  await expect(page.getByRole("link", { name: "Vault/Projects/2026/plan.md" })).toBeVisible({ timeout: 30_000 });

  await showFolders(page);
  const nav = page.getByRole("navigation", { name: "Folio" });
  await expect(nav.getByRole("link", { name: "Vault", exact: true })).toBeVisible();
  const inVault = nav.getByRole("group", { name: "In Vault" });
  await expect(inVault.getByRole("link", { name: "Projects", exact: true })).toBeVisible();
  const inProjects = nav.getByRole("group", { name: "In Projects" });
  await inProjects.getByRole("link", { name: "2026", exact: true }).click();
  await expect(page.getByRole("main").getByText("Plan for 2026")).toBeVisible();
  await expect(page.getByRole("main").getByText("Project notes")).toHaveCount(0);

  // The same folder again with one more file: no second Vault, the new page goes in the Projects already there.
  write("Projects/more.md", "# More notes\n\nThree.");
  await page.goto("/settings/data");
  await page.locator('input[type="file"][webkitdirectory]').setInputFiles(root);
  await expect(page.getByRole("link", { name: "Vault/Projects/more.md" })).toBeVisible({ timeout: 30_000 });
  await showFolders(page);
  await expect(nav.getByRole("link", { name: "Vault", exact: true })).toHaveCount(1);
  await expect(inVault.getByRole("link", { name: "Projects", exact: true })).toHaveCount(1);
  await inVault.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("main").getByText("More notes")).toBeVisible();
});
