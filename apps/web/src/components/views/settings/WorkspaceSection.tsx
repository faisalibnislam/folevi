"use client";

import { useConvex, useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatBytes } from "@/lib/format";
import { uploadIdentityImage } from "@/lib/app/identityImages";
import { Card } from "./Card";
import { IdentityImageField } from "./IdentityImageField";

export function WorkspaceSection() {
  const { workspace } = useAppState();
  // Re-mount per workspace so the rename field never shows the previous workspace's name.
  return <WorkspaceSettings key={workspace.id} />;
}

function WorkspaceSettings() {
  const { workspace, workspaces, profile, setWorkspace } = useAppState();
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
  const personal = workspace.kind === "personal";
  // Collaborators can leave someone's personal workspace too; owners never leave their own.
  const canLeave = workspace.role !== "owner";
  const pct = workspace.storageQuotaBytes ? (workspace.storageUsedBytes / workspace.storageQuotaBytes) * 100 : 0;
  return (
    <>
      <Card title="Workspace" description={`${workspace.kind === "personal" ? "Personal" : "Team"} workspace · you are ${workspace.role === "owner" ? "the owner" : workspace.role === "admin" || workspace.role === "editor" ? `an ${workspace.role}` : `a ${workspace.role}`}.`}>
        {personal ? (
          <div className="max-w-md text-sm">
            <label htmlFor="ws-name" className="mb-1 block font-medium">
              Workspace name
            </label>
            <input id="ws-name" value="Personal" readOnly aria-describedby="ws-name-hint" className="h-9 w-full ui-well rounded-[6px] px-3 text-muted" />
            <span id="ws-name-hint" className="mt-1 block text-xs text-muted">
              Your personal workspace is always called Personal.
            </span>
          </div>
        ) : canAdmin ? (
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
          {personal ? (
            <p className="text-sm text-muted">Your personal workspace uses your profile picture. Change it in Settings → Account.</p>
          ) : canAdmin ? (
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
        <p className="mt-4 text-sm text-muted">
          Storage: {formatBytes(workspace.storageUsedBytes)} of {formatBytes(workspace.storageQuotaBytes)} used
        </p>
        <div className="mt-2 h-1.5 max-w-md overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${Math.round(pct)}% of storage used`}>
          <div className="h-full bg-accent" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      </Card>
      <NewTeamWorkspaceCard />
      {canLeave ? (
        <Card title="Leave workspace" description="You’ll lose access to its pages, folders and tasks. Pages you wrote stay in the workspace.">
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
                  const next = workspaces.find((w) => w.id !== workspace.id && w.isDefault) ?? workspaces.find((w) => w.id !== workspace.id);
                  if (next) setWorkspace(next.id);
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

export function NewTeamWorkspaceCard() {
  const { setWorkspace } = useAppState();
  const create = useMutation(api.workspaces.createTeamWorkspace);
  const toast = useToast();
  const [teamName, setTeamName] = useState("");
  return (
    <Card title="New team workspace" description="Share folders, documents and tasks with other people. Your personal workspace stays private.">
      <form
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!teamName.trim()) {
            toast.show("Give the workspace a name.", { tone: "error" });
            return;
          }
          create({ name: teamName }).then(
            (r) => {
              setWorkspace(r.id);
              setTeamName("");
              toast.show("Workspace created", { tone: "success" });
            },
            (err) => toast.show(errorMessage(err), { tone: "error" }),
          );
        }}
      >
        <label className="sr-only" htmlFor="team-name">
          Team workspace name
        </label>
        <input id="team-name" value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={80} placeholder="e.g. Ashgrove Gardens" className="h-9 flex-1 ui-input rounded-[6px] px-3" />
        <Button type="submit" variant="primary">
          Create
        </Button>
      </form>
    </Card>
  );
}
