"use client";

import { useConvex, useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@/lib/convex/api";
import { useAppState, type Workspace } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatBytes } from "@/lib/format";
import { uploadIdentityImage } from "@/lib/app/identityImages";
import { workspaceRoleLabel } from "@/components/app/NewWorkspaceDialog";
import { Card } from "./Card";
import { IdentityImageField } from "./IdentityImageField";

/** The current team workspace's general settings. Only shown when a workspace is open (Personal has none). */
export function WorkspaceSection() {
  const { workspace } = useAppState();
  if (!workspace) return null;
  // Re-mount per workspace so the rename field never shows the previous workspace's name.
  return <WorkspaceSettings key={workspace.id} workspace={workspace} />;
}

function WorkspaceSettings({ workspace }: { workspace: Workspace }) {
  const { profile, setContext } = useAppState();
  const convex = useConvex();
  const rename = useMutation(api.workspaces.rename);
  const setLogo = useMutation(api.workspaces.setLogo);
  const removeLogo = useMutation(api.workspaces.removeLogo);
  const leave = useMutation(api.workspaces.removeMember);
  const toast = useToast();
  const [name, setName] = useState(workspace.name);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const canAdmin = workspace.role === "owner" || workspace.role === "admin";
  // Owners never leave their own workspace (they hand it on first).
  const canLeave = workspace.role !== "owner";
  const pct = workspace.storageQuotaBytes ? (workspace.storageUsedBytes / workspace.storageQuotaBytes) * 100 : 0;
  return (
    <>
      <Card title="Workspace" description={`You're ${workspace.role === "owner" ? "the owner" : workspace.role === "admin" ? "an admin" : "a member"} of this workspace.`}>
        {canAdmin ? (
          <form
            className="flex max-w-md gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              rename({ workspaceId: workspace.id, name }).then(() => toast.show("Renamed", { tone: "success" }), (err) => toast.show(errorMessage(err), { tone: "error" }));
            }}
          >
            <label className="sr-only" htmlFor="ws-name">
              Workspace name
            </label>
            <input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="h-9 flex-1 ui-input rounded-[6px] px-3" />
            <Button type="submit" disabled={!name.trim() || name.trim() === workspace.name}>
              Rename
            </Button>
          </form>
        ) : (
          <p className="text-sm">
            <span className="text-muted">Name:</span> {workspace.name} <span className="text-xs text-faint">(owners and admins can rename it)</span>
          </p>
        )}
        <div className="mt-5">
          <p className="mb-2 text-sm font-medium">Logo</p>
          {canAdmin ? (
            <IdentityImageField
              label="Workspace logo"
              shape="square"
              src={workspace.logoUrl ?? null}
              initial={workspace.name}
              onUpload={async (file) => {
                const fileId = await uploadIdentityImage(convex, { kind: "logo", workspaceId: workspace.id, file });
                await setLogo({ workspaceId: workspace.id, fileId });
              }}
              onRemove={async () => {
                await removeLogo({ workspaceId: workspace.id });
              }}
            />
          ) : (
            <p className="text-sm text-muted">Owners and admins can change the logo.</p>
          )}
        </div>
        {/* A workspace has its own plan and storage, separate from anyone's Personal plan. */}
        <p className="mt-4 text-sm text-muted">
          Plan: <span className="text-ink">{workspace.plan.name}</span> · Team and Business workspace plans are coming soon.
        </p>
        <p className="mt-1 text-sm text-muted">
          Workspace storage: {formatBytes(workspace.storageUsedBytes)} of {formatBytes(workspace.storageQuotaBytes)} used
        </p>
        <div className="mt-2 h-1.5 max-w-md overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${Math.round(pct)}% of storage used`}>
          <div className="h-full bg-accent" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <p className="mt-3 text-xs text-muted">Your role: {workspaceRoleLabel(workspace.role)}</p>
      </Card>
      {canLeave ? (
        <Card title="Leave workspace" description="You’ll lose access to its pages, folders and tasks. Pages you wrote stay in the workspace. Your Personal isn’t affected.">
          <Button variant="danger" onClick={() => setConfirmLeave(true)}>
            Leave {workspace.name}
          </Button>
        </Card>
      ) : null}
      <Dialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title={`Leave ${workspace.name}?`}
        description="To come back, an owner or admin has to invite you again."
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmLeave(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={leaving}
              onClick={async () => {
                setLeaving(true);
                try {
                  await leave({ workspaceId: workspace.id, profileId: profile.id });
                  // Back to Personal: it's always there.
                  setContext({ kind: "personal" });
                  setConfirmLeave(false);
                  toast.show(`You left ${workspace.name}`, { tone: "success" });
                } catch (e) {
                  toast.show(errorMessage(e), { tone: "error" });
                } finally {
                  setLeaving(false);
                }
              }}
            >
              Leave workspace
            </Button>
          </>
        }
      />
    </>
  );
}
