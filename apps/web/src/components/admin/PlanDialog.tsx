"use client";

import { useEffect, useId, useState } from "react";
import { useMutation } from "convex/react";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Select } from "@/components/ui/Select";
import { formatBytes } from "@/lib/format";
import {
  PLAN_CATALOG,
  PLAN_ORDER,
  PLANS,
  WORKSPACE_PLAN_ORDER,
  WORKSPACE_PLANS,
  formatPrice,
  planName,
  seatChargeCents,
  workspacePlanId,
  type BillingInterval,
  type PersonalTier,
  type WorkspacePlanId,
  type WorkspaceTier,
} from "@/lib/plans";
import { ActionDialog } from "./ActionDialog";
import { Callout, inputCls, selectCls } from "./ui";

/** Parses a YYYY-MM-DD field (end of that day, UTC) or "" → null. */
export function endOfDay(value: string): number | null {
  if (!value) return null;
  const t = Date.parse(`${value}T23:59:59Z`);
  return Number.isFinite(t) ? t : null;
}

export const futureDate = (v: string) => {
  if (!v) return null;
  const t = endOfDay(v);
  return t === null ? "Use a date like 2026-12-31." : t <= Date.now() ? "Choose a date in the future." : null;
};

/** The UTC day of a time, as YYYY-MM-DD (end dates are whole days). */
const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/** "Oct 6, 2026" */
export const shortDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

/** Storage limits read better as whole gigabytes ("50 GB", not "50.00 GB"). */
export const storageLimit = (bytes: number) => (bytes % 1024 ** 4 === 0 ? `${bytes / 1024 ** 4} TB` : bytes % 1024 ** 3 === 0 ? `${bytes / 1024 ** 3} GB` : formatBytes(bytes));

// ---------------------------------------------------------------- the plans on offer

interface TierInfo {
  tier: string;
  /** "Pro AI" */
  name: string;
  /** "Pro AI", "Workspace Pro AI" (what the toast and the summary say) */
  fullName: (interval: BillingInterval | null) => string;
  monthlyCents: number;
  yearlyCents: number;
  perMember: boolean;
  storageBytes: number;
  /** Whether the plan includes AI at all (every plan but Core). */
  ai: boolean;
  /** AI credits a month (per member in a workspace); 0 on Core, and on Workspace Free (members use their own). */
  credits: number;
  /** Devices at once (Personal plans); null = unlimited. undefined = not applicable. */
  devices?: number | null;
}

const PERSONAL_TIERS: TierInfo[] = PLAN_ORDER.map((t) => ({
  tier: t,
  name: PLANS[t].name,
  fullName: () => PLANS[t].name,
  monthlyCents: PLANS[t].monthlyCents,
  yearlyCents: PLANS[t].yearlyCents,
  perMember: false,
  storageBytes: PLANS[t].storageBytes,
  ai: PLANS[t].ai,
  credits: PLANS[t].monthlyCredits,
  devices: PLANS[t].devices,
}));

const WORKSPACE_TIERS: TierInfo[] = WORKSPACE_PLAN_ORDER.map((t) => {
  const monthly = PLAN_CATALOG[workspacePlanId(t, "month")];
  return {
    tier: t,
    name: WORKSPACE_PLANS[t].name,
    fullName: (interval: BillingInterval | null) => planName(workspacePlanId(t, interval)),
    monthlyCents: WORKSPACE_PLANS[t].monthlyCents,
    yearlyCents: WORKSPACE_PLANS[t].yearlyCents,
    perMember: WORKSPACE_PLANS[t].perSeat,
    storageBytes: monthly.entitlements.storageBytes,
    ai: monthly.entitlements.aiAssistant,
    // On Workspace Free each member uses their own personal credits.
    credits: t === "free" ? 0 : monthly.entitlements.monthlyCredits,
  };
});

const intervalWord = (i: BillingInterval | null) => (i === "year" ? "yearly" : "monthly");
const price = (t: TierInfo, i: BillingInterval) => {
  const cents = i === "year" ? t.yearlyCents : t.monthlyCents;
  return `${formatPrice(cents)}${t.perMember ? " per member" : ""} / ${i === "year" ? "year" : "month"}`;
};

