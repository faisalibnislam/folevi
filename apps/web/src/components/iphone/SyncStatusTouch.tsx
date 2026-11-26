"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, Check, ChevronRight, Cloud, CloudAlert, CloudCheck, CloudOff, FileText, GitMerge, ListTodo, Loader2, RefreshCw } from "lucide-react";
import type { SyncStatus as EngineStatus } from "@folevi/editor-schema";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { useEngineSelector, useEngineStatus } from "@/lib/hooks/useEngine";
import { usePendingDocs } from "@/lib/hooks/usePendingDocs";
import { useLocalNotes } from "@/lib/hooks/useLocalNotes";
import type { Outbox } from "@/lib/sync/outbox";
import { useOutboxEntries } from "@/lib/sync/queryCache";
import { combinedStatus, SYNC_LABELS } from "@/components/app/SyncStatus";
import { t } from "@/i18n";
import { Sheet } from "./Sheet";
import { PillButton } from "./Glass";
import { ageText } from "@/lib/format";
import { useBackendMode } from "@/lib/mode";

/**
 * Sync status for touch (the iPhone and iPad apps): the same state as the web and Mac's cloud button
 * (components/app/SyncStatus.tsx, the sync engine and the outbox), drawn for a finger, with its details in a
 * sheet. Calm by design: synced is a quiet cloud (a check for a moment right after syncing), waiting shows a
 * crossed-out cloud with how many changes are on this device, a refusal a red dot. Never a banner.
 *
 * - `TouchSyncButton`: the button for a screen's top bar (Home's bell pill on iPhone, the sidebar top on iPad).
 * - `NoteSyncButton`: the same for one note, shown in its bar only while that note has changes waiting or
 *   refused (nothing at all when it's synced).
 */

type Status = EngineStatus;

// The same words as the web and Mac's cloud button (owner's pick, 2026-11-25: one set on every screen).
const TITLES: Record<Status, string> = SYNC_LABELS;

function useOutboxStatus(outbox: Outbox | null): ReturnType<Outbox["status"]> {
  return useSyncExternalStore(
    (cb) => (outbox ? outbox.subscribe(cb) : () => undefined),
    () => outbox?.status() ?? "idle",
    () => "idle" as const,
  );
}

const lastSyncedKey = (profileId: string) => `folevi:last-synced:${profileId}`;

