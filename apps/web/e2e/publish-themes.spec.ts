import { expect, test } from "@playwright/test";
import { newPerson, openShare, pick, waitForSaved } from "./helpers";

// Themed publishing: a public link's page takes the look chosen in the Share dialog (Article here), and the
// look can be changed later (Docs adds contents beside the page on wide screens; Minimal drops the cover).

test("publish a note with the Article look, then switch it to Docs and Minimal", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Page Publisher");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill("Field guide");
  await page.keyboard.press("Enter");
  await page.keyboard.type("# Getting there");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Take the coast road.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("## What to bring");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Boots and a flask.");
  await waitForSaved(page);

  await openShare(page);
  const share = page.getByRole("dialog", { name: /Share/ });
  const looks = share.getByRole("radiogroup", { name: "Look" });
  await expect(looks.getByRole("radio", { name: /^Note/ })).toHaveAttribute("aria-checked", "true");
  await looks.getByRole("radio", { name: /^Article/ }).click();
  await expect(looks.getByRole("radio", { name: /^Article/ })).toHaveAttribute("aria-checked", "true");
  await share.getByRole("button", { name: "Create link" }).click();
  const link = await share.getByLabel("Public link").inputValue();

  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const reader = await anon.newPage();
  await reader.goto(link);
  await expect(reader.getByRole("heading", { level: 1, name: "Field guide" })).toBeVisible();
  const sheet = reader.locator("article.fb-page");
  await expect(sheet).toHaveAttribute("data-publish", "article");
  await expect(sheet).toHaveAttribute("data-font", "serif");
  await expect(sheet).toHaveAttribute("data-width", "narrow");
  await expect(reader.getByRole("navigation", { name: "Contents" })).toHaveCount(0);

  // Docs: wide, with the headings as contents beside the page; a contents link jumps to its heading.
  const look = share.getByRole("combobox", { name: /^Look of the link/ });
  await expect(look).toContainText("Article");
  await pick(look, "Docs");
  await expect(share.page().getByRole("status").filter({ hasText: "Look changed" })).toBeVisible();
  await reader.reload();
  await expect(sheet).toHaveAttribute("data-publish", "docs");
  await expect(sheet).toHaveAttribute("data-width", "wide");
  const contents = reader.getByRole("navigation", { name: "Contents" });
  await expect(contents.getByRole("link")).toHaveText(["Getting there", "What to bring"]);
  await contents.getByRole("link", { name: "What to bring" }).click();
  await expect(reader).toHaveURL(/#block-[0-9A-Z]{26}$/);
  await expect(reader.getByRole("heading", { name: "What to bring" })).toBeInViewport();

  // Minimal: plain paper, no cover band.
  await pick(look, "Minimal");
  await expect(share.page().getByRole("status").filter({ hasText: "Look changed" }).first()).toBeVisible();
  await expect.poll(async () => {
    await reader.reload();
    return await sheet.getAttribute("data-publish");
  }).toBe("minimal");
  await expect(sheet).toHaveAttribute("data-background", "plain");
  await anon.close();
  await context.close();
});
