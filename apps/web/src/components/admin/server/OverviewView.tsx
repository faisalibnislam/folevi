"use client";

import Link from "next/link";
import { useQueryState } from "@/lib/convex/queries";
import { serverAdminRefs } from "@/lib/server-edition/refs";
import { formatBytes } from "@/lib/format";
import { Badge, DataTable, DocTitle, ErrorNotice, Meter, PageHeader, Panel, StatTile, Time, td, tdNum, th, thNum } from "../ui";
import { controlMessage, durationText, useControl } from "./kit";
import { toMillis, type BackupList, type ControlStatus, type RemoteState } from "./types";

const SERVICE_NAMES: Record<string, string> = { folevid: "Supervisor", backend: "Database and sync", web: "Web app" };

/** Overview (plan §6): version, each part's health, memory and disk, people, the last backup, reachability. */
export function ServerOverviewView() {
  const overview = useQueryState(serverAdminRefs.overview, {});
  const status = useControl<ControlStatus>("status", 15_000);
  const backups = useControl<BackupList>("backups");
  const remote = useControl<RemoteState>("remote");
  const o = overview.data;
  const s = status.data;
  const last = backups.data?.backups.slice().sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))[0];
  // The ten most recently active people (serverAdmin:overview): how many of them were here this week.
  const weekAgo = Date.now() - 7 * 86_400_000;
  const signIns = o ? o.lastSignIns.filter((x) => x.at >= weekAgo).length : undefined;

  return (
    <>
      <DocTitle>Overview</DocTitle>
      <PageHeader title="Overview" description="How this server is doing. Counts and sizes only: nobody's notes are shown here." />
      {overview.error && !o ? <ErrorNotice error={overview.error} /> : null}
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="People" value={o ? o.people : "…"} hint={<Link className="underline underline-offset-2 hover:text-heading" href="/admin/people">Manage people</Link>} />
        <StatTile label="Notes" value={o ? o.notes.toLocaleString() : "…"} />
        <StatTile label="Storage used" value={o ? formatBytes(o.storageBytes) : "…"} />
        <StatTile label="Active this week" value={signIns === undefined ? "…" : signIns >= 10 ? "10+" : signIns} />
      </dl>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Panel title="Health" description={s ? `Folevi Server ${s.version}, running for ${durationText(s.uptimeSeconds)}.` : undefined} flush>
          {status.error && !s ? (
            <div className="p-5">
              <ErrorNotice error={new Error(controlMessage(status.error))} onRetry={status.reload} />
            </div>
          ) : (
            <DataTable caption="Services" minWidth={420}>
              <thead>
                <tr>
                  <th className={th}>Part</th>
                  <th className={th}>State</th>
                  <th className={thNum}>Memory</th>
                  <th className={thNum}>Restarts</th>
                </tr>
              </thead>
              <tbody>
                {(s?.services ?? []).map((svc) => (
                  <tr key={svc.name}>
                    <td className={td}>{SERVICE_NAMES[svc.name] ?? svc.name}</td>
                    <td className={td}>
                      <Badge tone={svc.state === "running" ? "success" : svc.state === "starting" ? "warning" : "danger"}>{svc.state.charAt(0).toUpperCase() + svc.state.slice(1)}</Badge>
                    </td>
                    <td className={tdNum}>{svc.rssBytes ? formatBytes(svc.rssBytes) : "-"}</td>
                    <td className={tdNum}>{svc.restarts ?? 0}</td>
                  </tr>
                ))}
                {!s ? (
                  <tr>
                    <td className={td} colSpan={4}>
                      Loading…
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </DataTable>
          )}
        </Panel>

        <Panel title="Machine">
          {s ? (
            <div className="space-y-4 text-subheadline">
              <div>
                <p className="mb-1.5 flex justify-between">
                  <span>Memory</span>
                  <span className="text-muted tabular-nums">
                    {formatBytes(s.memory.totalBytes - s.memory.availableBytes)} of {formatBytes(s.memory.totalBytes)}
                  </span>
                </p>
                <Meter label="Memory in use" value={s.memory.totalBytes - s.memory.availableBytes} max={s.memory.totalBytes} />
              </div>
              <div>
                <p className="mb-1.5 flex justify-between">
                  <span>Disk</span>
                  <span className="text-muted tabular-nums">
                    Folevi uses {formatBytes(s.disk.dataBytes)}, {formatBytes(s.disk.freeBytes)} free
                  </span>
                </p>
                <Meter label="Disk used by Folevi" value={s.disk.dataBytes} max={s.disk.dataBytes + s.disk.freeBytes} />
              </div>
            </div>
          ) : (
            <p className="text-subheadline text-muted">{status.error ? controlMessage(status.error) : "Loading…"}</p>
          )}
        </Panel>

        <Panel title="Last backup" actions={<Link className="ui-btn ui-btn-secondary h-8 px-3.5 text-subheadline" href="/admin/backups">Backups</Link>}>
          <p className="text-subheadline">
            {last ? (
              <>
                <Time ts={toMillis(last.createdAt)} /> ({formatBytes(last.sizeBytes)})
              </>
            ) : backups.data ? (
              "No backups yet."
            ) : backups.error ? (
              controlMessage(backups.error)
            ) : (
              "Loading…"
            )}
          </p>
        </Panel>

        <Panel title="Reachable from" actions={<Link className="ui-btn ui-btn-secondary h-8 px-3.5 text-subheadline" href="/admin/remote">Remote access</Link>}>
          {remote.data ? (
            <div className="space-y-2 text-subheadline">
              <p className="break-all font-medium text-heading">{remote.data.publicUrl}</p>
              <p className="text-muted">
                {remote.data.reachable === true
                  ? "Reachable from the internet."
                  : remote.data.reachable === false
                    ? "Not reachable from the internet yet."
                    : "Not checked from the internet yet."}
                {remote.data.connect.state === "linked" ? " Linked to a Folevi account." : ""}
              </p>
            </div>
          ) : (
            <p className="text-subheadline text-muted">{remote.error ? controlMessage(remote.error) : "Loading…"}</p>
          )}
        </Panel>
      </div>
    </>
  );
}
