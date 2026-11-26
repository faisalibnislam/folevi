"use client";

// The admin panel's sections backed by folevid (docs/self-hosting/CONTRACT.md §5) through /api/server/*:
// remote access, backups, updates, logs and diagnostics.
import { useState } from "react";
import { Check, Copy, Download, ExternalLink, Eye, EyeOff, KeyRound, Lock, RotateCw, Send } from "lucide-react";
import { downloadKey } from "@/components/server/SetupFlow";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { useAdmin } from "../AdminApp";
import { Badge, Callout, DataTable, DocTitle, EmptyRow, ErrorNotice, KeyValues, LoadingRows, PageHeader, Panel, Time, td, tdMid, tdNum, th, thNum, selectCls } from "../ui";
import { SaveBar, SettingRow, SwitchRow, TextInput, control, controlMessage, useControl, useDraft, useServerSettings } from "./kit";
import { toMillis, type BackupList, type BackupTarget, type RemoteState, type UpdateState } from "./types";

function ControlError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return <ErrorNotice error={new Error(controlMessage(error))} onRetry={onRetry} />;
}

const OWNER_ONLY = "Only the server's owner can change this.";

// ---------------------------------------------------------------- remote access

function Guide({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group border-t border-line py-3 first:border-t-0 first:pt-0">
      <summary className="cursor-pointer rounded-chip px-1 text-body font-medium text-heading hover:bg-[var(--glass-hover)]">{title}</summary>
      <div className="mt-2 space-y-2 px-1 text-subheadline text-ink">{children}</div>
    </details>
  );
}

