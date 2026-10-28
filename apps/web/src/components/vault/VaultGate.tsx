"use client";
// What the Vault page shows until it's open on this device (docs/VAULT_PLAN.md §9): first-time set-up (passcode, then
// the recovery key), waiting for a custodian, choosing a passcode after one shared the key, unlocking by passcode or
// recovery key, or asking to unlock encryption on this browser first. Nothing of the Vault is drawn before this.
import { useConvex, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { KeyRound, Lock, ShieldCheck } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { UnlockScreen } from "@/components/e2ee/UnlockScreen";
import { vaultSessions, type UnlockResult } from "@/lib/vault/keys";
import { ensureEncryptionAccount, useVaultBinding, useVaultInfo } from "./useVault";
import { NewPasscode, NOT_A_LOGIN, PasscodeField } from "./PasscodeFields";
import { useBackendMode } from "@/lib/mode";

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

/** Passcodes from before PINs had a letter, or more than 12 digits; a mistyped PIN never does. */
const fromBeforePins = (passcode: string) => /\D/.test(passcode) || passcode.length > 12;

function resultMessage(r: UnlockResult): string | null {
  if (r.status === "wrong") return "That isn't right. Try again.";
  if (r.status === "locked") return `Too many wrong tries. Try again at ${new Date(r.until).toLocaleTimeString()}.`;
  if (r.status === "notSetUp") return "You don't have this Vault's key yet. A custodian's device shares it when they next open the Vault.";
  return null;
}

/** The Vault's front door. Calls `onOpen` once it's open on this device. */
export function VaultGate({ info, onOpen }: { info: Info; onOpen: () => void }) {
  const encryption = useVaultBinding();
  // A library on this device: no account, so no encryption keys to make, and nobody else to ask (docs/MAC_REBUILD_PLAN.md §5.6).
  const local = useBackendMode() === "local";
  const convex = useConvex();
  const { profile, scope } = useAppState();
  const create = useMutation(api.vault.create);
  const requestReset = useMutation(api.vaultKeys.requestReset);
  const toast = useToast();
  const [passcode, setPasscode] = useState("");
  // A new passcode once it's chosen and typed twice (a 6, 8 or 12 digit PIN), else null.
  const [next, setNext] = useState<string | null>(null);
  // A passcode from before PINs that unlocked nothing yet: it proves who's changing it to a PIN.
  const [old, setOld] = useState<string | null>(null);
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
    return (
      <Card icon={<ShieldCheck size={20} />} title={info.personal ? "Set up your Vault" : "Set up your team's Vault"}>
        <p>{local ? "A place for passwords, API keys and sensitive files. It's encrypted on this device with your own passcode, and opens only with it." : "A place for passwords, API keys and sensitive files. It's always end-to-end encrypted, opens with your own passcode, and keeps a record of everything done in it."}</p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!next) return;
            void run(async () => {
              if (!local) await ensureEncryptionAccount(convex, profile.id);
              const id = info.exists ? info.id : (await create({ scope, client: vaultSessions().info() })).id;
              await vaultSessions().setUp(id, next);
            });
          }}
        >
          <NewPasscode onChange={setNext} autoFocus />
          {error ? <p role="alert" className="text-footnote text-danger">{error}</p> : null}
          <Button type="submit" variant="primary" disabled={busy || !next}>
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
    return (
      <Card icon={<KeyRound size={20} />} title="Choose your Vault passcode">
        <p>A custodian shared the Vault's key with you. Choose the passcode you'll open it with. Nobody else knows it, Folevi included.</p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!next) return;
            void run(async () => {
              await ensureEncryptionAccount(convex, profile.id);
              return await vaultSessions().finishWithPasscode(info.id, next);
            });
          }}
        >
          <NewPasscode onChange={setNext} autoFocus />
          {error ? <p role="alert" className="text-footnote text-danger">{error}</p> : null}
          <Button type="submit" variant="primary" disabled={busy || !next}>
            {busy ? "Opening…" : "Set passcode and open"}
          </Button>
        </form>
      </Card>
    );
  }

  if (old !== null) {
    return (
      <Card icon={<KeyRound size={20} />} title="Choose a new passcode">
        <p>Vault passcodes are now a PIN of 6, 8 or 12 digits. Choose yours to open the Vault; your old passcode stops working.</p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!next) return;
            void run(async () => {
              const r = await vaultSessions().changePasscode(info.id, { passcode: old }, next);
              // The old passcode was wrong (or locked out): back to the locked screen to say so.
              if (r.status !== "ok") setOld(null);
              return r;
            });
          }}
        >
          <NewPasscode onChange={setNext} autoFocus label="New passcode" />
          {error ? <p role="alert" className="text-footnote text-danger">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" disabled={busy || !next}>
              {busy ? "Opening…" : "Save passcode and open"}
            </Button>
            <Button type="button" variant="quiet" onClick={() => (setOld(null), setError(null))}>
              Back
            </Button>
          </div>
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
          if (mode === "passcode" && fromBeforePins(passcode)) {
            // A passcode from before PINs: choose a PIN first, then the old one opens the Vault once to switch.
            setOld(passcode);
            setPasscode("");
            setNext(null);
            setError(null);
            return;
          }
          if (mode === "recovery" && !next) return;
          void run(() => (mode === "passcode" ? vaultSessions().unlock(info.id, { passcode }) : vaultSessions().changePasscode(info.id, { recoveryText: recovery }, next!)));
        }}
      >
        {mode === "passcode" ? (
          <PasscodeField label="Passcode" value={passcode} onChange={setPasscode} autoFocus />
        ) : (
          <>
            <label className="block">
              <span className="mb-1 block text-footnote font-medium text-ink">Vault recovery key</span>
              <input autoFocus autoComplete="off" spellCheck={false} {...NOT_A_LOGIN} value={recovery} onChange={(e) => setRecovery(e.target.value)} className="h-10 w-full ui-input rounded-chip px-3 font-mono text-body text-ink" />
            </label>
            <NewPasscode onChange={setNext} label="New passcode" />
          </>
        )}
        {error ? <p role="alert" className="text-footnote text-danger">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={busy || (mode === "passcode" ? !passcode : !recovery || !next)}>
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
