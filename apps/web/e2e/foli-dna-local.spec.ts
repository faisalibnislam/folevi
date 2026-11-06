// Foli DNA on a library on this device (lib/local/functions/graph.ts): "Foli DNA of this note" opens the map
// around that note (it showed nothing, or the whole map), with each connection saying why; the first-time tips,
// the Key and the panel that says in words why a note is connected. Local project only:
//   E2E_LOCAL_BASE_URL=http://127.0.0.1:3471 E2E_BASE_URL=http://127.0.0.1:3471 E2E_NO_SERVER=1 \
//     npx playwright test e2e/foli-dna-local.spec.ts --project local --workers=1
// DNA_SHOTS=<folder> also saves screenshots of each, light and dark.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/localShell";
import { noteMenuItem } from "./helpers";

async function newNote(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).first().click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}/);
  const t = page.getByRole("textbox", { name: "Title" });
  await expect(t).toBeFocused();
  await t.fill(title);
  await page.keyboard.press("Enter");
  return page.url().replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "");
}

async function linkTo(page: Page, title: string, create = true) {
  await page.keyboard.type(`[[${title}`);
  const option = create ? page.getByRole("option", { name: new RegExp(`Create page “${title}”`) }) : page.getByRole("option", { name: new RegExp(title) }).first();
  await option.click();
  await page.keyboard.press("Enter");
}

