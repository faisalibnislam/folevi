"use client";

import { useId } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex/api";
import type { Workspace } from "@/lib/app/state";
import { copy } from "@/lib/e2ee/copy";
import { PrivacyPanel } from "@/components/e2ee/PrivacyPanel";
import { Card } from "./Card";
import { Switch } from "@/components/ui/Switch";
import { useToast, errorMessage } from "@/components/ui/Toast";

/**
 * Settings > Workspace > Privacy (§10.1, §10.4, §8.7): the workspace's level and switches, and whether Foli AI
 * can be used here at all. Owners and admins change them; members see them read only.
 */
export function WorkspacePrivacySection({ workspace }: { workspace: Workspace }) {
  const canChange = workspace.canManage === true;
  return (
    <>
      <p className="max-w-prose text-subheadline text-muted">{copy.privacy.workspaceIntro(workspace.name)}</p>
      {canChange ? null : <p className="text-subheadline text-muted">{copy.privacy.workspaceReadOnly}</p>}
      <PrivacyPanel scope={{ kind: "workspace", workspaceId: workspace.id }} workspaceName={workspace.name} canChange={canChange} />
      <WorkspaceAiCard workspace={workspace} canChange={canChange} />
    </>
  );
}

/** Foli AI on or off for everyone in the workspace (the server refuses every AI request here while it's off). */
function WorkspaceAiCard({ workspace, canChange }: { workspace: Workspace; canChange: boolean }) {
  const set = useMutation(api.workspaces.setAiDisabled);
  const toast = useToast();
  const descId = useId();
  const on = workspace.aiDisabled !== true;
  const turn = (next: boolean) => {
    void set({ workspaceId: workspace.id, disabled: !next }).then(
      () => toast.show(next ? "Foli AI turned on for this workspace" : "Foli AI turned off for this workspace"),
      (e) => toast.show(errorMessage(e), { tone: "error" }),
    );
  };
  return (
    <Card title="Foli AI">
      <div className="flex items-start justify-between gap-6">
        <p id={descId} className="max-w-prose text-subheadline text-muted">
          {on
            ? "Members and guests can use Foli AI on this workspace's pages. Turn it off and nothing here is sent to an AI model, for anyone."
            : "Foli AI is off here. Nothing in this workspace is sent to an AI model, for anyone."}
        </p>
        <Switch checked={on} disabled={!canChange} label="Foli AI" describedBy={descId} onChange={turn} />
      </div>
    </Card>
  );
}
