"use client";

// Folevi Server's first-run page (docs/SELF_HOSTING_PLAN.md §11, "Setup page"): name the server, create the first
// account (a normal sign-up; email isn't set up yet, so no confirmation link), become its owner with the setup
// token folevid printed (server:claimOwner, CONTRACT §7), then choose what to set up next.
import { useEffect, useRef, useState } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { Archive, Globe, Mail, ShieldCheck } from "lucide-react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { ConvexClientProvider } from "@/lib/convex/provider";
import { serverAdminRefs, serverRefs } from "@/lib/server-edition/refs";
import { errorMessage } from "@/components/ui/Toast";
import { AiIcon } from "@/components/ai/AiIcon";
import { Alert, AuthHeading, Field, PasswordField, SubmitButton, TextLink } from "@/components/auth/fields";

type Step = "name" | "account" | "claim" | "choices";
const NAME_KEY = "folevi:setup-name";

function readName(): string {
  try {
    return sessionStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function setupUrl(token: string, step: Step): string {
  return `/setup?token=${encodeURIComponent(token)}&step=${step}`;
}

function StepDots({ step }: { step: Step }) {
  const order: Step[] = ["name", "account", "claim", "choices"];
  const at = order.indexOf(step);
  return (
    <p className="mb-5 flex items-center gap-1.5 text-footnote text-muted" aria-label={`Step ${at + 1} of ${order.length}`}>
      {order.map((s, i) => (
        <span key={s} aria-hidden className={`h-1.5 rounded-chip transition-all ${i <= at ? "w-6 bg-heading" : "w-3 bg-[color-mix(in_oklab,var(--color-ink)_18%,transparent)]"}`} />
      ))}
    </p>
  );
}

function NameStep({ onNext }: { onNext: (name: string) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(readName()), []);
  return (
    <>
      <AuthHeading title="Welcome to Folevi Server" lede="Let's get your server ready. It takes a minute. First, give it a name people will recognize, like your family's or your team's." />
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const value = name.trim();
          if (!value) {
            setError("Give your server a name.");
            return;
          }
          onNext(value.slice(0, 60));
        }}
      >
        <Field label="Server name" name="server-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} error={error} placeholder="Smith family" autoFocus hint="People see it when they sign in. You can change it later." />
        <SubmitButton busy={false}>Continue</SubmitButton>
      </form>
    </>
  );
}

function AccountStep({ token }: { token: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = setupUrl(token, "claim");
  return (
    <>
      <AuthHeading title="Create your account" lede="This is your own account on this server. As the first person here, you'll be its owner." />
      <form
        className="space-y-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setError(null);
          const address = email.trim();
          if (!name.trim()) return setError("Tell us what to call you.");
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return setError("Enter a valid email address.");
          if (password.length < 10) return setError("Use at least 10 characters for your password.");
          setBusy(true);
          const { error: err } = await authClient.signUp.email({ name: name.trim().slice(0, 80), email: address, password, callbackURL: next });
          if (err) {
            setBusy(false);
            setError(authErrorMessage(err, undefined, "a few minutes"));
            return;
          }
          // Email isn't set up yet, so the server signs the new account straight in.
          window.location.assign(next);
        }}
      >
        {error ? <Alert>{error}</Alert> : null}
        <Field label="Your name" name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Field label="Email" type="email" name="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <PasswordField label="Password" name="new-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 10 characters. A few unrelated words make a strong, memorable password." />
        <SubmitButton busy={busy}>Create account</SubmitButton>
      </form>
      <p className="mt-6 text-subheadline text-muted">
        Already made one here? <TextLink href={`/signin?returnTo=${encodeURIComponent(next)}`}>Sign in</TextLink>
      </p>
    </>
  );
}

