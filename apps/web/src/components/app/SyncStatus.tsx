"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTopLayer } from "@/components/ui/topLayer";
import { useQueries } from "convex/react";
import { AlertTriangle, Check, Cloud, CloudOff, FileText, GitMerge, Loader2, Paperclip, RefreshCw } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { useEngineSelector, useEngineStatus } from "@/lib/hooks/useEngine";
import { usePendingDocs, type PendingDocument } from "@/lib/hooks/usePendingDocs";
import { localDb } from "@/lib/sync/db";
import { t } from "@/i18n";

const LABELS = {
  saved: "Saved",
  saving: "Saving…",
  syncing: "Syncing…",
  offline: "Offline",
  conflict: "Conflict",
  error: "Not saved",
} as const;

const LIST_LIMIT = 6;

/**
 * Honest sync status. "Saved" appears only when every change has been acknowledged by the server.
 * Fixed width so state changes never shift the layout; announced politely only on meaningful changes.
 * The details popover lists which pages still have changes waiting on this device.
 */
export function SyncStatus({ documentId, compact = true, align = "end" }: { documentId?: string; /** Icon only (the default). */ compact?: boolean; /** Which edge the details popover lines up with. */ align?: "start" | "end" }) {
  const { engine } = useAppState();
  // Counts and flags only: it's always on screen, and should re-render when they change, not on every
  // change to the queue.
  const pending = useEngineSelector(engine, (s) => s.pending.length + s.inflight.length);
  const conflicts = useEngineSelector(engine, (s) => (documentId ? s.conflicts.filter((c) => c.documentId === documentId).length : s.conflicts.length));
  const allConflicts = useEngineSelector(engine, (s) => s.conflicts.length);
  const authRequired = useEngineSelector(engine, (s) => s.authRequired);
  const errors = useEngineSelector(engine, (s) => s.errors, sameErrors);
  const status = useEngineStatus(engine);
  const [open, setOpen] = useState(false);
  const [announce, setAnnounce] = useState("");
  const last = useRef(status);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelStyle = useTopLayer(open, panelRef, buttonRef, { align, gap: 8 });
  const panelId = useId();

  useEffect(() => {
    const prev = last.current;
    last.current = status;
    if (status === prev) return;
    if (status === "offline") setAnnounce("You're offline. Changes are saved on this device.");
    else if (status === "conflict") setAnnounce("A change conflicts with an edit made elsewhere. Review it in the document.");
    else if (status === "error") setAnnounce("Some changes could not be saved.");
    else if (status === "saved" && (prev === "offline" || prev === "error" || prev === "conflict")) setAnnounce("All changes saved.");
  }, [status]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const dot =
    status === "saved" ? "bg-moss" :
    status === "offline" ? "bg-[var(--color-ink-faint)]" :
    status === "conflict" || status === "error" ? "bg-coral" :
    "bg-heading animate-pulse motion-reduce:animate-none";
  const icon =
    status === "offline" ? <CloudOff size={13} aria-hidden /> :
    status === "conflict" ? <GitMerge size={13} aria-hidden /> :
    status === "error" ? <AlertTriangle size={13} aria-hidden /> :
    status === "saved" ? <Check size={13} aria-hidden className="text-moss-ink" /> :
    <Loader2 size={13} aria-hidden className="animate-spin text-heading motion-reduce:animate-none" />;
  const tone =
    status === "offline" ? "text-warning" :
    status === "conflict" ? "text-plum-ink" :
    status === "error" ? "text-danger" : "text-muted";
  const conflictCount = conflicts || allConflicts;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t("sync.button.label", { status: LABELS[status], pending })}
        title={compact ? LABELS[status] : undefined}
        className={
          compact
            ? `relative grid h-8 w-8 place-items-center rounded-[6px] transition-colors hover:bg-accent-soft ${tone}`
            : `ui-well inline-flex h-8 w-[7.75rem] items-center justify-center gap-1.5 rounded-[6px] px-2.5 text-[12px] font-semibold transition-colors hover:text-heading ${tone}`
        }
        data-testid="sync-status"
        data-status={status}
      >
        {compact ? (
          <>
            {status === "saved" ? <Cloud size={16} aria-hidden /> : icon}
            <span className={`absolute bottom-[7px] right-[6px] h-2 w-2 rounded-[4px] ring-2 ring-[var(--color-canvas)] ${dot}`} aria-hidden />
            {status === "offline" && pending ? <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-[6px] bg-heading px-1 text-[9.5px] font-bold tabular-nums text-canvas">{pending}</span> : null}
          </>
        ) : (
          <>
            <span className={`h-1.5 w-1.5 flex-none rounded-[4px] ${dot}`} aria-hidden />
            {icon}
            <span>{LABELS[status]}</span>
            {status === "offline" && pending ? <span className="tabular-nums">· {pending}</span> : null}
          </>
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
      {open ? (
        <div ref={panelRef} id={panelId} role="dialog" aria-label="Sync details" popover="manual" style={panelStyle} className={`ui-pop z-[100] border-0 text-ink w-72 max-w-[calc(100vw-2rem)] rounded-[14px] px-4 py-3.5 text-[13px] leading-snug animate-[folio-rise_160ms_var(--ease-folio)]`}>
          <p className="flex items-center gap-2 font-semibold text-heading">
            <span className={`h-2 w-2 flex-none rounded-[4px] ${dot}`} aria-hidden />
            {LABELS[status]}
          </p>
          <p className="mt-1 pl-4 text-muted">
            {status === "saved" && "Every change has been saved to Folevi."}
            {status === "saving" && "Sending your latest changes."}
            {status === "syncing" && "Waiting for the server to confirm your changes."}
            {status === "offline" && t("sync.offline.detail", { count: pending })}
            {status === "conflict" && t("sync.conflict.detail", { count: conflictCount })}
            {status === "error" &&
              (authRequired ? "Your session needs to be refreshed. Sign in again; your changes are kept on this device." : "Some changes were rejected by the server and were not saved.")}
          </p>
          <PendingList onNavigate={() => setOpen(false)} />
          {errors.length ? (
            <ul className="mt-2 list-disc pl-5 text-xs text-muted">
              {errors.slice(-3).map((e) => (
                <li key={e.opId}>{describeError(e.code)}</li>
              ))}
            </ul>
          ) : null}
          {status !== "saved" || errors.length ? (
          <div className="mt-3 flex gap-2 pl-4">
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
            {errors.length ? (
              <button type="button" className="ui-btn ui-btn-quiet h-8 px-3 text-xs" onClick={() => engine?.clearErrors()}>
                Dismiss
              </button>
            ) : null}
          </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Pages with changes still waiting on this device, with a link to each. */
function PendingList({ onNavigate }: { onNavigate: () => void }) {
  const pending = usePendingDocs();
  const titles = useDocumentTitles(pending);
  if (!pending.length) return null;
  const shown = pending.slice(0, LIST_LIMIT);
  return (
    <div className="mt-3 border-t border-line pt-3" data-testid="sync-pending-list">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{t("sync.pending.heading")}</p>
      <ul className="mt-1.5 space-y-0.5">
        {shown.map((p) => {
          const title = titles.get(p.documentId) || (p.isNew ? t("sync.pending.newPage") : t("sync.pending.untitled"));
          return (
            <li key={p.documentId}>
              <AppLink
                href={`/d/${p.documentId}`}
                onClick={onNavigate}
                className="-mx-2 flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-ink transition-colors hover:bg-accent-soft focus-visible:bg-accent-soft"
              >
                <FileText size={14} aria-hidden className="flex-none text-muted" />
                <span className="min-w-0 flex-1 truncate">{title}</span>
                <span className="flex-none text-xs tabular-nums text-muted">
                  {p.changes ? t("sync.pending.changes", { count: p.changes }) : null}
                  {p.uploads ? (
                    <span className="ml-1.5 inline-flex items-center gap-0.5" title={t("sync.pending.uploads", { count: p.uploads })}>
                      <Paperclip size={11} aria-hidden />
                      <span className="sr-only">{t("sync.pending.uploads", { count: p.uploads })}</span>
                      <span aria-hidden>{p.uploads}</span>
                    </span>
                  ) : null}
                </span>
              </AppLink>
            </li>
          );
        })}
      </ul>
      {pending.length > LIST_LIMIT ? <p className="mt-1 text-xs text-muted">{t("sync.pending.more", { count: pending.length - LIST_LIMIT })}</p> : null}
    </div>
  );
}

/**
 * Titles for pending documents: the locally queued title first, then the document metadata
 * subscription (shared with an open document view, so it is already answered offline), then the
 * last-known copy cached on this device.
 */
function useDocumentTitles(pending: PendingDocument[]): Map<string, string> {
  const { profile } = useAppState();
  const ids = useMemo(() => pending.slice(0, LIST_LIMIT).filter((p) => !p.isNew).map((p) => p.documentId), [pending]);
  const key = ids.join(",");
  const requests = useMemo(() => Object.fromEntries(key ? key.split(",").map((id) => [id, { query: api.documents.get, args: { documentId: id } }]) : []), [key]);
  const results = useQueries(requests);
  const [cached, setCached] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    (async () => {
      try {
        const db = await localDb(profile.id);
        const out: Record<string, string> = {};
        for (const id of key.split(",")) {
          const doc = await db.get("documents", id);
          if (doc?.title) out[id] = doc.title;
        }
        if (!cancelled) setCached(out);
      } catch {
        // The local cache is optional here: without it the list shows "Untitled".
        if (!cancelled) setCached({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, profile.id]);
  return useMemo(() => {
    const out = new Map<string, string>();
    for (const p of pending) {
      const meta = results[p.documentId];
      const serverTitle = meta && !(meta instanceof Error) ? (meta as { document: { title: string } } | null)?.document.title : undefined;
      const title = p.localTitle || serverTitle || cached[p.documentId];
      if (title) out.set(p.documentId, title);
    }
    return out;
  }, [pending, results, cached]);
}

/** Surfaced errors compare by what they say: the sync state copies them as it changes. */
function sameErrors(a: readonly { opId: string; code: string }[], b: readonly { opId: string; code: string }[]): boolean {
  return a.length === b.length && a.every((e, i) => e.opId === b[i]!.opId && e.code === b[i]!.code);
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
    case "device_limit":
      return "This device is over your plan's device limit.";
    default:
      return `The server rejected a change (${code}).`;
  }
}
