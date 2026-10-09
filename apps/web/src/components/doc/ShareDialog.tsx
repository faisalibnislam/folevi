"use client";

import { DateTimeField, localDateTimeValue } from "@/components/ui/DateField";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Copy, Globe, Lock, Trash2, Users } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Dialog } from "@/components/ui/Dialog";
import { Button, IconButton } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";
import { Select } from "@/components/ui/Select";
import { useRadioGroup } from "@/lib/a11y/radioGroup";

/** `personal`: the page is in someone's Personal, which has no members. Only the people added here (and its owner) can open it. */
export function ShareDialog({ open, onClose, documentId, title, personal = false }: { open: boolean; onClose: () => void; documentId: string; title: string; personal?: boolean }) {
  const data = useQuery(api.sharing.get, open ? { documentId } : "skip");
  const setMode = useMutation(api.sharing.setAccessMode);
  const grant = useMutation(api.sharing.grant);
  const revoke = useMutation(api.sharing.revoke);
  const revokeInvite = useMutation(api.sharing.revokePageInvite);
  const createLink = useMutation(api.sharing.createPublicLink);
  const revokeLink = useMutation(api.sharing.revokePublicLink);
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "commenter" | "editor">("viewer");
  const [linkForm, setLinkForm] = useState({ expires: "", password: "" });
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const accessGroup = useRadioGroup();
  // Managers: access mode, public links, anyone's grants. Sharers (members who can edit): add people and
  // change what they added. The server checks both again.
  const canManage = data?.canManage === true;
  const canShare = data?.canShare === true;

  const run = async (p: Promise<unknown>, ok?: string) => {
    try {
      await p;
      if (ok) toast.show(ok, { tone: "success" });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    }
  };

  return (
    <Dialog open={open} onClose={() => { setFreshLink(null); onClose(); }} title={`Share “${title || "Untitled"}”`} size="md">
      {!data ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        // (Room below the last card, so it never sits on the dialog's bottom edge.)
        <div className="space-y-6 pb-3 text-sm">
          <section>
            <h3 className="mb-2 font-semibold">Who has access</h3>
            {personal ? (
              <p className="flex items-start gap-2 rounded-[6px] border border-line p-3 text-muted">
                <Lock size={16} aria-hidden className="mt-0.5 flex-none" />
                <span>This page is in a Personal space: only its owner and the people added below can open it.</span>
              </p>
            ) : (
              <div role="radiogroup" aria-label="Access" ref={accessGroup.ref} onKeyDown={accessGroup.onKeyDown} className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["workspace", "Workspace", "Everyone in this workspace, by their role", <Users key="u" size={16} />],
                    ["restricted", "Only invited people", "Owners, admins, the creator and people added below", <Lock key="l" size={16} />],
                  ] as const
                ).map(([mode, label, desc, icon]) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={data.accessMode === mode}
                    disabled={!canManage}
                    onClick={() => void run(setMode({ documentId, mode }))}
                    className={`flex items-start gap-2 rounded-[6px] border p-3 text-left disabled:opacity-60 ${data.accessMode === mode ? "border-accent bg-accent-soft" : "border-line"}`}
                  >
                    <span className="mt-0.5 text-muted" aria-hidden>
                      {icon}
                    </span>
                    <span>
                      <span className="block font-medium">{label}</span>
                      <span className="block text-xs text-muted">{desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 font-semibold">People</h3>
            {data.youAreGuest ? (
              <p className="mb-3 text-xs text-muted">
                You’re a guest on this page{data.sharedBy ? `, shared with you by ${data.sharedBy}` : ""}. {data.ownerName ? `It belongs to ${data.ownerName}.` : ""} Only its owner and the workspace’s members can share it.
              </p>
            ) : null}
            {canShare ? (
              <form
                className="flex flex-wrap gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const to = email.trim();
                  if (!to) return;
                  try {
                    const r = await grant({ documentId, email: to, role });
                    toast.show(r.status === "invited" ? `Invitation sent to ${to}. They get access once they sign up and accept.` : "Shared", { tone: "success" });
                    setEmail("");
                  } catch (err) {
                    toast.show(errorMessage(err), { tone: "error" });
                  }
                }}
              >
                <label className="sr-only" htmlFor="share-email">
                  Email address
                </label>
                <input id="share-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className="h-9 min-w-0 flex-1 ui-input rounded-[6px] px-3" />
                <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as typeof role)} className="h-9 ui-input rounded-[6px] px-3">
                  <option value="viewer">Can view</option>
                  <option value="commenter">Can comment</option>
                  <option value="editor">Can edit</option>
                </Select>
                <Button type="submit" variant="primary">
                  Share
                </Button>
                <p className="w-full text-xs text-muted">
                  {personal ? "Anyone with an email address: people without a Folevi account get an invitation by email." : "People outside the workspace join as guests on this page only and aren’t billed. People without a Folevi account get an invitation by email."}
                </p>
              </form>
            ) : null}
            <ul className="mt-3 divide-y divide-line rounded-[6px] border border-line">
              {data.people.length === 0 ? <li className="px-3 py-2.5 text-muted">{data.youAreGuest ? "It was shared with you through a page above it." : "No one has been added directly."}</li> : null}
              {data.people.map((p) => (
                <li key={p.profileId} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate font-medium">
                      <span className="truncate">{p.displayName}</span>
                      {p.isYou ? <span className="text-xs font-normal text-muted">(you)</span> : null}
                      {p.guest ? <span className="flex-none rounded-full border border-line px-1.5 py-px text-[11px] font-medium text-muted">Guest</span> : null}
                    </span>
                    {p.email ? <span className="block truncate text-xs text-muted">{p.email}</span> : null}
                  </span>
                  <span className="text-xs text-muted">{p.role === "editor" ? "Can edit" : p.role === "commenter" ? "Can comment" : "Can view"}</span>
                  {p.canChange ? (
                    <IconButton label={`Remove ${p.displayName}`} onClick={() => void run(revoke({ documentId, profileId: p.profileId }))} className="hover:text-danger">
                      <Trash2 size={14} aria-hidden />
                    </IconButton>
                  ) : null}
                </li>
              ))}
            </ul>
            {data.pendingInvites.length ? (
              <>
                <h4 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-[0.06em] text-faint">Invited by email</h4>
                <ul className="divide-y divide-line rounded-[6px] border border-line">
                  {data.pendingInvites.map((i) => (
                    <li key={i.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate">{i.email}</span>
                      <span className="text-xs text-muted">
                        {i.role === "editor" ? "Can edit" : i.role === "commenter" ? "Can comment" : "Can view"} · {i.expired ? "expired" : "waiting to accept"}
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

          {canManage ? (
            <section>
              <h3 className="mb-1 flex items-center gap-2 font-semibold">
                <Globe size={15} aria-hidden /> Public link
              </h3>
              <p className="text-xs text-muted">Off by default. Anyone with the link can read this page (not its comments or nested pages). Links aren’t indexed by search engines and can be revoked instantly.</p>
              {!data.publicLinksAvailable ? <p className="mt-2 text-xs text-warning">Public links are temporarily turned off for Folevi.</p> : null}
              {freshLink ? (
                <div className="mt-3 rounded-[6px] border border-success/40 bg-success-soft p-3">
                  <p className="text-xs font-medium">Copy this link now. For your security, it isn’t shown again.</p>
                  <div className="mt-2 flex gap-2">
                    <input readOnly value={freshLink} aria-label="Public link" className="h-9 min-w-0 flex-1 ui-well rounded-[6px] px-2 font-mono text-xs" onFocus={(e) => e.target.select()} />
                    <Button size="sm" onClick={() => void navigator.clipboard.writeText(freshLink).then(() => toast.show("Link copied"))}>
                      <Copy size={13} aria-hidden /> Copy
                    </Button>
                  </div>
                </div>
              ) : null}
              <ul className="mt-3 space-y-2">
                {data.links.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 rounded-[6px] border border-line px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-xs">…/s/{l.tokenHint}••••••••</span>
                      <span className="block text-xs text-muted">
                        {l.expired ? "Expired" : l.expiresAt ? `Expires ${formatDateTime(l.expiresAt)}` : "No expiry"}
                        {l.hasPassword ? " · Password protected" : ""} · {l.viewCount} view{l.viewCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    <Button size="sm" variant="quiet" className="text-danger" onClick={() => void run(revokeLink({ linkId: l.id }), "Link revoked")}>
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
              {data.publicLinksAvailable ? (
                <form
                  className="mt-3 space-y-3 rounded-[8px] bg-[color-mix(in_oklab,var(--color-ink)_4%,transparent)] p-3"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (linkForm.password && linkForm.password.length < 5) {
                      toast.show("Use a password of at least 5 characters.", { tone: "error" });
                      return;
                    }
                    try {
                      const r = await createLink({
                        documentId,
                        expiresAt: linkForm.expires ? new Date(linkForm.expires).getTime() : undefined,
                        password: linkForm.password || undefined,
                      });
                      setFreshLink(`${location.origin}/s/${r.token}`);
                      setLinkForm({ expires: "", password: "" });
                    } catch (err) {
                      toast.show(errorMessage(err), { tone: "error" });
                    }
                  }}
                >
                  <div className="grid items-center gap-x-3 gap-y-1.5 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
                    <span className="text-[13px] font-medium text-ink">Expires</span>
                    <DateTimeField
                      value={linkForm.expires ? new Date(linkForm.expires).getTime() : null}
                      onChange={(ts) => setLinkForm({ ...linkForm, expires: ts ? localDateTimeValue(ts) : "" })}
                      aria-label="Expiry"
                    />
                    <label htmlFor="share-link-password" className="text-[13px] font-medium text-ink">
                      Password
                    </label>
                    <input id="share-link-password" type="password" autoComplete="new-password" placeholder="None" value={linkForm.password} onChange={(e) => setLinkForm({ ...linkForm, password: e.target.value })} className="block h-9 w-full ui-input rounded-[6px] px-3 text-sm" />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" variant="primary">
                      <Globe size={14} aria-hidden /> Create link
                    </Button>
                  </div>
                </form>
              ) : null}
            </section>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
