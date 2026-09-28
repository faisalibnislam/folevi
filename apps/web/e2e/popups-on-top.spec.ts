import { expect, test, type Locator, type Page } from "@playwright/test";
import { newPersonWithWorkspace } from "./helpers";

const mod = process.platform === "darwin" ? "Meta" : "Control";

/** Every point of a grid across the popup hits the popup itself: nothing clips or covers it. */
async function expectOnTop(page: Page, popup: Locator, name: string) {
  await expect(popup, name).toBeVisible();
  const covered = await popup.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const misses: string[] = [];
    if (r.width < 20 || r.height < 20) return [`too small: ${r.width}×${r.height}`];
    if (r.left < 0 || r.top < 0 || r.right > window.innerWidth || r.bottom > window.innerHeight) misses.push("outside the window");
    for (const fx of [0.08, 0.5, 0.92])
      for (const fy of [0.06, 0.5, 0.94]) {
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !el.contains(hit)) misses.push(`${Math.round(x)},${Math.round(y)} → ${hit?.tagName.toLowerCase()}.${String(hit?.className).slice(0, 60)}`);
      }
    return misses;
  });
  expect(covered, `${name} is covered or clipped`).toEqual([]);
}

test("menus, panels and editor popups are never clipped or covered", async ({ browser }) => {
  const { page } = await newPersonWithWorkspace(browser, "Popup Tester");
  await page.setViewportSize({ width: 1280, height: 800 });

  // Home: a note card's menu (the card sits inside the clipped content panel, next to the sidebar).
  await page.goto("/documents");
  const card = page.locator('[aria-label="Recent notes"] li').first();
  await card.hover();
  await card.getByRole("button", { name: /^Actions for/ }).click();
  await expectOnTop(page, page.getByRole("menu", { name: /^Actions for/ }), "note card menu");
  await page.keyboard.press("Escape");

  // Folder card menu.
  const folder = page.locator('[aria-labelledby="home-recent-folders"] li').first();
  await folder.hover();
  await folder.getByRole("button", { name: /^Folder options for/ }).click();
  await expectOnTop(page, page.getByRole("menu", { name: /^Folder options for/ }), "folder card menu");
  await page.keyboard.press("Escape");

  // Sidebar: folder row menu, account menu, notifications, sync details.
  const nav = page.getByRole("navigation", { name: "Workspace" });
  await nav.getByRole("link", { name: "Projects" }).hover();
  await nav.getByRole("button", { name: "Folder options for Projects" }).click();
  await expectOnTop(page, page.getByRole("menu", { name: "Folder options for Projects" }), "sidebar folder menu");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /workspace and account/ }).click();
  await expectOnTop(page, page.getByRole("menu", { name: /workspace and account/ }), "account menu");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expectOnTop(page, page.getByRole("dialog", { name: "Notifications" }), "notifications");
  await page.keyboard.press("Escape");
  await page.getByTestId("sync-status").first().click();
  await expectOnTop(page, page.getByRole("dialog", { name: "Sync details" }), "sync details");
  await page.keyboard.press("Escape");

  // A note: block menu, slash menu, formatting toolbar, and the page's "…" menu in the dock.
  await page.getByRole("link", { name: /Welcome to Folevi/ }).first().click();
  const body = page.getByRole("textbox", { name: "Document body" });
  await body.locator("p.fb-paragraph").first().click();
  await page.keyboard.press(`${mod}+.`);
  // (The block menu scrolls inside its popup: check the popup.)
  await expectOnTop(page, page.getByRole("menu", { name: "Block options" }).locator("xpath=.."), "block menu");
  await page.keyboard.press("Escape");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await expectOnTop(page, page.getByRole("listbox", { name: "Insert block" }).locator("xpath=.."), "slash menu");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Backspace");
  await body.locator("p.fb-paragraph").first().dblclick();
  await expectOnTop(page, page.getByRole("toolbar", { name: "Text formatting" }), "formatting toolbar");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Document actions" }).click();
  await expectOnTop(page, page.getByRole("menu", { name: "Document actions" }), "page menu");
});