/** "1 GB, shared", "20 GB per member" */
const storageText = (t: TierInfo, kind: "personal" | "workspace") => (t.tier === "free" ? (kind === "personal" ? `${storageLimit(t.storageBytes)}, shared` : `Owner's ${storageLimit(t.storageBytes)}`) : `${storageLimit(t.storageBytes)}${kind === "workspace" ? " per member" : ""}`);

/** "180 a month", "No AI", "Their personal credits" */
const creditsText = (t: TierInfo, kind: "personal" | "workspace") => (!t.ai ? "No AI" : kind === "workspace" && t.tier === "free" ? "Their personal credits" : `${t.credits.toLocaleString()} a month${kind === "workspace" ? " per member" : ""}`);

// ---------------------------------------------------------------- the dialog

export interface CurrentPlan {
  tier: string;
  interval: BillingInterval | null;
  /** When a hand-set plan ends (ms), or null for no end date. */
  endsAt: number | null;
  /** A Personal plan's Pro AI trial end (ms), while it runs. */
  trialEndsAt?: number | null;
  /** Billed through Polar: it can only be changed in Polar (the server refuses here too). */
  polarBilled?: boolean;
}

type EndChoice = "none" | "1m" | "3m" | "1y" | "date";

function addMonths(months: number): number {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCHours(23, 59, 59, 0);
  return d.getTime();
}

function endFrom(choice: EndChoice, date: string): number | null {
  if (choice === "1m") return addMonths(1);
  if (choice === "3m") return addMonths(3);
  if (choice === "1y") return addMonths(12);
  if (choice === "date") return endOfDay(date);
  return null;
}

/** "Upgrade to Pro", "Downgrade to Free", or "Save plan" (same plan, different billing or end date). */
function confirmLabel(tiers: TierInfo[], from: string, to: TierInfo): string {
  const a = tiers.findIndex((t) => t.tier === from);
  const b = tiers.findIndex((t) => t.tier === to.tier);
  if (b > a) return `Upgrade to ${to.name}`;
  if (b < a) return `Downgrade to ${to.name}`;
  return "Save plan";
}

/**
 * Change a Personal or workspace plan by hand: pick the plan, how it's counted (monthly or yearly), and an
 * optional end date; the summary says exactly what changes. A reason is required and goes to the audit log.
 * The server checks the admin's role, refuses plans billed through Polar and records the change; this only asks.
 */
