"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { Check, Copy, UserPlus } from "lucide-react";
import { useQueryState } from "@/lib/convex/queries";
import { serverAdminRefs, type ServerInvite, type ServerPerson, type ServerRole } from "@/lib/server-edition/refs";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { errorMessage, useToast } from "@/components/ui/Toast";
import { useAdmin } from "../AdminApp";
import { Badge, Callout, DataTable, DocTitle, EmptyRow, ErrorNotice, LoadingRows, PageHeader, Panel, Time, td, tdMid, th, thNum, tdNum, trHover } from "../ui";
import { TextInput, bytesToGb, gbToBytes } from "./kit";

export const ROLE_NAMES: Record<ServerRole, string> = { owner: "Owner", admin: "Admin", member: "Member", guest: "Guest" };
const ROLE_HINTS: Record<Exclude<ServerRole, "owner">, string> = {
  admin: "Manages people, sign-in, email and Foli AI",
  member: "Uses Folevi fully",
  guest: "Sees only what's shared with them",
};

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} className="ui-input h-9 min-w-0 flex-1 rounded-chip px-3 font-mono text-footnote text-ink" />
      <Button
        size="sm"
        onClick={() =>
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** A QR code of the invite link, for someone holding a phone next to the screen. */
function Qr({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void import("qrcode")
      .then(({ default: QRCode }) => QRCode.toDataURL(value, { margin: 1, width: 180, errorCorrectionLevel: "M", color: { dark: "#1D1814", light: "#FFFFFF" } }))
      .then((url) => alive && setSrc(url));
    return () => {
      alive = false;
    };
  }, [value]);
  return src ? <img src={src} alt="QR code of the invite link" width={180} height={180} className="rounded-control" /> : <div className="size-[180px] rounded-control bg-[var(--glass-hover)]" aria-hidden />;
}

