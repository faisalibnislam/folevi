"use client";

import Link from "next/link";
import { ServerMadeBy } from "@/components/server/MadeBy";
import { useState } from "react";
import { useMutation } from "convex/react";
import { ArrowRight, Check, Circle, Info, QrCode as QrIcon, X } from "lucide-react";
import { useQueryState } from "@/lib/convex/queries";
import { serverAdminRefs, type ServerInvite, type ServerSettings, type SetupStep } from "@/lib/server-edition/refs";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { errorMessage, useToast } from "@/components/ui/Toast";
import { ConnectApps } from "@/components/server/ConnectApps";
import { useAdmin } from "../AdminApp";
import { Badge, Callout, DataTable, DocTitle, ErrorNotice, Meter, PageHeader, Panel, StatTile, Time, td, tdNum, th, thNum } from "../ui";
import { checklistFinished, checklistItems, type ChecklistItem } from "./checklist";
import { healthNotes } from "./health";
import { TextInput, controlMessage, durationText, useControl, useServerSettings } from "./kit";
import { toMillis, type BackupList, type ControlStatus, type RemoteState, type UpdateState } from "./types";

const SERVICE_NAMES: Record<string, string> = { folevid: "Supervisor", backend: "Database and sync", web: "Web app" };

function ChecklistRow({ item, onSkip, onOpen, busy, canSkip }: { item: ChecklistItem; onSkip: () => void; onOpen: () => void; busy: boolean; canSkip: boolean }) {
  const done = item.state !== "todo";
  return (
    <li className="flex flex-col gap-2 border-t border-line px-5 py-3 first:border-t-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span aria-hidden className={`mt-0.5 grid size-5 flex-none place-items-center rounded-control ${done ? "bg-heading text-canvas" : "text-faint"}`}>
          {done ? <Check size={12} strokeWidth={3} /> : <Circle size={20} strokeWidth={1.5} />}
        </span>
        <div className="min-w-0">
          <p className={`text-body font-medium ${done ? "text-muted" : "text-heading"}`}>
            {item.title}
            <span className="sr-only">{item.state === "done" ? ", done" : item.state === "skipped" ? ", skipped" : ", to do"}</span>
            {item.state === "skipped" ? <Badge className="ml-2 align-middle">Skipped</Badge> : null}
          </p>
          <p className="text-subheadline text-muted">{item.detail}</p>
        </div>
      </div>
      {item.state !== "done" && item.href ? (
        <div className="flex flex-none items-center gap-1.5 pl-8 sm:pl-0">
          {item.state === "todo" && item.skipAs && canSkip ? (
            <Button variant="quiet" disabled={busy} onClick={onSkip}>
              Skip
            </Button>
          ) : null}
          {item.href.startsWith("#") ? (
            <Button variant={item.state === "todo" ? "secondary" : "quiet"} onClick={onOpen}>
              {item.action} <ArrowRight size={14} aria-hidden />
            </Button>
          ) : (
            <Link href={item.href} className={`ui-btn ${item.state === "todo" ? "ui-btn-secondary" : "ui-btn-quiet"} h-control px-3 text-callout`}>
              {item.action} <ArrowRight size={14} aria-hidden />
            </Link>
          )}
        </div>
      ) : null}
    </li>
  );
}

function Checklist({ settings, backups, remote, onConnectApps }: { settings: ServerSettings; backups?: BackupList; remote?: RemoteState; onConnectApps: () => void }) {
  const admin = useAdmin();
  const owner = admin.role === "super_admin";
  const overview = useQueryState(serverAdminRefs.overview, {});
  const invites = useQueryState(serverAdminRefs.listInvites, {});
  const update = useMutation(serverAdminRefs.updateSettings);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!overview.data || !invites.data) return null;
  const items = checklistItems({ settings, people: overview.data.people, invites: (invites.data as ServerInvite[]).filter((i) => i.state !== "revoked").length, backups, remote });
  if (checklistFinished(items, settings)) return null;
  const left = items.filter((i) => i.state === "todo").length;
  const mark = (steps: SetupStep[], done: string) => {
    setBusy(true);
    update({ patch: { setup: { done: steps } } })
      .then(() => toast.show(done, { tone: "success" }))
      .catch((e: unknown) => toast.show(errorMessage(e), { tone: "error" }))
      .finally(() => setBusy(false));
  };
  return (
    <Panel
      title="Finish setting up"
      description={`${items.length - left} of ${items.length} done. Each step has a sensible default, so skipping is fine.`}
      actions={
        owner ? (
          <Button variant="quiet" disabled={busy} onClick={() => mark(["checklist"], "Checklist hidden. Everything is still in the menu on the left.")}>
            <X size={14} aria-hidden /> Hide
          </Button>
        ) : null
      }
      flush
    >
      <div className="h-1 bg-[color-mix(in_oklab,var(--color-ink)_8%,transparent)]" aria-hidden>
        <div className="h-full bg-heading transition-[width]" style={{ width: `${((items.length - left) / items.length) * 100}%` }} />
      </div>
      <ul>
        {items.map((item) => (
          <ChecklistRow
            key={item.id}
            item={item}
            busy={busy}
            canSkip={owner}
            onSkip={() => item.skipAs && mark(item.skipAs, `Skipped. You can come back to it any time.`)}
            onOpen={() => {
              if (item.id === "apps") onConnectApps();
              else document.getElementById(item.href!.slice(1))?.scrollIntoView({ behavior: "smooth", block: "center" });
              if (item.id === "name") window.setTimeout(() => document.getElementById("server-name-input")?.focus(), 350);
            }}
          />
        ))}
      </ul>
    </Panel>
  );
}

