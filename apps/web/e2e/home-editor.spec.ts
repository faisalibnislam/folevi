import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { APP, convexUrl } from "./helpers";

// The home page's hero is a Folevi note: its title is being co-edited, the theme picker on its cover recolours
// the note and the site, and the apps sit in the same card under the cover. It loads nothing from elsewhere.
const SITE = (process.env.E2E_SITE_URL ?? APP.replace("://app.", "://")).replace(/\/$/, "");

test("the home page hero: title, theme picker and the apps", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const external: string[] = [];
  page.on("request", (r) => {
    // Our own backend and the app's signed-in check are allowed; nothing else.
    const own = [SITE, "data:", new URL(convexUrl()).origin, `${APP}/api/signed-in`];
    if (!own.some((o) => r.url().startsWith(o))) external.push(r.url());
  });
  await page.goto(`${SITE}/`);
  // The title is being co-edited (the ending changes); assistive tech reads the whole sentence once.
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("Folevi is a free digital workspace for your notes, on Mac, iPhone and iPad.");

  // The theme picker on the cover recolours the note (and the site).
  const themes = page.getByRole("radiogroup", { name: "Note theme" });
  await themes.getByRole("radio", { name: "Note theme: Poppy print" }).click();
  await expect(page.locator(".mk-hero-stage")).toHaveAttribute("data-tone", "light");
  await expect(themes.getByRole("radio", { name: "Note theme: Poppy print" })).toHaveAttribute("aria-checked", "true");

  // The apps are in the same card, with their buttons.
  const note = page.locator(".mk-hero-note");
  await expect(note.getByRole("heading", { level: 2, name: /On your Mac, iPhone and iPad/ })).toBeVisible();
  await expect(note.getByRole("link", { name: "Download for Mac" })).toBeVisible();
  await expect(note.getByRole("link", { name: "Get it on the App Store" })).toBeVisible();

  expect(external).toEqual([]);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the hero has no serious accessibility issues (${scheme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto(`${SITE}/`);
    await expect(page.getByRole("radiogroup", { name: "Note theme" })).toBeVisible();
    const results = await new AxeBuilder({ page }).include(".mk-hero").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
  });
}
