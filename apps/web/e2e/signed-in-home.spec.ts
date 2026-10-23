import { expect, test, type Page } from "@playwright/test";
import { APP, SITE, newPerson } from "./helpers";

// folevi.com opens your notes when this browser is signed in. The proxy does it from the signed-in hint cookie;
// without the hint (locally it never reaches the marketing host, and a browser can drop it) the landing page asks
// the app host itself (lib/auth/signedInCheck.ts).
//
// That request needs the session cookie (SameSite=Lax), so the two hosts must be one site, as folevi.com and
// app.folevi.com are. localhost and app.localhost are two sites to a browser; run these against a dev server
// started with NEXT_PUBLIC_APP_URL=http://app.folevi.localhost:3005 NEXT_PUBLIC_MARKETING_URL=http://folevi.localhost:3005
// (and E2E_BASE_URL=http://app.folevi.localhost:3005). There the hint is shared too, as in production.
const oneSite = new URL(SITE).hostname !== "localhost";

const asked = (page: Page) => page.waitForResponse((r) => r.url() === `${APP}/api/signed-in`, { timeout: 15_000 });

async function expectLanding(page: Page, path: "/" | "/?home") {
  await expect(page).toHaveURL(`${SITE}${path}`);
  await expect(page.locator("html")).not.toHaveCSS("visibility", "hidden");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("a signed-out visitor sees the landing page", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const answer = asked(page);
  await page.goto(`${SITE}/`);
  expect(await (await answer).json()).toEqual({ signedIn: false });
  await expectLanding(page, "/");
  await context.close();
});

test("signed in without the hint cookie, the home page opens the notes; /?home and signing out show the landing page", async ({ browser }) => {
  test.skip(!oneSite, "the marketing and app hosts must be one site (see above)");
  const { context, page } = await newPerson(browser, "Hana Home");

  // With the hint, the proxy sends folevi.com/ straight to the notes before any page loads.
  let askedWithHint = false;
  const watch = (r: { url(): string }) => {
    if (r.url() === `${APP}/api/signed-in`) askedWithHint = true;
  };
  page.on("request", watch);
  await page.goto(`${SITE}/`);
  await page.waitForURL((url) => url.origin === new URL(APP).origin && url.pathname.startsWith("/documents"), { timeout: 20_000 });
  expect(askedWithHint).toBe(false);
  page.off("request", watch);

  // The hint gone (or never shared with this host): the page asks the app host and goes to the notes.
  await context.clearCookies({ name: "folevi_signed_in" });
  await page.goto(`${SITE}/`);
  await page.waitForURL((url) => url.origin === new URL(APP).origin && url.pathname.startsWith("/documents"), { timeout: 20_000 });

  // Again with the hint cleared: this browser was found signed in here before, so the page stays hidden while
  // it asks, and still lands on the notes.
  await context.clearCookies({ name: "folevi_signed_in" });
  await page.goto(`${SITE}/`);
  await page.waitForURL((url) => url.origin === new URL(APP).origin && url.pathname.startsWith("/documents"), { timeout: 20_000 });

  // /?home always shows the landing page, and doesn't ask.
  let askedOnHome = false;
  const listen = (r: { url(): string }) => {
    if (r.url() === `${APP}/api/signed-in`) askedOnHome = true;
  };
  page.on("request", listen);
  await page.goto(`${SITE}/?home`);
  await expectLanding(page, "/?home");
  await page.waitForTimeout(1_000);
  await expectLanding(page, "/?home");
  expect(askedOnHome).toBe(false);
  page.off("request", listen);

  // Signing out lands on the home page, which stays.
  await page.goto(`${APP}/documents`);
  await expect(page.locator("html")).not.toHaveCSS("visibility", "hidden");
  await page.getByRole("navigation", { name: "Folio" }).getByRole("button", { name: /Personal, workspaces and account$/ }).click();
  const answer = asked(page);
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL((url) => url.pathname === "/" && url.origin === new URL(SITE).origin, { timeout: 20_000 });
  expect(await (await answer).json()).toEqual({ signedIn: false });
  await expectLanding(page, "/");

  // And a later visit too.
  const again = asked(page);
  await page.goto(`${SITE}/`);
  expect(await (await again).json()).toEqual({ signedIn: false });
  await expectLanding(page, "/");
  await context.close();
});

test("the signed-in answer is readable by the marketing site only, and never cached", async ({ request }) => {
  const site = await request.get(`${APP}/api/signed-in`, { headers: { origin: new URL(SITE).origin } });
  expect(site.status()).toBe(200);
  expect(site.headers()["access-control-allow-origin"]).toBe(new URL(SITE).origin);
  expect(site.headers()["access-control-allow-credentials"]).toBe("true");
  expect(site.headers()["cache-control"]).toContain("no-store");
  expect(await site.json()).toEqual({ signedIn: false });

  const other = await request.get(`${APP}/api/signed-in`, { headers: { origin: "https://example.com" } });
  expect(other.status()).toBe(403);
  expect(other.headers()["access-control-allow-origin"]).toBeUndefined();
});
