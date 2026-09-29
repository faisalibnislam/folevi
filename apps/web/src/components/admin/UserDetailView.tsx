"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowUpCircle, Ban, CreditCard, KeyRound, LogOut, MailCheck, RotateCw, ShieldCheck, Trash2, UserCheck } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { formatBytes, formatDateTime } from "@/lib/format";
import { ActionDialog } from "./ActionDialog";
import { useAdmin } from "./AdminApp";
import { ROLE_LABEL, rolesFor, type AdminRole } from "./permissions";
import { PlanBadge, UserBillingPanel } from "./UserBillingPanel";
import { PersonalPlanDialog, type PersonalPlanTarget } from "./PlanDialog";
import { useAuditedLoad } from "./useAuditedLoad";
import { t } from "@/i18n";
import { VerificationBadges } from "./UsersView";
import { Badge, Callout, DataTable, DocTitle, EmptyRow, ErrorNotice, KeyValues, LoadingRows, Mono, ShortId, PageHeader, Panel, StatusBadge, Time, humanize, recordLink, td, tdNum, th, thNum } from "./ui";

type UserDetail = FunctionReturnType<typeof api.admin.viewUser>;
type ActionKind = "suspend" | "revoke" | "verify" | "reset" | "role" | "delete";

export function UserDetailView({ id }: { id: string }) {
  const admin = useAdmin();
  const view = useMutation(api.admin.viewUser);
  const { data: user, error, loading, refresh } = useAuditedLoad(id, (meta) => view({ profileId: id, ...meta }));
  // Their plan and billing (a separate audited read): the header's Change plan and the Plan & billing panel.
  const viewBilling = useMutation(api.adminBilling.userBilling);
  const billing = useAuditedLoad(id, (meta) => viewBilling({ profileId: id, ...meta }));
  const [action, setAction] = useState<ActionKind | null>(null);
  const [planFor, setPlanFor] = useState<PersonalPlanTarget | null>(null);

  if (error && !user) {
    return (
      <>
        <DocTitle>User</DocTitle>
        <PageHeader title="User" />
        <ErrorNotice error={error} onRetry={() => void refresh()} />
      </>
    );
  }
  if (!user) {
    return (
      <div aria-busy="true">
        <DocTitle>User</DocTitle>
        <PageHeader title={<span className="text-muted">Loading user…</span>} />
      </div>
    );
  }

  const b = billing.data;
  const canSetPlan = admin.can("billing.manage");
  const onFree = !b || b.entitlements.paidPlan === "free";
  // A plan billed through Polar still opens the dialog, which explains it's changed in Polar.
  const planBlocked = !canSetPlan ? rolesFor("billing.manage") : user.status === "deleted" ? "This account has been deleted." : null;
  const openPlan = () =>
    b &&
    setPlanFor({
      profileId: user.id,
      who: user.displayName || user.email,
      plan: b.entitlements.paidPlan,
      interval: b.entitlements.paidPlan === "free" ? null : (b.subscription.interval ?? "month"),
      endsAt: b.entitlements.paidPlan === "free" ? null : b.subscription.currentPeriodEnd,
      trialEndsAt: b.entitlements.trialing ? b.entitlements.trialEndsAt : null,
      polarBilled: b.polarBilled,
    });

  return (
    <>
      <DocTitle>{user.displayName || user.email}</DocTitle>
      <PageHeader
        eyebrow={
          <>
            <StatusBadge status={user.status} />
            {b ? <PlanBadge plan={b.entitlements.plan} trialing={b.entitlements.trialing} /> : null}
            <VerificationBadges emailVerified={user.emailVerified} mfaVerified={user.mfaVerified} />
            {user.platformRole ? <Badge tone="strong">{ROLE_LABEL[user.platformRole]}</Badge> : null}
          </>
        }
        title={user.displayName || "(no name)"}
        description={<span className="break-all">{user.email}</span>}
        actions={
          <>
            <Button size="sm" variant="quiet" onClick={() => void Promise.all([refresh(), billing.refresh()])} disabled={loading} aria-label="Reload user (writes an audit entry)">
              <RotateCw size={14} aria-hidden className={loading ? "animate-spin" : ""} /> Reload
            </Button>
            <Button size="sm" variant="primary" onClick={openPlan} disabled={!b || Boolean(planBlocked)} title={planBlocked ?? undefined}>
              {onFree ? <ArrowUpCircle size={14} aria-hidden /> : <CreditCard size={14} aria-hidden />}
              {onFree ? "Upgrade" : "Change plan"}
            </Button>
          </>
        }
      />
      {error ? (
        <div className="mb-4">
          <ErrorNotice error={error} onRetry={() => void refresh()} />
        </div>
      ) : null}

      {user.status === "suspended" && user.suspendedReason ? (
        <div className="mb-4">
          <Callout tone="danger" title="Suspended">
            {user.suspendedReason}
          </Callout>
        </div>
      ) : null}
      {user.status === "pending_deletion" ? (
        <div className="mb-4">
          <Callout tone="warning" title="Account deletion scheduled">
            Deletion runs {user.deletionScheduledFor ? formatDateTime(user.deletionScheduledFor) : "soon"}
            {user.deletionJob ? ` (job ${user.deletionJob.status})` : ""}. The person can cancel by signing in before then.
          </Callout>
        </div>
      ) : null}

      <UserActions user={user} role={admin.role} canManage={admin.can("users.manage")} selfId={admin.id} onAction={setAction} />

      <div className="mt-5 grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Panel title="Identity" description="Account metadata only. There is no way to view someone's documents from the admin console.">
          <KeyValues
            items={[
              { label: "Email", value: <span className="break-all">{user.email}</span> },
              { label: "User ID", value: <Mono wrap>{user.id}</Mono> },
              { label: "Auth subject", value: <Mono wrap>{user.authSubject}</Mono> },
              { label: "Auth issuer", value: <Mono wrap>{user.authIssuer}</Mono> },
              { label: "Created", value: formatDateTime(user.createdAt) },
              { label: "Last active", value: <Time ts={user.lastActiveAt} /> },
              { label: "Time zone", value: user.timeZone },
              { label: "Platform role", value: user.platformRole ? ROLE_LABEL[user.platformRole] : "None" },
            ]}
          />
        </Panel>
        <Panel title="Usage" description="Personal is theirs alone; team workspaces count on their own (documents include the team workspaces they own).">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Team workspaces", value: user.usage.workspaces.toLocaleString() },
              { label: "Personal documents", value: user.usage.personalDocuments.toLocaleString() },
              { label: "All documents", value: user.usage.documents.toLocaleString() },
              { label: "Personal storage", value: formatBytes(user.usage.storageBytes) },
            ].map((s) => (
              <div key={s.label} className="rounded-[10px] bg-[var(--glass-hover)] px-3 py-2.5">
                <dt className="text-[12px] font-medium text-muted">{s.label}</dt>
                <dd className="mt-0.5 ui-display text-[24px] leading-tight tabular-nums">{s.value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <UserBillingPanel profileId={user.id} email={user.email} name={user.displayName} workspaces={user.workspaces} billing={billing} />
        <Panel title="Sessions" description={t("admin.user.sessions", { active: user.sessions.filter((s) => !s.revokedAt).length, total: user.sessions.length })} flush>
          <DataTable caption="Sessions" minWidth={520}>
            <thead>
              <tr>
                <th scope="col" className={th}>Device</th>
                <th scope="col" className={th}>Client</th>
                <th scope="col" className={th}>Signed in</th>
                <th scope="col" className={th}>Last seen</th>
                <th scope="col" className={th}>State</th>
              </tr>
            </thead>
            <tbody>
              {user.sessions.length === 0 ? (
                <EmptyRow colSpan={5}>No sessions recorded.</EmptyRow>
              ) : (
                user.sessions.map((s) => (
                  <tr key={s.id}>
                    <td className={td}>{s.label}</td>
                    <td className={td}>{s.client === "mac" ? "Mac app" : "Web"}</td>
                    <td className={td}>
                      <Time ts={s.createdAt} />
                    </td>
                    <td className={td}>
                      <Time ts={s.lastSeenAt} />
                    </td>
                    <td className={td}>
                      {s.revokedAt ? (
                        <Badge title={formatDateTime(s.revokedAt)}>Revoked</Badge>
                      ) : (
                        <Badge tone="success">Active</Badge>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </Panel>

        <Panel title="Team workspaces" flush>
          <DataTable caption="Team workspaces" minWidth={520}>
            <thead>
              <tr>
                <th scope="col" className={th}>Workspace</th>
                <th scope="col" className={th}>Role</th>
                <th scope="col" className={th}>Status</th>
                <th scope="col" className={thNum}>Docs</th>
                <th scope="col" className={thNum}>Storage</th>
              </tr>
            </thead>
            <tbody>
              {user.workspaces.length === 0 ? (
                <EmptyRow colSpan={5}>Not a member of any team workspace. (Personal isn't a workspace: see Usage.)</EmptyRow>
              ) : (
                user.workspaces.map((w) => (
                  <tr key={w.id}>
                    <td className={td}>
                      <Link href={`/admin/workspaces/${w.id}`} className={recordLink}>
                        {w.name}
                      </Link>
                    </td>
                    <td className={td}>{humanize(w.role)}</td>
                    <td className={td}>
                      <StatusBadge status={w.status} />
                    </td>
                    <td className={tdNum}>{w.documentCount.toLocaleString()}</td>
                    <td className={tdNum}>{formatBytes(w.storageUsedBytes)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </Panel>

        <Panel title="Recent emails" description="Last 20 send attempts to this person" flush>
          <DataTable caption="Recent emails" minWidth={480}>
            <thead>
              <tr>
                <th scope="col" className={th}>Template</th>
                <th scope="col" className={th}>Status</th>
                <th scope="col" className={thNum}>Attempts</th>
                <th scope="col" className={th}>Error</th>
                <th scope="col" className={th}>When</th>
              </tr>
            </thead>
            <tbody>
              {user.emails.length === 0 ? (
                <EmptyRow colSpan={5}>No emails sent.</EmptyRow>
              ) : (
                user.emails.map((e) => (
                  <tr key={e.id}>
                    <td className={td}>
                      <Mono>{e.templateKey}</Mono>
                    </td>
                    <td className={td}>
                      <StatusBadge status={e.status} />
                    </td>
                    <td className={tdNum}>{e.attempts}</td>
                    <td className={td}>{e.errorCode ? <Mono>{e.errorCode}</Mono> : <span className="text-muted">None</span>}</td>
                    <td className={td}>
                      <Time ts={e.createdAt} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </Panel>

        <Panel title="Admin history" description="Audit entries that target this account, newest first" flush>
          <DataTable caption="Admin audit history for this user" minWidth={560}>
            <thead>
              <tr>
                <th scope="col" className={th}>Action</th>
                <th scope="col" className={th}>By</th>
                <th scope="col" className={th}>Reason</th>
                <th scope="col" className={th}>Request</th>
                <th scope="col" className={th}>When</th>
              </tr>
            </thead>
            <tbody>
              {loading && user.audit.length === 0 ? (
                <LoadingRows colSpan={5} rows={2} />
              ) : user.audit.length === 0 ? (
                <EmptyRow colSpan={5}>No admin activity.</EmptyRow>
              ) : (
                user.audit.map((h) => (
                  <tr key={`${h.requestId}-${h.createdAt}-${h.action}`}>
                    <td className={td}>
                      <Mono>{h.action}</Mono>
                    </td>
                    <td className={td}>{h.actor}</td>
                    <td className={`${td} max-w-[260px]`}>{h.reason ?? <span className="text-muted">None</span>}</td>
                    <td className={td}>
                      <ShortId value={h.requestId} head={4} tail={6} />
                    </td>
                    <td className={td}>
                      <Time ts={h.createdAt} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </Panel>
      </div>

      <UserActionDialogs user={user} action={action} onClose={() => setAction(null)} onDone={() => void refresh()} />
      <PersonalPlanDialog
        target={planFor}
        onClose={() => setPlanFor(null)}
        onDone={() => {
          void billing.refresh();
          void refresh();
        }}
      />
    </>
  );
}

function UserActions({ user, role, canManage, selfId, onAction }: { user: UserDetail; role: AdminRole; canManage: boolean; selfId: string; onAction: (a: ActionKind) => void }) {
  const isSelf = user.id === selfId;
  const deleted = user.status === "deleted";
  const suspended = user.status === "suspended";
  const canRole = role === "super_admin";
  const protectedSuper = user.platformRole === "super_admin" && role !== "super_admin";
  if (deleted) {
    return <Callout title="Account deleted">This account has been deleted. No actions are available.</Callout>;
  }
  const notes: string[] = [];
  if (isSelf) notes.push("You can't suspend your own account.");
  if (protectedSuper) notes.push("Only an owner can suspend another owner.");
  if (!canManage) notes.push(`Suspending, signing out and deleting accounts: ${rolesFor("users.manage")}`);
  if (!canRole) notes.push(`Platform roles: ${rolesFor("users.setRole")}`);
  if (user.platformRole) notes.push("Remove the platform role before scheduling deletion.");
  if (user.emailVerified) notes.push("Resend verification is only offered while the email is unverified.");
  return (
    <section aria-label="Account actions" className="ui-card p-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onAction("suspend")} disabled={!canManage || isSelf || protectedSuper}>
          {suspended ? <UserCheck size={14} aria-hidden /> : <Ban size={14} aria-hidden />}
          {suspended ? "Unsuspend…" : "Suspend…"}
        </Button>
        <Button size="sm" onClick={() => onAction("revoke")} disabled={!canManage}>
          <LogOut size={14} aria-hidden /> Revoke all sessions…
        </Button>
        {!user.emailVerified ? (
          <Button size="sm" onClick={() => onAction("verify")}>
            <MailCheck size={14} aria-hidden /> Resend verification…
          </Button>
        ) : null}
        <Button size="sm" onClick={() => onAction("reset")}>
          <KeyRound size={14} aria-hidden /> Send password reset…
        </Button>
        <Button size="sm" onClick={() => onAction("role")} disabled={!canRole} title={canRole ? undefined : rolesFor("users.setRole")}>
          <ShieldCheck size={14} aria-hidden /> Platform role…
        </Button>
        <Button size="sm" variant="danger" className="ml-auto" onClick={() => onAction("delete")} disabled={!canManage || Boolean(user.platformRole) || user.status === "pending_deletion"}>
          <Trash2 size={14} aria-hidden /> Schedule deletion…
        </Button>
      </div>
      {notes.length ? <p className="mt-2 px-0.5 text-xs text-muted">{notes.join(" ")}</p> : null}
    </section>
  );
}

function UserActionDialogs({ user, action, onClose, onDone }: { user: UserDetail; action: ActionKind | null; onClose: () => void; onDone: () => void }) {
  const suspend = useMutation(api.admin.suspendUser);
  const revoke = useMutation(api.admin.revokeAllSessions);
  const resend = useMutation(api.admin.resendVerification);
  const reset = useMutation(api.admin.initiatePasswordReset);
  const setRole = useMutation(api.admin.setPlatformRole);
  const schedule = useMutation(api.admin.scheduleAccountDeletion);
  const suspended = user.status === "suspended";
  const confirmEmail = { label: <>Type <strong className="break-all">{user.email}</strong> to confirm</>, expected: user.email, caseInsensitive: true };
  const done = (msg: string) => {
    onDone();
    return msg;
  };

  return (
    <>
      <ActionDialog
        open={action === "suspend"}
        onClose={onClose}
        title={suspended ? `Unsuspend ${user.displayName || user.email}?` : `Suspend ${user.displayName || user.email}?`}
        description={
          suspended
            ? "They will be able to sign in again. Sessions revoked by the suspension stay revoked."
            : "They are signed out everywhere, blocked at the identity provider and can't sign in until unsuspended. Their data is untouched."
        }
        confirmLabel={suspended ? "Unsuspend" : "Suspend account"}
        tone={suspended ? "primary" : "danger"}
        confirm={confirmEmail}
        onSubmit={async ({ reason, confirmValue, meta }) => {
          await suspend({ profileId: user.id, suspend: !suspended, confirmEmail: confirmValue, reason, ...meta });
          return done(suspended ? "Account unsuspended" : "Account suspended");
        }}
      />
      <ActionDialog
        open={action === "revoke"}
        onClose={onClose}
        title="Revoke all sessions?"
        description="Signs this person out on every browser and Mac. Their offline edits stay on their devices and sync after they sign in again."
        confirmLabel="Revoke sessions"
        tone="danger"
        onSubmit={async ({ reason, meta }) => {
          const r = await revoke({ profileId: user.id, reason, ...meta });
          return done(r.revoked === 1 ? "1 session revoked" : `${r.revoked} sessions revoked`);
        }}
      />
      <ActionDialog
        open={action === "verify"}
        onClose={onClose}
        title="Resend the verification email?"
        description={
          <>
            The identity provider sends a fresh verification link to <span className="break-all">{user.email}</span>. The link goes only to the person, never to you.
          </>
        }
        confirmLabel="Resend verification"
        onSubmit={async ({ reason, meta }) => {
          await resend({ profileId: user.id, reason, ...meta });
          return done("Verification email requested");
        }}
      />
      <ActionDialog
        open={action === "reset"}
        onClose={onClose}
        title="Send a password reset?"
        description="Only for resets the person asked for (for example through support, after verifying who they are). The reset link is emailed to them; you never see it."
        confirmLabel="Send reset email"
        acknowledge="The user asked for this password reset, and I verified the request came from them."
        onSubmit={async ({ reason, meta }) => {
          await reset({ profileId: user.id, userRequested: true, reason, ...meta });
          return done("Password reset email requested");
        }}
      />
      <ActionDialog
        open={action === "role"}
        onClose={onClose}
        title="Change platform role"
        description="Platform roles grant access to this console. Granting one requires a verified email and two-step verification (TOTP). At least one owner must remain."
        confirmLabel="Save role"
        confirm={confirmEmail}
        fields={[
          {
            name: "role",
            label: "Platform role",
            type: "select",
            initial: user.platformRole ?? "",
            options: [
              { value: "", label: "None (regular user)" },
              { value: "support_admin", label: "Support staff: look up people, resend emails, trials, exports" },
              { value: "ops_admin", label: "Admin: support access plus plans, AI credits, suspensions, quotas, configuration, revenue" },
              { value: "super_admin", label: "Owner: everything, including roles, refunds and maintenance" },
            ],
            validate: (v) => (v === (user.platformRole ?? "") ? "Choose a different role." : null),
          },
        ]}
        onSubmit={async ({ reason, confirmValue, fields, meta }) => {
          const role = (fields.role || null) as AdminRole | null;
          await setRole({ profileId: user.id, role, confirmEmail: confirmValue, reason, ...meta });
          return done(role ? `Role set to ${ROLE_LABEL[role]}` : "Platform role removed");
        }}
      >
        {!user.emailVerified || !user.mfaVerified ? (
          <Callout tone="warning">This person can't be given a role until their email is verified and TOTP is set up. Removing a role is always allowed.</Callout>
        ) : null}
      </ActionDialog>
      <ActionDialog
        open={action === "delete"}
        onClose={onClose}
        title="Schedule account deletion?"
        description="The account is locked now and permanently deleted after 7 days, including everything in their Personal. They get an email and can cancel by signing in during the grace period."
        confirmLabel="Schedule deletion"
        tone="danger"
        confirm={confirmEmail}
        onSubmit={async ({ reason, confirmValue, meta }) => {
          const r = await schedule({ profileId: user.id, confirmEmail: confirmValue, reason, ...meta });
          return done(`Deletion scheduled for ${formatDateTime(r.scheduledFor)}`);
        }}
      />
    </>
  );
}
