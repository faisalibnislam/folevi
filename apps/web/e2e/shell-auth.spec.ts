// Signed-in mode in the apps' built-in interface (docs/LOCAL_MODE_PLAN.md §1, WP4), end to end: the shell
// served by `next dev` with FOLEVI_BUILD=shell (port 3003, NEXT_PUBLIC_APP_URL pointing at the 3002 dev
// server, see docs/LOCAL_MODE.md) with a FakeShell whose `auth` is the native apps' sign-in bridge in Node
// (fixtures/authBridge.ts, the same contract as ShellAuth.swift): real PKCE sign-in through /connect on the website,
// the code exchanged at /api/auth/native/token, the bearer kept outside the page, every /api/auth request
// and Convex token through it. The page reaches a signed-in note, never sees the token, and signing out
// revokes the session.
//
//   E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 npx playwright test e2e/shell-auth.spec.ts
// (E2E_SHELL_BASE_URL overrides http://localhost:3003.)
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  expect,
  request as playwrightRequest,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  createAuthBridge,
  SHELL_CLIENT_ID,
  type AuthBridge,
  type BridgeResponse,
} from "./fixtures/authBridge";
import { APP, convexUrl, newPerson } from "./helpers";

const SHELL = (process.env.E2E_SHELL_BASE_URL ?? "http://localhost:3003").replace(/\/$/, "");

test.skip(
  !process.env.E2E_BASE_URL,
  "needs the dev servers: E2E_BASE_URL=http://app.localhost:3002 and the shell on 3003",
);

