"use client";

// The admin panel's settings sections (docs/SELF_HOSTING_PLAN.md §6 and §7), over serverAdmin:getSettings and
// serverAdmin:updateSettings (CONTRACT §8). Secrets are write-only: the backend says whether one is stored.
import { useState } from "react";
import { useAction } from "convex/react";
import { Send } from "lucide-react";
import { useQueryState } from "@/lib/convex/queries";
import { serverAdminRefs, type ServerPerson, type ServerSettings } from "@/lib/server-edition/refs";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { errorMessage, useToast } from "@/components/ui/Toast";
import { Callout, DataTable, DocTitle, EmptyRow, LoadingRows, Meter, PageHeader, Panel, td, tdNum, th, thNum, selectCls } from "../ui";
import { SaveBar, SecretInput, type SaveSettings, SettingRow, SwitchRow, TextInput, WithSettings, bytesToGb, gbToBytes, useControl, useDraft } from "./kit";
import type { ControlStatus } from "./types";
import { EMAIL_PRESETS, SECURITY_NAMES, presetFor } from "@/components/server/emailPresets";

type Save = SaveSettings;

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-subheadline font-medium text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="text-footnote text-muted">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- sign-in

function SignInForm({ settings, save }: { settings: ServerSettings; save: Save }) {
  const [domains, setDomains] = useState(settings.allowedDomains.join(", "));
  const [clientId, setClientId] = useState(settings.google?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const signIn = settings.signIn;
  const toggle = (key: keyof ServerSettings["signIn"]) => (next: boolean) => save({ signIn: { [key]: next } }, next ? "Turned on." : "Turned off.");
  return (
    <div className="space-y-4">
      <Panel title="Ways to sign in" description="Server accounts with a password always work, with or without internet.">
        <SwitchRow label="Email and password" description="Server accounts, with two-step codes if people turn them on." checked={signIn.password} onChange={toggle("password")} />
        <SwitchRow label="Passkeys" description="Face ID, Touch ID, Windows Hello or a security key." checked={signIn.passkey} onChange={toggle("passkey")} />
        <SwitchRow label="Folevi account" description="People sign in with the Folevi account they already have. Their notes stay on this server." checked={signIn.folevi} onChange={toggle("folevi")} />
        <SwitchRow label="Google" description="Through Folevi's sign-in service, or your own Google keys below." checked={signIn.google} onChange={toggle("google")} />
        <SwitchRow label="Sign in with Apple" description="Through Folevi's sign-in service." checked={signIn.apple} onChange={toggle("apple")} />
      </Panel>
      <Panel title="Who can create an account">
        <SettingRow label="New accounts" description="Invites always work, whichever you choose.">
          <Select aria-label="New accounts" value={settings.signUp} onChange={(e) => void save({ signUp: e.target.value as ServerSettings["signUp"] })} className={`${selectCls} w-64`}>
            <option value="invite" data-description="Only people you invite">
              By invite only
            </option>
            <option value="domains" data-description="Anyone with an email at the domains below">
              Chosen email domains
            </option>
            <option value="open" data-description="Anyone who can reach this server">
              Anyone
            </option>
          </Select>
        </SettingRow>
        {settings.signUp === "domains" ? (
          <div className="mt-2 space-y-2">
            <Field id="allowed-domains" label="Email domains" hint="Separate them with commas, for example example.com, example.org.">
              <TextInput id="allowed-domains" value={domains} onChange={setDomains} placeholder="example.com" />
            </Field>
            <SaveBar
              dirty={domains !== settings.allowedDomains.join(", ")}
              busy={busy}
              onSave={() => {
                setBusy(true);
                const list = domains
                  .split(/[\s,]+/)
                  .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
                  .filter(Boolean);
                void save({ allowedDomains: list }).finally(() => setBusy(false));
              }}
            />
          </div>
        ) : null}
      </Panel>
      <Panel title="Your own Google keys" description="Optional. Without them, Google sign-in goes through Folevi's sign-in service.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="google-client-id" label="Client ID">
            <TextInput id="google-client-id" value={clientId} onChange={setClientId} />
          </Field>
          <Field id="google-client-secret" label="Client secret">
            <SecretInput id="google-client-secret" label="Client secret" set={settings.google?.clientSecret?.set} value={clientSecret} onChange={setClientSecret} />
          </Field>
        </div>
        <SaveBar
          dirty={clientId !== (settings.google?.clientId ?? "") || clientSecret !== ""}
          busy={busy}
          onSave={() => {
            setBusy(true);
            void save({ google: { clientId: clientId.trim(), ...(clientSecret ? { clientSecret } : {}) } })
              .then((ok) => ok && setClientSecret(""))
              .finally(() => setBusy(false));
          }}
        />
      </Panel>
    </div>
  );
}

export function ServerSignInView() {
  return (
    <>
      <DocTitle>Sign-in</DocTitle>
      <PageHeader title="Sign-in" description="How people sign in to this server, and who can create an account." />
      <WithSettings>{(settings, save) => <SignInForm settings={settings} save={save} />}</WithSettings>
    </>
  );
}

// ---------------------------------------------------------------- workspaces and sharing

function SharingForm({ settings, save }: { settings: ServerSettings; save: Save }) {
  const [quota, setQuota] = useState(bytesToGb(settings.defaultQuotaBytes));
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      <Panel title="Sharing">
        <SwitchRow
          label="Public links"
          description="Let people share a note with anyone who has the link, including people without an account here. Turning this off stops every public link from opening."
          checked={settings.publicLinks}
          onChange={(next) => save({ publicLinks: next })}
        />
        <p className="mt-2 text-subheadline text-muted">Sharing with other people on this server, workspaces and comments always work.</p>
      </Panel>
      <Panel title="Storage for each person" description="A limit for everyone who doesn't have their own. You can set one per person on People.">
        <Field id="default-quota" label="Default limit in GB" hint="Leave empty for no limit.">
          <TextInput id="default-quota" inputMode="numeric" value={quota} onChange={setQuota} placeholder="No limit" className="max-w-xs" />
        </Field>
        <SaveBar
          dirty={quota !== bytesToGb(settings.defaultQuotaBytes)}
          busy={busy}
          onSave={() => {
            setBusy(true);
            void save({ defaultQuotaBytes: quota.trim() ? gbToBytes(quota) : null }).finally(() => setBusy(false));
          }}
        />
      </Panel>
    </div>
  );
}

