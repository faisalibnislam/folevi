// Sign in with Apple (convex/auth.ts appleSignIn, convex/lib/appleSignIn.ts): the client secret Folevi makes
// from the .p8 key, the provider only existing when it's set up, and the whole web flow against a stand-in
// for Apple (its token endpoint and its keys), down to linking with an existing password account by email.
// The real Apple can't be reached from tests, and doesn't send people back to localhost.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components } from "../../convex/_generated/api";
import {
  APPLE_SECRET_LIFETIME_SECONDS,
  APPLE_SECRET_MAX_SECONDS,
  APPLE_SECRET_RENEW_SECONDS,
  appleClientSecret,
  appleSignInConfig,
  forgetAppleClientSecret,
  isApplePrivateRelay,
  makeAppleClientSecret,
  pkcs8FromPem,
  type AppleSignInConfig,
} from "../../convex/lib/appleSignIn";
import { setup, type T } from "./helpers";

process.env.BETTER_AUTH_SECRET ??= "test-secret-".repeat(4);

const ORIGIN = "http://app.localhost:3000";
const SERVICES_ID = "com.folevi.signin";
const TEAM_ID = "7K32QQ2FX8";
const KEY_ID = "TESTKEY123";
const BUNDLE_ID = "com.folevi.ios";
const DAY = 86_400_000;

const b64url = (bytes: Uint8Array | string) => {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const decodePart = (part: string) => JSON.parse(new TextDecoder().decode(fromB64url(part))) as Record<string, unknown>;

/** A throwaway Sign in with Apple key, as the .p8 file Apple hands out (PKCS #8 PEM, P-256). */
async function appleKey() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const body = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\n");
  return { pem: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}

async function verifiesWith(jwt: string, publicKey: CryptoKey) {
  const [h, c, s] = jwt.split(".");
  return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, fromB64url(s!), new TextEncoder().encode(`${h}.${c}`));
}

const config = (pem: string, over: Partial<AppleSignInConfig> = {}): AppleSignInConfig => ({ clientId: SERVICES_ID, teamId: TEAM_ID, keyId: KEY_ID, privateKey: pem, bundleId: BUNDLE_ID, ...over });

