"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { Laptop, Monitor, Moon, Smartphone, Sun, Upload } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { useEngineState, useLocalStorage } from "@/lib/hooks/useEngine";
import { clearAllLocalData } from "@/lib/sync/db";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { ViewChrome } from "@/components/app/Shell";
import { formatBytes, formatDateTime, formatRelative } from "@/lib/format";

type Section = "account" | "security" | "appearance" | "notifications" | "workspace" | "members" | "sync" | "data";
const SECTIONS: { id: Section; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "security", label: "Security & sessions" },
  { id: "appearance", label: "Appearance" },
  { id: "notifications", label: "Notifications" },
  { id: "workspace", label: "Workspace" },
  { id: "members", label: "Members" },
  { id: "sync", label: "Offline & sync" },
  { id: "data", label: "Import & export" },
];

function Card({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[12px] border border-line bg-raised p-5" aria-labelledby={`s-${title}`}>
      <h3 id={`s-${title}`} className="font-semibold">
        {title}
      </h3>
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SettingsView({ section }: { section: Section }) {
  return (
    <ViewChrome title={<h1 className="text-sm font-semibold">Settings</h1>} tabTitle="Settings">
      <div className="mx-auto grid max-w-5xl gap-8 px-4 pb-24 pt-6 sm:px-8 md:grid-cols-[200px_1fr]">
        <nav aria-label="Settings sections">
          <ul className="flex gap-1 overflow-x-auto md:flex-col">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <AppLink href={`/settings/${s.id}`} aria-current={section === s.id ? "page" : undefined} className={`block whitespace-nowrap rounded-[7px] px-3 py-1.5 text-sm ${section === s.id ? "bg-[color-mix(in_oklab,var(--color-ink)_8%,transparent)] font-medium" : "text-muted hover:text-ink"}`}>
                  {s.label}
                </AppLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-5">
          <h2 className="font-display text-[34px] leading-tight">{SECTIONS.find((s) => s.id === section)?.label}</h2>
          {section === "account" ? <AccountSection /> : null}
          {section === "security" ? <SecuritySection /> : null}
          {section === "appearance" ? <AppearanceSection /> : null}
          {section === "notifications" ? <NotificationsSection /> : null}
          {section === "workspace" ? <WorkspaceSection /> : null}
          {section === "members" ? <MembersSection /> : null}
          {section === "sync" ? <SyncSection /> : null}
          {section === "data" ? <DataSection /> : null}
        </div>
      </div>
    </ViewChrome>
  );
}

function AccountSection() {
  const { profile, timeZone } = useAppState();
  const update = useMutation(api.users.updateProfile);
  const requestDeletion = useMutation(api.users.requestAccountDeletion);
  const cancelDeletion = useMutation(api.users.cancelAccountDeletion);
  const toast = useToast();
  const [name, setName] = useState(profile.displayName);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [timeZone];
  return (
    <>
      <Card title="Profile">
        <form
          className="grid gap-4 sm:max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            update({ displayName: name }).then(() => toast.show("Saved", { tone: "success" }), (err) => toast.show(errorMessage(err), { tone: "error" }));
          }}
        >
          <label className="text-sm">
            <span className="mb-1 block font-medium">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="h-9 w-full rounded-[7px] border border-line bg-surface px-3" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Email</span>
            <input value={profile.email} readOnly aria-describedby="email-hint" className="h-9 w-full rounded-[7px] border border-line bg-sunken px-3 text-muted" />
            <span id="email-hint" className="mt-1 block text-xs text-muted">
              Your sign-in address. Contact support to change it.
            </span>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Time zone</span>
            <select value={timeZone} onChange={(e) => void update({ timeZone: e.target.value })} className="h-9 w-full rounded-[7px] border border-line bg-surface px-2">
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted">Used for Today, Daily Notes and reminders.</span>
          </label>
          <div>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
      </Card>
      <Card title="Delete account" description="Deletes your account, your personal workspace and everything in it after a 7-day grace period. Team workspaces you own pass to an admin if there is one. Export your data first if you want to keep it.">
        {profile.status === "pending_deletion" ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">Scheduled for {profile.deletionScheduledFor ? formatDateTime(profile.deletionScheduledFor) : "soon"}.</p>
            <Button onClick={() => void cancelDeletion({}).then(() => toast.show("Deletion canceled", { tone: "success" }))}>Cancel deletion</Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            Delete my account…
          </Button>
        )}
      </Card>
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete your account?"
        description="You can cancel within 7 days by signing in. After that, deletion is permanent and cannot be undone. We'll email you a confirmation."
        size="sm"
        footer={
          <>
            <Button onClick={() => setDeleteOpen(false)}>Keep my account</Button>
            <Button
              variant="danger"
              disabled={confirmEmail.trim().toLowerCase() !== profile.email}
              onClick={() =>
                requestDeletion({ confirmEmail }).then(
                  () => {
                    setDeleteOpen(false);
                    toast.show("Account deletion scheduled");
                  },
                  (e) => toast.show(errorMessage(e), { tone: "error" }),
                )
              }
            >
              Schedule deletion
            </Button>
          </>
        }
      >
        <label className="text-sm" htmlFor="confirm-email">
          Type <strong>{profile.email}</strong> to confirm
        </label>
        <input id="confirm-email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} className="mt-2 h-10 w-full rounded-[8px] border border-line bg-surface px-3" autoComplete="off" />
      </Dialog>
    </>
  );
}

