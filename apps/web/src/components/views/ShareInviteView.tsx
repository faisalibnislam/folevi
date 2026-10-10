"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { Button } from "@/components/ui/Button";
import { errorMessage } from "@/components/ui/Toast";
import { ViewChrome } from "@/components/app/Shell";

/**
 * /share-invite/<token>: a page someone shared with this email address before it had a Folevi account.
 * Accepting (signed in with that verified address) gives access to that page only, as a guest.
 */
export function ShareInviteView({ token }: { token: string }) {
  const preview = useQuery(api.sharing.previewPageInvite, { token });
  const accept = useMutation(api.sharing.acceptPageInvite);
  const { profile } = useAppState();
  const { navigate } = useAppRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <ViewChrome title={<h1 className="text-sm font-semibold">Shared page</h1>}>
      <div className="mx-auto max-w-md px-6 py-20">
        {preview === undefined ? (
          <p className="text-muted">Checking your invitation…</p>
        ) : !preview.valid ? (
          <>
            <h2 className="ui-display text-3xl">This invitation is no longer valid</h2>
            <p className="mt-2 text-muted">It may have expired, been revoked or already been used. Ask for a new one.</p>
          </>
        ) : !preview.emailMatches ? (
          <>
            <h2 className="ui-display text-3xl">A page was shared with you</h2>
            <p className="mt-4 rounded-chip border border-warning/30 bg-warning-soft p-3 text-sm">
              {preview.inviterName} shared a page with a different address than the one you’re signed in with ({profile.email}). Sign in with the invited address to open it.
            </p>
          </>
        ) : (
          <>
            <h2 className="ui-display text-3xl">{preview.title}</h2>
            <p className="mt-2 text-muted">
              {preview.inviterName} shared this page with you ({preview.roleLabel.toLowerCase()}). You’ll see this page and the pages inside it, and nothing else of theirs.
            </p>
            <Button
              className="mt-6"
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const r = await accept({ token });
                  navigate(`/d/${r.documentId}`, { replace: true });
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Open the page
            </Button>
            {error ? (
              <p role="alert" className="mt-3 text-sm text-danger">
                {error}
              </p>
            ) : null}
          </>
        )}
      </div>
    </ViewChrome>
  );
}