describe("the client secret", () => {
  beforeEach(() => forgetAppleClientSecret());

  test("is an ES256 JWT naming the key, for the team and the Services ID, signed by the .p8 key", async () => {
    const { pem, publicKey } = await appleKey();
    const now = Date.UTC(2026, 9, 22, 12);
    const { jwt, expiresAt } = await makeAppleClientSecret(config(pem), now);
    const [header, claims] = jwt.split(".").map((p, i) => (i < 2 ? decodePart(p) : p)) as [Record<string, unknown>, Record<string, unknown>];
    expect(header).toEqual({ alg: "ES256", kid: KEY_ID, typ: "JWT" });
    expect(claims).toEqual({ iss: TEAM_ID, sub: SERVICES_ID, aud: "https://appleid.apple.com", iat: now / 1000, exp: now / 1000 + APPLE_SECRET_LIFETIME_SECONDS });
    expect(expiresAt).toBe(now + APPLE_SECRET_LIFETIME_SECONDS * 1000);
    // Within Apple's six-month limit.
    expect((claims.exp as number) - (claims.iat as number)).toBeLessThanOrEqual(APPLE_SECRET_MAX_SECONDS);
    expect(await verifiesWith(jwt, publicKey)).toBe(true);
  });

  test("reads the key with its line breaks escaped, and refuses something that isn't one", async () => {
    const { pem, publicKey } = await appleKey();
    const { jwt } = await makeAppleClientSecret(config(pem.replace(/\n/g, "\\n")));
    expect(await verifiesWith(jwt, publicKey)).toBe(true);
    expect(pkcs8FromPem(pem)).toEqual(pkcs8FromPem(pem.replace(/-----[A-Z ]+-----/g, "")));
    expect(() => pkcs8FromPem("not a key!")).toThrow(/isn't a \.p8 key/);
    await expect(makeAppleClientSecret(config(`-----BEGIN PRIVATE KEY-----\n${btoa("short")}\n-----END PRIVATE KEY-----`))).rejects.toThrow();
  });

  test("is kept while more than a day of it is left, then renewed by itself", async () => {
    const { pem } = await appleKey();
    const start = Date.UTC(2026, 9, 1);
    const first = await appleClientSecret(config(pem), start);
    expect(await appleClientSecret(config(pem), start + 10 * DAY)).toBe(first);
    const lastKept = start + APPLE_SECRET_LIFETIME_SECONDS * 1000 - APPLE_SECRET_RENEW_SECONDS * 1000 - 60_000;
    expect(await appleClientSecret(config(pem), lastKept)).toBe(first);
    // Under a day left: a new one, valid from now.
    const renewedAt = lastKept + 2 * 60_000;
    const renewed = await appleClientSecret(config(pem), renewedAt);
    expect(renewed).not.toBe(first);
    expect(decodePart(renewed.split(".")[1]!).iat).toBe(Math.floor(renewedAt / 1000));
    expect(await appleClientSecret(config(pem), renewedAt + DAY)).toBe(renewed);
  });

  test("changes at once when the settings do", async () => {
    const { pem } = await appleKey();
    const other = await appleKey();
    const now = Date.now();
    const first = await appleClientSecret(config(pem), now);
    expect(decodePart((await appleClientSecret(config(pem, { keyId: "OTHERKEY99" }), now)).split(".")[0]!).kid).toBe("OTHERKEY99");
    expect(await appleClientSecret(config(other.pem), now)).not.toBe(first);
    // Asked twice at the same moment: one key import and one signature.
    forgetAppleClientSecret();
    const [a, b] = await Promise.all([appleClientSecret(config(pem), now), appleClientSecret(config(pem), now)]);
    expect(a).toBe(b);
  });
});

describe("setting it up", () => {
  test("needs all four variables; the bundle ID defaults to the iOS app's", async () => {
    const { pem } = await appleKey();
    const full = { APPLE_SIGNIN_CLIENT_ID: SERVICES_ID, APPLE_SIGNIN_TEAM_ID: TEAM_ID, APPLE_SIGNIN_KEY_ID: KEY_ID, APPLE_SIGNIN_KEY: pem };
    expect(appleSignInConfig(full)).toEqual({ clientId: SERVICES_ID, teamId: TEAM_ID, keyId: KEY_ID, privateKey: pem.trim(), bundleId: BUNDLE_ID });
    expect(appleSignInConfig({ ...full, APPLE_SIGNIN_BUNDLE_ID: "com.example.app" })?.bundleId).toBe("com.example.app");
    for (const name of Object.keys(full)) expect(appleSignInConfig({ ...full, [name]: "" })).toBeNull();
    expect(appleSignInConfig({})).toBeNull();
  });

  test("Hide My Email addresses are recognised", () => {
    expect(isApplePrivateRelay("x7k2abcd9f@privaterelay.appleid.com")).toBe(true);
    expect(isApplePrivateRelay("ada@icloud.com")).toBe(false);
    expect(isApplePrivateRelay(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The web flow, against a stand-in Apple.

const ENV_NAMES = ["APPLE_SIGNIN_CLIENT_ID", "APPLE_SIGNIN_TEAM_ID", "APPLE_SIGNIN_KEY_ID", "APPLE_SIGNIN_KEY", "APPLE_SIGNIN_BUNDLE_ID"] as const;

/** Apple's id token signing key (RS256), published at /auth/keys. */
async function appleIdKey() {
  const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const kid = "apple-test-kid";
  return {
    jwks: { keys: [{ kty: "RSA", kid, use: "sig", alg: "RS256", n: jwk.n!, e: jwk.e! }] },
    async sign(claims: Record<string, unknown>) {
      const input = `${b64url(JSON.stringify({ alg: "RS256", kid }))}.${b64url(JSON.stringify(claims))}`;
      const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(input)));
      return `${input}.${b64url(sig)}`;
    },
  };
}

type IdClaims = { sub: string; email: string; email_verified?: boolean | string; is_private_email?: boolean | string; aud?: string; nonce?: string };

/** Stands in for appleid.apple.com: its token endpoint answers with an id token for `who`. */
function fakeApple(idKey: Awaited<ReturnType<typeof appleIdKey>>) {
  const tokenRequests: URLSearchParams[] = [];
  let who: IdClaims | null = null;
  const real = globalThis.fetch;
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://appleid.apple.com/auth/token") {
      const body = new URLSearchParams(typeof init?.body === "string" ? init.body : (init?.body as URLSearchParams | undefined)?.toString() ?? "");
      tokenRequests.push(body);
      if (!who || body.get("code") !== "good-code") return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400, headers: { "content-type": "application/json" } });
      const now = Math.floor(Date.now() / 1000);
      const idToken = await idKey.sign({ iss: "https://appleid.apple.com", aud: SERVICES_ID, iat: now, exp: now + 600, email_verified: true, ...who });
      return new Response(JSON.stringify({ access_token: "apple-access", token_type: "Bearer", expires_in: 3600, refresh_token: "apple-refresh", id_token: idToken }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === "https://appleid.apple.com/auth/keys") return new Response(JSON.stringify(idKey.jwks), { status: 200, headers: { "content-type": "application/json" } });
    return await real(input, init);
  });
  vi.stubGlobal("fetch", mock);
  return {
    tokenRequests,
    signInAs(claims: IdClaims | null) {
      who = claims;
    },
  };
}

const cookiesFrom = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .filter((c) => !c.endsWith("="))
    .join("; ");

async function startSignIn(t: T) {
  const res = await t.fetch("/api/auth/sign-in/social", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ provider: "apple", callbackURL: "/documents", newUserCallbackURL: "/onboarding", errorCallbackURL: "/signin?via=apple" }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { url: string; redirect: boolean };
  return { authorize: new URL(body.url), cookie: cookiesFrom(res) };
}

/** Apple's form post, already turned into a GET by the web app (apps/web lib/auth/appleCallback.ts). */
async function finish(t: T, start: { authorize: URL; cookie: string }, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ code: "good-code", state: start.authorize.searchParams.get("state") ?? "", ...extra });
  return await t.fetch(`/api/auth/callback/apple?${q}`, { headers: { cookie: start.cookie } });
}

