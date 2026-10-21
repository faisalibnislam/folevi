"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { copy } from "@/lib/e2ee/copy";
import { getKeySession, useApprovals, type ApprovalHandle, type IncomingApproval } from "./__stubs__";

/** "482019" shown as "482 019", in large type, read out digit by digit. */
export function ApprovalCode({ code }: { code: string }) {
  return (
    <p className="my-2 text-center font-mono text-[40px] font-semibold leading-none tracking-[0.12em] text-heading tabular-nums" aria-label={copy.approve.codeLabel(code)}>
      {code.slice(0, 3)} {code.slice(3)}
    </p>
  );
}

/**
 * On the new device (§10.6): waiting for approval, then the code to compare, then done. The request is
 * made when the dialog opens and cancelled when it closes before finishing.
 */
export function NewDeviceApprovalDialog({ open, onClose, onApproved }: { open: boolean; onClose: () => void; onApproved: () => void }) {
  const a = copy.approve;
  const [code, setCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const handle = useRef<ApprovalHandle | null>(null);
  const done = useRef(onApproved);
  done.current = onApproved;
  useEffect(() => {
    if (!open) return;
    let live = true;
    setCode(null);
    setFailed(false);
    void getKeySession()
      .requestApproval()
      .then((h) => {
        if (!live) return h.cancel();
        handle.current = h;
        void h.code.then((c) => live && setCode(c));
        void h.done.then(
          (ok) => {
            if (!live) return;
            if (ok) done.current();
            else setFailed(true);
          },
          () => live && setFailed(true),
        );
      }, () => live && setFailed(true));
    return () => {
      live = false;
      handle.current?.cancel();
      handle.current = null;
    };
  }, [open]);
  return (
    <Dialog open={open} onClose={onClose} title={a.waitingTitle} size="sm" footer={<Button onClick={onClose}>{a.cancel}</Button>}>
      <div className="space-y-3 text-sm" aria-live="polite">
        {failed ? (
          <p role="alert" className="text-danger">
            {a.failed}
          </p>
        ) : code ? (
          <>
            <p className="text-muted">{a.checkCode}</p>
            <ApprovalCode code={code} />
          </>
        ) : (
          <p className="text-muted">{a.waitingBody}</p>
        )}
      </div>
    </Dialog>
  );
}

/**
 * On a trusted device, over whatever is open (§10.6): a new device asks to unlock. The first waiting
 * request is shown; "They don't match" cancels it and says what that may mean.
 */
export function IncomingApprovalHost() {
  const approvals = useApprovals();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // The request on show stays on show until it's closed, even once the server stops listing it (answered,
  // cancelled), so the person can read what happened.
  const [showing, setShowing] = useState<IncomingApproval | null>(null);
  const next = approvals.find((r) => !dismissed.has(r.requestId)) ?? null;
  useEffect(() => {
    if (!showing && next) setShowing(next);
  }, [showing, next]);
  return showing ? (
    <IncomingApprovalDialog
      key={showing.requestId}
      request={showing}
      onClose={() => {
        setDismissed(new Set([...dismissed, showing.requestId]));
        setShowing(null);
      }}
    />
  ) : null;
}

function IncomingApprovalDialog({ request, onClose }: { request: IncomingApproval; onClose: () => void }) {
  const a = copy.approve;
  const toast = useToast();
  const [code, setCode] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void request.start().then((c) => live && setCode(c), () => live && setCancelled(true));
    return () => {
      live = false;
    };
  }, [request]);
  return (
    <Dialog
      open
      onClose={onClose}
      title={a.incomingTitle}
      description={cancelled ? undefined : a.incomingBody(request.label)}
      size="sm"
      footer={
        cancelled ? (
          <Button variant="primary" onClick={onClose}>
            {copy.members.close}
          </Button>
        ) : (
          <>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await request.reject().catch(() => undefined);
                setBusy(false);
                setCancelled(true);
              }}
            >
              {a.noMatch}
            </Button>
            <Button
              variant="primary"
              disabled={!code || busy}
              aria-busy={busy || undefined}
              onClick={async () => {
                setBusy(true);
                try {
                  await request.confirm();
                  toast.show(a.done, { tone: "success" });
                  onClose();
                } catch {
                  toast.show(copy.errors.generic, { tone: "error" });
                } finally {
                  setBusy(false);
                }
              }}
            >
              {a.match}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-2 text-sm" aria-live="polite">
        {cancelled ? (
          <p role="alert" className="text-ink">
            {a.cancelled}
          </p>
        ) : code ? (
          <>
            <ApprovalCode code={code} />
            <p className="text-center text-muted">{a.doTheyMatch}</p>
          </>
        ) : (
          <p className="text-muted">{a.gettingCode}</p>
        )}
      </div>
    </Dialog>
  );
}
