"use client";

import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { Alert, AuthHeading, Field, PasswordField, SubmitButton, TextLink } from "./fields";
import { CheckInbox } from "./CheckInbox";

/** Password guidance: length matters most; we only block what's too short or obviously weak. */
function passwordProblem(password: string, email: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 128) return "Use at most 128 characters.";
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && password.toLowerCase().includes(local)) return "Don't include your email address in your password.";
  if (/^(.)\1+$/.test(password)) return "Avoid a single repeated character.";
  return null;
}

export function SignUpForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ name?: string; email?: string; password?: string }>({});
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (sentTo) return <CheckInbox email={sentTo} />;

  return (
    <>
      <AuthHeading title="Start writing" lede="Create your Folevi account. We'll email you a link to confirm your address." />
      <form
        className="space-y-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setError(null);
          const trimmedEmail = email.trim();
          const problems: typeof fieldError = {};
          if (!name.trim()) problems.name = "Tell us what to call you.";
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) problems.email = "Enter a valid email address.";
          const pw = passwordProblem(password, trimmedEmail);
          if (pw) problems.password = pw;
          setFieldError(problems);
          if (Object.keys(problems).length) return;
          setBusy(true);
          const { error: err } = await authClient.signUp.email({
            name: name.trim().slice(0, 80),
            email: trimmedEmail,
            password,
            callbackURL: "/documents",
          });
          setBusy(false);
          // An address that already has an account gets the same answer (no account enumeration).
          if (err && err.code !== "USER_ALREADY_EXISTS" && err.code !== "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
            setError(authErrorMessage(err, undefined, "up to an hour"));
            return;
          }
          setSentTo(trimmedEmail);
        }}
      >
        {error ? <Alert>{error}</Alert> : null}
        <Field label="Your name" name="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} error={fieldError.name} autoFocus />
        <Field label="Email" type="email" name="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={fieldError.email} />
        <PasswordField
          label="Password"
          name="new-password"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="At least 10 characters. A few unrelated words make a strong, memorable password."
          error={fieldError.password}
        />
        <SubmitButton busy={busy}>Create account</SubmitButton>
        <p className="text-xs leading-relaxed text-muted">
          By creating an account you agree to the <TextLink href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? ""}/terms`}>Terms</TextLink> and{" "}
          <TextLink href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? ""}/privacy`}>Privacy Policy</TextLink>.
        </p>
      </form>
      <p className="mt-6 text-sm text-muted">
        Already have an account? <TextLink href="/signin">Sign in</TextLink>
      </p>
    </>
  );
}
