// Notes written with no connection (docs/SYNC_PROTOCOL.md, lib/sync/localNotes.ts): a note made offline shows at
// once in Home's recent notes, All notes and search, marked "Waiting to sync"; it survives a reload with no
// connection; once the connection is back it reaches the server (a second device sees it) and the mark goes.
// The same on the iPhone and iPad apps' layouts, whose touch sync status (components/iphone/SyncStatusTouch.tsx)
// says what's waiting. And the reconnect race: what's sent before the server has taken the sign-in again is no
// longer parked until the person signs in again.
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { APP, convexUrl, newPerson, showFolders, waitForSaved } from "./helpers";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";

/** What the iOS app gives the page before its first script: a stand-in bridge and <html data-native="ios">. */
function iosBridge() {
  const bridge = {
    platform: "ios",
    version: "1.0",
    haptic: () => undefined,
    setStatusBar: () => undefined,
    openExternal: async () => true,
    getSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    setSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    onCommand: () => () => undefined,
  };
  Object.defineProperty(window, "foleviNative", { value: bridge });
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

/**
 * Cuts the page off from the auth server and the backend (the app shell still loads, as it does from the
 * service worker or the app's built-in interface), and lets it back on. Set up before the page loads.
 * `holdAuth` keeps the backend's sign-in back for a moment after reconnecting (the token arriving after the socket).
 */
async function cutter(page: Page) {
  const state = { blocked: false, holdAuthMs: 0 };
  const open = new Set<{ close: () => Promise<void> }>();
  await page.route("**/api/auth/**", (route) => (state.blocked ? route.abort("internetdisconnected") : route.continue()));
  const backendHost = new URL(convexUrl()).host;
  await page.routeWebSocket(
    (url) => url.host === backendHost || url.hostname.endsWith(".convex.cloud"),
    (ws) => {
      if (state.blocked) return void ws.close();
      const server = ws.connectToServer();
      open.add(ws);
      ws.onClose(() => open.delete(ws));
      const hold = state.holdAuthMs;
      let held: (string | Buffer)[] | null = hold ? [] : null;
      ws.onMessage((m) => {
        if (held && /"type":"Authenticate"/.test(String(m))) {
          // The sign-in goes after everything sent in the next moments (as a token that's slow to come back).
          held.push(m);
          setTimeout(() => {
            const out = held ?? [];
            held = null;
            for (const x of out) server.send(x);
          }, hold);
          return;
        }
        server.send(m);
      });
      server.onMessage((m) => ws.send(m));
    },
  );
  return {
    /** Cut off: new connections fail and the open one drops (as the network going away). */
    block: () => {
      state.blocked = true;
      for (const ws of open) void ws.close().catch(() => undefined);
      open.clear();
    },
    unblock: (holdAuthMs = 0) => {
      state.blocked = false;
      state.holdAuthMs = holdAuthMs;
    },
  };
}

const cardOf = (page: Page, title: string) => page.getByRole("link").filter({ hasText: title });

async function goHome(page: Page) {
  await showFolders(page);
  await page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
}

async function goAllNotes(page: Page) {
  await showFolders(page);
  await page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "All notes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All notes", level: 1 })).toBeVisible();
}

async function writeNote(page: Page, title: string, body: string) {
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  const id = /\/d\/([0-9A-Z]{26})/.exec(page.url())![1]!;
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type(body);
  return id;
}

async function secondDevice(browser: Browser, context: BrowserContext): Promise<Page> {
  const other = await browser.newContext({ storageState: await context.storageState() });
  return other.newPage();
}

