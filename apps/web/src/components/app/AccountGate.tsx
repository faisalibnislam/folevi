"use client";

import { useConvexAuth, useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/convex/api";
import { useAuthPhase } from "@/lib/convex/provider";
import { authClient } from "@/lib/auth/client";
import { AppStateProvider, FullPageMessage, useMeQuery } from "@/lib/app/state";
import { loadAccountSnapshot, type AccountSnapshot } from "@/lib/app/offlineSnapshot";
import { useAppRouter } from "@/lib/app/router";
import { Button } from "@/components/ui/Button";
import { errorMessage } from "@/components/ui/Toast";
import { SignOutButton, signOutNow } from "@/components/auth/SignOut";
import { Shell } from "./Shell";
import { Onboarding } from "./Onboarding";
import { DeviceLimitScreen } from "./DeviceLimit";

function currentPath(): string {
  return typeof window === "undefined" ? "/documents" : `${window.location.pathname}${window.location.search}`;
}

/** Routes the signed-in person through the account states the backend reports before showing the app. */
export function AccountGate() {
  const phase = useAuthPhase();
  const { isLoading } = useConvexAuth();
  const me = useMeQuery();
  const bootstrap = useMutation(api.users.bootstrap);
  const [bootError, setBootError] = useState<string | null>(null);
  const started = useRef(false);
  const { route } = useAppRouter();
  // The product uses neutral chrome so the notes carry the colour (globals.css, data-chrome).
  useEffect(() => {
    document.documentElement.dataset.chrome = "neutral";
    return () => {
      delete document.documentElement.dataset.chrome;
    };
  }, []);
  // Offline cold start: the server can't be reached, so open the last-known folio from this device.
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null | undefined>(undefined);
  const offlineStart = phase === "offline" && me === undefined;
  useEffect(() => {
    if (offlineStart && snapshot === undefined) void loadAccountSnapshot().then(setSnapshot);
  }, [offlineStart, snapshot]);

  useEffect(() => {
    if (me?.state !== "needs_bootstrap" || started.current) return;
    started.current = true;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    bootstrap({ timeZone, locale: (navigator.language || "en").slice(0, 5) }).catch((e) => setBootError(errorMessage(e)));
  }, [me?.state, bootstrap]);

  // The server says there is no session (signed out elsewhere, revoked, expired): go sign in. Work
  // written offline stays on this device and syncs after signing back in to the same account.
  useEffect(() => {
    if (phase === "signed_out") window.location.replace(`/signin?notice=session_ended&returnTo=${encodeURIComponent(currentPath())}`);
  }, [phase]);

  // The token's session is gone. Changing the password (or finishing a re-authentication) replaces the
  // session with a new one for this browser; the auth bridge then fetches a token for the new session and
  // `me` recovers by itself. Only when no live session exists do we sign out; if one exists but the
  // backend still disagrees after a few seconds, reload as a last resort.
  useEffect(() => {
    if (me?.state !== "session_revoked") return;
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        const { data } = await authClient.getSession({ query: { disableCookieCache: true } });
        if (data?.session) {
          await new Promise((r) => setTimeout(r, 4000));
          if (!cancelled) window.location.reload();
          return;
        }
        await new Promise((r) => setTimeout(r, 700));
      }
      if (!cancelled) await signOutNow(`/signin?notice=session_ended&returnTo=${encodeURIComponent(currentPath())}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [me?.state]);

  if (phase === "signed_out") return <FullPageMessage title="Taking you to sign in…" busy />;
  if (offlineStart && snapshot === undefined) return <FullPageMessage title="Opening your folio…" busy />;
  if (offlineStart && snapshot) {
    return (
      <AppStateProvider profile={snapshot.profile} offlineWorkspaces={snapshot.workspaces}>
        <Shell />
      </AppStateProvider>
    );
  }
  if (offlineStart) {
    return (
      <FullPageMessage
        title="You're offline"
        body="Folevi can't reach the server right now. Anything you wrote on this device is safe and will sync when you're back online."
      >
        <Button variant="primary" onClick={() => location.reload()}>
          Try again
        </Button>
      </FullPageMessage>
    );
  }
  if (me === undefined || isLoading) return <FullPageMessage title="Opening your folio…" busy />;
  switch (me.state) {
    case "signed_out":
      return <FullPageMessage title="Taking you to sign in…" busy />;
    case "session_revoked":
      return <FullPageMessage title="Checking your session…" busy />;
    case "email_unverified":
      return (
        <FullPageMessage title="Confirm your email to continue" body="Open the confirmation link we emailed you. It expires in 24 hours and works once.">
          <div className="flex gap-2">
            <a className="ui-btn ui-btn-primary h-9 px-4 text-sm" href="/verify-email">
              Send a new link
            </a>
            <SignOutButton accountKey={null} />
          </div>
        </FullPageMessage>
      );
    case "suspended":
      return (
        <FullPageMessage title="This account is suspended" body="If you think this is a mistake, write to support@folevi.com from the address on your account.">
          <SignOutButton accountKey={null} />
        </FullPageMessage>
      );
    case "device_limit":
      return <DeviceLimitScreen limit={me.limit} />;
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
