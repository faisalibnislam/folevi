import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { newPerson, openShare, settle, waitForSaved } from "./helpers";

async function newPage(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Intro");
  await waitForSaved(page);
}

/** The ideas on the canvas, in drawing order. */
const ideas = (card: Locator) => card.locator(".mm-node[data-mm-node]");
const idea = (card: Locator, text: string) => ideas(card).filter({ hasText: new RegExp(`^${text}$`) });
const texts = (card: Locator) => ideas(card).allTextContents();

async function insertMindmap(page: Page) {
  await page.keyboard.press("Enter");
  await page.keyboard.type("/mind map");
  await page.getByRole("option", { name: /Mind map/ }).first().click();
  const card = page.locator(".fb-editor .fb-mindmap .fb-vcard").last();
  await expect(card).toBeVisible({ timeout: 20_000 });
  return card;
}

test.describe("Mind map", () => {
  test.setTimeout(180_000);

  test("keyboard-first editing, folding, layouts, outline, moving ideas and undo; it persists and publishes", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Mind Map Tester");
    await newPage(page, "Mind map");
    const card = await insertMindmap(page);
    const tools = card.getByRole("toolbar", { name: "Mind map tools" });
    await expect(card.getByText("Start with the central idea")).toBeVisible();

    // Whimsical's flow: the centre, Tab for an idea inside, Enter for the next one, Enter on an empty one stops.
    await card.getByRole("button", { name: "Add the central idea" }).click();
    await page.keyboard.type("Launch plan");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Marketing");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Blog post");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Newsletter");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(card.getByRole("application", { name: "Mind map, 4 ideas" })).toBeAttached();
    // Selected: Newsletter again. ← to Marketing, ← to the centre, Tab for another main branch.
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Product");
    await page.keyboard.press("Escape");
    expect((await texts(card)).sort()).toEqual(["Blog post", "Launch plan", "Marketing", "Newsletter", "Product"]);
    // Both sides by default: the two main branches sit either side of the centre.
    const centre = (await idea(card, "Launch plan").boundingBox())!;
    const xs = [(await idea(card, "Marketing").boundingBox())!.x, (await idea(card, "Product").boundingBox())!.x];
    expect(Math.min(...xs)).toBeLessThan(centre.x);
    expect(Math.max(...xs)).toBeGreaterThan(centre.x + centre.width);

    // Typing on a selected idea replaces its text; F2 edits it.
    await idea(card, "Product").click();
    await page.keyboard.type("Build");
    await page.keyboard.press("Escape");
    await expect(idea(card, "Build")).toHaveCount(1);
    await page.keyboard.press("F2");
    await page.keyboard.type(" it");
    await page.keyboard.press("Escape");
    await expect(idea(card, "Build it")).toHaveCount(1);

    // ⌘Z and ⇧⌘Z inside the block.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(idea(card, "Build")).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(idea(card, "Build it")).toHaveCount(1);

    // Space folds Marketing's branch, with a count; Space again opens it.
    await idea(card, "Marketing").click();
    await page.keyboard.press(" ");
    await expect(idea(card, "Blog post")).toHaveCount(0);
    await expect(card.locator(".mm-badge text")).toHaveText("2");
    await page.keyboard.press(" ");
    await expect(idea(card, "Blog post")).toHaveCount(1);

    // Drag Newsletter onto "Build it": it moves there.
    const from = (await idea(card, "Newsletter").boundingBox())!;
    const to = (await idea(card, "Build it").boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 14 });
    await page.mouse.up();
    const after = (await idea(card, "Newsletter").boundingBox())!;
    const build = (await idea(card, "Build it").boundingBox())!;
    // Now a child of "Build it": further out on its side of the centre.
    if (build.x < centre.x) expect(after.x + after.width).toBeLessThan(build.x);
    else expect(after.x).toBeGreaterThan(build.x + build.width);

    // Delete takes the idea away; ⌘Z brings it back.
    await idea(card, "Newsletter").click();
    await page.keyboard.press("Delete");
    await expect(idea(card, "Newsletter")).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(idea(card, "Newsletter")).toHaveCount(1);

    // Layouts: top down puts children under their parent.
    await tools.getByRole("button", { name: /^Layout/ }).click();
    await page.getByRole("menuitemradio", { name: "Top down" }).click();
    const top = (await idea(card, "Launch plan").boundingBox())!;
    expect((await idea(card, "Marketing").boundingBox())!.y).toBeGreaterThan(top.y + top.height);
    await tools.getByRole("button", { name: /^Layout/ }).click();
    await page.getByRole("menuitemradio", { name: "Both sides" }).click();

    // The outline view edits the same ideas.
    await tools.getByRole("button", { name: /Outline/ }).click();
    const outline = card.getByRole("list", { name: "Mind map outline" });
    await expect(outline.getByRole("textbox")).toHaveCount(5);
    await outline.getByRole("textbox", { name: "Central idea" }).fill("Launch plan 2027");
    await tools.getByRole("button", { name: /Outline/ }).click();
    await expect(idea(card, "Launch plan 2027")).toHaveCount(1);

    // Full canvas: ⇧⌘F, Esc back. Export draws the map.
    await card.locator(".fb-canvas-body").focus();
    await page.keyboard.press("ControlOrMeta+Shift+F");
    await expect(card).toHaveAttribute("data-full", "true");
    await page.keyboard.press("Escape");
    await expect(card).not.toHaveAttribute("data-full", "true");
    await tools.getByRole("button", { name: "Export" }).click();
    await expect(page.getByRole("menuitem", { name: "Export as PNG" })).toBeEnabled();
    await page.keyboard.press("Escape");

    // The block and its controls pass axe in light and dark.
    await idea(card, "Marketing").click();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), scheme);
      await settle(page);
      const results = await new AxeBuilder({ page }).include(".fb-mindmap").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));

    // Saved: after a reload the map is there.
    await page.locator(".fb-editor > p.fb").first().click();
    await waitForSaved(page);
    await page.waitForTimeout(800);
    await waitForSaved(page);
    await page.reload();
    const again = page.locator(".fb-editor .fb-mindmap .fb-vcard");
    await expect(again.getByRole("application", { name: "Mind map, 5 ideas" })).toBeAttached({ timeout: 20_000 });
    await expect(idea(again, "Launch plan 2027")).toHaveCount(1);

    // The public share page draws the real map, read-only, with zoom.
    await openShare(page);
    const share = page.getByRole("dialog", { name: /Share/ });
    await share.getByRole("button", { name: "Create link" }).click();
    const link = await share.getByLabel("Public link").inputValue();
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(link);
    await expect(anonPage.getByRole("img", { name: /^Mind map: Launch plan 2027, Marketing/ })).toBeVisible();
    await expect(anonPage.getByRole("button", { name: "Zoom in" })).toBeAttached();
    await anon.close();
    await context.close();
  });

  test("a bulleted list turns into a mind map from the block menu, and back", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Mind Map List Tester");
    await newPage(page, "Trip");
    await page.keyboard.press("Enter");
    await page.keyboard.type("- Trip");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Food");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Hotel");
    await waitForSaved(page);
    // Select the three items (caret in the last, Shift-click the first one's grip), then open the menu.
    const first = page.locator(".fb-editor > .fb").filter({ hasText: /^Trip$/ });
    const fb = (await first.boundingBox())!;
    await page.mouse.move(fb.x + 40, fb.y + fb.height / 2);
    const grip = page.getByRole("button", { name: /Drag to move, click for block options/ });
    await grip.click({ modifiers: ["Shift"] });
    await page.mouse.move(fb.x + 40, fb.y + fb.height / 2);
    await grip.click();
    await page.getByRole("menuitem", { name: "Turn into mind map" }).click();
    const card = page.locator(".fb-editor .fb-mindmap .fb-vcard");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByRole("application", { name: "Mind map, 3 ideas" })).toBeAttached();
    expect((await texts(card)).sort()).toEqual(["Food", "Hotel", "Trip"]);
    // And back from the block's own More menu.
    await card.getByRole("toolbar", { name: "Mind map tools" }).getByRole("button", { name: "More mind map actions" }).click();
    await page.getByRole("menuitem", { name: "Turn into bulleted list" }).click();
    await expect(page.locator(".fb-editor .fb-mindmap")).toHaveCount(0);
    await expect(page.locator(".fb-editor > .fb-bulleted")).toHaveText(["Trip", "Food", "Hotel"]);
    await context.close();
  });

  test("at phone width the block fits, and a tap and the + add ideas", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Mind Map Phone Tester");
    await newPage(page, "Phone map");
    const card = await insertMindmap(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("button", { name: "Add the central idea" }).click();
    await page.keyboard.type("Ideas");
    await page.keyboard.press("Escape");
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await idea(card, "Ideas").click();
    await card.locator("[data-mm-add]").click();
    await page.keyboard.type("First");
    await page.keyboard.press("Escape");
    await expect(idea(card, "First")).toHaveCount(1);
    // The selected idea's bar has the idea's menu.
    await idea(card, "First").click();
    await card.getByRole("toolbar", { name: "Selected idea" }).getByRole("button", { name: "More for this idea" }).click();
    await expect(page.getByRole("menuitem", { name: /Focus on this branch/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await context.close();
  });
});