function PlanChangeDialog({
  open,
  onClose,
  kind,
  who,
  current,
  seats,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  kind: "personal" | "workspace";
  /** The person's name or the workspace's name. */
  who: string;
  current: CurrentPlan;
  /** Billable seats (workspaces), for the estimate; unknown on the list. */
  seats?: number;
  onSave: (next: { tier: string; interval: BillingInterval | null; until: number | null; reason: string; meta: { requestId: string; clientHash?: string } }) => Promise<void>;
}) {
  const uid = useId();
  const tiers = kind === "personal" ? PERSONAL_TIERS : WORKSPACE_TIERS;
  const [tier, setTier] = useState(current.tier);
  const [interval, setInterval] = useState<BillingInterval>(current.interval ?? "month");
  const [end, setEnd] = useState<EndChoice>("none");
  const [date, setDate] = useState("");
  const [dateTouched, setDateTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    // On a free plan the usual reason to open this is an upgrade: the first paid plan with AI starts selected.
    setTier(current.tier === "free" ? (tiers.find((t) => t.tier !== "free" && t.ai)?.tier ?? current.tier) : current.tier);
    setInterval(current.interval ?? "month");
    // A plan with an end date keeps it unless it's changed here.
    setEnd(current.endsAt ? "date" : "none");
    setDate(current.endsAt ? dayKey(current.endsAt) : "");
    setDateTouched(false);
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const from = tiers.find((t) => t.tier === current.tier) ?? tiers[0]!;
  const to = tiers.find((t) => t.tier === tier) ?? tiers[0]!;
  const paid = to.tier !== "free";
  const nextInterval = paid ? interval : null;
  const until = paid ? endFrom(end, date) : null;
  const dateError = paid && end === "date" ? (date ? futureDate(date) : "Enter a date, or choose another end.") : null;
  const sameEnd = until === null || current.endsAt === null ? until === current.endsAt : dayKey(until) === dayKey(current.endsAt);
  const changed = to.tier !== from.tier || (paid && (nextInterval !== current.interval || !sameEnd));
  const backTo = kind === "personal" ? "Free" : "Workspace Free";
  const trialing = Boolean(current.trialEndsAt && current.trialEndsAt > Date.now());
  const polar = Boolean(current.polarBilled);

  const rows: { label: string; from: string; to: string }[] = [
    { label: "Plan", from: `${from.fullName(current.interval)}${current.interval ? `, ${intervalWord(current.interval)}` : ""}`, to: `${to.fullName(nextInterval)}${nextInterval ? `, ${intervalWord(nextInterval)}` : ""}` },
    { label: kind === "personal" ? "Personal storage" : "Storage", from: storageText(from, kind), to: storageText(to, kind) },
    { label: "AI credits", from: creditsText(from, kind), to: creditsText(to, kind) },
  ];
  if (kind === "personal") rows.push({ label: "Devices", from: from.devices === null ? "Unlimited" : String(from.devices), to: to.devices === null ? "Unlimited" : String(to.devices) });
  rows.push({
    label: "Ends",
    from: current.endsAt ? shortDate(current.endsAt) : from.tier === "free" ? "Never" : "No end date",
    to: !paid ? "Never" : until ? shortDate(until) : end === "date" ? "Enter a date" : "No end date",
  });
  if (paid && until) rows.push({ label: "After that", from: backTo, to: backTo });

  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={`Change plan for ${who}`}
      description={
        <>
          Currently <strong className="font-semibold text-heading">{from.fullName(current.interval)}</strong>
          {current.interval ? `, ${intervalWord(current.interval)}` : ""}
          {trialing ? ` (on a Pro AI trial until ${shortDate(current.trialEndsAt!)})` : ""}. Nobody is charged: money only moves through Polar.
        </>
      }
      confirmLabel={changed ? confirmLabel(tiers, from.tier, to) : "Save plan"}
      confirmDisabled={polar || !changed || Boolean(dateError && dateTouched)}
      onSubmit={async ({ reason, meta }) => {
        if (polar) throw new Error(`${kind === "personal" ? "This plan" : "This workspace"} is billed through Polar. Change or cancel it there.`);
        if (dateError) {
          setDateTouched(true);
          throw new Error(dateError);
        }
        if (!changed) throw new Error("Nothing would change. Pick a different plan, billing or end date.");
        await onSave({ tier: to.tier, interval: nextInterval, until, reason, meta });
        return `Plan set to ${to.fullName(nextInterval)}${nextInterval ? `, ${intervalWord(nextInterval)}` : ""}`;
      }}
    >
      {polar ? (
        <Callout tone="warning" title="Billed through Polar">
          {kind === "personal" ? "This plan is paid for" : "This workspace's plan is paid for"} through Polar, so it can't be changed here. Change or cancel it in Polar; Folevi updates when Polar tells it. After that you can set a plan here if needed.
        </Callout>
      ) : null}
      <fieldset disabled={polar}>
        <legend className="mb-1.5 text-sm font-medium">Plan</legend>
        <div className="grid grid-cols-2 gap-2">
          {tiers.map((t) => {
            const checked = t.tier === tier;
            const isCurrent = t.tier === current.tier;
            return (
              <label
                key={t.tier}
                className={`relative flex cursor-pointer flex-col rounded-[10px] px-3 py-2.5 text-[12.5px] transition-[background-color,box-shadow] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus ${
                  checked
                    ? "bg-[var(--color-surface-raised)] shadow-[0_1px_3px_rgb(0_0_0/0.1),inset_0_0_0_1.5px_var(--color-heading)]"
                    : "bg-[var(--glass-hover)] shadow-[inset_0_0_0_1px_var(--glass-border)] hover:bg-[color-mix(in_oklab,var(--glass-active)_70%,transparent)]"
                }`}
              >
                <input type="radio" name={`${uid}-plan`} value={t.tier} checked={checked} onChange={() => setTier(t.tier)} aria-label={t.name} aria-describedby={`${uid}-${t.tier}`} className="absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none rounded-[10px] opacity-0" />
                <span className="flex items-center gap-1.5">
                  <span className="ui-display text-[16px] text-heading">{t.name}</span>
                  {isCurrent ? <span className="ml-auto rounded-[6px] bg-[var(--glass-hover)] px-1.5 text-[10.5px] font-semibold leading-[16px] text-muted">Current</span> : null}
                </span>
                <span id={`${uid}-${t.tier}`} className="mt-1 text-muted">
                  {t.tier === "free" ? "No charge" : `${formatPrice(interval === "year" ? t.yearlyCents : t.monthlyCents)} / ${interval === "year" ? "year" : "month"}`}
                  <br />
                  {[t.perMember && t.tier !== "free" ? "per member" : null, storageLimit(t.storageBytes), !t.ai ? "no AI" : t.credits ? `${t.credits.toLocaleString()} credits` : null].filter(Boolean).join(" · ")}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {paid && !polar ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="text-sm">
            <p id={`${uid}-interval`} className="mb-1 font-medium">
              Counted as
            </p>
            <div className="ui-seg ui-well w-full" role="group" aria-labelledby={`${uid}-interval`}>
              <button type="button" aria-pressed={interval === "month"} onClick={() => setInterval("month")}>
                Monthly
              </button>
              <button type="button" aria-pressed={interval === "year"} onClick={() => setInterval("year")}>
                Yearly
              </button>
            </div>
          </div>
          <div className="text-sm">
            <label htmlFor={`${uid}-end`} className="mb-1 block font-medium">
              Ends
            </label>
            <Select id={`${uid}-end`} value={end} onChange={(e) => setEnd(e.target.value as EndChoice)} className={selectCls}>
              <option value="none">No end date</option>
              <option value="1m">In 1 month</option>
              <option value="3m">In 3 months</option>
              <option value="1y">In 1 year</option>
              <option value="date">On a date</option>
            </Select>
          </div>
          {end === "date" ? (
            <div className="text-sm sm:col-span-2">
              <label htmlFor={`${uid}-date`} className="mb-1 block font-medium">
                End date
              </label>
              <input
                id={`${uid}-date`}
                value={date}
                onChange={(e) => setDate(e.target.value.trim())}
                onBlur={() => setDateTouched(true)}
                placeholder="YYYY-MM-DD"
                autoComplete="off"
                spellCheck={false}
                inputMode="numeric"
                aria-invalid={dateTouched && dateError ? true : undefined}
                aria-describedby={`${uid}-date-hint${dateTouched && dateError ? ` ${uid}-date-error` : ""}`}
                className={`${inputCls} max-w-[200px] tabular-nums`}
              />
              <p id={`${uid}-date-hint`} className="mt-1 text-xs text-muted">
                The plan ends at the end of that day (UTC). Then it goes back to {backTo}.
              </p>
              {dateTouched && dateError ? (
                <p id={`${uid}-date-error`} className="mt-1 text-xs font-medium text-danger">
                  {dateError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <section aria-label="What changes" className="rounded-[10px] bg-[var(--glass-hover)] px-4 py-3 text-[13px]">
        <p className="mb-2 font-semibold text-heading">{changed ? "What changes" : "Nothing changes yet"}</p>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
          {rows.map((r) => {
            const same = r.from === r.to;
            return (
              <div key={r.label} className="contents">
                <dt className="text-muted">{r.label}</dt>
                <dd className="min-w-0">
                  {same ? (
                    <span className="text-muted">{r.to}</span>
                  ) : (
                    <span className="inline-flex flex-wrap items-center gap-x-1.5">
                      <span className="text-muted line-through decoration-[color-mix(in_oklab,var(--color-ink)_35%,transparent)]">{r.from}</span>
                      <ArrowRight size={13} aria-hidden className="flex-none text-faint" />
                      <span className="sr-only">to</span>
                      <span className="font-semibold text-heading">{r.to}</span>
                    </span>
                  )}
                </dd>
              </div>
            );
          })}
          {kind === "workspace" && paid ? (
            <div className="contents">
              <dt className="text-muted">Estimate</dt>
              <dd>
                {seats !== undefined
                  ? `${seats} ${seats === 1 ? "seat" : "seats"} × ${formatPrice(interval === "year" ? to.yearlyCents : to.monthlyCents)} = ${formatPrice(seatChargeCents(interval === "year" ? to.yearlyCents : to.monthlyCents, seats))} / ${interval === "year" ? "year" : "month"}, not billed`
                  : `${price(to, interval)}, not billed`}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>
      {trialing && changed ? (
        <Callout>
          {paid
            ? `A paid plan replaces their Pro AI trial (it would have run until ${shortDate(current.trialEndsAt!)}).`
            : `Their Pro AI trial keeps running until ${shortDate(current.trialEndsAt!)}. After that, ${to.fullName(nextInterval)} applies.`}
        </Callout>
      ) : null}
    </ActionDialog>
  );
}

// ---------------------------------------------------------------- the two uses

export interface PersonalPlanTarget {
  profileId: string;
  who: string;
  plan: PersonalTier;
  interval: BillingInterval | null;
  endsAt: number | null;
  trialEndsAt?: number | null;
  polarBilled?: boolean;
}

/** A person's Personal plan (adminBilling.setPlan). */
export function PersonalPlanDialog({ target, onClose, onDone }: { target: PersonalPlanTarget | null; onClose: () => void; onDone: () => void }) {
  const setPlan = useMutation(api.adminBilling.setPlan);
  const [last, setLast] = useState<PersonalPlanTarget | null>(target);
  useEffect(() => {
    if (target) setLast(target);
  }, [target]);
  const t = target ?? last;
  if (!t) return null;
  return (
    <PlanChangeDialog
      open={Boolean(target)}
      onClose={onClose}
      kind="personal"
      who={t.who}
      current={{ tier: t.plan, interval: t.interval, endsAt: t.endsAt, trialEndsAt: t.trialEndsAt, polarBilled: t.polarBilled }}
      onSave={async ({ tier, interval, until, reason, meta }) => {
        await setPlan({ profileId: t.profileId, plan: tier as PersonalTier, interval: interval ?? undefined, until, reason, ...meta });
        onDone();
      }}
    />
  );
}

export interface WorkspacePlanTarget {
  workspaceId: string;
  name: string;
  planId: WorkspacePlanId;
  endsAt: number | null;
  seats?: number;
  polarBilled?: boolean;
}

/** A team workspace's plan (adminBilling.setWorkspacePlan). */
export function WorkspacePlanDialog({ target, onClose, onDone }: { target: WorkspacePlanTarget | null; onClose: () => void; onDone: () => void }) {
  const setPlan = useMutation(api.adminBilling.setWorkspacePlan);
  const [last, setLast] = useState<WorkspacePlanTarget | null>(target);
  useEffect(() => {
    if (target) setLast(target);
  }, [target]);
  const t = target ?? last;
  if (!t) return null;
  const plan = PLAN_CATALOG[t.planId];
  return (
    <PlanChangeDialog
      open={Boolean(target)}
      onClose={onClose}
      kind="workspace"
      who={t.name}
      current={{ tier: plan.tier, interval: plan.interval, endsAt: t.endsAt, polarBilled: t.polarBilled }}
      seats={t.seats}
      onSave={async ({ tier, interval, until, reason, meta }) => {
        await setPlan({ workspaceId: t.workspaceId, planId: workspacePlanId(tier as WorkspaceTier, interval), until, reason, ...meta });
        onDone();
      }}
    />
  );
}
