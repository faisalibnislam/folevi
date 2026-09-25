"use client";

import { useConvexAuth, useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/convex/api";
import { AppStateProvider, FullPageMessage, useMeQuery } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { Button } from "@/components/ui/Button";
import { errorMessage } from "@/components/ui/Toast";
import { clearAllLocalData } from "@/lib/sync/db";
import { Shell } from "./Shell";
import { Onboarding } from "./Onboarding";

function SignOutButton({ label = "Sign out" }: { label?: string }) {
  return (
    <form
      action="/signout"
      method="post"
      onSubmit={() => {
        void clearAllLocalData();
      }}
    >
      <Button type="submit" variant="secondary">
        {label}
      </Button>
    </form>
  );
}

/** Routes the signed-in person through the account states the backend reports before showing the app. */
export function AccountGate() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useMeQuery();
  const bootstrap = useMutation(api.users.bootstrap);
  const [bootError, setBootError] = useState<string | null>(null);
  const started = useRef(false);
  const { route } = useAppRouter();

  useEffect(() => {
    if (me?.state !== "needs_bootstrap" || started.current) return;
    started.current = true;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    bootstrap({ timeZone, locale: (navigator.language || "en").slice(0, 5) }).catch((e) => setBootError(errorMessage(e)));
  }, [me?.state, bootstrap]);

  if (!isLoading && !isAuthenticated) {
    return (
      <FullPageMessage title="Your session has ended" body="Sign in again to keep writing. Anything you wrote offline is still on this device.">
        <a className="inline-flex h-9 items-center rounded-[7px] bg-accent px-4 text-sm font-medium text-accent-ink" href={`/signin?returnTo=${encodeURIComponent(location.pathname)}`}>
          Sign in
        </a>
      </FullPageMessage>
    );
  }
  if (me === undefined) return <FullPageMessage title="Opening your folio…" busy />;
  switch (me.state) {
    case "signed_out":
      return <FullPageMessage title="Opening your folio…" busy />;
    case "email_unverified":
      return (
        <FullPageMessage
          title="Verify your email to continue"
          body="We sent a verification link to your inbox. Open it, then sign in again. The link expires, so request a new one if it doesn't arrive."
        >
          <div className="flex gap-2">
            <a className="inline-flex h-9 items-center rounded-[7px] bg-accent px-4 text-sm font-medium text-accent-ink" href="/verify-email">
              Resend the link
            </a>
            <SignOutButton />
          </div>
        </FullPageMessage>
      );
    case "mfa_required":
      return (
        <FullPageMessage
          title="Two-step verification is required"
          body="Folevi requires an authenticator app for every account. Sign in again to set it up — it takes about a minute."
        >
          <SignOutButton label="Sign in again" />
        </FullPageMessage>
      );
    case "suspended":
      return (
        <FullPageMessage title="This account is suspended" body="If you think this is a mistake, write to support@folevi.com from the address on your account.">
          <SignOutButton />
        </FullPageMessage>
      );
    case "session_revoked":
      return (
        <FullPageMessage title="This session was signed out" body="You (or an administrator acting on your request) ended this session from another device.">
          <SignOutButton label="Sign in again" />
        </FullPageMessage>
      );
    case "needs_bootstrap":
      return bootError ? (
        <FullPageMessage title="We couldn't finish setting up" body={bootError}>
          <Button variant="primary" onClick={() => location.reload()}>
            Try again
          </Button>
        </FullPageMessage>
      ) : (
        <FullPageMessage title="Setting up your folio…" body="Creating your personal workspace and a few pages to start from." busy />
      );
    case "ready":
      return (
        <AppStateProvider profile={me.profile}>
          {me.profile.onboardingStep !== "done" || route.name === "onboarding" ? <Onboarding /> : <Shell />}
        </AppStateProvider>
      );
  }
}
