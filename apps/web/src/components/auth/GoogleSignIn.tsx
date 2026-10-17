"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { googleError } from "@/lib/auth/googleErrors";
import { inIosApp, nativeApp } from "@/lib/nativeApp";
import { desktop } from "@/lib/desktop";
import { Alert } from "./fields";

/** Google's "G", in its own colours (Google's sign-in branding asks for it as is). */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
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
 * How this page signs in with Google: in a browser, straight to Google; in the Mac or iOS app, through the
 * browser (Google doesn't sign in inside an app's web view), which hands back a code; null in an app too old
 * to do that, where the button stays hidden.
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

/**
 * "Continue with Google", above the email form, with an "or" below it. Google sends the person back to
 * `returnTo` (a first sign-in goes to `newUserTo`); a refusal comes back to /signin with an error the page
 * explains (lib/auth/googleErrors.ts).
 *
 * In the Mac and iOS apps: the app opens /app-google in the browser (iOS's sign-in sheet, or the Mac's default
 * browser) with a PKCE challenge from a verifier only this page holds; the browser signs in with Google and
 * hands the app a one-time code through folevi://auth/google; this page redeems it with the verifier for its
 * own session (convex/lib/nativeAuth.ts /native/redeem) and goes on to `returnTo`.
 */
export function GoogleSignIn({ returnTo, newUserTo, error: initialError }: { returnTo: string; newUserTo?: string; error?: string }) {
  const [route, setRoute] = useState<Route>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError);
  useEffect(() => setRoute(routeHere()), []);

  async function inBrowser() {
    const { error: err } = await authClient.signIn.social({ provider: "google", callbackURL: returnTo, newUserCallbackURL: newUserTo ?? returnTo, errorCallbackURL: "/signin" });
    // On success the browser is already on its way to Google.
    if (err) setError(authErrorMessage(err));
    return Boolean(err);
  }

  async function throughBrowser(open: (url: string) => Promise<string | null>) {
    const verifier = randomString(48);
    const state = randomString(16);
    const start = new URL("/app-google", window.location.origin);
    start.searchParams.set("client_id", APP_CLIENT);
    start.searchParams.set("redirect_uri", APP_RETURN);
    start.searchParams.set("code_challenge", await challengeOf(verifier));
    start.searchParams.set("code_challenge_method", "S256");
    start.searchParams.set("state", state);
    const back = await open(start.toString());
    if (!back) return; // closed before it finished
    const answer = new URL(back);
    if (answer.searchParams.get("state") !== state) {
      setError(googleError("state_mismatch"));
      return;
    }
    const code = answer.searchParams.get("code");
    if (!code) {
      setError(googleError(answer.searchParams.get("error") ?? "google_failed"));
      return;
    }
    const { error: err } = await authClient.$fetch("/native/redeem", { method: "POST", body: { code, code_verifier: verifier, client_id: APP_CLIENT, redirect_uri: APP_RETURN } });
    if (err) {
      setError(authErrorMessage(err));
      return;
    }
    window.location.assign(newUserTo ?? returnTo);
  }

  async function go() {
    if (busy || !route) return;
    setError(undefined);
    setBusy(true);
    try {
      if (route.kind === "browser") {
        if (!(await inBrowser())) return; // leaving for Google: stay busy
      } else await throughBrowser(route.open);
    } catch {
      setError(googleError("google_failed"));
    }
    setBusy(false);
  }

  if (!route) return error ? <div className="mb-4"><Alert>{error}</Alert></div> : null;
  return (
    <div className="mb-4">
      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      <button type="button" onClick={() => void go()} disabled={busy} aria-busy={busy} className="ui-btn ui-btn-secondary h-11 w-full gap-2.5 text-[15px]">
        {busy ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <GoogleMark />}
        Continue with Google
      </button>
      <div className="mt-4 flex items-center gap-3 text-xs text-muted" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
