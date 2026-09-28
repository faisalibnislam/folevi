import { expect, test } from "@playwright/test";
import { newPersonWithWorkspace } from "./helpers";

test("import Markdown with a warning report, then export a page as Markdown", async ({ browser }) => {
  const { page } = await newPersonWithWorkspace(browser, "Importer");
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
  await page.getByRole("menuitem", { name: "Export as Markdown" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Garden log.md");
  const text = await (await download.createReadStream()).toArray();
  const content = Buffer.concat(text).toString("utf8");
  expect(content).toContain("# Garden log");
  expect(content).toContain("- [x] Compost");
  expect(content).toContain("```python");
});
