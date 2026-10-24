"use client";

import { useConvexAuth, useMutation } from "convex/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { api } from "@/lib/convex/api";
import { useAuthPhase } from "@/lib/convex/provider";
import { authClient } from "@/lib/auth/client";
import { hostAuth, websitePage } from "@/lib/auth/shellFetch";
import { forgetThisDevice } from "@/lib/nativeDevice";
import {
  AppStateProvider,
  FullPageMessage,
  useMeQuery,
  type Profile,
  type Workspace,
} from "@/lib/app/state";
import {
  loadAccountSnapshot,
  loadStartSnapshot,
  type AccountSnapshot,
} from "@/lib/app/offlineSnapshot";
import { useAppRouter } from "@/lib/app/router";
import { Button } from "@/components/ui/Button";
import { errorMessage } from "@/components/ui/Toast";
import { SignOutButton, signOutNow } from "@/components/auth/SignOut";
import { Shell } from "./Shell";
import { DeviceLimitScreen } from "./DeviceLimit";
import { DesktopQuickAdd } from "./DesktopQuickAdd";
import { OauthConsent } from "./OauthConsent";
import { ShareSheet } from "./ShareSheet";
import { MigrationGate } from "@/components/migrate/MigrationGate";
import { ShellSignIn } from "./ShellSignIn";
import { ShellUpdateGate } from "./ShellUpdateGate";
import { E2eeGate } from "@/components/e2ee/E2eeGate";
import { getConvexClient } from "@/lib/convex/provider";
import { convexKeysServer, startKeySession } from "@/lib/e2ee/keys";
import { deviceId as loadDeviceId } from "@/lib/sync/db";
import { adoptNextSignIn, isPlaceRunner, pinnedUserId } from "@/lib/places/pin";
import { accountPlaceId, forgetAccount } from "@/lib/places/registry";
import { openPlaceInTab, signedInAccounts, signOutOfAccount } from "@/lib/places/web";
import { PlacesReporter } from "@/components/places/PlacesReporter";
import { PlaceSync, reportToParent } from "@/components/places/PlaceSync";
import { PlaceMoveGate } from "@/components/places/MovePlaces";

// Seen once per account, so it loads only for people who haven't finished it.
const Onboarding = lazy(() => import("./Onboarding").then((m) => ({ default: m.Onboarding })));

function currentPath(): string {
  return typeof window === "undefined"
    ? "/documents"
    : `${window.location.pathname}${window.location.search}`;
}

