"use client";

// Folevi Server's first-run page (docs/SELF_HOSTING_PLAN.md §11, "Setup page"). Three steps make a working server:
// name it, create the first account, become its owner with the setup link folevid printed (server:claimOwner,
// CONTRACT §7). Then a short guide walks through remote access, email, Foli AI, backups (and the backup key),
// inviting people and connecting the apps. Every guide step has a default that works with no choice made, so
// "Skip for now" always leaves a usable server; skipped steps stay on the admin Overview's checklist.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAction, useConvexAuth, useMutation } from "convex/react";
import { useQuery } from "@/lib/convex/queries";
import { Archive, Building2, Check, Cloud, Copy, Cpu, Download, Eye, EyeOff, Globe, House, KeyRound, Mail, MailX, Send, Sparkles, UserPlus, Wifi } from "lucide-react";
import { authErrorMessage } from "@/lib/auth/client";
import { api } from "@/lib/convex/api";
import { ConvexClientProvider } from "@/lib/convex/provider";
import { serverAdminRefs, serverRefs, type InvitableRole, type ServerSettings, type ServerSettingsPatch, type SetupStep } from "@/lib/server-edition/refs";
import { serverSignUp } from "@/lib/server-edition/signUp";
import { errorMessage } from "@/components/ui/Toast";
import { Select } from "@/components/ui/Select";
import { Alert, AuthHeading, Field, PasswordField, SubmitButton, TextLink } from "@/components/auth/fields";
import { control, controlMessage } from "@/components/admin/server/kit";
import type { BackupList } from "@/components/admin/server/types";
import { ChoiceCards } from "./ChoiceCards";
import { ConnectApps } from "./ConnectApps";
import { EMAIL_PRESETS, presetFor } from "./emailPresets";
import { QrCode } from "./QrCode";
import { ShareLink } from "./ShareLink";

export type Step = "name" | "account" | "claim" | GuideStep;
export type GuideStep = "remote" | "email" | "ai" | "backups" | "invite" | "apps";
export const GUIDE: GuideStep[] = ["remote", "email", "ai", "backups", "invite", "apps"];
const NAME_KEY = "folevi:setup-name";

function readName(): string {
  try {
    return sessionStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function setupUrl(token: string, step: Step): string {
  return `/setup?${token ? `token=${encodeURIComponent(token)}&` : ""}step=${step}`;
}

function StepDots({ at, of, label }: { at: number; of: number; label: string }) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3">
      <p className="flex items-center gap-1.5" role="img" aria-label={`${label}, step ${at + 1} of ${of}`}>
        {Array.from({ length: of }, (_, i) => (
          <span key={i} aria-hidden className={`h-1.5 rounded-chip transition-all ${i <= at ? "w-5 bg-heading" : "w-2.5 bg-[color-mix(in_oklab,var(--color-ink)_18%,transparent)]"}`} />
        ))}
      </p>
      <span className="text-footnote text-muted" aria-hidden>
        {label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- 1. name

function NameStep({ onNext }: { onNext: (name: string) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(readName()), []);
  return (
    <>
      <AuthHeading title="Welcome to Folevi Server" lede="Let's get your server ready. It takes about two minutes. First, give it a name people will recognize, like your family's or your team's." />
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const value = name.trim();
          if (!value) {
            setError("Give your server a name, like Smith family.");
            return;
          }
          onNext(value.slice(0, 60));
        }}
      >
        <Field label="Server name" name="server-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} error={error} placeholder="Smith family" autoFocus hint="People see it when they sign in and when you invite them. You can change it later." />
        <SubmitButton busy={false}>Continue</SubmitButton>
      </form>
    </>
  );
}

// ---------------------------------------------------------------- 2. account

function AccountStep({ token }: { token: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ name?: string; email?: string; password?: string }>({});
  const next = setupUrl(token, "claim");
  return (
    <>
      <AuthHeading title="Create your account" lede="This is your own account on this server. As the first person here, you'll be its owner and can manage everything from the admin panel." />
      <form
        className="space-y-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setError(null);
          const address = email.trim();
          const problems: typeof fieldError = {};
          if (!name.trim()) problems.name = "Tell us what to call you.";
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) problems.email = "Enter an email address, like you@example.com. Nothing is sent to it yet.";
          if (password.length < 10) problems.password = "Use at least 10 characters for your password.";
          setFieldError(problems);
          if (Object.keys(problems).length) return;
          setBusy(true);
          const { error: err } = await serverSignUp({ name: name.trim().slice(0, 80), email: address, password, callbackURL: next });
          if (err) {
            setBusy(false);
            setError(authErrorMessage(err, undefined, "a few minutes"));
            return;
          }
          window.location.assign(next);
        }}
      >
        {error ? <Alert>{error}</Alert> : null}
        <Field label="Your name" name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={fieldError.name} autoFocus />
        <Field label="Email" type="email" name="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldError.email} hint="You sign in with it. Email doesn't have to be set up on the server." />
        <PasswordField label="Password" name="new-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fieldError.password} hint="At least 10 characters. A few unrelated words make a strong, memorable password." />
        <SubmitButton busy={busy}>Create account</SubmitButton>
      </form>
      <p className="mt-6 text-subheadline text-muted">
        Already made one here? <TextLink href={`/signin?returnTo=${encodeURIComponent(next)}`}>Sign in</TextLink>
      </p>
    </>
  );
}

