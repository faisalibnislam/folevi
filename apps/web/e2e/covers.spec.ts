import { expect, test } from "@playwright/test";
import { newPerson, waitForSaved, showFolders, openTool } from "./helpers";

test("pick one of the note styles (or Plain) from the inspector; it persists", async ({ browser }) => {
  const { page } = await newPerson(browser, "Cover Picker");
  await showFolders(page);
  await openTool(page, "Style");
  // "Note Style": one row, named after the current artwork; no accent colours, no style gallery.
  const noteStyle = page.getByRole("group", { name: "Note Style" });
  await noteStyle.getByRole("button").first().click();
  await expect(page.getByRole("button", { name: "All styles" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Accent / })).toHaveCount(0);
  const styles = page.getByRole("radiogroup", { name: "Note style" }).getByRole("radio", { name: /^Note style: / });
  await expect(styles).toHaveCount(57);
  await page.getByRole("radio", { name: "Note style: Irises" }).click();
  await expect(page.getByRole("radio", { name: "Note style: Irises" })).toHaveAttribute("aria-checked", "true");
  await expect(noteStyle.getByRole("button", { name: "Irises" })).toBeVisible();
  // Auto colours come from the style: a light page and dark text in its hue.
  await expect(page.locator("article.fb-sheet")).toHaveAttribute("data-sheet", "art");
  await expect(page.locator("article.fb-sheet")).toHaveAttribute("data-text", "art");
  const cover = page.locator("article.fb-sheet header [data-cover-image]");
  await expect(cover).toHaveAttribute("style", /\/covers\/art-03\.webp/);
  // The same artwork is the page background behind the note.
  await expect(page.locator("#doc-scroll")).toHaveAttribute("style", /\/covers\/art-03\.webp/);
  await page.getByRole("radio", { name: "Plain" }).click();
  await expect(page.locator("#doc-scroll")).not.toHaveAttribute("style", /art-03/);
  await expect(page.locator("article.fb-sheet header [data-cover-image]")).toHaveCount(0);
  await page.getByRole("radio", { name: "Note style: Irises" }).click();
  await expect(page.locator("#doc-scroll")).toHaveAttribute("style", /\/covers\/art-03\.webp/);
  // Blur background: the artwork moves to a blurred layer behind the page; the page itself stays sharp.
  const blur = page.getByRole("switch", { name: "Blur background" });
  await expect(blur).toHaveAttribute("aria-checked", "false");
  await blur.click();
  await expect(blur).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#doc-scroll")).toHaveAttribute("data-backdrop", "blur");
  await expect(page.locator("[data-backdrop-blur]:has(+ #doc-scroll) > div")).toHaveAttribute("style", /\/covers\/art-03\.webp/);
  await waitForSaved(page);
  await page.reload();
  await expect(page.locator("article.fb-sheet header [data-cover-image]")).toHaveAttribute("style", /\/covers\/art-03\.webp/);
  await expect(page.locator("#doc-scroll")).toHaveAttribute("data-backdrop", "blur");
  // The sidebar says Home, and there is no Daily Notes entry.
  const nav = page.getByRole("navigation", { name: "Folio" });
  await expect(nav.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Daily Notes" })).toHaveCount(0);
});

test("page styles and block formatting persist (Style and Format tabs)", async ({ browser }) => {
  const { page } = await newPerson(browser, "Style Person");

  // Style: the note's artwork (cover and page background), then a dark document colour.
  await openTool(page, "Style");
  await page.getByRole("group", { name: "Note Style" }).getByRole("button").first().click();
  await page.getByRole("radio", { name: "Note style: Parchment" }).click();
  await page.getByRole("button", { name: "Document color" }).click();
  await page.getByRole("radio", { name: "Document color: Night" }).click();
  const sheet = page.locator("article.fb-sheet");
  // The artwork is both the cover and the page background.
  await expect(page.locator("article.fb-sheet header [data-cover-image]")).toHaveAttribute("style", /\/covers\/art-08\.webp/);
  await expect(page.locator("#doc-scroll")).toHaveAttribute("style", /\/covers\/art-08\.webp/);
  await expect(sheet).toHaveAttribute("data-sheet", "night");
  await expect(sheet).toHaveAttribute("data-text", "white");
  await expect(page.locator("#doc-scroll")).toHaveAttribute("data-backdrop", "on");
  await page.getByRole("button", { name: "Separator: Doodle" }).click();
  await expect(sheet).toHaveAttribute("data-separator", "doodle");
  // Page width: Wide by default; Narrow and back.
  const width = page.getByRole("group", { name: "Page width" });
  await expect(width.getByRole("button", { name: "Wide" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#doc-scroll")).toHaveAttribute("data-width", "wide");
  await width.getByRole("button", { name: "Narrow" }).click();
  await expect(width.getByRole("button", { name: "Narrow" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#doc-scroll")).not.toHaveAttribute("data-width", "wide");
  // The title sits on the cover; Parchment reads light, so it's in the style's dark ink, not white.
  await expect(page.getByRole("textbox", { name: "Title" })).not.toHaveCSS("color", "rgb(255, 255, 255)");

  // Format: focus decoration, alignment and the Strong text style on the first paragraph. There's no block
  // colour picker: colours come from the note style.
  await openTool(page, "Format");
  const body = page.getByRole("textbox", { name: "Document body" });
  await body.locator("p.fb-paragraph").first().click();
  await page.getByRole("button", { name: "Strong" }).click();
  await page.getByRole("button", { name: "Focus" }).click();
  await expect(page.getByRole("radiogroup", { name: "Block color" })).toHaveCount(0);
  await page.getByRole("button", { name: "Align center" }).click();
  const first = body.locator("p.fb-paragraph").first();
  await expect(first).toHaveAttribute("data-text-style", "strong");
  await expect(first).toHaveAttribute("data-decoration", "focus");
  await expect(first).toHaveAttribute("data-align", "center");
  await waitForSaved(page);
  await page.reload();
  await expect(page.locator("article.fb-sheet")).toHaveAttribute("data-sheet", "night");
  const again = page.getByRole("textbox", { name: "Document body" }).locator("p.fb-paragraph").first();
  await expect(again).toHaveAttribute("data-decoration", "focus");
  await expect(again).toHaveAttribute("data-align", "center");
  await expect(again).toHaveAttribute("data-text-style", "strong");
});

test("upload your own image as the note style; it persists and rejects non-images", async ({ browser }) => {
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const { page } = await newPerson(browser, "Cover Uploader");
  await openTool(page, "Style");
  const noteStyle = page.getByRole("group", { name: "Note Style" });
  await noteStyle.getByRole("button").first().click();
  await expect(page.getByText("Best at 2400 × 1500 px")).toBeVisible();
  const input = page.locator('input[type="file"][name="note-style-image"]');
  // Not an image: refused before uploading.
  await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByText("Choose a PNG, JPEG, WebP or GIF image.")).toBeVisible();
  await input.setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("radio", { name: "Note style: Your image" })).toHaveAttribute("aria-checked", "true");
  await expect(noteStyle.getByRole("button", { name: "Your image", exact: true })).toBeVisible();
  // The image is the cover and the page background, served through signed file URLs.
  await expect(page.locator("#doc-scroll")).toHaveAttribute("style", /\/files\/[^"]+\?exp=/);
  await expect(page.locator("article.fb-sheet header [data-cover-image]")).toHaveAttribute("style", /\/files\//);
  // Auto page and text colours are picked from the image.
  await expect(page.locator("article.fb-sheet")).toHaveAttribute("data-sheet", "art");
  await expect(page.locator("article.fb-sheet")).toHaveAttribute("style", /--art-paper: #[0-9a-f]{6}/);
  await waitForSaved(page);
  await page.reload();
  await expect(page.locator("#doc-scroll")).toHaveAttribute("style", /\/files\//);
  await expect(page.locator("article.fb-sheet")).toHaveAttribute("style", /--art-ink: #[0-9a-f]{6}/);
  // Back to a built-in style.
  await openTool(page, "Style");
  await page.getByRole("group", { name: "Note Style" }).getByRole("button").first().click();
  await page.getByRole("radio", { name: "Note style: Parchment" }).click();
  await expect(page.locator("#doc-scroll")).toHaveAttribute("style", /\/covers\/art-08\.webp/);
});
