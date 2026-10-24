// TEMPORARY (type scale / spacing audit): screenshots of key screens. Not committed.
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { newPerson } from "./helpers";

const OUT = process.env.FOLEVI_SHOTS ?? "/tmp/shots";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";

function fakeBridge() {
  const bridge = {
    platform: "ios", version: "1.0", haptic: () => undefined, hapticPrepare: () => undefined, setStatusBar: () => undefined,
    openExternal: async () => true, getSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    setSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }), onCommand: () => () => undefined,
  };
  Object.defineProperty(window, "foleviNative", { value: bridge });
  const mark = () => document.documentElement?.setAttribute("data-native", "ios");
  mark();
  if (!document.documentElement) new MutationObserver((_, w) => document.documentElement && (mark(), w.disconnect())).observe(document, { childList: true });
  const hide = () => { const s = document.createElement("style"); s.textContent = "nextjs-portal { display: none !important; }"; document.head.appendChild(s); };
  if (document.head) hide(); else document.addEventListener("DOMContentLoaded", hide, { once: true });
}
function macMark() {
  const mark = () => document.documentElement?.setAttribute("data-desktop", "mac");
  mark();
  document.addEventListener("DOMContentLoaded", mark);
  const hide = () => { const s = document.createElement("style"); s.textContent = "nextjs-portal { display: none !important; }"; document.head.appendChild(s); };
  if (document.head) hide(); else document.addEventListener("DOMContentLoaded", hide, { once: true });
}

type State = Awaited<ReturnType<BrowserContext["storageState"]>>;
async function open(browser: Browser, state: State, kind: "iphone" | "ipad" | "mac" | "web") {
  const context = await browser.newContext({
    storageState: state,
    viewport: kind === "iphone" ? { width: 440, height: 956 } : kind === "ipad" ? { width: 1180, height: 820 } : { width: 1440, height: 900 },
    userAgent: kind === "iphone" ? IPHONE_UA : kind === "ipad" ? IPAD_UA : undefined,
    hasTouch: kind === "iphone" || kind === "ipad",
    isMobile: kind === "iphone",
    deviceScaleFactor: kind === "iphone" ? 2 : 1,
  });
  if (kind === "iphone" || kind === "ipad") await context.addInitScript(fakeBridge);
  else await context.addInitScript(macMark);
  if (kind === "web") await context.addInitScript(() => document.addEventListener("DOMContentLoaded", () => document.documentElement.removeAttribute("data-desktop")));
  return { context, page: await context.newPage() };
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png` });
const tapOrClick = async (page: Page, l: ReturnType<Page["locator"]>, touch: boolean) => (touch ? l.tap() : l.click());

let state: State | null = null;
let noteUrl = "";
test.describe.configure({ mode: "serial" });
test("seed", async ({ browser }) => {
  test.setTimeout(180_000);
  const { page: p0, context: c0 } = await newPerson(browser, "Ada Example");
  await p0.getByRole("button", { name: "New note", exact: true }).first().click();
  await p0.waitForURL(/\/d\/[0-9A-Z]{26}/);
  await p0.getByRole("textbox", { name: "Title" }).click();
  await p0.keyboard.type("Airly Studio Website Idea");
  await p0.keyboard.press("Enter");
  await p0.keyboard.type("Layout ideas for the hero, the chat bubbles and the pricing table.");
  await p0.waitForTimeout(2000);
  noteUrl = new URL(p0.url()).pathname;
  state = await c0.storageState();
  await c0.close();
});
const KINDS = (process.env.SHOT_KINDS ?? "iphone,ipad,mac,web").split(",") as ("iphone" | "ipad" | "mac" | "web")[];
for (const kind of KINDS) for (const theme of ["light", "dark"] as const) test(`${kind} ${theme}`, async ({ browser }) => {
  test.setTimeout(240_000);
  const touch = kind === "iphone" || kind === "ipad";
  const { context, page } = await open(browser, state!, kind);
  page.setDefaultTimeout(8000);
  await page.emulateMedia({ colorScheme: theme });
  const n = (s: string) => `${kind}-${s}-${theme}`;
  await page.goto("/documents");
  await page.waitForTimeout(3500);
  await shot(page, n("home"));
  await page.goto(noteUrl);
  await page.waitForTimeout(3500);
  await shot(page, n("note"));
  try {
    const ai = kind === "iphone" ? page.getByRole("button", { name: "Foli AI", exact: true }).last() : page.getByRole("toolbar", { name: "Page tools" }).getByRole("button", { name: "Foli AI" });
    await tapOrClick(page, ai, touch);
    await page.waitForTimeout(1500);
    await page.getByText("Think it through").first().scrollIntoViewIfNeeded({ timeout: 5000 });
    await page.waitForTimeout(500);
    await shot(page, n("ai-tools"));
    await page.getByText("Translate this note").first().scrollIntoViewIfNeeded({ timeout: 3000 });
    await page.waitForTimeout(300);
    await shot(page, n("ai-translate"));
  } catch (e) {
    console.log(kind, theme, "ai failed", String(e).slice(0, 200));
    await shot(page, n("ai-failed"));
  }
  await page.goto("/settings");
  await page.waitForTimeout(3000);
  await shot(page, n("settings"));
  await page.goto("/documents");
  await page.waitForTimeout(2500);
  try {
    await tapOrClick(page, page.getByRole("button", { name: /^Notifications/ }).first(), touch);
    await page.waitForTimeout(1500);
    await shot(page, n("notifications"));
  } catch (e) {
    console.log(kind, theme, "notifications failed", String(e).slice(0, 200));
  }
  await context.close();
  expect(true).toBe(true);
});
