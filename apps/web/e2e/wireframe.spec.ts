import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newPerson, openShare, settle, waitForSaved } from "./helpers";

async function newPage(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Intro");
  await waitForSaved(page);
}

test.describe("Wireframe", () => {
  test.setTimeout(180_000);

  test("screens, parts from the library, text and options, links, undo, Sketch: it persists and publishes", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Wireframe Tester");
    await newPage(page, "Wireframe");

    // Slash menu → Wireframe: an empty canvas that offers a first screen.
    await page.keyboard.press("Enter");
    await page.keyboard.type("/wireframe");
    await page.getByRole("option", { name: /Wireframe/ }).first().click();
    const canvas = page.getByRole("application", { name: /^Wireframe, 0 screens/ });
    await expect(canvas).toBeVisible();
    const card = page.locator(".fb-wireframe");
    const tools = card.getByRole("toolbar", { name: "Wireframe tools" });
    await card.getByRole("button", { name: "Phone screen" }).click();
    await expect(page.getByRole("application", { name: /^Wireframe, 1 screen, 0 parts/ })).toBeVisible();

    // The library: search, then a tap adds the part to the screen.
    await tools.getByRole("button", { name: "Parts" }).click();
    const library = card.getByRole("dialog", { name: "Interface parts" });
    await library.getByRole("searchbox", { name: "Search parts" }).fill("butt");
    await library.getByRole("button", { name: /^Button/ }).click();
    const button = card.getByRole("button", { name: /^Button, part 1 of 1/ });
    await expect(button).toBeVisible();

    // Enter writes in the selected part; its bar changes its options.
    await page.keyboard.press("Enter");
    await page.keyboard.type("Sign in");
    await page.keyboard.press("Enter");
    await expect(card.getByRole("button", { name: /^Button: Sign in/ })).toBeVisible();
    const bar = card.getByRole("toolbar", { name: "Selected button" });
    await bar.getByRole("button", { name: "Secondary" }).click();
    await expect(bar.getByRole("button", { name: "Secondary" })).toHaveAttribute("aria-pressed", "true");

    // A heading too; undo and redo inside the canvas.
    await library.getByRole("searchbox", { name: "Search parts" }).fill("head");
    await library.getByRole("button", { name: /^Heading/ }).click();
    await expect(page.getByRole("application", { name: /1 screen, 2 parts/ })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByRole("application", { name: /1 screen, 1 part\b/ })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(page.getByRole("application", { name: /1 screen, 2 parts/ })).toBeVisible();
    await library.getByRole("button", { name: "Close parts" }).click();

    // A second screen, and an arrow from the button to it.
    await tools.getByRole("button", { name: "Add screen" }).click();
    await page.getByRole("menuitem", { name: "Phone screen" }).click();
    await expect(page.getByRole("application", { name: /2 screens/ })).toBeVisible();
    await card.getByRole("button", { name: /^Button: Sign in/ }).focus();
    await card.getByRole("toolbar", { name: "Selected button" }).getByRole("button", { name: "Link to screen" }).click();
    await page.getByRole("menuitemradio", { name: "Screen 2" }).click();
    await expect(card.locator(".wf-link")).toHaveCount(1);

    // Arrow keys nudge the selected part.
    const before = await card.getByRole("button", { name: /^Button: Sign in/ }).getAttribute("transform");
    await card.getByRole("button", { name: /^Button: Sign in/ }).focus();
    await page.keyboard.press("Shift+ArrowRight");
    await expect(card.getByRole("button", { name: /^Button: Sign in/ })).not.toHaveAttribute("transform", before!);

    // The Sketch look.
    await tools.getByRole("button", { name: "Sketch" }).click();
    await expect(card.locator("svg.wf-svg")).toHaveAttribute("data-style", "sketch");

    // The canvas and its toolbars pass axe in light and dark.
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), scheme);
      await settle(page);
      const results = await new AxeBuilder({ page }).include(".fb-wireframe").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));

    await waitForSaved(page);
    await page.waitForTimeout(800);
    await waitForSaved(page);
    await page.reload();
    await expect(page.getByRole("application", { name: /Wireframe, 2 screens, 2 parts/ })).toBeVisible();
    await expect(page.locator(".fb-wireframe .wf-link")).toHaveCount(1);
    await expect(page.locator(".fb-wireframe svg.wf-svg")).toHaveAttribute("data-style", "sketch");

    // The public share page draws the screens read-only, with zoom.
    await openShare(page);
    const share = page.getByRole("dialog", { name: /Share/ });
    await share.getByRole("button", { name: "Create link" }).click();
    const link = await share.getByLabel("Public link").inputValue();
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(link);
    await expect(anonPage.getByRole("img", { name: "Wireframe: Screen 1, Screen 2" })).toBeVisible();
    await expect(anonPage.getByText("Button: Sign in")).toBeAttached();
    await anonPage.getByRole("button", { name: "Zoom in" }).click();
    await anon.close();
    await context.close();
  });

  test("a browser screen: a part from the library, selected from the keyboard and deleted from its bar", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Wireframe Touch");
    await newPage(page, "Touch wireframe");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/wireframe");
    await page.getByRole("option", { name: /Wireframe/ }).first().click();
    const card = page.locator(".fb-wireframe");
    await card.getByRole("button", { name: "Browser screen" }).click();
    await card.getByRole("toolbar", { name: "Wireframe tools" }).getByRole("button", { name: "Parts" }).click();
    await card.getByRole("dialog", { name: "Interface parts" }).getByRole("button", { name: /^Navigation bar/ }).click();
    const nav = card.getByRole("button", { name: /^Navigation bar, part 1 of 1/ });
    await expect(nav).toBeVisible();
    await nav.focus();
    await card.getByRole("toolbar", { name: "Selected navigation bar" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("application", { name: /1 screen, 0 parts/ })).toBeVisible();
    await context.close();
  });
});
