"use client";
// The Vault's first step on a device without the account's encryption keys: the ways to unlock, in the Vault's own
// card (no card inside a card), then straight on to the Vault passcode. A browser still chooses whether to keep the
// key (it can be shared); the Mac app keeps it (it can be removed in Settings > Devices). The Mac's own Vault draws
// the same step (apps/native-kit/Sources/FoleviMac/Views/Vault/VaultScreen.swift).
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, KeyRound, LockKeyhole, ScrollText, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { copy } from "@/lib/e2ee/copy";
import { getKeySession, inNativeApp, macE2ee, thisDevice } from "@/lib/e2ee/keys";
import type { ApprovalHandle } from "@/lib/e2ee/keys/session";
import { SecretForm, TrustChoice } from "@/components/e2ee/UnlockScreen";
import { ApprovalCode } from "@/components/e2ee/ApproveDeviceDialog";

type View = "choose" | "passphrase" | "recovery" | "approve" | "trust";

/** How the Vault names this device: "this Mac" in the app, "this browser" on the web. */
export const vaultDevice = () => (inNativeApp() ? thisDevice() : "this browser");

/** The ways to unlock, then (in a browser) the trust choice. `onStart` once a way is started; `onDone` when finished. */
export function VaultEncryptionStep({ onStart, onDone }: { onStart: () => void; onDone: () => void }) {
  const u = copy.unlock;
  const a = copy.approve;
  const app = inNativeApp();
  const [view, setView] = useState<View>("choose");
  const [note, setNote] = useState<string | null>(null);
  const [approval, setApproval] = useState<{ code: string | null; failed: boolean }>({ code: null, failed: false });
  const handle = useRef<ApprovalHandle | null>(null);
  useEffect(() => () => handle.current?.cancel(), []);

  const unlocked = async () => {
    handle.current = null;
    setNote(null);
    if (app) {
      await getKeySession().trust("browser");
      onDone();
    } else setView("trust");
  };
  const approve = async () => {
    onStart();
    setView("approve");
    setApproval({ code: null, failed: false });
    try {
      const h = await getKeySession().requestApproval();
      handle.current = h;
      void h.code.then((code) => handle.current === h && setApproval({ code, failed: false }), () => undefined);
      void h.done.then(
        (ok) => handle.current === h && (ok ? void unlocked() : setApproval({ code: null, failed: true })),
        () => handle.current === h && setApproval({ code: null, failed: true }),
      );
    } catch {
      setApproval({ code: null, failed: true });
    }
  };
  const back = () => {
    handle.current?.cancel();
    handle.current = null;
    setView("choose");
  };

  if (view === "trust") return <TrustChoice onContinue={async (mode) => (await getKeySession().trust(mode), onDone())} />;
  if (view === "passphrase" || view === "recovery") return <SecretForm kind={view} onBack={back} onUnlocked={() => void unlocked()} />;
  if (view === "approve")
    return (
      <div className="space-y-3" aria-live="polite">
        <p className="font-medium text-heading">{a.waitingTitle}</p>
        {approval.failed ? (
          <p role="alert" className="text-danger">
            {a.failed}
          </p>
        ) : approval.code ? (
          <>
            <p>{a.checkCode}</p>
            <ApprovalCode code={approval.code} />
          </>
        ) : (
          <p>{a.waitingBody}</p>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button variant="quiet" onClick={back}>
            <ArrowLeft size={14} aria-hidden /> {u.otherWays}
          </Button>
          {approval.failed ? (
            <Button variant="primary" onClick={() => void approve()}>
              {u.approve}
            </Button>
          ) : null}
        </div>
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      <Button variant="primary" className="h-11 w-full justify-center text-body" onClick={() => void approve()}>
        <Smartphone size={15} aria-hidden /> {u.approve}
      </Button>
      {app ? null : (
        <Button
          className="h-11 w-full justify-center text-body"
          onClick={async () => {
            setNote(null);
            onStart();
            const r = await getKeySession().unlockWithPasskey();
            if (r === "ok") void unlocked();
            else setNote(r === "unsupported" ? u.passkeyUnsupported : u.passkeyCancelled);
          }}
        >
          <KeyRound size={15} aria-hidden /> {u.passkey}
        </Button>
      )}
      <Button className="h-11 w-full justify-center text-body" onClick={() => (onStart(), setView("passphrase"))}>
        <LockKeyhole size={15} aria-hidden /> {u.passphrase}
      </Button>
      <Button className="h-11 w-full justify-center text-body" onClick={() => (onStart(), setView("recovery"))}>
        <ScrollText size={15} aria-hidden /> {u.recoveryKey}
      </Button>
      {note ? (
        <p role="alert" className="mt-1 text-danger">
          {note}
        </p>
      ) : null}
      {app ? <p className="mt-1">{u.passkeyApp(thisDevice())}</p> : null}
    </div>
  );
}

/** Right after unlocking in the Mac app: Touch ID next time instead of the passphrase (Settings has the same switch). */
export function VaultTouchIdOffer() {
  const v = copy.vaultUnlock;
  const bridge = macE2ee();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!bridge?.settings || !bridge.setTouchId) return;
    void bridge.settings().then((s) => setShow(s.available && !s.touchId), () => setShow(false));
  }, [bridge]);
  if (!show) return null;
  return (
    <div className="rounded-control bg-sunken p-3.5">
      <p className="font-medium text-heading">{v.touchIdTitle}</p>
      <p className="mt-0.5">{v.touchIdBody}</p>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const next = await bridge!.setTouchId!(true);
              setShow(!next.touchId);
            } catch {
              // Touch ID was cancelled: the offer stays.
            } finally {
              setBusy(false);
            }
          }}
        >
          {v.touchIdOn}
        </Button>
        <Button size="sm" variant="quiet" onClick={() => setShow(false)}>
          {v.notNow}
        </Button>
      </div>
    </div>
  );
}
