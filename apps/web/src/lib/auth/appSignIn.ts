// /app-google, the browser half of "Continue with Google" or "Continue with Apple" in the Mac and iOS apps
// (components/auth/AppSocialSignIn.tsx): the page goes straight on to the provider, then issues a one-time code
// (convex/lib/nativeAuth.ts) for the app that opened it.
import { nativeClient } from "../../../../../convex/lib/nativeClients";
import type { SocialProvider } from "./socialErrors";

/**
 * The apps /app-google signs in for: an app's own web view ("folevi-app", which redeems the code for a cookie of
 * its own) and the built-in interface ("folevi-shell", whose native code trades it for a bearer session). Each
 * still has to name its own registered return address (convex/lib/nativeClients.ts).
 */
export const APP_SIGN_IN_CLIENTS: readonly string[] = ["folevi-app", "folevi-shell"];

/** A PKCE challenge as the apps send it: base64url(SHA-256), no padding. */
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export type AppSignInRequest = { clientId: string; redirectUri: string; codeChallenge: string; codeChallengeMethod: string };

/** Whether /app-google may go on: one of its apps, at that app's registered return address, with an S256 challenge. */
export function appSignInRequestValid(r: AppSignInRequest): boolean {
  return APP_SIGN_IN_CLIENTS.includes(r.clientId) && nativeClient(r.clientId, r.redirectUri) !== null && r.codeChallengeMethod === "S256" && CHALLENGE_RE.test(r.codeChallenge);
}

/**
 * The /app-google address for a sign-in with `provider`, on `origin` (the website). Google is the page's default,
 * so its address leaves `provider` out (as the Mac and iOS apps' native code checks only the path).
 */
export function appSignInUrl(origin: string, o: { provider: SocialProvider; clientId: string; redirectUri: string; codeChallenge: string; state: string }): string {
  const start = new URL("/app-google", origin);
  start.searchParams.set("client_id", o.clientId);
  start.searchParams.set("redirect_uri", o.redirectUri);
  start.searchParams.set("code_challenge", o.codeChallenge);
  start.searchParams.set("code_challenge_method", "S256");
  start.searchParams.set("state", o.state);
  if (o.provider !== "google") start.searchParams.set("provider", o.provider);
  return start.toString();
}