function SecuritySection() {
  const sessions = useQuery(api.users.listSessions, {});
  const revoke = useMutation(api.users.revokeSession);
  const revokeOthers = useMutation(api.users.revokeOtherSessions);
  const resetPassword = useMutation(api.authSupport.requestPasswordReset);
  const toast = useToast();
  return (
    <>
      <Card
        title="Sign-in protection"
        description={
          <>
            Every Folevi account signs in with an email, a password and an authenticator app (TOTP). One-time recovery codes are shown once when you set up the authenticator — keep them somewhere safe.
            When you choose “Remember this browser”, the authenticator step is skipped on that browser for 30 days; signing out or revoking the session below ends that.
          </>
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              resetPassword({}).then(
                (r) => toast.show(r.configured ? "Check your email for a password reset link." : "Password reset isn't available in this environment (no identity provider configured)."),
                (e) => toast.show(errorMessage(e), { tone: "error" }),
              )
            }
          >
            Change password
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">
          To move your authenticator to a new phone, sign in on the new device and use a recovery code, or ask support to reset two-step verification after verifying your identity.
        </p>
      </Card>
      <Card title="Sessions" description="Devices and browsers signed in to your account. Revoking a session signs it out the next time it contacts Folevi.">
        <ul className="divide-y divide-line rounded-[10px] border border-line">
          {sessions === undefined ? <li className="px-4 py-3 text-sm text-muted">Loading…</li> : null}
          {sessions?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <span className="text-muted" aria-hidden>
                {s.client === "mac" ? <Laptop size={18} /> : /iOS|Android/.test(s.label) ? <Smartphone size={18} /> : <Monitor size={18} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {s.label} {s.current ? <span className="ml-1 rounded-[4px] bg-moss-soft px-1.5 py-0.5 text-[11px] text-moss-ink">This device</span> : null}
                </span>
                <span className="block text-xs text-muted">
                  Signed in {formatDateTime(s.createdAt)} · last active {formatRelative(s.lastSeenAt)}
                  {s.revokedAt ? ` · revoked ${formatRelative(s.revokedAt)}` : ""}
                </span>
              </span>
              {!s.revokedAt && !s.current ? (
                <Button size="sm" onClick={() => void revoke({ sessionId: s.id }).then(() => toast.show("Session revoked"), (e) => toast.show(errorMessage(e), { tone: "error" }))}>
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <Button className="mt-3" onClick={() => void revokeOthers({}).then(() => toast.show("Signed out everywhere else"))}>
          Sign out of all other sessions
        </Button>
      </Card>
    </>
  );
}

function AppearanceSection() {
  const { appearance, setAppearance } = useAppState();
  const update = useMutation(api.users.updateProfile);
  const [zoom, setZoom] = useLocalStorage<number>("folevi:editor-zoom", 1);
  return (
    <>
      <Card title="Theme" description="Dark mode is designed, not inverted: document colors are softened and code stays readable.">
        <div role="radiogroup" aria-label="Theme" className="grid max-w-md grid-cols-3 gap-3">
          {(
            [
              ["light", "Light", <Sun key="s" size={18} />],
              ["dark", "Dark", <Moon key="m" size={18} />],
              ["system", "System", <Monitor key="d" size={18} />],
            ] as const
          ).map(([v, label, icon]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={appearance === v}
              onClick={() => {
                setAppearance(v);
                void update({ appearance: v });
              }}
              className={`flex flex-col items-center gap-2 rounded-[10px] border p-4 text-sm ${appearance === v ? "border-accent bg-accent-soft text-accent-soft-ink" : "border-line bg-surface"}`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </Card>
      <Card title="Editor text size">
        <label className="flex max-w-md items-center gap-3 text-sm">
          <span>Smaller</span>
          <input
            type="range"
            min={0.85}
            max={1.35}
            step={0.05}
            value={zoom}
            onChange={(e) => {
              const v = Number(e.target.value);
              setZoom(v);
              document.documentElement.style.setProperty("--editor-zoom", String(v));
            }}
            aria-label="Editor text size"
            className="flex-1 accent-[var(--color-accent)]"
          />
          <span>Larger</span>
        </label>
      </Card>
    </>
  );
}

function NotificationsSection() {
  const { profile } = useAppState();
  const update = useMutation(api.users.updateProfile);
  const toast = useToast();
  const prefs = profile.notificationPrefs;
  const set = (patch: Partial<typeof prefs>) => update({ notificationPrefs: { ...prefs, ...patch } }).then(() => toast.show("Saved"), (e) => toast.show(errorMessage(e), { tone: "error" }));
  const row = (key: "mentions" | "comments" | "shares" | "invites", label: string) => (
    <label className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <span>{label}</span>
      <input type="checkbox" checked={prefs[key]} onChange={(e) => void set({ [key]: e.target.checked })} className="h-5 w-5 accent-[var(--color-accent)]" />
    </label>
  );
  return (
    <Card title="Email notifications" description="In-app notifications always appear in the bell. Security emails (new sign-ins, account deletion) can't be turned off.">
      <div className="max-w-md divide-y divide-line">
        {row("mentions", "When someone mentions me")}
        {row("comments", "Comments and replies on my pages")}
        {row("shares", "When a page is shared with me")}
        {row("invites", "Workspace invitations")}
        <label className="flex items-center justify-between gap-4 py-2.5 text-sm">
          <span>
            Daily digest of unread comments and mentions
            <span className="block text-xs text-muted">One email a day with page titles only — never comment text.</span>
          </span>
          <input type="checkbox" checked={prefs.digest === "daily"} onChange={(e) => void set({ digest: e.target.checked ? "daily" : "off" })} className="h-5 w-5 accent-[var(--color-accent)]" />
        </label>
      </div>
    </Card>
  );
}

function WorkspaceSection() {
  const { workspace, setWorkspace } = useAppState();
  const rename = useMutation(api.workspaces.rename);
  const create = useMutation(api.workspaces.createTeamWorkspace);
  const toast = useToast();
  const [name, setName] = useState(workspace.name);
  const [teamName, setTeamName] = useState("");
  const canAdmin = workspace.role === "owner" || workspace.role === "admin";
  return (
    <>
      <Card title="Workspace" description={`${workspace.kind === "personal" ? "Personal" : "Team"} workspace · you are ${workspace.role === "owner" ? "the owner" : `an ${workspace.role}`}.`}>
        <form
          className="flex max-w-md gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            rename({ workspaceId: workspace.id, name }).then(() => toast.show("Renamed", { tone: "success" }), (err) => toast.show(errorMessage(err), { tone: "error" }));
          }}
        >
          <label className="sr-only" htmlFor="ws-name">
            Workspace name
          </label>
          <input id="ws-name" disabled={!canAdmin} value={name} onChange={(e) => setName(e.target.value)} className="h-9 flex-1 rounded-[7px] border border-line bg-surface px-3 disabled:opacity-60" />
          <Button type="submit" disabled={!canAdmin}>
            Rename
          </Button>
        </form>
        <p className="mt-4 text-sm text-muted">
          Storage: {formatBytes(workspace.storageUsedBytes)} of {formatBytes(workspace.storageQuotaBytes)} used
        </p>
        <div className="mt-2 h-1.5 max-w-md overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${Math.round((workspace.storageUsedBytes / workspace.storageQuotaBytes) * 100)}% of storage used`}>
          <div className="h-full bg-accent" style={{ width: `${Math.min(100, (workspace.storageUsedBytes / workspace.storageQuotaBytes) * 100)}%` }} />
        </div>
      </Card>
      <DailyTemplateCard />
      <Card title="New team workspace" description="Share folders, documents and tasks with other people. Your personal workspace stays private.">
        <form
          className="flex max-w-md gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create({ name: teamName }).then(
              (r) => {
                setWorkspace(r.id);
                toast.show("Workspace created", { tone: "success" });
              },
              (err) => toast.show(errorMessage(err), { tone: "error" }),
            );
          }}
        >
          <label className="sr-only" htmlFor="team-name">
            Team workspace name
          </label>
          <input id="team-name" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. Ashgrove Gardens" className="h-9 flex-1 rounded-[7px] border border-line bg-surface px-3" />
          <Button type="submit" variant="primary" disabled={!teamName.trim()}>
            Create
          </Button>
        </form>
      </Card>
    </>
  );
}

function DailyTemplateCard() {
  const { workspace } = useAppState();
  const builtIns = useQuery(api.settings.builtInTemplates, {});
  const own = useQuery(api.documents.list, { workspaceId: workspace.id, view: "templates", paginationOpts: { numItems: 50, cursor: null } });
  const [template, setTemplate] = useLocalStorage<string | null>("folevi:daily-template", null);
  return (
    <Card title="Daily Notes" description="New Daily Notes can start from a template. Existing notes are never changed.">
      <label className="block max-w-md text-sm">
        <span className="mb-1 block font-medium">Template for new Daily Notes</span>
        <select value={template ?? ""} onChange={(e) => setTemplate(e.target.value || null)} className="h-9 w-full rounded-[7px] border border-line bg-surface px-2">
          <option value="">Blank page</option>
          {builtIns?.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name} (built-in)
            </option>
          ))}
          {own?.page.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title || "Untitled template"}
            </option>
          ))}
        </select>
      </label>
    </Card>
  );
}

