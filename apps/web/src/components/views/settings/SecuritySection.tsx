"use client";

import { useState } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { Alert, PasswordField } from "@/components/auth/fields";
import { BackupCodes, TotpEnrollment } from "@/components/auth/TwoFactor";
import { Card } from "./Card";
import { DeleteAccountCard } from "./DeleteAccountCard";

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
        <PasswordField label="Current password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
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
        <ShieldCheck size={16} aria-hidden /> On — authenticator app
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
        <PasswordField label="Current password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        <PasswordField label="New password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} hint="At least 10 characters." />
        <PasswordField label="Repeat new password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
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
      <PasswordCard />
      <DeleteAccountCard />
    </>
  );
}
