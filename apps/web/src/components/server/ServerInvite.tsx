"use client";

// An invitation to a Folevi server (`/join/<token>`, serverInvites:preview and :accept, CONTRACT §7). Signed out:
// create an account (the sign-up carries the invite, which gives the new account its role) or sign in and come
// back. Signed in: join.
import { useState } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { FoleviLogo } from "@/components/brand/FoleviMark";
import { Alert, AuthHeading, TextLink } from "@/components/auth/fields";
import { errorMessage } from "@/components/ui/Toast";
import { ConvexClientProvider } from "@/lib/convex/provider";
import { serverInviteRefs, type ServerRole } from "@/lib/server-edition/refs";

const ROLE_WORDS: Record<ServerRole, string> = { owner: "as its owner", admin: "as an admin", member: "", guest: "as a guest" };

type Preview = { serverName: string; invitedBy: string; email?: string | null; role: ServerRole; expired: boolean };

function Join({ token }: { token: string }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const accept = useMutation(serverInviteRefs.accept);
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
          accept({ token })
            .then(() => window.location.assign("/documents"))
            .catch((e: unknown) => {
              setBusy(false);
              setError(errorMessage(e));
            });
        }}
      >
        Join
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
                <AuthHeading title="This invite has expired" lede={`Ask ${invite.invitedBy || "the person who invited you"} for a new one.`} />
                <TextLink href="/signin">Sign in</TextLink>
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
                    <a href={`/signup?invite=${encodeURIComponent(token)}${invite.email ? `&email=${encodeURIComponent(invite.email)}` : ""}`} className="ui-btn ui-btn-primary h-11 w-full text-body">
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
