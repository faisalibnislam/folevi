import { expect, test } from "@playwright/test";
import { APP } from "./helpers";

// Unknown addresses answer 404 with a branded page: the marketing site's inside its own shell, and the product
// host's in the app's plain frame. Both are titled "Page not found · Folevi" and kept out of search.
const SITE = (process.env.E2E_SITE_URL ?? APP.replace("://app.", "://")).replace(/\/$/, "");

for (const path of ["/no-such-page", "/docs/no-such-article"]) {
  test(`marketing ${path} is a 404 inside the site shell`, async ({ page, request }) => {
    const res = await request.get(`${SITE}${path}`);
    expect(res.status()).toBe(404);
    const html = await res.text();
    expect(html).toContain("<title>Page not found · Folevi</title>");
    expect(html).toMatch(/<meta name="robots" content="noindex/);

    const response = await page.goto(`${SITE}${path}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "This page isn’t here" })).toBeVisible();
    await expect(page).toHaveTitle("Page not found · Folevi");
    const back = page.getByRole("navigation", { name: "Ways back" });
    await expect(back.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    await expect(back.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
    await expect(back.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", /\/signin$/);
    // The site's own frame: its footer is there.
    await expect(page.getByRole("contentinfo")).toBeVisible();
  });
}

test("an unknown product address is a 404 in the app's frame", async ({ page, request }) => {
  const res = await request.get(`${APP}/no-such-view`);
  expect(res.status()).toBe(404);
  const html = await res.text();
  expect(html).toContain("<title>Page not found · Folevi</title>");
  expect(html).toMatch(/<meta name="robots" content="noindex/);

  const response = await page.goto(`${APP}/no-such-view`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "This page isn’t here" })).toBeVisible();
  const back = page.getByRole("navigation", { name: "Ways back" });
  await expect(back.getByRole("link", { name: "Open Folevi" })).toHaveAttribute("href", "/documents");
  await expect(back.getByRole("link", { name: "Docs" })).toHaveAttribute("href", `${SITE}/docs`);
  await expect(back.getByRole("link", { name: "Home" })).toHaveAttribute("href", SITE);
  await expect(page.getByRole("contentinfo")).toHaveCount(0);
  await expect(page).toHaveTitle("Page not found · Folevi");
});

test("the product host's 404 follows the app's dark appearance", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();
  await page.goto(`${APP}/no-such-view`);
  await expect(page.getByRole("heading", { level: 1, name: "This page isn’t here" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await context.close();
});
