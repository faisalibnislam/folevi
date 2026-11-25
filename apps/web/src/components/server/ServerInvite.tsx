"use client";

// An invitation to a Folevi server (`/join/<token>`, serverInvites:preview and :accept, CONTRACT §7). Signed out:
// create an account (the sign-up carries the invite, which gives the new account its role) or sign in and come
// back. Signed in: join.
import { useState } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import { Alert, AuthHeading } from "@/components/auth/fields";
import { errorMessage } from "@/components/ui/Toast";
import { ConvexClientProvider } from "@/lib/convex/provider";
import { api } from "@/lib/convex/api";
import { serverInviteRefs, type ServerRole } from "@/lib/server-edition/refs";

const ROLE_WORDS: Record<ServerRole, string> = { owner: "as its owner", admin: "as an admin", member: "", guest: "as a guest" };

type Preview = { serverName: string; invitedBy: string; email?: string | null; role: ServerRole; expired: boolean };

function Join({ token }: { token: string }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const accept = useMutation(serverInviteRefs.accept);
  const bootstrap = useMutation(api.users.bootstrap);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      <button
        type="button"
        disabled={busy || isLoading || !isAuthenticated}
        aria-busy={busy}
        className="ui-btn ui-btn-primary h-11 w-full text-body"
        onClick={() => {
          setBusy(true);
          setError(null);
          // A brand-new account's profile is made when Folevi first opens; joining needs it now.
          bootstrap({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", locale: navigator.language || "en-US" })
            .then(() => accept({ token }))
            .then(() => window.location.assign("/join/welcome"))
            .catch((e: unknown) => {
              setBusy(false);
              setError(errorMessage(e));
            });
        }}
      >
        {busy ? "Joining…" : "Join"}
      </button>
    </>
  );
}

export function ServerInvite({ token, invite, signedIn }: { token: string; invite: Preview; signedIn: boolean }) {
  const here = `/join/${encodeURIComponent(token)}`;
  const role = ROLE_WORDS[invite.role];
  return (
    <div className="ui-canvas ui-neutral-chrome grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-md">
        <span className="mb-6 inline-flex items-center gap-2 text-ink">
          <FoleviLogo height={28} title={null} />
        </span>
        <main id="main" className="relative">
          <div aria-hidden className="absolute inset-0 translate-x-2 translate-y-2 ui-card rounded-control" />
          <div className="relative ui-card rounded-control p-8">
            {invite.expired ? (
              <>
                <AuthHeading
                  title="This invite doesn't work any more"
                  lede={signedIn ? `Invites work once, for 7 days. If you already joined ${invite.serverName}, you're all set. If not, ask ${invite.invitedBy || "the person who invited you"} for a new one.` : `Invites work once, for 7 days. Ask ${invite.invitedBy || "the person who invited you"} for a new one. Already joined? Sign in.`}
                />
                <a href={signedIn ? "/documents" : "/signin"} className="ui-btn ui-btn-primary h-11 w-full text-body">
                  {signedIn ? "Open Folevi" : "Sign in"}
                </a>
              </>
            ) : (
              <>
                <AuthHeading title={`Join ${invite.serverName}`} lede={`${invite.invitedBy || "Someone"} invited you to use Folevi on ${invite.serverName}${role ? ` ${role}` : ""}.`} />
                {signedIn ? (
                  <ConvexClientProvider>
                    <Join token={token} />
                  </ConvexClientProvider>
                ) : (
                  <div className="space-y-2">
                    <a href={`/signup?invite=${encodeURIComponent(token)}&returnTo=${encodeURIComponent("/join/welcome")}${invite.email ? `&email=${encodeURIComponent(invite.email)}` : ""}`} className="ui-btn ui-btn-primary h-11 w-full text-body">
                      Create an account
                    </a>
                    <a href={`/signin?returnTo=${encodeURIComponent(here)}`} className="ui-btn ui-btn-secondary h-11 w-full text-body">
                      I have an account here
                    </a>
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
