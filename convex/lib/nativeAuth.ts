// Sign-in for Folevi's native apps: OAuth 2.0 Authorization Code with PKCE (RFC 7636), the pattern
// RFC 8252 recommends for native apps. docs/AUTH_DECISION.md → "Native apps".
//
//   1. The app opens https://app.folevi.com/connect?client_id=…&redirect_uri=…&code_challenge=…&state=…
//      in the system browser (ASWebAuthenticationSession). The person signs in there as usual (password,
//      then two-step verification) and presses Continue.
//   2. The page calls POST /native/authorize with its session. Better Auth stores a one-time code (only its
//      hash) bound to the person, the client, the redirect URI and the PKCE challenge, for two minutes.
//   3. The page sends the browser to redirect_uri?code=…&state=…, which only the app receives.
//   4. The app calls POST /native/token with the code and its PKCE verifier. The code is consumed
//      atomically; if everything matches, Better Auth creates a brand-new session for the app — its own
//      device, listed and revocable in Settings → Devices, counted for the plan's device limit.
//   5. The app keeps that session token in the Keychain and sends it as `Authorization: Bearer …` (the
//      bearer plugin) to /convex/token for short-lived Convex JWTs, and to /sign-out.
//
// Better Auth owns the session and the verification store; this file only adds the two endpoints.
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { generateRandomString } from "better-auth/crypto";
import { enforcementFlags } from "./auth";
import { sha256Hex } from "./crypto";
import { NATIVE_CLIENTS, nativeClient } from "./nativeClients";

const CODE_TTL_MS = 2 * 60 * 1000;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/; // base64url(SHA-256), no padding
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/; // RFC 7636 §4.1
const DEVICE_NAME_MAX = 60;

type CodeRecord = { userId: string; clientId: string; redirectUri: string; challenge: string };

function oauthError(error: string, description: string): APIError {
  return new APIError("BAD_REQUEST", { code: error.toUpperCase(), message: description, error, error_description: description });
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  let bin = "";
  for (const b of digest) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function field(body: unknown, key: string): string {
  const v = (body as Record<string, unknown> | null | undefined)?.[key];
  return typeof v === "string" ? v : "";
}

function registeredClient(clientId: string, redirectUri: string) {
  if (!Object.hasOwn(NATIVE_CLIENTS, clientId)) throw oauthError("invalid_client", "Unknown app.");
  const client = nativeClient(clientId, redirectUri);
  if (!client) throw oauthError("invalid_request", "This app's return address isn't registered.");
  return client;
}

const identifierFor = async (code: string) => `native-code:${await sha256Hex(code)}`;

export function nativeAuth() {
  return {
    id: "folevi-native-auth",
    endpoints: {
      /** Issues a one-time code for a signed-in person who approved the app on /connect. */
      nativeAuthorize: createAuthEndpoint("/native/authorize", { method: "POST", use: [sessionMiddleware] }, async (ctx) => {
        const clientId = field(ctx.body, "client_id");
        const redirectUri = field(ctx.body, "redirect_uri");
        const challenge = field(ctx.body, "code_challenge");
        registeredClient(clientId, redirectUri);
        if (field(ctx.body, "code_challenge_method") !== "S256" || !CHALLENGE_RE.test(challenge)) {
          throw oauthError("invalid_request", "The app sent an invalid sign-in request. Try again from the app.");
        }
        const user = ctx.context.session.user as { id: string; emailVerified?: boolean };
        if (enforcementFlags().requireVerifiedEmail && !user.emailVerified) throw oauthError("access_denied", "Verify your email address first.");

        const code = generateRandomString(48);
        const record: CodeRecord = { userId: user.id, clientId, redirectUri, challenge };
        await ctx.context.internalAdapter.createVerificationValue({
          identifier: await identifierFor(code),
          value: JSON.stringify(record),
          expiresAt: new Date(Date.now() + CODE_TTL_MS),
        });
        return ctx.json({ code }, { headers: { "Cache-Control": "no-store" } });
      }),

      /** Exchanges a code + PKCE verifier for a new session belonging to the app. */
      nativeToken: createAuthEndpoint("/native/token", { method: "POST" }, async (ctx) => {
        if (field(ctx.body, "grant_type") !== "authorization_code") throw oauthError("unsupported_grant_type", "Unsupported grant type.");
        const code = field(ctx.body, "code");
        const verifier = field(ctx.body, "code_verifier");
        const clientId = field(ctx.body, "client_id");
        const redirectUri = field(ctx.body, "redirect_uri");
        const client = registeredClient(clientId, redirectUri);
        if (!code || code.length > 128 || !VERIFIER_RE.test(verifier)) throw oauthError("invalid_grant", "This sign-in link has expired. Try again from the app.");

        // Consumed atomically, so a code works once even if it's replayed concurrently.
        const stored = await ctx.context.internalAdapter.consumeVerificationValue(await identifierFor(code));
        if (!stored || new Date(stored.expiresAt).getTime() < Date.now()) {
          throw oauthError("invalid_grant", "This sign-in link has expired. Try again from the app.");
        }
        const record = JSON.parse(stored.value) as CodeRecord;
        if (record.clientId !== clientId || record.redirectUri !== redirectUri || record.challenge !== (await pkceChallenge(verifier))) {
          throw oauthError("invalid_grant", "This sign-in link has expired. Try again from the app.");
        }
        const user = await ctx.context.internalAdapter.findUserById(record.userId);
        if (!user) throw oauthError("invalid_grant", "This account no longer exists.");

        const deviceName = field(ctx.body, "device_name").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, DEVICE_NAME_MAX);
        const session = await ctx.context.internalAdapter.createSession(user.id, false, {
          userAgent: deviceName ? `${client.label} (${deviceName})` : client.label,
        });
        if (!session) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Couldn't sign in. Try again." });
        return ctx.json(
          {
            access_token: session.token,
            token_type: "Bearer",
            expires_in: Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000),
          },
          { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
        );
      }),
    },
  } satisfies BetterAuthPlugin;
}