export function ServerRemoteView() {
  const admin = useAdmin();
  const owner = admin.role === "super_admin";
  const remote = useControl<RemoteState>("remote");
  const toast = useToast();
  const [link, setLink] = useState<{ code: string; approveUrl: string; expiresAt: number | string } | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const r = remote.data;

  const put = (patch: Record<string, unknown>, done: string) =>
    control("PUT", "remote", patch).then(
      () => {
        toast.show(done, { tone: "success" });
        remote.reload();
      },
      (e: unknown) => toast.show(controlMessage(e), { tone: "error" }),
    );

  return (
    <>
      <DocTitle>Remote access</DocTitle>
      <PageHeader title="Remote access" description="How the apps reach this server, at home and away." />
      {remote.error && !r ? <ControlError error={remote.error} onRetry={remote.reload} /> : null}
      {!r && !remote.error ? <p className="text-subheadline text-muted">Loading…</p> : null}
      {r ? (
        <div className="space-y-4">
          <Panel title="Addresses" actions={<Button onClick={remote.reload}><RotateCw size={13} aria-hidden /> Check again</Button>}>
            <KeyValues
              items={[
                { label: "Public address", value: <span className="break-all font-medium text-heading">{r.publicUrl}</span> },
                {
                  label: "From the internet",
                  value:
                    r.reachable === true ? <Badge tone="success">Reachable</Badge> : r.reachable === false ? <Badge tone="warning">Not reachable yet</Badge> : <Badge>Not checked</Badge>,
                },
                ...(r.connect.hostname ? [{ label: "Folevi address", value: <span className="break-all">https://{r.connect.hostname}</span> }] : []),
                ...(r.connect.lanHostnames?.length ? [{ label: "At home", value: <span className="break-all">{r.connect.lanHostnames.map((h) => `https://${h}`).join(", ")}</span> }] : []),
                { label: "Router", value: r.upnp.externalPort ? `Port ${r.upnp.externalPort} opened automatically` : r.upnp.state === "off" ? "Not asked to open a port" : `Automatic port opening: ${r.upnp.state}` },
              ]}
            />
          </Panel>

          <Panel title="Folevi Connect" description="Link this server to your Folevi account. It then shows up in every app signed in to that account, with a secure folevi.app address that works at home and away, and no router setup.">
            {r.connect.state === "linked" ? (
              <p className="text-subheadline">
                <Badge tone="success">Linked</Badge> This server is linked to a Folevi account.
              </p>
            ) : (
              <>
                <p className="mb-3 text-subheadline text-muted">{r.connect.state === "registered" ? "Registered with Folevi Connect, not linked to an account yet." : "Not linked."}</p>
                {link ? (
                  <div className="space-y-2 rounded-control bg-[var(--glass-hover)] p-4 text-subheadline">
                    <p>
                      Open this page signed in to your Folevi account and approve the code <strong className="font-mono text-heading">{link.code}</strong>. It works until <Time ts={toMillis(link.expiresAt)} />.
                    </p>
                    <a href={link.approveUrl} target="_blank" rel="noopener noreferrer" className="ui-btn ui-btn-primary h-control px-4 text-callout">
                      Approve on folevi.com <ExternalLink size={14} aria-hidden />
                    </a>
                    <p className="text-muted">Come back here afterwards and choose Check again.</p>
                  </div>
                ) : (
                  <Button
                    variant="primary"
                    disabled={!owner || busy}
                    title={owner ? undefined : OWNER_ONLY}
                    onClick={() => {
                      setBusy(true);
                      control<{ code: string; approveUrl: string; expiresAt: number | string }>("POST", "connect/link")
                        .then(setLink, (e: unknown) => toast.show(controlMessage(e), { tone: "error" }))
                        .finally(() => setBusy(false));
                    }}
                  >
                    Link to a Folevi account
                  </Button>
                )}
              </>
            )}
            <div className="mt-4">
              <SwitchRow
                label="Folevi Relay"
                description="When your router can't be opened, the apps reach this server through Folevi's relay. The relay passes encrypted traffic along and can't read it."
                checked={r.relay.enabled}
                disabled={!owner}
                onChange={(next) => put({ relayEnabled: next }, next ? "Relay on." : "Relay off.")}
              />
              <SwitchRow
                label="Open a port on the router automatically"
                description="Asks the router (UPnP or NAT-PMP) so the apps can connect directly from outside."
                checked={r.upnp.state !== "off"}
                disabled={!owner}
                onChange={(next) => put({ upnpEnabled: next }, "Saved.")}
              />
            </div>
          </Panel>

          <Panel title="Your own domain" description="Point a domain you own at this server. Folevi gets a certificate for it.">
            <div className="flex flex-col gap-2 sm:flex-row">
              <TextInput value={domain ?? r.customDomain ?? ""} onChange={setDomain} placeholder="notes.example.com" aria-label="Your own domain" />
              <Button disabled={!owner || domain === null} title={owner ? undefined : OWNER_ONLY} onClick={() => void put({ customDomain: (domain ?? "").trim() }, "Saved.").then(() => setDomain(null))}>
                Save
              </Button>
            </div>
          </Panel>

          <Panel title="Other ways in">
            <Guide title="Your NAS's reverse proxy">
              <p>Forward your domain to this server&apos;s port (8460 unless you changed it). Turn on WebSocket support for the forwarding rule; Folevi needs it to sync.</p>
              <p>Then enter the domain under Your own domain above.</p>
            </Guide>
            <Guide title="Tailscale">
              <p>Install Tailscale on this machine and on each device. In the Tailscale admin console, turn on HTTPS certificates and run tailscale serve for port 8460.</p>
              <p>Enter the machine&apos;s Tailscale name (it ends in ts.net) under Your own domain above.</p>
            </Guide>
            <Guide title="Cloudflare Tunnel">
              <p>Create a tunnel in Cloudflare Zero Trust, install its connector on this machine, and add a public hostname that points to http://127.0.0.1:8460 (this machine, port 8460).</p>
              <p>Enter that hostname under Your own domain above.</p>
            </Guide>
          </Panel>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- backups

type ScheduleDraft = { enabled: boolean; hour: string; keep: string; kind: BackupTarget["kind"]; path: string; endpoint: string; bucket: string; prefix: string; region: string; accessKeyId: string; secretAccessKey: string };

function ScheduleForm({ list, onSaved }: { list: BackupList; onSaved: () => void }) {
  const admin = useAdmin();
  const owner = admin.role === "super_admin";
  const toast = useToast();
  const s = list.schedule;
  const { draft, set, dirty, reset } = useDraft<ScheduleDraft>({
    enabled: s.enabled,
    hour: String(s.hour),
    keep: String(s.keep),
    kind: s.target.kind,
    path: s.target.path ?? "",
    endpoint: s.target.s3?.endpoint ?? "",
    bucket: s.target.s3?.bucket ?? "",
    prefix: s.target.s3?.prefix ?? "",
    region: s.target.s3?.region ?? "",
    accessKeyId: s.target.s3?.accessKeyId ?? "",
    secretAccessKey: "",
  });
  const [busy, setBusy] = useState(false);
  return (
    <Panel title="Schedule" description="Folevi also takes a backup before every update.">
      <SwitchRow label="Back up every night" checked={draft.enabled} disabled={!owner} onChange={(v) => set("enabled", v)} />
      <SettingRow label="At">
        <Select aria-label="Backup time" value={draft.hour} disabled={!owner} onChange={(e) => set("hour", e.target.value)} className={`${selectCls} w-40`}>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={String(h)}>
              {`${String(h).padStart(2, "0")}:00`}
            </option>
          ))}
        </Select>
      </SettingRow>
      <SettingRow label="Keep" description="Older backups are deleted." htmlFor="backup-keep">
        <TextInput id="backup-keep" inputMode="numeric" value={draft.keep} onChange={(v) => set("keep", v.replace(/\D/g, ""))} className="w-24" />
      </SettingRow>
      <SettingRow label="Where">
        <Select aria-label="Where backups go" value={draft.kind} disabled={!owner} onChange={(e) => set("kind", e.target.value as BackupTarget["kind"])} className={`${selectCls} w-64`}>
          <option value="local" data-description="Inside Folevi's data folder">
            The data folder
          </option>
          <option value="folder" data-description="Another shared folder on this machine">
            Another folder
          </option>
          <option value="s3" data-description="Backblaze B2, Wasabi, your NAS's own S3 and others">
            S3-compatible storage
          </option>
        </Select>
      </SettingRow>
      {draft.kind === "folder" ? (
        <div className="mt-2">
          <TextInput value={draft.path} onChange={(v) => set("path", v)} placeholder="/volume1/backups/folevi" aria-label="Folder" />
        </div>
      ) : null}
      {draft.kind === "s3" ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <TextInput value={draft.endpoint} onChange={(v) => set("endpoint", v)} placeholder="Endpoint, https://s3.example.com" aria-label="Endpoint" />
          <TextInput value={draft.region} onChange={(v) => set("region", v)} placeholder="Region" aria-label="Region" />
          <TextInput value={draft.bucket} onChange={(v) => set("bucket", v)} placeholder="Bucket" aria-label="Bucket" />
          <TextInput value={draft.prefix} onChange={(v) => set("prefix", v)} placeholder="Folder in the bucket (optional)" aria-label="Prefix" />
          <TextInput value={draft.accessKeyId} onChange={(v) => set("accessKeyId", v)} placeholder="Access key ID" aria-label="Access key ID" />
          <TextInput type="password" value={draft.secretAccessKey} onChange={(v) => set("secretAccessKey", v)} placeholder={s.target.s3 ? "Secret key saved. Type to replace it" : "Secret access key"} aria-label="Secret access key" autoComplete="new-password" />
        </div>
      ) : null}
      {owner ? (
        <SaveBar
          dirty={dirty}
          busy={busy}
          onReset={reset}
          onSave={() => {
            setBusy(true);
            const target: BackupTarget =
              draft.kind === "s3"
                ? { kind: "s3", s3: { endpoint: draft.endpoint.trim(), bucket: draft.bucket.trim(), prefix: draft.prefix.trim(), region: draft.region.trim(), accessKeyId: draft.accessKeyId.trim(), ...(draft.secretAccessKey ? { secretAccessKey: draft.secretAccessKey } : {}) } }
                : draft.kind === "folder"
                  ? { kind: "folder", path: draft.path.trim() }
                  : { kind: "local" };
            control("PUT", "backups/schedule", { enabled: draft.enabled, hour: Number(draft.hour), keep: Math.max(1, Number(draft.keep) || 14), target })
              .then(() => {
                toast.show("Backup schedule saved.", { tone: "success" });
                onSaved();
              }, (e: unknown) => toast.show(controlMessage(e), { tone: "error" }))
              .finally(() => setBusy(false));
          }}
        />
      ) : (
        <p className="mt-3 text-subheadline text-muted">{OWNER_ONLY}</p>
      )}
    </Panel>
  );
}

const KIND_NAMES = { nightly: "Nightly", manual: "By hand", "pre-update": "Before an update" } as const;

/** The backup key (secrets/backup-key): shown to the owner to keep somewhere other than this machine. */
function BackupKeyPanel() {
  const admin = useAdmin();
  const owner = admin.role === "super_admin";
  const { settings, save } = useServerSettings();
  const toast = useToast();
  const [key, setKey] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [loading, setLoading] = useState(false);
  const saved = settings?.setup?.backupKey !== undefined;
  const load = async (): Promise<string | null> => {
    if (key) return key;
    setLoading(true);
    try {
      const r = await control<{ key: string }>("GET", "backups/key");
      setKey(r.key);
      return r.key;
    } catch (e) {
      toast.show(controlMessage(e), { tone: "error" });
      return null;
    } finally {
      setLoading(false);
    }
  };
  return (
    <section id="backup-key" className="scroll-mt-24">
      <Panel
        title="Backup key"
        description="Backups are locked with this key. To restore them on a new machine (if this one breaks or is stolen), you need it. Keep it in a password manager or on paper, not only on this NAS."
        actions={saved ? <Badge tone="success">Saved</Badge> : <Badge tone="warning">Not saved yet</Badge>}
      >
        {owner ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-chip bg-sunken p-2.5">
              <KeyRound size={15} aria-hidden className="flex-none text-muted" />
              <code className="min-w-0 flex-1 truncate font-mono text-footnote text-heading" aria-label="Backup key">
                {shown && key ? key : "AGE-SECRET-KEY-1" + "•".repeat(24)}
              </code>
              <Button variant="quiet" disabled={loading} onClick={() => (shown ? setShown(false) : void load().then((k) => k && setShown(true)))}>
                {shown ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />} {shown ? "Hide" : "Show"}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={loading} onClick={() => void load().then((k) => {
                    if (k) void navigator.clipboard.writeText(k).then(() => toast.show("Backup key copied. Paste it somewhere safe.", { tone: "success" }), () => setShown(true));
                  })}>
                <Copy size={14} aria-hidden /> Copy
              </Button>
              <Button disabled={loading} onClick={() => void load().then((k) => k && downloadKey(k))}>
                <Download size={14} aria-hidden /> Download as a file
              </Button>
              {!saved ? (
                <Button variant="primary" onClick={() => void save({ setup: { done: ["backups", "backupKey"] } }, "Marked as saved.")}>
                  <Check size={14} aria-hidden /> I saved it somewhere safe
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-subheadline text-muted">{OWNER_ONLY}</p>
        )}
      </Panel>
    </section>
  );
}

export function ServerBackupsView() {
  const admin = useAdmin();
  const owner = admin.role === "super_admin";
  const backups = useControl<BackupList>("backups");
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<string | null>(null);
  const rows = (backups.data?.backups ?? []).slice().sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  return (
    <>
      <DocTitle>Backups</DocTitle>
      <PageHeader
        title="Backups"
        description="Each backup holds every note, file and setting on this server."
        actions={
          <Button
            variant="primary"
            disabled={!owner || busy}
            title={owner ? undefined : OWNER_ONLY}
            onClick={() => {
              setBusy(true);
              toast.show("Backing up. This takes a minute or two.");
              control("POST", "backups?wait=1")
                .then(() => {
                  toast.show("Backup done.", { tone: "success" });
                  backups.reload();
                }, (e: unknown) => toast.show(`The backup didn't finish: ${controlMessage(e)} Look at Logs for details.`, { tone: "error", duration: 10_000 }))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Backing up…" : "Back up now"}
          </Button>
        }
      />
      {backups.error && !backups.data ? <ControlError error={backups.error} onRetry={backups.reload} /> : null}
      <div className="space-y-4">
        {backups.data ? <ScheduleForm list={backups.data} onSaved={backups.reload} /> : null}
        <BackupKeyPanel />
        <Panel title="Backups on hand" flush>
          <DataTable caption="Backups" minWidth={520}>
            <thead>
              <tr>
                <th className={th}>Taken</th>
                <th className={th}>Kind</th>
                <th className={thNum}>Size</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!backups.data && !backups.error ? <LoadingRows colSpan={4} rows={3} /> : null}
              {backups.data && rows.length === 0 ? <EmptyRow colSpan={4}>No backups yet.</EmptyRow> : null}
              {rows.map((b) => (
                <tr key={b.id}>
                  <td className={tdMid}>
                    <Time ts={toMillis(b.createdAt)} />
                  </td>
                  <td className={tdMid}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {KIND_NAMES[b.kind] ?? b.kind}
                      {b.encrypted ? (
                        <Badge title="Locked with the backup key">
                          <Lock size={11} aria-hidden /> Locked
                        </Badge>
                      ) : null}
                    </span>
                  </td>
                  <td className={tdNum}>{formatBytes(b.sizeBytes)}</td>
                  <td className={`${td} text-right`}>
                    {owner ? (
                      <Button onClick={() => setRestore(b.id)}>
                        Restore
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      </div>
      <Dialog
        open={restore !== null}
        onClose={() => setRestore(null)}
        title="Restore this backup?"
        description="Everything on the server goes back to how it was when the backup was taken. Changes made since are lost, for everyone. Folevi restarts, so people are signed out for a minute."
        size="sm"
        footer={
          <>
            <Button variant="quiet" onClick={() => setRestore(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                const id = restore;
                setRestore(null);
                if (!id) return;
                setBusy(true);
                control("POST", `backups/${encodeURIComponent(id)}/restore`)
                  .then(() => toast.show("Restoring. Folevi restarts in a moment.", { tone: "success", duration: 10_000 }), (e: unknown) => toast.show(controlMessage(e), { tone: "error" }))
                  .finally(() => setBusy(false));
              }}
            >
              Restore
            </Button>
          </>
        }
      />
    </>
  );
}

// ---------------------------------------------------------------- updates

const MANAGED_BY = {
  store: "Updates come from your NAS's app store. Use its Update button.",
  apt: "Updates come with this machine's normal system updates.",
  folevid: "Folevi updates itself.",
} as const;

export function ServerUpdatesView() {
  const update = useControl<UpdateState>("update");
  const u = update.data;
  const behind = u?.latest && u.latest !== u.current;
  return (
    <>
      <DocTitle>Updates</DocTitle>
      <PageHeader title="Updates" description="Folevi takes a backup before every update, and goes back to it if the update fails." />
      {update.error && !u ? <ControlError error={update.error} onRetry={update.reload} /> : null}
      {u ? (
        <Panel title={behind ? `Folevi Server ${u.latest} is available` : "Up to date"} actions={<Button onClick={update.reload}><RotateCw size={13} aria-hidden /> Check again</Button>}>
          <KeyValues
            items={[
              { label: "This server", value: `Folevi Server ${u.current}` },
              { label: "Newest", value: u.latest ? `Folevi Server ${u.latest}` : "Not checked yet" },
              { label: "Channel", value: u.channel === "beta" ? "Beta" : "Stable" },
              { label: "How it updates", value: MANAGED_BY[u.managedBy] ?? u.managedBy },
            ]}
          />
          {u.notesUrl ? (
            <a href={u.notesUrl} target="_blank" rel="noopener noreferrer" className="ui-btn ui-btn-secondary mt-4 h-control px-4 text-callout">
              What&apos;s new <ExternalLink size={14} aria-hidden />
            </a>
          ) : null}
        </Panel>
      ) : !update.error ? (
        <p className="text-subheadline text-muted">Loading…</p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- logs

const SERVICES = [
  { value: "web", label: "Web app" },
  { value: "backend", label: "Database and sync" },
  { value: "folevid", label: "Supervisor" },
];

export function ServerLogsView() {
  const [service, setService] = useState("web");
  const logs = useControl<{ lines: string[] }>(`logs?service=${service}&lines=500`);
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const lines = logs.data?.lines ?? [];
  return (
    <>
      <DocTitle>Logs and diagnostics</DocTitle>
      <PageHeader title="Logs and diagnostics" description="What each part of the server has been doing. Passwords, keys and tokens are removed before they're shown." />
      <div className="space-y-4">
        <Panel
          title="Logs"
          actions={
            <>
              <Select aria-label="Which part" value={service} onChange={(e) => setService(e.target.value)} className={`${selectCls} w-48`}>
                {SERVICES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <Button onClick={logs.reload}>
                <RotateCw size={13} aria-hidden /> Refresh
              </Button>
              <Button
                disabled={!lines.length}
                onClick={() => {
                  const url = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/plain" }));
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `folevi-${service}-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.log`;
                  a.click();
                  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                <Download size={13} aria-hidden /> Download
              </Button>
            </>
          }
        >
          {logs.error && !logs.data ? <ControlError error={logs.error} onRetry={logs.reload} /> : null}
          <pre className="max-h-[60vh] overflow-auto rounded-control bg-sunken p-3 font-mono text-footnote leading-relaxed text-ink" tabIndex={0} aria-label="Log lines">
            {logs.loading && !logs.data ? "Loading…" : lines.length ? lines.join("\n") : "Nothing logged yet."}
          </pre>
        </Panel>
        <Panel title="Send diagnostics to Folevi" description="When something isn't working and you've asked us for help. Logs are redacted on this server first, and never include anyone's notes.">
          <Button
            disabled={sending}
            aria-busy={sending}
            onClick={() => {
              setSending(true);
              control<{ reference: string }>("POST", "diagnostics")
                .then((r) => setReference(r.reference), (e: unknown) => toast.show(controlMessage(e), { tone: "error" }))
                .finally(() => setSending(false));
            }}
          >
            <Send size={14} aria-hidden /> Send diagnostics
          </Button>
          {reference ? (
            <Callout title="Sent">
              Mention the reference <strong className="font-mono">{reference}</strong> when you write to support@folevi.com.
            </Callout>
          ) : null}
        </Panel>
      </div>
    </>
  );
}
