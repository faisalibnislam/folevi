"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Download, KeyRound, ShieldCheck } from "lucide-react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { Alert, AuthHeading, Field, PasswordField, SubmitButton, TextLink, safeReturnTo } from "./fields";

/** Six-digit code input tuned for authenticator apps and password managers. */
function CodeField({ value, onChange, label = "6-digit code", autoFocus = true }: { value: string; onChange: (v: string) => void; label?: string; autoFocus?: boolean }) {
  return (
    <Field
      label={label}
      name="one-time-code"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      required
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      className="text-center font-mono text-[20px] tracking-[0.4em]"
    />
  );
}

function TrustDevice({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 rounded-[6px] bg-sunken px-4 py-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" />
      <span>
        <span className="font-medium text-ink">Trust this device for 30 days</span>
        <span className="block text-xs text-muted">You won&apos;t be asked for a code here again until then. Don&apos;t use this on shared computers.</span>
      </span>
    </label>
  );
}

/** Sign-in step two: a code from the authenticator app, or a one-time backup code. */
export function TwoFactorChallenge({ returnTo }: { returnTo?: string }) {
  const destination = safeReturnTo(returnTo);
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState("");
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-[6px] bg-accent-soft text-accent-soft-ink" aria-hidden>
        <ShieldCheck size={22} />
      </div>
      <AuthHeading
        title="Two-step verification"
        lede={mode === "totp" ? "Enter the 6-digit code from your authenticator app." : "Enter one of the backup codes you saved when you set up two-step verification."}
      />
      <form
        className="space-y-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setError(null);
          if (mode === "totp" && code.length !== 6) return setError("Enter all 6 digits.");
          if (mode === "backup" && backup.trim().length < 6) return setError("Enter a backup code.");
          setBusy(true);
          const { error: err } =
            mode === "totp"
              ? await authClient.twoFactor.verifyTotp({ code, trustDevice: trust })
              : await authClient.twoFactor.verifyBackupCode({ code: backup.trim(), trustDevice: trust });
          if (err) {
            setBusy(false);
            setError(authErrorMessage(err));
            return;
          }
          window.location.assign(destination);
        }}
      >
        {error ? <Alert>{error}</Alert> : null}
        {mode === "totp" ? (
          <CodeField value={code} onChange={setCode} />
        ) : (
          <Field label="Backup code" name="backup-code" autoComplete="off" spellCheck={false} required autoFocus value={backup} onChange={(e) => setBackup(e.target.value)} className="font-mono" />
        )}
        <TrustDevice checked={trust} onChange={setTrust} />
        <SubmitButton busy={busy}>Verify</SubmitButton>
      </form>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <button
          type="button"
          className="font-medium text-accent underline decoration-[color-mix(in_oklab,var(--color-accent)_35%,transparent)] underline-offset-2 hover:decoration-current"
          onClick={() => {
            setError(null);
            setMode(mode === "totp" ? "backup" : "totp");
          }}
        >
          {mode === "totp" ? "Use a backup code instead" : "Use my authenticator app"}
        </button>
        <TextLink href="/signin">Start over</TextLink>
      </div>
    </>
  );
}

