"use client";

import { useEffect, useState } from "react";
import { serverSignUp } from "@/lib/server-edition/signUp";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { Alert, AuthHeading, Field, PasswordField, SubmitButton, TextLink } from "./fields";
import { CheckInbox } from "./CheckInbox";
import { SocialSignIn } from "./SocialSignIn";
import { pendingTemplate, rememberTemplate, signUpCallback } from "@/lib/pendingTemplate";
import { websiteUrl } from "@/lib/env";
import { OPERATOR } from "@/components/marketing/site";

/** Folevi Server's refusals (CONTRACT §7.1), in words. */
const SERVER_SIGN_UP_ERRORS: Record<string, string> = {
  USER_ALREADY_EXISTS: "There's already an account with that email here. Sign in instead.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "There's already an account with that email here. Sign in instead.",
  SIGNUP_INVITE_ONLY: "This server is by invite only. Ask the person who runs it for an invite.",
  SIGNUP_DOMAIN: "This server only takes email addresses at certain domains. Use your work or family address, or ask for an invite.",
  INVITE_INVALID: "This invite doesn't work any more. Ask for a new one.",
  INVITE_OTHER_EMAIL: "This invite is for a different email address. Use the address it was sent to.",
};

/** Password guidance: length matters most; we only block what's too short or obviously weak. */
function passwordProblem(password: string, email: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 128) return "Use at most 128 characters.";
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && password.toLowerCase().includes(local)) return "Don't include your email address in your password.";
  if (/^(.)\1+$/.test(password)) return "Avoid a single repeated character.";
  return null;
}

/**
 * Folevi Server's sign-up (lib/edition.ts): the server's name in the heading, where to go next (an invite's page),
 * and whether the address is confirmed by email (only when the server sends email; otherwise the new account is
 * signed in at once).
 */
export interface ServerSignUp {
  serverName: string | null;
  returnTo?: string;
  email?: string;
  /** A `/join/<token>` invite: sent with the sign-up (`x-folevi-invite`, CONTRACT §7.1), which spends it. */
  inviteToken?: string;
  confirmByEmail: boolean;
}

export function SignUpForm({ template, social = { google: false, apple: false }, adding = false, server }: { template?: string; social?: { google: boolean; apple: boolean }; adding?: boolean; server?: ServerSignUp }) {
  // A template picked on folevi.com opens as the first page after sign-up (Shell), in this browser.
  useEffect(() => rememberTemplate(template), [template]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(server?.email ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ name?: string; email?: string; password?: string }>({});
  const [sentTo, setSentTo] = useState<string | null>(null);

  const offered = [social.apple ? "Apple" : null, social.google ? "Google" : null].filter(Boolean).join(" or ");
  const callbackURL = server?.returnTo ?? signUpCallback(template ?? pendingTemplate()?.key);
  if (sentTo) return <CheckInbox email={sentTo} callbackURL={callbackURL} />;
  const where = server?.serverName ? ` on ${server.serverName}` : "";
  const lede = server
    ? `Create your Folevi account${where}${offered ? ` with ${offered}, or with your email` : ""}.${server.confirmByEmail ? " We'll email you a link to confirm your address." : ""}`
    : offered
      ? `Create your Folevi account with ${offered}, or with your email (we'll email you a link to confirm it).`
      : "Create your Folevi account. We'll email you a link to confirm your address.";

  return (
    <>
      <AuthHeading title={server?.inviteToken && server.serverName ? `Join ${server.serverName}` : "Start writing"} lede={lede} />
      <SocialSignIn providers={social} returnTo={callbackURL} />
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
          // A server without email signs the new account in at once (no link to confirm): on to the next page.
          if (server && !server.confirmByEmail) {
            const { error: err } = await serverSignUp({ name: name.trim().slice(0, 80), email: trimmedEmail, password, callbackURL, inviteToken: server.inviteToken });
            if (err) {
              setBusy(false);
              setError(SERVER_SIGN_UP_ERRORS[err.code ?? ""] ?? authErrorMessage(err, undefined, "up to an hour"));
            } else window.location.assign(callbackURL);
            return;
          }
          const { error: err } = await authClient.signUp.email({
            name: name.trim().slice(0, 80),
            email: trimmedEmail,
            password,
            callbackURL,
            ...(server?.inviteToken ? { fetchOptions: { headers: { "x-folevi-invite": server.inviteToken } } } : {}),
          });
          setBusy(false);
          // An address that already has an account gets the same answer (no account enumeration).
          if (err?.code === "PASSWORD_COMPROMISED") {
            setFieldError({ password: authErrorMessage(err) });
            return;
          }
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
        {/* Folevi Cloud only: on a Folevi Server the person who runs it is the operator, not the company. */}
        <div className="space-y-1 text-footnote leading-relaxed text-muted" hidden={Boolean(server)}>
          <p>
            By creating an account you agree to the <TextLink href={`${websiteUrl()}/terms`}>Terms</TextLink> and{" "}
            <TextLink href={`${websiteUrl()}/privacy`}>Privacy Policy</TextLink>.
          </p>
          <p data-testid="signup-operator">
            Folevi is operated by <TextLink href={OPERATOR.url}>{OPERATOR.name}</TextLink>.
          </p>
        </div>
      </form>
      <p className="mt-6 text-subheadline text-muted">
        Already have an account? <TextLink href={adding ? "/signin?add=1" : server?.returnTo ? `/signin?returnTo=${encodeURIComponent(server.returnTo)}` : "/signin"}>Sign in</TextLink>
      </p>
    </>
  );
}