function MembersSection() {
  const { workspace } = useAppState();
  const data = useQuery(api.workspaces.members, { workspaceId: workspace.id });
  const invite = useMutation(api.workspaces.invite);
  const revokeInvite = useMutation(api.workspaces.revokeInvite);
  const changeRole = useMutation(api.workspaces.changeRole);
  const remove = useMutation(api.workspaces.removeMember);
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "editor" | "commenter" | "viewer">("editor");
  const canAdmin = data?.yourRole === "owner" || data?.yourRole === "admin";
  const act = (p: Promise<unknown>, ok: string) => p.then(() => toast.show(ok), (e) => toast.show(errorMessage(e), { tone: "error" }));
  return (
    <>
      {canAdmin ? (
        <Card title="Invite people" description="Invitations are tied to the email address you enter and expire after 7 days.">
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void act(invite({ workspaceId: workspace.id, email, role }), "Invitation sent").then(() => setEmail(""));
            }}
          >
            <label className="sr-only" htmlFor="invite-email">
              Email
            </label>
            <input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className="h-9 min-w-0 flex-1 rounded-[7px] border border-line bg-surface px-3" />
            <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as typeof role)} className="h-9 rounded-[7px] border border-line bg-surface px-2">
              {data?.yourRole === "owner" ? <option value="admin">Admin</option> : null}
              <option value="editor">Editor</option>
              <option value="commenter">Commenter</option>
              <option value="viewer">Viewer</option>
            </select>
            <Button type="submit" variant="primary">
              Invite
            </Button>
          </form>
        </Card>
      ) : null}
      <Card title="Members">
        <ul className="divide-y divide-line rounded-[10px] border border-line">
          {data?.members.map((m) => (
            <li key={m.profileId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {m.displayName} {m.isYou ? <span className="text-xs text-muted">(you)</span> : null}
                </span>
                <span className="block text-xs text-muted">{m.email}</span>
              </span>
              {canAdmin && m.role !== "owner" && !m.isYou ? (
                <>
                  <select aria-label={`Role for ${m.displayName}`} value={m.role} onChange={(e) => void act(changeRole({ workspaceId: workspace.id, profileId: m.profileId, role: e.target.value as typeof role }), "Role updated")} className="h-8 rounded-[6px] border border-line bg-surface px-2 text-sm">
                    {data?.yourRole === "owner" ? <option value="admin">Admin</option> : null}
                    <option value="editor">Editor</option>
                    <option value="commenter">Commenter</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <Button size="sm" variant="quiet" className="text-danger" onClick={() => void act(remove({ workspaceId: workspace.id, profileId: m.profileId }), "Removed")}>
                    Remove
                  </Button>
                </>
              ) : (
                <span className="text-sm capitalize text-muted">{m.role}</span>
              )}
            </li>
          ))}
        </ul>
        {data?.invites.length ? (
          <>
            <h4 className="mb-2 mt-5 text-sm font-semibold">Pending invitations</h4>
            <ul className="divide-y divide-line rounded-[10px] border border-line">
              {data.invites.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="flex-1">{i.email}</span>
                  <span className="text-xs capitalize text-muted">
                    {i.role} · {i.expired ? "expired" : `expires ${formatRelative(i.expiresAt)}`}
                  </span>
                  <Button size="sm" variant="quiet" onClick={() => void act(revokeInvite({ inviteId: i.id }), "Invitation revoked")}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {!canAdmin ? <p className="mt-3 text-sm text-muted">Only owners and admins can invite or change roles.</p> : null}
      </Card>
    </>
  );
}

function SyncSection() {
  const { engine, deviceId, online } = useAppState();
  const state = useEngineState(engine);
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Card title="This device" description="Folevi keeps your recent documents and every unsent change in this browser, so you can keep writing offline and nothing is lost if the tab closes.">
        <dl className="grid max-w-md grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted">Connection</dt>
          <dd>{online ? "Online" : "Offline"}</dd>
          <dt className="text-muted">Changes waiting to sync</dt>
          <dd className="tabular-nums">{state.pending.length + state.inflight.length}</dd>
          <dt className="text-muted">Uploads waiting</dt>
          <dd className="tabular-nums">{state.uploads.length}</dd>
          <dt className="text-muted">Unresolved conflicts</dt>
          <dd className="tabular-nums">{state.conflicts.length}</dd>
          <dt className="text-muted">Device id</dt>
          <dd className="truncate font-mono text-xs">{deviceId}</dd>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => engine?.scheduleFlush(0)}>Sync now</Button>
          <Button variant="quiet" className="text-danger" onClick={() => setConfirm(true)}>
            Clear data on this device…
          </Button>
        </div>
      </Card>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Clear local data?"
        description={state.pending.length ? `${state.pending.length} change(s) haven't synced yet and will be lost. Reconnect first if you want to keep them.` : "Your documents stay in your account. This browser will download them again."}
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() =>
                void clearAllLocalData().then(() => {
                  toast.show("Local data cleared");
                  location.reload();
                })
              }
            >
              Clear
            </Button>
          </>
        }
      />
    </>
  );
}