async function shots(page: Page, name: string) {
  const dir = process.env.DNA_SHOTS;
  if (!dir) return;
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test.describe("Foli DNA of this note", { tag: "@local" }, () => {
  test("opens the map around the note, says why each one is connected, and goes back to the whole map", async ({ page, backendMode }) => {
    test.skip(backendMode !== "local", "local mode only");
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/documents");
    await expect(page.getByRole("button", { name: "New note", exact: true }).first()).toBeVisible({ timeout: 60_000 });

    // Pricing links to Plan and Launch; Weekly notes links to Pricing and Archive idea; one stands alone.
    await newNote(page, "Lonely thought");
    await page.keyboard.type("Nothing links here.");
    await newNote(page, "Archive idea");
    await page.keyboard.type("Old.");
    const pricing = await newNote(page, "Pricing");
    await linkTo(page, "Plan");
    await linkTo(page, "Launch");
    await newNote(page, "Weekly notes");
    await linkTo(page, "Pricing", false);
    await linkTo(page, "Archive idea", false);
    await page.goto(pricing);
    await page.getByText("Launch", { exact: true }).first().waitFor();
    await page.waitForTimeout(1500);

    // The whole map first: the tips, the Key, the unlinked note hidden.
    await page.goto("/graph");
    await expect(page.getByRole("application", { name: /Foli DNA of \d+ notes/ })).toBeVisible({ timeout: 60_000 });
    const tips = page.getByRole("dialog", { name: "Foli DNA tips" });
    await expect(tips).toContainText("This is Foli DNA");
    await shots(page, "tour");
    await tips.getByRole("button", { name: "Next" }).click();
    await expect(tips).toContainText("Move around and open notes");
    await tips.getByRole("button", { name: "Next" }).click();
    await expect(tips).toContainText("Focus on one note");
    await tips.getByRole("button", { name: "Got it" }).click();
    await expect(tips).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Key" })).toContainText("A link you wrote");
    await expect(page.getByText(/\d+ unlinked notes? hidden\./)).toBeVisible();
    await shots(page, "whole-map");
    // Remembered: no tips the next time.
    await page.reload();
    await expect(page.getByRole("application", { name: /Foli DNA of \d+ notes/ })).toBeVisible({ timeout: 60_000 });
    await expect(tips).toHaveCount(0);

    // From the note's ••• menu, Connections > Foli DNA (the bug: this showed an empty or whole map).
    await page.goto(pricing);
    await page.getByRole("group", { name: "Page" }).getByRole("button", { name: "Document actions" }).click();
    await (await noteMenuItem(page, "Foli DNA")).click();
    await page.waitForURL(/\/graph\?note=/);
    expect(new URL(page.url()).searchParams.get("note")).toBe(pricing.replace("/d/", ""));
    await expect(page.getByRole("application", { name: /Foli DNA of 4 notes/ })).toBeVisible({ timeout: 30_000 });
    // The floating card: the note's name, how many, its connections grouped by why, each with Open.
    const list = page.getByRole("complementary", { name: "Connections" });
    await expect(list.getByRole("heading", { name: "Pricing" })).toBeVisible();
    await expect(list).toContainText("3 connections");
    await expect(list.getByRole("heading", { name: /Links\s*3/ })).toBeVisible();
    await expect(list.getByRole("button", { name: "Plan", exact: true })).toBeVisible();
    await expect(list.getByRole("button", { name: "Weekly notes", exact: true })).toBeVisible();
    await expect(list.getByRole("button", { name: "Open" })).toHaveCount(3);
    await expect(page.getByRole("button", { name: /^Lonely thought, note/ })).toHaveCount(0);
    // Each line says why, on the map too.
    await expect(page.locator("svg text", { hasText: "links here" })).toHaveCount(1);
    // The card and the zoom pill stay clear of each other and of Ask Foli AI.
    const box = async (sel: ReturnType<Page["locator"]>) => (await sel.boundingBox())!;
    const card = await box(list);
    const zoom = await box(page.getByRole("group", { name: "Zoom" }));
    const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(overlaps(card, zoom)).toBe(false);
    const fab = page.locator(".ui-fab");
    if (await fab.count()) expect(overlaps(card, await box(fab)) || overlaps(zoom, await box(fab))).toBe(false);
    await shots(page, "note-map");

    // Insights around a note: the toolbar's button switches the card to it (it did nothing here), and back.
    await page.getByRole("button", { name: "Insights", exact: true }).first().click();
    const insights = page.getByRole("complementary", { name: "Insights" });
    await expect(insights.getByRole("heading", { name: /^Hubs/ })).toBeVisible();
    await expect(insights.getByRole("group", { name: "Show in the card" }).getByRole("button", { name: "Insights" })).toHaveAttribute("aria-pressed", "true");
    await shots(page, "note-insights");
    await insights.getByRole("button", { name: "Connections", exact: true }).click();
    await expect(list).toBeVisible();

    // The time-lapse: a bar with play, the date over the playhead, how many notes so far; Space pauses, the arrow
    // keys step, x goes back to now.
    await page.getByRole("button", { name: "Play how it grew" }).click();
    const bar = page.getByRole("group", { name: "How it grew" });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("slider", { name: "Date" })).toBeFocused();
    await page.waitForTimeout(2500);
    await page.keyboard.press(" ");
    await expect(bar.getByRole("button", { name: "Play" })).toBeVisible();
    await expect(bar).toContainText(/\d of 4 notes/);
    await page.keyboard.press("Home");
    await expect(bar).toContainText(/1 of 4 notes/);
    await page.keyboard.press("End");
    await expect(bar).toContainText("4 of 4 notes");
    await bar.getByRole("slider", { name: "Date" }).click();
    expect(overlaps(await box(bar), await box(list))).toBe(false);
    expect(overlaps(await box(bar), await box(page.getByRole("group", { name: "Zoom" })))).toBe(false);
    await shots(page, "timeline");
    await bar.getByRole("button", { name: "Close the time-lapse" }).click();
    await expect(bar).toHaveCount(0);

    // Expand a neighbour: Weekly notes' own link to Archive idea shows.
    await list.getByRole("button", { name: "Weekly notes", exact: true }).hover();
    await list.getByRole("button", { name: "Show what Weekly notes connects to" }).click();
    await expect(page.getByRole("application", { name: /Foli DNA of 5 notes/ })).toBeVisible();

    // A click on a note says why it's connected, in words; its connections open in one click.
    await page.locator('[data-node] >> nth=0').waitFor();
    const centerDot = page.getByRole("button", { name: /^Pricing, note/ });
    await centerDot.click();
    const panel = page.getByRole("region", { name: "Why Pricing is connected" });
    await expect(panel).toContainText("Links to 2 notes and linked from 1.");
    await expect(panel.getByRole("link", { name: "Weekly notes" })).toBeVisible();
    await shots(page, "panel");
    await panel.getByRole("link", { name: "Weekly notes" }).click();
    await page.waitForURL(/\/d\/[0-9A-Z]{26}$/);

    // Back to the whole map.
    await page.goBack();
    await page.getByRole("button", { name: "Whole map", exact: true }).click();
    await page.waitForURL(/\/graph$/);
    await expect(page.getByRole("complementary", { name: "Connections" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
