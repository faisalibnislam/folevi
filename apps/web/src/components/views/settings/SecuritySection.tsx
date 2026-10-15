"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { defaultPasskeyName, passkeysAvailable } from "@/lib/auth/passkeys";
import { desktop } from "@/lib/desktop";
import { ageText, formatDateTime } from "@/lib/format";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { useToast } from "@/components/ui/Toast";
import { signOutNow } from "@/components/auth/SignOut";
import { Alert, PasswordField } from "@/components/auth/fields";
import { BackupCodes, TotpEnrollment } from "@/components/auth/TwoFactor";
import { Card } from "./Card";
import { DeleteAccountCard } from "./DeleteAccountCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { nativeApp } from "@/lib/nativeApp";

/** Asks for the current password before showing secrets (backup codes, authenticator key). */
function PasswordGate({
  open,
  title,
  description,
  action,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  action: string;
  onClose: () => void;
  onConfirm: (password: string) => Promise<string | null>;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onClose={() => {
        setPassword("");
        setError(null);
        onClose();
      }}
      title={title}
      description={description}
      size="sm"
    >
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !password) return;
          setBusy(true);
          const problem = await onConfirm(password);
          setBusy(false);
          if (problem) setError(problem);
          else setPassword("");
        }}
      >
        {error ? <Alert>{error}</Alert> : null}
        <PasswordField compact label="Current password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={busy || !password}>
            {action}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function TwoStepCard() {
  const toast = useToast();
  const { data: session, isPending } = authClient.useSession();
  const enabled = (session?.user as { twoFactorEnabled?: boolean | null } | undefined)?.twoFactorEnabled === true;
  const [gate, setGate] = useState<"codes" | "key" | "off" | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  if (isPending) return <Card title="Two-step verification">{null}</Card>;
  if (!enabled) {
    return (
      <Card
        title="Two-step verification"
        description="Optional. When it's on, signing in on a new device needs a code from your authenticator app as well as your password, so a stolen password isn't enough."
      >
        <p className="flex items-center gap-2 text-sm font-medium text-muted">
          <ShieldOff size={16} aria-hidden /> Off
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => window.location.assign(`/two-factor/setup?returnTo=${encodeURIComponent("/settings/security")}`)}>
            Turn on two-step verification
          </Button>
        </div>
      </Card>
    );
  }
  return (
    <Card
      title="Two-step verification"
      description="Folevi asks for a code from your authenticator app every time you sign in on a new device."
    >
      <p className="flex items-center gap-2 text-sm font-medium text-success">
        <ShieldCheck size={16} aria-hidden /> On (authenticator app)
      </p>
      <p className="mt-2 text-xs text-muted">
        When you tick “Trust this device for 30 days” while signing in, that browser skips the code for 30 days. Signing out, revoking the session below, or changing your
        password ends it.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => setGate("key")}>Move to a new authenticator app</Button>
        <Button onClick={() => setGate("codes")}>Get new backup codes</Button>
        <Button onClick={() => setGate("off")}>Turn off</Button>
      </div>
      <PasswordGate
        open={gate === "off"}
        title="Turn off two-step verification?"
        description="Signing in will only need your password. Your authenticator entry and backup codes stop working; you can turn it on again at any time."
        action="Turn off"
        onClose={() => setGate(null)}
        onConfirm={async (password) => {
          const { error } = await authClient.twoFactor.disable({ password });
          if (error) return authErrorMessage(error);
          setGate(null);
          toast.show("Two-step verification is off", { tone: "success" });
          return null;
        }}
      />
      <PasswordGate
        open={gate === "codes"}
        title="New backup codes"
        description="Your old backup codes stop working as soon as new ones are created."
        action="Create new codes"
        onClose={() => setGate(null)}
        onConfirm={async (password) => {
          const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
          if (error || !data) return authErrorMessage(error);
          setGate(null);
          setCodes(data.backupCodes);
          return null;
        }}
      />
      <PasswordGate
        open={gate === "key"}
        title="Move to a new authenticator app"
        description="Shows your authenticator key again so you can add Folevi to another app or phone."
        action="Show my key"
        onClose={() => setGate(null)}
        onConfirm={async (password) => {
          const { data, error } = await authClient.twoFactor.getTotpUri({ password });
          if (error || !data) return authErrorMessage(error);
          setGate(null);
          setTotpUri(data.totpURI);
          return null;
        }}
      />
      <Dialog open={codes !== null} onClose={() => setCodes(null)} title="Save your new backup codes" description="Each code works once. You'll only see these now.">
        {codes ? (
          <BackupCodes
            codes={codes}
            doneLabel="Done"
            onDone={() => {
              setCodes(null);
              toast.show("New backup codes saved", { tone: "success" });
            }}
          />
        ) : null}
      </Dialog>
      <Dialog open={totpUri !== null} onClose={() => setTotpUri(null)} title="Add Folevi to your new authenticator" description="Scan the code or enter the key, then check that the codes match.">
        {totpUri ? <TotpEnrollment totpUri={totpUri} /> : null}
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={() => setTotpUri(null)}>
            Done
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}

type PasskeyRow = { id: string; name?: string | null; createdAt?: string | Date | null; backedUp?: boolean };

