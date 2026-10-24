"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { socialError, type SocialProvider } from "@/lib/auth/socialErrors";
import { inIosApp, nativeApp } from "@/lib/nativeApp";
import { desktop } from "@/lib/desktop";
import { appleSheetHere, signInWithAppleSheet } from "@/lib/auth/appleSheet";
import { appSignInUrl } from "@/lib/auth/appSignIn";
import { Alert } from "./fields";

/** Google's "G", in its own colours (Google's sign-in branding asks for it as is). */
export function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Apple's logo, in the button's own text colour (black on the white button, white on the black one). */
export function AppleMark({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

/** The client and return address the browser half (/app-google) hands its code to (convex/lib/nativeClients.ts). */
const APP_CLIENT = "folevi-app";
const APP_RETURN = "folevi://auth/google";

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomString = (bytes: number) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));
const challengeOf = async (verifier: string) => base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));

/**
 * How this page signs in with Google or Apple: in a browser, straight to the provider; in the Mac or iOS app,
 * through the browser (Google doesn't sign in inside an app's web view, and both go the same way), which hands
 * back a code; null in an app too old to do that, where the buttons stay hidden.
 */
type Route = { kind: "browser" } | { kind: "app"; open: (url: string) => Promise<string | null> } | null;

function routeHere(): Route {
  if (inIosApp()) {
    const app = nativeApp();
    return app?.authenticate ? { kind: "app", open: (url) => app.authenticate!(url) } : null;
  }
  const mac = desktop();
  if (mac) return mac.signInInBrowser ? { kind: "app", open: (url) => mac.signInInBrowser!(url) } : null;
  return { kind: "browser" };
}

/** Apple's own button: black on a light page, white on a dark one, with Apple's logo and "Continue with Apple". */
export const APPLE_BUTTON =
  "ui-btn h-11 w-full gap-2 text-body [font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif] bg-black text-white hover:bg-[#1d1d1f] active:bg-[#2c2c2e] dark:bg-white dark:text-black dark:hover:bg-[#f2f2f4] dark:active:bg-[#e5e5ea] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]";

/**
 * "Continue with Apple" and "Continue with Google" (each only when the server offers it), above the email
 * form, with an "or" below them. The provider sends the person back to `returnTo` (a first sign-in goes to
 * `newUserTo`); a refusal comes back to /signin?via=… with an error the page explains (lib/auth/socialErrors.ts).
 *
 * In the Mac and iOS apps: the app opens /app-google?provider=… in the browser (iOS's sign-in sheet, or the
 * Mac's default browser) with a PKCE challenge from a verifier only this page holds; the browser signs in with
 * the provider and hands the app a one-time code through folevi://auth/google; this page redeems it with the
 * verifier for its own session (convex/lib/nativeAuth.ts /native/redeem) and goes on to `returnTo`.
 */
export function SocialSignIn({
  providers,
  returnTo,
  newUserTo,
  error: initialError,
}: {
  providers: { google: boolean; apple: boolean };
  returnTo: string;
  newUserTo?: string;
  error?: string;
}) {
  const [route, setRoute] = useState<Route>(null);
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | undefined>(initialError);
  useEffect(() => setRoute(routeHere()), []);

  async function inBrowser(provider: SocialProvider) {
    const { error: err } = await authClient.signIn.social({ provider, callbackURL: returnTo, newUserCallbackURL: newUserTo ?? returnTo, errorCallbackURL: `/signin?via=${provider}` });
    // On success the browser is already on its way to the provider.
    if (err) setError(authErrorMessage(err));
    return Boolean(err);
  }

  async function throughBrowser(provider: SocialProvider, open: (url: string) => Promise<string | null>) {
    const verifier = randomString(48);
    const state = randomString(16);
    const start = appSignInUrl(window.location.origin, { provider, clientId: APP_CLIENT, redirectUri: APP_RETURN, codeChallenge: await challengeOf(verifier), state });
    const back = await open(start);
    if (!back) return; // closed before it finished
    const answer = new URL(back);
    if (answer.searchParams.get("state") !== state) {
      setError(socialError("state_mismatch", provider));
      return;
    }
    const code = answer.searchParams.get("code");
    if (!code) {
      setError(socialError(answer.searchParams.get("error") ?? "failed", provider));
      return;
    }
    const { error: err } = await authClient.$fetch("/native/redeem", { method: "POST", body: { code, code_verifier: verifier, client_id: APP_CLIENT, redirect_uri: APP_RETURN } });
    if (err) {
      setError(authErrorMessage(err));
      return;
    }
    window.location.assign(newUserTo ?? returnTo);
  }

  async function go(provider: SocialProvider) {
    if (busy || !route) return;
    setError(undefined);
    setBusy(provider);
    try {
      if (provider === "apple" && inIosApp() && appleSheetHere()) {
        // The iPhone and iPad app: Apple's own sheet (lib/auth/appleSheet.ts).
        const r = await signInWithAppleSheet();
        if (r === "signed-in") {
          window.location.assign(newUserTo ?? returnTo);
          return;
        }
        if (r !== "cancelled") setError(r.error);
      } else if (route.kind === "browser") {
        if (!(await inBrowser(provider))) return; // leaving for the provider: stay busy
      } else await throughBrowser(provider, route.open);
    } catch {
      setError(socialError("failed", provider));
    }
    setBusy(null);
  }

  const alert = error ? (
    <div className="mb-4">
      <Alert>{error}</Alert>
    </div>
  ) : null;
  if (!route || (!providers.google && !providers.apple)) return alert;
  const spinner = <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />;
  return (
    <div className="mb-4">
      {alert}
      <div className="space-y-3">
        {providers.apple ? (
          <button type="button" onClick={() => void go("apple")} disabled={busy !== null} aria-busy={busy === "apple"} className={APPLE_BUTTON}>
            {busy === "apple" ? spinner : <AppleMark />}
            Continue with Apple
          </button>
        ) : null}
        {providers.google ? (
          <button type="button" onClick={() => void go("google")} disabled={busy !== null} aria-busy={busy === "google"} className="ui-btn ui-btn-secondary h-11 w-full gap-2.5 text-body">
            {busy === "google" ? spinner : <GoogleMark />}
            Continue with Google
          </button>
        ) : null}
      </div>
      <div className="mt-4 flex items-center gap-3 text-footnote text-muted" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
