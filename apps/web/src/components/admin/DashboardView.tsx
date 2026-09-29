"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex/api";
import { formatBytes, formatDate } from "@/lib/format";
import { DailyChart } from "./DailyChart";
import { Callout, DataTable, DocTitle, EmptyRow, LoadingRows, Mono, PageHeader, Panel, StatTile, Time, humanize, td, tdNum, th, thNum } from "./ui";

const n = (v: number) => v.toLocaleString();
const METRICS_JOB = "The daily metrics job (00:15 UTC) hasn't recorded a snapshot yet.";

export function DashboardView() {
  const d = useQuery(api.admin.dashboard, {});
  const loading = d === undefined;
  const t = d?.totals;
  const verifiedPct = t && t.users > 0 ? Math.round((t.verifiedUsers / t.users) * 100) : null;
  const syncErrors = Object.entries(d?.syncErrorsLast7d ?? {}).sort((a, b) => b[1] - a[1]);
  const rateLimited = Object.entries(d?.rateLimitedLast24h ?? {}).sort((a, b) => b[1] - a[1]);
  const metricsMissing = d !== undefined && d.activeUsers.daily === null;

  return (
    <>
      <DocTitle>Dashboard</DocTitle>
      <PageHeader title="Dashboard" description="Aggregate health of the platform. Counts only. No individual records or content are shown here." />

      {metricsMissing ? (
        <div className="mb-5">
          <Callout tone="neutral" title="Active-user metrics aren't available yet">
            {METRICS_JOB} Daily and weekly active users and retention cohorts appear after its first run. Signup and email counters update live.
          </Callout>
        </div>
      ) : null}

      <section aria-label="Totals">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6" aria-busy={loading || undefined}>
          <StatTile label="Users" value={t ? n(t.users) : "…"} />
          <StatTile label="Verified users" value={t ? n(t.verifiedUsers) : "…"} hint={verifiedPct !== null ? `${verifiedPct}% of users` : undefined} />
          <StatTile label="Workspaces" value={t ? n(t.workspaces) : "…"} />
          <StatTile label="Documents" value={t ? n(t.documents) : "…"} />
          <StatTile label="Storage used" value={t ? formatBytes(t.storageBytes) : "…"} />
          <StatTile
            label="Daily active users"
            value={d ? (d.activeUsers.daily ?? "Pending") : "…"}
            hint={metricsMissing ? "Waiting for the daily metrics job" : "Active in the last 24 hours"}
          />
          <StatTile
            label="Weekly active users"
            value={d ? (d.activeUsers.weekly ?? "Pending") : "…"}
            hint={metricsMissing ? "Waiting for the daily metrics job" : "Active in the last 7 days"}
          />
          <StatTile label="Emails accepted" value={t ? n(t.emailsAccepted) : "…"} hint="Accepted by the email provider (not “delivered”)" />
          <StatTile label="Emails failed" value={t ? n(t.emailsFailed) : "…"} hint="All time" />
          <StatTile label="Failed emails, 7 days" value={d ? n(d.failedEmailsLast7d) : "…"} hint={<Link className="underline underline-offset-2 hover:text-ink" href="/admin/emails?status=failed">Open the email log</Link>} />
          <StatTile label="Sync ops rejected" value={t ? n(t.syncRejected) : "…"} hint="All time" />
          <StatTile label="Sync conflicts" value={t ? n(t.syncConflicts) : "…"} hint="All time" />
        </dl>
      </section>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <DailyChart
          title="Signups"
          description="Per day, last 30 days (UTC)"
          points={d?.series.signups ?? []}
          kind="bar"
          missing="zero"
          unit="signups"
          emptyMessage={loading ? "Loading…" : "No signups recorded in the last 30 days."}
        />
        <DailyChart
          title="Daily active users"
          description="Daily snapshot, last 30 days (UTC)"
          points={d?.series.dau ?? []}
          kind="line"
          missing="gap"
          unit="active users"
          emptyMessage={loading ? "Loading…" : METRICS_JOB}
        />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Panel title="Retention cohorts" description="Accounts grouped by signup week (Monday, UTC) and how many were active in the last 7 days." flush>
          <DataTable caption="Retention by signup week" minWidth={420}>
            <thead>
              <tr>
                <th scope="col" className={th}>Signup week</th>
                <th scope="col" className={thNum}>Cohort size</th>
                <th scope="col" className={thNum}>Active this week</th>
                <th scope="col" className={thNum}>Retained</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LoadingRows colSpan={4} rows={3} />
              ) : d.cohorts.length === 0 ? (
                <EmptyRow colSpan={4}>{METRICS_JOB}</EmptyRow>
              ) : (
                [...d.cohorts].reverse().map((c) => {
                  const pct = c.total > 0 ? Math.round((c.active / c.total) * 100) : 0;
                  return (
                    <tr key={c.week}>
                      <th scope="row" className={`${td} text-left font-normal`}>
                        {formatDate(c.week, { month: "short", day: "numeric", year: "numeric" })}
                      </th>
                      <td className={tdNum}>{n(c.total)}</td>
                      <td className={tdNum}>{n(c.active)}</td>
                      <td className={tdNum}>
                        <span className="inline-flex items-center gap-2">
                          <span aria-hidden className="inline-block h-1.5 w-14 overflow-hidden rounded-full bg-sunken">
                            <span className="block h-full rounded-full bg-heading" style={{ width: `${pct}%` }} />
                          </span>
                          {pct}%
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </DataTable>
        </Panel>

        <Panel title="Recent deployments" description="Recorded by the deploy pipeline." flush>
          <DataTable caption="Recent deployments" minWidth={480}>
            <thead>
              <tr>
                <th scope="col" className={th}>Environment</th>
                <th scope="col" className={th}>Commit</th>
                <th scope="col" className={th}>Source</th>
                <th scope="col" className={th}>When</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LoadingRows colSpan={4} rows={3} />
              ) : d.deployments.length === 0 ? (
                <EmptyRow colSpan={4}>No deployments recorded yet.</EmptyRow>
              ) : (
                d.deployments.map((dep) => (
                  <tr key={`${dep.commitSha}-${dep.createdAt}`}>
                    <td className={td}>{dep.environment}</td>
                    <td className={td}>
                      <Mono>{dep.commitSha.slice(0, 7)}</Mono> <span className="text-muted">{dep.commitMessage}</span>
                    </td>
                    <td className={td}>{dep.source}</td>
                    <td className={td}>
                      <Time ts={dep.createdAt} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </Panel>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Sync errors by code" description="Rejected operations, last 7 days" flush>
          <CountTable caption="Rejected sync operations by error code, last 7 days" keyLabel="Error code" rows={syncErrors} loading={loading} empty="No rejected sync operations." />
        </Panel>
        <Panel title="Rate-limited events" description="By rule, last 24 hours" flush>
          <CountTable caption="Rate-limited events by rule, last 24 hours" keyLabel="Rule" rows={rateLimited} loading={loading} empty="Nothing was rate limited." />
        </Panel>
      </div>
    </>
  );
}

function CountTable({ caption, keyLabel, rows, loading, empty }: { caption: string; keyLabel: string; rows: [string, number][]; loading: boolean; empty: string }) {
  return (
    <DataTable caption={caption} minWidth={240}>
      <thead>
        <tr>
          <th scope="col" className={th}>{keyLabel}</th>
          <th scope="col" className={thNum}>Count</th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <LoadingRows colSpan={2} rows={2} />
        ) : rows.length === 0 ? (
          <EmptyRow colSpan={2}>{empty}</EmptyRow>
        ) : (
          rows.map(([k, v]) => (
            <tr key={k}>
              <th scope="row" className={`${td} text-left font-normal`}>
                <span title={k}>{humanize(k)}</span>
              </th>
              <td className={tdNum}>{n(v)}</td>
            </tr>
          ))
        )}
      </tbody>
    </DataTable>
  );
}
