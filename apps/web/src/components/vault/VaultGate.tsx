"use client";
// What the Vault page shows until it's open on this device (docs/VAULT_PLAN.md §9): first-time set-up (passcode, then
// the recovery key), waiting for a custodian, choosing a passcode after one shared the key, unlocking by passcode or
// recovery key, or asking to unlock encryption on this browser first. Nothing of the Vault is drawn before this.
import { useConvex, useMutation } from "convex/react";
import { useEffect, useId, useState } from "react";
import { KeyRound, Lock, ShieldCheck } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { UnlockScreen } from "@/components/e2ee/UnlockScreen";
import { passcodeProblem, vaultSessions, type UnlockResult } from "@/lib/vault/keys";
import { ensureEncryptionAccount, useVaultBinding, useVaultInfo } from "./useVault";

type Info = NonNullable<ReturnType<typeof useVaultInfo>>;

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-panel ui-card px-6 py-7">
      <div className="mb-4 grid h-11 w-11 place-items-center rounded-control bg-sunken text-heading" aria-hidden>
        {icon}
      </div>
      <h2 className="text-title-3 font-semibold text-heading">{title}</h2>
      <div className="mt-2 space-y-4 text-subheadline text-muted">{children}</div>
    </div>
  );
}

function PasscodeField({ label, value, onChange, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-footnote font-medium text-ink">{label}</span>
      <input id={id} type="password" autoComplete="off" autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-full ui-input rounded-chip px-3 text-body text-ink" />
    </label>
  );
}

function resultMessage(r: UnlockResult): string | null {
  if (r.status === "wrong") return "That isn't right. Try again.";
  if (r.status === "locked") return `Too many wrong tries. Try again at ${new Date(r.until).toLocaleTimeString()}.`;
  if (r.status === "notSetUp") return "You don't have this Vault's key yet. A custodian's device shares it when they next open the Vault.";
  return null;
}

