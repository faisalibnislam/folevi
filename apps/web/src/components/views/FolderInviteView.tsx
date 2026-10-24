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
 * /share-invite/folder/<token>: a folder someone shared with this email address before it had a Folevi
 * account (docs/SHARING.md). Accepting (signed in with that verified address) gives access to that folder and
 * the notes in it, as a guest; declining makes the invitation unusable and tells nobody.
 */
export function FolderInviteView({ token }: { token: string }) {
  const preview = useQuery(api.folderSharing.previewInvite, { token });
  const accept = useMutation(api.folderSharing.acceptInvite);
  const decline = useMutation(api.folderSharing.declineInvite);
  const { profile } = useAppState();
  const { navigate } = useAppRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ViewChrome title={<h1 className="text-sm font-semibold">Shared folder</h1>} tabTitle="Invitation">
      <div className="mx-auto max-w-md px-6 py-20">
        {preview === undefined ? (
          <p className="text-muted">Checking your invitation…</p>
        ) : !preview.valid ? (
          <>
            <h2 className="ui-display text-3xl">This invitation is no longer valid</h2>
            <p className="mt-2 text-muted">It may have expired, been revoked, declined or already been used. Ask for a new one.</p>
          </>
        ) : !preview.emailMatches ? (
          <>
            <h2 className="ui-display text-3xl">A folder was shared with you</h2>
            <p className="mt-4 rounded-chip border border-warning/30 bg-warning-soft p-3 text-sm">
              {preview.inviterName} shared a folder with a different address than the one you’re signed in with ({profile.email}). Sign in with the invited address to open it.
            </p>
          </>
        ) : (
          <>
            <h2 className="ui-display text-3xl">{preview.name}</h2>
            <p className="mt-2 text-muted">
              {preview.inviterName} shared this folder with you ({preview.roleLabel.toLowerCase()}). You’ll see the notes in it and in its folders, including notes added later, and nothing else of theirs.
            </p>
            <div className="mt-6 flex gap-2">
              <Button variant="primary" disabled={busy} onClick={() => void act(async () => navigate(`/shared/${(await accept({ token })).folderId}`, { replace: true }))}>
                Open the folder
              </Button>
              <Button disabled={busy} onClick={() => void act(async () => { await decline({ token }); navigate("/shared", { replace: true }); })}>
                Decline
              </Button>
            </div>
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
