"use client";

import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { Alert, AuthHeading, Field, PasswordField, SubmitButton, TextLink, safeReturnTo } from "./fields";

export function SignInForm({ returnTo, notice }: { returnTo?: string; notice?: string }) {
  const destination = safeReturnTo(returnTo);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);

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
            Verify your email address first — we&apos;ve sent a fresh link to <strong>{email.trim()}</strong>. Open it on this device to continue.
          </Alert>
        ) : null}
        <Field label="Email" type="email" name="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <PasswordField label="Password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="flex justify-end">
          <TextLink href="/forgot-password">Forgot your password?</TextLink>
        </div>
        <SubmitButton busy={busy}>Sign in</SubmitButton>
      </form>
      <p className="mt-6 text-sm text-muted">
        New to Folevi? <TextLink href="/signup">Create an account</TextLink>
      </p>
    </>
  );
}
