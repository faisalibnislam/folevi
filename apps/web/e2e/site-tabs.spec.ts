import { expect, test } from "@playwright/test";
import { APP } from "./helpers";

// The public site's tab bar (1024 px and up) keeps a tab for every page opened, as the app's tab strip does:
// Home is pinned, pages opened from the sidebar add tabs, a tab links back to its page, the close button
// removes it, and the tabs last for the browsing session.
const SITE = (process.env.E2E_SITE_URL ?? APP.replace("://app.", "://")).replace(/\/$/, "");

test("pages opened from the sidebar get tabs that last for the session", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/`);
  const sidebar = page.getByRole("navigation", { name: "Primary" });
  const tabs = page.getByRole("navigation", { name: "Open pages" });

  await sidebar.getByRole("link", { name: "Docs", exact: true }).click();
  await expect(page).toHaveURL(/\/docs$/);
  await sidebar.getByRole("link", { name: "Pricing", exact: true }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(tabs.getByRole("link")).toHaveText(["Home", "Docs", "Pricing"]);
  await expect(tabs.getByRole("link", { name: "Pricing" })).toHaveAttribute("aria-current", "page");

  await tabs.getByRole("link", { name: "Docs" }).click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(tabs.getByRole("link", { name: "Docs" })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link")).toHaveText(["Home", "Docs", "Pricing"]);

  // Closing a tab that isn't open doesn't navigate.
  await tabs.getByRole("button", { name: "Close Pricing" }).click();
  await expect(tabs.getByRole("link")).toHaveText(["Home", "Docs"]);
  await expect(page).toHaveURL(/\/docs$/);

  await page.reload();
  await expect(tabs.getByRole("link")).toHaveText(["Home", "Docs"]);

  // Closing the open tab goes to the tab on its left.
  await tabs.getByRole("button", { name: "Close Docs" }).click();
  await expect(page).toHaveURL(new RegExp(`${SITE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?$`));
  await expect(tabs.getByRole("link")).toHaveText(["Home"]);
});
