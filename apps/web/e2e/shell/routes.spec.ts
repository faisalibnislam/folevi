// The bundled shell in Chromium, served from out-shell/ with the hosts' SPA fallback (scripts/serve-shell.mjs):
// deep links hydrate at their route, client navigation uses pushState, the first-launch choice reaches the
// host, and no service worker is registered. Turned from Phase 0 spike S1's check script (docs/LOCAL_MODE.md).
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { APP, newPerson } from "../helpers";

const DEEP_LINKS = ["/d/01JABCDEFGHJKMNPQRSTVWXYZ0", "/tasks/today", "/settings/appearance?x=1"];

/** A stand-in for the host's bridge (window.foleviShell, lib/shell/types.ts): the mode, and setMode recorded. */
async function fakeShell(context: BrowserContext, initialMode: "unset" | "local" | "account") {
  await context.addInitScript((mode) => {
    const w = window as unknown as { foleviShell: unknown; __setModes: string[] };
    w.__setModes = [];
    w.foleviShell = {
      platform: "mac",
      shellVersion: "0.0.0-test",
      initialMode: mode,
      setMode: async (m: string) => void w.__setModes.push(m),
    };
  }, initialMode);
}

/** Console errors and uncaught errors, for the hydration checks. */
function problems(page: Page): string[] {
  const out: string[] = [];
  page.on("console", (m) => m.type() === "error" && out.push(m.text()));
  page.on("pageerror", (e) => out.push(e.message));
  return out;
}
const HYDRATION = /hydrat|Minified React error #(418|423|425)|did not match/i;

/** True once React has hydrated the page: its nodes carry React's fiber keys. */
const hydrated = (page: Page) => page.waitForFunction(() => {
  const main = document.querySelector("main");
  return Boolean(main && Object.keys(main).some((k) => k.startsWith("__reactFiber")));
});

test.describe("without a server", () => {
  for (const link of DEEP_LINKS) {
    test(`${link} hydrates at its own address`, async ({ page }) => {
      const errors = problems(page);
      const response = await page.goto(link);
      expect(response?.status()).toBe(200);
      await hydrated(page);
      // Next seeds its router from the address (no rewrite to "/" and no 404 page).
      const url = new URL(link, "http://x");
      expect(await page.evaluate(() => location.pathname + location.search)).toBe(url.pathname + url.search);
      await expect(page.getByText("This page could not be found")).toHaveCount(0);
      // Fonts and Tailwind arrived from the export.
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-instrument-sans").trim())).not.toBe("");
      // pushState moves the app without a reload (a marker on window survives).
      await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 1));
      await page.evaluate(() => history.pushState(null, "", "/calendar/2026-10"));
      await expect.poll(() => page.evaluate(() => location.pathname)).toBe("/calendar/2026-10");
      expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);
      expect(errors.filter((e) => HYDRATION.test(e))).toEqual([]);
    });
  }

  test("no service worker is registered", async ({ page }) => {
    await page.goto("/documents");
    await hydrated(page);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
    expect((await page.request.get("/sw.js")).headers()["content-type"]).toContain("text/html");
  });

  // What local mode builds on (spike S1/S2's probe, now here; the native apps run the same on app://folevi).
  test("the web platform APIs local mode needs work on the shell's origin", async ({ page }) => {
    await page.goto("/documents");
    await hydrated(page);
    const apis = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open("shell-check", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      await new Promise<void>((res, rej) => {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(42, "answer");
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      const stored = await new Promise((res) => {
        const g = db.transaction("kv").objectStore("kv").get("answer");
        g.onsuccess = () => res(g.result);
      });
      db.close();
      const lock = await navigator.locks.request("folevi-shell-check", { ifAvailable: true }, async (l) => Boolean(l));
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode("folevi"));
      const opened = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, sealed));
      new BroadcastChannel("folevi-shell-check").close();
      await navigator.storage.getDirectory();
      return { secure: window.isSecureContext, stored, lock, opened };
    });
    expect(apis).toEqual({ secure: true, stored: 42, lock: true, opened: "folevi" });
  });

  test("first launch: the choice is saved with the host and opens the product", async ({ context, page }) => {
    await fakeShell(context, "unset");
    await page.goto("/documents");
    const choice = page.getByTestId("mode-choice");
    await expect(choice.getByRole("heading", { name: "Where should your notes live?" })).toBeVisible();
    await choice.getByRole("button", { name: /Keep notes on my devices/ }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __setModes: string[] }).__setModes)).toEqual(["local"]);
    await expect(choice).toHaveCount(0);
  });

  test("a mode the host already chose skips the choice", async ({ context, page }) => {
    await fakeShell(context, "account");
    await page.goto("/tasks/today");
    await hydrated(page);
    await expect(page.getByTestId("mode-choice")).toHaveCount(0);
  });
});

