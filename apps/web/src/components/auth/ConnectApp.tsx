"use client";

import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { nativeClient } from "../../../../../convex/lib/nativeClients";
import { Alert, AuthHeading, SubmitButton } from "./fields";

type Props = { clientId: string; redirectUri: string; codeChallenge: string; codeChallengeMethod: string; state: string };

/** Back to the app with the result (only ever to a registered redirect URI). */
function returnToApp(redirectUri: string, params: Record<string, string>, state: string) {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (state) url.searchParams.set("state", state);
  window.location.assign(url.toString());
}

/** "Sign in to Folevi for Mac as …?" — issues a one-time code for the app after an explicit Continue. */
export function ConnectApp({ clientId, redirectUri, codeChallenge, codeChallengeMethod, state }: Props) {
  const client = nativeClient(clientId, redirectUri);
  const { data: session, isPending } = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!client || codeChallengeMethod !== "S256" || !codeChallenge) {
    return (
      <>
        <AuthHeading title="This link doesn't work" lede="Start signing in again from the Folevi app." />
      </>
    );
  }

  if (done) {
    return (
      <>
        <AuthHeading title={`Back to ${client.label}`} lede={`You're signed in. If ${client.label} didn't open by itself, switch back to it now — you can close this page.`} />
      </>
    );
  }

  const email = session?.user.email;
  return (
    <>
      <AuthHeading
        title={`Sign in to ${client.label}`}
        lede={
          isPending ? (
            "Checking who's signed in…"
          ) : email ? (
            <>
              {client.label} will be signed in as <strong className="text-ink">{email}</strong>, and will show up in Settings → Devices, where you can sign it out.
            </>
          ) : (
            "Your session has ended. Sign in again to continue."
          )
        }
      />
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !email) return;
          setBusy(true);
          setError(null);
          const { data, error: err } = await authClient.$fetch<{ code: string }>("/native/authorize", {
            method: "POST",
            body: { client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge, code_challenge_method: codeChallengeMethod },
          });
          if (err || !data?.code) {
            setBusy(false);
            setError(authErrorMessage(err as { code?: string; message?: string; status?: number } | null, "Couldn't sign in the app. Try again from the app."));
            return;
          }
          setDone(true);
          returnToApp(redirectUri, { code: data.code }, state);
        }}
      >
        {error ? <Alert>{error}</Alert> : null}
        <SubmitButton busy={busy} disabled={isPending || !email}>
          Continue
        </SubmitButton>
        <button
          type="button"
          className="ui-btn h-11 w-full text-[15px]"
          disabled={busy}
          onClick={() => returnToApp(redirectUri, { error: "access_denied" }, state)}
        >
          Cancel
        </button>
      </form>
      {!isPending && !email ? (
        <p className="mt-6 text-sm text-muted">
          <button
            type="button"
            className="font-medium text-accent underline underline-offset-2"
            onClick={async () => {
              // A stale session cookie would send /signin straight back here; clear it first.
              await authClient.signOut().catch(() => undefined);
              window.location.assign(`/signin?returnTo=${encodeURIComponent(`/connect${window.location.search}`)}`);
            }}
          >
            Sign in again
          </button>
        </p>
      ) : null}
    </>
  );
}
