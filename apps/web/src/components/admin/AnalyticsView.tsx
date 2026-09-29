"use client";

import { useId, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex/api";
import { Select } from "@/components/ui/Select";
import { formatBytes } from "@/lib/format";
import { PLANS, PLAN_ORDER, formatPrice } from "@/lib/plans";
import { DailyChart } from "./DailyChart";
import { DocTitle, Meter, PageHeader, Panel, StatTile, selectCls } from "./ui";

const n = (v: number) => v.toLocaleString();
const pct = (v: number | null) => (v === null ? "No data" : `${Math.round(v * 100)}%`);

/** Growth, activity, plans, trials and AI use: aggregates only, never individual records or content. */
export function AnalyticsView() {
  const uid = useId();
  const [days, setDays] = useState(30);
  const d = useQuery(api.adminAnalytics.users, { days });
  const loading = d === undefined;
  const planTotal = d ? PLAN_ORDER.reduce((s, p) => s + d.plans[p], 0) : 0;

  return (
    <>
      <DocTitle>User analytics</DocTitle>
      <PageHeader
        title="User analytics"
        description="Growth, activity, plans and AI use across Folevi. Counts only. No individual records or content."
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor={`${uid}-days`} className="text-[13px] text-muted">
              Window
            </label>
            <Select id={`${uid}-days`} value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className={`${selectCls} w-36`}>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="180">Last 180 days</option>
            </Select>
          </div>
        }
      />

      <section aria-label="People">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6" aria-busy={loading || undefined}>
          <StatTile label="Users" value={d ? n(d.totals.users) : "…"} hint={d ? `${n(d.totals.verified)} verified · ${n(d.totals.suspended)} suspended` : undefined} />
          <StatTile label={`New, last ${days} days`} value={d ? n(d.signupsInWindow) : "…"} />
          <StatTile label="Active today" value={d ? n(d.active.day) : "…"} hint="Last 24 hours" />
          <StatTile label="Active this week" value={d ? n(d.active.week) : "…"} hint="Last 7 days" />
          <StatTile label="Active this month" value={d ? n(d.active.month) : "…"} hint={d && d.totals.users ? `${Math.round((d.active.month / d.totals.users) * 100)}% of users` : "Last 30 days"} />
          <StatTile label="Storage used" value={d ? formatBytes(d.storage.totalBytes) : "…"} hint={d ? `${formatBytes(d.storage.perUserBytes)} per user` : undefined} />
        </dl>
      </section>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <DailyChart
          title="Signups"
          description={`Per day, last ${days} days (UTC)`}
          points={(d?.signupsByDay ?? []).map((p) => ({ date: p.day, value: p.count }))}
          kind="bar"
          missing="zero"
          unit="signups"
          days={days}
          emptyMessage={loading ? "Loading…" : "No signups in this window."}
        />
        <DailyChart
          title="AI requests"
          description={`Per day, last ${days} days (UTC)`}
          points={(d?.ai.byDay ?? []).map((p) => ({ date: p.day, value: p.count }))}
          kind="bar"
          missing="zero"
          unit="requests"
          days={days}
          emptyMessage={loading ? "Loading…" : "No AI requests in this window."}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel title="Plans" description="What people pay for (trials count as their paid plan)">
          <ul className="space-y-3">
            {PLAN_ORDER.map((p) => (
              <li key={p}>
                <div className="mb-1 flex items-baseline justify-between text-[13px]">
                  <span>{PLANS[p].name}</span>
                  <span className="tabular-nums text-muted">
                    {d ? n(d.plans[p]) : "…"}
                    {d && planTotal ? ` · ${Math.round((d.plans[p] / planTotal) * 100)}%` : ""}
                  </span>
                </div>
                <Meter value={d?.plans[p] ?? 0} max={planTotal || 1} label={`${PLANS[p].name} accounts`} />
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Trials" description={`Pro AI trials, and how many convert (trials ending in the last ${days} days)`}>
          <dl className="grid grid-cols-2 gap-3">
            <StatTile label="On a trial now" value={d ? n(d.trialing) : "…"} />
            <StatTile label="Ending in 3 days" value={d ? n(d.trialsEndingSoon) : "…"} />
            <StatTile label="Trials ended" value={d ? n(d.trialConversion.ended) : "…"} />
            <StatTile label="Converted" value={d ? pct(d.trialConversion.rate) : "…"} hint={d ? `${n(d.trialConversion.converted)} now paying` : undefined} />
          </dl>
        </Panel>
        <Panel title="AI" description={`Last ${days} days, Personal and workspaces. 1 credit is $0.01 of AI cost.`}>
          <dl className="grid grid-cols-2 gap-3">
            <StatTile label="Requests" value={d ? n(d.ai.requests) : "…"} hint={d ? `${n(d.ai.byScope.personal)} Personal · ${n(d.ai.byScope.workspace)} workspaces` : undefined} />
            <StatTile label="People using AI" value={d ? n(d.ai.users) : "…"} hint={d && d.ai.users ? `${(d.ai.requests / d.ai.users).toFixed(1)} requests each` : undefined} />
            <StatTile label="Credits used" value={d ? n(d.ai.credits) : "…"} hint={d ? `${n(d.ai.creditsByScope.personal)} Personal · ${n(d.ai.creditsByScope.workspace)} workspaces` : undefined} />
            <StatTile label="AI cost" value={d ? formatPrice(d.ai.credits) : "…"} hint={d ? `${n(d.ai.tokensIn + d.ai.tokensOut)} tokens` : undefined} />
            <StatTile label="Credits granted" value={d ? n(d.creditGrants.credits) : "…"} hint={d ? `${n(d.creditGrants.count)} ${d.creditGrants.count === 1 ? "grant" : "grants"} by the Folevi team` : undefined} />
          </dl>
        </Panel>
      </div>
    </>
  );
}
