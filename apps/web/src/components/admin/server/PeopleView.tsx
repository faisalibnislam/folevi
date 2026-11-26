"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { Check, QrCode as QrIcon, UserPlus } from "lucide-react";
import { QrCode } from "@/components/server/QrCode";
import { ShareLink } from "@/components/server/ShareLink";
import { useQueryState } from "@/lib/convex/queries";
import { serverAdminRefs, type InvitableRole, type ServerInvite, type ServerPerson, type ServerRole } from "@/lib/server-edition/refs";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { errorMessage, useToast } from "@/components/ui/Toast";
import { useAdmin } from "../AdminApp";
import { Badge, Callout, DataTable, DocTitle, EmptyRow, ErrorNotice, LoadingRows, PageHeader, Panel, Time, td, tdMid, th, thNum, tdNum, trHover, selectCls } from "../ui";
import { TextInput, bytesToGb, gbToBytes, useServerSettings } from "./kit";
import { ConnectAppsDialog } from "./OverviewView";

export const ROLE_NAMES: Record<ServerRole, string> = { owner: "Owner", admin: "Admin", member: "Member", guest: "Guest" };
const ROLE_HINTS: Record<InvitableRole, string> = {
  admin: "Manages people, sign-in, email and Foli AI",
  member: "Uses Folevi fully",
  guest: "Sees only what's shared with them",
};

