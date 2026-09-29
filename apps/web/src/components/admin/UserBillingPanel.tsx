"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AiIcon } from "@/components/ai/AiIcon";
import { CalendarPlus, CreditCard, FileArchive, HardDrive, MonitorSmartphone, RotateCw, Undo2 } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { formatBytes, formatDateTime } from "@/lib/format";
import { PLANS, formatPrice, isPaidPlan, personalPlanId, type PersonalTier } from "@/lib/plans";
import { ActionDialog } from "./ActionDialog";
import { useAdmin } from "./AdminApp";
import { maxTrialDays, rolesFor } from "./permissions";
import { useAuditedLoad } from "./useAuditedLoad";
import { Badge, Callout, DataTable, EmptyRow, ErrorNotice, KeyValues, Meter, Panel, StatusBadge, Time, humanize, td, tdNum, th, thNum } from "./ui";

type Billing = FunctionReturnType<typeof api.adminBilling.userBilling>;
type Kind = "plan" | "trial" | "ai" | "storage" | "devices" | "export" | { refund: Billing["payments"][number] };

const DAY = 86_400_000;
/** Storage limits read better as whole gigabytes ("50 GB", not "50.00 GB"). */
const limit = (bytes: number) => (bytes % 1024 ** 3 === 0 ? `${bytes / 1024 ** 3} GB` : formatBytes(bytes));
const day = (ts: number) => new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const PLAN_TONE: Record<PersonalTier, "neutral" | "accent" | "plum"> = { free: "neutral", basic: "accent", pro: "plum" };

/** Parses a YYYY-MM-DD field (end of that day, UTC) or "" → null. */
function endOfDay(value: string): number | null {
  if (!value) return null;
  const t = Date.parse(`${value}T23:59:59Z`);
  return Number.isFinite(t) ? t : null;
}
const futureDate = (v: string) => {
  if (!v) return null;
  const t = endOfDay(v);
  return t === null ? "Use a date like 2026-12-31." : t <= Date.now() ? "Choose a date in the future." : null;
};

export function PlanBadge({ plan, trialing }: { plan: PersonalTier; trialing?: boolean }) {
  return (
    <Badge tone={PLAN_TONE[plan]} title={trialing ? "On a Pro trial" : undefined}>
      {PLANS[plan].name}
      {trialing ? " · trial" : ""}
    </Badge>
  );
}

/**
 * One person's plan, storage, AI access and payments, with the billing actions their role allows.
 * Loading it is an audited read (adminBilling.userBilling), like the rest of the user page.
 */
