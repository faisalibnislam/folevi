"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { AiIcon } from "@/components/ai/AiIcon";
import { Check, CreditCard, HardDrive, Users } from "lucide-react";
import { api } from "@/lib/convex/api";
import type { Workspace } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";
import { PLAN_CATALOG, WORKSPACE_PLANS, WORKSPACE_PLAN_ORDER, billedQuantity, formatPrice, isPaidPlan, seatChargeCents, workspacePlanId, type BillingInterval, type WorkspaceTier } from "@/lib/plans";
import { Card } from "./Card";
import { formatBytes } from "./BillingSection";

const dateOnly = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
type PaidWorkspacePlanId = Exclude<ReturnType<typeof workspacePlanId>, "workspace_free">;
const per = (interval: BillingInterval) => (interval === "year" ? "year" : "month");
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
/** The biggest saving from paying yearly across the paid workspace plans (for the Yearly toggle). */
const BEST_YEARLY_SAVING = Math.max(
  ...WORKSPACE_PLAN_ORDER.filter((t) => t !== "free").map((t) => Math.round((1 - WORKSPACE_PLANS[t].yearlyCents / (WORKSPACE_PLANS[t].monthlyCents * 12)) * 100)),
);

/**
 * Settings → (workspace) Plan & billing: the workspace's own plan (Free, Team or Business), billed per
 * member seat. Only its owner and admins the owner allowed can open it; the server refuses everyone else.
 * Nothing here touches anyone's Personal plan.
 */
