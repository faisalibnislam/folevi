"use client";

import { replaceEntry } from "@/lib/app/historyNav";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { AiIcon } from "@/components/ai/AiIcon";
import { CreditCard, HardDrive, Users } from "lucide-react";
import { api } from "@/lib/convex/api";
import type { Workspace } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";
import { TIER_NAMES, WORKSPACE_PLANS, WORKSPACE_PLAN_ORDER, billedQuantity, formatPrice, isPaidPlan, seatChargeCents, workspacePlanId, yearlySavingPercent, type BillingInterval, type PaidWorkspacePlanId, type WorkspaceTier } from "@/lib/plans";
import { Card } from "./Card";
import { CreditLines, Tile, UsageMeter, formatBytes, plural } from "./BillingSection";
import { BuyCreditsDialog } from "./BuyCreditsDialog";
import { PlanRow, PlanRows } from "./PlanRow";

// Billing dates are UTC, like the server and Polar, so a renewal and a credit reset never read a day apart.
const dateOnly = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const per = (interval: BillingInterval) => (interval === "year" ? "year" : "month");
type PaidTier = Exclude<WorkspaceTier, "free">;
const isPaidTier = (t: WorkspaceTier): t is PaidTier => isPaidPlan(workspacePlanId(t, "month"));
/** The biggest saving from paying yearly across the paid workspace plans (for the Yearly toggle). */
const BEST_YEARLY_SAVING = Math.max(...WORKSPACE_PLAN_ORDER.filter(isPaidTier).map(yearlySavingPercent));
const rank = (t: WorkspaceTier) => WORKSPACE_PLAN_ORDER.indexOf(t);

