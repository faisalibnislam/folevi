"use client";

import { useEffect, useId, useState } from "react";
import { Check, KeyRound, LockKeyhole, ScrollText } from "lucide-react";
import type { WireScope } from "@folevi/editor-schema";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { desktop } from "@/lib/desktop";
import { copy, type LevelId } from "@/lib/e2ee/copy";
import { getKeySession, useKeySession } from "@/lib/e2ee/keys";
import { FULL_SWITCHES, useE2eeActions } from "./hooks";

type Recheck = "passphrase" | "recoveryKey" | "passkey";

/**
 * Choosing a lower level (§10.11). To Standard needs one recovery method again (the server checks it was
 * opened in the last 10 minutes); the other two changes make nothing readable, so they only confirm.
 */
export function LowerLevelDialog({ open, onClose, scope, to, onDone }: { open: boolean; onClose: () => void; scope: WireScope; to: LevelId; onDone?: () => void }) {
  const c = copy.lower;
  const toast = useToast();
  const { methods } = useKeySession();
  const [wrapId, setWrapId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const actions = useE2eeActions();
  useEffect(() => {
    if (open) setWrapId(null);
  }, [open]);
  // Every lowering proves a recovery method again (the server checks it for "selected" too); raising to Fully
  // encrypted makes nothing readable, so it only confirms.
  const lowering = to !== "full";
  const title = to === "standard" ? c.standardTitle : to === "selected" ? c.toSelectedTitle : c.toFullTitle;
  const body = to === "standard" ? c.standardBody : to === "selected" ? c.toSelectedBody : c.toFullBody;
  const apply = async () => {
    setBusy(true);
    try {
      if (to === "full") await actions.enable(scope, "full", FULL_SWITCHES);
      else await actions.lower(scope, to, wrapId ?? "");
      toast.show(to === "standard" ? c.turningOff : c.changed(copy.privacy.levels[to].title), { tone: "success" });
      onDone?.();
      onClose();
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const kinds = new Set(methods.map((m) => m.kind));
  const options: Recheck[] = (["passphrase", "recoveryKey", "passkey"] as const).filter((k) => kinds.has(k) && !(k === "passkey" && desktop() !== null));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={body}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{copy.wizard.cancel}</Button>
          <Button variant={to === "standard" ? "danger" : "primary"} disabled={busy || (lowering && !wrapId)} aria-busy={busy || undefined} onClick={() => void apply()}>
            {to === "standard" ? c.standardButton : c.change}
          </Button>
        </>
      }
    >
      {lowering ? (
        wrapId ? (
          <p role="status" className="flex items-center gap-2 text-sm font-medium text-heading">
            <Check size={15} aria-hidden /> {c.confirmed}
          </p>
        ) : (
          <RecheckForm options={options} onConfirmed={setWrapId} />
        )
      ) : null}
    </Dialog>
  );
}

function RecheckForm({ options, onConfirmed }: { options: Recheck[]; onConfirmed: (wrapId: string) => void }) {
  const u = copy.unlock;
  const uid = useId();
  const [kind, setKind] = useState<Recheck | null>(options.length === 1 && options[0] !== "passkey" ? options[0]! : null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async (k: Recheck, input: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await recheck(k, input);
      if (r.ok) return onConfirmed(r.wrapId);
      setError(
        r.reason === "rate_limited" ? u.rateLimited : r.reason === "bad_format" ? u.badFormat : r.reason === "unsupported" ? u.passkeyUnsupported : r.reason === "cancelled" ? u.passkeyCancelled : k === "passphrase" ? u.wrongPassphrase : u.wrongRecovery,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const label: Record<Recheck, string> = { passphrase: u.passphrase, recoveryKey: u.recoveryKey, passkey: u.passkey };
  const icon: Record<Recheck, React.ReactNode> = { passphrase: <LockKeyhole size={14} aria-hidden />, recoveryKey: <ScrollText size={14} aria-hidden />, passkey: <KeyRound size={14} aria-hidden /> };
  return (
    <div className="space-y-3 text-sm">
      <p className="font-medium text-heading">{copy.lower.recheck}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((k) => (
          <Button
            key={k}
            size="sm"
            aria-pressed={kind === k}
            className={kind === k ? "ring-2 ring-heading" : ""}
            onClick={() => {
              setValue("");
              setError(null);
              if (k === "passkey") void check("passkey", "");
              else setKind(k);
            }}
          >
            {icon[k]} {label[k]}
          </Button>
        ))}
      </div>
      {kind && kind !== "passkey" ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim() && !busy) void check(kind, kind === "passphrase" ? value.normalize("NFC") : value);
          }}
        >
          <label htmlFor={`${uid}-secret`} className="block font-medium text-heading">
            {kind === "passphrase" ? u.passphraseField : u.recoveryField}
          </label>
          <div className="flex gap-2">
            <input
              id={`${uid}-secret`}
              type={kind === "passphrase" ? "password" : "text"}
              autoComplete={kind === "passphrase" ? "current-password" : "off"}
              spellCheck={false}
              autoFocus
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${uid}-error` : undefined}
              className={`ui-input h-9 min-w-0 flex-1 rounded-control px-3 text-sm pointer-coarse:h-11 ${kind === "recoveryKey" ? "font-mono uppercase" : ""}`}
            />
            <Button type="submit" disabled={!value.trim() || busy} aria-busy={busy || undefined}>
              {busy ? u.unlocking : u.unlock}
            </Button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p id={`${uid}-error`} role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Proves a recovery method again before lowering (§5.3 `lower`): WP6's unlock calls re-check while unlocked,
 * and the session keeps the wrap it opened (`recheckedWrapId`).
 */
async function recheck(kind: Recheck, input: string): Promise<{ ok: true; wrapId: string } | { ok: false; reason: "wrong" | "bad_format" | "rate_limited" | "cancelled" | "unsupported" }> {
  const session = getKeySession();
  const r = kind === "passphrase" ? await session.unlockWithPassphrase(input) : kind === "recoveryKey" ? await session.unlockWithRecoveryKey(input) : await session.unlockWithPasskey();
  const wrapId = (session as { recheckedWrapId?: () => string | null }).recheckedWrapId?.() ?? null;
  return r === "ok" && wrapId ? { ok: true, wrapId } : { ok: false, reason: r === "ok" ? "wrong" : r };
}
