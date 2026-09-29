import { expect, test } from "@playwright/test";
import { APP, newPerson } from "./helpers";

// A valid 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("Personal is not a workspace; profile pictures and team logos upload and remove", async ({ browser }) => {
  const { page } = await newPerson(browser, "Iris Identity");

  // Personal has no workspace settings (no name, no logo, no members): it's you.
  await page.goto(`${APP}/settings/workspace`);
  await expect(page.getByRole("heading", { name: "You're in Personal" })).toBeVisible();
  await expect(page.getByLabel("Workspace name", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/personal workspace/i)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Members" })).toHaveCount(0);

  // Profile picture: the initial until an image is uploaded.
  await page.goto(`${APP}/settings/account`);
  const avatar = page.getByRole("group", { name: "Profile picture" });
  await expect(avatar.locator("img")).toHaveCount(0);
  await expect(avatar.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await avatar.getByLabel("Upload profile picture").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("status").filter({ hasText: "Profile picture updated" })).toBeVisible({ timeout: 20_000 });
  await expect(avatar.locator("img")).toHaveAttribute("src", /\/files\/[0-9A-Z]{26}\?exp=\d+&sig=/);
  await expect(avatar.locator("img")).toHaveAttribute("alt", "");
  await avatar.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Profile picture removed" })).toBeVisible();
  await expect(avatar.locator("img")).toHaveCount(0);

  // Not an image: refused before uploading.
  await avatar.getByLabel("Upload profile picture").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByRole("alert").filter({ hasText: "Choose a PNG, JPEG, WebP or GIF image." })).toBeVisible();

  // A team workspace (created from Settings, where the Workspace group would be) can be renamed and gets a square logo.
  await page.goto(`${APP}/settings/workspace`);
  await page.getByRole("button", { name: "Create a workspace" }).last().click();
  await page.getByRole("dialog", { name: "New workspace" }).getByLabel("Workspace name").fill("Iris Studio");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForURL(/\/settings\/workspace$/);
  await expect(page.getByRole("heading", { name: "Workspace", level: 2 })).toBeVisible();
  await expect(page.getByLabel("Workspace name", { exact: true })).toHaveValue("Iris Studio");
  await expect(page.getByLabel("Workspace name", { exact: true })).not.toHaveAttribute("readonly", "");
  const logo = page.getByRole("group", { name: "Workspace logo" });
  await logo.getByLabel("Upload workspace logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("status").filter({ hasText: "Workspace logo updated" })).toBeVisible({ timeout: 20_000 });
  await expect(logo.locator("img")).toHaveAttribute("src", /\/files\/[0-9A-Z]{26}\?/);
  await logo.getByRole("button", { name: "Remove" }).click();
  await expect(logo.locator("img")).toHaveCount(0);
});
