"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { AiIcon } from "@/components/ai/AiIcon";
import { Check, CreditCard, HardDrive, MonitorSmartphone } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";
import { DAY_MS, PLANS, PLAN_ORDER, formatPrice, isPaidPlan, monthlyEquivalent, type BillingInterval, type PersonalTier } from "@/lib/plans";
import { Card } from "./Card";
import { AppLink } from "@/lib/app/router";

export function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(bytes < 10 * 1024 ** 3 ? 1 : 0)} GB`;
}
const dateOnly = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** The Personal tiers that are paid for (from the catalog). */
const isPaidTier = (t: PersonalTier): t is Exclude<PersonalTier, "free"> => isPaidPlan(PLANS[t].monthly);
/** The biggest saving from paying yearly, across the paid plans (for the Yearly toggle). */
const BEST_YEARLY_SAVING = Math.max(...PLAN_ORDER.filter(isPaidTier).map((id) => Math.round((1 - PLANS[id].yearlyCents / (PLANS[id].monthlyCents * 12)) * 100)));

/**
 * Settings → Plan & billing: the person's Personal plan (Free, Basic or Pro), personal usage, choosing a
 * plan, and personal payment history. Team workspaces have their own plans and billing.
 */
export function BillingSection() {
  const data = useQuery(api.billing.mine, {});
  const checkout = useAction(api.billing.checkout);
  const portal = useAction(api.billing.portal);
  const testPurchase = useMutation(api.billing.testPurchase);
  const cancel = useMutation(api.billing.cancelPlan);
  const resume = useMutation(api.billing.resumePlan);
  const toast = useToast();
  const [interval, setInterval] = useState<BillingInterval>("year");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("checkout");
    if (q === "success") toast.show("Thanks! Your plan is being activated — it can take a moment.", { tone: "success" });
    if (q === "canceled") toast.show("Checkout canceled — nothing was charged.");
    if (q) window.history.replaceState(null, "", window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <p className="text-sm text-muted">Loading your plan…</p>;
  const { entitlements: e, subscription: sub } = data;
  const current = PLANS[e.paidPlan];
  const trialDaysLeft = e.trialing && e.trialEndsAt ? Math.max(1, Math.ceil((e.trialEndsAt - Date.now()) / DAY_MS)) : 0;
  const usedPct = Math.min(100, (data.storageUsedBytes / data.storageLimitBytes) * 100);
  // The plan's state: trial, active, past due, or cancel scheduled (Free has none).
  const cancelScheduled = e.paid && Boolean(sub?.cancelAtPeriodEnd && sub.currentPeriodEnd);
  const status = e.trialing ? "Trial" : !e.paid ? null : sub?.status === "past_due" ? "Past due" : cancelScheduled ? "Cancel scheduled" : "Active";
  const stripeBilled = sub?.provider === "stripe";
  const selfServe = e.paid && sub?.provider !== "stripe" && sub?.provider !== "manual";
  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      if (done) toast.show(done, { tone: "success" });
    } catch (err) {
      toast.show(errorMessage(err), { tone: "error" });
    } finally {
      setBusy(null);
    }
  };
  const openPortal = () => run("portal", async () => window.location.assign((await portal({})).url));
  const choose = (plan: PersonalTier) => {
    if (!isPaidTier(plan)) return run("free", () => cancel({}), "Your plan will end at the close of this billing period.");
    if (data.checkoutAvailable)
      return run(plan, async () => {
        const { url } = await checkout({ plan, interval });
        window.location.assign(url);
      });
    if (data.testPurchases) return run(plan, () => testPurchase({ plan, interval }), `You're on ${PLANS[plan].name} (test purchase).`);
  };

  return (
    <>
      <Card title="Your plan">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2">
              <span className="ui-display text-[24px]">{e.trialing ? "Pro trial" : current.name}</span>
              {e.paid && sub?.interval ? <span className="rounded-full bg-[var(--glass-hover)] px-2 py-0.5 text-[12px] text-muted">{sub.interval === "year" ? "Annual" : "Monthly"}</span> : null}
              {status ? <span className={`rounded-full px-2 py-0.5 text-[12px] ${status === "Past due" ? "bg-danger-soft text-danger" : "bg-[var(--glass-hover)] text-muted"}`}>{status}</span> : null}
            </p>
            <p className="mt-1 text-sm text-muted">
              {e.trialing
                ? `${trialDaysLeft} ${trialDaysLeft === 1 ? "day" : "days"} of Pro left (until ${dateOnly(e.trialEndsAt!)}). ${e.paid ? `Then your ${current.name} plan continues.` : "Then you'll move to Free unless you choose a plan."}`
                : e.paid && sub?.status === "past_due"
                  ? stripeBilled
                    ? "Your last payment failed. Update your payment method to keep your plan."
                    : "Your last payment failed."
                  : e.paid && sub?.currentPeriodEnd
                    ? sub.cancelAtPeriodEnd
                      ? `Ends ${dateOnly(sub.currentPeriodEnd)}. Your ${current.name} features remain available until then.`
                      : `${sub.provider === "manual" ? "Set by the Folevi team — runs until" : "Renews"} ${dateOnly(sub.currentPeriodEnd)}.`
                    : e.paid && sub?.provider === "manual"
                      ? "Set by the Folevi team."
                      : current.blurb}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {stripeBilled ? (
              <Button onClick={() => void openPortal()} aria-busy={busy === "portal" || undefined}>
                <CreditCard size={15} aria-hidden /> {cancelScheduled ? "Resume subscription" : "Manage subscription"}
              </Button>
            ) : null}
            {selfServe ? (
              sub?.cancelAtPeriodEnd ? (
                <Button onClick={() => run("resume", () => resume({}), "Your plan will keep renewing.")}>Resume subscription</Button>
              ) : (
                <Button variant="ghost" onClick={() => run("cancel", () => cancel({}), "Your plan will end at the close of this billing period.")}>
                  Cancel plan
                </Button>
              )
            ) : null}
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-[10px] bg-[var(--glass-hover)] p-4">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-heading">
              <HardDrive size={15} aria-hidden /> Personal storage
            </p>
            <p className="mt-1 text-sm text-muted">
              {formatBytes(data.storageUsedBytes)} of {formatBytes(data.storageLimitBytes)} used
            </p>
            <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--color-ink)_12%,transparent)]" role="meter" aria-label="Personal storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usedPct)}>
              <div className={`h-full rounded-full ${usedPct > 90 ? "bg-danger" : "bg-heading"}`} style={{ width: `${Math.max(usedPct, 1.5)}%` }} />
            </div>
          </div>
          <div className="rounded-[10px] bg-[var(--glass-hover)] p-4">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-heading">
              <AiIcon size={15} aria-hidden className="text-[#7c6cf0]" /> AI Assistant
            </p>
            <p className="mt-1 text-sm text-muted">
              {e.ai
                ? e.aiSource === "grant"
                  ? `Included by the Folevi team${sub?.aiGrantUntil ? ` until ${dateOnly(sub.aiGrantUntil)}` : ""}.`
                  : e.trialing
                    ? "Unlimited during your Pro trial."
                    : "Unlimited on Pro."
                : "Part of Pro — write, summarize and ask your notes anything in Personal."}
            </p>
            {e.ai ? <p className="mt-2 text-[12.5px] text-faint">{data.aiRequestsThisMonth.toLocaleString()} requests this month</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] bg-[var(--glass-hover)] p-4 sm:col-span-2">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-heading">
                <MonitorSmartphone size={15} aria-hidden /> Devices
              </p>
              <p className="mt-1 text-sm text-muted">
                {e.devices === null
                  ? `Unlimited${e.trialing ? " during your Pro trial" : ""} · signed in on ${data.devicesActive} ${data.devicesActive === 1 ? "device" : "devices"}`
                  : `${Math.min(data.devicesActive, e.devices)} of ${e.devices} devices in use${data.devicesActive > e.devices ? ` · ${data.devicesActive - e.devices} waiting` : ""}`}
              </p>
            </div>
            <AppLink href="/settings/devices" className="text-[13px] font-medium text-heading underline decoration-line-strong underline-offset-2 hover:decoration-heading">
              Manage devices
            </AppLink>
          </div>
        </div>
      </Card>

      <Card title="Choose a personal plan" description="Your plan applies to your personal account. Workspaces have their own plans, members, limits and billing.">
        <div className="ui-seg ui-well mb-4 w-fit" role="group" aria-label="Billing period">
          <button type="button" aria-pressed={interval === "month"} onClick={() => setInterval("month")} className="h-8 whitespace-nowrap !px-4">
            Monthly
          </button>
          <button type="button" aria-pressed={interval === "year"} onClick={() => setInterval("year")} className="h-8 whitespace-nowrap !px-3.5">
            Yearly
            <span className="whitespace-nowrap rounded-full bg-[color-mix(in_oklab,#2f9e62_14%,transparent)] px-2 py-0.5 text-[11px] font-semibold leading-none text-[#1f7a4a] dark:text-[#6fd39b]">Save up to {BEST_YEARLY_SAVING}%</span>
          </button>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {PLAN_ORDER.map((id) => {
            const plan = PLANS[id];
            const paid = isPaidTier(id);
            const price = interval === "year" ? plan.yearlyCents : plan.monthlyCents;
            const isCurrent = e.paidPlanId === (interval === "year" ? plan.yearly : plan.monthly);
            const canBuy = paid && (data.checkoutAvailable || data.testPurchases);
            return (
              <section key={id} aria-label={`${plan.name} plan`} className={`flex flex-col rounded-[14px] p-5 ${plan.ai ? "bg-[linear-gradient(160deg,color-mix(in_oklab,#8b7cf6_12%,transparent),color-mix(in_oklab,#f58ab8_10%,transparent))] shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,#7c6cf0_35%,transparent)]" : "bg-[var(--glass-hover)] shadow-[inset_0_0_0_1px_var(--glass-border)]"}`}>
                <div className="flex items-center gap-2">
                  <h4 className="ui-display text-[19px]">{plan.name}</h4>
                  {plan.ai ? <span className="rounded-full bg-[#7c6cf0] px-2 py-0.5 text-[11px] font-semibold text-white">AI</span> : null}
                  {isCurrent ? <span className="ml-auto rounded-full bg-heading px-2 py-0.5 text-[11px] font-semibold text-canvas">Current</span> : null}
                </div>
                <p className="mt-2">
                  <span className="text-[30px] font-semibold tracking-tight text-heading">{formatPrice(price)}</span>
                  <span className="text-sm text-muted"> / {interval === "year" ? "year" : "month"}</span>
                </p>
                <p className="min-h-[20px] text-[12.5px] text-muted">{!paid ? "No card required" : interval === "year" ? `${monthlyEquivalent(plan.yearlyCents)}/month, billed yearly` : "Billed monthly"}</p>
                <p className="mt-2 text-[13px] text-ink">{plan.blurb}</p>
                <ul className="mt-3 flex-1 space-y-1.5 text-[13px]">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check size={15} aria-hidden className="mt-0.5 flex-none text-[#2f9e62]" /> {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-4">
                  {isCurrent ? (
                    <Button disabled className="w-full">
                      Your plan
                    </Button>
                  ) : !paid ? (
                    selfServe ? (
                      <Button variant="ghost" className="w-full" onClick={() => choose("free")} aria-busy={busy === "free" || undefined}>
                        Switch to Free
                      </Button>
                    ) : null
                  ) : canBuy ? (
                    <Button variant={plan.ai ? "primary" : "secondary"} className="w-full" onClick={() => choose(id)} aria-busy={busy === id || undefined}>
                      {busy === id ? "Opening checkout…" : `${e.paid ? "Switch to" : "Upgrade to"} ${plan.name}${!data.checkoutAvailable ? " (test)" : ""}`}
                    </Button>
                  ) : (
                    <Button disabled className="w-full">
                      Coming soon
                    </Button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
        {!data.checkoutAvailable ? (
          <p className="mt-3 text-[12.5px] text-faint">
            {data.testPurchases ? "Payments aren't connected yet, so upgrades here are test purchases (development only) — nothing is charged." : "Online payments are coming soon."}
          </p>
        ) : null}
      </Card>

      <Card title="Billing history">
        {data.payments.length ? (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[12px] text-muted">
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">Plan</th>
                <th className="pb-2 text-right font-medium">Amount</th>
                <th className="pb-2 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id} className="border-t border-line/70">
                  <td className="py-2">{formatDateTime(p.createdAt)}</td>
                  <td className="py-2">
                    {PLANS[p.plan].name} · {p.interval === "year" ? "yearly" : "monthly"}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatPrice(p.amountCents)} {p.currency.toUpperCase()}
                  </td>
                  <td className={`py-2 text-right capitalize ${p.status === "failed" ? "text-danger" : "text-muted"}`}>{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted">No payments yet.</p>
        )}
      </Card>
    </>
  );
}
