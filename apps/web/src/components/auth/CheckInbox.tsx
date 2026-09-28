"use client";

import { useState } from "react";
import { MailCheck } from "lucide-react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { Alert, AuthHeading, Field, SubmitButton, TextLink } from "./fields";

/** "Check your inbox" + resend. Answers the same whether or not an account exists for the address. */
export function CheckInbox({ email: initialEmail }: { email?: string }) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  return (
    <>
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-[6px] bg-ember-soft text-ember-ink" aria-hidden>
        <MailCheck size={22} />
      </div>
      <AuthHeading
        title="Check your inbox"
        lede={
          initialEmail ? (
            <>
              We sent a confirmation link to <strong className="text-ink">{initialEmail}</strong>. Open it on this device to continue — it expires in 24 hours
              and works once.
            </>
          ) : (
            "Open the confirmation link we emailed you to continue. It expires in 24 hours and works once."
          )
        }
      />
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !email.trim()) return;
          setBusy(true);
          setMessage(null);
          const { error } = await authClient.sendVerificationEmail({ email: email.trim(), callbackURL: "/two-factor/setup" });
          setBusy(false);
          if (error && error.status === 429) setMessage({ tone: "error", text: authErrorMessage(error) });
          else setMessage({ tone: "success", text: "If that address has an account waiting for confirmation, a new link is on its way." });
        }}
      >
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
        {initialEmail ? null : <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        <SubmitButton busy={busy}>Send a new link</SubmitButton>
      </form>
      <p className="mt-6 text-sm text-muted">
        Already confirmed? <TextLink href="/signin">Sign in</TextLink>
      </p>
    </>
  );
}