/** The Vault's front door. Calls `onOpen` once it's open on this device. */
export function VaultGate({ info, onOpen }: { info: Info; onOpen: () => void }) {
  const encryption = useVaultBinding();
  const convex = useConvex();
  const { profile, scope } = useAppState();
  const create = useMutation(api.vault.create);
  const requestReset = useMutation(api.vaultKeys.requestReset);
  const toast = useToast();
  const [passcode, setPasscode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recovery, setRecovery] = useState("");
  const [mode, setMode] = useState<"passcode" | "recovery">("passcode");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Someone added and waiting: their account's encryption keys must exist for a custodian to share the Vault's key.
  const waiting = info.exists && info.waitingForKey && encryption !== "locked" && encryption !== "unlocking";
  useEffect(() => {
    if (waiting) void ensureEncryptionAccount(convex, profile.id).catch(() => undefined);
  }, [waiting, convex, profile.id]);

  const run = async (fn: () => Promise<UnlockResult | void>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      const msg = r ? resultMessage(r) : null;
      if (msg) setError(msg);
      else if (r?.status === "ok") onOpen();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Encryption on this browser comes first: the Vault's keys are sealed to the account's.
  if (encryption === "locked" || encryption === "unlocking") {
    return (
      <Card icon={<Lock size={20} />} title="Unlock encryption on this browser first">
        <p>The Vault opens with your passcode and your account's encryption keys, which this browser doesn't have yet.</p>
        <UnlockScreen />
      </Card>
    );
  }

  if (!info.exists || info.keyVersion === 0) {
    const problem = passcode ? passcodeProblem(passcode) : null;
    return (
      <Card icon={<ShieldCheck size={20} />} title={info.personal ? "Set up your Vault" : "Set up your team's Vault"}>
        <p>A place for passwords, API keys and sensitive files. It's always end-to-end encrypted, opens with your own passcode, and keeps a record of everything done in it.</p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (problem || passcode !== confirm) return;
            void run(async () => {
              await ensureEncryptionAccount(convex, profile.id);
              const id = info.exists ? info.id : (await create({ scope, client: vaultSessions().info() })).id;
              await vaultSessions().setUp(id, passcode);
            });
          }}
        >
          <PasscodeField label="Choose a passcode" value={passcode} onChange={setPasscode} autoFocus />
          <PasscodeField label="Type it again" value={confirm} onChange={setConfirm} />
          {problem ? <p className="text-footnote text-warning">{problem}</p> : null}
          {confirm && confirm !== passcode ? <p className="text-footnote text-warning">The two don't match.</p> : null}
          {error ? <p role="alert" className="text-footnote text-danger">{error}</p> : null}
          <Button type="submit" variant="primary" disabled={busy || !passcode || Boolean(problem) || passcode !== confirm}>
            {busy ? "Setting up…" : "Set up the Vault"}
          </Button>
        </form>
      </Card>
    );
  }

  if (info.waitingForKey) {
    return (
      <Card icon={<KeyRound size={20} />} title="Waiting for the Vault's key">
        <p>You were added to this Vault. Its key reaches you when a custodian next opens the Vault on one of their devices. Nothing to do here until then.</p>
      </Card>
    );
  }

  if (info.needsPasscode) {
    const problem = passcode ? passcodeProblem(passcode) : null;
    return (
      <Card icon={<KeyRound size={20} />} title="Choose your Vault passcode">
        <p>A custodian shared the Vault's key with you. Choose the passcode you'll open it with. Nobody else knows it, Folevi included.</p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (problem || passcode !== confirm) return;
            void run(async () => {
              await ensureEncryptionAccount(convex, profile.id);
              return await vaultSessions().finishWithPasscode(info.id, passcode);
            });
          }}
        >
          <PasscodeField label="Choose a passcode" value={passcode} onChange={setPasscode} autoFocus />
          <PasscodeField label="Type it again" value={confirm} onChange={setConfirm} />
          {problem ? <p className="text-footnote text-warning">{problem}</p> : null}
          {error ? <p role="alert" className="text-footnote text-danger">{error}</p> : null}
          <Button type="submit" variant="primary" disabled={busy || !passcode || Boolean(problem) || passcode !== confirm}>
            {busy ? "Opening…" : "Set passcode and open"}
          </Button>
        </form>
      </Card>
    );
  }

  return (
    <Card icon={<Lock size={20} />} title="The Vault is locked">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => (mode === "passcode" ? vaultSessions().unlock(info.id, { passcode }) : vaultSessions().changePasscode(info.id, { recoveryText: recovery }, passcode)));
        }}
      >
        {mode === "passcode" ? (
          <PasscodeField label="Passcode" value={passcode} onChange={setPasscode} autoFocus />
        ) : (
          <>
            <label className="block">
              <span className="mb-1 block text-footnote font-medium text-ink">Vault recovery key</span>
              <input autoFocus autoComplete="off" spellCheck={false} value={recovery} onChange={(e) => setRecovery(e.target.value)} className="h-10 w-full ui-input rounded-chip px-3 font-mono text-body text-ink" />
            </label>
            <PasscodeField label="New passcode" value={passcode} onChange={setPasscode} />
          </>
        )}
        {error ? <p role="alert" className="text-footnote text-danger">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={busy || !passcode || (mode === "recovery" && !recovery)}>
            {busy ? "Unlocking…" : mode === "passcode" ? "Unlock" : "Reset passcode and open"}
          </Button>
          <Button type="button" variant="quiet" onClick={() => (setMode(mode === "passcode" ? "recovery" : "passcode"), setError(null))}>
            {mode === "passcode" ? "Forgot your passcode?" : "Use the passcode"}
          </Button>
        </div>
        {mode === "recovery" && !info.personal ? (
          <p className="text-footnote">
            No recovery key?{" "}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() =>
                void requestReset({ vaultId: info.id, client: vaultSessions().info() }).then(
                  () => toast.show("Asked. A custodian's device shares the key with you again when they next open the Vault.", { tone: "success" }),
                  (e) => toast.show(errorMessage(e), { tone: "error" }),
                )
              }
            >
              Ask a custodian
            </button>
          </p>
        ) : null}
      </form>
    </Card>
  );
}
