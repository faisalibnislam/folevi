import { expect, test } from "@playwright/test";
import { APP, convexUrl } from "./helpers";

// Sign in with Apple (convex/auth.ts, lib/auth/appleCallback.ts). Apple only sends people back to the
// registered https://app.folevi.com/api/auth/callback/apple, never to localhost, so the round trip through
// Apple itself can only be checked on a deployment. Here: the buttons follow what the backend offers, and
// Apple's cross-site form post to the callback reaches Better Auth as a same-site GET instead of being
// refused as a cross-site POST.

const CALLBACK = "/api/auth/callback/apple";

/** What this backend offers (convex/signInOptions.ts), straight from Convex. */
async function offered(request: import("@playwright/test").APIRequestContext): Promise<{ google: boolean; apple: boolean }> {
  const res = await request.post(`${convexUrl()}/api/query`, { data: { path: "signInOptions:options", args: {}, format: "json" } });
  const body = (await res.json()) as { value?: { google?: boolean; apple?: boolean } };
  return { google: body.value?.google === true, apple: body.value?.apple === true };
}

test("the sign-in and sign-up pages offer Apple only when the backend has its keys", async ({ page, request }) => {
  const options = await offered(request);
  for (const path of ["/signin", "/signup"]) {
    await page.goto(`${APP}${path}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Apple" })).toHaveCount(options.apple ? 1 : 0);
    await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(options.google ? 1 : 0);
  }
});

test("Apple's form post becomes a GET of the callback, with its name kept out of the address", async ({ request }) => {
  const user = JSON.stringify({ name: { firstName: "Ada", lastName: "Lovelace" }, email: "x7k2@privaterelay.appleid.com" });
  const post = await request.post(`${APP}${CALLBACK}`, {
    form: { code: "c0de", state: "not-a-real-state", user },
    // Any cookie the browser still sends cross-site (a SameSite=None one) is enough for Better Auth to refuse a
    // POST from an origin it doesn't trust; this one never reaches it.
    headers: { origin: "https://appleid.apple.com", "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", cookie: "e2e_cross_site=1" },
    maxRedirects: 0,
  });
  expect(post.status()).toBe(303);
  const location = post.headers()["location"] ?? "";
  expect(location).toBe(`${CALLBACK}?code=c0de&state=not-a-real-state`);
  expect(location).not.toContain("Lovelace");
  const cookie = post.headersArray().find((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith("folevi.apple_user="))?.value ?? "";
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain(`Path=${CALLBACK}`);

  // The GET reaches Better Auth, which checks the state (this one was never issued) and says so, and the
  // name cookie is cleared.
  const get = await request.get(`${APP}${location}`, { maxRedirects: 0, headers: { cookie: cookie.split(";")[0]! } });
  expect(get.status()).toBe(302);
  expect(get.headers()["location"]).toMatch(/error=(state_mismatch|state_not_found)/);
  expect(get.headersArray().some((h) => h.name.toLowerCase() === "set-cookie" && /^folevi\.apple_user=;.*Max-Age=0/.test(h.value))).toBe(true);
});

test("a real browser posting from another site, as Apple's page does, isn't refused", async ({ page, context }) => {
  // A cookie the browser sends even on a cross-site POST, so the post isn't cookieless.
  await context.addCookies([{ name: "e2e_cross_site", value: "1", domain: new URL(APP).hostname, path: "/", sameSite: "None", secure: true }]);
  // A page on another origin that submits a form to Folevi's callback, like appleid.apple.com does.
  await page.route("https://appleid.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<form id="f" method="POST" action="${APP}${CALLBACK}"><input name="code" value="c0de"><input name="state" value="not-a-real-state"></form><script>document.getElementById("f").submit()</script>`,
    }),
  );
  const finished = page.waitForResponse((r) => r.url().startsWith(`${APP}${CALLBACK}?`) && r.request().method() === "GET");
  await page.goto("https://appleid.example/auth/authorize");
  const response = await finished;
  // Better Auth handled it (a redirect naming the state problem), rather than a 403 for a cross-site POST.
  expect(response.status()).toBe(302);
  expect(response.headers()["location"]).toMatch(/error=(state_mismatch|state_not_found)/);
});