function readLastSynced(profileId: string): number | null {
  try {
    const v = Number(localStorage.getItem(lastSyncedKey(profileId)));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Everything the touch status shows, from the engine and the outbox. */
function useTouchSync(documentId?: string) {
  const { engine, outbox, online, profile } = useAppState();
  const queued = useEngineSelector(engine, (s) => s.pending.length + s.inflight.length);
  const entries = useOutboxEntries(outbox);
  const pending = queued + entries.length;
  const authRequired = useEngineSelector(engine, (s) => s.authRequired) || Boolean(outbox?.authRequired);
  const errorCount = useEngineSelector(engine, (s) => s.errors.length);
  const conflicts = useEngineSelector(engine, (s) => s.conflicts.length);
  const status = combinedStatus(useEngineStatus(engine), useOutboxStatus(outbox), online);
  const local = useBackendMode() === "local";
  const notePending = useEngineSelector(engine, (s) =>
    documentId ? [...s.pending, ...s.inflight].filter((op) => (op.kind === "document.create" ? op.document.id : op.documentId) === documentId).length : 0,
  );
  const noteRefused = useEngineSelector(engine, (s) => (documentId ? s.conflicts.some((c) => c.documentId === documentId) : false));
  // When everything last reached the server, kept per account (shown in the details).
  const [lastSynced, setLastSynced] = useState<number | null>(() => (typeof window === "undefined" ? null : readLastSynced(profile.id)));
  const [justSynced, setJustSynced] = useState(false);
  const prev = useRef(status);
  useEffect(() => {
    const was = prev.current;
    prev.current = status;
    if (status !== "saved" || was === "saved") return;
    const now = Date.now();
    setLastSynced(now);
    try {
      localStorage.setItem(lastSyncedKey(profile.id), String(now));
    } catch {
      /* storage unavailable */
    }
    // A check for a moment after changes land, then the quiet cloud again.
    setJustSynced(true);
    const t = setTimeout(() => setJustSynced(false), 2500);
    return () => clearTimeout(t);
  }, [status, profile.id]);
  return { engine, outbox, online, local, status, pending, entries, authRequired, errorCount, conflicts, notePending, noteRefused, lastSynced, justSynced };
}

type TouchSync = ReturnType<typeof useTouchSync>;

function StatusIcon({ status, justSynced, size = 21 }: { status: Status; justSynced: boolean; size?: number }) {
  if (status === "offline") return <CloudOff size={size} strokeWidth={1.9} aria-hidden />;
  if (status === "error") return <AlertTriangle size={size} strokeWidth={1.9} aria-hidden />;
  if (status === "conflict") return <GitMerge size={size} strokeWidth={1.9} aria-hidden />;
  if (status === "saving" || status === "syncing") return <Loader2 size={size} strokeWidth={1.9} aria-hidden className="animate-spin motion-reduce:animate-none" />;
  return justSynced ? <Check size={size} strokeWidth={2.1} aria-hidden /> : <Cloud size={size} strokeWidth={1.9} aria-hidden />;
}

function describe(s: TouchSync): string {
  switch (s.status) {
    case "saved":
      return s.local ? "Every change is saved in your library." : "Every change is saved to Folevi.";
    case "saving":
    case "syncing":
      return s.pending === 1 ? "Sending 1 change." : s.pending ? `Sending ${s.pending} changes.` : "Sending your latest changes.";
    case "offline":
      return s.pending
        ? `${s.pending === 1 ? "1 change is" : `${s.pending} changes are`} kept on this device until you’re back online.`
        : "What you write is kept on this device and syncs when you’re back online.";
    case "conflict":
      return s.conflicts === 1 ? "A note was also edited somewhere else. Open it to choose which version to keep." : `${s.conflicts} notes were also edited somewhere else. Open them to choose which version to keep.`;
    case "error":
      return s.authRequired
        ? "Sign in again to send your changes. They’re kept on this device."
        : "Some changes weren’t accepted. They’re kept on this device, so you can try again.";
  }
}

/** The status's colours: calm green when all is saved, red when something needs a look, neutral otherwise. */
function toneOf(status: Status): { disc: string; icon: string } {
  if (status === "saved") return { disc: "bg-success-soft", icon: "text-success" };
  if (status === "error" || status === "conflict") return { disc: "bg-danger-soft", icon: "text-danger" };
  if (status === "offline") return { disc: "bg-[var(--color-surface-sunken)]", icon: "text-heading" };
  return { disc: "bg-[var(--color-accent-soft)]", icon: "text-heading" };
}

function HeroIcon({ status }: { status: Status }) {
  const size = 30;
  if (status === "saved") return <CloudCheck size={size} strokeWidth={1.8} aria-hidden />;
  if (status === "offline") return <CloudOff size={size} strokeWidth={1.8} aria-hidden />;
  if (status === "conflict") return <GitMerge size={size} strokeWidth={1.8} aria-hidden />;
  if (status === "error") return <CloudAlert size={size} strokeWidth={1.8} aria-hidden />;
  return <Loader2 size={size} strokeWidth={1.8} aria-hidden className="animate-spin motion-reduce:animate-none" />;
}

/** "1 min ago", kept current while the sheet is open. */
function useAge(ts: number | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ts) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [ts]);
  return ts ? ageText(ts, Math.max(now, ts)) : null;
}

function Fact({ label, value, tone = "text-muted" }: { label: string; value: string; tone?: string }) {
  return (
    <li className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 text-body">
      <span className="text-ink">{label}</span>
      <span className={`min-w-0 truncate text-right tabular-nums ${tone}`}>{value}</span>
    </li>
  );
}