test("a note made offline shows in Home, All notes and search, then syncs and the mark clears", async ({ browser }) => {
  test.setTimeout(180_000);
  const { page, context } = await newPerson(browser, "Offline Writer");
  await waitForSaved(page);
  // Seen once online (the lists are kept on this device).
  await goHome(page);
  await expect(cardOf(page, "Welcome to Folevi").first()).toBeVisible();
  await goAllNotes(page);
  await goHome(page);

  await context.setOffline(true);
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "offline", { timeout: 15_000 });
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const id = await writeNote(page, "Offline test", "I'm working offline now");
  // The tab carries the title given offline.
  await expect(page.getByRole("tab", { name: /Offline test/ }).or(page.getByRole("link", { name: /Offline test/ })).first()).toBeVisible();

  await goHome(page);
  const recent = page.getByRole("list", { name: "Recent notes" });
  const card = recent.getByRole("link").filter({ hasText: "Offline test" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("I'm working offline now");
  await expect(recent.locator('[data-waiting-to-sync="queued"]')).toHaveCount(1);
  await expect(cardOf(page, "Welcome to Folevi").first()).toBeVisible();

  await goAllNotes(page);
  await expect(page.locator(`[data-card-id="${id}"]`)).toBeVisible();
  await expect(page.locator(`[data-card-id="${id}"]`)).toContainText("Waiting to sync");

  // Search finds it with no connection.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Search documents or type a command" }).fill("offline test");
  await expect(page.getByRole("option", { name: /Offline test/ }).first()).toBeVisible();
  await page.keyboard.press("Escape");

  await context.setOffline(false);
  await waitForSaved(page);
  await expect(page.locator(`[data-card-id="${id}"]`)).toBeVisible();
  await expect(page.locator(`[data-card-id="${id}"]`)).not.toContainText("Waiting to sync", { timeout: 15_000 });

  // Another device signed in to the same account has it, with what was written.
  const other = await secondDevice(browser, context);
  await other.goto(`${APP}/notes`);
  await expect(other.locator(`[data-card-id="${id}"]`)).toBeVisible({ timeout: 30_000 });
  await other.goto(`${APP}/d/${id}`);
  await expect(other.getByRole("textbox", { name: "Document body" })).toContainText("I'm working offline now");
  await other.context().close();
});

test("relaunched with no connection, a note made offline is still there; back online it syncs even if the sign-in is slow to return", async ({ browser }) => {
  test.setTimeout(240_000);
  const { page, context } = await newPerson(browser, "Cold Offline Writer");
  await waitForSaved(page);
  await page.waitForFunction(() => Boolean(localStorage.getItem("folevi:last-account")));
  const net = await cutter(page);
  await goAllNotes(page);
  await goHome(page);

  // Cut off, relaunched, a note written.
  net.block();
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "offline", { timeout: 15_000 });
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const id = await writeNote(page, "Cold start note", "Written with no server at all");
  await page.waitForTimeout(800);

  // Relaunched again, still cut off: it's in the lists and its words are kept.
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Folio" })).toBeVisible({ timeout: 25_000 });
  await goHome(page);
  await expect(page.getByRole("list", { name: "Recent notes" }).getByRole("link").filter({ hasText: "Cold start note" })).toBeVisible({ timeout: 15_000 });
  await goAllNotes(page);
  await expect(page.locator(`[data-card-id="${id}"]`)).toContainText("Waiting to sync");
  await page.locator(`[data-card-id="${id}"]`).getByRole("link").first().click();
  await expect(page.getByRole("textbox", { name: "Document body" })).toContainText("Written with no server at all");

  // Back online, with the backend taking the sign-in only a few seconds after the socket is up: what's queued
  // waits for it instead of being refused and parked.
  net.unblock(6000);
  await page.reload();
  await waitForSaved(page);
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "saved", { timeout: 60_000 });

  const other = await secondDevice(browser, context);
  await other.goto(`${APP}/d/${id}`);
  await expect(other.getByRole("textbox", { name: "Document body" })).toContainText("Written with no server at all", { timeout: 30_000 });
  await expect(other.getByRole("textbox", { name: "Title" })).toHaveValue("Cold start note");
  await other.context().close();
});

test("one note edited on two devices while one is offline: both edits are kept", async ({ browser }) => {
  test.setTimeout(180_000);
  const { page: a, context } = await newPerson(browser, "Two Places");
  await a.getByRole("button", { name: "New note", exact: true }).click();
  const id = await writeNote(a, "Shared plan", "First line");
  await waitForSaved(a);
  const b = await secondDevice(browser, context);
  await b.goto(`${APP}/d/${id}`);
  const bodyB = b.getByRole("textbox", { name: "Document body" });
  await expect(bodyB).toContainText("First line");

  // B goes offline, adds a line and renames the note.
  await b.context().setOffline(true);
  await bodyB.click();
  await b.keyboard.press("ControlOrMeta+End");
  await b.keyboard.press("Enter");
  await b.keyboard.type("Line from the offline device");
  await expect(b.getByTestId("sync-status")).toHaveAttribute("data-status", "offline", { timeout: 15_000 });

  // A, online, adds its own line.
  const bodyA = a.getByRole("textbox", { name: "Document body" });
  await bodyA.click();
  await a.keyboard.press("ControlOrMeta+End");
  await a.keyboard.press("Enter");
  await a.keyboard.type("Line from the online device");
  await waitForSaved(a);

  await b.context().setOffline(false);
  await waitForSaved(b);
  await expect(bodyB).toContainText("Line from the online device", { timeout: 20_000 });
  await expect(bodyB).toContainText("Line from the offline device");
  await expect(bodyA).toContainText("Line from the offline device", { timeout: 20_000 });
  await expect(bodyA).toContainText("Line from the online device");
  await b.context().close();
});

