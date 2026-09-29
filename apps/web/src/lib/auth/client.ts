"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { convexClient } from "@convex-dev/better-auth/client/plugins";

/**
 * Browser client for Folevi's built-in accounts (email + password, verified email, authenticator-app
 * two-step verification). Talks to the same-origin /api/auth/* proxy; the session lives in an
 * HTTP-only first-party cookie and never in script-readable storage.
 */
export const authClient = createAuthClient({
  plugins: [convexClient(), twoFactorClient()],
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
    case "ACCOUNT_TEMPORARILY_LOCKED":
    case "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE":
      return "Too many incorrect codes. For your security this account is locked for a while. Try again later or reset your password.";
    default:
      return error.message && !/internal/i.test(error.message) ? error.message : fallback;
  }
}
