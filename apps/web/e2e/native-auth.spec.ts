import { createHash, randomBytes } from "node:crypto";
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { APP, newPerson, signIn } from "./helpers";

// Folevi for Mac signs in with Authorization Code + PKCE (convex/lib/nativeAuth.ts): the app opens /connect,
// the person approves, and the app trades the one-time code and its verifier for a session of its own.
const CLIENT = "folevi-mac";
const REDIRECT = "com.folevi.mac://auth/callback";

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function pkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

function connectUrl(challenge: string, state = "s1") {
  const q = new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state });
  return `${APP}/connect?${q}`;
}

/** Approves the app on /connect and returns the one-time code the page sends back to it. */
async function approve(page: Page, challenge: string): Promise<string> {
  await page.goto(connectUrl(challenge));
  await expect(page.getByRole("heading", { name: "Sign in to Folevi for Mac" })).toBeVisible({ timeout: 30_000 });
  const response = page.waitForResponse((r) => r.url().includes("/api/auth/native/authorize"));
  await page.getByRole("button", { name: "Continue" }).click();
  const body = (await (await response).json()) as { code: string };
  expect(body.code).toMatch(/^[A-Za-z0-9_-]{48}$/);
  return body.code;
}

async function exchange(api: APIRequestContext, code: string, verifier: string) {
  return api.post(`${APP}/api/auth/native/token`, {
    data: { grant_type: "authorization_code", code, code_verifier: verifier, client_id: CLIENT, redirect_uri: REDIRECT, device_name: "Test Mac" },
  });
}

test("the Mac app signs in with a one-time code and PKCE, as a device of its own", async ({ browser }) => {
  const person = await newPerson(browser, "Mac Person");
  // The app is a separate client: no browser cookies.
  const app = await playwrightRequest.newContext();

  // A code is single-use, and useless without the right verifier.
  const first = pkce();
  const code = await approve(person.page, first.challenge);
  await expect(person.page.getByRole("heading", { name: "Back to Folevi for Mac" })).toBeVisible();
  const wrong = await exchange(app, code, pkce().verifier);
  expect(wrong.status()).toBe(400);
  // The failed attempt used the code up.
  expect((await exchange(app, code, first.verifier)).status()).toBe(400);

  const second = pkce();
  const code2 = await approve(person.page, second.challenge);
  const ok = await exchange(app, code2, second.verifier);
  expect(ok.status()).toBe(200);
  const { access_token: session, token_type } = (await ok.json()) as { access_token: string; token_type: string };
  expect(token_type).toBe("Bearer");
  expect((await exchange(app, code2, second.verifier)).status()).toBe(400);

  // The session gets Convex tokens that carry its own session id.
  const auth = { authorization: `Bearer ${session}` };
  const tokenRes = await app.get(`${APP}/api/auth/convex/token`, { headers: auth });
  expect(tokenRes.status()).toBe(200);
  const jwt = ((await tokenRes.json()) as { token: string }).token;
  const claims = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;
  expect(claims.email).toBe(person.email);
  expect(typeof claims.sessionId).toBe("string");

  // It's listed as its own device.
  await person.page.goto(`${APP}/settings/devices`);
  await expect(person.page.getByText("Folevi for Mac", { exact: true })).toBeVisible({ timeout: 30_000 });

  // Signing the app out ends that session only.
  const out = await app.post(`${APP}/api/auth/sign-out`, { headers: { ...auth, origin: APP }, data: {} });
  expect(out.status()).toBe(200);
  expect((await app.get(`${APP}/api/auth/convex/token`, { headers: auth })).status()).toBe(401);
  await person.page.reload();
  await expect(person.page.getByText("Folevi for Mac", { exact: true })).toHaveCount(0, { timeout: 30_000 });

  await app.dispose();
  await person.context.close();
});

test("signed-out people sign in first and come back to approve the app", async ({ browser }) => {
  const person = await newPerson(browser, "Mac Returner");
  const fresh = await browser.newContext();
  const { challenge } = pkce();
  const page = await signIn(fresh, person.account, { returnTo: new URL(connectUrl(challenge)).pathname + new URL(connectUrl(challenge)).search });
  await expect(page.getByRole("heading", { name: "Sign in to Folevi for Mac" })).toBeVisible({ timeout: 30_000 });
  await Promise.all([fresh.close(), person.context.close()]);
});

test("unregistered apps and return addresses are refused", async ({ browser }) => {
  const person = await newPerson(browser, "Mac Refuser");
  const { challenge } = pkce();
  await person.page.goto(connectUrl(challenge).replace(encodeURIComponent(REDIRECT), encodeURIComponent("https://evil.example/cb")));
  await expect(person.page.getByRole("heading", { name: "This link doesn't work" })).toBeVisible({ timeout: 30_000 });
  // The server refuses too, even with a valid session.
  const res = await person.page.request.post(`${APP}/api/auth/native/authorize`, {
    headers: { origin: APP },
    data: { client_id: CLIENT, redirect_uri: "https://evil.example/cb", code_challenge: challenge, code_challenge_method: "S256" },
  });
  expect(res.status()).toBe(400);
  await person.context.close();
});
