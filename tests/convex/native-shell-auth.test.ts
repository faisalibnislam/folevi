// Signing in the apps' built-in interface (docs/LOCAL_MODE_PLAN.md §1, WP4): client "folevi-shell" with
// Authorization Code + PKCE (convex/lib/nativeAuth.ts). The page never holds the session; native code trades
// the one-time code for a bearer session and sends it to /convex/token, /get-session and /sign-out, with no
// cookies and `Origin` set to the service (docs/LOCAL_MODE.md S4). These call Better Auth on the Convex site
// directly (no Next proxy and its FOLEVI_DEV_AUTH_ORIGIN rewrite).
import { createHash, randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { api, components } from "../../convex/_generated/api";
import { corsAllowed, corsFor, SHELL_ORIGINS } from "../../convex/lib/cors";
import { nativeClient } from "../../convex/lib/nativeClients";
import { compareShellVersions, newerFloor, shellNeedsUpdate } from "../../convex/lib/shellVersions";
import { internal } from "../../convex/_generated/api";
import { authUser, setup, type T } from "./helpers";

process.env.BETTER_AUTH_SECRET ??= "test-secret-".repeat(4);

const SERVICE = "http://app.localhost:3000";
const CLIENT = "folevi-shell";
const REDIRECT = "folevi://auth/callback";

const b64url = (b: Buffer) => b.toString("base64url");
function pkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

async function sessionToken(t: T, userId: string): Promise<string> {
  const token = `tok${Math.random().toString(36).slice(2)}${Date.now()}`;
  await t.run(async (ctx) => {
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: { model: "session", data: { userId, token, expiresAt: Date.now() + 86_400_000, createdAt: Date.now(), updatedAt: Date.now() } },
    });
  });
  return token;
}

