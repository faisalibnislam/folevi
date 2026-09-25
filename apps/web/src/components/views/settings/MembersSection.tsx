"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/format";
import { Card } from "./Card";

export function MembersSection() {
  const { workspace } = useAppState();
  const data = useQuery(api.workspaces.members, { workspaceId: workspace.id });
  const invite = useMutation(api.workspaces.invite);
  const revokeInvite = useMutation(api.workspaces.revokeInvite);
  const changeRole = useMutation(api.workspaces.changeRole);
  const remove = useMutation(api.workspaces.removeMember);
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "editor" | "commenter" | "viewer">("editor");
  const canAdmin = data?.yourRole === "owner" || data?.yourRole === "admin";
  const act = (p: Promise<unknown>, ok: string) => p.then(() => toast.show(ok), (e) => toast.show(errorMessage(e), { tone: "error" }));
  return (
    <>
      {canAdmin ? (
        <Card title="Invite people" description="Invitations are tied to the email address you enter and expire after 7 days.">
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void act(invite({ workspaceId: workspace.id, email, role }), "Invitation sent").then(() => setEmail(""));
            }}
          >
            <label className="sr-only" htmlFor="invite-email">
              Email
            </label>
            <input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className="h-9 min-w-0 flex-1 ui-input rounded-full px-3" />
            <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as typeof role)} className="h-9 ui-input rounded-full px-2">
              {data?.yourRole === "owner" ? <option value="admin">Admin</option> : null}
              <option value="editor">Editor</option>
              <option value="commenter">Commenter</option>
              <option value="viewer">Viewer</option>
            </select>
            <Button type="submit" variant="primary">
              Invite
            </Button>
          </form>
        </Card>
      ) : null}
      <Card title="Members">
        <ul className="divide-y divide-line rounded-[14px] border border-line">
          {data?.members.map((m) => (
            <li key={m.profileId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {m.displayName} {m.isYou ? <span className="text-xs text-muted">(you)</span> : null}
                </span>
                <span className="block text-xs text-muted">{m.email}</span>
              </span>
              {canAdmin && m.role !== "owner" && !m.isYou ? (
                <>
                  <select aria-label={`Role for ${m.displayName}`} value={m.role} onChange={(e) => void act(changeRole({ workspaceId: workspace.id, profileId: m.profileId, role: e.target.value as typeof role }), "Role updated")} className="h-8 ui-input rounded-full px-2 text-sm">
                    {data?.yourRole === "owner" ? <option value="admin">Admin</option> : null}
                    <option value="editor">Editor</option>
                    <option value="commenter">Commenter</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <Button size="sm" variant="quiet" className="text-danger" onClick={() => void act(remove({ workspaceId: workspace.id, profileId: m.profileId }), "Removed")}>
                    Remove
                  </Button>
                </>
              ) : (
                <span className="text-sm capitalize text-muted">{m.role}</span>
              )}
            </li>
          ))}
        </ul>
        {data?.invites.length ? (
          <>
            <h4 className="mb-2 mt-5 text-sm font-semibold">Pending invitations</h4>
            <ul className="divide-y divide-line rounded-[14px] border border-line">
              {data.invites.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="flex-1">{i.email}</span>
                  <span className="text-xs capitalize text-muted">
                    {i.role} · {i.expired ? "expired" : `expires ${formatRelative(i.expiresAt)}`}
                  </span>
                  <Button size="sm" variant="quiet" onClick={() => void act(revokeInvite({ inviteId: i.id }), "Invitation revoked")}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {!canAdmin ? <p className="mt-3 text-sm text-muted">Only owners and admins can invite or change roles.</p> : null}
      </Card>
    </>
  );
}
