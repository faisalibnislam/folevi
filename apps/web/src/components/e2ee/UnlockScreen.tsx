"use client";

import { useId, useState } from "react";
import { ArrowLeft, KeyRound, LockKeyhole, ScrollText, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useRadioGroup } from "@/lib/a11y/radioGroup";
import { copy } from "@/lib/e2ee/copy";
import { getKeySession, inNativeApp, thisDevice } from "@/lib/e2ee/keys";
import { NewDeviceApprovalDialog } from "./ApproveDeviceDialog";
import { NativeGate } from "@/lib/engine/NativeGate";
import type { ApprovalHandle } from "@/lib/e2ee/keys/session";
import { e2eeInfo } from "@/lib/engine/gates";
import { BridgeError } from "@/lib/engine/validate";

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
  const [gateError, setGateError] = useState<{ code: string; message: string } | null>(null);
  // Approving from another device, from the native apps: the request, then the code both devices compare.
  const [approval, setApproval] = useState<{ state: "waiting" | "compare" | "failed"; code: string | null; handle: ApprovalHandle | null } | null>(null);
  const approve = async () => {
    onStart?.();
    setApproval({ state: "waiting", code: null, handle: null });
    try {
      const h = await session.requestApproval();
      setApproval({ state: "waiting", code: null, handle: h });
      void h.code.then((c) => setApproval((a) => (a ? { ...a, state: "compare", code: c } : a)), () => undefined);
      void h.done.then(
        (ok) => (ok ? (setApproval(null), unlocked()) : setApproval((a) => (a ? { ...a, state: "failed" } : a))),
        () => setApproval((a) => (a ? { ...a, state: "failed" } : a)),
      );
    } catch {
      setApproval({ state: "failed", code: null, handle: null });
    }
  };
  // No passkeys in the native apps (Mac, iPhone and iPad, Android): they unlock another way (§6.11).
  const onMac = inNativeApp();
  const unlocked = () => {
    setApproving(false);
    setNote(null);
    setView("trust");
  };
  // The native apps draw this screen themselves (native chrome mode): its ways to unlock, as actions.
  const methods = [...(onMac ? [] : ["passkey"]), "passphrase", "recovery"];
  const fail = (code: string, message: string): never => {
    setGateError({ code, message });
    throw new BridgeError(code, message);
  };
  const native =
    view === "trust" ? (
      <NativeGate
        gate="e2eeTrust"
        title={u.trustTitle}
        e2ee={e2eeInfo({ space: null, spaceName: null, view: "trust", methods })}
        actions={[
          { id: "trustBrowser", label: u.trustBrowser.label, style: "primary", run: async () => { await session.trust("browser"); onDone?.(); } },
          { id: "public", label: u.publicComputer.label, style: "secondary", run: async () => { await session.trust("public"); onDone?.(); } },
        ]}
      />
    ) : (
      <NativeGate
        gate="e2eeLocked"
        title={u.title}
        message={u.body}
        e2ee={e2eeInfo({ space: null, spaceName: null, view, methods, approval: approval?.state ?? null, approvalCode: approval?.code ?? null })}
        error={gateError}
        fields={[
          { id: "passphrase", kind: "secret", label: u.passphraseField, placeholder: "" },
          { id: "recoveryKey", kind: "recoveryKey", label: u.recoveryField, placeholder: u.recoveryPlaceholder },
        ]}
        actions={[
          ...(approval && approval.state !== "failed"
            ? [{ id: "cancelApproval", label: copy.approve.cancel, style: "quiet" as const, run: () => { approval.handle?.cancel(); setApproval(null); } }]
            : [{ id: "approve", label: u.approve, style: "secondary" as const, run: () => approve() }]),
          { id: "passphrase", label: u.passphrase, style: "primary", run: async (v) => {
            onStart?.();
            const r = await session.unlockWithPassphrase((v.passphrase ?? "").normalize("NFC"));
            if (r === "ok") return void (setGateError(null), unlocked());
            fail(r === "rate_limited" ? "rate_limited" : "wrong_secret", r === "rate_limited" ? u.rateLimited : u.wrongPassphrase);
          } },
          { id: "recovery", label: u.recoveryKey, style: "secondary", run: async (v) => {
            onStart?.();
            const r = await session.unlockWithRecoveryKey(v.recoveryKey ?? "");
            if (r === "ok") return void (setGateError(null), unlocked());
            fail(r === "rate_limited" ? "rate_limited" : r === "bad_format" ? "bad_format" : "wrong_secret", r === "rate_limited" ? u.rateLimited : r === "bad_format" ? u.badFormat : u.wrongRecovery);
          } },
          ...(onMac ? [] : [{ id: "passkey", label: u.passkey, style: "secondary" as const, run: async () => {
            onStart?.();
            const r = await session.unlockWithPasskey();
            if (r === "ok") return void (setGateError(null), unlocked());
            fail(r === "unsupported" ? "unsupported" : "cancelled", r === "unsupported" ? u.passkeyUnsupported : u.passkeyCancelled);
          } }]),
        ]}
      />
    );
  return (
    <div className="flex min-h-full w-full items-start justify-center px-4 py-10 sm:items-center sm:py-16">
      {native}
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
            <h1 id="e2ee-unlock-title" className="ui-display mt-4 text-title-1 leading-tight">
              {u.title}
            </h1>
            <p className="mt-2 text-subheadline text-muted">{u.body}</p>
            {view === "choose" ? (
              <div className="mt-6 flex flex-col gap-2">
                <Button
                  variant="primary"
                  className="h-11 w-full justify-center text-body"
                  onClick={() => {
                    onStart?.();
                    setApproving(true);
                  }}
                >
                  <Smartphone size={15} aria-hidden /> {u.approve}
                </Button>
                {onMac ? null : (
                  <Button
                    className="h-11 w-full justify-center text-body"
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
                  className="h-11 w-full justify-center text-body"
                  onClick={() => {
                    onStart?.();
                    setView("passphrase");
                  }}
                >
                  <LockKeyhole size={15} aria-hidden /> {u.passphrase}
                </Button>
                <Button
                  className="h-11 w-full justify-center text-body"
                  onClick={() => {
                    onStart?.();
                    setView("recovery");
                  }}
                >
                  <ScrollText size={15} aria-hidden /> {u.recoveryKey}
                </Button>
                {note ? (
                  <p role="alert" className="mt-1 text-subheadline text-danger">
                    {note}
                  </p>
                ) : null}
                {onMac ? <p className="mt-1 text-subheadline text-muted">{u.passkeyApp(thisDevice())}</p> : null}
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
      <label htmlFor={`${uid}-secret`} className="block text-subheadline font-medium text-heading">
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
        className={`ui-input block h-11 w-full rounded-control px-3 text-callout ${kind === "recovery" ? "font-mono uppercase tracking-[0.06em]" : ""}`}
      />
      {error ? (
        <p id={`${uid}-error`} role="alert" className="text-subheadline text-danger">
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
      <h1 id="e2ee-unlock-title" className="ui-display mt-4 text-title-1 leading-tight">
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
              <span className="block text-subheadline font-medium text-heading">{c.label}</span>
              <span className="mt-0.5 block text-subheadline text-muted">{c.body}</span>
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
