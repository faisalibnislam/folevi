"use client";

import { useQuery } from "convex/react";
import { api } from "@/lib/convex/api";
import { formatDateTime } from "@/lib/format";
import { Badge, DataTable, DocTitle, EmptyRow, LoadingRows, ShortId, PageHeader, StatusBadge, Time, humanize, td, th } from "./ui";

export function DeletionJobsView() {
  const jobs = useQuery(api.admin.deletionJobs, {});
  const counts = (jobs ?? []).reduce<Record<string, number>>((acc, j) => ((acc[j.status] = (acc[j.status] ?? 0) + 1), acc), {});
  return (
    <>
      <DocTitle>Deletion jobs</DocTitle>
      <PageHeader
        title="Deletion jobs"
        description="Accounts, workspaces and documents queued for permanent deletion (100 most recent). Jobs run every 5 minutes once their grace period ends. This view updates live."
      />
      {jobs && jobs.length > 0 ? (
        <ul className="mb-3 flex flex-wrap gap-2" aria-label="Jobs by status">
          {Object.entries(counts).map(([s, c]) => (
            <li key={s}>
              <Badge>
                {humanize(s)}: {c}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="rounded-[12px] border border-line bg-raised">
        <DataTable caption="Deletion jobs, newest first" minWidth={1040}>
          <thead>
            <tr>
              <th scope="col" className={th}>Kind</th>
              <th scope="col" className={th}>Status</th>
              <th scope="col" className={th}>Progress</th>
              <th scope="col" className={th}>Scheduled for</th>
              <th scope="col" className={th}>Requested</th>
              <th scope="col" className={th}>Completed</th>
              <th scope="col" className={th}>Reason</th>
              <th scope="col" className={th}>Job ID</th>
            </tr>
          </thead>
          <tbody>
            {jobs === undefined ? (
              <LoadingRows colSpan={8} />
            ) : jobs.length === 0 ? (
              <EmptyRow colSpan={8}>No deletion jobs.</EmptyRow>
            ) : (
              jobs.map((j) => {
                const pct = Math.round(Math.max(0, Math.min(1, j.progress)) * 100);
                const future = j.scheduledFor > Date.now();
                return (
                  <tr key={j.id}>
                    <td className={td}>{humanize(j.kind)}</td>
                    <td className={td}>
                      <StatusBadge status={j.status} />
                      {j.error ? <div className="mt-1 max-w-[220px] text-xs text-danger">{j.error}</div> : null}
                    </td>
                    <td className={td}>
                      <div className="flex items-center gap-2">
                        <div
                          role="progressbar"
                          aria-label={`${humanize(j.kind)} deletion progress`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={pct}
                          className="h-1.5 w-24 overflow-hidden rounded-full bg-sunken"
                        >
                          <div className={`h-full rounded-full ${j.status === "failed" ? "bg-danger" : j.status === "completed" ? "bg-success" : "bg-plum"}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="tabular-nums text-muted">{pct}%</span>
                      </div>
                    </td>
                    <td className={td}>
                      <span className="whitespace-nowrap">{formatDateTime(j.scheduledFor)}</span>
                      {future && j.status === "scheduled" ? <div className="mt-0.5 text-xs text-muted">Grace period</div> : null}
                    </td>
                    <td className={td}>
                      <Time ts={j.createdAt} />
                      <div className="mt-0.5 text-xs text-muted">{j.requestedByAdmin ? "By an admin" : "By the owner"}</div>
                    </td>
                    <td className={td}>
                      <Time ts={j.completedAt} />
                    </td>
                    <td className={`${td} max-w-[260px]`}>{j.reason}</td>
                    <td className={td}>
                      <ShortId value={j.id} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </DataTable>
      </div>
    </>
  );
}
