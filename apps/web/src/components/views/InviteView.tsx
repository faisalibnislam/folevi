"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { Button } from "@/components/ui/Button";
import { errorMessage } from "@/components/ui/Toast";
import { ViewChrome } from "@/components/app/Shell";

export function InviteView({ token }: { token: string }) {
  const preview = useQuery(api.workspaces.previewInvite, { token });
  const accept = useMutation(api.workspaces.acceptInvite);
  const decline = useMutation(api.workspaces.declineInvite);
  const { setContext, profile } = useAppState();
  const { navigate } = useAppRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <ViewChrome title={<h1 className="text-subheadline font-semibold">Invitation</h1>}>
      <div className="mx-auto max-w-md px-6 py-20">
        {preview === undefined ? (
          <p className="text-muted">Checking your invitation…</p>
        ) : !preview.valid ? (
          <>
            <h2 className="ui-display text-large-title">This invitation is no longer valid</h2>
            <p className="mt-2 text-muted">It may have expired or been revoked. Ask for a new one.</p>
          </>
        ) : (
          <>
            <h2 className="ui-display text-large-title">Join {preview.workspaceName}</h2>
            <p className="mt-2 text-muted">
              {preview.inviterName} invited you to join as {preview.role === "admin" ? "an admin" : preview.memberAccess === "edit" ? "a member" : `a member who can ${preview.memberAccess === "comment" ? "comment" : "view"} only`}.
            </p>
            {!preview.emailMatches ? (
              <p className="mt-4 rounded-chip border border-warning/30 bg-warning-soft p-3 text-subheadline">
                This invitation was sent to a different address than the one you’re signed in with ({profile.email}). Sign in with the invited address to accept it.
              </p>
            ) : (
              <div className="mt-6 flex gap-2">
                <Button
                  variant="primary"
                  onClick={async () => {
                    try {
                      const r = await accept({ token });
                      setContext({ kind: "workspace", workspaceId: r.workspaceId });
                      navigate("/documents", { replace: true });
                    } catch (e) {
                      setError(errorMessage(e));
                    }
                  }}
                >
                  Accept invitation
                </Button>
                <Button
                  onClick={async () => {
                    try {
                      await decline({ token });
                      navigate("/documents", { replace: true });
                    } catch (e) {
                      setError(errorMessage(e));
                    }
                  }}
                >
                  Decline
                </Button>
              </div>
            )}
            {error ? (
              <p role="alert" className="mt-3 text-subheadline text-danger">
                {error}
              </p>
            ) : null}
          </>
        )}
      </div>
    </ViewChrome>
  );
}