async function passwordAccount(t: T, email: string, opts: { verified?: boolean; twoFactor?: boolean; name?: string } = {}) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const user = (await ctx.runMutation(components.betterAuth.adapter.create, {
      input: { model: "user", data: { name: opts.name ?? "Grace", email, emailVerified: opts.verified ?? true, twoFactorEnabled: opts.twoFactor ?? false, createdAt: now, updatedAt: now } },
    })) as { _id: string };
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: { model: "account", data: { userId: user._id, providerId: "credential", accountId: user._id, password: "scrypt:not-a-real-hash", createdAt: now, updatedAt: now } },
    });
    return user._id;
  });
}

async function accountsOf(t: T, userId: string) {
  return await t.run(async (ctx) => {
    const res = (await ctx.runQuery(components.betterAuth.adapter.findMany, { model: "account", where: [{ field: "userId", value: userId }], paginationOpts: { numItems: 20, cursor: null } })) as {
      page: { providerId: string; accountId: string }[];
    };
    return res.page.map((a) => `${a.providerId}:${a.providerId === "credential" ? "-" : a.accountId}`).sort();
  });
}

async function userByEmail(t: T, email: string) {
  return (await t.run(async (ctx) => await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: email }] }))) as {
    _id: string;
    name: string;
    emailVerified: boolean;
  } | null;
}

