// The iPhone and iPad app's native parts as the page sees them (stage 2): the page hands the app a token for
// this device (widgets, the share extension, Shortcuts and Spotlight call the REST API with it), signing out
// revokes it and has the app forget it, what the share extension kept is saved to the Inbox, and the
// document scanner's pages and text go into the note. An init script stands in for bridge.js and the app;
// what the app holds survives reloads in localStorage, as the Keychain does.
import { expect, test, type Page } from "@playwright/test";
import { APP, newPerson, waitForSaved } from "./helpers";

/** A 1×1 PNG, the stand-in for a scanned page and a shared photo. */
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type Kept = { id: string; title: string; text: string; url: string; place: string | null; files: { name: string; type: string; data: string }[] };

function fakeApp(seed: { shares: Kept[]; pixel: string }) {
  const calls: { method: string; arg?: unknown }[] = [];
  const held = () => JSON.parse(localStorage.getItem("__held") ?? "null") as { tokenId: string; accountId: string } | null;
  const shares = JSON.parse(localStorage.getItem("__shares") ?? "null") ?? seed.shares;
  const bridge = {
    platform: "ios",
    version: "1.1",
    haptic: () => undefined,
    setStatusBar: () => undefined,
    openExternal: async () => true,
    getSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    setSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    onCommand: () => () => undefined,
    device: async () => ({ id: "E2E0DEVICE-0000-4000-8000-000000000001", family: "iPhone", model: "iPhone 18 Pro", accountId: held()?.accountId ?? null, tokenId: held()?.tokenId ?? null, scanner: false }),
    setCredential: async (c: { token: string; tokenId: string; accountId: string }) => {
      calls.push({ method: "setCredential", arg: { tokenId: c.tokenId, accountId: c.accountId } });
      localStorage.setItem("__held", JSON.stringify({ tokenId: c.tokenId, accountId: c.accountId }));
      localStorage.setItem("__token", c.token);
      return true;
    },
    clearCredential: async () => {
      calls.push({ method: "clearCredential" });
      localStorage.removeItem("__held");
    },
    takeShares: async () => shares,
    finishShare: async (id: string) => {
      calls.push({ method: "finishShare", arg: id });
      shares.splice(
        shares.findIndex((s: Kept) => s.id === id),
        1,
      );
      localStorage.setItem("__shares", JSON.stringify(shares));
    },
    scanDocument: async (source: string) => {
      calls.push({ method: "scanDocument", arg: source });
      return { pages: [{ name: "Scan 1.png", type: "image/png", data: seed.pixel }], text: "Invoice 2026-114\nTotal due 42.00\n\nPaid by card" };
    },
  };
  Object.defineProperty(window, "foleviNative", { value: bridge });
  Object.assign(window, { __native: { calls } });
  const mark = () => document.documentElement?.setAttribute("data-native", "ios");
  mark();
  if (!document.documentElement) new MutationObserver((_, watch) => document.documentElement && (mark(), watch.disconnect())).observe(document, { childList: true });
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __native: { calls: { method: string; arg?: unknown }[] } }).__native.calls);

async function api(page: Page, path: string, token: string) {
  const res = await page.request.get(`${APP}/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status(), json: res.status() === 200 ? await res.json() : null };
}

test("the iOS app gets a token for this device, keeps it, saves what the share extension kept, and loses it on sign-out", async ({ browser }) => {
  test.setTimeout(150_000);
  const { context, page } = await newPerson(browser, "Native Person");
  const kept: Kept[] = [{ id: "share-1", title: "Shelf ideas", text: "Oak, three tiers https://example.com/shelf", url: "", place: null, files: [{ name: "Sketch.png", type: "image/png", data: PIXEL }] }];
  await context.addInitScript(fakeApp, { shares: kept, pixel: PIXEL });
  await page.goto(`${APP}/documents`);

  // The page asks the app which token it holds (none), and gives it a new one for this account.
  await expect.poll(async () => (await calls(page)).filter((c) => c.method === "setCredential").length, { timeout: 20_000 }).toBe(1);
  const token = await page.evaluate(() => localStorage.getItem("__token")!);
  expect(token).toMatch(/^fvpat_/);
  const places = await api(page, "/places", token);
  expect(places).toEqual({ status: 200, json: { data: [{ id: "personal", name: "Personal" }] } });

  // What the share extension kept is saved to the Inbox, photo and all, and the app is told it's done.
  await expect(page.getByText("Saved what you shared to your Inbox")).toBeVisible({ timeout: 20_000 });
  expect((await calls(page)).filter((c) => c.method === "finishShare").map((c) => c.arg)).toEqual(["share-1"]);
  await expect.poll(async () => (await api(page, "/notes?q=Shelf", token)).json?.data.map((n: { title: string }) => n.title), { timeout: 20_000 }).toContain("Shelf ideas");

  // Settings > Connected apps lists it as this device's.
  await page.goto(`${APP}/settings/connected-apps`);
  const row = page.getByRole("listitem", { name: "Folevi for iPhone (iPhone 18 Pro)" });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.getByText("This device")).toBeVisible();
  await expect(row).toContainText("never expires");

  // The next launch: the app holds it, so nothing new is made and nothing is saved twice.
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  expect((await calls(page)).filter((c) => c.method === "setCredential" || c.method === "finishShare")).toEqual([]);
  expect((await api(page, "/places", token)).status).toBe(200);

  // Signing out revokes it and has the app forget it.
  await page.getByRole("navigation", { name: "Folio" }).getByRole("button", { name: /Personal, workspaces and account$/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/signin/);
  expect(await page.evaluate(() => localStorage.getItem("__held"))).toBeNull();
  expect((await api(page, "/places", token)).status).toBe(401);
  await context.close();
});

test("Scan from photos in the iOS app puts the pages and their text in the note", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await newPerson(browser, "Scan Person");
  await context.addInitScript(fakeApp, { shares: [], pixel: PIXEL });
  await page.goto(`${APP}/documents`);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill("Invoice");
  await page.keyboard.press("Enter");

  // The camera's scanner isn't on this device (as in the Simulator): only "Scan from photos".
  await page.keyboard.type("/scan");
  await expect(page.getByRole("option", { name: "Scan from photos" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Scan document" })).toHaveCount(0);
  await page.keyboard.press("Enter");
  expect((await calls(page)).filter((c) => c.method === "scanDocument").map((c) => c.arg)).toEqual(["photos"]);

  const body = page.getByRole("textbox", { name: "Document body" });
  await expect(body.locator("figure").first()).toBeVisible({ timeout: 20_000 });
  // The text is in a closed toggle under the page: kept, searchable, out of the way.
  const toggle = body.getByText("Text from the scan", { exact: true });
  await expect(toggle).toBeVisible();
  await expect(body.getByText("Invoice 2026-114 Total due 42.00")).toHaveCount(1);
  await expect(body.getByText("Invoice 2026-114 Total due 42.00")).toBeHidden();
  await expect(body.getByText("Paid by card")).toHaveCount(1);
  await waitForSaved(page);
  await context.close();
});
