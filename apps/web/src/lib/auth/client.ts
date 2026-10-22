"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { authFetch, serviceUrl } from "./shellFetch";
import { pinnedFetch } from "@/lib/places/pin";

/**
 * Browser client for Folevi's built-in accounts (email + password, verified email, authenticator-app
 * two-step verification, passkeys). Talks to the same-origin /api/auth/* proxy; the session lives in an
 * HTTP-only first-party cookie and never in script-readable storage.
 */
export const authClient = createAuthClient({
  // The bundled app shell (FOLEVI_BUILD=shell) runs on app://folevi or capacitor://localhost, where Better Auth
  // can't derive its address from the page and throws on load (docs/LOCAL_MODE.md S2), and where a session
  // cookie can't work: it's given the service's address, and every request goes through the host's native
  // fetch, which holds the bearer session (lib/auth/shellFetch.ts, docs/LOCAL_MODE_PLAN.md §1). Website
  // builds never set the flag, so this branch and shellFetch.ts are dropped from them.
  // On the website every request names this tab's account (several accounts in one browser,
  // lib/places/pin.ts): the proxy answers as that account whatever the browser's active session is.
  ...(process.env.NEXT_PUBLIC_FOLEVI_SHELL === "1" ? { baseURL: `${serviceUrl()}/api/auth`, fetchOptions: { customFetchImpl: authFetch } } : { fetchOptions: { customFetchImpl: pinnedFetch } }),
  // oauthProviderClient: on the connected-app consent page (/oauth/consent), sends its signed query along.
  plugins: [convexClient(), twoFactorClient(), oauthProviderClient(), passkeyClient()],
});

export type AuthErrorLike = { code?: string; message?: string; status?: number } | null | undefined;

/**
 * Plain-language messages for auth errors. Sign-in failures stay generic (no account enumeration).
 * `wait` names how long the endpoint's rate limit lasts (see convex/auth.ts), so a 429 says it honestly.
 */
export function authErrorMessage(error: AuthErrorLike, fallback = "Something went wrong. Please try again.", wait = "a minute"): string {
  if (!error) return fallback;
  const code = error.code ?? "";
  if (error.status === 429 || code === "TOO_MANY_REQUESTS") return `Too many attempts. Wait ${wait}, then try again.`;
  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_PASSWORD":
    case "USER_NOT_FOUND":
    case "INVALID_EMAIL":
    case "CREDENTIAL_ACCOUNT_NOT_FOUND":
      return "The email or password is incorrect.";
    case "EMAIL_NOT_VERIFIED":
      return "Verify your email address first. We've sent you a new link.";
    case "PASSWORD_TOO_SHORT":
      return "Use at least 10 characters for your password.";
    case "PASSWORD_TOO_LONG":
      return "Use at most 128 characters for your password.";
    case "PASSWORD_COMPROMISED":
      return "This password has appeared in a data breach. Choose a different one.";
    case "INVALID_CODE":
      return "That code didn't work. Check your authenticator app and try again.";
    case "INVALID_BACKUP_CODE":
      return "That backup code didn't work. Each code works only once.";
    case "OTP_HAS_EXPIRED":
    case "TWO_FACTOR_NOT_ENABLED":
    case "INVALID_TWO_FACTOR_COOKIE":
    case "SESSION_EXPIRED":
      return "This sign-in attempt expired. Start again from the sign-in page.";
    case "INVALID_TOKEN":
    case "TOKEN_EXPIRED":
      return "This link is invalid or has expired. Request a new one.";
    case "SIGNUPS_PAUSED":
      return "New sign-ups are paused right now. Please try again later.";
    case "SESSION_NOT_FRESH":
      return "For your security, sign in again first. Then try once more.";
    case "AUTH_CANCELLED":
    case "ERROR_CEREMONY_ABORTED":
    case "REGISTRATION_CANCELLED":
    case "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY":
      return "The passkey request was cancelled or timed out.";
    case "PASSKEY_NOT_FOUND":
    case "CHALLENGE_NOT_FOUND":
    case "AUTHENTICATION_FAILED":
      return "That passkey didn't work. Try again, or sign in with your email and password.";
    case "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED":
    case "PREVIOUSLY_REGISTERED":
      return "This device already has a passkey for your account.";
    case "FAILED_TO_VERIFY_REGISTRATION":
    case "ERROR_AUTHENTICATOR_GENERAL_ERROR":
      return "The passkey couldn't be added. Please try again.";
    case "FAILED_TO_UNLINK_LAST_ACCOUNT":
      return "This is the only way you sign in, so it can't be removed. Set a password first (Forgot your password? on the sign-in page sends a link).";
    case "ACCOUNT_NOT_FOUND":
      return "That sign-in method isn't linked to your account any more.";
    case "PASSKEY_ADMIN_NEEDS_CODE":
      return "Admin accounts sign in with a password and an authenticator code.";
    case "PASSKEY_NOT_VERIFIED":
      return "This passkey didn't check it's you, so it can't replace your authenticator code. Sign in with your password instead.";
    case "ACCOUNT_TEMPORARILY_LOCKED":
    case "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE":
      return "Too many incorrect codes. For your security this account is locked for a while. Try again later or reset your password.";
    default:
      return error.message && !/internal/i.test(error.message) ? error.message : fallback;
  }
}