// ---------------------------------------------------------------- 3. become the owner

function Claim({ token, onDone }: { token: string; onDone: () => void }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const bootstrap = useMutation(api.users.bootstrap);
  const claim = useMutation(serverRefs.claimOwner);
  const update = useMutation(serverAdminRefs.updateSettings);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    if (!isAuthenticated || started.current) return;
    started.current = true;
    void (async () => {
      try {
        // The account's profile is normally made when Folevi first opens; the owner needs it now.
        await bootstrap({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", locale: navigator.language || "en-US" });
        const r = await claim({ setupToken: token });
        if (!r?.ok) throw new Error("refused");
        const name = readName().trim();
        await update({ patch: { ...(name ? { name } : {}), setup: { done: ["name"] } } });
        onDone();
      } catch (e) {
        setError(e instanceof Error && e.message === "refused" ? "This setup link doesn't work any more. The server may already have an owner." : errorMessage(e));
      }
    })();
  }, [bootstrap, claim, isAuthenticated, onDone, token, update]);
  if (error) {
    return (
      <>
        <AuthHeading title="That didn't work" />
        <Alert>{error}</Alert>
        <p className="mt-6 text-subheadline text-muted">
          Open the setup link again from your NAS&apos;s Folevi page. On a Linux server, run <code className="font-mono">folevid setup-url</code> to see it. <TextLink href="/documents">Open Folevi</TextLink>
        </p>
      </>
    );
  }
  const waiting = !isLoading && !isAuthenticated;
  return (
    <>
      <AuthHeading title="Making you the owner" lede={waiting ? "Waiting for your sign-in…" : "One moment…"} />
      <div className="h-1 w-40 overflow-hidden rounded-tiny bg-sunken" aria-hidden>
        <div className="h-full w-1/3 animate-[folio-progress_1.2s_ease-in-out_infinite] rounded-chip bg-heading" />
      </div>
      {waiting && slow ? (
        <p className="mt-6 text-subheadline text-muted">
          Taking long? <TextLink href={`/signin?returnTo=${encodeURIComponent(setupUrl(token, "claim"))}`}>Sign in again</TextLink>
        </p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- the guide

const GUIDE_TITLES: Record<GuideStep, string> = { remote: "Remote access", email: "Email", ai: "Foli AI", backups: "Backups", invite: "People", apps: "Apps" };

function GuideFrame({ step, title, lede, children, error, primary, onSkip, skipLabel = "Skip for now" }: { step: GuideStep; title: string; lede: ReactNode; children: ReactNode; error?: string | null; primary: ReactNode; onSkip?: () => void; skipLabel?: string }) {
  return (
    <>
      <StepDots at={GUIDE.indexOf(step)} of={GUIDE.length} label={GUIDE_TITLES[step]} />
      <AuthHeading title={title} lede={lede} />
      <div className="space-y-4">
        {children}
        {error ? <Alert>{error}</Alert> : null}
      </div>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        {onSkip ? (
          <button type="button" onClick={onSkip} className="ui-btn ui-btn-quiet h-11 px-4 text-body">
            {skipLabel}
          </button>
        ) : (
          <span />
        )}
        <div className="flex flex-col gap-2 sm:flex-row">{primary}</div>
      </div>
    </>
  );
}

function PrimaryButton({ children, onClick, busy, disabled }: { children: ReactNode; onClick: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={busy || disabled} aria-busy={busy} className="ui-btn ui-btn-primary h-11 px-6 text-body">
      {busy ? "One moment…" : children}
    </button>
  );
}

type GuideProps = { settings: ServerSettings; next: () => void; mark: (steps: SetupStep[], patch?: ServerSettingsPatch) => Promise<string | null> };

/** Folevi Connect didn't answer: what to do, in words (the technical reason goes to the logs). */
function connectError(e: unknown): string {
  const raw = controlMessage(e);
  console.warn("Folevi Connect:", raw);
  return "Folevi couldn't reach its linking service, so this server isn't linked yet. Check that the NAS is connected to the internet, then try again. Or choose At home only for now and link it later from Remote access in the admin panel.";
}

function RemoteStep({ next, mark }: GuideProps) {
  const [choice, setChoice] = useState<"home" | "connect" | "own">("home");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ code: string; approveUrl: string } | null>(null);
  const done = async () => {
    const err = await mark(["remote"]);
    if (err) setError(err);
    else next();
  };
  if (link) {
    return (
      <GuideFrame
        step="remote"
        title="Approve the link"
        lede="Open the page below, sign in to your Folevi account and approve this code. Then come back here."
        error={error}
        primary={<PrimaryButton onClick={() => void done()}>I approved it</PrimaryButton>}
        onSkip={() => void done()}
        skipLabel="Finish this later"
      >
        <p className="rounded-control bg-[var(--glass-hover)] p-4 text-center font-mono text-title-2 tracking-widest text-heading">{link.code}</p>
        <a href={link.approveUrl} target="_blank" rel="noopener noreferrer" className="ui-btn ui-btn-secondary h-11 w-full text-body">
          Open the approval page
        </a>
      </GuideFrame>
    );
  }
  return (
    <GuideFrame
      step="remote"
      title="Where will you use Folevi?"
      lede="At home it works right away. To use it on your phone when you're out, link the server to a Folevi account: no router settings needed."
      error={error}
      onSkip={() => void done()}
      primary={
        <PrimaryButton
          busy={busy}
          onClick={async () => {
            setError(null);
            if (choice !== "connect") return void done();
            setBusy(true);
            try {
              await control("PUT", "remote", { connectEnabled: true, relayEnabled: true });
              setLink(await control<{ code: string; approveUrl: string }>("POST", "connect/link"));
            } catch (e) {
              setError(connectError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Continue
        </PrimaryButton>
      }
    >
      <ChoiceCards
        label="Where you'll use Folevi"
        value={choice}
        onChange={setChoice}
        choices={[
          { value: "home", icon: House, title: "At home only, for now", body: "Works on your home Wi-Fi with nothing to set up. You can add the rest later." },
          { value: "connect", icon: Globe, title: "At home and away", tag: "Recommended", body: "Link to your Folevi account for a secure address that works anywhere. Folevi can't read your notes." },
          { value: "own", icon: Wifi, title: "My own domain or VPN", body: "Your NAS's reverse proxy, Tailscale or Cloudflare Tunnel. Guides are in the admin panel under Remote access." },
        ]}
      />
    </GuideFrame>
  );
}

function EmailStep({ settings, next, mark }: GuideProps) {
  const [choice, setChoice] = useState<"off" | "folevi" | "smtp">(settings.email.mode);
  const [preset, setPreset] = useState(settings.email.smtp ? presetFor(settings.email.smtp.host).id : "gmail");
  const [address, setAddress] = useState(settings.email.smtp?.username ?? "");
  const [password, setPassword] = useState("");
  const [host, setHost] = useState(settings.email.smtp?.host ?? "");
  const [port, setPort] = useState(String(settings.email.smtp?.port ?? 587));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testState, setTestState] = useState<null | "sending" | "sent" | string>(null);
  const test = useAction(serverAdminRefs.testEmail);
  const p = EMAIL_PRESETS.find((x) => x.id === preset)!;
  const skip = async () => {
    const err = await mark(["email"]);
    if (err) setError(err);
    else next();
  };
  const save = async (): Promise<boolean> => {
    setError(null);
    if (choice === "smtp") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim())) return (setError("Enter the email address to send from."), false);
      if (!password && !settings.email.smtp?.password?.set) return (setError("Enter the password for that email account."), false);
      if (p.id === "other" && !host.trim()) return (setError("Enter your mail service's sending server, like smtp.example.com."), false);
    }
    setBusy(true);
    const patch: ServerSettingsPatch =
      choice === "smtp"
        ? {
            email: {
              mode: "smtp",
              smtp: {
                host: p.id === "other" ? host.trim() : p.host,
                port: p.id === "other" ? Number(port) || 587 : p.port,
                security: p.security,
                username: address.trim(),
                from: `${settings.name} <${address.trim()}>`,
                ...(password ? { password } : {}),
              },
            },
          }
        : { email: { mode: choice } };
    const err = await mark(["email"], patch);
    setBusy(false);
    if (err) return (setError(err), false);
    return true;
  };
  return (
    <GuideFrame
      step="email"
      title="Should the server send email?"
      lede="Email lets people get invites and reset their own passwords. Without it everything still works: you share invite links yourself."
      error={error}
      onSkip={() => void skip()}
      primary={
        <PrimaryButton
          busy={busy}
          onClick={async () => {
            if (choice === "smtp" && saved) return next();
            if (await save()) {
              if (choice === "smtp") setSaved(true);
              else next();
            }
          }}
        >
          {choice === "smtp" && saved ? "Continue" : choice === "smtp" ? "Save" : "Continue"}
        </PrimaryButton>
      }
    >
      <ChoiceCards
        label="How the server sends email"
        value={choice}
        onChange={(v) => (setChoice(v), setSaved(false))}
        choices={[
          { value: "off", icon: MailX, title: "No email for now", body: "Invites by link or QR code. You reset passwords for people from the admin panel." },
          { value: "folevi", icon: Cloud, title: "Folevi Mail", body: "Sent by Folevi for you. Needs the server linked to a Folevi account (Remote access)." },
          { value: "smtp", icon: Mail, title: "My own email account", body: "Gmail, iCloud, Outlook, Fastmail or any other. Mail comes from your address." },
        ]}
      />
      {choice === "smtp" ? (
        <div className="space-y-3 rounded-control p-1">
          <div className="space-y-1.5">
            <span id="email-provider" className="block text-subheadline font-medium text-ink">
              Email service
            </span>
            <Select aria-labelledby="email-provider" value={preset} onChange={(e) => (setPreset(e.target.value), setSaved(false))} className="ui-input h-11 w-full rounded-chip px-4 text-body text-ink">
              {EMAIL_PRESETS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </div>
          <Field label="Send from" type="email" name="smtp-address" inputMode="email" autoComplete="off" value={address} onChange={(e) => (setAddress(e.target.value), setSaved(false))} placeholder="you@gmail.com" />
          <PasswordField label="Password" name="smtp-password" autoComplete="new-password" value={password} onChange={(e) => (setPassword(e.target.value), setSaved(false))} placeholder={settings.email.smtp?.password?.set ? "Saved. Type to replace it" : undefined} hint={p.passwordHint} />
          {p.id === "other" ? (
            <div className="grid grid-cols-[1fr_96px] gap-3">
              <Field label="Sending server" name="smtp-host" autoComplete="off" value={host} onChange={(e) => (setHost(e.target.value), setSaved(false))} placeholder="smtp.example.com" />
              <Field label="Port" name="smtp-port" inputMode="numeric" autoComplete="off" value={port} onChange={(e) => (setPort(e.target.value.replace(/\D/g, "")), setSaved(false))} />
            </div>
          ) : null}
          {saved ? (
            <div className="space-y-2 rounded-control bg-[var(--glass-hover)] p-3 text-subheadline">
              <p className="flex items-center gap-2 font-medium text-heading">
                <Check size={15} aria-hidden /> Saved. Send yourself a test to be sure it works.
              </p>
              <button
                type="button"
                className="ui-btn ui-btn-secondary h-10 px-4 text-subheadline"
                disabled={testState === "sending"}
                onClick={() => {
                  setTestState("sending");
                  test({ to: address.trim() })
                    .then((r) => setTestState(r.ok ? "sent" : (r.error ?? "It didn't send.")))
                    .catch((e: unknown) => setTestState(errorMessage(e)));
                }}
              >
                <Send size={14} aria-hidden /> {testState === "sending" ? "Sending…" : `Send a test to ${address.trim()}`}
              </button>
              {testState === "sent" ? <Alert tone="success">Sent. Check the inbox (and the spam folder) in a minute.</Alert> : testState && testState !== "sending" ? <Alert>{`It didn't send. ${/[.!?]$/.test(testState.trim()) ? testState.trim() : `${testState.trim()}.`} Check the address and password, then save again.`}</Alert> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </GuideFrame>
  );
}

function AiStep({ settings, next, mark }: GuideProps) {
  const [choice, setChoice] = useState<"off" | "folevi" | "gemini" | "local">(settings.ai.mode === "openai" ? "local" : settings.ai.mode);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async (patch?: ServerSettingsPatch) => {
    setBusy(true);
    const err = await mark(["ai"], patch);
    setBusy(false);
    if (err) setError(err);
    else next();
  };
  return (
    <GuideFrame
      step="ai"
      title="Turn on Foli AI?"
      lede="Foli AI answers questions about your notes, summarizes and helps you write. Off, it's hidden for everyone."
      error={error}
      onSkip={() => void go()}
      primary={
        <PrimaryButton
          busy={busy}
          onClick={() => {
            setError(null);
            if (choice === "gemini") {
              if (!key.trim()) return setError("Paste your Gemini API key, or choose another option.");
              return void go({ ai: { mode: "gemini", gemini: { apiKey: key.trim() } } });
            }
            if (choice === "local") return void go();
            void go({ ai: { mode: choice } });
          }}
        >
          Continue
        </PrimaryButton>
      }
    >
      <ChoiceCards
        label="Foli AI"
        value={choice}
        onChange={setChoice}
        choices={[
          { value: "off", icon: EyeOff, title: "Not now", body: "Foli AI stays hidden. You can turn it on any time." },
          { value: "folevi", icon: Sparkles, title: "Folevi AI", body: "Works once the server is linked to a Folevi account. Usage counts toward that account's plan." },
          { value: "gemini", icon: KeyRound, title: "My own Gemini key", body: "Free to start at aistudio.google.com. You pay Google for what you use." },
          { value: "local", icon: Cpu, title: "A model on my own computer", body: "Ollama, LM Studio or another service. Set it up later in the admin panel under Foli AI." },
        ]}
      />
      {choice === "gemini" ? <PasswordField label="Gemini API key" name="gemini-key" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} hint="Stays on this server. Nobody can read it back, including you." /> : null}
    </GuideFrame>
  );
}

function BackupsStep({ next, mark }: GuideProps) {
  const [list, setList] = useState<BackupList | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    control<BackupList>("GET", "backups").then(setList, () => undefined);
    control<{ key: string }>("GET", "backups/key").then(
      (r) => setKey(r.key),
      (e: unknown) => setError(`The backup key couldn't be loaded (${controlMessage(e)}). You can save it later from Backups in the admin panel.`),
    );
  }, []);
  const s = list?.schedule;
  const hour = s ? `${String(s.hour).padStart(2, "0")}:00` : "03:00";
  return (
    <GuideFrame
      step="backups"
      title="Backups are on"
      lede={
        s && !s.enabled
          ? "Nightly backups are off. Turn them on in the admin panel under Backups."
          : `Every night at ${hour}, Folevi backs up every note, file and setting, and keeps the last ${s?.keep ?? 14}. It also backs up before each update.`
      }
      error={error}
      onSkip={() => {
        void mark(["backups"]).then((err) => (err ? setError(err) : next()));
      }}
      skipLabel="Save the key later"
      primary={
        <PrimaryButton
          busy={busy}
          disabled={Boolean(key) && !saved}
          onClick={async () => {
            setBusy(true);
            const err = await mark(key ? ["backups", "backupKey"] : ["backups"]);
            setBusy(false);
            if (err) setError(err);
            else next();
          }}
        >
          Continue
        </PrimaryButton>
      }
    >
      <div className="space-y-3 rounded-control bg-[var(--glass-hover)] p-4">
        <p className="flex items-center gap-2 text-body font-semibold text-heading">
          <KeyRound size={16} aria-hidden /> Save your backup key
        </p>
        <p className="text-subheadline text-ink">Backups are locked with this key. If this machine breaks, you need it to restore them on a new one. Keep it somewhere other than this NAS, like a password manager or a printout.</p>
        <div className="flex items-center gap-2 rounded-chip bg-surface p-2.5 shadow-[0_0_0_1px_var(--color-line)]">
          <code className="min-w-0 flex-1 truncate font-mono text-footnote text-heading" aria-label="Backup key">
            {key ? (shown ? key : `${key.slice(0, 15)}${"•".repeat(24)}`) : "Loading…"}
          </code>
          <button type="button" className="ui-btn ui-btn-quiet h-8 w-8 flex-none" aria-label={shown ? "Hide the key" : "Show the key"} title={shown ? "Hide the key" : "Show the key"} disabled={!key} onClick={() => setShown((v) => !v)}>
            {shown ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="ui-btn ui-btn-secondary h-9 px-4 text-subheadline"
            disabled={!key}
            onClick={() =>
              key &&
              void navigator.clipboard.writeText(key).then(
                () => (setCopied(true), window.setTimeout(() => setCopied(false), 2000)),
                () => setShown(true),
              )
            }
          >
            {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" className="ui-btn ui-btn-secondary h-9 px-4 text-subheadline" disabled={!key} onClick={() => key && downloadKey(key)}>
            <Download size={14} aria-hidden /> Download as a file
          </button>
        </div>
        <CheckRow checked={saved} onChange={setSaved} disabled={!key}>
          I saved my backup key somewhere safe
        </CheckRow>
      </div>
    </GuideFrame>
  );
}

/** Saves the backup key as a small text file with a line that says what it is. */
export function downloadKey(key: string) {
  const text = `Folevi Server backup key\n\nYou need this key to restore this server's backups on a new machine.\nKeep it safe and private. Anyone with it and a backup can read that backup.\n\n${key}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "folevi-backup-key.txt";
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A check box in Folevi's own style (never the system's). */
export function CheckRow({ checked, onChange, disabled, children }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2.5 rounded-chip px-1 py-1.5 text-left text-subheadline font-medium text-heading transition-colors hover:bg-[var(--glass-hover)] disabled:opacity-50"
    >
      <span aria-hidden className={`grid size-5 flex-none place-items-center rounded-chip transition-colors ${checked ? "bg-heading text-canvas" : "bg-surface shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]"}`}>
        {checked ? <Check size={13} strokeWidth={3} /> : null}
      </span>
      {children}
    </button>
  );
}

function InviteStep({ settings, next, mark }: GuideProps) {
  const invite = useMutation(serverAdminRefs.invite);
  const [role, setRole] = useState<InvitableRole>("member");
  const [made, setMade] = useState<{ url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finish = async () => {
    const err = await mark(["invite"]);
    if (err) setError(err);
    else next();
  };
  return (
    <GuideFrame
      step="invite"
      title="Invite your people"
      lede={`Make an invite link for someone to join ${settings.name}. They open it on their phone or computer and create their own account. Each link works once.`}
      error={error}
      onSkip={made ? undefined : () => void finish()}
      primary={
        made ? (
          <>
            <button type="button" className="ui-btn ui-btn-secondary h-11 px-4 text-body" onClick={() => setMade(null)}>
              <UserPlus size={16} aria-hidden /> Another invite
            </button>
            <PrimaryButton onClick={() => void finish()}>Continue</PrimaryButton>
          </>
        ) : (
          <PrimaryButton
            busy={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              invite({ role })
                .then((r) => setMade({ url: r.url }))
                .catch((e: unknown) => setError(errorMessage(e)))
                .finally(() => setBusy(false));
            }}
          >
            Make an invite link
          </PrimaryButton>
        )
      }
    >
      {made ? (
        <div className="flex flex-col items-center gap-4">
          <QrCode value={made.url} label="QR code of the invite link" />
          <p className="text-center text-subheadline text-muted">Let them scan this with their phone&apos;s camera, or send them the link.</p>
          <div className="w-full">
            <ShareLink value={made.url} label="Invite link" copyLabel="Copy invite link" shareTitle={`Join ${settings.name} on Folevi`} shareText={`Join ${settings.name} on Folevi:`} qrFileName="folevi-invite.png" />
          </div>
        </div>
      ) : (
        <ChoiceCards
          label="What they can do"
          value={role}
          onChange={setRole}
          choices={[
            { value: "member", icon: UserPlus, title: "Member", body: "Uses Folevi fully: notes, tasks, sharing.", tag: "Most people" },
            { value: "admin", icon: Building2, title: "Admin", body: "Also manages people, sign-in, email and Foli AI." },
          ]}
        />
      )}
    </GuideFrame>
  );
}

function AppsStep({ settings, mark }: GuideProps) {
  const [busy, setBusy] = useState<null | "admin" | "write">(null);
  const go = (where: "admin" | "write") => {
    setBusy(where);
    void mark(["apps"]).finally(() => window.location.assign(where === "admin" ? "/admin" : "/documents"));
  };
  return (
    <GuideFrame
      step="apps"
      title="Connect your apps"
      lede={`${settings.name} is ready. Add it in Folevi on your Mac, iPhone, iPad or Android, and share these steps with the people you invited.`}
      primary={
        <>
          <button type="button" className="ui-btn ui-btn-secondary h-11 px-4 text-body" disabled={busy !== null} onClick={() => go("admin")}>
            Open the admin panel
          </button>
          <PrimaryButton busy={busy === "write"} disabled={busy !== null} onClick={() => go("write")}>
            Start writing
          </PrimaryButton>
        </>
      }
    >
      <ConnectApps serverName={settings.name} remoteHref="/admin/remote" stacked />
    </GuideFrame>
  );
}

function Guide({ step, token }: { step: GuideStep; token: string }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const settings = useQuery(serverAdminRefs.getSettings, isAuthenticated ? {} : "skip") as ServerSettings | undefined;
  const update = useMutation(serverAdminRefs.updateSettings);
  const [at, setAt] = useState<GuideStep>(step);
  useEffect(() => {
    const url = setupUrl(token, at);
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, "", url);
    window.scrollTo({ top: 0 });
  }, [at, token]);
  if (!isLoading && !isAuthenticated) {
    return (
      <>
        <AuthHeading title="Sign in to keep going" lede="Sign in with the owner's account to finish setting up the server." />
        <a href={`/signin?returnTo=${encodeURIComponent(setupUrl(token, at))}`} className="ui-btn ui-btn-primary h-11 w-full text-body">
          Sign in
        </a>
      </>
    );
  }
  if (!settings) return <AuthHeading title="One moment…" />;
  const mark = async (steps: SetupStep[], patch?: ServerSettingsPatch): Promise<string | null> => {
    try {
      await update({ patch: { ...(patch ?? {}), setup: { done: steps } } });
      return null;
    } catch (e) {
      return errorMessage(e);
    }
  };
  const next = () => setAt(GUIDE[Math.min(GUIDE.indexOf(at) + 1, GUIDE.length - 1)]!);
  const props: GuideProps = { settings, next, mark };
  switch (at) {
    case "remote":
      return <RemoteStep {...props} />;
    case "email":
      return <EmailStep {...props} />;
    case "ai":
      return <AiStep {...props} />;
    case "backups":
      return <BackupsStep {...props} />;
    case "invite":
      return <InviteStep {...props} />;
    case "apps":
      return <AppsStep {...props} />;
  }
}

function Ready({ onNext }: { onNext: () => void }) {
  return (
    <>
      <span className="mb-4 grid size-11 place-items-center rounded-container bg-heading text-canvas" aria-hidden>
        <Check size={22} strokeWidth={2.5} />
      </span>
      <AuthHeading title="Your server is ready" lede="You're its owner, and Folevi works now. A few quick choices make it work everywhere. Each one has a sensible default, so you can skip any of them." />
      <ul className="mb-6 space-y-1.5 text-subheadline text-ink">
        {[
          { icon: Globe, text: "Use it away from home" },
          { icon: Mail, text: "Send email" },
          { icon: Sparkles, text: "Turn on Foli AI" },
          { icon: Archive, text: "Save your backup key" },
          { icon: UserPlus, text: "Invite people and connect your apps" },
        ].map((x) => (
          <li key={x.text} className="flex items-center gap-2.5">
            <x.icon size={15} className="text-muted" aria-hidden /> {x.text}
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2">
        <PrimaryButton onClick={onNext}>Let&apos;s go</PrimaryButton>
        <a href="/documents" className="ui-btn ui-btn-quiet h-11 text-body">
          Skip all and start writing
        </a>
      </div>
    </>
  );
}

export function SetupFlow({ token, signedIn, needsSetup, initialStep }: { token: string; signedIn: boolean; needsSetup: boolean; initialStep: Step | "ready" | null }) {
  const [step, setStep] = useState<Step | "ready">(() => initialStep ?? "name");
  const guide = step === "ready" || GUIDE.includes(step as GuideStep);
  // After setup, the guide stays open to the owner (the admin Overview's checklist links back into it).
  if (!needsSetup && !guide) {
    return (
      <>
        <AuthHeading title="This server is set up" lede="It already has an owner. Sign in to use it, or ask its owner for an invite." />
        <a href={signedIn ? "/documents" : "/signin"} className="ui-btn ui-btn-primary h-11 w-full text-body">
          {signedIn ? "Open Folevi" : "Sign in"}
        </a>
      </>
    );
  }
  if (needsSetup && !token) return <FindSetupLink />;
  if (step === "ready") return <Ready onNext={() => setStep("remote")} />;
  if (guide) {
    return (
      <ConvexClientProvider>
        <Guide step={step as GuideStep} token="" />
      </ConvexClientProvider>
    );
  }
  return (
    <>
      <StepDots at={step === "name" ? 0 : step === "account" ? 1 : 2} of={3} label={step === "name" ? "Name" : step === "account" ? "Your account" : "Owner"} />
      {step === "name" ? (
        <NameStep
          onNext={(name) => {
            try {
              sessionStorage.setItem(NAME_KEY, name);
            } catch {
              /* the name can be set later in the admin panel */
            }
            setStep(signedIn ? "claim" : "account");
          }}
        />
      ) : step === "account" && !signedIn ? (
        <AccountStep token={token} />
      ) : (
        <ConvexClientProvider>
          <Claim
            token={token}
            onDone={() => {
              window.history.replaceState(null, "", setupUrl("", "ready" as Step));
              setStep("ready");
            }}
          />
        </ConvexClientProvider>
      )}
    </>
  );
}

/**
 * A Folevi Server with no owner, opened without its setup link (the NAS's Folevi icon, a bookmark, the sign-in
 * page). The link carries a one-time token that only the NAS shows, so whoever has the NAS becomes the owner.
 */
function FindSetupLink() {
  const places: { name: string; steps: ReactNode }[] = [
    { name: "Synology", steps: <>Open <b>Package Center</b>, click <b>Folevi</b>, then <b>View log</b> (under <b>Action</b>).</> },
    { name: "QNAP", steps: <>Open <b>App Center</b>, click <b>Folevi</b>, then its log, or run <code className="font-mono text-footnote">sudo /etc/init.d/folevi.sh setup-url</code> over SSH.</> },
    { name: "Unraid, TrueNAS and other app stores", steps: <>Open Folevi&apos;s log in the app&apos;s page.</> },
    { name: "Linux server", steps: <>Run <code className="break-all font-mono text-footnote">sudo -u folevi /opt/folevi/bin/folevid setup-url --data /var/lib/folevi --bundle /opt/folevi</code>.</> },
  ];
  return (
    <>
      <StepDots at={0} of={3} label="Welcome" />
      <AuthHeading
        title="Let's set up your server"
        lede="Nobody owns this server yet. To make sure the owner is the person who has the NAS, setting it up starts from a one-time link your NAS shows. It begins with this server's address and /setup?token=."
      />
      <h2 className="text-headline text-heading">Where to find the link</h2>
      <ul className="mt-3 space-y-3">
        {places.map((p) => (
          <li key={p.name} className="rounded-small bg-sunken px-3.5 py-3 text-subheadline leading-relaxed text-muted">
            <span className="block font-medium text-heading">{p.name}</span>
            {p.steps}
          </li>
        ))}
      </ul>
      <p className="mt-5 text-subheadline leading-relaxed text-muted">Open the link in this browser. Then you name the server and create your account; you choose the email and password.</p>
    </>
  );
}
