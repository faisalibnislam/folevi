"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, CloudOff, GitMerge, Loader2, RefreshCw } from "lucide-react";
import { useAppState } from "@/lib/app/state";
import { useEngineState, useEngineStatus } from "@/lib/hooks/useEngine";

const LABELS = {
  saved: "Saved",
  saving: "Saving…",
  syncing: "Syncing…",
  offline: "Offline",
  conflict: "Conflict",
  error: "Not saved",
} as const;

/**
 * Honest sync status. "Saved" appears only when every change has been acknowledged by the server.
 * Fixed width so state changes never shift the layout; announced politely only on meaningful changes.
 */
export function SyncStatus({ documentId }: { documentId?: string }) {
  const { engine } = useAppState();
  const state = useEngineState(engine);
  const status = useEngineStatus(engine);
  const pending = state.pending.length + state.inflight.length;
  const conflicts = documentId ? state.conflicts.filter((c) => c.documentId === documentId).length : state.conflicts.length;
  const [open, setOpen] = useState(false);
  const [announce, setAnnounce] = useState("");
  const last = useRef(status);
  useEffect(() => {
    const prev = last.current;
    last.current = status;
    if (status === prev) return;
    if (status === "offline") setAnnounce("You're offline. Changes are saved on this device.");
    else if (status === "conflict") setAnnounce("A change conflicts with an edit made elsewhere. Review it in the document.");
    else if (status === "error") setAnnounce("Some changes could not be saved.");
    else if (status === "saved" && (prev === "offline" || prev === "error" || prev === "conflict")) setAnnounce("All changes saved.");
  }, [status]);

  const dot =
    status === "saved" ? "bg-moss" :
    status === "offline" ? "bg-[var(--color-ink-faint)]" :
    status === "conflict" || status === "error" ? "bg-coral" :
    "bg-ember animate-pulse motion-reduce:animate-none";
  const icon =
    status === "offline" ? <CloudOff size={13} aria-hidden /> :
    status === "conflict" ? <GitMerge size={13} aria-hidden /> :
    status === "error" ? <AlertTriangle size={13} aria-hidden /> :
    status === "saved" ? <Check size={13} aria-hidden className="text-moss-ink" /> :
    <Loader2 size={13} aria-hidden className="animate-spin text-ember-ink motion-reduce:animate-none" />;
  const tone =
    status === "offline" ? "text-warning" :
    status === "conflict" ? "text-plum-ink" :
    status === "error" ? "text-danger" : "text-muted";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Sync status: ${LABELS[status]}${pending ? `, ${pending} change${pending === 1 ? "" : "s"} waiting` : ""}`}
        className={`ui-well inline-flex h-8 w-[7.75rem] items-center justify-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold transition-colors hover:text-heading ${tone}`}
        data-testid="sync-status"
        data-status={status}
      >
        <span className={`h-1.5 w-1.5 flex-none rounded-full ${dot}`} aria-hidden />
        {icon}
        <span>{LABELS[status]}</span>
        {status === "offline" && pending ? <span className="tabular-nums">· {pending}</span> : null}
      </button>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
      {open ? (
        <div role="dialog" aria-label="Sync details" className="ui-pop absolute right-0 z-50 mt-2 w-72 p-4 text-sm animate-[folio-rise_160ms_var(--ease-folio)]">
          <p className="font-semibold text-heading">{LABELS[status]}</p>
          <p className="mt-1 text-muted">
            {status === "saved" && "Every change has been saved to Folevi."}
            {status === "saving" && "Sending your latest changes."}
            {status === "syncing" && "Waiting for the server to confirm your changes."}
            {status === "offline" && `You can keep writing. ${pending} change${pending === 1 ? " is" : "s are"} stored on this device and will sync when you reconnect.`}
            {status === "conflict" && `${conflicts || state.conflicts.length} block${(conflicts || state.conflicts.length) === 1 ? "" : "s"} changed in two places. Both versions are kept — choose which to keep in the document.`}
            {status === "error" &&
              (state.authRequired ? "Your session needs to be refreshed. Sign in again; your changes are kept on this device." : "Some changes were rejected by the server and were not saved.")}
          </p>
          {state.errors.length ? (
            <ul className="mt-2 list-disc pl-5 text-xs text-muted">
              {state.errors.slice(-3).map((e) => (
                <li key={e.opId}>{describeError(e.code)}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex gap-2">
            {status !== "saved" ? (
              <button
                type="button"
                className="ui-btn ui-btn-secondary h-8 px-3 text-xs"
                onClick={() => {
                  engine?.authRefreshed();
                  engine?.scheduleFlush(0);
                }}
              >
                <RefreshCw size={12} aria-hidden /> Retry now
              </button>
            ) : null}
            {state.errors.length ? (
              <button type="button" className="ui-btn ui-btn-quiet h-8 px-3 text-xs" onClick={() => engine?.clearErrors()}>
                Dismiss
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function describeError(code: string): string {
  switch (code) {
    case "invalid_block":
      return "A block had content Folevi couldn't store.";
    case "forbidden":
      return "You no longer have permission to edit this document.";
    case "not_found":
      return "The document was deleted.";
    case "limit_exceeded":
      return "The document reached its size limit.";
    default:
      return `The server rejected a change (${code}).`;
  }
}