describe("signing in with Apple", () => {
  let publicKey: CryptoKey;
  let apple: ReturnType<typeof fakeApple>;

  beforeEach(async () => {
    forgetAppleClientSecret();
    const key = await appleKey();
    publicKey = key.publicKey;
    process.env.APPLE_SIGNIN_CLIENT_ID = SERVICES_ID;
    process.env.APPLE_SIGNIN_TEAM_ID = TEAM_ID;
    process.env.APPLE_SIGNIN_KEY_ID = KEY_ID;
    process.env.APPLE_SIGNIN_KEY = key.pem;
    apple = fakeApple(await appleIdKey());
  });
  afterEach(() => {
    for (const name of ENV_NAMES) delete process.env[name];
    vi.unstubAllGlobals();
    forgetAppleClientSecret();
  });

  test("is offered only while it's set up", async () => {
    const t = setup();
    expect(await t.query(api.signInOptions.options, {})).toEqual({ google: false, apple: true });
    delete process.env.APPLE_SIGNIN_KEY;
    expect(await t.query(api.signInOptions.options, {})).toEqual({ google: false, apple: false });
    // Not set up: Better Auth doesn't know Apple at all.
    const res = await t.fetch("/api/auth/sign-in/social", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ provider: "apple", callbackURL: "/documents" }) });
    expect(res.status).toBe(404);
  });

  test("sends people to Apple with the Services ID, a form post back to Folevi, and asks for the name and email", async () => {
    const t = setup();
    const { authorize, cookie } = await startSignIn(t);
    expect(`${authorize.origin}${authorize.pathname}`).toBe("https://appleid.apple.com/auth/authorize");
    expect(authorize.searchParams.get("client_id")).toBe(SERVICES_ID);
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback/apple`);
    expect(authorize.searchParams.get("response_mode")).toBe("form_post");
    expect(authorize.searchParams.get("scope")?.split(" ").sort()).toEqual(["email", "name"]);
    expect(authorize.searchParams.get("state")).toBeTruthy();
    // The sign-in is tied to this browser by a cookie the GET back carries.
    expect(cookie).toMatch(/folevi\.state=/);
  });

  test("links to the existing password account with the same confirmed email, with the client secret Folevi made", async () => {
    const t = setup();
    const userId = await passwordAccount(t, "grace@example.com");
    apple.signInAs({ sub: "001234.apple-grace", email: "grace@example.com" });
    const res = await finish(t, await startSignIn(t));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/documents");
    expect(res.headers.getSetCookie().some((c) => /folevi\.session_token=[^;]+/.test(c))).toBe(true);
    expect(await accountsOf(t, userId)).toEqual(["apple:001234.apple-grace", "credential:-"]);
    // The code was traded with the secret made from the key.
    const sent = apple.tokenRequests.at(-1)!;
    expect(sent.get("client_id")).toBe(SERVICES_ID);
    expect(sent.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback/apple`);
    const secret = sent.get("client_secret")!;
    expect(decodePart(secret.split(".")[1]!)).toMatchObject({ iss: TEAM_ID, sub: SERVICES_ID, aud: "https://appleid.apple.com" });
    expect(await verifiesWith(secret, publicKey)).toBe(true);
    // Signing in again finds the same account.
    expect((await finish(t, await startSignIn(t))).headers.get("location")).toBe("/documents");
    expect(await accountsOf(t, userId)).toEqual(["apple:001234.apple-grace", "credential:-"]);
  });

  test("doesn't link to an account whose own address was never confirmed", async () => {
    const t = setup();
    const userId = await passwordAccount(t, "claimed@example.com", { verified: false });
    apple.signInAs({ sub: "001234.apple-owner", email: "claimed@example.com" });
    const res = await finish(t, await startSignIn(t));
    expect(res.headers.get("location")).toBe("/signin?via=apple&error=account_not_linked");
    expect(await accountsOf(t, userId)).toEqual(["credential:-"]);
  });

  test("a Hide My Email address makes a new, confirmed account named from Apple's first answer, and later sign-ins keep the name", async () => {
    const t = setup();
    const relay = "x7k2abcd9f@privaterelay.appleid.com";
    apple.signInAs({ sub: "001234.apple-ada", email: relay, is_private_email: "true", email_verified: "true" });
    const first = await finish(t, await startSignIn(t), { user: JSON.stringify({ name: { firstName: "Ada", lastName: "Lovelace" }, email: relay }) });
    expect(first.headers.get("location")).toBe("/onboarding");
    const user = await userByEmail(t, relay);
    expect(user).toMatchObject({ name: "Ada Lovelace", emailVerified: true });
    // Apple sends the name only the first time.
    const again = await finish(t, await startSignIn(t));
    expect(again.headers.get("location")).toBe("/documents");
    expect((await userByEmail(t, relay))?.name).toBe("Ada Lovelace");
  });

  test("an account with two-step verification on signs in with its password and code instead", async () => {
    const t = setup();
    await passwordAccount(t, "careful@example.com", { twoFactor: true });
    apple.signInAs({ sub: "001234.apple-careful", email: "careful@example.com" });
    const res = await finish(t, await startSignIn(t));
    expect(res.headers.get("location")).toMatch(/^\/signin\?via=apple&error=two_factor_required(&|$)/);
    expect(res.headers.getSetCookie().some((c) => /folevi\.session_token=[^;]+/.test(c))).toBe(false);
  });

  test("a code Apple doesn't know, or a sign-in this browser didn't start, signs nobody in", async () => {
    const t = setup();
    apple.signInAs({ sub: "001234.apple-x", email: "x@example.com" });
    const start = await startSignIn(t);
    expect((await finish(t, start, { code: "stolen" })).headers.get("location")).toMatch(/error=invalid_code/);
    const other = await startSignIn(t);
    const forged = await t.fetch(`/api/auth/callback/apple?code=good-code&state=${other.authorize.searchParams.get("state")}`, { headers: { cookie: start.cookie } });
    expect(forged.headers.get("location")).toMatch(/error=state_mismatch/);
    expect(await userByEmail(t, "x@example.com")).toBeNull();
  });

  async function sessionToken(t: T, userId: string, ageMs = 0) {
    const token = `tok${Math.random().toString(36).slice(2)}${Date.now()}`;
    await t.run(async (ctx) => {
      const at = Date.now() - ageMs;
      await ctx.runMutation(components.betterAuth.adapter.create, { input: { model: "session", data: { userId, token, expiresAt: Date.now() + DAY, createdAt: at, updatedAt: at } } });
    });
    return token;
  }

  const authed = (token: string) => ({ origin: ORIGIN, "content-type": "application/json", authorization: `Bearer ${token}` });

  test("Settings > Security links Apple on purpose, even with a Hide My Email address, and removes it with a recent sign-in", async () => {
    const t = setup();
    const userId = await passwordAccount(t, "linker@example.com");
    const token = await sessionToken(t, userId);
    const res = await t.fetch("/api/auth/link-social", { method: "POST", headers: authed(token), body: JSON.stringify({ provider: "apple", callbackURL: "/settings/security", errorCallbackURL: "/settings/security?via=apple" }) });
    expect(res.status).toBe(200);
    const start = { authorize: new URL(((await res.json()) as { url: string }).url), cookie: cookiesFrom(res) };
    apple.signInAs({ sub: "001234.apple-linker", email: "q9z8y7x6w5@privaterelay.appleid.com", is_private_email: true });
    const back = await finish(t, start);
    expect(back.headers.get("location")).toBe("/settings/security");
    expect(await accountsOf(t, userId)).toEqual(["apple:001234.apple-linker", "credential:-"]);
    // The account keeps its own address.
    expect((await userByEmail(t, "linker@example.com"))?._id).toBe(userId);

    // Removing it needs a sign-in from the last 10 minutes.
    const stale = await t.fetch("/api/auth/unlink-account", { method: "POST", headers: authed(await sessionToken(t, userId, 20 * 60_000)), body: JSON.stringify({ providerId: "apple" }) });
    expect(((await stale.json()) as { code?: string }).code).toBe("SESSION_NOT_FRESH");
    const removed = await t.fetch("/api/auth/unlink-account", { method: "POST", headers: authed(token), body: JSON.stringify({ providerId: "apple" }) });
    expect(removed.status).toBe(200);
    expect(await accountsOf(t, userId)).toEqual(["credential:-"]);
  });

  test("the only way someone signs in can't be removed", async () => {
    const t = setup();
    apple.signInAs({ sub: "001234.apple-only", email: "only@example.com" });
    await finish(t, await startSignIn(t));
    const user = await userByEmail(t, "only@example.com");
    const res = await t.fetch("/api/auth/unlink-account", { method: "POST", headers: authed(await sessionToken(t, user!._id)), body: JSON.stringify({ providerId: "apple" }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe("FAILED_TO_UNLINK_LAST_ACCOUNT");
  });

  async function nativeSignIn(t: T, idKey: Awaited<ReturnType<typeof appleIdKey>>, over: Record<string, unknown>, nonce = "n-123") {
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: "https://appleid.apple.com", sub: "001234.apple-native", email: "native@example.com", email_verified: true, iat: now, exp: now + 600, nonce: "n-123", aud: BUNDLE_ID, ...over };
    return await t.fetch("/api/auth/sign-in/social", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ provider: "apple", idToken: { token: await idKey.sign(claims), nonce, user: { name: { firstName: "Nia", lastName: "Native" } } } }),
    });
  }

  test("the iPhone and iPad app's own Apple sheet signs in with its id token (the bundle ID's audience)", async () => {
    const t = setup();
    const idKey = await appleIdKey();
    fakeApple(idKey);
    expect((await nativeSignIn(t, idKey, { aud: "com.example.other" })).status).toBe(401);
    expect((await nativeSignIn(t, idKey, {}, "wrong-nonce")).status).toBe(401);
    const ok = await nativeSignIn(t, idKey, {});
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { token?: string }).token).toBeTruthy();
    expect(await userByEmail(t, "native@example.com")).toMatchObject({ name: "Nia Native", emailVerified: true });
  });

  test("the app's id token sign-in also leaves two-step verification to the password sign-in", async () => {
    const t = setup();
    const idKey = await appleIdKey();
    fakeApple(idKey);
    await passwordAccount(t, "native2@example.com", { twoFactor: true });
    const refused = await nativeSignIn(t, idKey, { sub: "001234.apple-native2", email: "native2@example.com" });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code?: string }).code).toBe("two_factor_required");
  });
});
