"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { PROVIDER_NAMES, socialError, type SocialProvider } from "@/lib/auth/socialErrors";
import { appSignInRequestValid, appSignInReturned, clearAppSignInMark, markAppSignInStart } from "@/lib/auth/appSignIn";
import { nativeClient } from "../../../../../convex/lib/nativeClients";
import { Alert, AuthHeading, SubmitButton } from "./fields";

type Props = {
  provider: SocialProvider;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  /** The value the page sent round the provider itself ("" on a fresh start). Never trusted on its own. */
  returned: string;
  error?: string;
};

/** Back to the app with the result (only ever to a registered return address). */
function toApp(redirectUri: string, params: Record<string, string>, state: string) {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (state) url.searchParams.set("state", state);
  window.location.assign(url.toString());
}

/**
 * In the browser the Mac or iOS app opened: straight on to Google or Apple (always, so the account picked there
 * is the one the app gets, whoever this browser is already signed in as), then back here. Back here the page
 * says who the app will be signed in as and waits for Continue, as /connect does (components/auth/ConnectApp.tsx):
 * only that press issues the one-time code and hands it over through the app's own folevi:// link. A link that
 * only says it is back from the provider is a fresh start (lib/auth/appSignIn.ts), so no address by itself can
 * make this page issue a code.
 */
export function AppSocialSignIn({ provider, clientId, redirectUri, codeChallenge, codeChallengeMethod, state, returned, error }: Props) {
  const name = PROVIDER_NAMES[provider];
  const valid = appSignInRequestValid({ clientId, redirectUri, codeChallenge, codeChallengeMethod });
  const client = nativeClient(clientId, redirectUri);
  const { data: session, isPending } = authClient.useSession();
  const [problem, setProblem] = useState<string | undefined>(socialError(error, provider));
  const [phase, setPhase] = useState<"leaving" | "confirm" | "handedOver">("leaving");
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!valid || started.current || error) return;
    started.current = true;
    void (async () => {
      // Back from a trip this tab started itself: ask before anything is issued.
      if (appSignInReturned(returned, codeChallenge)) {
        setPhase("confirm");
        return;
      }
      // The provider, and back to this page carrying the value this tab just noted (or an error).
      const mark = markAppSignInStart(codeChallenge);
      if (!mark) {
        setProblem("This browser is blocking the storage this sign-in needs. Try again in a normal window, not a private one.");
        return;
      }
      const here = new URL(window.location.href);
      here.searchParams.set("returned", mark);
      const back = `${here.pathname}${here.search}`;
      const { error: err } = await authClient.signIn.social({ provider, callbackURL: back, errorCallbackURL: back });
      if (err) setProblem(authErrorMessage(err));
    })();
  }, [valid, returned, error, provider, codeChallenge]);

  if (!valid || !client) return <AuthHeading title="This link doesn't work" lede={`Start signing in with ${name} again from the Folevi app.`} />;
  if (problem)
    return (
      <>
        <AuthHeading title={`Couldn't sign in with ${name}`} />
        <div className="mb-4">
          <Alert>{problem}</Alert>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            clearAppSignInMark();
            toApp(redirectUri, { error: error ?? `${provider}_failed` }, state);
          }}
        >
          <SubmitButton busy={false}>Back to Folevi</SubmitButton>
        </form>
      </>
    );
  if (phase === "handedOver") return <AuthHeading title="Back to Folevi" lede="You're signed in. If Folevi didn't open by itself, switch back to it now. You can close this page." />;
  if (phase === "confirm") {
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
              `Signing in with ${name} didn't finish. Start again from the Folevi app.`
            )
          }
        />
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || !email) return;
            setBusy(true);
            const { data, error: err } = await authClient.$fetch<{ code: string }>("/native/authorize", {
              method: "POST",
              body: { client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge, code_challenge_method: "S256" },
            });
            if (err || !data?.code) {
              setBusy(false);
              setProblem(authErrorMessage(err ?? undefined, undefined, "a minute"));
              return;
            }
            clearAppSignInMark();
            setPhase("handedOver");
            toApp(redirectUri, { code: data.code }, state);
          }}
        >
          <SubmitButton busy={busy} disabled={isPending || !email}>
            <span className="min-w-0 truncate">{email ? `Continue as ${email}` : "Continue"}</span>
          </SubmitButton>
          <button
            type="button"
            className="ui-btn h-control w-full text-body"
            disabled={busy}
            onClick={() => {
              clearAppSignInMark();
              toApp(redirectUri, { error: "access_denied" }, state);
            }}
          >
            Cancel
          </button>
        </form>
      </>
    );
  }
  return (
    <div className="flex items-center gap-3 text-muted" role="status">
      <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden />
      Signing in with {name}…
    </div>
  );
}
