"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation } from "convex/react";
import { Ban, CreditCard, Gauge, RotateCw, Undo2 } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { formatBytes, formatDateTime } from "@/lib/format";
import { ActionDialog } from "./ActionDialog";
import { useAdmin } from "./AdminApp";
import { rolesFor } from "./permissions";
import { endOfDay, futureDate } from "./UserBillingPanel";
import { PLAN_CATALOG, WORKSPACE_PLANS, formatPrice, planName, seatChargeCents, type WorkspacePlanId, type WorkspaceTier } from "@/lib/plans";
import { useAuditedLoad } from "./useAuditedLoad";
import { t } from "@/i18n";
import { Badge, Callout, DataTable, DocTitle, EmptyRow, ErrorNotice, KeyValues, Meter, Mono, PageHeader, Panel, StatusBadge, Time, humanize, td, th } from "./ui";

const GB = 1024 ** 3;

export function WorkspaceDetailView({ id }: { id: string }) {
  const admin = useAdmin();
  const view = useMutation(api.admin.viewWorkspace);
  const setSuspended = useMutation(api.admin.setWorkspaceSuspended);
  const setQuota = useMutation(api.admin.setWorkspaceQuota);
  const setPlan = useMutation(api.adminBilling.setWorkspacePlan);
  const { data: w, error, loading, refresh } = useAuditedLoad(id, (meta) => view({ workspaceId: id, ...meta }));
  const [action, setAction] = useState<"suspend" | "quota" | "plan" | null>(null);

  if (error && !w) {
    return (
      <>
        <DocTitle>Workspace</DocTitle>
        <PageHeader title="Workspace" breadcrumb={{ href: "/admin/workspaces", label: "Workspaces" }} />
        <ErrorNotice error={error} onRetry={() => void refresh()} />
      </>
    );
  }
  if (!w) {
    return (
      <div aria-busy="true">
        <DocTitle>Workspace</DocTitle>
        <PageHeader title={<span className="text-muted">Loading workspace…</span>} breadcrumb={{ href: "/admin/workspaces", label: "Workspaces" }} />
      </div>
    );
  }

  const suspended = w.status === "suspended";
  const canQuota = admin.can("workspaces.quota");
  const canSuspend = admin.can("workspaces.suspend");
  const canSeeUsers = admin.can("users.view");
  const owners = w.members.filter((m) => m.role === "owner");
  const canSetPlan = admin.can("billing.manage");
  const b = w.billing;
  const stripeLive = b.subscription?.provider === "stripe" && b.paid;

  return (
    <>
      <DocTitle>{w.name}</DocTitle>
      <PageHeader
        breadcrumb={{ href: "/admin/workspaces", label: "Workspaces" }}
        eyebrow={
          <>
            <StatusBadge status={w.status} />
          </>
        }
        title={w.name}
        description={
          <>
            <Mono>{w.id}</Mono> · created {formatDateTime(w.createdAt)}
          </>
        }
        actions={
          <Button size="sm" variant="quiet" onClick={() => void refresh()} disabled={loading} aria-label="Reload workspace (writes an audit entry)">
            <RotateCw size={14} aria-hidden className={loading ? "animate-spin" : ""} /> Reload
          </Button>
        }
      />
      {error ? (
        <div className="mb-4">
          <ErrorNotice error={error} onRetry={() => void refresh()} />
        </div>
      ) : null}
      {suspended ? (
        <div className="mb-4">
          <Callout tone="danger" title="Suspended">
            Everyone except the owners is limited to read-only access. Nothing has been deleted.
          </Callout>
        </div>
      ) : null}

      <section aria-label="Workspace actions" className="flex flex-wrap items-center gap-2 ui-card rounded-[8px] p-3">
        <Button size="sm" variant={suspended ? "secondary" : "danger"} onClick={() => setAction("suspend")} disabled={!canSuspend || w.status === "deleting"}>
          {suspended ? <Undo2 size={14} aria-hidden /> : <Ban size={14} aria-hidden />}
          {suspended ? "Unsuspend…" : "Suspend…"}
        </Button>
        <Button size="sm" onClick={() => setAction("quota")} disabled={!canQuota}>
          <Gauge size={14} aria-hidden /> Set quota…
        </Button>
        <Button size="sm" onClick={() => setAction("plan")} disabled={!canSetPlan || stripeLive || w.status === "deleting"} title={stripeLive ? "Billed through Stripe. Change it there" : undefined}>
          <CreditCard size={14} aria-hidden /> Set plan…
        </Button>
        {!canQuota ? <span className="text-xs text-muted">Suspending and quotas: {rolesFor("workspaces.quota")}</span> : null}
      </section>

      <div className="mt-5 grid gap-4 xl:grid-cols-[2fr_3fr]">
        <Panel title="Usage & quotas">
          <div className="grid gap-4">
            <div>
              <div className="mb-1.5 flex justify-between text-[13px]">
                <span className="text-muted">Storage · {w.storageOverridden ? "custom limit" : w.planName}</span>
                <span className="tabular-nums">
                  {formatBytes(w.storageUsedBytes)} of {formatBytes(w.storageQuotaBytes)}
                </span>
              </div>
              <Meter value={w.storageUsedBytes} max={w.storageQuotaBytes} label="Storage used of quota" />
            </div>
            <div>
              <div className="mb-1.5 flex justify-between text-[13px]">
                <span className="text-muted">Members</span>
                <span className="tabular-nums">
                  {w.members.length} of {w.memberLimit}
                </span>
              </div>
              <Meter value={w.members.length} max={w.memberLimit} label="Members of member limit" />
            </div>
            <KeyValues
              items={[
                { label: "Documents", value: w.documentCount.toLocaleString() },
                { label: "Owners", value: owners.length ? owners.map((o) => o.displayName || o.email).join(", ") : "None" },
                { label: "Pending invites", value: w.invites.filter((i) => i.status === "pending").length },
              ]}
            />
          </div>
        </Panel>

        <Panel title="Plan & billing" description="The workspace's own plan, billed per member seat (never its owner's Personal plan).">
          <KeyValues
            items={[
              { label: "Plan", value: <Badge tone={b.paid ? "plum" : "neutral"}>{planName(b.planId as WorkspacePlanId)}</Badge> },
              { label: "Provider", value: b.subscription ? humanize(b.subscription.provider) : "None" },
              { label: "Status", value: b.subscription ? <StatusBadge status={b.subscription.cancelAtPeriodEnd && b.paid ? "cancel_scheduled" : b.subscription.status} /> : "None" },
              { label: "Billable seats", value: `${b.seats}${b.subscription?.quantity !== null && b.subscription?.quantity !== undefined && b.subscription.quantity !== b.seats ? ` (billed: ${b.subscription.quantity})` : ""}` },
              { label: "Guests (not billed)", value: b.guests },
              { label: "Estimated charge", value: b.paid ? `${b.seats} × ${formatPrice(b.seatPriceCents)} = ${formatPrice(seatChargeCents(b.seatPriceCents, b.seats))}/${PLAN_CATALOG[b.planId as WorkspacePlanId].interval === "year" ? "year" : "month"}` : "None" },
              { label: "Renews / ends", value: b.subscription?.currentPeriodEnd ? <Time ts={b.subscription.currentPeriodEnd} /> : "Not set" },
              { label: "Stripe customer", value: b.subscription?.stripeCustomerId ? <Mono>{b.subscription.stripeCustomerId}</Mono> : "None" },
            ]}
          />
        </Panel>

        <Panel title="Workspace payments" description="This workspace only." flush>
          <DataTable caption="Workspace payments" minWidth={480}>
            <thead>
              <tr>
                <th scope="col" className={th}>Date</th>
                <th scope="col" className={th}>Plan</th>
                <th scope="col" className={th}>Amount</th>
                <th scope="col" className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {b.payments.length === 0 ? (
                <EmptyRow colSpan={4}>No payments.</EmptyRow>
              ) : (
                b.payments.map((p) => (
                  <tr key={p.id}>
                    <td className={td}>
                      <Time ts={p.createdAt} />
                    </td>
                    <td className={td}>
                      {p.plan === "team" || p.plan === "business" ? WORKSPACE_PLANS[p.plan as WorkspaceTier].name : humanize(p.plan)} · {p.interval === "year" ? "yearly" : "monthly"}
                      {p.quantity ? ` · ${p.quantity} seats` : ""}
                    </td>
                    <td className={`${td} tabular-nums`}>
                      {formatPrice(p.amountCents)} {p.currency.toUpperCase()}
                    </td>
                    <td className={td}>
                      <StatusBadge status={p.status} /> {p.provider === "test" ? <Badge>test</Badge> : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </Panel>

        <Panel title="Members" description={t("admin.workspace.members", { count: w.members.length })} flush>
          <DataTable caption="Workspace members" minWidth={520}>
            <thead>
              <tr>
                <th scope="col" className={th}>Name</th>
                <th scope="col" className={th}>Email</th>
                <th scope="col" className={th}>Role</th>
                <th scope="col" className={th}>Joined</th>
              </tr>
            </thead>
            <tbody>
              {w.members.length === 0 ? (
                <EmptyRow colSpan={4}>No members.</EmptyRow>
              ) : (
                w.members.map((m) => (
                  <tr key={m.profileId}>
                    <td className={td}>
                      {canSeeUsers ? (
                        <Link href={`/admin/users/${m.profileId}`} className="font-medium underline decoration-line-strong underline-offset-2 hover:decoration-ink">
                          {m.displayName || "(no name)"}
                        </Link>
                      ) : (
                        m.displayName
                      )}
                    </td>
                    <td className={`${td} break-all`}>{m.email}</td>
                    <td className={td}>{m.role === "owner" ? <Badge tone="plum">Owner</Badge> : humanize(m.role)}</td>
                    <td className={td}>
                      <Time ts={m.joinedAt} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </Panel>

        <Panel title="Invites" description="Recipient addresses are redacted." flush>
          <DataTable caption="Workspace invites" minWidth={480}>
            <thead>
              <tr>
                <th scope="col" className={th}>Recipient</th>
                <th scope="col" className={th}>Role</th>
                <th scope="col" className={th}>Status</th>
                <th scope="col" className={th}>Sent</th>
                <th scope="col" className={th}>Expires</th>
              </tr>
            </thead>
            <tbody>
              {w.invites.length === 0 ? (
                <EmptyRow colSpan={5}>No invites.</EmptyRow>
              ) : (
                w.invites.map((i, idx) => (
                  <tr key={`${i.email}-${i.createdAt}-${idx}`}>
                    <td className={td}>
                      <Mono>{i.email}</Mono>
                    </td>
                    <td className={td}>{humanize(i.role)}</td>
                    <td className={td}>
                      <StatusBadge status={i.status} />
                    </td>
                    <td className={td}>
                      <Time ts={i.createdAt} />
                    </td>
                    <td className={td}>
                      <Time ts={i.expiresAt} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </Panel>

        <Panel title="Admin history" description="Audit entries that target this workspace" flush>
          <DataTable caption="Admin audit history for this workspace" minWidth={420}>
            <thead>
              <tr>
                <th scope="col" className={th}>Action</th>
                <th scope="col" className={th}>Reason</th>
                <th scope="col" className={th}>When</th>
              </tr>
            </thead>
            <tbody>
              {w.audit.length === 0 ? (
                <EmptyRow colSpan={3}>No admin activity.</EmptyRow>
              ) : (
                w.audit.map((h, idx) => (
                  <tr key={`${h.createdAt}-${idx}`}>
                    <td className={td}>
                      <Mono>{h.action}</Mono>
                    </td>
                    <td className={td}>{h.reason ?? <span className="text-muted">None</span>}</td>
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

      <ActionDialog
        open={action === "suspend"}
        onClose={() => setAction(null)}
        title={suspended ? `Unsuspend “${w.name}”?` : `Suspend “${w.name}”?`}
        description={suspended ? "Members regain normal access." : "Everyone except the owners becomes read-only. Nothing is deleted, and it can be undone."}
        confirmLabel={suspended ? "Unsuspend workspace" : "Suspend workspace"}
        tone={suspended ? "primary" : "danger"}
        confirm={{ label: <>Type the workspace name <strong>{w.name}</strong> to confirm</>, expected: w.name }}
        onSubmit={async ({ reason, confirmValue, meta }) => {
          await setSuspended({ workspaceId: w.id, suspended: !suspended, confirmName: confirmValue, reason, ...meta });
          void refresh();
          return suspended ? "Workspace unsuspended" : "Workspace suspended";
        }}
      />
      <ActionDialog
        open={action === "plan"}
        onClose={() => setAction(null)}
        title={`Set the plan for “${w.name}”`}
        description="For comps, offline purchases, or a paid plan before online payments are set up. Nobody is charged; seats are counted but not billed. Without an end date the plan stays until someone changes it."
        confirmLabel="Save plan"
        fields={[
          {
            name: "plan",
            label: "Plan",
            type: "select",
            initial: b.planId,
            options: (["workspace_free", "workspace_team_monthly", "workspace_team_yearly", "workspace_business_monthly", "workspace_business_yearly"] as const).map((id) => ({
              value: id,
              label: `${planName(id)}${PLAN_CATALOG[id].interval ? ` (${PLAN_CATALOG[id].interval === "year" ? "yearly" : "monthly"}, ${formatPrice(PLAN_CATALOG[id].priceCents)} per member)` : ""}`,
            })),
            hint: "Manual plans aren't counted in recurring revenue.",
          },
          { name: "until", label: "Ends on (optional)", type: "text", initial: "", hint: "YYYY-MM-DD. After this date the workspace goes back to Workspace Free.", validate: futureDate },
        ]}
        onSubmit={async ({ reason, fields, meta }) => {
          const planId = fields.plan as WorkspacePlanId;
          await setPlan({ workspaceId: w.id, planId, until: endOfDay(fields.until ?? ""), reason, ...meta });
          void refresh();
          return `Plan set to ${planName(planId)}`;
        }}
      />
      <ActionDialog
        open={action === "quota"}
        onClose={() => setAction(null)}
        title="Set workspace quota"
        description={`Currently ${formatBytes(w.storageQuotaBytes)} storage (${w.storageOverridden ? "a custom limit" : `from ${w.planName}`}) and ${w.memberLimit} members. A different storage value replaces the plan's for this workspace. Lowering a quota below current usage blocks new uploads or invites; nothing is removed.`}
        confirmLabel="Save quota"
        fields={[
          {
            name: "storageGb",
            label: "Storage quota",
            type: "number",
            initial: String(Math.round((w.storageQuotaBytes / GB) * 100) / 100),
            min: 0,
            max: 10_000,
            step: "any",
            suffix: "GB",
            hint: `In use: ${formatBytes(w.storageUsedBytes)}. 1 GB = 1024³ bytes.`,
          },
          {
            name: "memberLimit",
            label: "Member limit",
            type: "number",
            initial: String(w.memberLimit),
            min: 1,
            max: 10_000,
            step: 1,
            suffix: "members",
            hint: `Current members: ${w.members.length}.`,
            validate: (v) => (Number.isInteger(Number(v)) ? null : "Use a whole number."),
          },
        ]}
        onSubmit={async ({ reason, fields, meta }) => {
          await setQuota({
            workspaceId: w.id,
            storageQuotaBytes: Math.round(Number(fields.storageGb) * GB),
            memberLimit: Number(fields.memberLimit),
            reason,
            ...meta,
          });
          void refresh();
          return "Quota updated";
        }}
      />
    </>
  );
}
