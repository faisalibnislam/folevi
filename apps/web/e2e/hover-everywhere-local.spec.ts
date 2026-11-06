// Every button shows a visible hover (the owner's rule, 6 November 2026; docs/claude-context/memory/hover-everywhere.md).
// On each main screen, every visible, enabled button, menu trigger and button-like link is pointed at in turn, and
// something about how it's drawn (its background, colour, outline, shadow, opacity, filter, underline) must change.
// The lint rule folevi/button-hover (eslint-rules/hover.js) guards the source; this checks what the browser draws.
// Local project only:
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_BASE_URL=http://localhost:3003 E2E_NO_SERVER=1 \
//     npx playwright test e2e/hover-everywhere-local.spec.ts --project local --workers=1
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/localShell";

/** The controls on screen, marked with data-hover-probe so they can be pointed at one by one. */
async function markControls(page: Page): Promise<number> {
  return page.evaluate(() => {
    document.querySelectorAll("[data-hover-probe]").forEach((el) => el.removeAttribute("data-hover-probe"));
    const all = [...document.querySelectorAll<HTMLElement>('button, [role="button"], a[class*="rounded"]')];
    let n = 0;
    for (const el of all) {
      if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") continue;
      if (el.closest("[aria-hidden='true'], [inert]")) continue;
      // The chosen one (the current page, the open tab, the picked segment) keeps its own look.
      if (["aria-current", "aria-selected", "aria-pressed", "aria-checked", "data-active", "aria-expanded"].some((a) => !["false", "", null].includes(el.getAttribute(a)))) continue;
      // A scrim (a dimmed backdrop a click closes) isn't a control; the iPhone layout is touched, not pointed at.
      if (el.className.toString().includes("--color-scrim")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.pointerEvents === "none" || Number(cs.opacity) === 0) continue;
      // Only what the pointer can reach (not under a sheet or another control).
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(el === hit || el.contains(hit))) continue;
      el.setAttribute("data-hover-probe", String(n++));
    }
    return n;
  });
}

/** How a control (and its first child, which some controls tint instead) is drawn. */
async function look(page: Page, i: number): Promise<string> {
  return page.evaluate((i) => {
    const el = document.querySelector<HTMLElement>(`[data-hover-probe="${i}"]`);
    if (!el) return "gone";
    const parts = (e: Element | null) => {
      if (!e) return "";
      const cs = getComputedStyle(e);
      const before = getComputedStyle(e, "::before");
      return [cs.backgroundColor, cs.backgroundImage, cs.color, cs.boxShadow, cs.outlineStyle, cs.outlineColor, cs.opacity, cs.filter, cs.textDecorationLine, cs.textDecorationThickness, cs.borderColor, cs.transform, cs.translate, before.backgroundColor].join("|");
    };
    const kids = [...el.querySelectorAll("*")].slice(0, 6);
    return [parts(el), ...kids.map(parts)].join("#");
  }, i);
}

async function describe(page: Page, i: number): Promise<string> {
  return page.evaluate((i) => {
    const el = document.querySelector<HTMLElement>(`[data-hover-probe="${i}"]`);
    if (!el) return "gone";
    const name = el.getAttribute("aria-label") ?? el.getAttribute("title") ?? el.textContent?.trim().slice(0, 40) ?? "";
    return `<${el.tagName.toLowerCase()}> "${name}" .${el.className.toString().slice(0, 120)}`;
  }, i);
}

/** Points at each control on the page and returns the ones whose look doesn't change. */
async function deadControls(page: Page, limit = 60): Promise<string[]> {
  const n = Math.min(await markControls(page), limit);
  const dead: string[] = [];
  for (let i = 0; i < n; i++) {
    await page.mouse.move(1, 1);
    await page.waitForTimeout(220);
    const before = await look(page, i);
    if (before === "gone") continue;
    const box = await page.locator(`[data-hover-probe="${i}"]`).boundingBox();
    if (!box) continue;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(260);
    const after = await look(page, i);
    if (after === "gone") continue;
    if (before === after) dead.push(await describe(page, i));
  }
  await page.mouse.move(1, 1);
  return dead;
}

const main = async (page: Page) => void (await expect(page.locator("main")).toBeVisible({ timeout: 60_000 }));
const SCREENS: { name: string; open: (page: Page) => Promise<void> }[] = [
  { name: "Home", open: async (page) => void (await page.goto("/documents"), await expect(page.getByRole("navigation", { name: "Open pages" })).toBeVisible({ timeout: 60_000 })) },
  { name: "Tasks", open: async (page) => void (await page.goto("/tasks/today"), await main(page)) },
  { name: "Calendar", open: async (page) => void (await page.goto("/calendar"), await main(page)) },
  { name: "Settings", open: async (page) => void (await page.goto("/settings"), await main(page)) },
  { name: "Settings > AI", open: async (page) => void (await page.goto("/settings/ai"), await main(page)) },
  { name: "Settings > Library", open: async (page) => void (await page.goto("/settings/library"), await main(page)) },
  { name: "Foli AI", open: async (page) => void (await page.goto("/ai"), await main(page)) },
  { name: "Changes", open: async (page) => void (await page.goto("/changes"), await main(page)) },
  { name: "Folders", open: async (page) => void (await page.goto("/folders"), await main(page)) },
  {
    name: "a note",
    open: async (page) => {
      await page.goto("/documents");
      await expect(page.getByRole("navigation", { name: "Open pages" })).toBeVisible({ timeout: 60_000 });
      await page.getByRole("button", { name: "New note", exact: true }).first().click();
      await page.waitForURL(/\/d\/[0-9A-Z]{26}/);
      const title = page.getByRole("textbox", { name: "Title" });
      await expect(title).toBeFocused();
      await title.fill("Hover check");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Every control shows a hover.");
    },
  },
];

test.describe("hover everywhere", { tag: "@local" }, () => {
  for (const screen of SCREENS) {
    test(`every control on ${screen.name} shows a hover`, async ({ page, backendMode }) => {
      test.skip(backendMode !== "local", "local mode only");
      test.setTimeout(180_000);
      await screen.open(page);
      await page.waitForTimeout(1500);
      const dead = await deadControls(page);
      expect(dead, `controls with no hover on ${screen.name}:\n${dead.join("\n")}`).toEqual([]);
    });
  }
});
