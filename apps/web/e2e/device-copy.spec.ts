// The device copy (docs/NATIVE_APP_PLAN.md §11, lib/sync/deviceCopy.ts): a device signed in fresh downloads
// every note in the background; offline, a note never opened on it opens from that copy; an edit made on
// another device reaches the copy, and a note deleted there leaves it. With a slow server, opening a note shows
// its words from the copy before the server answers (time to first content, measured).
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { APP, convexUrl, newPerson, showFolders, waitForSaved } from "./helpers";

/** Holds every message from the backend back by `delay` ms (a slow network), in order; or cuts it off. */
async function slowBackend(page: Page) {
  const state = { delay: 0, blocked: false };
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
      ws.onMessage((m) => server.send(m));
      server.onMessage((m) => {
        if (state.delay) setTimeout(() => ws.send(m), state.delay);
        else ws.send(m);
      });
    },
  );
  return {
    setDelay: (ms: number) => (state.delay = ms),
    block: () => {
      state.blocked = true;
      for (const ws of open) void ws.close().catch(() => undefined);
      open.clear();
    },
    unblock: () => (state.blocked = false),
  };
}

/** The text of every note the device copy holds whole (read from the account's IndexedDB). */
async function copiedText(page: Page): Promise<Record<string, string>> {
  return await page.evaluate(async () => {
    const names = ((await indexedDB.databases()) ?? []).map((d) => d.name ?? "").filter((n) => /^folevi-[A-Za-z0-9_-]+$/.test(n) && !n.startsWith("folevi-e2ee") && !n.startsWith("folevi-local"));
    const out: Record<string, string> = {};
    for (const name of names) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      if (!db.objectStoreNames.contains("blocks")) {
        db.close();
        continue;
      }
      const all = await new Promise<{ documentId: string; by?: string; blocks: { text: { text?: string }[] }[] }[]>((resolve) => {
        const req = db.transaction("blocks").objectStore("blocks").getAll();
        req.onsuccess = () => resolve(req.result as never);
      });
      for (const e of all) if (e.by === "copy") out[e.documentId] = e.blocks.map((b) => (Array.isArray(b.text) ? b.text.map((t) => t.text ?? "").join("") : "")).join("\n");
      db.close();
    }
    return out;
  });
}

async function writeNote(page: Page, title: string, body: string): Promise<string> {
  const before = /\/d\/([0-9A-Z]{26})/.exec(page.url())?.[1];
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL((u) => /\/d\/[0-9A-Z]{26}\?new=1/.test(u.href) && !u.pathname.includes(before ?? "-"));
  const id = /\/d\/([0-9A-Z]{26})/.exec(page.url())![1]!;
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type(body);
  await waitForSaved(page);
  return id;
}

async function goAllNotes(page: Page) {
  await showFolders(page);
  await page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "All notes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All notes", level: 1 })).toBeVisible();
}

/** Another device signed in to the same account, with nothing on it yet (no IndexedDB). */
async function freshDevice(browser: Browser, context: BrowserContext) {
  const other = await browser.newContext({ storageState: await context.storageState() });
  const page = await other.newPage();
  const net = await slowBackend(page);
  await page.goto(`${APP}/documents`);
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible({ timeout: 30_000 });
  return { other, page, net };
}

test("a fresh device keeps every note: offline a never-opened note opens, edits and deletions elsewhere reach it", async ({ browser }) => {
  test.setTimeout(240_000);
  const { page: writer, context } = await newPerson(browser, "Copy Writer");
  const id = await writeNote(writer, "Copy target", "Words written on the other device");
  const second = await writeNote(writer, "Second note", "Another one to download");

  const { other, page, net } = await freshDevice(browser, context);
  // The copy fills in the background: both notes' words are on this device without opening them.
  await expect.poll(async () => (await copiedText(page))[id] ?? "", { timeout: 60_000 }).toContain("Words written on the other device");
  await expect.poll(async () => (await copiedText(page))[second] ?? "", { timeout: 30_000 }).toContain("Another one to download");

  // Offline: the list reads the copy, and the note opens from it.
  net.block();
  await other.setOffline(true);
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "offline", { timeout: 15_000 });
  await goAllNotes(page);
  await page.locator(`[data-card-id="${id}"]`).getByRole("link").first().click();
  await expect(page.getByRole("textbox", { name: "Document body" })).toContainText("Words written on the other device", { timeout: 10_000 });
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Copy target");

  // Back online and on Home: an edit on the other device reaches this device's copy.
  net.unblock();
  await other.setOffline(false);
  await page.goto(`${APP}/documents`);
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible({ timeout: 30_000 });
  await writer.goto(`${APP}/d/${second}`);
  const body = writer.getByRole("textbox", { name: "Document body" });
  await expect(body).toContainText("Another one to download");
  await body.click();
  await writer.keyboard.press("ControlOrMeta+End");
  await writer.keyboard.type(" and edited later");
  await waitForSaved(writer);
  await expect.poll(async () => (await copiedText(page))[second] ?? "", { timeout: 60_000 }).toContain("and edited later");

  // Deleted on the other device: it leaves this device's lists, even offline.
  await writer.getByRole("group", { name: "Page" }).getByRole("button", { name: "Document actions" }).click();
  await writer.getByRole("menuitem", { name: /Move to Trash|Delete/ }).first().click();
  const confirm = writer.getByRole("dialog").getByRole("button", { name: /Move to Trash|Delete/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await waitForSaved(writer);
  await page.waitForTimeout(8000);
  net.block();
  await other.setOffline(true);
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "offline", { timeout: 15_000 });
  await goAllNotes(page);
  await expect(page.locator(`[data-card-id="${id}"]`)).toBeVisible();
  await expect(page.locator(`[data-card-id="${second}"]`)).toHaveCount(0);
  await other.close();
});

test("with a slow server, a note opens from the device copy before the server answers (time to first content)", async ({ browser }) => {
  test.setTimeout(240_000);
  const { page: writer, context } = await newPerson(browser, "Copy Timer");
  const id = await writeNote(writer, "Timed note", "Timing the first words on screen");
  const { other, page, net } = await freshDevice(browser, context);
  // Let the copy fill (it doesn't exist before R1: then this just waits a while).
  await expect
    .poll(async () => (await copiedText(page))[id] ?? "", { timeout: 30_000 })
    .toContain("Timing")
    .catch(() => undefined);
  await goAllNotes(page);
  await expect(page.locator(`[data-card-id="${id}"]`)).toBeVisible({ timeout: 30_000 });
  // A slow network from here: every answer from the server takes 1.5 s.
  net.setDelay(1500);
  const started = Date.now();
  await page.locator(`[data-card-id="${id}"]`).getByRole("link").first().click();
  await expect(page.getByRole("textbox", { name: "Document body" })).toContainText("Timing the first words on screen", { timeout: 20_000 });
  const firstContent = Date.now() - started;
  console.log(`[device-copy] time to first content with a 1.5 s server: ${firstContent} ms`);
  test.info().annotations.push({ type: "time-to-first-content-ms", description: String(firstContent) });
  expect(firstContent).toBeLessThan(1500);
  // Settings says how much is on this device.
  net.setDelay(0);
  await page.goto(`${APP}/settings/sync`);
  const card = page.getByTestId("device-copy-settings");
  await expect(card.getByRole("switch", { name: "Keep all notes on this device" })).toBeChecked();
  await expect(card.locator('[data-copy-scope="personal"]')).toContainText(/All [\d,]+ notes on this device/, { timeout: 30_000 });
  await other.close();
});