/** The Mac app's auth bridge, here in Node, approving sign-ins as `approver` (signed in on the website). */
function nodeBridge(approver: () => Page) {
  const store = new Map<string, string>();
  const seen = {
    bodies: [] as string[],
    paths: [] as string[],
    convexTokens: 0,
    connectUrls: [] as string[],
    /** Every page the browser half showed, in order (the provider's included). */
    visited: [] as string[],
    /** What /app-google asked Better Auth for (provider, callbackURL). */
    socialStarts: [] as { provider?: string; callbackURL?: string }[],
  };
  const bridge: AuthBridge = createAuthBridge({
    serviceUrl: new URL(APP),
    fetch: (url, init) => fetch(url, init),
    // The browser half: /connect on the website, Continue, and the folevi://auth/callback link it ends on; or,
    // for the app's own Continue with Google or Apple, /app-google straight on to the provider.
    openExternal: (url) => (new URL(url).pathname === "/app-google" ? viaProvider(url) : approve(url)),
    store: {
      get: (n) => store.get(n) ?? null,
      set: (n, v) => void store.set(n, v),
      delete: (n) => void store.delete(n),
    },
    deviceName: () => "E2E Mac",
  });
  async function approve(url: string) {
    seen.connectUrls.push(url);
    const page = approver();
    const state = new URL(url).searchParams.get("state")!;
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Sign in to Folevi app" })).toBeVisible({
      timeout: 30_000,
    });
    const authorized = page.waitForResponse((r) => r.url().includes("/api/auth/native/authorize"));
    await page.getByRole("button", { name: "Continue" }).click();
    const { code } = (await (await authorized).json()) as { code: string };
    await expect(page.getByRole("heading", { name: "Back to Folevi app" })).toBeVisible();
    // What macOS hands the app when the page sends the browser to folevi://auth/callback.
    bridge.handleCallback(
      `folevi://auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    );
  }
  /**
   * /app-google: the page goes straight on to Google's or Apple's own page, no choices on the way. Neither runs
   * here (and the dev deployment has no Google keys), so the provider's host answers with a blank page and the
   * test then comes back as the provider would, to the callbackURL /app-google gave Better Auth, as `approver`
   * (signed in, as the provider's callback would have left it). The page issues the code by itself.
   */
  async function viaProvider(url: string) {
    seen.connectUrls.push(url);
    const page = approver();
    const start = new URL(url);
    const state = start.searchParams.get("state")!;
    const provider = start.searchParams.get("provider") ?? "google";
    const host = provider === "apple" ? "appleid.apple.com" : "accounts.google.com";
    const onNav = (f: import("@playwright/test").Frame) => {
      // (A page can report the same address twice, as it loads and again as Next settles it.)
      if (f === page.mainFrame() && seen.visited.at(-1) !== f.url()) seen.visited.push(f.url());
    };
    page.on("framenavigated", onNav);
    await page.route(`https://${host}/**`, (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Provider</title>" }));
    await page.route(`${APP}/api/auth/sign-in/social`, async (r) => {
      const body = r.request().postDataJSON() as { provider?: string; callbackURL?: string };
      seen.socialStarts.push(body);
      if (body.provider === "google") {
        return r.fulfill({ json: { url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=e2e&state=e2e", redirect: true } });
      }
      return r.continue();
    });
    try {
      await page.goto(url);
      await page.waitForURL((u) => u.host === host, { timeout: 30_000 });
      const callback = seen.socialStarts.at(-1)?.callbackURL ?? "";
      expect(callback).toMatch(/^\/app-google\?/);
      const authorized = page.waitForResponse((r) => r.url().includes("/api/auth/native/authorize"));
      await page.goto(`${APP}${callback}`);
      const { code } = (await (await authorized).json()) as { code: string };
      await expect(page.getByRole("heading", { name: "Back to Folevi" })).toBeVisible();
      bridge.handleCallback(`folevi://auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
    } finally {
      page.off("framenavigated", onNav);
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  }
  return { bridge, store, seen, tokenDelay: 0 };
}

/** window.foleviShell for the shell build, with `auth` answered by the Node bridge. */
async function installShell(
  context: BrowserContext,
  b: ReturnType<typeof nodeBridge>,
  shellVersion = "1.15.0",
) {
  await context.exposeFunction("__e2eAuthSignIn", (o?: { provider?: unknown }) => b.bridge.signIn(o));
  await context.exposeFunction("__e2eAuthSignOut", () => b.bridge.signOut());
  await context.exposeFunction("__e2eAuthConvexToken", async () => {
    b.seen.convexTokens++;
    // (A slow network: the warm start test holds the token back.)
    if (b.tokenDelay) await new Promise((r) => setTimeout(r, b.tokenDelay));
    return b.bridge.convexToken();
  });
  await context.exposeFunction(
    "__e2eAuthFetch",
    async (path: string, init: unknown): Promise<BridgeResponse> => {
      b.seen.paths.push(path);
      const res = await b.bridge.fetch(path, init);
      b.seen.bodies.push(res.body, JSON.stringify(res.headers));
      return res;
    },
  );
  await context.addInitScript((version) => {
    const w = window as unknown as Record<string, (...args: unknown[]) => Promise<unknown>> & {
      foleviShell?: unknown;
    };
    const notHere = () => Promise.reject(new Error("not in this test"));
    w.foleviShell = {
      platform: "mac",
      shellVersion: version,
      initialMode: "account",
      setMode: async () => undefined,
      library: new Proxy({}, { get: () => notHere }),
      secrets: { has: async () => false, set: notHere, delete: notHere },
      auth: {
        signIn: (o?: unknown) => w.__e2eAuthSignIn!(o),
        signOut: () => w.__e2eAuthSignOut!(),
        fetch: (path: unknown, init: unknown) => w.__e2eAuthFetch!(path, init),
        convexToken: () => w.__e2eAuthConvexToken!(),
      },
      ai: {
        capabilities: async () => ({ onDevice: false, keys: {} }),
        generate: () => ({ done: notHere(), cancel() {} }),
      },
      lock: { getSettings: notHere, setSettings: notHere },
      notify: { schedule: notHere, cancel: notHere },
      files: { save: notHere },
      http: { preview: async () => null },
    };
  }, shellVersion);
}

/** Everything the page could have kept: cookies, storage, and what the bridge handed it. */
async function pageCanSee(page: Page, b: ReturnType<typeof nodeBridge>): Promise<string> {
  const inPage = await page.evaluate(() => {
    const dump = (s: Storage) =>
      Object.keys(s)
        .map((k) => `${k}=${s.getItem(k)}`)
        .join("\n");
    return [
      document.cookie,
      dump(localStorage),
      dump(sessionStorage),
      document.documentElement.outerHTML,
    ].join("\n");
  });
  const cookies = JSON.stringify(await page.context().cookies());
  return [inPage, cookies, ...b.seen.bodies].join("\n");
}

test.beforeAll(async () => {
  const up = await fetch(`${SHELL}/`).then(
    (r) => r.ok,
    () => false,
  );
  test.skip(
    !up,
    `the shell dev server isn't running at ${SHELL} (pnpm --filter @folevi/web dev:shell, launch config web-shell-3003)`,
  );
});

test("the built-in interface signs in through the browser, opens a note, and signing out revokes the session", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const person = await newPerson(browser, "Shell Signer");
  const welcome = new URL(person.page.url()).pathname;
  expect(welcome).toMatch(/^\/d\/[0-9A-Z]{26}$/);
  const b = nodeBridge(() => person.page);

  const context = await browser.newContext();
  await installShell(context, b);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Signed out: the app's own sign-in screen (there are no /signin pages in the shell).
  await page.goto(`${SHELL}${welcome}`);
  const signIn = page
    .getByTestId("shell-sign-in")
    .getByRole("button", { name: "Sign in to Folevi" });
  await expect(signIn).toBeVisible({ timeout: 90_000 });
  expect(page.url()).not.toContain("/signin");

  // Sign in with email: /connect for client folevi-shell opens "in the browser", the page reloads signed in.
  await signIn.click();
  await page.getByTestId("shell-sign-in").getByRole("button", { name: "Sign in with email" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Welcome to Folevi", {
    timeout: 120_000,
  });
  expect(new URL(b.seen.connectUrls[0]!).searchParams.get("client_id")).toBe(SHELL_CLIENT_ID);
  const token = b.store.get("auth.session")!;
  expect(token).toBeTruthy();
  // The session check and the Convex token went through the bridge.
  expect(b.seen.paths.some((p) => p.startsWith("/api/auth/get-session"))).toBe(true);
  expect(b.seen.convexTokens).toBeGreaterThan(0);

  // The page never held the token: not in cookies, storage, the DOM, or anything the bridge returned.
  const visible = await pageCanSee(page, b);
  expect(visible).not.toContain(token);
  expect(visible).not.toContain(token.split(".")[0]!);

  // It's a device of its own on the account, next to the browser that approved it.
  await person.page.goto(`${APP}/settings/devices`);
  await expect(person.page.getByText("2 devices connected")).toBeVisible({ timeout: 30_000 });

  // Straight to the deployment (the dev proxy rewrites Origin): the bearer works from any origin, and Better
  // Auth's origin check bites only requests that carry cookies, which is why native never sends any.
  const direct = await playwrightRequest.newContext();
  const site = convexUrl().replace(".convex.cloud", ".convex.site");
  expect(
    (
      await direct.get(`${site}/api/auth/convex/token`, {
        headers: { authorization: `Bearer ${token}`, origin: "app://folevi" },
      })
    ).status(),
  ).toBe(200);
  const withCookie = await direct.post(`${site}/api/auth/sign-out`, {
    headers: { cookie: "folevi.session_token=x", origin: "app://folevi" },
    data: {},
  });
  expect(withCookie.status()).toBe(403);

  // Sign out from the app's menu: the bridge ends the session, forgets the token, and the app shows sign-in.
  await page.goto(`${SHELL}/documents`);
  await page
    .getByRole("navigation", { name: "Folio" })
    .getByRole("button", { name: /Personal, workspaces and account$/ })
    .click({ timeout: 60_000 });
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByTestId("shell-sign-in")).toBeVisible({ timeout: 60_000 });
  expect(b.store.has("auth.session")).toBe(false);
  expect(b.bridge.signedIn()).toBe(false);
  // Revoked on the server, not just forgotten here.
  expect(
    (
      await direct.get(`${APP}/api/auth/convex/token`, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).status(),
  ).toBe(401);
  await person.page.reload();
  await expect(person.page.getByText("1 device connected")).toBeVisible({ timeout: 30_000 });

  expect(errors.filter((e) => !/ResizeObserver/.test(e))).toEqual([]);
  await direct.dispose();
  await context.close();
  await person.context.close();
});

test("a warm start opens the last-known folio at once, before the server has answered", async ({ browser }) => {
  test.setTimeout(300_000);
  const person = await newPerson(browser, "Warm Starter");
  const b = nodeBridge(() => person.page);
  const context = await browser.newContext();
  await installShell(context, b);
  const page = await context.newPage();
  await page.goto(`${SHELL}/documents`);
  await page.getByTestId("shell-sign-in").getByRole("button", { name: "Sign in to Folevi" }).click({ timeout: 90_000 });
  await page.getByTestId("shell-sign-in").getByRole("button", { name: "Sign in with email" }).click();
  const folio = page.getByRole("navigation", { name: "Folio" });
  await expect(folio).toBeVisible({ timeout: 120_000 });
  // (The snapshot is written once the workspaces have loaded.)
  await expect.poll(() => page.evaluate(() => localStorage.getItem("folevi:last-account")), { timeout: 30_000 }).toBeTruthy();

  // The next launch on a slow network: the Convex token takes 8 seconds. The app is there long before.
  b.tokenDelay = 8_000;
  const started = Date.now();
  await page.reload();
  await expect(folio).toBeVisible({ timeout: 6_000 });
  expect(Date.now() - started).toBeLessThan(6_000);
  // ...and the server's answer then takes over in place (the sidebar stays, nothing reloads).
  b.tokenDelay = 0;
  await expect(folio).toBeVisible();
  await context.close();
  await person.context.close();
});

/** Sets the app-version floor on the dev deployment (convex/settings.ts setMinShellVersion). */
function setFloor(mac: string | null) {
  execFileSync("npx", ["convex", "run", "settings:setMinShellVersion", JSON.stringify({ mac })], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    stdio: "ignore",
    timeout: 60_000,
    env: { ...process.env, CONVEX_AGENT_MODE: process.env.CONVEX_AGENT_MODE ?? "anonymous" },
  });
}

test("an app older than minShellVersion asks to be updated instead of syncing, and carries on once it's allowed", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const person = await newPerson(browser, "Shell Updater");
  const b = nodeBridge(() => person.page);
  const context = await browser.newContext();
  // Older than the floor this test sets (other shells on the dev deployment are newer, or unversioned).
  await installShell(context, b, "0.0.1");
  const page = await context.newPage();
  await page.goto(`${SHELL}/documents`);
  await page
    .getByTestId("shell-sign-in")
    .getByRole("button", { name: "Sign in to Folevi" })
    .click();
  await page.getByTestId("shell-sign-in").getByRole("button", { name: "Sign in with email" }).click();
  const sidebar = page.getByRole("navigation", { name: "Folio" });
  await expect(sidebar).toBeVisible({ timeout: 120_000 });
  try {
    setFloor("0.0.2");
    await expect(page.getByRole("heading", { name: "Update Folevi to keep syncing" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Check for Updates in the Folevi menu")).toBeVisible();
    // An app update, nothing to buy.
    await expect(page.getByText(/\$|price|plan|upgrade/i)).toHaveCount(0);
    await expect(sidebar).toHaveCount(0);
  } finally {
    setFloor(null);
  }
  await expect(sidebar).toBeVisible({ timeout: 30_000 });
  await context.close();
  await person.context.close();
});

// The owner's report: "Continue with Google" in the app opened a page offering Apple, Google and email all over
// again. Now the app's own buttons choose, and the sign-in sheet goes straight to that provider's page
// (/app-google for client folevi-shell, never /connect or /signin), then back to the app signed in.
for (const provider of ["google", "apple"] as const) {
  const name = provider === "google" ? "Google" : "Apple";
  test(`Continue with ${name} in the app goes straight to ${name}'s page and comes back signed in`, async ({ browser }) => {
    test.setTimeout(300_000);
    const person = await newPerson(browser, `Shell ${name}`);
    const welcome = new URL(person.page.url()).pathname;
    const b = nodeBridge(() => person.page);
    const context = await browser.newContext();
    await installShell(context, b);
    const page = await context.newPage();
    await page.goto(`${SHELL}${welcome}`);
    const screen = page.getByTestId("shell-sign-in");
    await screen.getByRole("button", { name: "Sign in to Folevi" }).click({ timeout: 90_000 });
    // Nothing opens until the app knows how.
    expect(b.seen.connectUrls).toEqual([]);
    await screen.getByRole("button", { name: `Continue with ${name}` }).click();
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Welcome to Folevi", { timeout: 120_000 });

    // One sheet, on /app-google for this app, naming the provider (Google is the page's default).
    expect(b.seen.connectUrls).toHaveLength(1);
    const opened = new URL(b.seen.connectUrls[0]!);
    expect(opened.pathname).toBe("/app-google");
    expect(opened.searchParams.get("client_id")).toBe(SHELL_CLIENT_ID);
    expect(opened.searchParams.get("redirect_uri")).toBe("folevi://auth/callback");
    expect(opened.searchParams.get("provider")).toBe(provider);
    // The page asked Better Auth for that provider at once, and the browser went from /app-google straight to the
    // provider's own host: no /signin, no /connect, no second choice.
    expect(b.seen.socialStarts[0]?.provider).toBe(provider);
    const hosts = b.seen.visited.map((u) => new URL(u));
    const providerHost = provider === "google" ? "accounts.google.com" : "appleid.apple.com";
    expect(hosts[0]?.pathname).toBe("/app-google");
    expect(hosts[1]?.host, b.seen.visited.join("\n")).toBe(providerHost);
    expect(hosts.some((u) => /^\/(signin|signup|connect)(\/|$)/.test(u.pathname))).toBe(false);
    expect(b.store.get("auth.session")).toBeTruthy();
    await context.close();
    await person.context.close();
  });
}

test("/app-google refuses a client it doesn't serve, and says so instead of offering a choice", async ({ page }) => {
  const q = new URLSearchParams({ client_id: "folevi-mac", redirect_uri: "com.folevi.mac://auth/callback", code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", code_challenge_method: "S256", state: "s", provider: "apple" });
  let started = false;
  await page.route(`${APP}/api/auth/sign-in/social`, (r) => {
    started = true;
    return r.abort();
  });
  await page.goto(`${APP}/app-google?${q}`);
  await expect(page.getByRole("heading", { name: "This link doesn't work" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /Continue with/ })).toHaveCount(0);
  expect(started).toBe(false);
});

test("in a browser, the website's own Continue with Apple goes straight to Apple", async ({ page }) => {
  await page.route("https://appleid.apple.com/**", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Apple</title>" }));
  await page.goto(`${APP}/signin`);
  const apple = page.getByRole("button", { name: "Continue with Apple" });
  // (The dev deployment has Apple's keys; apple-signin.spec.ts checks the buttons follow what it offers.)
  await apple.click({ timeout: 30_000 });
  await page.waitForURL((u) => u.host === "appleid.apple.com", { timeout: 30_000 });
  expect(new URL(page.url()).pathname).toBe("/auth/authorize");
});