export function UserBillingPanel({ profileId, email, name }: { profileId: string; email: string; name: string }) {
  const admin = useAdmin();
  const view = useMutation(api.adminBilling.userBilling);
  const { data, error, loading, refresh } = useAuditedLoad(profileId, (meta) => view({ profileId, ...meta }));
  const [action, setAction] = useState<Kind | null>(null);

  if (!data) {
    return (
      <Panel title="Plan & billing">
        {error ? <ErrorNotice error={error} onRetry={() => void refresh()} /> : <p className="text-sm text-muted">Loading…</p>}
      </Panel>
    );
  }

  const { subscription: sub, entitlements: e } = data;
  const canManage = admin.can("billing.manage");
  const stripeBilled = sub.provider === "stripe" && sub.status !== "canceled" && isPaidPlan(personalPlanId(sub.plan, sub.interval));
  const paidPlan = sub.plan as PersonalTier;
  const who = name || email;

  return (
    <>
      <Panel
        title="Plan & billing"
        description="Personal plan, personal storage and AI access in Personal. Team workspaces have their own plans. Changes here don't charge or refund anyone — money only moves through the payment provider."
        actions={
          <Button size="sm" variant="quiet" onClick={() => void refresh()} disabled={loading} aria-label="Reload billing (writes an audit entry)">
            <RotateCw size={14} aria-hidden className={loading ? "animate-spin" : ""} />
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <PlanBadge plan={e.plan} trialing={e.trialing} />
          {e.trialing && e.trialEndsAt ? <span className="text-sm text-muted">Trial ends {day(e.trialEndsAt)} · pays for {PLANS[e.paidPlan].name}</span> : null}
          {sub.cancelAtPeriodEnd ? <Badge tone="warning">Cancels at period end</Badge> : null}
          {sub.status === "past_due" ? <Badge tone="danger">Payment past due</Badge> : null}
          {sub.aiGrant ? <Badge tone="plum">AI granted</Badge> : null}
        </div>

        <div className="mt-4">
          <KeyValues
            items={[
              { label: "Plan", value: `${PLANS[paidPlan].name}${sub.interval ? ` · ${sub.interval === "year" ? "yearly" : "monthly"}` : ""}` },
              { label: "Billed through", value: humanize(sub.provider === "none" ? "not billed" : sub.provider) },
              { label: "Status", value: <StatusBadge status={sub.status} /> },
              { label: sub.cancelAtPeriodEnd ? "Ends" : "Renews / ends", value: sub.currentPeriodEnd ? formatDateTime(sub.currentPeriodEnd) : "—" },
              { label: "Paying since", value: sub.paidSince ? day(sub.paidSince) : "—" },
              {
                label: "AI Assistant",
                value: e.ai ? (e.aiSource === "grant" ? `On — granted${sub.aiGrantUntil ? ` until ${day(sub.aiGrantUntil)}` : ""}` : e.aiSource === "trial" ? "On — trial" : "On — Pro") : "Off",
              },
              { label: "AI requests, 30 days", value: data.aiRequests30d.toLocaleString() },
              {
                label: "Devices",
                value: `${data.devicesActive} signed in · ${e.devices === null ? "unlimited" : `limit ${e.devices}`}${sub.deviceLimitOverride !== null ? " (custom)" : ""}`,
              },
            ]}
          />
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between text-[12.5px]">
            <span className="text-muted">
              Personal storage{sub.storageOverrideBytes ? " (custom limit)" : ""}
            </span>
            <span className="tabular-nums">
              {formatBytes(data.storageUsedBytes)} of {limit(data.storageLimitBytes)}
            </span>
          </div>
          <Meter value={data.storageUsedBytes} max={data.storageLimitBytes} label="Personal storage used" />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setAction("plan")} disabled={!canManage || stripeBilled} title={!canManage ? rolesFor("billing.manage") : stripeBilled ? "Billed through Stripe — change it there." : undefined}>
            <CreditCard size={14} aria-hidden /> Set plan…
          </Button>
          <Button size="sm" onClick={() => setAction("trial")}>
            <CalendarPlus size={14} aria-hidden /> {e.trialing ? "Extend trial…" : "Give Pro trial…"}
          </Button>
          <Button size="sm" onClick={() => setAction("ai")} disabled={!canManage} title={canManage ? undefined : rolesFor("billing.manage")}>
            <AiIcon size={14} aria-hidden /> {sub.aiGrant ? "AI access…" : "Grant AI…"}
          </Button>
          <Button size="sm" onClick={() => setAction("storage")} disabled={!canManage} title={canManage ? undefined : rolesFor("billing.manage")}>
            <HardDrive size={14} aria-hidden /> Storage limit…
          </Button>
          <Button size="sm" onClick={() => setAction("devices")} disabled={!canManage} title={canManage ? undefined : rolesFor("billing.manage")}>
            <MonitorSmartphone size={14} aria-hidden /> Device limit…
          </Button>
          <Button size="sm" variant="quiet" className="ml-auto" onClick={() => setAction("export")} disabled={data.personalDocuments === 0} title={data.personalDocuments === 0 ? "Their Personal has no notes yet." : undefined}>
            <FileArchive size={14} aria-hidden /> Prepare export for user…
          </Button>
        </div>
        {!canManage ? <p className="mt-2 text-xs text-muted">Plans, AI grants and storage limits: {rolesFor("billing.manage")} Trials: up to {maxTrialDays(admin.role)} days.</p> : null}
        {stripeBilled ? <p className="mt-2 text-xs text-muted">This plan is billed through Stripe. Change or cancel it in the Stripe dashboard; Folevi updates when Stripe tells it.</p> : null}
      </Panel>

      <Panel title="Payments" description="Newest first. Test purchases (made in development) are marked." flush>
        <DataTable caption="Payments" minWidth={520}>
          <thead>
            <tr>
              <th scope="col" className={th}>Date</th>
              <th scope="col" className={th}>Plan</th>
              <th scope="col" className={thNum}>Amount</th>
              <th scope="col" className={th}>Status</th>
              <th scope="col" className={th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.payments.length === 0 ? (
              <EmptyRow colSpan={5}>No payments.</EmptyRow>
            ) : (
              data.payments.map((p) => (
                <tr key={p.id}>
                  <td className={td}>
                    <Time ts={p.createdAt} />
                  </td>
                  <td className={td}>
                    {PLANS[p.plan as PersonalTier]?.name ?? p.plan} · {p.interval === "year" ? "yearly" : "monthly"}
                    {p.provider === "test" ? (
                      <Badge className="ml-1.5" tone="warning">
                        Test
                      </Badge>
                    ) : null}
                  </td>
                  <td className={tdNum}>{formatPrice(p.amountCents)}</td>
                  <td className={td}>
                    <Badge tone={p.status === "paid" ? "success" : p.status === "failed" ? "danger" : "neutral"}>{humanize(p.status)}</Badge>
                  </td>
                  <td className={`${td} text-right`}>
                    {p.status === "paid" && admin.can("billing.refund") ? (
                      <Button size="sm" variant="quiet" onClick={() => setAction({ refund: p })}>
                        <Undo2 size={13} aria-hidden /> Mark refunded…
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      </Panel>

      <BillingDialogs profileId={profileId} who={who} data={data} action={action} maxTrial={maxTrialDays(admin.role)} onClose={() => setAction(null)} onDone={() => void refresh()} />
    </>
  );
}

function BillingDialogs({ profileId, who, data, action, maxTrial, onClose, onDone }: { profileId: string; who: string; data: Billing; action: Kind | null; maxTrial: number; onClose: () => void; onDone: () => void }) {
  const setPlan = useMutation(api.adminBilling.setPlan);
  const extendTrial = useMutation(api.adminBilling.extendTrial);
  const setAiGrant = useMutation(api.adminBilling.setAiGrant);
  const setStorage = useMutation(api.adminBilling.setStorageOverride);
  const setDevices = useMutation(api.adminBilling.setDeviceLimit);
  const markRefunded = useMutation(api.adminBilling.markRefunded);
  const requestExport = useMutation(api.adminBilling.requestUserExport);
  const sub = data.subscription;
  const done = (msg: string) => {
    onDone();
    return msg;
  };
  const refund = typeof action === "object" && action ? action.refund : null;
  const trialFrom = Math.max(Date.now(), sub.trialEndsAt ?? 0);

  return (
    <>
      <ActionDialog
        open={action === "plan"}
        onClose={onClose}
        title={`Set ${who}'s plan`}
        description="For comps, corrections and purchases made outside the app. Nobody is charged. Without an end date the plan stays until someone changes it."
        confirmLabel="Save plan"
        fields={[
          {
            name: "plan",
            label: "Plan",
            type: "select",
            initial: sub.plan,
            options: (["free", "basic", "pro"] as const).map((id) => ({ value: id, label: `${PLANS[id].name} — ${limit(PLANS[id].storageBytes)}${PLANS[id].ai ? ", AI" : ""}` })),
          },
          {
            name: "interval",
            label: "Counted as",
            type: "select",
            initial: sub.interval ?? "month",
            options: [
              { value: "month", label: "Monthly" },
              { value: "year", label: "Yearly" },
            ],
            hint: "Only affects how the plan is shown. Manual plans aren't counted in recurring revenue.",
          },
          { name: "until", label: "Ends on (optional)", type: "text", initial: "", hint: "YYYY-MM-DD. After this date the account goes back to Free.", validate: futureDate },
        ]}
        onSubmit={async ({ reason, fields, meta }) => {
          const plan = fields.plan as PersonalTier;
          await setPlan({ profileId, plan, interval: fields.interval as "month" | "year", until: endOfDay(fields.until ?? ""), reason, ...meta });
          return done(`Plan set to ${PLANS[plan].name}`);
        }}
      />
      <ActionDialog
        open={action === "trial"}
        onClose={onClose}
        title={data.entitlements.trialing ? "Extend the Pro trial" : "Give a Pro trial"}
        description={`Pro features, AI included, free for the days you choose — counted from ${day(trialFrom)}. Nothing is charged when it ends.`}
        confirmLabel="Save trial"
        fields={[{ name: "days", label: "Days", type: "number", initial: "7", min: 1, max: maxTrial, step: 1, suffix: "days", hint: `Up to ${maxTrial} days for your role.` }]}
        onSubmit={async ({ reason, fields, meta }) => {
          const days = Number(fields.days);
          await extendTrial({ profileId, days, reason, ...meta });
          return done(`Trial now ends ${day(trialFrom + days * DAY)}`);
        }}
      />
      <ActionDialog
        open={action === "ai"}
        onClose={onClose}
        title={sub.aiGrant ? "AI access" : `Give ${who} the AI Assistant`}
        description="A grant turns on the AI Assistant whatever their plan. They can still switch AI off for themselves in Settings."
        confirmLabel="Save"
        fields={[
          {
            name: "grant",
            label: "AI access",
            type: "select",
            initial: "on",
            options: [
              { value: "on", label: "Granted" },
              { value: "off", label: "Not granted (follows their plan)" },
            ],
            validate: (v) => (v === "off" && !sub.aiGrant ? "They don't have a grant to remove." : null),
          },
          { name: "until", label: "Until (optional)", type: "text", initial: "", hint: "YYYY-MM-DD. Leave empty for no end date.", validate: futureDate },
        ]}
        onSubmit={async ({ reason, fields, meta }) => {
          const grant = fields.grant === "on";
          await setAiGrant({ profileId, grant, until: grant ? endOfDay(fields.until ?? "") : null, reason, ...meta });
          return done(grant ? "AI access granted" : "AI grant removed");
        }}
      />
      <ActionDialog
        open={action === "storage"}
        onClose={onClose}
        title="Storage limit"
        description={`Replaces their plan's limit (${limit(PLANS[data.entitlements.paidPlan].storageBytes)}) for their personal storage. Team workspaces have their own limits. Leave empty to go back to the plan's limit.`}
        confirmLabel="Save limit"
        fields={[
          {
            name: "gb",
            label: "Limit",
            type: "text",
            initial: sub.storageOverrideBytes ? String(Math.round(sub.storageOverrideBytes / 1024 ** 3)) : "",
            suffix: "GB",
            validate: (v) => (v === "" ? null : !(Number(v) > 0) || Number(v) > 10_000 ? "Enter 1 to 10,000 GB, or leave empty." : null),
          },
        ]}
        onSubmit={async ({ reason, fields, meta }) => {
          const gigabytes = fields.gb ? Number(fields.gb) : null;
          await setStorage({ profileId, gigabytes, reason, ...meta });
          return done(gigabytes === null ? "Back to the plan's storage" : `Storage limit set to ${gigabytes} GB`);
        }}
      />
      <ActionDialog
        open={action === "devices"}
        onClose={onClose}
        title="Device limit"
        description={`How many devices can use this account at once. Their plan's is ${PLANS[data.entitlements.paidPlan].devices ?? "unlimited"}. Devices over the limit wait at a sign-in screen; nobody is signed out.`}
        confirmLabel="Save limit"
        fields={[
          {
            name: "devices",
            label: "Limit",
            type: "select",
            initial: sub.deviceLimitOverride === null ? "plan" : String(sub.deviceLimitOverride),
            options: [
              { value: "plan", label: "The plan's limit" },
              ...[1, 2, 3, 5, 10].map((n) => ({ value: String(n), label: `${n} ${n === 1 ? "device" : "devices"}` })),
              { value: "unlimited", label: "Unlimited" },
            ],
          },
        ]}
        onSubmit={async ({ reason, fields, meta }) => {
          const v = fields.devices;
          const devices = v === "plan" ? null : v === "unlimited" ? ("unlimited" as const) : Number(v);
          await setDevices({ profileId, devices, reason, ...meta });
          return done(devices === null ? "Back to the plan's device limit" : `Device limit set to ${devices}`);
        }}
      />
      <ActionDialog
        open={action === "export"}
        onClose={onClose}
        title="Prepare an export for this person?"
        description="Builds a ZIP of their Personal and sends it to them as a notification with a download link. Only they can download it — you never see their notes."
        confirmLabel="Prepare export"
        acknowledge="The person asked for an export of their notes."
        onSubmit={async ({ reason, meta }) => {
          await requestExport({ profileId, reason, ...meta });
          return done("Export started — they'll be notified when it's ready");
        }}
      >
        <Callout tone="plum">Admins can't open or download people's notes. This only delivers the export to the account owner.</Callout>
      </ActionDialog>
      <ActionDialog
        open={Boolean(refund)}
        onClose={onClose}
        title="Mark this payment refunded?"
        description={refund ? `${formatPrice(refund.amountCents)} on ${day(refund.createdAt)}. This only updates Folevi's records — make the refund itself in the payment provider first.` : undefined}
        confirmLabel="Mark refunded"
        tone="danger"
        onSubmit={async ({ reason, meta }) => {
          await markRefunded({ paymentId: refund!.id, reason, ...meta });
          return done("Payment marked refunded");
        }}
      />
    </>
  );
}
