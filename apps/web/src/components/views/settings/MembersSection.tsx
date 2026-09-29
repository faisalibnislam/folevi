"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/lib/convex/api";
import type { Workspace } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/format";
import { Card } from "./Card";
import { Select } from "@/components/ui/Select";
import { InviteForm } from "@/components/app/InviteDialog";
import { Switch } from "@/components/ui/Switch";
import { formatPrice } from "@/lib/plans";

type Role = "admin" | "editor" | "commenter" | "viewer";
type Confirm = { kind: "remove" | "owner"; profileId: string; name: string } | null;

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", editor: "Editor", commenter: "Commenter", viewer: "Viewer" };

/** Members of the current team workspace. Only shown when a workspace is open: Personal has no members. */
export function MembersSection({ workspace }: { workspace: Workspace }) {
  const data = useQuery(api.workspaces.members, { workspaceId: workspace.id });
  const revokeInvite = useMutation(api.workspaces.revokeInvite);
  const changeRole = useMutation(api.workspaces.changeRole);
  const remove = useMutation(api.workspaces.removeMember);
  const transfer = useMutation(api.workspaces.transferOwnership);
  const setBillingManager = useMutation(api.workspaces.setBillingManager);
  const toast = useToast();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const canAdmin = data?.yourRole === "owner" || data?.yourRole === "admin";
  const isOwner = data?.yourRole === "owner";
  const act = (p: Promise<unknown>, ok: string) => p.then(() => toast.show(ok, { tone: "success" }), (e) => toast.show(errorMessage(e), { tone: "error" }));

  return (
    <>
      {canAdmin ? (
        <Card title="Invite people" description="Invitations are tied to the email address you enter and expire after 7 days.">
          <InviteForm workspace={workspace} />
        </Card>
      ) : null}
      <Card
        title="Members"
        description={
          data?.seats
            ? data.seats.paid && data.seats.interval
              ? `Billable seats: ${data.seats.billable} × ${formatPrice(data.seats.seatPriceCents)} per ${data.seats.interval === "year" ? "year" : "month"} on ${data.seats.planName}. Guests and pending invitations are free.`
              : `Billable seats: ${data.seats.billable} (the ${data.seats.planName} plan is free). Guests and pending invitations never take a seat.`
            : undefined
        }
      >
        <ul className="divide-y divide-line rounded-[8px] border border-line">
          {data?.members.map((m) => (
            <li key={m.profileId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {m.displayName} {m.isYou ? <span className="text-xs text-muted">(you)</span> : null}
                </span>
                <span className="block text-xs text-muted">{m.email}</span>
                {/* The owner decides which admins may manage the plan and billing. */}
                {isOwner && m.role === "admin" ? (
                  <span className="mt-1.5 flex items-center gap-2 text-xs text-muted">
                    <Switch
                      checked={m.canManageBilling}
                      label={`${m.displayName} can manage billing`}
                      onChange={(next) =>
                        void act(setBillingManager({ workspaceId: workspace.id, profileId: m.profileId, allowed: next }), next ? `${m.displayName} can manage billing` : `${m.displayName} can no longer manage billing`)
                      }
                    />
                    Can manage billing
                  </span>
                ) : m.role === "admin" && m.canManageBilling ? (
                  <span className="mt-0.5 block text-xs text-muted">Can manage billing</span>
                ) : null}
              </span>
              {canAdmin && m.role !== "owner" && !m.isYou && (isOwner || m.role !== "admin") ? (
                <>
                  <Select
                    aria-label={`Role for ${m.displayName}`}
                    value={m.role}
                    onChange={(e) => void act(changeRole({ workspaceId: workspace.id, profileId: m.profileId, role: e.target.value as Role }), `${m.displayName} is now ${ROLE_LABEL[e.target.value]?.toLowerCase() === "admin" ? "an admin" : `a ${ROLE_LABEL[e.target.value]?.toLowerCase()}`}`)}
                    className="h-8 ui-input rounded-[6px] px-3 text-sm"
                  >
                    {isOwner ? <option value="admin">Admin</option> : null}
                    <option value="editor">Editor</option>
                    <option value="commenter">Commenter</option>
                    <option value="viewer">Viewer</option>
                  </Select>
                  {isOwner ? (
                    <Button size="sm" variant="quiet" onClick={() => setConfirm({ kind: "owner", profileId: m.profileId, name: m.displayName })}>
                      Make owner
                    </Button>
                  ) : null}
                  <Button size="sm" variant="quiet" className="text-danger" onClick={() => setConfirm({ kind: "remove", profileId: m.profileId, name: m.displayName })}>
                    Remove
                  </Button>
                </>
              ) : (
                <span className="text-sm text-muted">{ROLE_LABEL[m.role] ?? m.role}</span>
              )}
            </li>
          ))}
        </ul>
        {data?.invites.length ? (
          <>
            <h4 className="mb-2 mt-5 text-sm font-semibold">Pending invitations</h4>
            <ul className="divide-y divide-line rounded-[8px] border border-line">
              {data.invites.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="flex-1">{i.email}</span>
                  <span className="text-xs text-muted">
                    {ROLE_LABEL[i.role] ?? i.role} · {i.expired ? "expired" : `expires ${formatRelative(i.expiresAt)}`}
                  </span>
                  <Button size="sm" variant="quiet" onClick={() => void act(revokeInvite({ inviteId: i.id }), "Invitation revoked")}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {!canAdmin ? <p className="mt-3 text-sm text-muted">Only owners and admins can invite people or change roles.</p> : null}
      </Card>
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "owner" ? `Make ${confirm.name} the owner?` : `Remove ${confirm?.name ?? ""}?`}
        description={
          confirm?.kind === "owner"
            ? `${confirm.name} will own ${workspace.name}, and be the only one who can manage admins or hand it on again. You’ll stay on as an admin.`
            : `${confirm?.name ?? "They"} will lose access to ${workspace.name} and any pages shared with them here. Their pages stay in the workspace.`
        }
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant={confirm?.kind === "owner" ? "primary" : "danger"}
              disabled={busy}
              onClick={async () => {
                if (!confirm) return;
                setBusy(true);
                try {
                  if (confirm.kind === "owner") {
                    await transfer({ workspaceId: workspace.id, profileId: confirm.profileId });
                    toast.show(`${confirm.name} now owns ${workspace.name}`, { tone: "success" });
                  } else {
                    await remove({ workspaceId: workspace.id, profileId: confirm.profileId });
                    toast.show(`Removed ${confirm.name}`, { tone: "success" });
                  }
                  setConfirm(null);
                } catch (e) {
                  toast.show(errorMessage(e), { tone: "error" });
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirm?.kind === "owner" ? "Transfer ownership" : "Remove"}
            </Button>
          </>
        }
      />
    </>
  );
}
