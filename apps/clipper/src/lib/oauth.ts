// Signing in to Folevi as a connected app, the same OAuth 2.1 flow Claude or ChatGPT use (Better Auth's
// OAuth provider, convex/auth.ts in the monorepo): register as a public client (RFC 7591) with the
// extension's https://<id>.chromiumapp.org/ redirect, authorize with PKCE in a browser window
// (chrome.identity.launchWebAuthFlow, in background.ts), then trade the code for tokens. Pure functions over
// `fetch`, so tests can stub the server.
import { CLIENT_NAME, SCOPES } from "../config";

export interface TokenSet {
  accessToken: string;
  /** When the access token stops working (ms since epoch). */
  expiresAt: number;
  refreshToken?: string;
}

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

const endpoint = (origin: string, path: "register" | "authorize" | "token") => `${origin}/api/auth/oauth2/${path}`;

/** Registers the clipper as a public client for this redirect URI; returns its client id. */
export async function registerClient(origin: string, redirectUri: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn(endpoint(origin, "register"), {
    method: "POST",
    credentials: "omit",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: SCOPES,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { client_id?: unknown; error?: string; error_description?: string };
  if (!res.ok || typeof body.client_id !== "string") throw new OAuthError(body.error ?? "registration_failed", body.error_description ?? "Folevi couldn't register the clipper. Try again in a moment.");
  return body.client_id;
}

/** The URL the sign-in window opens. */
export function authorizeUrl(origin: string, p: { clientId: string; redirectUri: string; challenge: string; state: string }): string {
  const url = new URL(endpoint(origin, "authorize"));
  const params = { response_type: "code", client_id: p.clientId, redirect_uri: p.redirectUri, scope: SCOPES, state: p.state, code_challenge: p.challenge, code_challenge_method: "S256" };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/**
 * Whether Folevi still knows this registration (one can be removed on the server). Asks the authorize
 * endpoint for where it would send a browser, without cookies; a network problem counts as yes.
 */
export async function clientKnown(url: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(url, { credentials: "omit", redirect: "manual", headers: { accept: "application/json" } });
    const body = (await res.json().catch(() => null)) as { url?: unknown } | null;
    const next = typeof body?.url === "string" ? body.url : "";
    return !/[?&]error=(invalid_client|client_disabled|invalid_redirect|unauthorized_client)\b/.test(next);
  } catch {
    return true;
  }
}

/** The code from the URL the sign-in window ended on, after checking it answers this request. */
export function codeFromRedirect(redirected: string, redirectUri: string, state: string): string {
  const url = new URL(redirected);
  if (!redirected.startsWith(redirectUri)) throw new OAuthError("invalid_redirect", "Sign-in ended somewhere unexpected. Try again.");
  const error = url.searchParams.get("error");
  if (error) throw new OAuthError(error, error === "access_denied" ? "You didn't allow the clipper. Nothing was connected." : (url.searchParams.get("error_description") ?? "Sign-in didn't finish. Try again."));
  if (url.searchParams.get("state") !== state) throw new OAuthError("invalid_state", "Sign-in didn't match this request. Try again.");
  const code = url.searchParams.get("code");
  if (!code) throw new OAuthError("invalid_request", "Folevi didn't send a sign-in code. Try again.");
  return code;
}

async function tokenRequest(origin: string, form: Record<string, string>, fetchFn: typeof fetch, now: number): Promise<TokenSet> {
  const res = await fetchFn(endpoint(origin, "token"), {
    method: "POST",
    credentials: "omit",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown; refresh_token?: unknown; error?: string; error_description?: string };
  if (!res.ok || typeof body.access_token !== "string") {
    throw new OAuthError(body.error ?? `http_${res.status}`, body.error_description ?? "Folevi didn't accept the sign-in. Sign in again.");
  }
  const seconds = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
  return { accessToken: body.access_token, expiresAt: now + seconds * 1000, ...(typeof body.refresh_token === "string" ? { refreshToken: body.refresh_token } : {}) };
}

/** The authorization code (with its PKCE verifier) for tokens. */
export function exchangeCode(origin: string, p: { clientId: string; redirectUri: string; code: string; verifier: string }, fetchFn: typeof fetch = fetch, now = Date.now()): Promise<TokenSet> {
  return tokenRequest(origin, { grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri, client_id: p.clientId, code_verifier: p.verifier }, fetchFn, now);
}

/** A refresh token for new tokens (Folevi rotates refresh tokens: keep the new one when it comes). */
export function refreshTokens(origin: string, p: { clientId: string; refreshToken: string }, fetchFn: typeof fetch = fetch, now = Date.now()): Promise<TokenSet> {
  return tokenRequest(origin, { grant_type: "refresh_token", refresh_token: p.refreshToken, client_id: p.clientId }, fetchFn, now);
}