for (const device of ["iPhone", "iPad"] as const) {
  test(`${device} app: a note made offline shows in Home and All notes, the sync status says so, then it syncs`, async ({ browser }) => {
    test.setTimeout(240_000);
    const { context: signedIn } = await newPerson(browser, `${device} Offline`);
    const state = await signedIn.storageState();
    await signedIn.close();
    const phone = device === "iPhone";
    const context = await browser.newContext({
      storageState: state,
      viewport: phone ? { width: 402, height: 874 } : { width: 1180, height: 820 },
      userAgent: phone ? IPHONE_UA : IPAD_UA,
      hasTouch: true,
    });
    await context.addInitScript(iosBridge);
    const page = await context.newPage();
    // The app's interface is on the device (the built-in shell), so only the server is cut off: Back to the
    // first screen may reload the page, which then opens from this device as the app does.
    const net = await cutter(page);
    // Nothing may take the app down on the way (a query run as nobody while the sign-in is on its way back).
    const crashes: string[] = [];
    page.on("pageerror", (e) => crashes.push(e.message));
    await page.goto(`${APP}/documents`);
    await expect(page.locator("html")).toHaveAttribute(phone ? "data-iphone" : "data-ipad", "", { timeout: 30_000 });
    const status = page.getByTestId(phone ? "sync-status-touch" : "sync-status");
    await expect(status).toHaveAttribute("data-status", "saved", { timeout: 30_000 });
    await expect(page.getByRole("list", { name: "Recent notes" }).getByRole("link").filter({ hasText: "Welcome to Folevi" })).toBeVisible({ timeout: 30_000 });

    net.block();
    await expect(status).toHaveAttribute("data-status", "offline", { timeout: 15_000 });
    if (phone) {
      await page.getByRole("button", { name: "Create" }).click();
      await page.getByRole("menuitem", { name: "New note" }).click();
    } else {
      await page.getByRole("button", { name: "New note", exact: true }).click();
    }
    const id = await writeNote(page, `${device} offline note`, "Typed on the train");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    if (phone) {
      // The note's own bar says its changes are on this device.
      await expect(page.getByTestId("note-sync-status")).toHaveAttribute("data-status", "offline", { timeout: 10_000 });
      await page.getByRole("button", { name: "Back", exact: true }).click();
    } else {
      await showFolders(page);
      await page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "Home", exact: true }).click();
    }
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    const card = page.getByRole("list", { name: "Recent notes" }).getByRole("link").filter({ hasText: `${device} offline note` });
    await expect(card).toBeVisible();
    await expect(page.getByRole("list", { name: "Recent notes" }).locator('[data-waiting-to-sync="queued"]')).toHaveCount(1);
    if (phone) {
      // The status counts what's waiting; its sheet lists the note.
      await expect(status).toHaveAccessibleName(/Waiting to sync, \d+ changes? on this device/);
      await status.click();
      const sheet = page.getByTestId("sync-sheet");
      await expect(sheet).toHaveAttribute("data-status", "offline");
      await expect(sheet).toContainText(`${device} offline note`);
      await page.keyboard.press("Escape");
      await page.getByRole("link", { name: "All notes" }).click();
    } else {
      await page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "All notes", exact: true }).click();
    }
    await expect(page.getByRole("heading", { level: 1, name: "All notes" })).toBeVisible();
    await expect(page.getByText(`${device} offline note`).first()).toBeVisible();
    await expect(page.getByText("Waiting to sync").first()).toBeVisible();

    net.unblock();
    await expect(page.getByText("Waiting to sync")).toHaveCount(0, { timeout: 60_000 });
    if (phone) await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(status).toHaveAttribute("data-status", "saved", { timeout: 30_000 });
    await expect(page.getByText("Waiting to sync")).toHaveCount(0);
    const other = await browser.newContext({ storageState: state });
    const web = await other.newPage();
    await web.goto(`${APP}/d/${id}`);
    await expect(web.getByRole("textbox", { name: "Document body" })).toContainText("Typed on the train", { timeout: 30_000 });
    await other.close();
    expect(crashes.filter((m) => /unauthenticated/.test(m))).toEqual([]);
    await context.close();
  });
}
