"use client";

import { useEffect, useRef, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { passkeyAutofillAvailable, passkeysAvailable } from "@/lib/auth/passkeys";
import { Alert, AuthHeading, Field, PasswordField, SubmitButton, TextLink, safeReturnTo } from "./fields";

const CANCELLED = new Set(["AUTH_CANCELLED", "ERROR_CEREMONY_ABORTED", "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY"]);

export function SignInForm({ returnTo, notice }: { returnTo?: string; notice?: string }) {
  const destination = safeReturnTo(returnTo);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [passkeys, setPasskeys] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const mounted = useRef(true);

  // Passkeys: a button, and (where the browser supports it) the passkeys saved for Folevi offered in the
  // email field's autofill. Both end in the same sign-in; a passkey skips the password and the code step
  // (see convex/auth.ts for who still needs the code).
  useEffect(() => {
    mounted.current = true;
    void passkeysAvailable().then((ok) => mounted.current && setPasskeys(ok));
    void passkeyAutofillAvailable().then(async (ok) => {
      if (!ok || !mounted.current) return;
      const { data, error: err } = await authClient.signIn.passkey({ autoFill: true });
      if (!mounted.current) return;
      if (data && !err) window.location.assign(destination);
      else if (err && !CANCELLED.has((err as { code?: string }).code ?? "")) setError(authErrorMessage(err));
    });
    return () => {
      mounted.current = false;
    };
  }, [destination]);

  async function signInWithPasskey() {
    if (passkeyBusy || busy) return;
    setError(null);
    setUnverified(false);
    setPasskeyBusy(true);
    const { data, error: err } = await authClient.signIn.passkey();
    if (data && !err) {
      window.location.assign(destination);
      return;
    }
    setPasskeyBusy(false);
    if (err) setError(authErrorMessage(err, undefined, "a minute"));
  }

  return (
    <>
      <AuthHeading title="Welcome back" lede="Sign in with your email and password." />
      {notice ? (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      ) : null}
      <form
        className="space-y-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setError(null);
          setUnverified(false);
          if (!email.trim() || !password) {
            setError("Enter your email and password.");
            return;
          }
          setBusy(true);
          const { data, error: err } = await authClient.signIn.email({
            email: email.trim(),
            password,
            callbackURL: destination,
          });
          if (err) {
            setBusy(false);
            if (err.code === "EMAIL_NOT_VERIFIED") setUnverified(true);
            else setError(authErrorMessage(err));
            return;
          }
          const redirect = data as { twoFactorRedirect?: boolean } | null;
          if (redirect?.twoFactorRedirect) {
            window.location.assign(`/two-factor?returnTo=${encodeURIComponent(destination)}`);
            return;
          }
          window.location.assign(destination);
        }}
      >
        {error ? <Alert>{error}</Alert> : null}
        {unverified ? (
          <Alert tone="info">
            Verify your email address first. We&apos;ve sent a fresh link to <strong>{email.trim()}</strong>. Open it on this device to continue.
          </Alert>
        ) : null}
        <Field label="Email" type="email" name="email" autoComplete="username webauthn" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <PasswordField label="Password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="flex justify-end">
          <TextLink href="/forgot-password">Forgot your password?</TextLink>
        </div>
        <SubmitButton busy={busy}>Sign in</SubmitButton>
      </form>
      {passkeys ? (
        <>
          <div className="my-4 flex items-center gap-3 text-xs text-muted" aria-hidden>
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          <button type="button" onClick={() => void signInWithPasskey()} disabled={passkeyBusy || busy} aria-busy={passkeyBusy} className="ui-btn ui-btn-secondary h-11 w-full text-[15px]">
            {passkeyBusy ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <KeyRound size={16} aria-hidden />}
            Sign in with a passkey
          </button>
        </>
      ) : null}
      <p className="mt-6 text-sm text-muted">
        New to Folevi? <TextLink href="/signup">Create an account</TextLink>
      </p>
    </>
  );
}
