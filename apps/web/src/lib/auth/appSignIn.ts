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

// ---- The return from the provider ------------------------------------------------------------------------
//
// The page leaves for Google or Apple and comes back to itself. That it is back is never taken from the address
// (anyone can write `returned=1` into a link): before leaving, the page notes a random value and the request's
// challenge in this tab's sessionStorage and sends the value round in `returned`; it is back only when the
// address carries the value this tab noted, for the same challenge. A return it can't match is a fresh start.

/** Where this tab keeps the note of a sign-in it started. */
export const APP_SIGN_IN_MARK = "folevi:app-sign-in";

type MarkStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const tabStore = (): MarkStore | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};

/**
 * Notes that this tab is leaving for the provider with this challenge. Returns the value to send round in
 * `returned`, or null when the tab can't keep a note (storage is off): the sign-in can't go on then.
 */
export function markAppSignInStart(codeChallenge: string, store: MarkStore | null = tabStore()): string | null {
  if (!store) return null;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const mark = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    store.setItem(APP_SIGN_IN_MARK, JSON.stringify({ mark, codeChallenge }));
    // (Some browsers accept the write and keep nothing.)
    return store.getItem(APP_SIGN_IN_MARK) ? mark : null;
  } catch {
    return null;
  }
}

/** Whether this tab is back from a provider trip it started itself for this challenge (see above). */
export function appSignInReturned(returned: string | null | undefined, codeChallenge: string, store: MarkStore | null = tabStore()): boolean {
  if (!returned || !store) return false;
  try {
    const noted = JSON.parse(store.getItem(APP_SIGN_IN_MARK) ?? "null") as { mark?: unknown; codeChallenge?: unknown } | null;
    return !!noted && typeof noted.mark === "string" && noted.mark.length === 32 && noted.mark === returned && noted.codeChallenge === codeChallenge;
  } catch {
    return false;
  }
}

/** Forgets the note (the code was handed over, or the person cancelled). */
export function clearAppSignInMark(store: MarkStore | null = tabStore()): void {
  try {
    store?.removeItem(APP_SIGN_IN_MARK);
  } catch {
    /* nothing to forget */
  }
}
