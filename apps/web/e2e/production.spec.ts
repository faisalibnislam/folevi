import { expect, test } from "@playwright/test";
import { APP, newPersonWithWorkspace } from "./helpers";

// Header and service-worker checks. Most run against any server; the strict ones need a production
// build (`next build && next start`), which CI runs with E2E_PRODUCTION=1.
const PROD = process.env.E2E_PRODUCTION === "1";

test("security headers are set on app pages", async ({ request }) => {
  const res = await request.get(`${APP}/signin`);
  expect(res.status()).toBe(200);
  const h = res.headers();
  const csp = h["content-security-policy"] ?? "";
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'self'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["cross-origin-opener-policy"]).toBe("same-origin");
  expect(h["strict-transport-security"]).toContain("max-age=");
  expect(h["x-powered-by"]).toBeUndefined();
  if (PROD) {
    // Production never allows eval, and upgrades any stray http subresource.
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("upgrade-insecure-requests");
  }
});

test("share pages are private, uncached and not indexed by default", async ({ page, request }) => {
  const url = `${APP}/s/${"x".repeat(32)}`;
  const res = await request.get(url);
  const h = res.headers();
  // Next's dev server answers "no-cache" for dynamic pages; production builds send "no-store".
  expect(h["cache-control"]).toMatch(PROD ? /no-store/ : /no-store|no-cache/);
  expect(h["cache-control"]).not.toMatch(/public|s-maxage/);
  expect(h["referrer-policy"]).toBe("no-referrer");
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Page unavailable" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("the service worker is served for the whole origin and never cached", async ({ request }) => {
  const res = await request.get(`${APP}/sw.js`);
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("no-cache");
  expect(res.headers()["service-worker-allowed"]).toBe("/");
  const body = await res.text();
  // Private surfaces are never cached by the worker.
  expect(body).toMatch(/NEVER = .*api.*admin.*s\\\//);
});

test("production builds register the offline service worker once signed in", async ({ browser }) => {
  test.skip(!PROD, "The service worker only registers in production builds.");
  const { page } = await newPersonWithWorkspace(browser, "Worker Tester");
  const active = await page.evaluate(async () => {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 15_000))]);
    return reg ? { scope: new URL(reg.scope).pathname, active: Boolean(reg.active) } : null;
  });
  expect(active).toEqual({ scope: "/", active: true });
});
