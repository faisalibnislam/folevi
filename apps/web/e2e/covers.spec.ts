import { expect, test } from "@playwright/test";
import { newPersonWithWorkspace, waitForSaved } from "./helpers";

test("pick one of the 20 artwork covers from the inspector; it persists", async ({ browser }) => {
  const { page } = await newPersonWithWorkspace(browser, "Cover Picker");
  await page.getByRole("button", { name: "Show inspector" }).click();
  await page.getByRole("tab", { name: "Style" }).click();
  const art = page.getByRole("radiogroup", { name: "Cover artwork" }).getByRole("radio");
  await expect(art).toHaveCount(20);
  await page.getByRole("radio", { name: "Cover: Moss hills" }).click();
  await expect(page.getByRole("radio", { name: "Cover: Moss hills" })).toHaveAttribute("aria-checked", "true");
  const cover = page.locator("article.fb-sheet header > div").first();
  await expect(cover).toHaveAttribute("style", /\/covers\/art-04\.svg/);
  await waitForSaved(page);
  await page.reload();
  await expect(page.locator("article.fb-sheet header > div").first()).toHaveAttribute("style", /\/covers\/art-04\.svg/);
  // The sidebar says Home, and there is no Daily Notes entry.
  const nav = page.getByRole("navigation", { name: "Workspace" });
  await expect(nav.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Daily Notes" })).toHaveCount(0);
});