function secretFromUri(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

export function BackupCodes({ codes, onDone, doneLabel = "Continue" }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => `Folevi backup codes\nEach code works once. Keep them somewhere safe.\n\n${codes.join("\n")}\n`, [codes]);
  return (
    <div className="space-y-4">
      <ol className="grid grid-cols-2 gap-2 rounded-[6px] bg-sunken p-4 font-mono text-[15px] text-ink" aria-label="Backup codes">
        {codes.map((c) => (
          <li key={c} className="rounded-[6px] bg-surface px-3 py-1.5 text-center shadow-[var(--shadow-hairline)]">
            {c}
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        <button
          type="button"
          className="ui-btn ui-btn-secondary h-10 flex-1 text-sm"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />} {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-secondary h-10 flex-1 text-sm"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = "folevi-backup-codes.txt";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download size={15} aria-hidden /> Download
        </button>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" />
        <span>I saved these codes somewhere safe. Each one works once, and they&apos;re the only way in if I lose my authenticator app.</span>
      </label>
      <button type="button" disabled={!saved} onClick={onDone} className="ui-btn ui-btn-primary h-11 w-full text-[15px]">
        {doneLabel}
      </button>
    </div>
  );
}

/** Scannable QR (rendered on this device, so the secret never goes to a third-party QR service) + manual key. */
export function TotpEnrollment({ totpUri }: { totpUri: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const secret = secretFromUri(totpUri);
  useEffect(() => {
    let alive = true;
    void QRCode.toDataURL(totpUri, { margin: 1, width: 220, errorCorrectionLevel: "M", color: { dark: "#1D1814", light: "#FFFFFF" } }).then((url) => {
      if (alive) setQr(url);
    });
    return () => {
      alive = false;
    };
  }, [totpUri]);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <div className="grid h-[188px] w-[188px] flex-none place-items-center rounded-[6px] bg-white p-3 shadow-[var(--shadow-card)]">
        {/* A locally generated data-URI QR code; next/image adds nothing here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {qr ? <img src={qr} alt="QR code to add Folevi to your authenticator app" width={164} height={164} /> : <span className="text-xs text-muted">Preparing…</span>}
      </div>
      <div className="min-w-0 text-sm">
        <p className="text-muted">Scan with an authenticator app (1Password, Google Authenticator, Authy, Microsoft Authenticator…), or enter this key:</p>
        <p className="mt-2 flex items-center gap-2 rounded-[6px] bg-sunken px-3 py-2">
          <KeyRound size={14} className="flex-none text-muted" aria-hidden />
          <code className="select-all break-all font-mono text-[13px] text-ink" data-testid="totp-secret">
            {groupSecret(secret)}
          </code>
        </p>
        <p className="mt-2 text-xs text-muted">Time-based, 6 digits, every 30 seconds.</p>
      </div>
    </div>
  );
}

/** Optional enrollment (Settings → Security; required before the admin console): confirm password → scan → confirm a code → save backup codes. */
export function TwoFactorSetup({ returnTo }: { returnTo?: string }) {
  const destination = safeReturnTo(returnTo);
  const { data: session, isPending } = authClient.useSession();
  const [step, setStep] = useState<"password" | "scan" | "codes">("password");
  const [password, setPassword] = useState("");
  const [enrollment, setEnrollment] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const user = session?.user as { twoFactorEnabled?: boolean | null; email?: string } | undefined;
  useEffect(() => {
    if (!isPending && !session) window.location.replace(`/signin?returnTo=${encodeURIComponent(destination)}`);
    else if (user?.twoFactorEnabled && step === "password") window.location.replace(destination);
  }, [isPending, session, user?.twoFactorEnabled, destination, step]);

  if (isPending || !session) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <>
      <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-faint" aria-label={`Step ${step === "password" ? 1 : step === "scan" ? 2 : 3} of 3`}>
        {["Confirm", "Scan", "Save codes"].map((label, i) => {
          const active = (step === "password" ? 0 : step === "scan" ? 1 : 2) >= i;
          return (
            <span key={label} className="flex items-center gap-2">
              <span className={`h-1.5 w-8 rounded-full ${active ? "bg-ember" : "bg-sunken"}`} aria-hidden />
              <span className={active ? "text-heading" : ""}>{label}</span>
            </span>
          );
        })}
      </div>
      {step === "password" ? (
        <>
          <AuthHeading
            title="Protect your account"
            lede="Turn on two-step verification so a code from your authenticator app is needed as well as your password. First, confirm your password."
          />
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy || !password) return;
              setBusy(true);
              setError(null);
              const { data, error: err } = await authClient.twoFactor.enable({ password, issuer: "Folevi" });
              setBusy(false);
              if (err || !data) return setError(authErrorMessage(err, "We couldn't start setup. Try again."));
              setEnrollment({ totpURI: data.totpURI, backupCodes: data.backupCodes });
              setPassword("");
              setStep("scan");
            }}
          >
            {error ? <Alert>{error}</Alert> : null}
            <PasswordField label="Password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            <SubmitButton busy={busy}>Continue</SubmitButton>
          </form>
        </>
      ) : null}
      {step === "scan" && enrollment ? (
        <>
          <AuthHeading title="Add Folevi to your authenticator" lede="Then enter the 6-digit code it shows to confirm." />
          <TotpEnrollment totpUri={enrollment.totpURI} />
          <form
            className="mt-6 space-y-4"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              if (code.length !== 6) return setError("Enter all 6 digits.");
              setBusy(true);
              setError(null);
              const { error: err } = await authClient.twoFactor.verifyTotp({ code });
              setBusy(false);
              if (err) return setError(authErrorMessage(err));
              setStep("codes");
            }}
          >
            {error ? <Alert>{error}</Alert> : null}
            <CodeField value={code} onChange={setCode} autoFocus={false} />
            <SubmitButton busy={busy}>Turn on two-step verification</SubmitButton>
          </form>
        </>
      ) : null}
      {step === "codes" && enrollment ? (
        <>
          <AuthHeading title="Save your backup codes" lede="If you lose your phone, a backup code gets you in. You'll only see these once." />
          <BackupCodes codes={enrollment.backupCodes} onDone={() => window.location.assign(destination)} doneLabel="Continue to Folevi" />
        </>
      ) : null}
      {step !== "codes" ? (
        <p className="mt-6 text-sm text-muted">
          <a href={destination} className="font-medium text-accent underline underline-offset-2">
            {step === "password" ? "Not now" : "Cancel"}
          </a>
        </p>
      ) : null}
      <p className="mt-3 text-sm text-muted">
        Signed in as {user?.email}.{" "}
        <button
          type="button"
          className="font-medium text-accent underline underline-offset-2"
          onClick={() => void authClient.signOut().then(() => window.location.assign("/signin"))}
        >
          Sign out
        </button>
      </p>
    </>
  );
}