/** Routes the signed-in person through the account states the backend reports before showing the app. */
export function AccountGate() {
  const reported = useAuthPhase();
  // The second check below couldn't confirm "no session" (no answer, a server error): carry on offline.
  const [unconfirmed, setUnconfirmed] = useState(false);
  const phase = reported === "signed_out" && unconfirmed ? "offline" : reported;
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
  // (Signed out as far as the backend can tell, because it got no token while the session check had no
  // definite answer: the same, since only the auth server can say the session ended.)
  const offlineStart = phase === "offline" && (me === undefined || me?.state === "signed_out");
  useEffect(() => {
    if (offlineStart && snapshot === undefined) void loadAccountSnapshot().then(setSnapshot);
  }, [offlineStart, snapshot]);
  // A warm start in the apps (docs/IOS_PERFORMANCE.md): the last-known folio opens at once from this device
  // (its lists from the query cache) while the session is checked and the server connects, instead of
  // "Opening your folio…" until the server answers. The server's answer then takes over in place; anything but
  // "ready" (signed out, revoked, a device limit) replaces it as before.
  const [start, setStart] = useState<AccountSnapshot | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadStartSnapshot().then((s) => live && setStart(s));
    return () => {
      live = false;
    };
  }, []);
  const waiting = phase !== "signed_out" && (me === undefined || isLoading || offlineStart);
  const warm = waiting && start ? start : null;
  // Once the folio is on screen from the snapshot it stays the same tree (offline too), so nothing remounts.
  const warmed = useRef(false);
  if (warm) warmed.current = true;

  useEffect(() => {
    if (me?.state !== "needs_bootstrap" || started.current) return;
    started.current = true;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    bootstrap({ timeZone, locale: (navigator.language || "en").slice(0, 5) }).catch((e) =>
      setBootError(errorMessage(e)),
    );
  }, [me?.state, bootstrap]);

  // The server says there is no session (signed out elsewhere, revoked, expired): go sign in. Work
  // written offline stays on this device and syncs after signing back in to the same account.
  useEffect(() => {
    if (reported !== "signed_out") {
      setUnconfirmed(false);
      return;
    }
    // A background runner whose account ended says so to the page running it, and leaves the cookies to that page.
    if (isPlaceRunner()) {
      const id = pinnedUserId();
      if (id) reportToParent({ userId: id, unread: 0, waiting: 0, fresh: [], signedOut: true });
      return;
    }
    let cancelled = false;
    const go = (others = false) =>
      window.location.replace(
        `/signin?notice=session_ended${others ? "&add=1" : ""}&returnTo=${encodeURIComponent(currentPath())}`,
      );
    const withTimeout = <T,>(p: Promise<T>) =>
      Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
    void (async () => {
      // Check once more before acting: a server hiccup (5xx, rate limit) also ends up here, and must never
      // sign anyone out. Only a definite "no session" drops the dead cookie (keeping this device's notes),
      // so the sign-in and sign-up pages don't take it for a live session and bounce back here.
      const check = await withTimeout(
        authClient.getSession({ query: { disableCookieCache: true } }).catch(() => null),
      );
      if (cancelled) return;
      if (check?.data?.session) {
        window.location.reload();
        return;
      }
      const status = (check?.error as { status?: number } | null | undefined)?.status;
      const definite = check !== null && (!check.error || status === 401 || status === 403);
      // No definite answer (the server is unreachable, or failing): never sign out because the network
      // failed. The app opens from this device's copy and its sync status says it's offline.
      if (!definite) {
        setUnconfirmed(true);
        return;
      }
      // The iOS app's widgets and extensions stop using this account too.
      await forgetThisDevice();
      // The apps' built-in interface has no cookie to drop: its sign-in screen stays up, and signing in
      // replaces whatever session the host still held (and ends it). Calling the host's signOut here would
      // also cancel a sign-in the person may already have started from that screen.
      if (hostAuth()) return;
      // Several accounts in one browser (docs/MULTI_ACCOUNT_PLAN.md §2.1): only this tab's account ended. Its
      // cookies go; every other account stays signed in. (Better Auth's own sign-out would end them all.)
      const pinned = pinnedUserId();
      const others =
        (await withTimeout(signedInAccounts()))?.filter((a) => a.userId !== pinned) ?? [];
      if (pinned) {
        await withTimeout(signOutOfAccount(pinned));
        forgetAccount(pinned);
      } else if (others.length) {
        // A tab on the browser's active session, which ended: another account is still here.
        openPlaceInTab(accountPlaceId(others[0]!.userId));
        return;
      } else {
        await withTimeout(authClient.signOut().catch(() => undefined));
      }
      // Signing in again opens that account in this tab.
      adoptNextSignIn();
      go(others.length > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [reported]);

  // The token's session is gone. Changing the password (or finishing a re-authentication) replaces the
  // session with a new one for this browser; the auth bridge then fetches a token for the new session and
  // `me` recovers by itself. Only when no live session exists do we sign out; if one exists but the
  // backend still disagrees after a few seconds, reload as a last resort.
  useEffect(() => {
    if (me?.state !== "session_revoked" || isPlaceRunner()) return;
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
      if (!cancelled)
        await signOutNow(
          `/signin?notice=session_ended&returnTo=${encodeURIComponent(currentPath())}`,
        );
    })();
    return () => {
      cancelled = true;
    };
  }, [me?.state]);

  if (phase === "signed_out")
    return hostAuth() ? <ShellSignIn /> : <FullPageMessage title="Taking you to sign in…" busy />;
  const ready = me?.state === "ready" && !isLoading ? me.profile : null;
  if (warm || (warmed.current && ready)) {
    const profile = ready ?? warm!.profile;
    return (
      <ReadyApp
        key={profile.id}
        profile={profile}
        offlineWorkspaces={ready ? undefined : warm!.workspaces}
        route={route.name}
      />
    );
  }
  if (offlineStart && snapshot === undefined)
    return <FullPageMessage title="Opening your folio…" busy />;
  if (offlineStart && snapshot) {
    return (
      <AppStateProvider profile={snapshot.profile} offlineWorkspaces={snapshot.workspaces}>
        {route.name === "share" ? (
          <ShareSheet />
        ) : route.name === "quick-add" && snapshot.profile.onboardingStep === "done" ? (
          <DesktopQuickAdd />
        ) : (
          <Shell />
        )}
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
      return hostAuth() ? <ShellSignIn /> : <FullPageMessage title="Taking you to sign in…" busy />;
    case "session_revoked":
      return <FullPageMessage title="Checking your session…" busy />;
    case "email_unverified":
      return (
        <FullPageMessage
          title="Confirm your email to continue"
          body="Open the confirmation link we emailed you. It expires in 24 hours and works once."
        >
          <div className="flex gap-2">
            <a
              className="ui-btn ui-btn-primary h-9 px-4 text-sm"
              href={websitePage("/verify-email")}
            >
              Send a new link
            </a>
            <SignOutButton accountKey={null} />
          </div>
        </FullPageMessage>
      );
    case "suspended":
      return (
        <FullPageMessage
          title="This account is suspended"
          body="If you think this is a mistake, write to support@folevi.com from the address on your account."
        >
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
        <FullPageMessage
          title="Setting up your folio…"
          body="Setting up your Personal space with a few pages to start from."
          busy
        />
      );
    case "ready":
      return <ReadyApp key={me.profile.id} profile={me.profile} route={route.name} />;
  }
}

/** The signed-in app, for the server's profile (or, on a warm start, the last-known one from this device). */
function ReadyApp({
  profile,
  offlineWorkspaces,
  route,
}: {
  profile: Profile;
  offlineWorkspaces?: Workspace[];
  route: string;
}) {
  return (
    <ShellUpdateGate>
      <KeySessionStarter profileId={profile.id} email={profile.email ?? undefined} />
      <AppStateProvider profile={profile} offlineWorkspaces={offlineWorkspaces}>
        <PlacesReporter />
        {route === "place-sync" ? (
          <PlaceSync />
        ) : route === "oauth-consent" ? (
          <OauthConsent />
        ) : route === "quick-add" && profile.onboardingStep === "done" ? (
          <DesktopQuickAdd />
        ) : route === "share" && profile.onboardingStep === "done" ? (
          <ShareSheet />
        ) : profile.onboardingStep !== "done" || route === "onboarding" ? (
          <Suspense fallback={<FullPageMessage title="Opening your folio…" busy />}>
            <Onboarding />
          </Suspense>
        ) : (
          <MigrationGate>
            {/* A move between places that switched here to run (components/places/MovePlaces.tsx). */}
            <PlaceMoveGate>
              {/* End-to-end encryption: the unlock screen for encrypted spaces; Standard passes straight through. */}
              <E2eeGate>
                <Shell />
              </E2eeGate>
            </PlaceMoveGate>
          </MigrationGate>
        )}
      </AppStateProvider>
    </ShellUpdateGate>
  );
}

/**
 * End-to-end encryption's key session, once signed in (docs/E2EE_DESIGN.md §6.3): it reads the account's status
 * and, when the account has keys, unlocks with this device's. A Standard account only watches its status.
 * Sign-out ends it (components/auth/SignOut.tsx).
 */
function KeySessionStarter({ profileId, email }: { profileId: string; email?: string }) {
  useEffect(() => {
    void startKeySession({
      server: convexKeysServer(getConvexClient()),
      profileId,
      email,
      newDeviceId: () => loadDeviceId(profileId),
    }).catch(() => undefined);
  }, [profileId, email]);
  return null;
}
