import { expect, test } from "@playwright/test";
import { APP, newPersonWithWorkspace } from "./helpers";

// A valid 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("the personal workspace is always called Personal; profile pictures and team logos upload and remove", async ({ browser }) => {
  const { page } = await newPersonWithWorkspace(browser, "Iris Identity");

  // Personal workspace name: read-only, with the reason.
  await page.goto(`${APP}/settings/workspace`);
  const name = page.getByLabel("Workspace name", { exact: true });
  await expect(name).toHaveValue("Personal");
  await expect(name).toHaveAttribute("readonly", "");
  await expect(page.getByText("Your personal workspace is always called Personal.")).toBeVisible();
  await expect(page.getByText("Your personal workspace uses your profile picture.", { exact: false })).toBeVisible();

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

  // A team workspace can be renamed and gets a square logo.
  await page.goto(`${APP}/settings/workspace`);
  await page.getByLabel("Team workspace name").fill("Iris Studio");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByLabel("Workspace name", { exact: true })).toHaveValue("Iris Studio");
  await expect(page.getByLabel("Workspace name", { exact: true })).not.toHaveAttribute("readonly", "");
  const logo = page.getByRole("group", { name: "Workspace logo" });
  await logo.getByLabel("Upload workspace logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("status").filter({ hasText: "Workspace logo updated" })).toBeVisible({ timeout: 20_000 });
  await expect(logo.locator("img")).toHaveAttribute("src", /\/files\/[0-9A-Z]{26}\?/);
  await logo.getByRole("button", { name: "Remove" }).click();
  await expect(logo.locator("img")).toHaveCount(0);
});
