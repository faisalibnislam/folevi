"use client";

import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";
import { FolderLock, Trash2 } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Dialog } from "@/components/ui/Dialog";
import { Button, IconButton } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { AppLink } from "@/lib/app/router";
import { folderAccessSummary, roleLabel, type ShareRole } from "@/lib/app/folderSharing";

/**
 * Share a folder (docs/SHARING.md): people with roles, invitations by email, and what that reaches: every
 * note in the folder and its subfolders, notes added later too. Its managers (the Personal's owner, a
 * workspace's owners and admins) add people, change roles and remove them; everyone else sees who has access
 * (a guest only themselves). Opened from the folder's "…" menu (sidebar rows, folder cards) and the folder
 * page's header.
 */
export function FolderShareDialog({ open, onClose, folderId, name }: { open: boolean; onClose: () => void; folderId: string; name: string }) {
  const data = useQuery(api.folderSharing.get, open ? { folderId } : "skip");
  const grant = useMutation(api.folderSharing.grant);
  const setRole = useMutation(api.folderSharing.setRole);
  const revoke = useMutation(api.folderSharing.revoke);
  const revokeInvite = useMutation(api.folderSharing.revokeInvite);
  const toast = useToast();
  const uid = useId();
  const [email, setEmail] = useState("");
  const [role, setNewRole] = useState<ShareRole>("viewer");
  const [sending, setSending] = useState(false);

  const run = async (p: Promise<unknown>, ok?: string) => {
    try {
      await p;
      if (ok) toast.show(ok, { tone: "success" });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={`Share “${name || "Untitled"}”`} size="md">
      {!data ? (
        <p className="text-subheadline text-muted">Loading…</p>
      ) : (
        <div className="space-y-6 pb-3 text-subheadline" data-testid="folder-share-dialog">
          <p className="rounded-chip border border-line p-3 text-muted" data-testid="folder-share-summary">
            {folderAccessSummary({ noteCount: data.noteCount, people: data.people.length, personal: data.personal })}
          </p>

          {data.blocked ? (
            <p className="flex items-start gap-2 rounded-chip border border-line p-3 text-muted">
              <FolderLock size={16} aria-hidden className="mt-0.5 flex-none" />
              <span>{data.blocked}</span>
            </p>
          ) : null}

          <section>
            <h3 className="mb-2 font-semibold">People</h3>
            {data.youAreGuest ? (
              <p className="mb-3 text-footnote text-muted">
                This folder was shared with you{data.sharedBy ? ` by ${data.sharedBy}` : ""}. {data.ownerName ? `It belongs to ${data.ownerName}.` : ""} Only its owner{data.personal ? "" : " and the workspace’s admins"} can share it.
              </p>
            ) : !data.canManage ? (
              <p className="mb-3 text-footnote text-muted">Only the folder’s owner and the workspace’s owners and admins can share it.</p>
            ) : null}
            {data.canManage && !data.blocked ? (
              <form
                className="flex flex-wrap gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const to = email.trim();
                  if (!to || sending) return;
                  setSending(true);
                  try {
                    const r = await grant({ folderId, email: to, role });
                    toast.show(r.status === "invited" ? `Invitation sent to ${to}. They get access once they sign up and accept.` : "Shared", { tone: "success" });
                    setEmail("");
                  } catch (err) {
                    toast.show(errorMessage(err), { tone: "error" });
                  } finally {
                    setSending(false);
                  }
                }}
              >
                <label className="sr-only" htmlFor={`${uid}-email`}>
                  Email address
                </label>
                <input id={`${uid}-email`} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className="h-9 min-w-0 flex-1 ui-input rounded-chip px-3" />
                <Select aria-label="Role" value={role} onChange={(e) => setNewRole(e.target.value as ShareRole)} className="h-9 ui-input rounded-chip px-3">
                  <option value="viewer">Can view</option>
                  <option value="commenter">Can comment</option>
                  <option value="editor">Can edit</option>
                </Select>
                <Button type="submit" variant="primary" disabled={sending}>
                  Share
                </Button>
                <p className="w-full text-footnote text-muted">
                  {data.personal
                    ? "Anyone with an email address. People without a Folevi account get an invitation by email."
                    : "People outside the workspace join as guests on this folder only and aren’t billed. People without a Folevi account get an invitation by email."}
                </p>
              </form>
            ) : null}
            <ul className="mt-3 divide-y divide-line rounded-chip border border-line" aria-label="People with access">
              {data.people.length === 0 ? <li className="px-3 py-2.5 text-muted">{data.youAreGuest ? "It was shared with you through a folder above it." : "No one has been added to this folder yet."}</li> : null}
              {data.people.map((p) => (
                <li key={p.profileId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate font-medium">
                      <span className="truncate">{p.displayName}</span>
                      {p.isYou ? <span className="text-footnote font-normal text-muted">(you)</span> : null}
                      {p.guest ? <span className="flex-none rounded-chip border border-line px-1.5 py-px text-caption-2 font-medium text-muted">Guest</span> : null}
                    </span>
                    {p.email ? <span className="block truncate text-footnote text-muted">{p.email}</span> : null}
                  </span>
                  {p.canChange ? (
                    <>
                      <Select
                        aria-label={`Access for ${p.displayName}`}
                        value={p.role}
                        onChange={(e) => void run(setRole({ folderId, profileId: p.profileId, role: e.target.value as ShareRole }), "Access changed")}
                        className="h-8 ui-input rounded-chip px-2.5 text-footnote"
                      >
                        <option value="viewer">Can view</option>
                        <option value="commenter">Can comment</option>
                        <option value="editor">Can edit</option>
                      </Select>
                      <IconButton label={`Remove ${p.displayName}`} onClick={() => void run(revoke({ folderId, profileId: p.profileId }), "Removed")} className="hover:text-danger">
                        <Trash2 size={14} aria-hidden />
                      </IconButton>
                    </>
                  ) : (
                    <span className="text-footnote text-muted">{roleLabel(p.role)}</span>
                  )}
                  {p.isYou && data.youAreGuest ? (
                    <Button size="sm" variant="quiet" onClick={() => void run(revoke({ folderId, profileId: p.profileId }).then(onClose), "You left the folder")}>
                      Leave
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>

            {data.inherited.length ? (
              <>
                <h4 className="mb-1.5 mt-4 text-footnote font-semibold uppercase tracking-[0.06em] text-faint">From folders above</h4>
                <ul className="divide-y divide-line rounded-chip border border-line" aria-label="Access from folders above">
                  {data.inherited.flatMap((f) =>
                    f.people.map((p) => (
                      <li key={`${f.folderId}:${p.profileId}`} className="flex items-center gap-3 px-3 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {p.displayName}
                            {p.isYou ? <span className="ml-1.5 text-footnote font-normal text-muted">(you)</span> : null}
                          </span>
                          <span className="block truncate text-footnote text-muted">From folder {f.folderName || "Untitled"}</span>
                        </span>
                        <span className="text-footnote text-muted">{roleLabel(p.role)}</span>
                      </li>
                    )),
                  )}
                </ul>
              </>
            ) : null}

            {data.pendingInvites.length ? (
              <>
                <h4 className="mb-1.5 mt-4 text-footnote font-semibold uppercase tracking-[0.06em] text-faint">Invited by email</h4>
                <ul className="divide-y divide-line rounded-chip border border-line" aria-label="Invited by email">
                  {data.pendingInvites.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate">{i.email}</span>
                      <span className="text-footnote text-muted">
                        {roleLabel(i.role)} · {i.expired ? "expired" : "waiting to accept"}
                      </span>
                      <Button size="sm" variant="quiet" onClick={() => void run(revokeInvite({ inviteId: i.id }), "Invitation revoked")}>
                        Revoke
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          {data.youAreGuest ? (
            <p className="text-footnote text-muted">
              <AppLink href={`/shared/${folderId}`} className="underline underline-offset-2" onClick={onClose}>
                Open the shared folder
              </AppLink>
            </p>
          ) : (
            <p className="text-footnote text-muted">Public links are for single notes: share a note to make one.</p>
          )}
        </div>
      )}
    </Dialog>
  );
}
