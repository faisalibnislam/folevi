"use client";

import { useId, useState } from "react";
import { ArrowLeft, KeyRound, LockKeyhole, ScrollText, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useRadioGroup } from "@/lib/a11y/radioGroup";
import { desktop } from "@/lib/desktop";
import { copy } from "@/lib/e2ee/copy";
import { getKeySession } from "@/lib/e2ee/keys";
import { NewDeviceApprovalDialog } from "./ApproveDeviceDialog";

type View = "choose" | "passphrase" | "recovery" | "trust";

/**
 * In place of locked content (§10.5): the ways to unlock this browser, then whether to trust it or treat it
 * as a public computer. `onDone` runs once the person has chosen (the gate keeps this screen up until then,
 * even though the notes are already unlocked).
 */
export function UnlockScreen({ onDone, onStart }: { onDone?: () => void; /** The person started a way to unlock (so the screen stays up for the trust choice). */ onStart?: () => void }) {
  const u = copy.unlock;
  const session = getKeySession();
  const [view, setView] = useState<View>("choose");
  const [approving, setApproving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const onMac = desktop() !== null;
  const unlocked = () => {
    setApproving(false);
    setNote(null);
    setView("trust");
  };
  return (
    <div className="flex min-h-full w-full items-start justify-center px-4 py-10 sm:items-center sm:py-16">
      <section aria-labelledby="e2ee-unlock-title" className="ui-card w-full max-w-md rounded-container p-6 sm:p-8">
        <span aria-hidden className="grid h-11 w-11 place-items-center rounded-control bg-heading text-canvas">
          <LockKeyhole size={20} />
        </span>
        {view === "trust" ? (
          <TrustChoice
            onContinue={async (mode) => {
              await session.trust(mode);
              onDone?.();
            }}
          />
        ) : (
          <>
            <h1 id="e2ee-unlock-title" className="ui-display mt-4 text-[26px] leading-tight">
              {u.title}
            </h1>
            <p className="mt-2 text-sm text-muted">{u.body}</p>
            {view === "choose" ? (
              <div className="mt-6 flex flex-col gap-2">
                <Button
                  variant="primary"
                  className="h-11 w-full justify-center text-[14px]"
                  onClick={() => {
                    onStart?.();
                    setApproving(true);
                  }}
                >
                  <Smartphone size={15} aria-hidden /> {u.approve}
                </Button>
                {onMac ? null : (
                  <Button
                    className="h-11 w-full justify-center text-[14px]"
                    onClick={async () => {
                      setNote(null);
                      onStart?.();
                      const r = await session.unlockWithPasskey();
                      if (r === "ok") unlocked();
                      else setNote(r === "unsupported" ? u.passkeyUnsupported : u.passkeyCancelled);
                    }}
                  >
                    <KeyRound size={15} aria-hidden /> {u.passkey}
                  </Button>
                )}
                <Button
                  className="h-11 w-full justify-center text-[14px]"
                  onClick={() => {
                    onStart?.();
                    setView("passphrase");
                  }}
                >
                  <LockKeyhole size={15} aria-hidden /> {u.passphrase}
                </Button>
                <Button
                  className="h-11 w-full justify-center text-[14px]"
                  onClick={() => {
                    onStart?.();
                    setView("recovery");
                  }}
                >
                  <ScrollText size={15} aria-hidden /> {u.recoveryKey}
                </Button>
                {note ? (
                  <p role="alert" className="mt-1 text-[13px] text-danger">
                    {note}
                  </p>
                ) : null}
                {onMac ? <p className="mt-1 text-[13px] text-muted">{u.passkeyMac}</p> : null}
              </div>
            ) : (
              <SecretForm kind={view} onBack={() => setView("choose")} onUnlocked={unlocked} />
            )}
          </>
        )}
      </section>
      <NewDeviceApprovalDialog open={approving} onClose={() => setApproving(false)} onApproved={unlocked} />
    </div>
  );
}

function SecretForm({ kind, onBack, onUnlocked }: { kind: "passphrase" | "recovery"; onBack: () => void; onUnlocked: () => void }) {
  const u = copy.unlock;
  const uid = useId();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = getKeySession();
  return (
    <form
      className="mt-6 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || !value.trim()) return;
        setBusy(true);
        setError(null);
        try {
          if (kind === "passphrase") {
            const r = await session.unlockWithPassphrase(value.normalize("NFC"));
            if (r === "ok") return onUnlocked();
            setError(r === "rate_limited" ? u.rateLimited : u.wrongPassphrase);
          } else {
            const r = await session.unlockWithRecoveryKey(value);
            if (r === "ok") return onUnlocked();
            setError(r === "rate_limited" ? u.rateLimited : r === "bad_format" ? u.badFormat : u.wrongRecovery);
          }
        } catch {
          setError(copy.errors.generic);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor={`${uid}-secret`} className="block text-sm font-medium text-heading">
        {kind === "passphrase" ? u.passphraseField : u.recoveryField}
      </label>
      <input
        id={`${uid}-secret`}
        type={kind === "passphrase" ? "password" : "text"}
        autoComplete={kind === "passphrase" ? "current-password" : "off"}
        autoCapitalize={kind === "recovery" ? "characters" : undefined}
        spellCheck={false}
        autoFocus
        placeholder={kind === "recovery" ? u.recoveryPlaceholder : undefined}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${uid}-error` : undefined}
        className={`ui-input block h-11 w-full rounded-control px-3 text-sm ${kind === "recovery" ? "font-mono uppercase tracking-[0.06em]" : ""}`}
      />
      {error ? (
        <p id={`${uid}-error`} role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2 pt-1">
        <Button variant="quiet" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden /> {u.otherWays}
        </Button>
        <Button type="submit" variant="primary" disabled={!value.trim() || busy} aria-busy={busy || undefined}>
          {busy ? u.unlocking : u.unlock}
        </Button>
      </div>
    </form>
  );
}

/** After unlocking: keep this browser trusted, or forget the key when the tab closes (§10.5, §6.10). */
function TrustChoice({ onContinue }: { onContinue: (mode: "browser" | "public") => Promise<void> }) {
  const u = copy.unlock;
  const [mode, setMode] = useState<"browser" | "public">("browser");
  const [busy, setBusy] = useState(false);
  const group = useRadioGroup();
  return (
    <>
      <h1 id="e2ee-unlock-title" className="ui-display mt-4 text-[26px] leading-tight">
        {u.trustTitle}
      </h1>
      <div role="radiogroup" aria-labelledby="e2ee-unlock-title" ref={group.ref} onKeyDown={group.onKeyDown} className="mt-5 space-y-2">
        {(
          [
            ["browser", u.trustBrowser],
            ["public", u.publicComputer],
          ] as const
        ).map(([id, c]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            onClick={() => setMode(id)}
            className={`flex w-full items-start gap-3 rounded-control border p-3.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus ${mode === id ? "border-heading bg-[var(--glass-active)]" : "border-line hover:bg-[var(--glass-hover)]"}`}
          >
            <span aria-hidden className={`mt-0.5 grid h-4 w-4 flex-none place-items-center rounded-tiny ${mode === id ? "bg-heading" : "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-ink)_35%,transparent)]"}`}>
              {mode === id ? <span className="h-1.5 w-1.5 rounded-tiny bg-canvas" /> : null}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-heading">{c.label}</span>
              <span className="mt-0.5 block text-[13px] text-muted">{c.body}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="mt-6 flex justify-end">
        <Button
          variant="primary"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={async () => {
            setBusy(true);
            try {
              await onContinue(mode);
            } finally {
              setBusy(false);
            }
          }}
        >
          {u.continue}
        </Button>
      </div>
    </>
  );
}