function Claim({ token, onDone }: { token: string; onDone: () => void }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const claim = useMutation(serverRefs.claimOwner);
  const update = useMutation(serverAdminRefs.updateSettings);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!isAuthenticated || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const r = await claim({ setupToken: token });
        if (!r?.ok) throw new Error("refused");
        const name = readName().trim();
        if (name) await update({ name });
        onDone();
      } catch (e) {
        setError(e instanceof Error && e.message === "refused" ? "This setup link doesn't work any more. The server may already have an owner." : errorMessage(e));
      }
    })();
  }, [claim, isAuthenticated, onDone, token, update]);
  if (error) {
    return (
      <>
        <AuthHeading title="That didn't work" />
        <Alert>{error}</Alert>
        <p className="mt-6 text-subheadline text-muted">
          Get a fresh setup link from your NAS&apos;s Folevi page, or run <code className="font-mono">folevid setup-url</code> on the server. <TextLink href="/documents">Open Folevi</TextLink>
        </p>
      </>
    );
  }
  return (
    <>
      <AuthHeading title="Making you the owner" lede={!isLoading && !isAuthenticated ? "Waiting for your sign-in…" : "One moment…"} />
      <div className="h-1 w-40 overflow-hidden rounded-tiny bg-sunken" aria-hidden>
        <div className="h-full w-1/3 animate-[folio-progress_1.2s_ease-in-out_infinite] rounded-chip bg-heading" />
      </div>
    </>
  );
}

const CHOICES = [
  { href: "/admin/remote", icon: Globe, title: "Reach it from anywhere", body: "Link to your Folevi account for a secure address at home and away, or use your own domain." },
  { href: "/admin/email", icon: Mail, title: "Send email", body: "Invites, password resets and reminders, through Folevi Mail or your own SMTP account." },
  { href: "/admin/ai", icon: AiIcon as unknown as typeof Globe, title: "Turn on Foli AI", body: "Folevi AI, your own key, or a model running on this machine." },
  { href: "/admin/backups", icon: Archive, title: "Back up", body: "Nightly backups to this machine, another folder or S3-compatible storage." },
];

function Choices() {
  return (
    <>
      <AuthHeading title="Your server is ready" lede="You're its owner. Set up the rest now or any time later from the admin panel." />
      <ul className="space-y-2">
        {CHOICES.map((c) => (
          <li key={c.href}>
            <a href={c.href} className="flex items-start gap-3 rounded-control p-3 text-left outline-none transition-colors hover:bg-[var(--glass-hover)] focus-visible:ring-2 focus-visible:ring-focus">
              <span className="grid size-9 flex-none place-items-center rounded-chip bg-[var(--glass-hover)] text-heading">
                <c.icon size={17} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-body font-semibold text-heading">{c.title}</span>
                <span className="block text-subheadline text-muted">{c.body}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <a href="/documents" className="ui-btn ui-btn-primary h-11 flex-1 text-body">
          Start writing
        </a>
        <a href="/admin/people" className="ui-btn ui-btn-secondary h-11 flex-1 text-body">
          <ShieldCheck size={16} aria-hidden /> Invite people
        </a>
      </div>
    </>
  );
}

export function SetupFlow({ token, signedIn, needsSetup, initialStep }: { token: string; signedIn: boolean; needsSetup: boolean; initialStep: Step | null }) {
  const [step, setStep] = useState<Step>(() => initialStep ?? "name");
  if (!needsSetup && step !== "choices") {
    return (
      <>
        <AuthHeading title="This server is set up" lede="It already has an owner. Sign in to use it, or ask its owner for an invite." />
        <a href={signedIn ? "/documents" : "/signin"} className="ui-btn ui-btn-primary h-11 w-full text-body">
          {signedIn ? "Open Folevi" : "Sign in"}
        </a>
      </>
    );
  }
  if (!token) {
    return (
      <>
        <AuthHeading title="Open the setup link" lede="Setting up needs the link from your NAS's Folevi page. On a Linux server, run folevid setup-url to see it." />
      </>
    );
  }
  return (
    <>
      <StepDots step={step} />
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
      ) : step === "account" ? (
        signedIn ? (
          <Claimer token={token} onDone={() => setStep("choices")} />
        ) : (
          <AccountStep token={token} />
        )
      ) : step === "claim" ? (
        <Claimer token={token} onDone={() => setStep("choices")} />
      ) : (
        <Choices />
      )}
    </>
  );
}

function Claimer({ token, onDone }: { token: string; onDone: () => void }) {
  return (
    <ConvexClientProvider>
      <Claim token={token} onDone={onDone} />
    </ConvexClientProvider>
  );
}
