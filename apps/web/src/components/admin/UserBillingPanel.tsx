"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AiIcon } from "@/components/ai/AiIcon";
import { CalendarPlus, FileArchive, HardDrive, MonitorSmartphone, RotateCw, Undo2 } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { formatBytes, formatDateTime } from "@/lib/format";
import { PACK_VALID_MONTHS, PLANS, TIER_NAMES, formatPrice, type PersonalTier } from "@/lib/plans";
import { ActionDialog } from "./ActionDialog";
import { useAdmin } from "./AdminApp";
import { maxTrialDays, rolesFor } from "./permissions";
import { storageLimit as limit } from "./PlanDialog";
import { Badge, Callout, DataTable, EmptyRow, ErrorNotice, KeyValues, Meter, Mono, Panel, StatusBadge, Time, humanize, td, tdNum, th, thNum, type Tone } from "./ui";

export type Billing = FunctionReturnType<typeof api.adminBilling.userBilling>;
type Kind = "trial" | "credits" | "storage" | "devices" | "export" | { refund: Billing["payments"][number] };

/** A team workspace the person belongs to (from the user page), for granting seat credits. */
export interface MemberWorkspace {
  id: string;
  name: string;
  status: string;
  /** The workspace's plan today (catalog id); only Pro and Pro AI seats have their own credits. */
  planId: string;
}

const DAY = 86_400_000;
const MAX_GRANT = 10_000;
const day = (ts: number) => new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const n = (v: number) => v.toLocaleString();
const PLAN_TONE: Record<PersonalTier, Tone> = { free: "neutral", core: "outline", pro: "strong", pro_ai: "strong" };
const SOURCE_LABEL: Record<Billing["packs"][number]["source"], string> = { polar: "Bought", test: "Test purchase", admin: "Granted" };
const STORAGE_RULE: Record<Billing["storageRule"], string> = {
  shared_free: "Free pool, shared with the free workspaces they own",
  per_person: "Their own quota",
  override: "Custom limit",
};

export function PlanBadge({ plan, trialing }: { plan: PersonalTier; trialing?: boolean }) {
  return (
    <Badge tone={PLAN_TONE[plan]} title={trialing ? "On a Pro AI trial" : undefined}>
      {TIER_NAMES[plan]}
      {trialing ? " · trial" : ""}
    </Badge>
  );
}

/** "Pro AI · yearly", "500 AI credits" */
export function paymentLabel(p: { plan: string; interval: "month" | "year" | null; credits: number | null }, prefix = ""): string {
  if (p.plan === "credits") return p.credits ? `${n(p.credits)} AI credits` : "AI credits";
  const name = p.plan in TIER_NAMES ? `${prefix}${TIER_NAMES[p.plan as PersonalTier]}` : humanize(p.plan);
  return p.interval ? `${name} · ${p.interval === "year" ? "yearly" : "monthly"}` : name;
}

/** A pack's state today: active, used up, expired or refunded. */
function packState(p: Billing["packs"][number], now: number): { label: string; tone: Tone } {
  if (p.status === "refunded") return { label: "Refunded", tone: "neutral" };
  if (p.expiresAt <= now) return { label: "Expired", tone: "neutral" };
  if (p.remaining <= 0) return { label: "Used up", tone: "neutral" };
  return { label: "Active", tone: "success" };
}

/**
 * One person's plan, storage, AI credits and use, and payments, with the billing actions their role allows.
 * The user page loads it (adminBilling.userBilling, an audited read) and has the Change plan action at the top.
 */
