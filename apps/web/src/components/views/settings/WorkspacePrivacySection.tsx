"use client";

import type { Workspace } from "@/lib/app/state";
import { copy } from "@/lib/e2ee/copy";
import { PrivacyPanel } from "@/components/e2ee/PrivacyPanel";

/**
 * Settings > Workspace > Privacy (§10.1, §10.4, §8.7): the workspace's level and switches. Owners and admins
 * change them; members see them read only.
 */
export function WorkspacePrivacySection({ workspace }: { workspace: Workspace }) {
  const canChange = workspace.canManage === true;
  return (
    <>
      <p className="max-w-prose text-sm text-muted">{copy.privacy.workspaceIntro(workspace.name)}</p>
      {canChange ? null : <p className="text-sm text-muted">{copy.privacy.workspaceReadOnly}</p>}
      <PrivacyPanel scope={{ kind: "workspace", workspaceId: workspace.id }} workspaceName={workspace.name} canChange={canChange} />
    </>
  );
}