type Init = { method?: string; token?: string; body?: unknown; origin?: string | null };
async function call(t: T, path: string, init: Init = {}) {
  const headers: Record<string, string> = {};
  const origin = init.origin === undefined ? SERVICE : init.origin;
  if (origin) headers.origin = origin;
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const res = await t.fetch(`/api/auth${path}`, { method: init.method ?? (init.body === undefined ? "GET" : "POST"), headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const text = await res.text();
  let body: Record<string, unknown> & { code?: string; error?: string };
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  return { status: res.status, body, headers: res.headers };
}

/** The /connect page's Continue: a one-time code for the signed-in browser session. */
async function authorize(t: T, browserToken: string, challenge: string, redirectUri = REDIRECT, clientId = CLIENT) {
  return await call(t, "/native/authorize", { token: browserToken, body: { client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256" } });
}

/** Native code's exchange: no cookies, no Origin (Electron net.fetch), like the Mac app. */
async function exchange(t: T, code: string, verifier: string, redirectUri = REDIRECT) {
  return await call(t, "/native/token", {
    origin: null,
    body: { grant_type: "authorization_code", code, code_verifier: verifier, client_id: CLIENT, redirect_uri: redirectUri, device_name: "Studio Mac\u0007" },
  });
}

async function sessions(t: T, userId: string) {
  return await t.run(async (ctx) => {
    const res = (await ctx.runQuery(components.betterAuth.adapter.findMany, { model: "session", where: [{ field: "userId", value: userId }], paginationOpts: { numItems: 100, cursor: null } })) as {
      page: { token: string; userAgent?: string | null }[];
    };
    return res.page;
  });
}

describe("the folevi-shell client", () => {
  test("is registered with folevi://auth/callback only", () => {
    expect(nativeClient(CLIENT, REDIRECT)?.label).toBe("Folevi app");
    expect(nativeClient(CLIENT, "folevi://auth/google")).toBeNull();
    expect(nativeClient(CLIENT, "com.folevi.mac://auth/callback")).toBeNull();
    expect(nativeClient("folevi-app", REDIRECT)).toBeNull();
  });

  test("a wrong return address is refused when the code is issued and when it's exchanged", async () => {
    const t = setup();
    const userId = await authUser(t, "shell-redirect@example.com");
    const browser = await sessionToken(t, userId);
    const { challenge, verifier } = pkce();
    for (const bad of ["https://evil.example/cb", "folevi://auth/google", "folevi://auth/callback/", "folevi://auth/callback?x=1"]) {
      const res = await authorize(t, browser, challenge, bad);
      expect(res.status, bad).toBe(400);
      expect(res.body.code).toBe("INVALID_REQUEST");
    }
    expect((await authorize(t, browser, challenge, REDIRECT, "folevi-unknown")).body.code).toBe("INVALID_CLIENT");
    // Without a session, no code at all.
    expect((await call(t, "/native/authorize", { body: { client_id: CLIENT, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256" } })).status).toBe(401);

    // A code issued for the right address can't be exchanged for another one.
    const ok = await authorize(t, browser, challenge);
    expect(ok.status).toBe(200);
    const swapped = await call(t, "/native/token", {
      origin: null,
      body: { grant_type: "authorization_code", code: ok.body.code, code_verifier: verifier, client_id: CLIENT, redirect_uri: "folevi://auth/google" },
    });
    expect(swapped.status).toBe(400);
  });

  test("a PKCE mismatch signs nobody in and uses the code up", async () => {
    const t = setup();
    const userId = await authUser(t, "shell-pkce@example.com");
    const browser = await sessionToken(t, userId);
    const own = pkce();
    const { body } = await authorize(t, browser, own.challenge);
    const code = body.code as string;
    expect(code).toMatch(/^[A-Za-z0-9_-]{48}$/);

    const before = (await sessions(t, userId)).length;
    const wrong = await exchange(t, code, pkce().verifier);
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe("INVALID_GRANT");
    // The failed attempt consumed it: the right verifier is too late now.
    expect((await exchange(t, code, own.verifier)).status).toBe(400);
    expect((await sessions(t, userId)).length).toBe(before);

    // A plain-method challenge is refused up front.
    const plain = await call(t, "/native/authorize", { token: browser, body: { client_id: CLIENT, redirect_uri: REDIRECT, code_challenge: own.verifier, code_challenge_method: "plain" } });
    expect(plain.status).toBe(400);
  });

  test("a code works once; the session it makes is a device of its own that the bearer can use and end", async () => {
    const t = setup();
    const userId = await authUser(t, "shell-once@example.com");
    const browser = await sessionToken(t, userId);
    const { verifier, challenge } = pkce();
    const code = (await authorize(t, browser, challenge)).body.code as string;

    const ok = await exchange(t, code, verifier);
    expect(ok.status).toBe(200);
    const token = ok.body.access_token as string;
    expect(ok.body.token_type).toBe("Bearer");
    expect(typeof token).toBe("string");
    // Replayed, even with the right verifier: refused, and no second session.
    expect((await exchange(t, code, verifier)).status).toBe(400);

    const mine = (await sessions(t, userId)).filter((s) => s.token === token);
    expect(mine).toHaveLength(1);
    // Labelled as the app, with the device's name (control characters dropped).
    expect(mine[0]!.userAgent).toBe("Folevi app (Studio Mac)");

    // GETs work with the bearer whatever the Origin (none, or the shell's own).
    for (const origin of [null, "app://folevi", "capacitor://localhost"]) {
      const jwt = await call(t, "/convex/token", { token, origin });
      expect(jwt.status, String(origin)).toBe(200);
      expect(typeof jwt.body.token).toBe("string");
    }
    const session = await call(t, "/get-session", { token, origin: null });
    expect((session.body.user as { email?: string }).email).toBe("shell-once@example.com");

    // Sign-out with the bearer and the service's origin, as native sends it. (Better Auth skips its origin
    // check under test, so the 403 for a missing or shell origin is checked against the real deployment in
    // apps/web/e2e/shell-auth.spec.ts.)
    expect((await call(t, "/sign-out", { token, origin: SERVICE, body: {} })).status).toBe(200);

    // Signed out: the session is gone, and the browser's own session isn't touched.
    expect((await call(t, "/convex/token", { token, origin: null })).status).toBe(401);
    expect((await sessions(t, userId)).some((s) => s.token === token)).toBe(false);
    expect((await call(t, "/convex/token", { token: browser })).status).toBe(200);
  });

  test("an expired code is refused", async () => {
    const t = setup();
    const userId = await authUser(t, "shell-expired@example.com");
    const browser = await sessionToken(t, userId);
    const { verifier, challenge } = pkce();
    const code = (await authorize(t, browser, challenge)).body.code as string;
    // Age every stored code past its two minutes.
    await t.run(async (ctx) => {
      const rows = (await ctx.runQuery(components.betterAuth.adapter.findMany, { model: "verification", where: [], paginationOpts: { numItems: 100, cursor: null } })) as { page: { _id: string; identifier: string }[] };
      for (const row of rows.page.filter((r) => r.identifier.startsWith("native-code:"))) {
        await ctx.runMutation(components.betterAuth.adapter.updateOne, { input: { model: "verification", where: [{ field: "_id", value: row._id }], update: { expiresAt: Date.now() - 1000 } } });
      }
    });
    expect((await exchange(t, code, verifier)).status).toBe(400);
  });
});

describe("file CORS for the built-in interface", () => {
  test("the shell origins pass in every environment; the development rule never reaches production", () => {
    const prod = { appUrl: "https://app.folevi.com", deployment: "production" };
    const dev = { appUrl: "http://app.localhost:3000", deployment: "development" };
    for (const origin of SHELL_ORIGINS) {
      expect(corsAllowed(origin, prod), origin).toBe(true);
      expect(corsAllowed(origin, dev), origin).toBe(true);
    }
    expect(corsAllowed("https://app.folevi.com", prod)).toBe(true);
    // Local hosts only outside production, and only over http(s).
    expect(corsAllowed("http://app.localhost:3002", prod)).toBe(false);
    expect(corsAllowed("http://localhost:3003", prod)).toBe(false);
    expect(corsAllowed("http://localhost:3003", dev)).toBe(true);
    expect(corsAllowed("http://127.0.0.1:4319", dev)).toBe(true);
    expect(corsAllowed("capacitor://evil.localhost", dev)).toBe(false);
    expect(corsAllowed("app://evil", dev)).toBe(false);
    expect(corsAllowed("app://folevi.evil", prod)).toBe(false);
    expect(corsAllowed("https://localhost.evil.com", dev)).toBe(false);
    expect(corsAllowed("null", dev)).toBe(false);
    expect(corsAllowed(null, dev)).toBe(false);
  });

  test("corsFor echoes an allowed origin and varies on it", () => {
    expect(corsFor("app://folevi")).toEqual({ "access-control-allow-origin": "app://folevi", vary: "origin" });
    expect(corsFor("https://evil.example")).toEqual({});
  });
});

describe("minShellVersion", () => {
  test("settings.status reports the floor per platform, the newer of code and the operators' setting", async () => {
    const t = setup();
    expect((await t.query(api.settings.status, {})).minShellVersion).toEqual({ mac: null, ios: null });
    await t.mutation(internal.settings.setMinShellVersion, { mac: "1.16.0" });
    expect((await t.query(api.settings.status, {})).minShellVersion).toEqual({ mac: "1.16.0", ios: null });
    await t.mutation(internal.settings.setMinShellVersion, { ios: "1.2" });
    expect((await t.query(api.settings.status, {})).minShellVersion).toEqual({ mac: "1.16.0", ios: "1.2" });
    await t.mutation(internal.settings.setMinShellVersion, { mac: null });
    expect((await t.query(api.settings.status, {})).minShellVersion).toEqual({ mac: null, ios: "1.2" });
    await expect(t.mutation(internal.settings.setMinShellVersion, { mac: "latest" })).rejects.toThrow(/Not a version/);
  });

  test("version comparison", () => {
    expect(compareShellVersions("1.15.0", "1.16.0")).toBeLessThan(0);
    expect(compareShellVersions("1.16", "1.16.0")).toBe(0);
    expect(compareShellVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareShellVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(newerFloor("1.2.0", "1.10.0")).toBe("1.10.0");
    expect(newerFloor(null, "bad")).toBeNull();
    expect(shellNeedsUpdate("1.15.0", "1.16.0")).toBe(true);
    expect(shellNeedsUpdate("1.16.0", "1.16.0")).toBe(false);
    expect(shellNeedsUpdate("1.17.0", "1.16.0")).toBe(false);
    expect(shellNeedsUpdate("1.15.0", null)).toBe(false);
    expect(shellNeedsUpdate("dev", "1.16.0")).toBe(false);
  });
});