/** The details: a clear status at the top, the facts on one card, what's waiting, and Retry when it helps. */
function SyncSheet({ open, onClose, sync }: { open: boolean; onClose: () => void; sync: TouchSync }) {
  const pending = usePendingDocs();
  const locals = useLocalNotes();
  const { status, entries, engine, outbox } = sync;
  const shown = pending.slice(0, 8);
  const titleId = useId();
  const age = useAge(sync.lastSynced);
  const tone = toneOf(status);
  const waiting = sync.pending === 0 ? "Nothing" : sync.pending === 1 ? "1 change" : `${sync.pending} changes`;
  return (
    <Sheet open={open} onClose={onClose} labelledBy={titleId} size="fit">
      <div data-testid="sync-sheet" data-status={status} className="grid gap-6 px-4 pb-6">
        <header className="flex flex-col items-center gap-3 px-6 text-center">
          <span className={`grid h-16 w-16 place-items-center rounded-capsule ${tone.disc} ${tone.icon}`}>
            <HeroIcon status={status} />
          </span>
          <div className="grid gap-1">
            <h2 id={titleId} className="text-title-2 font-semibold text-heading">
              {TITLES[status]}
            </h2>
            <p className="mx-auto max-w-[30ch] text-body text-muted">{describe(sync)}</p>
          </div>
        </header>
        <ul className="ui-grouped" aria-label="Sync details">
          <Fact label="Last synced" value={age ?? (status === "saved" ? "Up to date" : "Not yet on this device")} />
          <Fact label="Waiting on this device" value={waiting} tone={sync.pending ? "text-heading font-semibold" : "text-muted"} />
          <Fact label="Connection" value={sync.online ? "Online" : "Offline"} />
          <Fact label={sync.local ? "Library" : "Saved to"} value={sync.local ? "On your devices" : "Folevi"} />
        </ul>
        {shown.length ? (
          <section className="grid gap-2">
            <h3 className="ui-caption-caps px-4">Notes waiting to sync</h3>
            <ul className="ui-grouped">
              {shown.map((p) => {
                const title = p.localTitle || locals.get(p.documentId)?.title || (p.isNew ? "New note" : "Untitled");
                return (
                  <li key={p.documentId}>
                    <AppLink href={`/d/${p.documentId}`} onClick={onClose} className="flex min-h-11 items-center gap-3 px-4 py-2.5 text-body text-ink outline-none active:bg-[var(--liquid-press)] focus-visible:bg-[var(--liquid-active)]">
                      <FileText size={18} aria-hidden className="flex-none text-muted" />
                      <span className="min-w-0 flex-1 truncate">{title}</span>
                      <span className="flex-none text-subheadline tabular-nums text-muted">{p.isNew ? "New" : p.changes === 1 ? "1 change" : `${p.changes} changes`}</span>
                      <ChevronRight size={16} aria-hidden className="flex-none text-faint" />
                    </AppLink>
                  </li>
                );
              })}
            </ul>
            {pending.length > shown.length ? <p className="px-4 text-footnote text-muted">And {pending.length - shown.length} more.</p> : null}
          </section>
        ) : null}
        {entries.length ? (
          <section className="grid gap-2">
            <h3 className="ui-caption-caps px-4">Other changes</h3>
            <ul className="ui-grouped">
              {entries.slice(0, 8).map((e) => (
                <li key={e.id} className="flex min-h-11 items-center gap-3 px-4 py-2.5 text-body">
                  <ListTodo size={18} aria-hidden className="flex-none text-muted" />
                  <span className="min-w-0 flex-1 truncate text-ink">{e.label}</span>
                  {e.failed ? (
                    <span className="flex flex-none gap-1">
                      <button type="button" className="ui-hit min-h-11 px-2 text-subheadline font-semibold text-heading" onClick={() => outbox?.retry(e.id)}>
                        Retry
                      </button>
                      <button type="button" className="ui-hit min-h-11 px-2 text-subheadline text-danger" onClick={() => outbox?.discard(e.id)}>
                        Discard
                      </button>
                    </span>
                  ) : (
                    <span className="flex-none text-subheadline text-muted">{outbox?.sending === e.id ? "Sending" : "Waiting"}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {status !== "saved" ? (
          <div className="grid gap-2">
            <button
              type="button"
              className="ui-btn ui-btn-primary flex h-control items-center justify-center gap-2 rounded-capsule text-headline font-semibold disabled:opacity-50"
              disabled={!sync.online && status === "offline"}
              onClick={() => {
                // Refused changes whose content was kept go again (where this build can repair them).
                (engine as { retryRejected?: () => unknown } | null)?.retryRejected?.();
                engine?.authRefreshed();
                engine?.scheduleFlush(0);
                outbox?.authRefreshed();
              }}
            >
              <RefreshCw size={17} aria-hidden /> {status === "offline" ? "Syncs when you’re online" : "Try again now"}
            </button>
            {sync.errorCount ? (
              <button type="button" className="h-11 text-body text-muted" onClick={() => engine?.clearErrors()}>
                Dismiss
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

function badgeOf(sync: TouchSync, count: number) {
  if (sync.status === "error" || sync.status === "conflict") return <span aria-hidden className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-capsule bg-coral ring-2 ring-[var(--color-canvas)]" />;
  if (sync.status === "offline" && count)
    return (
      <span aria-hidden className="absolute -right-0.5 top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-capsule bg-heading px-1 text-caption-2 font-bold tabular-nums text-canvas">
        {count > 99 ? "99+" : count}
      </span>
    );
  return null;
}

// Read out exactly as the web and Mac's button: "Sync status: Offline, 2 changes waiting".
const label = (sync: TouchSync) => t("sync.button.label", { status: TITLES[sync.status], pending: sync.pending });

/**
 * The status button for a top bar (a 44 pt pill button). Slot: iPhone Home's top right pill beside the bell
 * (components/iphone/RootBar.tsx RootPill); iPad, the sidebar's top row (components/app/Sidebar.tsx).
 */
export function TouchSyncButton({ className = "" }: { className?: string }) {
  const sync = useTouchSync();
  const [open, setOpen] = useState(false);
  const tone = sync.status === "error" || sync.status === "conflict" ? "text-danger" : sync.status === "saved" ? "text-muted" : "text-heading";
  return (
    <>
      <PillButton label={label(sync)} onClick={() => setOpen(true)} className={`${tone} ${className}`} data-testid="sync-status-touch" data-status={sync.status}>
        <StatusIcon status={sync.status} justSynced={sync.justSynced} />
        {badgeOf(sync, sync.pending)}
      </PillButton>
      {open ? <SyncSheet open={open} onClose={() => setOpen(false)} sync={sync} /> : null}
    </>
  );
}

/**
 * One note's status in its bar: only while that note has changes on this device ("Saved on this device, will
 * sync") or one that needs a look. Nothing when it's synced, so a note's bar stays as it is.
 */
export function NoteSyncButton({ documentId }: { documentId: string }) {
  const sync = useTouchSync(documentId);
  const [open, setOpen] = useState(false);
  const own = useMemo(() => ({ ...sync, status: noteStatus(sync) }), [sync]);
  if (!sync.notePending && !sync.noteRefused) return null;
  const text = own.status === "offline" ? "Saved on this device, will sync" : own.status === "error" || own.status === "conflict" ? "Not saved: tap for details" : TITLES.syncing;
  return (
    <>
      <PillButton label={text} onClick={() => setOpen(true)} data-testid="note-sync-status" data-status={own.status} className={own.status === "error" || own.status === "conflict" ? "text-danger" : "text-heading"}>
        <StatusIcon status={own.status} justSynced={false} size={20} />
        {own.status === "error" || own.status === "conflict" ? badgeOf(own, 0) : null}
      </PillButton>
      {open ? <SyncSheet open={open} onClose={() => setOpen(false)} sync={own} /> : null}
    </>
  );
}

function noteStatus(s: TouchSync): Status {
  if (s.noteRefused) return "conflict";
  if (s.status === "error") return "error";
  if (!s.online) return "offline";
  return s.notePending ? "syncing" : "saved";
}
