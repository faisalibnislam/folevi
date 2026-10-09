import { expect, test, type Page } from "@playwright/test";
import { newPerson, waitForSaved } from "./helpers";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/** A finger resting on a point for `ms`, then lifted (real touch input, not synthetic DOM events). */
async function hold(page: Page, x: number, y: number, ms = 700) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await page.waitForTimeout(ms);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test("on an iPhone, pressing and holding a line opens the note's own menu (Safari sends no right-click)", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "Touch input is driven through Chromium's DevTools protocol.");
  test.setTimeout(120_000);
  const { context: desktop, page: setup } = await newPerson(browser, "Phone Person");
  await setup.getByRole("button", { name: "New note", exact: true }).click();
  await setup.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await setup.getByRole("textbox", { name: "Title" }).fill("On the go");
  await setup.keyboard.press("Enter");
  await setup.keyboard.type("A line to hold");
  await waitForSaved(setup);
  const url = setup.url().replace(/\?.*$/, "");
  const state = await desktop.storageState();
  await desktop.close();

  const phone = await browser.newContext({ storageState: state, userAgent: IPHONE, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await phone.newPage();
  // Like Safari on iOS: no right-click of the browser's own for a long press (Chromium sends one; it's held back).
  await page.addInitScript(() => {
    window.addEventListener(
      "contextmenu",
      (e) => {
        if (!e.isTrusted) return;
        e.stopImmediatePropagation();
        e.preventDefault();
      },
      true,
    );
  });
  await page.goto(url);
  const body = page.getByRole("textbox", { name: "Document body" });
  const line = body.getByText("A line to hold");
  await expect(line).toBeVisible({ timeout: 30_000 });
  const box = (await line.boundingBox())!;

  // A short touch is a tap: no menu.
  await hold(page, box.x + 20, box.y + box.height / 2, 150);
  await expect(page.getByRole("menu", { name: "Note actions" })).toHaveCount(0);

  // Held: the line's menu, without raising the keyboard.
  await hold(page, box.x + 20, box.y + box.height / 2);
  const menu = page.getByRole("menu", { name: "Note actions" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem").first()).toBeVisible();
  // The lift that ended the hold picked nothing: the menu stays open until a choice or a tap outside.
  await page.waitForTimeout(300);
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await phone.close();
});