export function ServerSharingView() {
  return (
    <>
      <DocTitle>Workspaces and sharing</DocTitle>
      <PageHeader title="Workspaces and sharing" description="What people may share, and how much each person can store." />
      <WithSettings>{(settings, save) => <SharingForm settings={settings} save={save} />}</WithSettings>
    </>
  );
}

// ---------------------------------------------------------------- email

type SmtpDraft = { mode: ServerSettings["email"]["mode"]; host: string; port: string; security: "tls" | "starttls" | "none"; username: string; password: string; from: string };

function EmailForm({ settings, save }: { settings: ServerSettings; save: Save }) {
  const smtp = settings.email.smtp;
  const { draft, set, dirty, reset } = useDraft<SmtpDraft>({
    mode: settings.email.mode,
    host: smtp?.host ?? "",
    port: smtp?.port ? String(smtp.port) : "587",
    security: smtp?.security ?? "starttls",
    username: smtp?.username ?? "",
    password: "",
    from: smtp?.from ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [to, setTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const test = useAction(serverAdminRefs.testEmail);
  const toast = useToast();
  return (
    <div className="space-y-4">
      <Panel title="Sending email" description="Verification links, password resets, invites, sharing notices, reminders and digests.">
        <SettingRow label="Send through">
          <Select aria-label="Send email through" value={draft.mode} onChange={(e) => set("mode", e.target.value as SmtpDraft["mode"])} className={`${selectCls} w-64`}>
            <option value="folevi" data-description="Works once this server is linked to a Folevi account">
              Folevi Mail
            </option>
            <option value="smtp" data-description="Gmail, iCloud, Outlook or any mail service (SMTP)">
              Your own email account
            </option>
            <option value="off" data-description="Invites by link, password resets by an admin">
              Don&apos;t send email
            </option>
          </Select>
        </SettingRow>
        {draft.mode === "folevi" ? <Callout>Email goes out from no-reply@folevi.app with replies going to the server&apos;s owner. Folevi never sees your notes, only the email itself.</Callout> : null}
        {draft.mode === "off" ? <Callout>With email off, new accounts don&apos;t need to confirm their address, invites are shared as links, and admins reset passwords from People.</Callout> : null}
        {draft.mode === "smtp" ? (
          <p className="mt-1 text-subheadline text-muted">Folevi sends through your mail account the way a mail app does (this is called SMTP). Pick your service and the details fill themselves in.</p>
        ) : null}
        {draft.mode === "smtp" ? (
          <div className="mt-3 space-y-1">
            <span id="smtp-preset" className="block text-subheadline font-medium text-ink">
              Email service
            </span>
            <Select
              aria-labelledby="smtp-preset"
              value={presetFor(draft.host).id}
              onChange={(e) => {
                const p = EMAIL_PRESETS.find((x) => x.id === e.target.value)!;
                if (p.id === "other") set("host", "");
                else (set("host", p.host), set("port", String(p.port)), set("security", p.security));
              }}
              className={`${selectCls} w-full sm:w-72`}
            >
              {EMAIL_PRESETS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
            <p className="text-footnote text-muted">{presetFor(draft.host).passwordHint}</p>
          </div>
        ) : null}
        {draft.mode === "smtp" ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field id="smtp-host" label="Sending server">
              <TextInput id="smtp-host" value={draft.host} onChange={(v) => set("host", v)} placeholder="smtp.example.com" />
            </Field>
            <div className="grid grid-cols-[100px_1fr] gap-3">
              <Field id="smtp-port" label="Port">
                <TextInput id="smtp-port" inputMode="numeric" value={draft.port} onChange={(v) => set("port", v.replace(/\D/g, ""))} />
              </Field>
              <div className="space-y-1">
                <span id="smtp-security" className="block text-subheadline font-medium text-ink">
                  Security
                </span>
                <Select aria-labelledby="smtp-security" value={draft.security} onChange={(e) => set("security", e.target.value as SmtpDraft["security"])} className={`${selectCls} w-full`}>
                  {(["starttls", "tls", "none"] as const).map((k) => (
                    <option key={k} value={k} data-description={SECURITY_NAMES[k].description}>
                      {SECURITY_NAMES[k].title}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <Field id="smtp-user" label="Username" hint="Usually your full email address.">
              <TextInput id="smtp-user" value={draft.username} onChange={(v) => set("username", v)} />
            </Field>
            <Field id="smtp-password" label="Password">
              <SecretInput id="smtp-password" label="SMTP password" set={smtp?.password?.set} value={draft.password} onChange={(v) => set("password", v)} />
            </Field>
            <Field id="smtp-from" label="From address" hint='For example "Smith family <folevi@example.com>".'>
              <TextInput id="smtp-from" value={draft.from} onChange={(v) => set("from", v)} />
            </Field>
          </div>
        ) : null}
        <SaveBar
          dirty={dirty}
          busy={busy}
          onReset={reset}
          onSave={() => {
            setBusy(true);
            const patch =
              draft.mode === "smtp"
                ? {
                    email: {
                      mode: "smtp" as const,
                      smtp: { host: draft.host.trim(), port: Number(draft.port) || 587, security: draft.security, from: draft.from.trim(), ...(draft.username.trim() ? { username: draft.username.trim() } : {}), ...(draft.password ? { password: draft.password } : {}) },
                    },
                  }
                : { email: { mode: draft.mode } };
            void save(patch).finally(() => setBusy(false));
          }}
        />
      </Panel>
      <Panel title="Send a test email" description={settings.email.mode === "off" ? "Turn on email above and save first." : "Checks the settings saved above by sending a short email."}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <TextInput type="email" inputMode="email" value={to} onChange={setTo} placeholder="you@example.com" aria-label="Send the test to" />
          <Button
            disabled={testing || !to.trim() || settings.email.mode === "off"}
            aria-busy={testing}
            onClick={() => {
              setTesting(true);
              test({ to: to.trim() })
                .then((r) => {
                  setResult(r.ok ? { ok: true, text: `Sent to ${to.trim()}. Check the inbox, and the spam folder, in a minute.` } : { ok: false, text: `It didn't send: ${r.error ?? "the mail service gave no reason"}. Check the server, port, username and password above, save, and try again.` });
                  toast.show(r.ok ? "Test email sent." : "The test email didn't send.", { tone: r.ok ? "success" : "error" });
                })
                .catch((e: unknown) => setResult({ ok: false, text: errorMessage(e) }))
                .finally(() => setTesting(false));
            }}
          >
            <Send size={14} aria-hidden /> {testing ? "Sending…" : "Send test"}
          </Button>
        </div>
        {result ? (
          <div className="mt-3" role="status">
            <Callout tone={result.ok ? "neutral" : "danger"}>{result.text}</Callout>
          </div>
        ) : null}
      </Panel>
      <Panel title="Email to Folevi" description="Each person gets an address that turns the email they forward into a note.">
        <SettingRow label="Receive through">
          <Select aria-label="Receive email through" value={settings.emailIn.mode} onChange={(e) => void save({ emailIn: { mode: e.target.value as ServerSettings["emailIn"]["mode"] } })} className={`${selectCls} w-64`}>
            <option value="folevi">Folevi&apos;s mail server</option>
            <option value="imap">A mailbox you set up (IMAP)</option>
            <option value="off">Off</option>
          </Select>
        </SettingRow>
      </Panel>
    </div>
  );
}

export function ServerEmailView() {
  return (
    <>
      <DocTitle>Email</DocTitle>
      <PageHeader title="Email" description="How this server sends email, and how notes arrive by email." />
      <WithSettings>{(settings, save) => <EmailForm settings={settings} save={save} />}</WithSettings>
    </>
  );
}

// ---------------------------------------------------------------- Foli AI

type AiDraft = { mode: ServerSettings["ai"]["mode"]; geminiKey: string; geminiModel: string; baseUrl: string; openaiKey: string; model: string; embeddingModel: string; allowed: "everyone" | "admins"; limit: string };

function AiForm({ settings, save }: { settings: ServerSettings; save: Save }) {
  const ai = settings.ai;
  const { draft, set, dirty, reset } = useDraft<AiDraft>({
    mode: ai.mode,
    geminiKey: "",
    geminiModel: ai.gemini?.model ?? "",
    baseUrl: ai.openai?.baseUrl ?? "",
    openaiKey: "",
    model: ai.openai?.model ?? "",
    embeddingModel: ai.openai?.embeddingModel ?? "",
    allowed: ai.allowed,
    limit: ai.monthlyLimitPerPerson ? String(ai.monthlyLimitPerPerson) : "",
  });
  const [busy, setBusy] = useState(false);
  return (
    <Panel title="Foli AI" description="Off means Foli AI is hidden everywhere on this server.">
      <SettingRow label="Answers come from">
        <Select aria-label="Foli AI answers come from" value={draft.mode} onChange={(e) => set("mode", e.target.value as AiDraft["mode"])} className={`${selectCls} w-64`}>
          <option value="off">Off</option>
          <option value="folevi" data-description="Counts against the owner's Folevi plan">
            Folevi AI
          </option>
          <option value="gemini" data-description="Your own Google Gemini key">
            Gemini
          </option>
          <option value="openai" data-description="OpenAI, or a local model such as Ollama or LM Studio">
            OpenAI-compatible service
          </option>
        </Select>
      </SettingRow>
      {draft.mode === "folevi" ? <Callout>Requests go through Folevi&apos;s AI gateway, which passes them to the model and keeps nothing.</Callout> : null}
      {draft.mode === "gemini" ? (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Field id="gemini-key" label="API key">
            <SecretInput id="gemini-key" label="Gemini API key" set={ai.gemini?.apiKey?.set} value={draft.geminiKey} onChange={(v) => set("geminiKey", v)} />
          </Field>
          <Field id="gemini-model" label="Model" hint="Leave empty for Folevi's default.">
            <TextInput id="gemini-model" value={draft.geminiModel} onChange={(v) => set("geminiModel", v)} />
          </Field>
        </div>
      ) : null}
      {draft.mode === "openai" ? (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Field id="openai-url" label="Address" hint="For example https://api.openai.com/v1, or http://localhost:11434/v1 for Ollama.">
            <TextInput id="openai-url" value={draft.baseUrl} onChange={(v) => set("baseUrl", v)} placeholder="https://api.openai.com/v1" />
          </Field>
          <Field id="openai-key" label="API key" hint="Not needed for most local models.">
            <SecretInput id="openai-key" label="API key" set={ai.openai?.apiKey?.set} value={draft.openaiKey} onChange={(v) => set("openaiKey", v)} />
          </Field>
          <Field id="openai-model" label="Model">
            <TextInput id="openai-model" value={draft.model} onChange={(v) => set("model", v)} placeholder="gpt-4.1-mini" />
          </Field>
          <Field id="openai-embed" label="Embedding model" hint="Used for related notes and meaning search. Optional.">
            <TextInput id="openai-embed" value={draft.embeddingModel} onChange={(v) => set("embeddingModel", v)} />
          </Field>
        </div>
      ) : null}
      {draft.mode !== "off" ? (
        <div className="mt-3">
          <SettingRow label="Who can use it">
            <Select aria-label="Who can use Foli AI" value={draft.allowed} onChange={(e) => set("allowed", e.target.value as AiDraft["allowed"])} className={`${selectCls} w-64`}>
              <option value="everyone">Everyone</option>
              <option value="admins">Only the owner and admins</option>
            </Select>
          </SettingRow>
          <SettingRow label="Monthly limit per person" description="Requests each person can make in a month. Empty for no limit." htmlFor="ai-limit">
            <TextInput id="ai-limit" inputMode="numeric" value={draft.limit} onChange={(v) => set("limit", v.replace(/\D/g, ""))} placeholder="No limit" className="w-40" />
          </SettingRow>
        </div>
      ) : null}
      <SaveBar
        dirty={dirty}
        busy={busy}
        onReset={reset}
        onSave={() => {
          setBusy(true);
          const limit = draft.limit ? Number(draft.limit) : null;
          void save({
            ai: {
              mode: draft.mode,
              allowed: draft.allowed,
              monthlyLimitPerPerson: limit,
              ...(draft.mode === "gemini" ? { gemini: { ...(draft.geminiKey ? { apiKey: draft.geminiKey } : {}), ...(draft.geminiModel.trim() ? { model: draft.geminiModel.trim() } : {}) } } : {}),
              ...(draft.mode === "openai"
                ? { openai: { baseUrl: draft.baseUrl.trim(), model: draft.model.trim(), ...(draft.openaiKey ? { apiKey: draft.openaiKey } : {}), ...(draft.embeddingModel.trim() ? { embeddingModel: draft.embeddingModel.trim() } : {}) } }
                : {}),
            },
          }, "Saved. People see the change the next time they open Folevi.").finally(() => setBusy(false));
        }}
      />
    </Panel>
  );
}

export function ServerAiView() {
  return (
    <>
      <DocTitle>Foli AI</DocTitle>
      <PageHeader title="Foli AI" description="Where Foli AI's answers come from, and who may use it." />
      <WithSettings>{(settings, save) => <AiForm settings={settings} save={save} />}</WithSettings>
    </>
  );
}

// ---------------------------------------------------------------- notifications

function NotificationsForm({ settings, save }: { settings: ServerSettings; save: Save }) {
  const [key, setKey] = useState("");
  return (
    <div className="space-y-4">
      <Panel title="Phone notifications">
        <SwitchRow
          label="Folevi push relay"
          description="Wakes the iPhone, iPad and Android apps for reminders and mentions. Apple and Google only accept Folevi's keys, so this goes through Folevi with a short notice and no note content. Off, the apps catch up when they're opened."
          checked={settings.push.relay}
          onChange={(next) => save({ push: { relay: next } })}
        />
        <p className="mt-2 text-subheadline text-muted">Notifications in web browsers work on this server by itself.</p>
      </Panel>
      <Panel title="Cover photos" description="The photo picker for page covers.">
        <SettingRow label="Photos from">
          <Select aria-label="Cover photos from" value={settings.covers.mode} onChange={(e) => void save({ covers: { mode: e.target.value as ServerSettings["covers"]["mode"] } })} className={`${selectCls} w-64`}>
            <option value="folevi">Unsplash, through Folevi</option>
            <option value="unsplash">Unsplash, with your own key</option>
            <option value="off">Off</option>
          </Select>
        </SettingRow>
        {settings.covers.mode === "unsplash" ? (
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <SecretInput label="Unsplash access key" set={settings.covers.unsplashKey?.set} value={key} onChange={setKey} />
            <Button disabled={!key} onClick={() => void save({ covers: { mode: "unsplash", unsplashKey: key } }).then((ok) => ok && setKey(""))}>
              Save key
            </Button>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

export function ServerNotificationsView() {
  return (
    <>
      <DocTitle>Notifications</DocTitle>
      <PageHeader title="Notifications" description="Phone notifications and the other outside services." />
      <WithSettings>{(settings, save) => <NotificationsForm settings={settings} save={save} />}</WithSettings>
    </>
  );
}

// ---------------------------------------------------------------- storage

export function ServerStorageView() {
  const people = useQueryState(serverAdminRefs.listPeople, {});
  const status = useControl<ControlStatus>("status");
  const rows = ((people.data ?? []) as ServerPerson[]).slice().sort((a, b) => b.storageBytes - a.storageBytes);
  const disk = status.data?.disk;
  return (
    <>
      <DocTitle>Storage</DocTitle>
      <PageHeader title="Storage" description="How much room Folevi takes on this machine, and who uses it." />
      <div className="space-y-4">
        <Panel title="This machine">
          {disk ? (
            <>
              <p className="mb-2 flex justify-between text-subheadline">
                <span>Folevi&apos;s data folder</span>
                <span className="text-muted tabular-nums">
                  {formatBytes(disk.dataBytes)} used, {formatBytes(disk.freeBytes)} free
                </span>
              </p>
              <Meter label="Disk used by Folevi" value={disk.dataBytes} max={disk.dataBytes + disk.freeBytes} />
              <p className="mt-3 text-subheadline text-muted">Files deleted from the trash are removed from the disk within a day. Backups are counted separately.</p>
            </>
          ) : (
            <p className="text-subheadline text-muted">{status.error ? "The server's supervisor isn't answering." : "Loading…"}</p>
          )}
        </Panel>
        <Panel title="By person" description="Limits are set on People, or for everyone on Workspaces and sharing." flush>
          <DataTable caption="Storage by person" minWidth={480}>
            <thead>
              <tr>
                <th className={th}>Person</th>
                <th className={thNum}>Uses</th>
                <th className={thNum}>Limit</th>
              </tr>
            </thead>
            <tbody>
              {people.data === undefined ? <LoadingRows colSpan={3} /> : null}
              {people.data && rows.length === 0 ? <EmptyRow colSpan={3}>Nobody yet.</EmptyRow> : null}
              {rows.map((p) => (
                <tr key={p.userId}>
                  <td className={td}>{p.name || p.email}</td>
                  <td className={tdNum}>{formatBytes(p.storageBytes)}</td>
                  <td className={tdNum}>{p.quotaBytes ? formatBytes(p.quotaBytes) : <span className="text-muted">Default</span>}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      </div>
    </>
  );
}