function InvitePanel() {
  const admin = useAdmin();
  const { settings } = useServerSettings();
  const emailOn = settings ? settings.email.mode !== "off" : false;
  const invite = useMutation(serverAdminRefs.invite);
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("member");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ url: string; expiresAt: number; email: string; emailed: boolean } | null>(null);
  const roles: InvitableRole[] = admin.role === "super_admin" ? ["member", "admin", "guest"] : ["member", "guest"];
  return (
    <Panel
      title="Invite someone"
      description={
        emailOn ? (
          "Add their email to send the invite, or leave it empty and share the link or QR code yourself. Each invite works once, for 7 days."
        ) : (
          <>
            Make a link, then send it in a message or let them scan the QR code. Each invite works once, for 7 days. Email is off, so nothing is emailed (
            <Link href="/admin/email" className="underline underline-offset-2 hover:text-heading">
              turn it on
            </Link>
            ).
          </>
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
        <div className="space-y-1">
          <label htmlFor="invite-email" className="block text-subheadline font-medium text-ink">
            {emailOn ? "Email (optional)" : "Their email (optional, only they can use it)"}
          </label>
          <TextInput id="invite-email" type="email" inputMode="email" value={email} onChange={setEmail} placeholder="sam@example.com" />
        </div>
        <div className="space-y-1">
          <span id="invite-role" className="block text-subheadline font-medium text-ink">
            Role
          </span>
          <Select aria-labelledby="invite-role" value={role} onChange={(e) => setRole(e.target.value as InvitableRole)} className={`${selectCls} w-full`}>
            {roles.map((r) => (
              <option key={r} value={r} data-description={ROLE_HINTS[r]}>
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
                setMade({ url: r.url, expiresAt: r.expiresAt, email: to, emailed: Boolean((r as { emailed?: boolean }).emailed) });
                setEmail("");
              })
              .catch((e: unknown) => toast.show(errorMessage(e), { tone: "error" }))
              .finally(() => setBusy(false));
          }}
        >
          <UserPlus size={15} aria-hidden /> {busy ? "Making it…" : emailOn && email.trim() ? "Send invite" : "Make invite link"}
        </Button>
      </div>
      {made ? (
        <div className="mt-4 flex flex-col gap-4 rounded-control bg-[var(--glass-hover)] p-4 sm:flex-row sm:items-center" role="status">
          <div className="self-center">
            <QrCode value={made.url} label="QR code of the invite link" size={152} />
          </div>
          <div className="min-w-0 flex-1 space-y-2 text-subheadline">
            <p className="flex items-center gap-2 font-semibold text-heading">
              <Check size={15} aria-hidden /> {made.emailed ? `Invite emailed to ${made.email}` : made.email ? `Invite ready for ${made.email}` : "Invite link ready"}
            </p>
            <p className="text-muted">
              {made.emailed ? "You can also send them this link yourself. " : "Send them this link, or let them scan the code with their phone's camera. "}
              It works once, until <Time ts={made.expiresAt} />.
            </p>
            <ShareLink value={made.url} label="Invite link" shareTitle={`Join ${settings?.name ?? "our server"} on Folevi`} shareText={`Join ${settings?.name ?? "our Folevi server"}:`} qrFileName="folevi-invite.png" />
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
  // Only the invites still waiting; used, revoked and expired ones are history (the audit log has them).
  const rows = ((invites.data ?? []) as ServerInvite[]).filter((i) => i.state === "pending");
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
            return (
              <tr key={inv.inviteId} className={trHover}>
                <td className={tdMid}>{inv.email || <span className="text-muted">Anyone with the link</span>}</td>
                <td className={tdMid}>{ROLE_NAMES[inv.role]}</td>
                <td className={tdMid}>
                  <Time ts={inv.expiresAt} />
                </td>
                <td className={`${tdMid} text-right`}>
                  <Button variant="quiet" onClick={() => void revoke({ inviteId: inv.inviteId }).then(() => toast.show("Invite withdrawn."), (e: unknown) => toast.show(errorMessage(e), { tone: "error" }))}>
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
  const [ask, setAsk] = useState<null | "suspend" | "signout">(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const isOwner = person.role === "owner";
  const self = person.userId === admin.id;
  const roles: InvitableRole[] = owner ? ["admin", "member", "guest"] : ["member", "guest"];
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
            <Select aria-labelledby="person-role" value={person.role} disabled={busy} onChange={(e) => run(() => setRole({ userId: person.userId, role: e.target.value as InvitableRole }), "Role changed.")} className={`${selectCls} w-full`}>
              {roles.map((r) => (
                <option key={r} value={r} data-description={ROLE_HINTS[r]}>
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
            <TextInput id="person-quota" inputMode="numeric" value={quota} onChange={(v) => (setQuotaText(v), setQuotaError(null))} placeholder="The server's default" aria-invalid={quotaError ? true : undefined} />
            <Button
              disabled={busy}
              onClick={() => {
                const bytes = quota.trim() ? gbToBytes(quota.replace(",", ".")) : null;
                if (quota.trim() && (bytes === null || bytes === 0)) return setQuotaError("Enter a number of gigabytes, like 5 or 0.5. Leave it empty for the server's default.");
                run(() => setQuota({ userId: person.userId, quotaBytes: bytes }), bytes === null ? "Back to the server's default." : `Limit set to ${formatBytes(bytes)}.`);
              }}
            >
              Save
            </Button>
          </div>
          {quotaError ? (
            <p className="text-footnote text-danger" role="alert">
              {quotaError}
            </p>
          ) : (
            <p className="text-footnote text-muted">Uses {formatBytes(person.storageBytes)} now. Leave empty for the server&apos;s default. When they reach it, they can still read and edit, but not add files.</p>
          )}
        </div>
        {canManage || self ? (
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Button disabled={busy} onClick={() => setAsk("signout")}>
              Sign out everywhere
            </Button>
            {canManage ? (
              <Button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  resetPassword({ userId: person.userId })
                    .then((r) => {
                      const link = r.link;
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
                <Button disabled={busy} onClick={() => run(() => unsuspend({ userId: person.userId }), "Access restored.")}>
                  Restore access
                </Button>
              ) : (
                <Button disabled={busy} onClick={() => setAsk("suspend")}>
                  Suspend
                </Button>
              )
            ) : null}
            {owner && !isOwner ? (
              <Button disabled={busy} onClick={() => (setConfirm("transfer"), setTyped(""))}>
                Make owner
              </Button>
            ) : null}
            {canManage ? (
              <Button variant="danger" disabled={busy} onClick={() => (setConfirm("remove"), setTyped(""))}>
                Remove from server
              </Button>
            ) : null}
          </div>
        ) : null}
        {ask ? (
          <div className="space-y-2 rounded-control bg-[var(--glass-hover)] p-4" role="alertdialog" aria-label={ask === "suspend" ? "Suspend" : "Sign out everywhere"}>
            <p className="font-semibold text-heading">{ask === "suspend" ? `Suspend ${person.name || person.email}?` : `Sign ${person.name || person.email} out everywhere?`}</p>
            <p className="text-muted">
              {ask === "suspend"
                ? "They're signed out at once and can't sign in until you restore access. Their notes stay as they are."
                : "Every app and browser they use is signed out. They can sign in again with their password."}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="quiet" onClick={() => setAsk(null)}>
                Cancel
              </Button>
              <Button
                variant={ask === "suspend" ? "danger" : "primary"}
                disabled={busy}
                onClick={() => {
                  const which = ask;
                  setAsk(null);
                  if (which === "suspend") run(() => suspend({ userId: person.userId }), "Suspended. Their notes are kept.");
                  else run(() => endSessions({ userId: person.userId }), "Signed out everywhere.");
                }}
              >
                {ask === "suspend" ? "Suspend" : "Sign out everywhere"}
              </Button>
            </div>
          </div>
        ) : null}
        {resetLink ? (
          <div className="space-y-1.5">
            <p className="font-medium text-ink">One-time password reset link</p>
            <p className="text-footnote text-muted">Email is off on this server, so send them this link yourself, for example in a message. It works once, for an hour.</p>
            <ShareLink value={resetLink} label="Password reset link" shareTitle="Reset your Folevi password" />
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
              <Button variant="quiet" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
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
  const [apps, setApps] = useState(false);
  const { settings } = useServerSettings();
  const rows = (people.data ?? []) as ServerPerson[];
  const person = rows.find((p) => p.userId === open) ?? null;
  return (
    <>
      <DocTitle>People</DocTitle>
      <PageHeader
        title="People"
        description="Everyone with an account on this server. You see names, roles and sizes, never anyone's notes."
        actions={
          <Button onClick={() => setApps(true)}>
            <QrIcon size={15} aria-hidden /> Connect your apps
          </Button>
        }
      />
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
              {people.data && rows.length === 0 ? <EmptyRow colSpan={6}>Nobody yet. Invite someone above.</EmptyRow> : null}
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
                    <Button onClick={() => setOpen(p.userId)}>
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
      <ConnectAppsDialog open={apps} onClose={() => setApps(false)} serverName={settings?.name} />
    </>
  );
}
