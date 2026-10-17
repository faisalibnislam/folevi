"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { inIosApp } from "@/lib/nativeApp";
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

/**
 * "Continue with Google", above the email form, with an "or" below it. Google sends the person back to
 * `returnTo` (a first sign-in goes to `newUserTo`); a refusal comes back to /signin with an error the page
 * explains (lib/auth/signInOptions.ts). Not in Folevi's Mac and iOS apps yet: Google doesn't sign in inside
 * an app's own web view, so there the email form and passkeys stay.
 */
export function GoogleSignIn({ returnTo, newUserTo, error: initialError }: { returnTo: string; newUserTo?: string; error?: string }) {
  const [inApp, setInApp] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError);
  useEffect(() => setInApp(inIosApp() || desktop() !== null), []);
  if (inApp) return error ? <div className="mb-4"><Alert>{error}</Alert></div> : null;

  async function go() {
    if (busy) return;
    setError(undefined);
    setBusy(true);
    const { error: err } = await authClient.signIn.social({ provider: "google", callbackURL: returnTo, newUserCallbackURL: newUserTo ?? returnTo, errorCallbackURL: "/signin" });
    // On success the browser is already on its way to Google.
    if (err) {
      setBusy(false);
      setError(authErrorMessage(err));
    }
  }

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