function DataSection() {
  const { workspace } = useAppState();
  const importText = useMutation(api.imports.importText);
  const exportWorkspace = useAction(api.exports.exportWorkspace);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<{ name: string; id?: string; warnings: { line: number; message: string }[]; error?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Card title="Import" description="Markdown (.md) and plain text (.txt). Headings, lists, checklists, links, code, quotes, tables and front matter are kept. Anything we can't convert is kept as text and listed below.">
        <input
          ref={input}
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          multiple
          hidden
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            setBusy(true);
            const out: typeof results = [];
            for (const f of files.slice(0, 50)) {
              try {
                const content = await f.text();
                const r = await importText({ workspaceId: workspace.id, filename: f.name, content, format: /\.txt$/i.test(f.name) ? "text" : "markdown" });
                out.push({ name: f.name, id: r.document.id, warnings: r.warnings });
              } catch (err) {
                out.push({ name: f.name, warnings: [], error: errorMessage(err) });
              }
            }
            setResults(out);
            setBusy(false);
            toast.show(`Imported ${out.filter((r) => r.id).length} of ${out.length} file(s)`);
          }}
        />
        <Button onClick={() => input.current?.click()} disabled={busy}>
          <Upload size={14} aria-hidden /> {busy ? "Importing…" : "Choose files…"}
        </Button>
        {results.length ? (
          <ul className="mt-4 space-y-2 text-sm">
            {results.map((r) => (
              <li key={r.name} className="rounded-[8px] border border-line p-3">
                <p className="font-medium">
                  {r.id ? <AppLink href={`/d/${r.id}`} className="hover:underline">{r.name}</AppLink> : r.name}
                  {r.error ? <span className="ml-2 text-danger">— {r.error}</span> : null}
                </p>
                {r.warnings.length ? (
                  <ul className="mt-1 list-disc pl-5 text-xs text-muted">
                    {r.warnings.map((w, i) => (
                      <li key={i}>
                        Line {w.line}: {w.message}
                      </li>
                    ))}
                  </ul>
                ) : r.id ? (
                  <p className="text-xs text-muted">Imported without changes.</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      <Card title="Export workspace" description="A ZIP with every document as Markdown, all attachments in an assets folder, and a manifest.json describing folders, documents and files. Single pages can be exported from their ••• menu as Markdown, HTML or PDF.">
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await exportWorkspace({ workspaceId: workspace.id });
              const a = document.createElement("a");
              a.href = r.url;
              a.download = r.filename;
              a.click();
              toast.show(`Exported ${r.documents} documents and ${r.assets} attachments`, { tone: "success" });
            } catch (e) {
              toast.show(errorMessage(e), { tone: "error" });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Preparing…" : "Export workspace (.zip)"}
        </Button>
      </Card>
    </>
  );
}
