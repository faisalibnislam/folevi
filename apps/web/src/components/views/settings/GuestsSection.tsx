"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/lib/convex/api";
import type { Workspace } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/format";
import { Card } from "./Card";

type ShareRole = "viewer" | "commenter" | "editor";
type Confirm = { kind: "remove" | "member"; profileId: string; name: string } | null;
const ROLE_WORDS: Record<ShareRole, string> = { viewer: "Can view", commenter: "Can comment", editor: "Can edit" };

/**
 * Guests of the current workspace (owners and admins): people with access to some of its pages who aren't
 * members. They take no seat. Each can be given other access per page, removed from the workspace, or
 * invited to become a member.
 */
export function GuestsSection({ workspace }: { workspace: Workspace }) {
  const data = useQuery(api.workspaces.guests, { workspaceId: workspace.id });
  const setAccess = useMutation(api.workspaces.setGuestAccess);
  const removeGuest = useMutation(api.workspaces.removeGuest);
  const toMember = useMutation(api.workspaces.convertGuestToMember);
  const revokeInvite = useMutation(api.sharing.revokePageInvite);
  const toast = useToast();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const act = (p: Promise<unknown>, ok: string) => p.then(() => toast.show(ok, { tone: "success" }), (e) => toast.show(errorMessage(e), { tone: "error" }));

  return (
    <>
      <Card
        title="Guests"
        description={`People outside ${workspace.name} who were given access to single pages (and the pages inside them). Guests don't see anything else here, and they're never billed.`}
      >
        {data === undefined ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : data.guests.length === 0 ? (
          <p className="text-sm text-muted">No guests. Share a page with someone from its Share button to add one.</p>
        ) : (
          <ul className="divide-y divide-line rounded-[10px] border border-line">
            {data.guests.map((g) => (
              <li key={g.profileId} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{g.displayName}</span>
                    <span className="block text-xs text-muted">{g.email}</span>
                  </span>
                  <Button size="sm" variant="quiet" onClick={() => setConfirm({ kind: "member", profileId: g.profileId, name: g.displayName })}>
                    Convert to member
                  </Button>
                  <Button size="sm" variant="quiet" className="text-danger" onClick={() => setConfirm({ kind: "remove", profileId: g.profileId, name: g.displayName })}>
                    Remove
                  </Button>
                </div>
                <ul className="mt-2 space-y-1.5" aria-label={`Pages ${g.displayName} can open`}>
                  {g.pages.map((p) => (
                    <li key={p.documentId} className="flex flex-wrap items-center gap-2 text-sm">
                      <AppLink href={`/d/${p.documentId}`} className="min-w-0 flex-1 truncate hover:underline">
                        {p.title}
                        {p.inTrash ? <span className="ml-1.5 text-xs text-faint">(in Trash)</span> : null}
                      </AppLink>
                      <Select
                        aria-label={`${g.displayName}'s access to ${p.title}`}
                        value={p.role}
                        onChange={(e) => void act(setAccess({ workspaceId: workspace.id, profileId: g.profileId, documentId: p.documentId, role: e.target.value as ShareRole }), `${g.displayName}: ${ROLE_WORDS[e.target.value as ShareRole]} on ${p.title}`)}
                        className="h-8 ui-input rounded-[6px] px-3 text-sm"
                      >
                        <option value="viewer">Can view</option>
                        <option value="commenter">Can comment</option>
                        <option value="editor">Can edit</option>
                      </Select>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {data?.pendingInvites.length ? (
          <>
            <h4 className="mb-2 mt-5 text-sm font-semibold">Waiting to accept</h4>
            <p className="mb-2 text-xs text-muted">Pages shared with addresses that don’t have a Folevi account yet. Nothing is shared until they sign up and accept.</p>
            <ul className="divide-y divide-line rounded-[10px] border border-line">
              {data.pendingInvites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {i.email} <span className="text-muted">· {i.title}</span>
                  </span>
                  <span className="text-xs text-muted">
                    {ROLE_WORDS[i.role]} · {i.expired ? "expired" : `expires ${formatRelative(i.expiresAt)}`}
                  </span>
                  <Button size="sm" variant="quiet" onClick={() => void act(revokeInvite({ inviteId: i.id }), "Invitation revoked")}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "member" ? `Invite ${confirm.name} to become a member?` : `Remove ${confirm?.name ?? ""} from ${workspace.name}?`}
        description={
          confirm?.kind === "member"
            ? `They get an invitation. Once they accept, they're a member of ${workspace.name} (one billable seat on a paid plan) and keep the pages they already have.`
            : `${confirm?.name ?? "They"} will lose access to every page of ${workspace.name} that was shared with them.`
        }
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant={confirm?.kind === "member" ? "primary" : "danger"}
              disabled={busy}
              onClick={async () => {
                if (!confirm) return;
                setBusy(true);
                try {
                  if (confirm.kind === "member") {
                    await toMember({ workspaceId: workspace.id, profileId: confirm.profileId });
                    toast.show(`Invitation sent to ${confirm.name}`, { tone: "success" });
                  } else {
                    await removeGuest({ workspaceId: workspace.id, profileId: confirm.profileId });
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
              {confirm?.kind === "member" ? "Send invitation" : "Remove"}
            </Button>
          </>
        }
      />
    </>
  );
}