function InvitePanel() {
  const admin = useAdmin();
  const invite = useMutation(serverAdminRefs.invite);
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ServerRole>("member");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ url: string; expiresAt: number; email: string } | null>(null);
  const roles: ServerRole[] = admin.role === "super_admin" ? ["member", "admin", "guest"] : ["member", "guest"];
  return (
    <Panel title="Invite someone" description="Send an invite by email, or share the link or QR code yourself. Each invite works once.">
      <div className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
        <div className="space-y-1">
          <label htmlFor="invite-email" className="block text-subheadline font-medium text-ink">
            Email (optional)
          </label>
          <TextInput id="invite-email" type="email" inputMode="email" value={email} onChange={setEmail} placeholder="sam@example.com" />
        </div>
        <div className="space-y-1">
          <span id="invite-role" className="block text-subheadline font-medium text-ink">
            Role
          </span>
          <Select aria-labelledby="invite-role" value={role} onChange={(e) => setRole(e.target.value as ServerRole)} className="w-full">
            {roles.map((r) => (
              <option key={r} value={r} data-description={ROLE_HINTS[r as Exclude<ServerRole, "owner">]}>
                {ROLE_NAMES[r]}
              </option>
            ))}
          </Select>
        </div>
        <Button
          variant="primary"
          disabled={busy}
          aria-busy={busy}
          onClick={() => {
            const to = email.trim();
            if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
              toast.show("Enter a valid email address, or leave it empty.", { tone: "error" });
              return;
            }
            setBusy(true);
            invite({ role, ...(to ? { email: to } : {}) })
              .then((r) => {
                setMade({ url: r.url, expiresAt: r.expiresAt, email: to });
                setEmail("");
              })
              .catch((e: unknown) => toast.show(errorMessage(e), { tone: "error" }))
              .finally(() => setBusy(false));
          }}
        >
          <UserPlus size={15} aria-hidden /> Create invite
        </Button>
      </div>
      {made ? (
        <div className="mt-4 flex flex-col gap-4 rounded-control bg-[var(--glass-hover)] p-4 sm:flex-row sm:items-center">
          <Qr value={made.url} />
          <div className="min-w-0 flex-1 space-y-2 text-subheadline">
            <p className="font-semibold text-heading">{made.email ? `Invite ready for ${made.email}` : "Invite link ready"}</p>
            <p className="text-muted">
              {made.email ? "If email is set up, it's on its way. You can also share this link. " : "Share this link or let them scan the code. "}
              It works until <Time ts={made.expiresAt} />.
            </p>
            <CopyField value={made.url} label="Invite link" />
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function InvitesList() {
  const invites = useQueryState(serverAdminRefs.listInvites, {});
  const revoke = useMutation(serverAdminRefs.revokeInvite);
  const toast = useToast();
  const rows = (invites.data ?? []) as ServerInvite[];
  if (invites.data && rows.length === 0) return null;
  return (
    <Panel title="Open invites" flush>
      <DataTable caption="Open invites" minWidth={520}>
        <thead>
          <tr>
            <th className={th}>For</th>
            <th className={th}>Role</th>
            <th className={th}>Expires</th>
            <th className={th}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {invites.data === undefined ? <LoadingRows colSpan={4} rows={2} /> : null}
          {rows.map((inv) => {
            const key = inv.token ?? inv.id ?? "";
            return (
              <tr key={key} className={trHover}>
                <td className={tdMid}>{inv.email || <span className="text-muted">Anyone with the link</span>}</td>
                <td className={tdMid}>{ROLE_NAMES[inv.role]}</td>
                <td className={tdMid}>
                  <Time ts={inv.expiresAt} />
                </td>
                <td className={`${tdMid} text-right`}>
                  <Button size="sm" variant="quiet" onClick={() => void revoke({ token: key }).then(() => toast.show("Invite withdrawn."), (e: unknown) => toast.show(errorMessage(e), { tone: "error" }))}>
                    Withdraw
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
    </Panel>
  );
}

function PersonDialog({ person, onClose }: { person: ServerPerson; onClose: () => void }) {
  const admin = useAdmin();
  const owner = admin.role === "super_admin";
  const toast = useToast();
  const setRole = useMutation(serverAdminRefs.setRole);
  const setQuota = useMutation(serverAdminRefs.setQuota);
  const suspend = useMutation(serverAdminRefs.suspend);
  const unsuspend = useMutation(serverAdminRefs.unsuspend);
  const endSessions = useMutation(serverAdminRefs.endSessions);
  const resetPassword = useMutation(serverAdminRefs.resetPassword);
  const removePerson = useMutation(serverAdminRefs.removePerson);
  const transfer = useMutation(serverAdminRefs.transferOwnership);
  const [quota, setQuotaText] = useState(bytesToGb(person.quotaBytes));
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "remove" | "transfer">(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const isOwner = person.role === "owner";
  const self = person.userId === admin.id;
  const roles: ServerRole[] = owner ? ["admin", "member", "guest"] : ["member", "guest"];
  // An admin can't change another admin or the owner (only the owner makes admins).
  const canManage = !isOwner && (owner || person.role !== "admin") && !self;

  const run = (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    fn()
      .then(() => toast.show(done, { tone: "success" }))
      .catch((e: unknown) => toast.show(errorMessage(e), { tone: "error" }))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open onClose={onClose} title={person.name || person.email} description={person.email} size="md">
      <div className="space-y-5 text-subheadline">
        {isOwner ? <Callout>This is the server&apos;s owner. Ownership can be handed to someone else from their row.</Callout> : null}
        {canManage ? (
          <div className="space-y-1.5">
            <span id="person-role" className="block font-medium text-ink">
              Role
            </span>
            <Select aria-labelledby="person-role" value={person.role} disabled={busy} onChange={(e) => run(() => setRole({ userId: person.userId, role: e.target.value as ServerRole }), "Role changed.")} className="w-full">
              {roles.map((r) => (
                <option key={r} value={r} data-description={ROLE_HINTS[r as Exclude<ServerRole, "owner">]}>
                  {ROLE_NAMES[r]}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <label htmlFor="person-quota" className="block font-medium text-ink">
            Storage limit in GB
          </label>
          <div className="flex gap-2">
            <TextInput id="person-quota" inputMode="numeric" value={quota} onChange={setQuotaText} placeholder="The server's default" />
            <Button disabled={busy} onClick={() => run(() => setQuota({ userId: person.userId, quotaBytes: quota.trim() ? gbToBytes(quota) : null }), "Storage limit saved.")}>
              Save
            </Button>
          </div>
          <p className="text-footnote text-muted">Uses {formatBytes(person.storageBytes)} now. Leave empty for the server&apos;s default.</p>
        </div>
        {canManage || self ? (
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Button size="sm" disabled={busy} onClick={() => run(() => endSessions({ userId: person.userId }), "Signed out everywhere.")}>
              Sign out everywhere
            </Button>
            {canManage ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  resetPassword({ userId: person.userId })
                    .then((r) => {
                      const link = r?.url ?? r?.link ?? null;
                      setResetLink(link);
                      toast.show(link ? "Reset link ready. Give it to them yourself." : "A reset link is on its way to them.", { tone: "success" });
                    })
                    .catch((e: unknown) => toast.show(errorMessage(e), { tone: "error" }))
                    .finally(() => setBusy(false));
                }}
              >
                Reset password
              </Button>
            ) : null}
            {canManage ? (
              person.suspended ? (
                <Button size="sm" disabled={busy} onClick={() => run(() => unsuspend({ userId: person.userId }), "Access restored.")}>
                  Restore access
                </Button>
              ) : (
                <Button size="sm" disabled={busy} onClick={() => run(() => suspend({ userId: person.userId }), "Suspended. Their notes are kept.")}>
                  Suspend
                </Button>
              )
            ) : null}
            {owner && !isOwner ? (
              <Button size="sm" disabled={busy} onClick={() => (setConfirm("transfer"), setTyped(""))}>
                Make owner
              </Button>
            ) : null}
            {canManage ? (
              <Button size="sm" variant="danger" disabled={busy} onClick={() => (setConfirm("remove"), setTyped(""))}>
                Remove from server
              </Button>
            ) : null}
          </div>
        ) : null}
        {resetLink ? (
          <div className="space-y-1.5">
            <p className="font-medium text-ink">One-time reset link</p>
            <CopyField value={resetLink} label="Password reset link" />
            <p className="text-footnote text-muted">Email is off on this server, so give them this link yourself. It works once.</p>
          </div>
        ) : null}
        {confirm ? (
          <div className="space-y-2 rounded-control bg-danger-soft p-4">
            <p className="font-semibold text-heading">
              {confirm === "remove" ? `Remove ${person.name || person.email} and everything in their library?` : `Make ${person.name || person.email} the owner? You'll become an admin.`}
            </p>
            <label htmlFor="confirm-email" className="block">
              Type their email to confirm.
            </label>
            <TextInput id="confirm-email" value={typed} onChange={setTyped} placeholder={person.email} />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="quiet" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={busy || typed.trim().toLowerCase() !== person.email.toLowerCase()}
                onClick={() => {
                  const which = confirm;
                  run(() => (which === "remove" ? removePerson({ userId: person.userId }) : transfer({ userId: person.userId })), which === "remove" ? "Removed from the server." : "Ownership handed over.");
                  setConfirm(null);
                  if (which === "remove") onClose();
                }}
              >
                {confirm === "remove" ? "Remove" : "Make owner"}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

/** People (plan §6): invite, roles, suspend, remove, reset passwords, end sessions, storage limits. */
export function ServerPeopleView() {
  const people = useQueryState(serverAdminRefs.listPeople, {});
  const [open, setOpen] = useState<string | null>(null);
  const rows = (people.data ?? []) as ServerPerson[];
  const person = rows.find((p) => p.userId === open) ?? null;
  return (
    <>
      <DocTitle>People</DocTitle>
      <PageHeader title="People" description="Everyone with an account on this server. You see names, roles and sizes, never anyone's notes." />
      <div className="space-y-4">
        <InvitePanel />
        <InvitesList />
        {people.error && !people.data ? <ErrorNotice error={people.error} /> : null}
        <Panel title="Accounts" flush>
          <DataTable caption="Accounts on this server" minWidth={760}>
            <thead>
              <tr>
                <th className={th}>Name</th>
                <th className={th}>Role</th>
                <th className={th}>Two-step</th>
                <th className={thNum}>Storage</th>
                <th className={th}>Last active</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {people.data === undefined ? <LoadingRows colSpan={6} /> : null}
              {people.data && rows.length === 0 ? <EmptyRow colSpan={6}>Nobody yet.</EmptyRow> : null}
              {rows.map((p) => (
                <tr key={p.userId} className={trHover}>
                  <td className={td}>
                    <span className="block font-semibold text-heading">{p.name || p.email}</span>
                    <span className="block text-footnote text-muted">{p.email}</span>
                  </td>
                  <td className={td}>
                    <span className="flex flex-wrap gap-1">
                      <Badge tone={p.role === "owner" ? "strong" : p.role === "admin" ? "outline" : "neutral"}>{ROLE_NAMES[p.role]}</Badge>
                      {p.suspended ? <Badge tone="danger">Suspended</Badge> : null}
                    </span>
                  </td>
                  <td className={td}>{p.twoFactor ? "On" : <span className="text-muted">Off</span>}</td>
                  <td className={tdNum}>
                    {formatBytes(p.storageBytes)}
                    {p.quotaBytes ? <span className="block text-footnote text-muted">of {formatBytes(p.quotaBytes)}</span> : null}
                  </td>
                  <td className={td}>{p.lastActiveAt ? <Time ts={p.lastActiveAt} /> : <span className="text-muted">Never</span>}</td>
                  <td className={`${tdMid} text-right`}>
                    <Button size="sm" onClick={() => setOpen(p.userId)}>
                      Manage
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      </div>
      {person ? <PersonDialog person={person} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
