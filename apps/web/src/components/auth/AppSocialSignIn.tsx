"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { PROVIDER_NAMES, socialError, type SocialProvider } from "@/lib/auth/socialErrors";
import { appSignInRequestValid } from "@/lib/auth/appSignIn";
import { Alert, AuthHeading, SubmitButton } from "./fields";

type Props = {
  provider: SocialProvider;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  returned: boolean;
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
 * is the one the app gets, whoever this browser is already signed in as), then back here, where a one-time code
 * for the app is issued and handed over through the app's own folevi:// link. No choices on the way: the app's
 * own button already chose (lib/auth/appSignIn.ts names the apps it serves).
 */
export function AppSocialSignIn({ provider, clientId, redirectUri, codeChallenge, codeChallengeMethod, state, returned, error }: Props) {
  const name = PROVIDER_NAMES[provider];
  const valid = appSignInRequestValid({ clientId, redirectUri, codeChallenge, codeChallengeMethod });
  const [problem, setProblem] = useState<string | undefined>(socialError(error, provider));
  const [handedOver, setHandedOver] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!valid || started.current || error) return;
    started.current = true;
    void (async () => {
      if (!returned) {
        // The provider, and back to this page (with returned=1, or an error).
        const here = new URL(window.location.href);
        here.searchParams.set("returned", "1");
        const back = `${here.pathname}${here.search}`;
        const { error: err } = await authClient.signIn.social({ provider, callbackURL: back, errorCallbackURL: back });
        if (err) setProblem(authErrorMessage(err));
        return;
      }
      const { data, error: err } = await authClient.$fetch<{ code: string }>("/native/authorize", {
        method: "POST",
        body: { client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge, code_challenge_method: "S256" },
      });
      if (err || !data?.code) {
        setProblem(authErrorMessage(err ?? undefined, undefined, "a minute"));
        return;
      }
      setHandedOver(true);
      toApp(redirectUri, { code: data.code }, state);
    })();
  }, [valid, returned, error, provider, clientId, redirectUri, codeChallenge, state]);

  if (!valid) return <AuthHeading title="This link doesn't work" lede={`Start signing in with ${name} again from the Folevi app.`} />;
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
            toApp(redirectUri, { error: error ?? `${provider}_failed` }, state);
          }}
        >
          <SubmitButton busy={false}>Back to Folevi</SubmitButton>
        </form>
      </>
    );
  if (handedOver) return <AuthHeading title="Back to Folevi" lede="You're signed in. If Folevi didn't open by itself, switch back to it now. You can close this page." />;
  return (
    <div className="flex items-center gap-3 text-muted" role="status">
      <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden />
      Signing in with {name}…
    </div>
  );
}
