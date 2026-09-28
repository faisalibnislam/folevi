"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex/api";
import { Select } from "@/components/ui/Select";
import { PLANS, formatPrice, type PlanId } from "@/lib/plans";
import { useAdmin } from "./AdminApp";
import { Badge, Callout, DataTable, DocTitle, EmptyRow, LoadingRows, PageHeader, Panel, StatTile, Switch, Time, humanize, selectCls, td, tdNum, th, thNum } from "./ui";

const n = (v: number) => v.toLocaleString();
const money = (cents: number) => formatPrice(cents);
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });

/** Monthly bars as a table: every value is readable text; the bar is decoration. */
function MonthlyBars({ caption, rows, format }: { caption: string; rows: { month: string; value: number; note?: string }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <DataTable caption={caption} minWidth={360}>
      <tbody>
        {rows.map((r) => (
          <tr key={r.month}>
            <th scope="row" className={`${td} w-20 whitespace-nowrap text-left font-normal text-muted`}>
              {monthLabel(r.month)}
            </th>
            <td className={`${td} w-full align-middle`}>
              <div aria-hidden className="h-2 rounded-full bg-plum/80" style={{ width: `${Math.max((r.value / max) * 100, r.value > 0 ? 1.5 : 0)}%` }} />
            </td>
            <td className={`${tdNum} whitespace-nowrap`}>
              {format(r.value)}
              {r.note ? <span className="ml-1.5 text-xs text-muted">{r.note}</span> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

/** Money: recurring revenue, subscribers, monthly revenue, new vs churned, failures and refunds. Admins and owners. */
export function RevenueView() {
  const uid = useId();
  const admin = useAdmin();
  const [months, setMonths] = useState(12);
  const [includeTest, setIncludeTest] = useState(false);
  const r = useQuery(api.adminAnalytics.revenue, { months, includeTest });
  const loading = r === undefined;

  return (
    <>
      <DocTitle>Revenue</DocTitle>
      <PageHeader
        title="Revenue"
        description="Recurring revenue and payments. Plans set by hand (comps) aren't counted as revenue."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-[13px] text-muted">
              <Switch checked={includeTest} onChange={setIncludeTest} label="Include test purchases" />
              Include test purchases
            </span>
            <label htmlFor={`${uid}-months`} className="sr-only">
              Months
            </label>
            <Select id={`${uid}-months`} value={String(months)} onChange={(e) => setMonths(Number(e.target.value))} className={`${selectCls} w-40`}>
              <option value="6">Last 6 months</option>
              <option value="12">Last 12 months</option>
              <option value="24">Last 24 months</option>
            </Select>
          </div>
        }
      />

      {r?.testIncluded ? (
        <div className="mb-4">
          <Callout tone="warning">Test purchases made in development are included in these numbers.</Callout>
        </div>
      ) : null}

      <section aria-label="Recurring revenue">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6" aria-busy={loading || undefined}>
          <StatTile label="MRR" value={r ? money(r.mrrCents) : "…"} hint="Monthly recurring revenue" />
          <StatTile label="ARR" value={r ? money(r.arrCents) : "…"} hint="MRR × 12" />
          <StatTile label="Paying accounts" value={r ? n(r.paying) : "…"} />
          <StatTile label="Revenue per payer" value={r ? money(r.arppuCents) : "…"} hint="Per month (ARPPU)" />
          <StatTile label="Last 30 days" value={r ? money(r.last30.grossCents - r.last30.refundedCents) : "…"} hint={r ? `${money(r.last30.refundedCents)} refunded · ${n(r.last30.failed)} failed` : undefined} />
          <StatTile label="At risk" value={r ? n(r.cancelingAtPeriodEnd + r.pastDue) : "…"} hint={r ? `${n(r.cancelingAtPeriodEnd)} canceling · ${n(r.pastDue)} past due` : undefined} />
        </dl>
      </section>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Panel title="Revenue by month" description="Net of refunds" flush>
          {r ? (
            <MonthlyBars
              caption="Net revenue by month"
              rows={r.revenueByMonth.map((m) => ({ month: m.month, value: m.netCents, note: m.refundedCents ? `−${money(m.refundedCents)}` : undefined }))}
              format={money}
            />
          ) : (
            <p className="p-4 text-sm text-muted">Loading…</p>
          )}
        </Panel>
        <Panel title="Subscribers" description="Per plan and billing period, today" flush>
          <DataTable caption="Subscribers by plan" minWidth={360}>
            <thead>
              <tr>
                <th scope="col" className={th}>Plan</th>
                <th scope="col" className={thNum}>Price</th>
                <th scope="col" className={thNum}>Accounts</th>
                <th scope="col" className={thNum}>MRR</th>
              </tr>
            </thead>
            <tbody>
              {(["basic", "pro"] as const).flatMap((plan) =>
                (["month", "year"] as const).map((interval) => {
                  const count = r?.byPlan[`${plan}:${interval}`] ?? 0;
                  const price = interval === "month" ? PLANS[plan].monthlyCents : PLANS[plan].yearlyCents;
                  const monthly = interval === "month" ? price : Math.round(price / 12);
                  return (
                    <tr key={`${plan}:${interval}`}>
                      <td className={td}>
                        {PLANS[plan].name} · {interval === "month" ? "monthly" : "yearly"}
                      </td>
                      <td className={tdNum}>
                        {money(price)}/{interval === "month" ? "mo" : "yr"}
                      </td>
                      <td className={tdNum}>{r ? n(count) : "…"}</td>
                      <td className={tdNum}>{r ? money(count * monthly) : "…"}</td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </DataTable>
        </Panel>
        <Panel title="New paying accounts" description="By the month they started paying" flush>
          {r ? <MonthlyBars caption="New paying accounts by month" rows={r.newByMonth.map((m) => ({ month: m.month, value: m.count }))} format={n} /> : <p className="p-4 text-sm text-muted">Loading…</p>}
        </Panel>
        <Panel title="Cancellations" description="Paid plans that ended, by month" flush>
          {r ? <MonthlyBars caption="Cancellations by month" rows={r.churnByMonth.map((m) => ({ month: m.month, value: m.count }))} format={n} /> : <p className="p-4 text-sm text-muted">Loading…</p>}
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title="Recent payments" description="The last 25. Emails are partly hidden; open the person to see more (audited)." flush>
          <DataTable caption="Recent payments" minWidth={720}>
            <thead>
              <tr>
                <th scope="col" className={th}>When</th>
                <th scope="col" className={th}>Person</th>
                <th scope="col" className={th}>Plan</th>
                <th scope="col" className={thNum}>Amount</th>
                <th scope="col" className={th}>Status</th>
                <th scope="col" className={th}>Via</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LoadingRows colSpan={6} rows={3} />
              ) : r.recent.length === 0 ? (
                <EmptyRow colSpan={6}>No payments in this period.</EmptyRow>
              ) : (
                r.recent.map((p) => (
                  <tr key={p.id}>
                    <td className={td}>
                      <Time ts={p.createdAt} />
                    </td>
                    <td className={td}>
                      {admin.can("users.view") ? (
                        <Link href={`/admin/users/${p.profileId}`} className="font-medium underline decoration-line-strong underline-offset-2 hover:decoration-ink">
                          {p.name}
                        </Link>
                      ) : (
                        p.name
                      )}{" "}
                      <span className="text-xs text-muted">{p.email}</span>
                    </td>
                    <td className={td}>
                      {PLANS[p.plan as PlanId]?.name ?? p.plan} · {p.interval === "year" ? "yearly" : "monthly"}
                    </td>
                    <td className={tdNum}>{money(p.amountCents)}</td>
                    <td className={td}>
                      <Badge tone={p.status === "paid" ? "success" : p.status === "failed" ? "danger" : "neutral"}>{humanize(p.status)}</Badge>
                    </td>
                    <td className={td}>{p.provider === "test" ? <Badge tone="warning">Test</Badge> : humanize(p.provider)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </Panel>
      </div>
    </>
  );
}
