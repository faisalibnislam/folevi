"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState, type ReactNode } from "react";
import { AiIcon } from "@/components/ai/AiIcon";
import { Check, CreditCard, HardDrive, MonitorSmartphone } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";
import { DAY_MS, PACK_VALID_MONTHS, PLANS, PLAN_ORDER, TIER_NAMES, formatPrice, isPaidPlan, monthlyEquivalent, yearlySavingPercent, type BillingInterval, type PersonalTier } from "@/lib/plans";
import { creditCount, creditDate } from "@/components/ai/AiCredits";
import { AppLink } from "@/lib/app/router";
import { Card } from "./Card";
import { BuyCreditsDialog, type CreditTarget } from "./BuyCreditsDialog";

export function formatBytes(bytes: number): string {
  // "1 GB", "1.5 GB", "20 GB": no trailing ".0".
  const fixed = (n: number, small: boolean) => n.toFixed(small ? 1 : 0).replace(/\.0$/, "");
  if (bytes < 1024 ** 2) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${fixed(bytes / 1024 ** 2, bytes < 10 * 1024 ** 2)} MB`;
  return `${fixed(bytes / 1024 ** 3, bytes < 10 * 1024 ** 3)} GB`;
}
// Billing dates are UTC, like the server and Polar, so a renewal and a credit reset never read a day apart.
const dateOnly = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

type PaidTier = Exclude<PersonalTier, "free">;
/** The Personal tiers that are paid for (from the catalog). */
const isPaidTier = (t: PersonalTier): t is PaidTier => isPaidPlan(PLANS[t].monthly);
/** The biggest saving from paying yearly, across the paid plans (for the Yearly toggle). */
const BEST_YEARLY_SAVING = Math.max(...PLAN_ORDER.filter(isPaidTier).map(yearlySavingPercent));
const rank = (t: PersonalTier) => PLAN_ORDER.indexOf(t);

/** A used-of-total bar (storage, credits). */
export function UsageMeter({ label, pct, invert = false }: { label: string; pct: number; invert?: boolean }) {
  const shown = Math.min(100, Math.max(0, pct));
  // `invert`: the bar shows what's left, and turns red when little is.
  const alarm = invert ? shown < 10 : shown > 90;
  return (
    <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--color-ink)_12%,transparent)]" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown)}>
      <div className={`h-full rounded-full ${alarm ? "bg-danger" : "bg-heading"}`} style={{ width: `${Math.max(shown, 1.5)}%` }} />
    </div>
  );
}

/** A tile in a plan card's grid. */
export function Tile({ icon, title, children, wide = false }: { icon: ReactNode; title: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`rounded-[10px] bg-[var(--glass-hover)] p-4 ${wide ? "sm:col-span-2" : ""}`}>
      <p className="flex items-center gap-2 text-[13px] font-semibold text-heading">
        {icon} {title}
      </p>
      {children}
    </div>
  );
}

/** One place's AI credits: what's left this period, when it resets, and any extra (bought or given) credits. */
export function CreditLines({ c }: { c: { available: number; allowance: number; monthlyLeft: number; packCredits: number; resetsAt: number; nextPackExpiry: number | null; trialing: boolean } }) {
  return (
    <>
      <p className="mt-1 text-sm text-muted">{creditCount(c.available)} left</p>
      {c.allowance > 0 ? <UsageMeter label="Monthly AI credits left" pct={(c.monthlyLeft / c.allowance) * 100} invert /> : null}
      <p className="mt-2 text-[12.5px] text-faint">
        {c.trialing ? `${c.monthlyLeft.toLocaleString()} of ${c.allowance.toLocaleString()} trial credits left. Your trial ends on ${creditDate(c.resetsAt)}.` : `${c.monthlyLeft.toLocaleString()} of ${c.allowance.toLocaleString()} monthly credits left. Resets on ${creditDate(c.resetsAt)}.`}
        {c.packCredits > 0 ? ` Plus ${plural(c.packCredits, "extra credit")}${c.nextPackExpiry ? `, the first expiring on ${creditDate(c.nextPackExpiry)}` : ""}.` : ""}
      </p>
    </>
  );
}

/**
 * Settings → Plan & billing: the person's Personal plan (Free, Core, Pro or Pro AI), storage, AI credits and
 * devices; choosing a plan; AI credits everywhere they have them (buying more); and personal payment
 * history. Team workspaces have their own plans and billing.
 */
export function BillingSection() {
  const data = useQuery(api.billing.mine, {});
  const accounts = useQuery(api.billing.creditAccounts, {});
  const checkout = useAction(api.billing.checkout);
  const portal = useAction(api.billing.portal);
  const testPurchase = useMutation(api.billing.testPurchase);
  const cancel = useMutation(api.billing.cancelPlan);
  const resume = useMutation(api.billing.resumePlan);
  const toast = useToast();
  const [interval, setInterval] = useState<BillingInterval>("year");
  const [busy, setBusy] = useState<string | null>(null);
  const [buyFor, setBuyFor] = useState<{ target: CreditTarget; name: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("checkout");
    const credits = params.get("credits");
    if (q === "success") toast.show("Thanks. Your plan is being activated. It can take a moment.", { tone: "success" });
    if (q === "canceled") toast.show("Checkout canceled. Nothing was charged.");
    if (credits === "success") toast.show("Thanks. Your AI credits are being added. It can take a moment.", { tone: "success" });
    if (q || credits) window.history.replaceState(null, "", window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <p className="text-sm text-muted">Loading your plan…</p>;
  const { entitlements: e, subscription: sub, credits } = data;
  const current = PLANS[e.paidPlan];
  const planLabel = e.trialing ? "Pro AI trial" : current.name;
  const trialDaysLeft = e.trialing && e.trialEndsAt ? Math.max(1, Math.ceil((e.trialEndsAt - Date.now()) / DAY_MS)) : 0;
  const usedPct = (data.storageUsedBytes / Math.max(1, data.storageLimitBytes)) * 100;
  // The plan's state: trial, active, past due, or cancel scheduled (Free has none).
  const cancelScheduled = e.paid && Boolean(sub?.cancelAtPeriodEnd && sub.currentPeriodEnd);
  const status = e.trialing ? "Trial" : !e.paid ? null : sub?.status === "past_due" ? "Past due" : cancelScheduled ? "Cancel scheduled" : "Active";
  // Billed through Polar: changes go through checkout (switching the subscription) and the billing portal.
  const polar = sub?.provider === "polar";
  const polarLive = polar && e.paid && sub?.status !== "canceled";
  // Test and hand-set plans are canceled and resumed here.
  const selfServe = e.paid && (sub?.provider === "test" || sub?.provider === "manual");
  const canChoose = data.checkoutAvailable || data.testPurchases;
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
  const switchToFree = () => run("free", () => cancel({}), "Your plan will end at the close of this billing period.");
  const choose = (plan: PaidTier) => {
    if (data.checkoutAvailable)
      return run(plan, async () => {
        const { url } = await checkout({ plan, interval });
        // No page: the running Polar subscription was switched to the new plan.
        if (url) window.location.assign(url);
        else toast.show("Your plan is changing. It can take a moment.", { tone: "success" });
      });
    if (data.testPurchases) return run(plan, () => testPurchase({ plan, interval }), `You're on ${PLANS[plan].name} (test purchase).`);
  };
  const storageNote =
    data.storageRule === "shared_free"
      ? data.poolWorkspaces
        ? `Shared by your Personal and the ${plural(data.poolWorkspaces, "free workspace")} you own.`
        : "Shared with any free workspaces you create."
      : data.storageRule === "override"
        ? "A limit set by the Folevi team."
        : e.trialing
          ? `Your own ${formatBytes(data.storageLimitBytes)} during your trial.`
          : `Your own ${formatBytes(data.storageLimitBytes)} on ${current.name}.`;

  return (
    <>
      <Card title="Your plan">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex flex-wrap items-center gap-2">
              <span className="ui-display text-[24px]">{planLabel}</span>
              {e.paid && sub?.interval ? <span className="rounded-full bg-[var(--glass-hover)] px-2 py-0.5 text-[12px] text-muted">{sub.interval === "year" ? "Annual" : "Monthly"}</span> : null}
              {status ? <span className={`rounded-full px-2 py-0.5 text-[12px] ${status === "Past due" ? "bg-danger-soft text-danger" : "bg-[var(--glass-hover)] text-muted"}`}>{status}</span> : null}
            </p>
            <p className="mt-1 text-sm text-muted">
              {e.trialing
                ? `${trialDaysLeft} ${trialDaysLeft === 1 ? "day" : "days"} of Pro AI left (until ${dateOnly(e.trialEndsAt!)}). Then you'll move to Free unless you choose a plan.`
                : e.paid && sub?.status === "past_due"
                  ? polar
                    ? "Your last payment failed. Update your payment method in Manage billing to keep your plan."
                    : "Your last payment failed."
                  : e.paid && sub?.currentPeriodEnd
                    ? sub.cancelAtPeriodEnd
                      ? `Ends ${dateOnly(sub.currentPeriodEnd)}. Your ${current.name} features remain available until then.`
                      : `${sub.provider === "manual" ? "Set by the Folevi team until" : "Renews"} ${dateOnly(sub.currentPeriodEnd)}.`
                    : e.paid && sub?.provider === "manual"
                      ? "Set by the Folevi team."
                      : current.blurb}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {polar ? (
              <Button onClick={() => void openPortal()} aria-busy={busy === "portal" || undefined}>
                <CreditCard size={15} aria-hidden /> Manage billing
              </Button>
            ) : null}
            {selfServe ? (
              cancelScheduled ? (
                <Button onClick={() => run("resume", () => resume({}), "Your plan will keep renewing.")} aria-busy={busy === "resume" || undefined}>
                  Resume subscription
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => void switchToFree()} aria-busy={busy === "free" || undefined}>
                  Cancel plan
                </Button>
              )
            ) : null}
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Tile icon={<HardDrive size={15} aria-hidden />} title="Storage">
            <p className="mt-1 text-sm text-muted">
              {formatBytes(data.storageUsedBytes)} of {formatBytes(data.storageLimitBytes)} used
            </p>
            <UsageMeter label="Storage used" pct={usedPct} />
            <p className="mt-2 text-[12.5px] text-faint">{storageNote}</p>
          </Tile>
          <Tile icon={<AiIcon size={15} aria-hidden className="text-[#7c6cf0]" />} title="AI credits">
            {credits.aiIncluded ? (
              <CreditLines c={credits} />
            ) : (
              <p className="mt-1 text-sm text-muted">Core doesn&apos;t include AI, so nothing in your notes is sent to an AI model. Pro and Pro AI come with AI credits every month.</p>
            )}
          </Tile>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] bg-[var(--glass-hover)] p-4 sm:col-span-2">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-heading">
                <MonitorSmartphone size={15} aria-hidden /> Devices
              </p>
              <p className="mt-1 text-sm text-muted">
                {e.devices === null
                  ? `Unlimited${e.trialing ? " during your trial" : ""} · signed in on ${plural(data.devicesActive, "device")}`
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
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PLAN_ORDER.map((id) => {
            const plan = PLANS[id];
            const paid = isPaidTier(id);
            const price = interval === "year" ? plan.yearlyCents : plan.monthlyCents;
            // Your tier (any interval), and your exact plan.
            const sameTier = paid ? e.paid && e.paidPlan === id : !e.paid;
            const isCurrent = paid ? e.paidPlanId === (interval === "year" ? plan.yearly : plan.monthly) : !e.paid;
            const highlight = id === "pro_ai";
            const label = sameTier
              ? `Switch to ${interval === "year" ? "yearly" : "monthly"}`
              : e.trialing
                ? `Choose ${plan.name}`
                : !e.paid || rank(id) > rank(e.paidPlan)
                  ? `Upgrade to ${plan.name}`
                  : `Change to ${plan.name}`;
            return (
              <section key={id} aria-label={`${plan.name} plan`} className={`flex flex-col rounded-[14px] p-5 ${highlight ? "bg-[linear-gradient(160deg,color-mix(in_oklab,#8b7cf6_12%,transparent),color-mix(in_oklab,#f58ab8_10%,transparent))] shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,#7c6cf0_35%,transparent)]" : "bg-[var(--glass-hover)] shadow-[inset_0_0_0_1px_var(--glass-border)]"}`}>
                <div className="flex items-center gap-2">
                  <h4 className="ui-display text-[19px]">{plan.name}</h4>
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
                    selfServe && !cancelScheduled ? (
                      <Button variant="ghost" className="w-full" onClick={() => void switchToFree()} aria-busy={busy === "free" || undefined}>
                        Switch to Free
                      </Button>
                    ) : polarLive && !sub?.cancelAtPeriodEnd ? (
                      <p className="text-center text-[12.5px] text-muted">To switch to Free, cancel in Manage billing.</p>
                    ) : null
                  ) : canChoose ? (
                    <Button variant={highlight ? "primary" : "secondary"} className="w-full" onClick={() => void choose(id)} aria-busy={busy === id || undefined} disabled={busy !== null && busy !== id}>
                      {busy === id ? (!data.checkoutAvailable ? "Switching…" : polarLive ? "Changing…" : "Opening checkout…") : `${label}${!data.checkoutAvailable ? " (test)" : ""}`}
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
        <p className="mt-3 text-[12.5px] text-faint">
          {data.checkoutAvailable
            ? "Payments are handled by Polar. Any tax is added at checkout. "
            : data.testPurchases
              ? "Payments aren't connected yet, so upgrades here are test purchases (development only), and nothing is charged. "
              : "Online payments are coming soon. "}
          AI credits: a rewrite uses about 1, Ask AI about 2, a flowchart 3 to 5.
        </p>
      </Card>

      <Card title="AI credits" description={`Monthly credits reset each billing period. Extra credits you buy last ${PACK_VALID_MONTHS} months and are used after the monthly ones.`}>
        {!accounts ? (
          <p className="text-sm text-muted">Loading your AI credits…</p>
        ) : (
          <ul className="divide-y divide-line/70">
            {accounts.accounts.map((a) => (
              <li key={a.workspaceId ?? "personal"} aria-label={`AI credits: ${a.name}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="text-[14px] font-semibold text-heading">
                    {a.name} <span className="font-normal text-muted">· {a.plan}</span>
                  </p>
                  {a.aiIncluded ? (
                    <p className="mt-0.5 text-sm text-muted">
                      {creditCount(a.available)} left · {a.monthlyLeft.toLocaleString()} of {a.allowance.toLocaleString()} {a.trialing ? `trial credits, trial ends on ${creditDate(a.resetsAt)}` : `monthly credits, resets on ${creditDate(a.resetsAt)}`}
                      {a.packCredits > 0 ? ` · ${plural(a.packCredits, "extra credit")}${a.nextPackExpiry ? `, the first expiring on ${creditDate(a.nextPackExpiry)}` : ""}` : ""}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-sm text-muted">Not included in Core. Nothing is sent to an AI model.</p>
                  )}
                </div>
                {a.canBuy ? (
                  <Button size="sm" onClick={() => setBuyFor({ target: a.kind === "seat" && a.workspaceId ? { kind: "workspace", workspaceId: a.workspaceId } : { kind: "personal" }, name: a.name })}>
                    Buy credits
                  </Button>
                ) : a.kind === "personal" && a.aiIncluded ? (
                  <span className="text-[12.5px] text-faint">Extra credits come with Pro and Pro AI.</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-[12.5px] text-faint">In free workspaces, and on pages shared with you as a guest, AI uses your Personal credits.</p>
      </Card>
      {buyFor ? <BuyCreditsDialog open onClose={() => setBuyFor(null)} target={buyFor.target} name={buyFor.name} /> : null}

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
                  <td className="py-2">{p.plan === "credits" ? creditCount(p.credits ?? 0) : `${TIER_NAMES[p.plan]} · ${p.interval === "year" ? "yearly" : "monthly"}`}</td>
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