// Signed in, against the dev server and the dev Convex deployment: the export's auth calls (to the build's
// NEXT_PUBLIC_APP_URL, which the shell's CSP doesn't allow until native bearer fetch lands, WP4) are answered
// by the dev server for a signed-in test account, so the real product renders at each route.
test.describe("signed in", () => {
  test.skip(!process.env.E2E_BASE_URL, "needs the dev server: E2E_BASE_URL=http://app.localhost:3002");

  test("deep links open the right view and the sidebar navigates with pushState", async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const person = await newPerson(browser, "Shell Person");
    const welcome = new URL(person.page.url()).pathname;
    expect(welcome).toMatch(/^\/d\/[0-9A-Z]{26}$/);

    const shellOrigin = new URL(baseURL!).origin;
    const context = await browser.newContext({ bypassCSP: true });
    await fakeShell(context, "account");
    await context.route(
      (url) => url.pathname.startsWith("/api/"),
      async (route) => {
        const req = route.request();
        const cors: Record<string, string> = {
          "access-control-allow-origin": shellOrigin,
          "access-control-allow-credentials": "true",
          "access-control-allow-headers": req.headers()["access-control-request-headers"] ?? "content-type",
          "access-control-allow-methods": "GET, POST, OPTIONS",
        };
        if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
        const u = new URL(req.url());
        const res = await person.context.request.fetch(`${APP}${u.pathname}${u.search}`, {
          method: req.method(),
          headers: { "content-type": req.headers()["content-type"] ?? "application/json" },
          data: req.postDataBuffer() ?? undefined,
          maxRedirects: 0,
        });
        const headers: Record<string, string> = { ...res.headers(), ...cors };
        delete headers["set-cookie"];
        delete headers["content-encoding"];
        delete headers["content-length"];
        return route.fulfill({ status: res.status(), headers, body: await res.body() });
      },
    );
    const page = await context.newPage();
    const errors = problems(page);

    await page.goto(welcome);
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Welcome to Folevi", { timeout: 60_000 });
    const today = () => page.getByRole("navigation", { name: "Task views" }).getByRole("link", { name: /^Today/ });
    await page.goto("/tasks/today");
    await expect(today()).toHaveAttribute("aria-current", "page", { timeout: 60_000 });
    await page.goto("/settings/appearance");
    await expect(page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Appearance" })).toHaveAttribute("aria-current", "page", { timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 2, name: "Appearance" })).toBeVisible();

    // Client navigation: the sidebar's links push history entries; the page never reloads.
    await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 1));
    const sidebar = page.getByRole("navigation", { name: "Folio" });
    await sidebar.getByRole("link", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/\/calendar/);
    await sidebar.getByRole("link", { name: /^Tasks/ }).click();
    await expect(page).toHaveURL(/\/tasks\/today$/);
    await expect(today()).toHaveAttribute("aria-current", "page");
    await page.goBack();
    await expect(page).toHaveURL(/\/calendar/);
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);
    expect(errors.filter((e) => HYDRATION.test(e))).toEqual([]);
    await context.close();
    await person.context.close();
  });
});
