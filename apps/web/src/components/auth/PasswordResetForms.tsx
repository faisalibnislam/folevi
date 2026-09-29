"use client";

import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { Alert, AuthHeading, Field, PasswordField, SubmitButton, TextLink } from "./fields";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <AuthHeading title="Reset your password" lede="Enter the email address on your account. We'll send a link to choose a new password." />
      {done ? (
        <Alert tone="success">
          If an account exists for <strong>{email.trim()}</strong>, a reset link is on its way. It expires in one hour and works once.
        </Alert>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || !email.trim()) return;
            setBusy(true);
            setError(null);
            const { error: err } = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password" });
            setBusy(false);
            // Same answer whether or not the account exists; only rate limiting is reported.
            if (err && err.status === 429) setError(authErrorMessage(err, undefined, "up to 15 minutes"));
            else setDone(true);
          }}
        >
          {error ? <Alert>{error}</Alert> : null}
          <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <SubmitButton busy={busy}>Send reset link</SubmitButton>
        </form>
      )}
      <p className="mt-6 text-sm text-muted">
        Remembered it? <TextLink href="/signin">Sign in</TextLink>
      </p>
    </>
  );
}

export function ResetPasswordForm({ token, linkError }: { token: string | null; linkError?: string | null }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!token || linkError) {
    return (
      <>
        <AuthHeading title="This link can't be used" lede="Reset links expire after an hour and work only once." />
        <p className="text-sm">
          <TextLink href="/forgot-password">Request a new reset link</TextLink>
        </p>
      </>
    );
  }
  if (done) {
    return (
      <>
        <AuthHeading title="Password changed" lede="For your security, every other device has been signed out. Sign in with your new password." />
        <a href="/signin" className="ui-btn ui-btn-primary h-11 w-full text-[15px]">
          Sign in
        </a>
      </>
    );
  }
  return (
    <>
      <AuthHeading title="Choose a new password" lede="If you use two-step verification, you'll still need your authenticator app to sign in." />
      <form
        className="space-y-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          if (password.length < 10) return setError("Use at least 10 characters.");
          if (password !== confirm) return setError("The two passwords don't match.");
          setBusy(true);
          setError(null);
          const { error: err } = await authClient.resetPassword({ newPassword: password, token });
          setBusy(false);
          if (err) setError(authErrorMessage(err, undefined, "up to an hour"));
          else setDone(true);
        }}
      >
        {error ? <Alert>{error}</Alert> : null}
        <PasswordField label="New password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 10 characters." autoFocus />
        <PasswordField label="Repeat new password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <SubmitButton busy={busy}>Change password</SubmitButton>
      </form>
    </>
  );
}
