// Tasks, Calendar and Search in the iPhone app (docs/IOS_POLISH_PLAN.md, WP4): the task views as capsules
// with their names and counts, Folevi's square box that fills and ticks before the task leaves the list, the
// task's details as a sheet (status, the system's date picker through the bridge, priority from a menu), the
// Calendar's week strip with its pull-down month, and Search's scope capsules. The page gets a stand-in for
// the app's bridge (as iphone-app.spec.ts does) that records what it's asked.
import { expect, test, type Page } from "@playwright/test";
import { APP, newPerson, pickDate } from "./helpers";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";

function fakeBridge() {
  const calls: { method: string; arg?: unknown }[] = [];
  const answers: { date: string | null } = { date: null };
  const bridge = {
    platform: "ios",
    version: "1.0",
    haptic: (kind: string) => calls.push({ method: "haptic", arg: kind }),
    hapticPrepare: () => undefined,
    setStatusBar: () => undefined,
    openExternal: async () => true,
    getSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    setSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    onCommand: () => () => undefined,
    // The system's date picker: answers with what the test set (null: dismissed).
    pickDate: async (o: unknown) => {
      calls.push({ method: "pickDate", arg: o });
      return answers.date === null ? null : { value: answers.date };
    },
  };
  Object.defineProperty(window, "foleviNative", { value: bridge });
  Object.assign(window, { __native: { calls, answers } });
  const mark = () => document.documentElement?.setAttribute("data-native", "ios");
  mark();
  const hideBadge = () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.head.appendChild(style);
  };
  if (document.head) hideBadge();
  else document.addEventListener("DOMContentLoaded", hideBadge, { once: true });
  if (!document.documentElement) new MutationObserver((_, watch) => document.documentElement && (mark(), watch.disconnect())).observe(document, { childList: true });
}

type Call = { method: string; arg?: unknown };

/** A finger down at a point, moving through `path` (one step every `step` ms), then up. */
async function drag(page: Page, from: { x: number; y: number }, path: { x: number; y: number }[], step = 30) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  for (const p of path) {
    await page.waitForTimeout(step);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __native: { calls: Call[] } }).__native.calls);