/**
 * Settings → (workspace) Plan & billing: the workspace's own plan (Free, Core, Pro or Pro AI), billed per
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
  const [buying, setBuying] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("checkout");
    if (q === "success") toast.show("Thanks. The workspace plan is being activated. It can take a moment.", { tone: "success" });
    if (q === "canceled") toast.show("Checkout canceled. Nothing was charged.");
    if (q) replaceEntry(window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <p className="text-sm text-muted">Loading the workspace plan…</p>;
  const { entitlements: e, plan, subscription: sub } = data;
  const current = WORKSPACE_PLANS[plan.tier];
  const now = Date.now();
  const polar = sub?.provider === "polar";
  const manual = sub?.provider === "manual";
  const cancelScheduled = e.paid && Boolean(sub?.cancelAtPeriodEnd && sub.currentPeriodEnd);
  const trialing = e.paid && Boolean(sub?.trialEndsAt && sub.trialEndsAt > now);
  const status = !e.paid ? null : sub?.status === "past_due" ? "Past due" : cancelScheduled ? "Cancel scheduled" : trialing ? "Trial" : "Active";
  // A Polar subscription that's running: plan changes are subscription updates (Polar prorates).
  const polarLive = polar && e.paid && sub?.status !== "canceled";
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
  const choose = (tier: PaidTier) => {
    const planId = workspacePlanId(tier, interval) as PaidWorkspacePlanId;
    const name = WORKSPACE_PLANS[tier].name;
    if (polarLive) return run(tier, () => changePlan({ workspaceId: workspace.id, planId }), `Changing to ${name}. Polar prorates the difference.`);
    if (data.checkoutAvailable)
      return run(tier, async () => {
        const { url } = await checkout({ workspaceId: workspace.id, planId });
        window.location.assign(url);
      });
    if (data.testPurchases) return run(tier, () => testPurchase({ workspaceId: workspace.id, planId }), `${workspace.name} is on ${name} (test purchase).`);
  };
  const canChoose = polarLive || data.checkoutAvailable || data.testPurchases;
  const test = !polarLive && !data.checkoutAvailable;

  // Storage: the owner's free pool on Free, each member's own quota on a paid plan, or a limit set by hand.
  const perMember = data.storageRule === "per_person" && data.storagePerMemberBytes !== null;
  const storageUsed = perMember ? (data.yourStorageUsedBytes ?? 0) : data.storageUsedBytes;
  const storageLimit = perMember ? data.storagePerMemberBytes! : data.storageLimitBytes;
  const overLimit = storageUsed > storageLimit;
  // The pool counts this workspace too (it's free whenever there's a pool).
  const otherFree = data.pool ? Math.max(0, data.pool.workspaces - 1) : 0;
  const sharedWith = data.pool ? [data.pool.includesPersonal ? "their Personal" : null, otherFree ? plural(otherFree, "other free workspace") : null].filter(Boolean).join(" and ") : "";
  const poolNote = `Uses the owner's free ${formatBytes(data.storageLimitBytes)}${sharedWith ? `, shared with ${sharedWith}` : ""}. Everyone's uploads here count against it.`;

  return (
    <>
      <Card title="Workspace plan">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex flex-wrap items-center gap-2">
              <span className="ui-display text-[24px]">{current.name}</span>
              {e.paid && plan.interval ? <span className="rounded-[6px] bg-[var(--glass-hover)] px-2 py-0.5 text-[12px] text-muted">{plan.interval === "year" ? "Annual" : "Monthly"}</span> : null}
              {status ? <span className={`rounded-[6px] px-2 py-0.5 text-[12px] ${status === "Past due" ? "bg-danger-soft text-danger" : "bg-[var(--glass-hover)] text-muted"}`}>{status}</span> : null}
            </p>
            <p className="mt-1 text-sm text-muted">
              {!e.paid
                ? current.blurb
                : sub?.status === "past_due"
                  ? polar
                    ? "The last payment failed. The person who pays can update the payment method in Manage billing. The plan stays on while payment is retried."
                    : "The last payment failed."
                  : cancelScheduled && sub?.currentPeriodEnd
                    ? `Ends ${dateOnly(sub.currentPeriodEnd)}. ${current.name} features remain available until then.`
                    : trialing && sub?.trialEndsAt
                      ? `Trial until ${dateOnly(sub.trialEndsAt)}.`
                      : sub?.currentPeriodEnd
                        ? `${manual ? "Set by the Folevi team until" : "Renews"} ${dateOnly(sub.currentPeriodEnd)}.`
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
            {polar && !sub?.youPay ? <p className="mt-1 text-[12.5px] text-faint">The person who started this subscription pays for it, and only they can open the billing portal for invoices and the payment method. You can still change, cancel or resume the plan here.</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {polar && sub?.youPay ? (
              <Button onClick={() => void openPortal()} aria-busy={busy === "portal" || undefined}>
                <CreditCard size={15} aria-hidden /> Manage billing
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
          <Tile icon={<Users size={15} aria-hidden />} title={`Billable seats: ${data.seats.toLocaleString()}`}>
            <p className="mt-1 text-sm text-muted">Guests: {data.guests.toLocaleString()} · Not billed</p>
            {data.pendingInvites ? <p className="mt-1 text-[12.5px] text-faint">{plural(data.pendingInvites, "pending invitation")}, billed once accepted.</p> : null}
          </Tile>
          <Tile icon={<CreditCard size={15} aria-hidden />} title="Estimated charge">
            <p className="mt-1 text-sm text-muted">{e.paid && plan.interval ? `${data.seats.toLocaleString()} × ${seatPrice} = ${formatPrice(data.estimatedChargeCents)}/${per(plan.interval)}` : "Free. Nothing is charged."}</p>
            {e.paid && sub?.quantity !== null && sub?.quantity !== undefined && sub.quantity !== billedQuantity(data.seats) ? <p className="mt-1 text-[12.5px] text-faint">Updating the billed seats ({sub.quantity}) to match…</p> : null}
          </Tile>
          <Tile icon={<HardDrive size={15} aria-hidden />} title={perMember ? "Your storage here" : "Workspace storage"}>
            <p className="mt-1 text-sm text-muted">
              {formatBytes(storageUsed)} of {formatBytes(storageLimit)} used
            </p>
            <UsageMeter label={perMember ? "Your storage used here" : "Workspace storage used"} pct={(storageUsed / Math.max(1, storageLimit)) * 100} />
            <p className="mt-2 text-[12.5px] text-faint">
              {perMember
                ? `Each member has ${formatBytes(storageLimit)} here, and their own uploads count against it. Everyone's uploads: ${formatBytes(data.storageUsedBytes)}.`
                : data.storageRule === "override"
                  ? "A limit set by the Folevi team."
                  : poolNote}
            </p>
          </Tile>
          <Tile icon={<AiIcon size={15} aria-hidden className="text-[#7c6cf0]" />} title="AI credits">
            {!e.ai ? (
              <p className="mt-1 text-sm text-muted">Core doesn&apos;t include AI, so nothing in this workspace is sent to an AI model.</p>
            ) : !e.paid ? (
              <p className="mt-1 text-sm text-muted">On Free, each member uses their own personal AI credits here.</p>
            ) : data.credits ? (
              <>
                <p className="mt-1 text-[12.5px] text-faint">Yours in this workspace. Every member has their own.</p>
                <CreditLines c={{ ...data.credits, trialing: false }} />
                {data.credits.canBuy ? (
                  <Button size="sm" className="mt-3" onClick={() => setBuying(true)}>
                    Buy credits
                  </Button>
                ) : null}
              </>
            ) : (
              <p className="mt-1 text-sm text-muted">{`${e.monthlyCredits.toLocaleString()} AI credits per member each month.`}</p>
            )}
          </Tile>
        </div>
        {overLimit ? (
          <p role="status" className="mt-4 rounded-[10px] bg-danger-soft px-4 py-3 text-sm text-danger">
            <strong className="font-semibold">Over the storage limit.</strong> Everything already stored stays available, but new uploads are paused until space is freed or the plan is upgraded.
          </p>
        ) : null}
      </Card>
      {buying ? <BuyCreditsDialog open onClose={() => setBuying(false)} target={{ kind: "workspace", workspaceId: workspace.id }} name={workspace.name} /> : null}

      <Card title="Choose a workspace plan" description="Workspace plans are billed per member. Guests are free.">
        <div className="ui-seg ui-well mb-4 w-fit" role="group" aria-label="Billing period">
          <button type="button" aria-pressed={interval === "month"} onClick={() => setInterval("month")} className="h-8 whitespace-nowrap !px-4">
            Monthly
          </button>
          <button type="button" aria-pressed={interval === "year"} onClick={() => setInterval("year")} className="h-8 whitespace-nowrap !px-3.5">
            Yearly
            <span className="whitespace-nowrap rounded-[6px] bg-[color-mix(in_oklab,#2f9e62_14%,transparent)] px-2 py-0.5 text-[11px] font-semibold leading-none text-[#1f7a4a] dark:text-[#6fd39b]">Save up to {BEST_YEARLY_SAVING}%</span>
          </button>
        </div>
        <PlanRows>
          {WORKSPACE_PLAN_ORDER.map((tier) => {
            const card = WORKSPACE_PLANS[tier];
            const cardPlan = workspacePlanId(tier, interval);
            const paid = isPaidTier(tier);
            const price = interval === "year" ? card.yearlyCents : card.monthlyCents;
            const sameTier = paid ? e.paid && plan.tier === tier : !e.paid;
            const isCurrent = paid ? e.planId === cardPlan : !e.paid;
            const highlight = tier === "pro_ai";
            const label = sameTier ? `Switch to ${interval === "year" ? "yearly" : "monthly"}` : !e.paid || rank(tier) > rank(plan.tier) ? `Upgrade to ${card.name}` : `Change to ${card.name}`;
            return (
              <PlanRow
                key={tier}
                name={card.name}
                current={isCurrent}
                highlight={highlight}
                price={formatPrice(price)}
                per={per(interval)}
                note={!paid ? "Nobody is billed" : `Per member. ${plural(data.seats, "member")} × ${formatPrice(price)} = ${formatPrice(seatChargeCents(price, data.seats))}/${per(interval)}`}
                blurb={card.blurb}
                features={card.features}
                action={
                  isCurrent ? (
                    <Button disabled className="w-full">
                      Current plan
                    </Button>
                  ) : !paid ? (
                    e.paid && !manual && !cancelScheduled ? (
                      <Button variant="ghost" className="w-full" onClick={() => void endPlan()} aria-busy={busy === "cancel" || undefined}>
                        Switch to Free
                      </Button>
                    ) : null
                  ) : canChoose ? (
                    <Button variant={highlight ? "primary" : "secondary"} className="w-full" onClick={() => void choose(tier)} aria-busy={busy === tier || undefined} disabled={busy !== null && busy !== tier}>
                      {busy === tier ? (polarLive ? "Changing…" : data.checkoutAvailable ? "Opening checkout…" : "Switching…") : `${label}${test ? " (test)" : ""}`}
                    </Button>
                  ) : (
                    <Button disabled className="w-full">
                      Coming soon
                    </Button>
                  )
                }
              />
            );
          })}
        </PlanRows>
        <p className="mt-3 text-[12.5px] text-faint">
          {polarLive || data.checkoutAvailable
            ? "Payments are handled by Polar, which works out any tax. Adding or removing members changes the seats, prorated."
            : data.testPurchases
              ? "Payments aren't connected yet, so upgrades here are test purchases (development only), and nothing is charged."
              : "Online payments for workspaces are coming soon."}
        </p>
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
                    {p.plan ? TIER_NAMES[p.plan] : "Plan"} · {p.interval === "year" ? "yearly" : "monthly"}
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
