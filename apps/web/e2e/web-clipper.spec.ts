import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Worker } from "@playwright/test";
import { APP, completeOnboarding, createAccount } from "./helpers";

// Folevi Web Clipper (apps/clipper), loaded unpacked in Chromium against this server: it registers from its
// service worker, the person allows it on the consent screen (offered adding only, and recorded as
// create-only), it trades the code for tokens, and a clip lands under the Inbox page. The one thing a test
// can't drive is chrome.identity's own sign-in window, so the test opens the same authorize URL in a tab
// and hands the redirect back to the extension. Reading pages is covered by apps/clipper's unit tests.
// The parts of the extension API the test calls inside the extension (apps/web doesn't load chrome's types).
type StorageArea = { get: (keys: null) => Promise<Record<string, unknown>> };
declare const chrome: {
  identity: { launchWebAuthFlow: (details: { url: string }) => Promise<string> };
  storage: { local: StorageArea; session: StorageArea };
  runtime: { sendMessage: (message: unknown) => Promise<unknown> };
};

const CLIPPER = fileURLToPath(new URL("../../clipper/", import.meta.url));

test.skip(!existsSync(join(CLIPPER, "node_modules/esbuild")), "apps/clipper's dependencies aren't installed (pnpm install --ignore-workspace in apps/clipper)");

test("the web clipper signs in with an add-only grant and clips into the Inbox", async () => {
  const dist = mkdtempSync(join(tmpdir(), "folevi-clipper-"));
  execFileSync("node", ["scripts/build.mjs"], { cwd: CLIPPER, env: { ...process.env, FOLEVI_ORIGIN: APP, CLIPPER_DIST: dist }, stdio: "ignore" });
  const context = await chromium.launchPersistentContext("", { channel: "chromium", args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
  try {
    const worker: Worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    const redirectUri = `https://${extensionId}.chromiumapp.org/`;
    // The sign-in window, stood in for: the extension hands over the URL it would open and waits for the redirect.
    await worker.evaluate(() => {
      const w = self as unknown as { authUrl?: string; finishAuth?: (url: string) => void };
      chrome.identity.launchWebAuthFlow = async (details) => {
        w.authUrl = details.url;
        return await new Promise<string>((resolve) => (w.finishAuth = resolve));
      };
    });

    const { page } = await createAccount(context, { name: "Clipper Person" });
    await completeOnboarding(page);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole("heading", { name: "Save pages to Folevi" })).toBeVisible();
    await popup.getByRole("button", { name: "Sign in to Folevi" }).click();
    await expect.poll(() => worker.evaluate(() => (self as unknown as { authUrl?: string }).authUrl ?? "")).toContain("/api/auth/oauth2/authorize?");
    const authUrl = new URL(await worker.evaluate(() => (self as unknown as { authUrl: string }).authUrl));
    expect(authUrl.origin).toBe(new URL(APP).origin);
    expect(authUrl.searchParams.get("scope")).toBe("notes:write offline_access");
    expect(authUrl.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");

    // The person's browser opens it (signed in, so Folevi asks for consent; the development backend may name
    // another local port, so the consent page is opened on this server).
    const step = await page.request.get(authUrl.toString(), { maxRedirects: 0, failOnStatusCode: false, headers: { accept: "text/html", "sec-fetch-mode": "navigate" } });
    const location = step.headers()["location"] ?? ((await step.json().catch(() => ({}))) as { url?: string }).url;
    expect(location).toContain("/oauth/consent?");
    const consent = new URL(location!, APP);
    await page.route("https://*.chromiumapp.org/**", (route) => route.fulfill({ status: 200, body: "ok" }));
    await page.goto(`${APP}${consent.pathname}${consent.search}`);
    await expect(page.getByRole("heading", { name: "Connect Folevi Web Clipper to Folevi" })).toBeVisible();
    await expect(page.getByText("wants to add notes to Folevi")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Create notes and add to them" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Search and read your notes" })).toHaveCount(0);
    const addOnly = page.getByRole("switch", { name: "Only add new things" });
    await expect(addOnly).toHaveAttribute("aria-checked", "true");
    await expect(addOnly).toBeDisabled();
    const back = page.waitForRequest((r) => r.url().startsWith(redirectUri));
    await page.getByRole("button", { name: "Allow" }).click();
    const redirected = (await back).url();
    await worker.evaluate((url) => (self as unknown as { finishAuth: (u: string) => void }).finishAuth(url), redirected);

    // Signed in: the popup shows its signed-in view (this tab is the popup itself, which can't be clipped).
    await expect(popup.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(popup.getByText("Folevi can't clip this page.", { exact: false })).toBeVisible();
    const stored = await worker.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
    expect(stored.local.refreshToken).toMatch(/^fvrt_/);
    expect((stored.session.accessToken as { token: string }).token).toMatch(/^fvat_/);

    // A clip, as the popup sends it once it has read a page.
    const clip = { kind: "article", title: "Keeping clean notes", pageUrl: "https://example.com/clean-notes", markdown: "## Why\n\nClipped text stays readable.", byline: "Sam Lee", siteName: "Example Weekly" };
    const places = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "places" }));
    expect(places).toEqual({ ok: true, value: [{ id: "personal", name: "Personal" }] });
    const saved = (await popup.evaluate((c) => chrome.runtime.sendMessage({ type: "save", clip: c }), clip)) as { ok: boolean; value: { url: string; title: string; place: string } };
    expect(saved).toMatchObject({ ok: true, value: { title: "Keeping clean notes", place: "Personal" } });

    // It's a page under the Inbox, with the source line.
    await page.goto(saved.value.url.replace(/^https?:\/\/[^/]+/, APP));
    await expect(page.getByText("Clipped text stays readable.")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('a[href="https://example.com/clean-notes"]')).toHaveText("Keeping clean notes");
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).first().getByText("Inbox")).toBeVisible();

    // Settings > Connected apps: add-only, in Personal.
    await page.goto(`${APP}/settings/connected-apps`);
    await expect(page.getByRole("listitem", { name: "Folevi Web Clipper" })).toContainText("Only adds new things in Personal");

    // Signing out forgets the tokens.
    await popup.getByRole("button", { name: "Sign out" }).click();
    await expect(popup.getByRole("button", { name: "Sign in to Folevi" })).toBeVisible();
    const after = await worker.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
    expect(after.local.refreshToken).toBeUndefined();
    expect(after.session.accessToken).toBeUndefined();
  } finally {
    await context.close();
  }
});
