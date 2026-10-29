import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
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
  const root = testInfo.outputPath("Notebook");
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  write("readme.md", "# Readme\n\nStart here.");
  write("Projects/notes.md", "# Project notes\n\nOne.");
  write("Projects/2026/plan.md", "# Plan for 2026\n\nTwo.");
  await page.goto("/settings/data");
  await page.locator('input[type="file"][webkitdirectory]').setInputFiles(root);
  await expect(page.getByRole("link", { name: "Notebook/Projects/2026/plan.md" })).toBeVisible({ timeout: 30_000 });

  await showFolders(page);
  const nav = page.getByRole("navigation", { name: "Folio" });
  await expect(nav.getByRole("link", { name: "Notebook", exact: true })).toBeVisible();
  const inNotebook = nav.getByRole("group", { name: "In Notebook" });
  await expect(inNotebook.getByRole("link", { name: "Projects", exact: true })).toBeVisible();
  const inProjects = nav.getByRole("group", { name: "In Projects" });
  await inProjects.getByRole("link", { name: "2026", exact: true }).click();
  await expect(page.getByRole("main").getByText("Plan for 2026")).toBeVisible();
  await expect(page.getByRole("main").getByText("Project notes")).toHaveCount(0);

  // The same folder again with one more file: no second Notebook, the new page goes in the Projects already there.
  write("Projects/more.md", "# More notes\n\nThree.");
  await page.goto("/settings/data");
  await page.locator('input[type="file"][webkitdirectory]').setInputFiles(root);
  await expect(page.getByRole("link", { name: "Notebook/Projects/more.md" })).toBeVisible({ timeout: 30_000 });
  await showFolders(page);
  await expect(nav.getByRole("link", { name: "Notebook", exact: true })).toHaveCount(1);
  await expect(inNotebook.getByRole("link", { name: "Projects", exact: true })).toHaveCount(1);
  await inNotebook.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("main").getByText("More notes")).toBeVisible();
});

test("import a ZIP with a Word document and an HTML page: both come along, in their folders", async ({ browser }) => {
  const { page } = await newPerson(browser, "Zip Importer");
  // A Word document cut down to what Word needs: the package, its relationships and the text.
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const docx = zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    "_rels/.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/document.xml": strToU8(`<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:r><w:t>Pour the slab on Monday.</w:t></w:r></w:p></w:body></w:document>`),
  });
  const zip = zipSync({
    "Work/Site plan.docx": docx,
    "Web/trip.html": strToU8("<html><head><title>Ferry trip</title></head><body><p>Ferry on Friday.</p></body></html>"),
  });
  await page.goto("/settings/data");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "Site docs.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
  await expect(page.getByRole("link", { name: "Site docs/Work/Site plan.docx" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Site docs/Web/trip.html" })).toBeVisible();

  await page.getByRole("link", { name: "Site docs/Work/Site plan.docx" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Site plan");
  await expect(page.getByRole("textbox", { name: "Document body" })).toContainText("Pour the slab on Monday.");

  await showFolders(page);
  const nav = page.getByRole("navigation", { name: "Folio" });
  await expect(nav.getByRole("link", { name: "Site docs", exact: true })).toBeVisible();
  const inZip = nav.getByRole("group", { name: "In Site docs" });
  await inZip.getByRole("link", { name: "Web", exact: true }).click();
  await expect(page.getByRole("main").getByText("Ferry trip")).toBeVisible();
  await expect(page.getByRole("main").getByText("Site plan")).toHaveCount(0);
});