export function UserBillingPanel({
  profileId,
  email,
  name,
  workspaces,
  billing,
}: {
  profileId: string;
  email: string;
  name: string;
  /** Their team workspaces (seat credits can be granted in the Pro and Pro AI ones). */
  workspaces: MemberWorkspace[];
  billing: { data: Billing | undefined; error: unknown; loading: boolean; refresh: () => Promise<void> };
}) {
  const admin = useAdmin();
  const { data, error, loading, refresh } = billing;
  const [action, setAction] = useState<Kind | null>(null);
  const [now] = useState(() => Date.now());

  if (!data) {
    return (
      <Panel title="Plan & billing">
        {error ? <ErrorNotice error={error} onRetry={() => void refresh()} /> : <p className="text-sm text-muted">Loading…</p>}
      </Panel>
    );
  }

  const { subscription: sub, entitlements: e, credits: c } = data;
  const canManage = admin.can("billing.manage");
  const canGrant = admin.can("billing.credits");
  const paidPlan = sub.plan as PersonalTier;
  const who = name || email;
  const notes: string[] = [];
  if (!canManage) notes.push(`Plans, storage and device limits: ${rolesFor("billing.manage")}`);
  if (!canGrant) notes.push(`AI credits: ${rolesFor("billing.credits")}`);
  if (!canManage || !canGrant) notes.push(`Trials: up to ${maxTrialDays(admin.role)} days.`);

  return (
    <>
      <Panel
        title="Plan & billing"
        description="Personal plan, personal storage and AI credits in Personal. Team workspaces have their own plans. Changes here don't charge or refund anyone. Money only moves through Polar."
        actions={
          <Button size="sm" variant="quiet" onClick={() => void refresh()} disabled={loading} aria-label="Reload billing (writes an audit entry)">
            <RotateCw size={14} aria-hidden className={loading ? "animate-spin" : ""} />
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <PlanBadge plan={e.plan} trialing={e.trialing} />
          {e.trialing && e.trialEndsAt ? <span className="text-sm text-muted">Trial ends {day(e.trialEndsAt)} · pays for {PLANS[e.paidPlan].name}</span> : null}
          {data.polarBilled ? <Badge tone="outline">Billed through Polar</Badge> : null}
          {sub.cancelAtPeriodEnd ? <Badge tone="warning">Cancels at period end</Badge> : null}
          {sub.status === "past_due" ? <Badge tone="danger">Payment past due</Badge> : null}
        </div>

        <div className="mt-4">
          <KeyValues
            items={[
              { label: "Plan", value: `${PLANS[paidPlan].name}${sub.interval && paidPlan !== "free" ? ` · ${sub.interval === "year" ? "yearly" : "monthly"}` : ""}` },
              { label: "Billed through", value: humanize(sub.provider === "none" ? "not billed" : sub.provider) },
              ...(sub.polarCustomerId ? [{ label: "Polar customer", value: <Mono wrap>{sub.polarCustomerId}</Mono> }] : []),
              { label: "Status", value: <StatusBadge status={sub.status} /> },
              { label: sub.cancelAtPeriodEnd ? "Ends" : "Renews / ends", value: sub.currentPeriodEnd ? formatDateTime(sub.currentPeriodEnd) : "Not set" },
              { label: "Paying since", value: sub.paidSince ? day(sub.paidSince) : "Never" },
              { label: "AI", value: !e.ai ? "Not included (Core has no AI)" : e.trialing ? "Included (Pro AI trial)" : `Included (${e.monthlyCredits.toLocaleString()} credits a month)` },
              {
                label: "Devices",
                value: `${data.devicesActive} signed in · ${e.devices === null ? "unlimited" : `limit ${e.devices}`}${sub.deviceLimitOverride !== null ? " (custom)" : ""}`,
              },
            ]}
          />
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="text-muted">Personal storage · {sub.storageOverrideBytes ? STORAGE_RULE.override : STORAGE_RULE[data.storageRule]}</span>
            <span className="whitespace-nowrap tabular-nums">
              {formatBytes(data.storageUsedBytes)} of {limit(data.storageLimitBytes)}
            </span>
          </div>
          <Meter value={data.storageUsedBytes} max={data.storageLimitBytes} label="Personal storage used" />
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="text-muted">AI credits {c.trialing ? "in the trial" : "this period"} · {c.plan}</span>
            <span className="whitespace-nowrap tabular-nums">{e.ai ? `${n(c.used)} of ${n(c.allowance)} used` : "No AI"}</span>
          </div>
          <Meter value={c.used} max={c.allowance} label="Monthly AI credits used" />
          {e.ai ? (
            <p className="mt-1.5 text-[12.5px] text-muted">
              {n(c.available)} available now
              {c.held ? ` (${n(c.held)} held by requests in progress)` : ""}. {c.trialing ? "Trial ends" : "Resets"} {day(c.resetsAt)}. Bought and granted: {n(c.packCredits)} left
              {c.nextPackExpiry ? `, next expiry ${day(c.nextPackExpiry)}` : ""}.
            </p>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setAction("trial")}>
            <CalendarPlus size={14} aria-hidden /> {e.trialing ? "Extend trial…" : "Give Pro AI trial…"}
          </Button>
          <Button size="sm" onClick={() => setAction("credits")} disabled={!canGrant} title={canGrant ? undefined : rolesFor("billing.credits")}>
            <AiIcon size={14} aria-hidden /> Grant credits…
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
        {notes.length ? <p className="mt-2 text-xs text-muted">{notes.join(" ")}</p> : null}
        {data.polarBilled ? <p className="mt-2 text-xs text-muted">This plan is billed through Polar. Change or cancel it in Polar; Folevi updates when Polar tells it.</p> : null}
      </Panel>

      <Panel title="AI credit packs and grants" description="Bought and granted credits, Personal and workspace seats, newest first. They're used after the monthly credits." flush>
        <DataTable caption="AI credit packs and grants" minWidth={560}>
          <thead>
            <tr>
              <th scope="col" className={th}>Added</th>
              <th scope="col" className={th}>Source</th>
              <th scope="col" className={th}>For</th>
              <th scope="col" className={thNum}>Left</th>
              <th scope="col" className={th}>Expires</th>
              <th scope="col" className={th}>State</th>
            </tr>
          </thead>
          <tbody>
            {data.packs.length === 0 ? (
              <EmptyRow colSpan={6}>No packs or grants.</EmptyRow>
            ) : (
              data.packs.map((p) => {
                const state = packState(p, now);
                return (
                  <tr key={p.id}>
                    <td className={td}>
                      <Time ts={p.purchasedAt} />
                    </td>
                    <td className={td}>{SOURCE_LABEL[p.source]}</td>
                    <td className={td}>{p.workspace ?? "Personal"}</td>
                    <td className={tdNum}>
                      {n(p.remaining)} of {n(p.credits)}
                    </td>
                    <td className={td}>{day(p.expiresAt)}</td>
                    <td className={td}>
                      <Badge tone={state.tone}>{state.label}</Badge>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </DataTable>
      </Panel>

      <Panel title="AI use, last 30 days" description={`In Personal: ${n(data.aiRequests30d)} ${data.aiRequests30d === 1 ? "request" : "requests"}, ${n(data.aiCredits30d)} credits (about ${formatPrice(data.aiCredits30d)} of AI cost). No content is shown.`} flush>
        <DataTable caption="AI use by day, last 30 days" minWidth={360}>
          <thead>
            <tr>
              <th scope="col" className={th}>Day (UTC)</th>
              <th scope="col" className={thNum}>Requests</th>
              <th scope="col" className={thNum}>Credits</th>
            </tr>
          </thead>
          <tbody>
            {data.aiByDay.length === 0 ? (
              <EmptyRow colSpan={3}>No AI use in the last 30 days.</EmptyRow>
            ) : (
              [...data.aiByDay].reverse().map((d) => (
                <tr key={d.day}>
                  <td className={td}>{new Date(`${d.day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}</td>
                  <td className={tdNum}>{n(d.count)}</td>
                  <td className={tdNum}>{n(d.credits)}</td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      </Panel>

      <Panel title="Payments" description="Newest first. Test purchases (made in development) are marked." flush>
        <DataTable caption="Payments" minWidth={520}>
          <thead>
            <tr>
              <th scope="col" className={th}>Date</th>
              <th scope="col" className={th}>For</th>
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
                    {paymentLabel(p)}
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

      <BillingDialogs profileId={profileId} who={who} data={data} workspaces={workspaces} action={action} maxTrial={maxTrialDays(admin.role)} onClose={() => setAction(null)} onDone={() => void refresh()} />
    </>
  );
}

function BillingDialogs({
  profileId,
  who,
  data,
  workspaces,
  action,
  maxTrial,
  onClose,
  onDone,
}: {
  profileId: string;
  who: string;
  data: Billing;
  workspaces: MemberWorkspace[];
  action: Kind | null;
  maxTrial: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const extendTrial = useMutation(api.adminBilling.extendTrial);
  const grantCredits = useMutation(api.adminBilling.grantCredits);
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
  const personalAi = data.entitlements.ai;
  // Only a Pro or Pro AI workspace gives each member seat credits (in a free one they use their personal credits).
  const seatWorkspaces = workspaces.filter((w) => w.status !== "deleting" && w.planId.startsWith("workspace_pro_"));

  return (
    <>
      <ActionDialog
        open={action === "trial"}
        onClose={onClose}
        title={data.entitlements.trialing ? "Extend the Pro AI trial" : "Give a Pro AI trial"}
        description={`Pro AI, free for the days you choose, counted from ${day(trialFrom)}. A paid plan replaces it. Nothing is charged when it ends.`}
        confirmLabel="Save trial"
        fields={[{ name: "days", label: "Days", type: "number", initial: "7", min: 1, max: maxTrial, step: 1, suffix: "days", hint: `Up to ${maxTrial} days for your role.` }]}
        onSubmit={async ({ reason, fields, meta }) => {
          const days = Number(fields.days);
          await extendTrial({ profileId, days, reason, ...meta });
          return done(`Trial now ends ${day(trialFrom + days * DAY)}`);
        }}
      />
      <ActionDialog
        open={action === "credits"}
        onClose={onClose}
        title={`Grant AI credits to ${who}`}
        description="Granted credits are used after the monthly ones and expire after the months you choose. Nobody is charged."
        confirmLabel="Grant credits"
        fields={[
          {
            name: "credits",
            label: "Credits",
            type: "number",
            initial: "100",
            min: 1,
            max: MAX_GRANT,
            step: 1,
            suffix: "credits",
            hint: `1 to ${MAX_GRANT.toLocaleString()}. One credit is $0.01 of AI cost: a rewrite is about 1, Ask AI about 2.`,
            validate: (v) => (Number.isInteger(Number(v)) ? null : "Use a whole number."),
          },
          ...(seatWorkspaces.length
            ? [
                {
                  name: "where",
                  label: "For",
                  type: "select" as const,
                  initial: personalAi ? "personal" : seatWorkspaces[0]!.id,
                  options: [{ value: "personal", label: "Personal" }, ...seatWorkspaces.map((w) => ({ value: w.id, label: `${w.name} (their seat)` }))],
                  hint: "Their Pro and Pro AI workspaces are listed: each member has their own credits there. In other workspaces they use their personal credits.",
                  validate: (v: string) => (v === "personal" && !personalAi ? "Their personal plan is Core, which has no AI. Change the plan first, or pick a workspace." : null),
                },
              ]
            : []),
          {
            name: "months",
            label: "Lasts",
            type: "number",
            initial: String(PACK_VALID_MONTHS),
            min: 1,
            max: 24,
            step: 1,
            suffix: "months",
            validate: (v) => (Number.isInteger(Number(v)) ? null : "Use a whole number."),
          },
        ]}
        onSubmit={async ({ reason, fields, meta }) => {
          const credits = Number(fields.credits);
          const where = fields.where && fields.where !== "personal" ? fields.where : undefined;
          if (!where && !personalAi) throw new Error("Their personal plan is Core, which has no AI. Change the plan first.");
          await grantCredits({ profileId, credits, workspaceId: where, months: Number(fields.months), reason, ...meta });
          const place = where ? seatWorkspaces.find((w) => w.id === where)?.name : null;
          return done(`${credits.toLocaleString()} AI credits granted${place ? ` in ${place}` : ""}`);
        }}
      >
        {!personalAi && !seatWorkspaces.length ? <Callout tone="warning">Their personal plan is Core, which has no AI. Change the plan before granting personal credits.</Callout> : null}
      </ActionDialog>
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
              ...[1, 2, 3, 5, 10].map((d) => ({ value: String(d), label: `${d} ${d === 1 ? "device" : "devices"}` })),
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
        description="Builds a ZIP of their Personal and sends it to them as a notification with a download link. Only they can download it. You never see their notes."
        confirmLabel="Prepare export"
        acknowledge="The person asked for an export of their notes."
        onSubmit={async ({ reason, meta }) => {
          await requestExport({ profileId, reason, ...meta });
          return done("Export started. They'll be notified when it's ready");
        }}
      >
        <Callout>Admins can't open or download people's notes. This only delivers the export to the account owner.</Callout>
      </ActionDialog>
      <ActionDialog
        open={Boolean(refund)}
        onClose={onClose}
        title="Mark this payment refunded?"
        description={
          refund
            ? `${formatPrice(refund.amountCents)} for ${paymentLabel(refund)} on ${day(refund.createdAt)}. This only updates Folevi's records. Make the refund itself in Polar first.${refund.plan === "credits" ? " The pack's unused credits are taken back." : ""}`
            : undefined
        }
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