function NamePanel({ settings, address }: { settings: ServerSettings; address?: string }) {
  const { save } = useServerSettings();
  const admin = useAdmin();
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = name ?? settings.name;
  const dirty = name !== null && name.trim() !== settings.name;
  return (
    <section id="server-name" className="scroll-mt-24">
      <Panel title="This server" description="Its name shows when people sign in and in invites.">
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!dirty) return;
            if (!value.trim()) return;
            setBusy(true);
            void save({ name: value.trim(), setup: { done: ["name"] } }, "Name saved.")
              .then((ok) => ok && setName(null))
              .finally(() => setBusy(false));
          }}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <label htmlFor="server-name-input" className="block text-subheadline font-medium text-ink">
              Name
            </label>
            <TextInput id="server-name-input" value={value} onChange={setName} placeholder="Smith family" />
          </div>
          <Button type="submit" variant={dirty ? "primary" : "secondary"} disabled={!dirty || busy || admin.role !== "super_admin"}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </form>
        {address ? (
          <p className="mt-3 text-subheadline text-muted">
            Address: <span className="break-all font-medium text-heading">{address}</span>
          </p>
        ) : null}
      </Panel>
    </section>
  );
}

/** Overview (plan §6): first-run checklist, warnings in plain words, health, people, the last backup, reachability. */
export function ServerOverviewView() {
  const overview = useQueryState(serverAdminRefs.overview, {});
  const { settings } = useServerSettings();
  const status = useControl<ControlStatus>("status", 15_000);
  const backups = useControl<BackupList>("backups", 60_000);
  const remote = useControl<RemoteState>("remote", 60_000);
  const update = useControl<UpdateState>("update");
  const [apps, setApps] = useState(false);
  const o = overview.data;
  const s = status.data;
  const last = backups.data?.backups.slice().sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))[0];
  // The ten most recently active people (serverAdmin:overview): how many of them were here this week.
  const weekAgo = Date.now() - 7 * 86_400_000;
  const signIns = o ? o.lastSignIns.filter((x) => x.at >= weekAgo).length : undefined;
  const notes = healthNotes({ status: s, backups: backups.data, remote: remote.data, update: update.data });
  const supervisorDown = status.error && !s;

  return (
    <>
      <DocTitle>Overview</DocTitle>
      <PageHeader
        title={settings ? settings.name : "Overview"}
        description="How this server is doing. Counts and sizes only: nobody's notes are shown here."
        actions={
          <Button onClick={() => setApps(true)}>
            <QrIcon size={15} aria-hidden /> Connect your apps
          </Button>
        }
      />
      {overview.error && !o ? <ErrorNotice error={overview.error} /> : null}
      <div className="space-y-4">
        {settings ? <Checklist settings={settings} backups={backups.data} remote={remote.data} onConnectApps={() => setApps(true)} /> : null}

        {supervisorDown ? (
          <Callout tone="danger" title="The server's supervisor isn't answering">
            Health, backups and remote access can't be shown right now. Folevi may be restarting: wait a minute and reload this page. If it stays like this, restart Folevi from your NAS&apos;s app center.
          </Callout>
        ) : null}
        {notes.length ? (
          <ul className="space-y-2" aria-label="Things to look at">
            {notes.map((n) => (
              <li key={n.id}>
                <Callout tone={n.tone} title={n.title} icon={n.tone === "neutral" ? <Info size={16} aria-hidden className="mt-0.5 flex-none text-muted" /> : undefined}>
                  <span>{n.body}</span>
                  {n.href ? (
                    <Link href={n.href} className="ml-1 font-medium text-heading underline underline-offset-2 hover:decoration-2">
                      {n.action}
                    </Link>
                  ) : null}
                </Callout>
              </li>
            ))}
          </ul>
        ) : s ? (
          <p className="flex items-center gap-2 text-subheadline text-muted">
            <Check size={15} aria-hidden className="text-success" /> Everything looks good.
          </p>
        ) : null}

        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="People" value={o ? o.people : "…"} hint={<Link className="underline underline-offset-2 hover:text-heading" href="/admin/people">Manage people</Link>} />
          <StatTile label="Notes" value={o ? o.notes.toLocaleString() : "…"} />
          <StatTile label="Storage used" value={o ? formatBytes(o.storageBytes) : "…"} />
          <StatTile label="Active this week" value={signIns === undefined ? "…" : signIns >= 10 ? "10+" : signIns} />
        </dl>

        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Health" description={s ? `Folevi Server ${s.version}, running for ${durationText(s.uptimeSeconds)}.` : undefined} flush>
            {status.error && !s ? (
              <div className="p-5">
                <ErrorNotice error={new Error(controlMessage(status.error))} onRetry={status.reload} />
              </div>
            ) : (
              <DataTable caption="Services" minWidth={360}>
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
                  <p className="mb-1.5 flex justify-between gap-3">
                    <span>Memory</span>
                    <span className="text-right text-muted tabular-nums">
                      {formatBytes(s.memory.totalBytes - s.memory.availableBytes)} of {formatBytes(s.memory.totalBytes)} in use
                    </span>
                  </p>
                  <Meter label="Memory in use" value={s.memory.totalBytes - s.memory.availableBytes} max={s.memory.totalBytes} />
                </div>
                <div>
                  <p className="mb-1.5 flex justify-between gap-3">
                    <span>Disk</span>
                    <span className="text-right text-muted tabular-nums">
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

          <Panel title="Last backup" actions={<Link className="ui-btn ui-btn-secondary h-control px-3 text-callout" href="/admin/backups">Backups</Link>}>
            <p className="text-subheadline">
              {last ? (
                <>
                  <Time ts={toMillis(last.createdAt)} /> ({formatBytes(last.sizeBytes)}){backups.data?.schedule.enabled ? `. Next one tonight at ${String(backups.data.schedule.hour).padStart(2, "0")}:00.` : "."}
                </>
              ) : backups.data ? (
                "No backups yet. The first one runs tonight."
              ) : backups.error ? (
                controlMessage(backups.error)
              ) : (
                "Loading…"
              )}
            </p>
          </Panel>

          <Panel title="Reachable from" actions={<Link className="ui-btn ui-btn-secondary h-control px-3 text-callout" href="/admin/remote">Remote access</Link>}>
            {remote.data ? (
              <div className="space-y-2 text-subheadline">
                <p className="break-all font-medium text-heading">{remote.data.publicUrl}</p>
                <p className="text-muted">
                  {remote.data.reachable === true
                    ? "Reachable from the internet."
                    : remote.data.reachable === false
                      ? "Only on your home network for now."
                      : remote.data.connect.state === "off"
                        ? "Your home network. Set up remote access to use the apps anywhere."
                        : "Not checked from the internet yet."}
                  {remote.data.connect.state === "linked" ? " Linked to a Folevi account." : ""}
                </p>
              </div>
            ) : (
              <p className="text-subheadline text-muted">{remote.error ? controlMessage(remote.error) : "Loading…"}</p>
            )}
          </Panel>
        </div>

        {settings ? <NamePanel settings={settings} address={remote.data?.publicUrl} /> : null}
        <ServerMadeBy />
      </div>
      <ConnectAppsDialog open={apps} onClose={() => setApps(false)} address={remote.data?.publicUrl} serverName={settings?.name} />
    </>
  );
}

/** "Connect your apps" in a dialog, from Overview and People; the owner can tick it off the checklist here. */
export function ConnectAppsDialog({ open, onClose, address, serverName }: { open: boolean; onClose: () => void; address?: string; serverName?: string }) {
  const update = useMutation(serverAdminRefs.updateSettings);
  const admin = useAdmin();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Connect your apps"
      description={`Add ${serverName ?? "this server"} in Folevi on a Mac, iPhone, iPad or Android. Send these steps to the people you invite, too.`}
      size="md"
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
          {admin.role === "super_admin" ? (
            <Button variant="primary" onClick={() => void update({ patch: { setup: { done: ["apps"] } } }).finally(onClose)}>
              <Check size={15} aria-hidden /> My apps are connected
            </Button>
          ) : null}
        </>
      }
    >
      <ConnectApps address={address} serverName={serverName} remoteHref="/admin/remote" />
    </Dialog>
  );
}
