"use client";

import { useConvex, useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@/lib/convex/api";
import { useAppState, type Workspace } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatBytes, formatDateTime } from "@/lib/format";
import { AppLink } from "@/lib/app/router";
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
  const scheduled = workspace.deletionScheduledFor ?? null;
  // Owners and admins change settings; members read them. Nothing changes while deletion is scheduled.
  const canAdmin = workspace.canManage && scheduled === null;
  // Owners never leave their own workspace (they hand it on, or delete it).
  const canLeave = workspace.role !== "owner";
  const pct = workspace.storageQuotaBytes ? (workspace.storageUsedBytes / workspace.storageQuotaBytes) * 100 : 0;
  const access = workspace.role === "member" && workspace.memberAccess !== "edit" ? (workspace.memberAccess === "comment" ? " who can comment" : " with view-only access") : "";
  return (
    <>
      {scheduled !== null ? <ScheduledDeletionCard workspace={workspace} at={scheduled} /> : null}
      <Card title="Workspace" description={`You're ${workspace.role === "owner" ? "the owner" : workspace.role === "admin" ? "an admin" : `a member${access}`} of this workspace.`}>
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
          Plan: <span className="text-ink">{workspace.plan.name}</span>
          {workspace.canManageBilling ? (
            <>
              {" · "}
              <AppLink href="/settings/workspace-billing" className="font-medium text-heading underline decoration-line-strong underline-offset-2 hover:decoration-heading">
                Plan &amp; billing
              </AppLink>
            </>
          ) : null}
        </p>
        <p className="mt-1 text-sm text-muted">
          Workspace storage: {formatBytes(workspace.storageUsedBytes)} of {formatBytes(workspace.storageQuotaBytes)} used
        </p>
        <div className="mt-2 h-1.5 max-w-md overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${Math.round(pct)}% of storage used`}>
          <div className="h-full bg-accent" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        {workspace.storageUsedBytes > workspace.storageQuotaBytes ? (
          <p role="status" className="mt-2 max-w-md text-sm text-danger">
            Over the storage limit. Everything already stored stays available; new uploads are paused until space is freed{workspace.canManageBilling ? " or the plan is upgraded" : ""}.
          </p>
        ) : null}
        <p className="mt-3 text-xs text-muted">
          Your role: {workspaceRoleLabel(workspace.role)}
          {workspace.role === "member" && workspace.memberAccess !== "edit" ? ` · ${workspace.memberAccess === "comment" ? "can comment" : "view only"}` : ""}
        </p>
      </Card>
      {canLeave ? (
        <Card title="Leave workspace" description="You’ll lose access to its pages, folders and tasks. Pages you wrote stay in the workspace. Your Personal isn’t affected.">
          <Button variant="danger" onClick={() => setConfirmLeave(true)}>
            Leave {workspace.name}
          </Button>
        </Card>
      ) : scheduled === null ? (
        <>
          <Card title="Leave workspace" description="You own this workspace, so you can’t leave it. Make another member the owner first (Members → Make owner), or delete the workspace below.">
            <AppLink href="/settings/members" className="text-sm font-medium text-heading underline decoration-line-strong underline-offset-2 hover:decoration-heading">
              Go to Members
            </AppLink>
          </Card>
          <DeleteWorkspaceCard workspace={workspace} />
        </>
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

/**
 * Owner only: deletes the workspace after a 7-day grace period (cancelable). Typing its name confirms.
 * Members and guests lose it at once; its plan stops renewing; everything in it is purged at the end.
 */
function DeleteWorkspaceCard({ workspace }: { workspace: Workspace }) {
  const schedule = useMutation(api.workspaces.scheduleDeletion);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Card title="Delete workspace" description="Deletes this workspace and everything in it — pages, folders, tasks, files and comments — for everyone, after a 7-day grace period. Export it first if you want to keep a copy. Nobody’s Personal is affected.">
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete {workspace.name}…
        </Button>
      </Card>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Delete ${workspace.name}?`}
        description="Members and guests lose access right away and are told. You can cancel within 7 days; after that it’s gone for good. A paid plan ends with its current period."
        size="sm"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Keep workspace</Button>
            <Button
              variant="danger"
              disabled={busy || typed.trim() !== workspace.name.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  await schedule({ workspaceId: workspace.id, confirmName: typed });
                  setOpen(false);
                  toast.show(`${workspace.name} is scheduled for deletion`);
                } catch (e) {
                  toast.show(errorMessage(e), { tone: "error" });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Schedule deletion
            </Button>
          </>
        }
      >
        <label className="text-sm" htmlFor="confirm-workspace-name">
          Type <strong>{workspace.name}</strong> to confirm
        </label>
        <input id="confirm-workspace-name" value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-2 h-10 w-full ui-input rounded-[6px] px-3" autoComplete="off" />
      </Dialog>
    </>
  );
}

/** Shown to the owner while deletion is scheduled: the workspace is read-only, and deletion can be canceled. */
function ScheduledDeletionCard({ workspace, at }: { workspace: Workspace; at: number }) {
  const cancel = useMutation(api.workspaces.cancelDeletion);
  const toast = useToast();
  return (
    <Card title="Scheduled for deletion" description={`${workspace.name} will be deleted on ${formatDateTime(at)}. Until then it’s read-only for you and hidden from members and guests.`}>
      <Button
        onClick={() =>
          void cancel({ workspaceId: workspace.id }).then(
            () => toast.show(`${workspace.name} won’t be deleted. If it had a paid plan, resume it in Plan & billing.`, { tone: "success" }),
            (e) => toast.show(errorMessage(e), { tone: "error" }),
          )
        }
      >
        Cancel deletion
      </Button>
    </Card>
  );
}
