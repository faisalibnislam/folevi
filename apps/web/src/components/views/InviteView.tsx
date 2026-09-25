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
  const { setWorkspace, profile } = useAppState();
  const { navigate } = useAppRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <ViewChrome title={<h1 className="text-sm font-semibold">Invitation</h1>}>
      <div className="mx-auto max-w-md px-6 py-20">
        {preview === undefined ? (
          <p className="text-muted">Checking your invitation…</p>
        ) : !preview.valid ? (
          <>
            <h2 className="font-display text-3xl">This invitation is no longer valid</h2>
            <p className="mt-2 text-muted">It may have expired or been revoked. Ask for a new one.</p>
          </>
        ) : (
          <>
            <h2 className="font-display text-3xl">Join {preview.workspaceName}</h2>
            <p className="mt-2 text-muted">
              {preview.inviterName} invited you as {preview.role === "admin" ? "an admin" : `a${preview.role === "editor" ? "n" : ""} ${preview.role}`}.
            </p>
            {!preview.emailMatches ? (
              <p className="mt-4 rounded-[10px] border border-warning/30 bg-warning-soft p-3 text-sm">
                This invitation was sent to a different address than the one you’re signed in with ({profile.email}). Sign in with the invited address to accept it.
              </p>
            ) : (
              <Button
                className="mt-6"
                variant="primary"
                onClick={async () => {
                  try {
                    const r = await accept({ token });
                    setWorkspace(r.workspaceId);
                    navigate("/documents", { replace: true });
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
              >
                Accept invitation
              </Button>
            )}
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
