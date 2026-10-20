import { expect, test, type Page } from "@playwright/test";
import { newPerson, openShare, waitForSaved } from "./helpers";

// Presenting a note as slides: dividers and page breaks start slides (else top-level headings), arrow keys,
// Space and clicks move, Esc leaves, a slide counter, ⌘⌥P and "Present" in the note's … menu; shared pages
// get a Present button.

const deck = (page: Page) => page.getByRole("dialog", { name: /^Presenting / });
const counter = (page: Page) => deck(page).getByRole("toolbar", { name: "Presentation" }).getByText(/^\d+ \/ \d+$/);

test("present a note: slides at dividers and page breaks, keys and clicks move, Esc leaves", async ({ browser }) => {
  test.setTimeout(150_000);
  const { page, context } = await newPerson(browser, "Slide Presenter");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.keyboard.type("Team update");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Where we are");
  await page.keyboard.press("Enter");
  await page.keyboard.type("---");
  await page.keyboard.press("Enter");
  await page.keyboard.type("# Wins");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Shipped tabs");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/page break");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Next steps");
  await waitForSaved(page);

  // From the note's … menu.
  await page.getByRole("group", { name: "Page" }).getByRole("button", { name: "Document actions" }).click();
  await page.getByRole("menuitem", { name: "Present" }).click();
  await expect(deck(page)).toBeVisible();
  await expect(deck(page)).toHaveAttribute("aria-label", "Presenting Team update");
  await expect(counter(page)).toHaveText("1 / 3");
  const slide = deck(page).locator("[aria-roledescription=slide]");
  await expect(slide).toContainText("Team update");
  await expect(slide).toContainText("Where we are");
  await expect(slide).not.toContainText("Shipped tabs");

  await page.keyboard.press("ArrowRight");
  await expect(counter(page)).toHaveText("2 / 3");
  await expect(slide.getByRole("heading", { name: "Wins" })).toBeVisible();
  await expect(slide).toContainText("Shipped tabs");
  await page.keyboard.press(" ");
  await expect(counter(page)).toHaveText("3 / 3");
  await expect(slide).toContainText("Next steps");
  // Past the end it stays on the last slide; a click on the slide moves on too.
  await page.keyboard.press("ArrowRight");
  await expect(counter(page)).toHaveText("3 / 3");
  await page.keyboard.press("ArrowLeft");
  await expect(counter(page)).toHaveText("2 / 3");
  await slide.click({ position: { x: 40, y: 40 } });
  await expect(counter(page)).toHaveText("3 / 3");
  await page.keyboard.press("Home");
  await expect(counter(page)).toHaveText("1 / 3");
  // The slide is scaled to fit the window.
  const box = (await slide.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(1440);
  expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.02);
  // Typing doesn't reach the note behind.
  await page.keyboard.type("x");
  await page.keyboard.press("Escape");
  await expect(deck(page)).toHaveCount(0);
  await expect(page.locator(".fb-editor")).not.toContainText("Next stepsx");

  // ⌘⌥P presents again; the Exit button leaves.
  await page.locator(".fb-editor").getByText("Where we are").click();
  await page.keyboard.press("ControlOrMeta+Alt+p");
  await expect(counter(page)).toHaveText("1 / 3");
  await deck(page).getByRole("button", { name: "Stop presenting" }).click();
  await expect(deck(page)).toHaveCount(0);
  await context.close();
});

test("a note without breaks is cut at its headings; a shared page has a Present button that works on a phone", async ({ browser }) => {
  test.setTimeout(150_000);
  const { page, context } = await newPerson(browser, "Heading Presenter");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await expect(page.getByRole("textbox", { name: "Title" })).toBeFocused();
  await page.keyboard.type("Lecture");
  await page.keyboard.press("Enter");
  await page.keyboard.type("## Part one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Atoms");
  await page.keyboard.press("Enter");
  await page.keyboard.type("## Part two");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Molecules");
  await waitForSaved(page);

  await page.keyboard.press("ControlOrMeta+Alt+p");
  // No Heading 1 and no dividers: a slide at each Heading 2 (and the title on the first).
  await expect(counter(page)).toHaveText("1 / 2");
  await expect(deck(page).locator("[aria-roledescription=slide]")).toContainText("Atoms");
  await page.keyboard.press("Escape");
  await expect(deck(page)).toHaveCount(0);

  await openShare(page);
  const share = page.getByRole("dialog", { name: /Share/ });
  await share.getByRole("button", { name: "Create link" }).click();
  const link = await share.getByLabel("Public link").inputValue();

  const phone = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const reader = await phone.newPage();
  await reader.goto(link);
  await reader.getByRole("button", { name: "Present" }).tap();
  await expect(counter(reader)).toHaveText("1 / 2");
  // Landscape on a phone: the slide fills the width it has, within the screen.
  const box = (await deck(reader).locator("[aria-roledescription=slide]").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(844 + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(390 + 1);
  await deck(reader).getByRole("button", { name: "Next slide" }).tap();
  await expect(counter(reader)).toHaveText("2 / 2");
  await expect(deck(reader).locator("[aria-roledescription=slide]")).toContainText("Molecules");
  // A swipe to the right goes back.
  await deck(reader).locator(".fb-present-stage").evaluate((el) => {
    const t = (x: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 200 });
    el.dispatchEvent(new TouchEvent("touchstart", { touches: [t(200)], changedTouches: [t(200)], bubbles: true }));
    el.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [t(420)], bubbles: true }));
  });
  await expect(counter(reader)).toHaveText("1 / 2");
  await deck(reader).getByRole("button", { name: "Stop presenting" }).tap();
  await expect(deck(reader)).toHaveCount(0);
  await phone.close();
  await context.close();
});