const clearCalls = (page: Page) => page.evaluate(() => void ((window as unknown as { __native: { calls: Call[] } }).__native.calls.length = 0));
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("iPhone Tasks, Calendar and Search: capsules, the box, the details sheet, the week strip, scopes", async ({ browser }) => {
  test.setTimeout(240_000);
  const { context: desk, page: deskPage } = await newPerson(browser, "Week Strip Person");
  // Three tasks from the desktop's Quick add: two today, one tomorrow.
  await deskPage.goto(`${APP}/tasks/today`);
  for (const [text, date] of [
    ["Water the ferns", day(0)],
    ["Call the plumber", day(0)],
    ["Post the letters", day(1)],
  ] as const) {
    await deskPage.getByRole("button", { name: "Add task" }).click();
    const dialog = deskPage.getByRole("dialog", { name: "Quick add task" });
    await dialog.getByLabel("Task").fill(text);
    await dialog.getByRole("button", { name: /^Due date/ }).click();
    await pickDate(deskPage.getByRole("dialog", { name: "Choose due date" }), date);
    await dialog.getByRole("button", { name: "Add task" }).click();
    await expect(deskPage.getByRole("status").filter({ hasText: "Task added" }).first()).toBeVisible();
    await expect(dialog).toHaveCount(0);
  }
  const state = await desk.storageState();
  await desk.close();

  const context = await browser.newContext({ storageState: state, viewport: { width: 402, height: 874 }, userAgent: IPHONE_UA, hasTouch: true });
  await context.addInitScript(fakeBridge);
  const page = await context.newPage();
  await page.goto(`${APP}/tasks/today`);
  await expect(page.locator("html")).toHaveAttribute("data-iphone", "", { timeout: 30_000 });

  // The views: every capsule names itself, with its count; the chosen one is filled.
  const views = page.getByRole("navigation", { name: "Task views" });
  // (The starter notes bring tasks of their own.)
  await expect(views.getByRole("link", { name: /^Today, \d+$/ })).toHaveAttribute("aria-current", "page");
  await expect(views.getByRole("link", { name: /^Upcoming, \d+$/ })).toContainText("Upcoming");
  await expect(views.getByRole("link", { name: /^Inbox/ })).toContainText("Inbox");
  // A 44 pt target around a 34 pt capsule.
  const capsule = await views.getByRole("link", { name: /^Today, \d+$/ }).evaluate((a) => [a.getBoundingClientRect().height, (a.firstElementChild as HTMLElement).getBoundingClientRect().height]);
  expect(capsule).toEqual([44, 34]);

  // Checking a task: the box ticks at once and is felt; the task leaves Today a moment later.
  await clearCalls(page);
  const box = page.getByRole("checkbox", { name: "Mark “Water the ferns” as done" });
  expect(await box.evaluate((b) => [b.getBoundingClientRect().width, b.getBoundingClientRect().height])).toEqual([44, 44]);
  await box.click();
  await expect(page.getByRole("checkbox", { name: "Mark “Water the ferns” as not done" })).toHaveAttribute("aria-checked", "true");
  expect((await calls(page)).filter((c) => c.method === "haptic").map((c) => c.arg)).toEqual(["light"]);
  await expect(page.getByRole("status").filter({ hasText: "Task completed" })).toBeVisible();
  await expect(page.getByText("Water the ferns")).toHaveCount(0);
  // Felt once only (the toggle doesn't tap again).
  expect((await calls(page)).filter((c) => c.method === "haptic")).toHaveLength(1);

  // A task's details: a sheet with its status, date, priority and note.
  await page.getByRole("button", { name: /^Call the plumber/ }).click();
  const sheet = page.getByRole("dialog", { name: "Task" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[data-iphone-sheet]")).toHaveCount(1);
  await expect(sheet.getByRole("radiogroup", { name: "Status" }).getByRole("radio", { name: "Open" })).toHaveAttribute("aria-checked", "true");
  // The date from the system's picker (the stand-in answers with the day after tomorrow).
  await page.evaluate((d) => void ((window as unknown as { __native: { answers: { date: string | null } } }).__native.answers.date = d), day(2));
  await sheet.getByRole("button", { name: /^Date/ }).click();
  await expect.poll(async () => (await calls(page)).filter((c) => c.method === "pickDate").length).toBe(1);
  const asked = (await calls(page)).find((c) => c.method === "pickDate")!.arg as { mode: string; value: string };
  expect(asked.mode).toBe("date");
  expect(asked.value).toBe(day(0));
  await expect(sheet.getByRole("button", { name: /^Time/ })).toBeVisible();
  // Tomorrow in a tap.
  await sheet.getByRole("button", { name: "Tomorrow", exact: true }).click();
  await expect(sheet.getByRole("button", { name: "Tomorrow", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Priority from its menu.
  await sheet.getByRole("button", { name: "Priority: None" }).click();
  await page.getByRole("menuitemradio", { name: "High" }).click();
  await expect(sheet.getByRole("button", { name: "Priority: High" })).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toHaveCount(0);
  // Moved to tomorrow: it's left Today.
  await expect(page.getByText("Call the plumber")).toHaveCount(0);
  await page.getByRole("navigation", { name: "Task views" }).getByRole("link", { name: /^Upcoming/ }).click();
  await expect(page.getByRole("button", { name: /^Call the plumber/ })).toContainText("High priority");

  // Quick add from Tasks: the tab bar's + goes straight to it.
  await page.getByRole("button", { name: "Quick task" }).click();
  await expect(page.getByRole("dialog", { name: "Quick add task" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Quick add task" })).toHaveCount(0);

  // Calendar: the month as the large title, the week strip with today picked and dots on days with tasks.
  await page.goto(`${APP}/calendar`);
  const todayCell = page.getByRole("button", { name: /^Today, / });
  await expect(todayCell).toHaveAttribute("aria-pressed", "true");
  await expect(todayCell).toHaveAttribute("aria-current", "date");
  await expect(page.locator(`[data-date="${day(1)}"]:visible`).first()).toHaveAttribute("aria-label", /has tasks or events$/);
  await expect(page.getByRole("heading", { level: 2, name: /^Tomorrow/ })).toBeVisible();
  // Another day: the list starts there, and Today comes back with a tap.
  await clearCalls(page);
  await page.locator(`[data-date="${day(1)}"]:visible`).first().click();
  await expect(page.locator(`[data-date="${day(1)}"]:visible`).first()).toHaveAttribute("aria-pressed", "true");
  expect((await calls(page)).some((c) => c.method === "haptic" && c.arg === "selection")).toBe(true);
  await expect(page.getByRole("button", { name: /^Post the letters/ })).toBeVisible();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(todayCell).toHaveAttribute("aria-pressed", "true");
  // The pull-down month: the grabber opens the whole month (four to six weeks), and a day folds it again.
  const strip = page.locator("[data-date]:visible").first().locator("xpath=ancestor::div[contains(@class,'overflow-hidden')][1]");
  const weekHeight = await strip.evaluate((el) => el.getBoundingClientRect().height);
  await page.getByRole("button", { name: "Show the whole month" }).click();
  await expect.poll(() => strip.evaluate((el) => Math.round(el.getBoundingClientRect().height / 48))).toBeGreaterThanOrEqual(4);
  await expect(page.getByRole("button", { name: "Show the week" })).toHaveAttribute("aria-expanded", "true");
  await page.locator(`[data-date="${day(1)}"]:visible`).first().click();
  await expect.poll(() => strip.evaluate((el) => el.getBoundingClientRect().height)).toBe(weekHeight);

  // By touch: pulling the strip down follows the finger, and let go past half way it opens the month.
  const at = (await strip.boundingBox())!;
  const from = { x: at.x + at.width / 2, y: at.y + 20 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  for (let i = 1; i <= 6; i++) {
    await page.waitForTimeout(30);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x, y: from.y + i * 15 }] });
  }
  // (Held 90 points down, the strip is 90 points taller: 1:1 with the finger.)
  await expect.poll(() => strip.evaluate((el) => el.getBoundingClientRect().height), { timeout: 3000 }).toBeGreaterThan(weekHeight + 80);
  expect(await strip.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(weekHeight + 100);
  for (let i = 7; i <= 10; i++) {
    await page.waitForTimeout(30);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x, y: from.y + i * 15 }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await expect(page.getByRole("button", { name: "Show the week" })).toHaveAttribute("aria-expanded", "true");
  // Pushed back up, it folds to the week.
  await page.waitForTimeout(400);
  const open = (await strip.boundingBox())!;
  await drag(page, { x: open.x + open.width / 2, y: open.y + open.height - 30 }, [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ x: open.x + open.width / 2, y: open.y + open.height - 30 - i * 20 })));
  await expect(page.getByRole("button", { name: "Show the whole month" })).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => strip.evaluate((el) => el.getBoundingClientRect().height)).toBe(weekHeight);
  // A swipe sideways pages to the next week, keeping the weekday picked.
  const week = (await strip.boundingBox())!;
  await drag(page, { x: week.x + week.width - 30, y: week.y + 20 }, [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ x: week.x + week.width - 30 - i * 40, y: week.y + 21 })), 20);
  await expect(page.locator(`[data-date="${day(8)}"]:visible`).first()).toHaveAttribute("aria-pressed", "true", { timeout: 5000 });

  // Search: the filters are scope capsules that open menus; one in use is filled with its choice.
  await page.goto(`${APP}/documents`);
  await page.getByRole("button", { name: /^Search in/ }).click();
  const search = page.getByRole("dialog", { name: "Search and commands" });
  const scopes = search.getByRole("group", { name: "Search filters" });
  await expect(scopes.getByRole("button", { name: "Edited" })).toBeVisible();
  // No stray place name at the end of the row.
  await expect(scopes).not.toContainText("Personal");
  await scopes.getByRole("button", { name: "Edited" }).click();
  await page.getByRole("menuitemradio", { name: "Past week" }).click();
  await expect(scopes.getByRole("button", { name: "Edited: Past week" })).toBeVisible();
  // Results are list rows: caption caps over them.
  await search.getByRole("combobox").fill("plumber");
  await expect(search.getByText("Notes", { exact: true })).toHaveCSS("text-transform", "uppercase");
  await context.close();
});