export function WorkspaceBillingSection({ workspace }: { workspace: Workspace }) {
  const data = useQuery(api.workspaceBilling.summary, { workspaceId: workspace.id });
  const checkout = useAction(api.workspaceBilling.checkout);
  const portal = useAction(api.workspaceBilling.portal);
  const changePlan = useAction(api.workspaceBilling.changePlan);
  const cancel = useAction(api.workspaceBilling.cancel);
  const resume = useAction(api.workspaceBilling.resume);
  const testPurchase = useMutation(api.workspaceBilling.testPurchase);
  const toast = useToast();
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("checkout");
    if (q === "success") toast.show("Thanks! The workspace plan is being activated — it can take a moment.", { tone: "success" });
    if (q === "canceled") toast.show("Checkout canceled — nothing was charged.");
    if (q) window.history.replaceState(null, "", window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <p className="text-sm text-muted">Loading the workspace plan…</p>;
  const { entitlements: e, plan, subscription: sub } = data;
  const current = WORKSPACE_PLANS[plan.tier];
  const now = Date.now();
  const stripeBilled = sub?.provider === "stripe";
  const manual = sub?.provider === "manual";
  const cancelScheduled = e.paid && Boolean(sub?.cancelAtPeriodEnd && sub.currentPeriodEnd);
  const trialing = e.paid && Boolean(sub?.trialEndsAt && sub.trialEndsAt > now);
  const status = !e.paid ? null : sub?.status === "past_due" ? "Past due" : cancelScheduled ? "Cancel scheduled" : trialing ? "Trial" : "Active";
  const stripeLive = stripeBilled && e.paid;
  const usedPct = Math.min(100, (data.storageUsedBytes / Math.max(1, data.storageLimitBytes)) * 100);
  const seatPrice = formatPrice(plan.seatPriceCents);
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
  const openPortal = () => run("portal", async () => window.location.assign((await portal({ workspaceId: workspace.id })).url));
  const endPlan = () => run("cancel", () => cancel({ workspaceId: workspace.id }), `${current.name} will end at the close of this billing period.`);
  const choose = (tier: Exclude<WorkspaceTier, "free">) => {
    const planId = workspacePlanId(tier, interval) as PaidWorkspacePlanId;
    const name = WORKSPACE_PLANS[tier].name;
    if (stripeLive) return run(tier, () => changePlan({ workspaceId: workspace.id, planId }), `Switching to ${name}. Stripe prorates the difference.`);
    if (data.checkoutAvailable)
      return run(tier, async () => {
        const { url } = await checkout({ workspaceId: workspace.id, planId });
        window.location.assign(url);
      });
    if (data.testPurchases) return run(tier, () => testPurchase({ workspaceId: workspace.id, planId }), `${workspace.name} is on ${name} (test purchase).`);
  };

  return (
    <>
      <Card title="Workspace plan">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex flex-wrap items-center gap-2">
              <span className="ui-display text-[24px]">{current.name}</span>
              {e.paid && plan.interval ? <span className="rounded-full bg-[var(--glass-hover)] px-2 py-0.5 text-[12px] text-muted">{plan.interval === "year" ? "Annual" : "Monthly"}</span> : null}
              {status ? <span className={`rounded-full px-2 py-0.5 text-[12px] ${status === "Past due" ? "bg-danger-soft text-danger" : "bg-[var(--glass-hover)] text-muted"}`}>{status}</span> : null}
            </p>
            <p className="mt-1 text-sm text-muted">
              {!e.paid
                ? current.blurb
                : sub?.status === "past_due"
                  ? stripeBilled
                    ? "The last payment failed. Update the payment method to keep the plan — it stays on while payment is retried."
                    : "The last payment failed."
                  : cancelScheduled && sub?.currentPeriodEnd
                    ? `Ends ${dateOnly(sub.currentPeriodEnd)}. ${current.name} features remain available until then.`
                    : trialing && sub?.trialEndsAt
                      ? `Trial until ${dateOnly(sub.trialEndsAt)}.`
                      : sub?.currentPeriodEnd
                        ? `${manual ? "Set by the Folevi team — runs until" : "Renews"} ${dateOnly(sub.currentPeriodEnd)}.`
                        : manual
                          ? "Set by the Folevi team."
                          : current.blurb}
            </p>
            {e.paid ? (
              <p className="mt-1 text-sm text-muted">
                {seatPrice} per member / {per(plan.interval ?? "month")}
                {sub?.paymentMethod ? ` · Paid with ${sub.paymentMethod}` : ""}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {stripeBilled ? (
              <Button onClick={() => void openPortal()} aria-busy={busy === "portal" || undefined}>
                <CreditCard size={15} aria-hidden /> Manage subscription
              </Button>
            ) : null}
            {e.paid && !manual ? (
              cancelScheduled ? (
                <Button onClick={() => run("resume", () => resume({ workspaceId: workspace.id }), "The plan will keep renewing.")} aria-busy={busy === "resume" || undefined}>
                  Resume subscription
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => void endPlan()} aria-busy={busy === "cancel" || undefined}>
                  Cancel plan
                </Button>
              )
            ) : null}
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-[10px] bg-[var(--glass-hover)] p-4">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-heading">
              <Users size={15} aria-hidden /> Billable seats: {data.seats.toLocaleString()}
            </p>
            <p className="mt-1 text-sm text-muted">
              Guests: {data.guests.toLocaleString()} · Not billed
            </p>
            {data.pendingInvites ? <p className="mt-1 text-[12.5px] text-faint">{plural(data.pendingInvites, "pending invitation")} — billed once accepted.</p> : null}
          </div>
          <div className="rounded-[10px] bg-[var(--glass-hover)] p-4">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-heading">
              <CreditCard size={15} aria-hidden /> Estimated charge
            </p>
            <p className="mt-1 text-sm text-muted">
              {e.paid && plan.interval
                ? `${data.seats.toLocaleString()} × ${seatPrice} = ${formatPrice(data.estimatedChargeCents)}/${per(plan.interval)}`
                : "Free — nothing is charged."}
            </p>
            {e.paid && sub?.quantity !== null && sub?.quantity !== undefined && sub.quantity !== billedQuantity(data.seats) ? <p className="mt-1 text-[12.5px] text-faint">Updating the billed seats ({sub.quantity}) to match…</p> : null}
          </div>
          <div className="rounded-[10px] bg-[var(--glass-hover)] p-4">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-heading">
              <HardDrive size={15} aria-hidden /> Workspace storage
            </p>
            <p className="mt-1 text-sm text-muted">
              {formatBytes(data.storageUsedBytes)} of {formatBytes(data.storageLimitBytes)} used
            </p>
            <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--color-ink)_12%,transparent)]" role="meter" aria-label="Workspace storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usedPct)}>
              <div className={`h-full rounded-full ${usedPct > 90 ? "bg-danger" : "bg-heading"}`} style={{ width: `${Math.max(usedPct, 1.5)}%` }} />
            </div>
          </div>
          <div className="rounded-[10px] bg-[var(--glass-hover)] p-4">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-heading">
              <AiIcon size={15} aria-hidden className="text-[#7c6cf0]" /> AI Assistant
            </p>
            <p className="mt-1 text-sm text-muted">{e.ai ? (e.aiFairUse === "high" ? "Included for every member, with higher fair-use limits." : "Included for every member.") : "Comes with the Team and Business plans."}</p>
          </div>
        </div>
        {data.overLimit ? (
          <p role="status" className="mt-4 rounded-[10px] bg-danger-soft px-4 py-3 text-sm text-danger">
            <strong className="font-semibold">Over the storage limit.</strong> Everything already stored stays available, but new uploads are paused until space is freed or the plan is upgraded.
          </p>
        ) : null}
      </Card>

      <Card title="Choose a workspace plan" description="Workspace plans are billed per member. Guests are free.">
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
          {WORKSPACE_PLAN_ORDER.map((tier) => {
            const card = WORKSPACE_PLANS[tier];
            const cardPlan = workspacePlanId(tier, interval);
            // What a plan includes comes from the catalog (capabilities), never from its name.
            const paid = isPaidPlan(cardPlan);
            const price = interval === "year" ? card.yearlyCents : card.monthlyCents;
            const isCurrent = paid ? e.planId === cardPlan : !e.paid;
            const ai = PLAN_CATALOG[cardPlan].entitlements.aiAssistant;
            const canBuy = paid && (stripeLive || data.checkoutAvailable || data.testPurchases);
            return (
              <section key={tier} aria-label={`${card.name} plan`} className={`flex flex-col rounded-[14px] p-5 ${ai ? "bg-[linear-gradient(160deg,color-mix(in_oklab,#8b7cf6_12%,transparent),color-mix(in_oklab,#f58ab8_10%,transparent))] shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,#7c6cf0_35%,transparent)]" : "bg-[var(--glass-hover)] shadow-[inset_0_0_0_1px_var(--glass-border)]"}`}>
                <div className="flex items-center gap-2">
                  <h4 className="ui-display text-[19px]">{card.name}</h4>
                  {ai ? <span className="rounded-full bg-[#7c6cf0] px-2 py-0.5 text-[11px] font-semibold text-white">AI</span> : null}
                  {isCurrent ? <span className="ml-auto rounded-full bg-heading px-2 py-0.5 text-[11px] font-semibold text-canvas">Current</span> : null}
                </div>
                <p className="mt-2">
                  <span className="text-[30px] font-semibold tracking-tight text-heading">{formatPrice(price)}</span>
                  <span className="text-sm text-muted">{paid ? ` per member / ${per(interval)}` : ` / ${per(interval)}`}</span>
                </p>
                <p className="min-h-[20px] text-[12.5px] text-muted">
                  {!paid ? "No card required" : `${plural(data.seats, "member")} × ${formatPrice(price)} = ${formatPrice(seatChargeCents(price, data.seats))}/${per(interval)}`}
                </p>
                <p className="mt-2 text-[13px] text-ink">{card.blurb}</p>
                <ul className="mt-3 flex-1 space-y-1.5 text-[13px]">
                  {card.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check size={15} aria-hidden className="mt-0.5 flex-none text-[#2f9e62]" /> {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-4">
                  {isCurrent ? (
                    <Button disabled className="w-full">
                      Current plan
                    </Button>
                  ) : !paid ? (
                    e.paid && !manual && !cancelScheduled ? (
                      <Button variant="ghost" className="w-full" onClick={() => void endPlan()} aria-busy={busy === "cancel" || undefined}>
                        Switch to Free
                      </Button>
                    ) : null
                  ) : canBuy ? (
                    <Button variant={tier === "team" ? "primary" : "secondary"} className="w-full" onClick={() => choose(tier as Exclude<WorkspaceTier, "free">)} aria-busy={busy === tier || undefined}>
                      {busy === tier ? (stripeLive ? "Switching…" : data.checkoutAvailable ? "Opening checkout…" : "Switching…") : `${e.paid ? "Switch to" : "Upgrade to"} ${card.name}${!stripeLive && !data.checkoutAvailable ? " (test)" : ""}`}
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
        {!data.checkoutAvailable && !stripeLive ? (
          <p className="mt-3 text-[12.5px] text-faint">
            {data.testPurchases ? "Payments aren't connected yet, so upgrades here are test purchases (development only) — nothing is charged." : "Online payments for workspaces are coming soon."}
          </p>
        ) : null}
      </Card>

      <Card title="Billing history" description={`Payments for ${workspace.name} only.`}>
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
                    {p.plan === "team" || p.plan === "business" ? WORKSPACE_PLANS[p.plan].name : p.plan} · {p.interval === "year" ? "yearly" : "monthly"}
                    {p.quantity ? ` · ${plural(p.quantity, "seat")}` : ""}
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
