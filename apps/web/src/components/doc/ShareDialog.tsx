"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Copy, Globe, Lock, Trash2, Users } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";
import { Select } from "@/components/ui/Select";

export function ShareDialog({ open, onClose, documentId, title }: { open: boolean; onClose: () => void; documentId: string; title: string }) {
  const data = useQuery(api.sharing.get, open ? { documentId } : "skip");
  const setMode = useMutation(api.sharing.setAccessMode);
  const grant = useMutation(api.sharing.grant);
  const revoke = useMutation(api.sharing.revoke);
  const createLink = useMutation(api.sharing.createPublicLink);
  const revokeLink = useMutation(api.sharing.revokePublicLink);
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "commenter" | "editor">("viewer");
  const [linkForm, setLinkForm] = useState({ expires: "", password: "" });
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const canManage = data?.yourAccess === "manage";

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
        <div className="space-y-6 text-sm">
          <section>
            <h3 className="mb-2 font-semibold">Who has access</h3>
            <div role="radiogroup" aria-label="Access" className="grid gap-2 sm:grid-cols-2">
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
          </section>

          <section>
            <h3 className="mb-2 font-semibold">People</h3>
            {canManage ? (
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!email.trim()) return;
                  void run(grant({ documentId, email, role }), "Shared").then(() => setEmail(""));
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
              </form>
            ) : null}
            <ul className="mt-3 divide-y divide-line rounded-[6px] border border-line">
              {data.people.length === 0 ? <li className="px-3 py-2.5 text-muted">No one has been added directly.</li> : null}
              {data.people.map((p) => (
                <li key={p.profileId} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.displayName}</span>
                    {p.email ? <span className="block truncate text-xs text-muted">{p.email}</span> : null}
                  </span>
                  <span className="text-xs text-muted">{p.role === "editor" ? "Can edit" : p.role === "commenter" ? "Can comment" : "Can view"}</span>
                  {canManage ? (
                    <button type="button" aria-label={`Remove ${p.displayName}`} onClick={() => void run(revoke({ documentId, profileId: p.profileId }))} className="text-faint hover:text-danger">
                      <Trash2 size={14} aria-hidden />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
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
                  <p className="text-xs font-medium">Copy this link now — for your security it isn’t shown again.</p>
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
                  className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                  onSubmit={async (e) => {
                    e.preventDefault();
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
                  <label className="text-xs">
                    Expires (optional)
                    <input type="datetime-local" value={linkForm.expires} onChange={(e) => setLinkForm({ ...linkForm, expires: e.target.value })} className="mt-1 block h-9 w-full ui-input rounded-[6px] px-2" />
                  </label>
                  <label className="text-xs">
                    Password (optional, 8+ characters)
                    <input type="password" autoComplete="new-password" minLength={8} value={linkForm.password} onChange={(e) => setLinkForm({ ...linkForm, password: e.target.value })} className="mt-1 block h-9 w-full ui-input rounded-[6px] px-2" />
                  </label>
                  <Button type="submit" className="self-end">
                    Create link
                  </Button>
                </form>
              ) : null}
            </section>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
