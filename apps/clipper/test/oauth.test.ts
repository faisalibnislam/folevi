// The OAuth requests the clipper makes: registration, the authorize URL, reading the redirect and trading
// the code, against a stubbed Folevi.
import { describe, expect, test } from "vitest";
import { authorizeUrl, clientKnown, codeFromRedirect, exchangeCode, OAuthError, refreshTokens, registerClient } from "../src/lib/oauth";
import { json, scriptedFetch } from "./fakes";

const ORIGIN = "https://app.folevi.com";
const REDIRECT = "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/";

describe("registration and authorize", () => {
  test("registers as a public client asking only for notes:write and a refresh token", async () => {
    const fetch = scriptedFetch(() => json(200, { client_id: "c1" }));
    expect(await registerClient(ORIGIN, REDIRECT, fetch)).toBe("c1");
    const [req] = fetch.sent;
    expect(req!.url).toBe(`${ORIGIN}/api/auth/oauth2/register`);
    expect(JSON.parse(req!.body)).toEqual({
      client_name: "Folevi Web Clipper",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "notes:write offline_access",
    });
  });

  test("a refused registration says why", async () => {
    const fetch = scriptedFetch(() => json(400, { error: "invalid_redirect_uri", error_description: "bad" }));
    await expect(registerClient(ORIGIN, REDIRECT, fetch)).rejects.toMatchObject({ code: "invalid_redirect_uri", message: "bad" });
  });

  test("the authorize URL carries PKCE, state and the clipper's scope", () => {
    const url = new URL(authorizeUrl(ORIGIN, { clientId: "c1", redirectUri: REDIRECT, challenge: "ch", state: "st" }));
    expect(url.origin + url.pathname).toBe(`${ORIGIN}/api/auth/oauth2/authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ response_type: "code", client_id: "c1", redirect_uri: REDIRECT, scope: "notes:write offline_access", state: "st", code_challenge: "ch", code_challenge_method: "S256" });
  });

  test("a registration Folevi no longer knows is noticed before the sign-in window opens", async () => {
    const gone = scriptedFetch(() => json(200, { redirect: true, url: `${ORIGIN}/api/auth/error?error=invalid_client&error_description=x` }));
    expect(await clientKnown(`${ORIGIN}/api/auth/oauth2/authorize?client_id=old`, gone)).toBe(false);
    const known = scriptedFetch(() => json(200, { redirect: true, url: `${ORIGIN}/oauth/consent?client_id=c1&sig=s` }));
    expect(await clientKnown(`${ORIGIN}/api/auth/oauth2/authorize?client_id=c1`, known)).toBe(true);
    expect(known.sent[0]!.headers.get("accept")).toBe("application/json");
    const offline = scriptedFetch(() => Promise.reject(new TypeError("offline")));
    expect(await clientKnown(`${ORIGIN}/x`, offline)).toBe(true);
  });
});

describe("the redirect", () => {
  test("gives the code when the state matches", () => {
    expect(codeFromRedirect(`${REDIRECT}?code=abc&state=st`, REDIRECT, "st")).toBe("abc");
  });

  test("refuses a different state, another address, or a denial", () => {
    expect(() => codeFromRedirect(`${REDIRECT}?code=abc&state=other`, REDIRECT, "st")).toThrow(/didn't match/);
    expect(() => codeFromRedirect("https://evil.example/?code=abc&state=st", REDIRECT, "st")).toThrow(OAuthError);
    expect(() => codeFromRedirect(`${REDIRECT}?error=access_denied&state=st`, REDIRECT, "st")).toThrow(/didn't allow/);
  });
});

describe("tokens", () => {
  test("the code is traded with its verifier; expiry is counted from now", async () => {
    const fetch = scriptedFetch(() => json(200, { access_token: "fvat_a", refresh_token: "fvrt_r", expires_in: 3600, token_type: "Bearer" }));
    const tokens = await exchangeCode(ORIGIN, { clientId: "c1", redirectUri: REDIRECT, code: "abc", verifier: "v" }, fetch, 1_000);
    expect(tokens).toEqual({ accessToken: "fvat_a", refreshToken: "fvrt_r", expiresAt: 3_601_000 });
    const [req] = fetch.sent;
    expect(req!.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(req!.body))).toEqual({ grant_type: "authorization_code", code: "abc", redirect_uri: REDIRECT, client_id: "c1", code_verifier: "v" });
  });

  test("a refresh sends the refresh token and client id; a refusal is an OAuthError", async () => {
    const fetch = scriptedFetch(() => json(200, { access_token: "fvat_b", expires_in: 60 }), () => json(400, { error: "invalid_grant" }));
    expect(await refreshTokens(ORIGIN, { clientId: "c1", refreshToken: "fvrt_r" }, fetch, 0)).toEqual({ accessToken: "fvat_b", expiresAt: 60_000 });
    expect(Object.fromEntries(new URLSearchParams(fetch.sent[0]!.body))).toEqual({ grant_type: "refresh_token", refresh_token: "fvrt_r", client_id: "c1" });
    await expect(refreshTokens(ORIGIN, { clientId: "c1", refreshToken: "fvrt_r" }, fetch, 0)).rejects.toMatchObject({ code: "invalid_grant" });
  });
});