/** Settings > Security > Passkeys: sign in with Touch ID, Face ID, Windows Hello, a phone or a security key. */
function PasskeysCard() {
  const toast = useToast();
  const { data, isPending } = authClient.useListPasskeys();
  const passkeys = (data ?? []) as PasskeyRow[];
  // When each last signed you in (recorded by Folevi: Better Auth doesn't keep it).
  const usage = useQuery(api.passkeyUsage.lastUsed, {});
  const lastUsed = useMemo(() => new Map((usage ?? []).map((u) => [u.passkeyId, u.lastUsedAt])), [usage]);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<PasskeyRow | null>(null);
  const [removing, setRemoving] = useState<PasskeyRow | null>(null);
  const [signInAgain, setSignInAgain] = useState(false);
  useEffect(() => {
    void passkeysAvailable().then(setSupported);
  }, []);
  const label = (p: PasskeyRow) => p.name?.trim() || "Passkey";

  return (
    <Card
      title="Passkeys"
      description="Sign in with your fingerprint, face or screen lock instead of typing your password. A passkey only works on Folevi, so it can't be phished or reused."
    >
      <ul className="ui-card divide-y divide-line overflow-hidden rounded-control" aria-label="Your passkeys" aria-busy={isPending || undefined}>
        {isPending ? <li className="px-4 py-3 text-sm text-muted">Loading…</li> : null}
        {!isPending && passkeys.length === 0 ? (
          <li>
            <EmptyState size="inline" icon={KeyRound} title="No passkeys yet" />
          </li>
        ) : null}
        {passkeys.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-3">
            <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-control bg-[var(--glass-hover)] text-heading">
              <KeyRound size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-heading">{label(p)}</span>
              <span className="block text-xs text-muted">
                {p.createdAt ? `Added ${formatDateTime(new Date(p.createdAt).getTime())}` : "Added earlier"}
                {p.backedUp ? " · syncs across your devices" : " · on one device"}
                {usage === undefined ? "" : lastUsed.has(p.id) ? ` · Last used ${ageText(lastUsed.get(p.id)!).toLowerCase()}` : " · Not used yet"}
              </span>
            </span>
            <Button size="sm" aria-label={`Rename ${label(p)}`} onClick={() => setRenaming(p)}>
              Rename
            </Button>
            <Button size="sm" aria-label={`Remove ${label(p)}`} onClick={() => setRemoving(p)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      {supported === false ? (
        <p className="mt-3 text-sm text-muted">
          {nativeApp()
            ? "The iPhone and iPad app can't use passkeys yet. Add one in your browser and sign in there with it."
            : desktop()
              ? `The ${desktop()?.platform === "windows" ? "Windows" : "Mac"} app can't use passkeys yet. Add one in your browser and sign in there with it.`
              : "This browser can't create passkeys. Add one from a browser like Safari, Chrome, Edge or Firefox."}
        </p>
      ) : (
        <Button className="mt-3" variant="primary" disabled={supported !== true} onClick={() => setAdding(true)}>
          Add a passkey
        </Button>
      )}
      <PromptDialog
        open={adding}
        title="Add a passkey"
        label="Name"
        initial={defaultPasskeyName()}
        confirmLabel="Continue"
        onClose={() => setAdding(false)}
        onSubmit={async (name) => {
          const result = await authClient.passkey.addPasskey({ name });
          if (result?.error) {
            if ((result.error as { code?: string }).code === "SESSION_NOT_FRESH") setSignInAgain(true);
            else toast.show(authErrorMessage(result.error), { tone: "error" });
            return;
          }
          toast.show("Passkey added. Next time, choose “Sign in with a passkey”.", { tone: "success" });
        }}
      />
      <PromptDialog
        open={renaming !== null}
        title="Rename passkey"
        label="Name"
        initial={renaming ? label(renaming) : ""}
        onClose={() => setRenaming(null)}
        onSubmit={async (name) => {
          if (!renaming) return;
          const { error } = await authClient.passkey.updatePasskey({ id: renaming.id, name });
          if (error) toast.show(authErrorMessage(error), { tone: "error" });
        }}
      />
      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove this passkey?"
        description={removing ? `“${label(removing)}” stops working for Folevi right away. You can also delete it from your device or password manager.` : undefined}
        size="sm"
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                const target = removing;
                setRemoving(null);
                if (!target) return;
                const { error } = await authClient.passkey.deletePasskey({ id: target.id });
                toast.show(error ? authErrorMessage(error) : "Passkey removed", { tone: error ? "error" : "success" });
              }}
            >
              Remove
            </Button>
          </>
        }
      />
      <Dialog
        open={signInAgain}
        onClose={() => setSignInAgain(false)}
        title="Sign in again to add a passkey"
        description="For your security, adding a passkey needs a sign-in from the last 10 minutes. Sign in again and you'll come back here."
        size="sm"
        footer={
          <>
            <Button onClick={() => setSignInAgain(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void signOutNow(`/signin?returnTo=${encodeURIComponent("/settings/security")}`)}>
              Sign in again
            </Button>
          </>
        }
      />
    </Card>
  );
}

function PasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="Password" description="Changing your password signs you out on every other device.">
      <form
        className="max-w-md space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          if (next.length < 10) return setError("Use at least 10 characters for the new password.");
          if (next !== repeat) return setError("The two new passwords don't match.");
          setBusy(true);
          setError(null);
          const { error: err } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
          setBusy(false);
          if (err) return setError(authErrorMessage(err, undefined, "up to an hour"));
          setCurrent("");
          setNext("");
          setRepeat("");
          toast.show("Password changed. Other devices were signed out.", { tone: "success" });
        }}
      >
        {error ? <Alert>{error}</Alert> : null}
        <PasswordField compact label="Current password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        <PasswordField compact label="New password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} hint="At least 10 characters." />
        <PasswordField compact label="Repeat new password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={busy}>
            Change password
          </Button>
          <a href="/forgot-password" className="text-sm text-accent underline underline-offset-2">
            Forgot your current password?
          </a>
        </div>
      </form>
    </Card>
  );
}

export function SecuritySection() {
  return (
    <>
      <TwoStepCard />
      <PasskeysCard />
      <PasswordCard />
      <DeleteAccountCard />
    </>
  );
}
