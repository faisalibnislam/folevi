import { expect, test } from "@playwright/test";
import { newPerson, waitForSaved } from "./helpers";

// Embeds: a YouTube link becomes a player in the note (through the no-cookie player, allowed by the CSP),
// an address Folevi can't frame is explained, and the embed is still there after a reload.
test("embed a YouTube video from the slash menu", async ({ browser }) => {
  test.setTimeout(90_000);
  const { page } = await newPerson(browser, "Embed Tester");
  // The player itself isn't needed: answer for it so the test doesn't depend on YouTube.
  await page.context().route("https://www.youtube-nocookie.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>player</p>" }));
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill("Watch later");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/embed");
  await page.getByRole("option", { name: /Embed/ }).first().click();

  const dialog = page.getByRole("dialog", { name: "Embed a video, design or map" });
  const field = dialog.getByRole("textbox", { name: "Web address" });
  await field.fill("https://example.com/video");
  await dialog.getByRole("button", { name: "Embed" }).click();
  await expect(dialog.getByText(/can't be embedded.*YouTube, Vimeo, Loom, Figma or Google Maps/)).toBeVisible();
  await field.fill("https://youtu.be/dQw4w9WgXcQ?t=90");
  await dialog.getByRole("button", { name: "Embed" }).click();
  await expect(dialog).toBeHidden();

  const frame = page.locator('iframe[title="YouTube embed"]');
  await expect(frame).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90");
  await expect(frame).toHaveAttribute("sandbox", /allow-scripts/);
  await waitForSaved(page);

  const response = await page.reload();
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/frame-src [^;]*https:\/\/www\.youtube-nocookie\.com/);
  await expect(page.locator('iframe[title="YouTube embed"]')).toBeVisible();
  await expect(page.getByRole("link", { name: "Open" })).toHaveAttribute("href", "https://youtu.be/dQw4w9WgXcQ?t=90");
});
