"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronRight, LockKeyhole, Pause, TriangleAlert } from "lucide-react";
import type { WireScope } from "@folevi/editor-schema";
import { Button } from "@/components/ui/Button";
import { AppLink } from "@/lib/app/router";
import { formatBytes } from "@/lib/format";
import { copy } from "@/lib/e2ee/copy";
import { e2eeActions, useMigrationProgress, type MigrationProgress as Progress } from "./__stubs__";

/** Notes done over notes in all, and the line that says so ("Encrypting your notes: 1,240 of 1,800"). */
function summary(p: Progress): { line: string; fraction: number } {
  // History and attachments follow the notes; the bar covers every phase so it doesn't stop at 100% early.
  const total = p.documents.total + p.history.total + p.files.total;
  const done = p.documents.done + p.history.done + p.files.done;
  const fraction = total ? Math.min(1, done / total) : 1;
  const say = p.direction === "unseal" ? copy.migration.decrypting : p.direction === "reseal" ? copy.migration.rekeying : copy.migration.encrypting;
  return { line: say(p.documents.done, p.documents.total), fraction };
}

function details(p: Progress): string {
  const m = copy.migration;
  return [
    p.documents.done >= p.documents.total ? m.notesDone : m.notes(p.documents.done, p.documents.total),
    m.history(p.history.done, p.history.total),
    m.files(p.files.done, p.files.total, formatBytes(p.files.bytesLeft)),
  ].join(" ");
}

/** A thin bar for the progress, labelled for assistive tech. */
export function MigrationBar({ progress }: { progress: Progress }) {
  const { line, fraction } = summary(progress);
  return (
    <div className="space-y-1.5">
      <p className="text-[13px] font-medium text-heading">{line}</p>
      <div role="progressbar" aria-label={line} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} className="h-1.5 overflow-hidden rounded-tiny bg-[color-mix(in_oklab,var(--color-ink)_12%,transparent)]">
        <div className="h-full rounded-tiny bg-heading transition-[width] duration-300" style={{ width: `${Math.max(fraction * 100, 3)}%` }} />
      </div>
    </div>
  );
}

/** Settings > Privacy: the progress row (§10.10), with what's left per phase, a paused state and failures. */
export function MigrationRow({ scope }: { scope: WireScope }) {
  const progress = useMigrationProgress(scope);
  const [open, setOpen] = useState(false);
  const uid = useId();
  if (!progress || progress.phase === "done") return null;
  const m = copy.migration;
  return (
    <section aria-label={summary(progress).line} className="ui-card rounded-control p-4">
      <MigrationBar progress={progress} />
      {progress.paused ? (
        <p className="mt-2 flex items-center gap-1.5 text-[13px] text-muted">
          <Pause size={13} aria-hidden /> {m.paused}
        </p>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${uid}-details`}
        onClick={() => setOpen(!open)}
        className="mt-2 inline-flex h-8 items-center gap-1 rounded-chip px-1.5 text-[13px] font-medium text-muted outline-none hover:text-heading focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-11"
      >
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />} {m.details}
      </button>
      {open ? (
        <p id={`${uid}-details`} className="mt-1 text-[13px] text-muted">
          {details(progress)}
        </p>
      ) : null}
      {progress.failed.length ? (
        <div role="alert" className="mt-3 rounded-control bg-danger-soft p-3 text-[13px] text-ink">
          <p className="flex items-center gap-1.5 font-medium">
            <TriangleAlert size={14} aria-hidden /> {m.failed(progress.failed.length)}
          </p>
          <ul className="mt-1.5 list-disc pl-5">
            {progress.failed.map((f) => (
              <li key={f.documentId}>
                <AppLink href={`/d/${f.documentId}`} className="underline underline-offset-2">
                  {f.title || m.untitled}
                </AppLink>
              </li>
            ))}
          </ul>
          <Button size="sm" className="mt-2" onClick={() => void e2eeActions.retryFailed(scope)}>
            {m.tryAgain}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** The sidebar footer's one line while a space is being encrypted or decrypted (§10.10). Links to Settings > Privacy. */
export function SidebarMigrationLine({ scope, href }: { scope: WireScope; href: string }) {
  const progress = useMigrationProgress(scope);
  if (!progress || progress.phase === "done") return null;
  const { line, fraction } = summary(progress);
  return (
    <AppLink
      href={href}
      className="mb-1.5 flex flex-col gap-1 rounded-chip px-2.5 py-1.5 text-[12px] text-muted outline-none transition-colors hover:bg-[var(--glass-hover)] hover:text-heading focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:min-h-11"
    >
      <span className="flex items-start gap-1.5 leading-snug">
        {progress.paused ? <Pause size={12} aria-hidden className="mt-0.5 flex-none" /> : <LockKeyhole size={12} aria-hidden className="mt-0.5 flex-none" />}
        <span className="min-w-0">{progress.paused ? copy.migration.paused : line}</span>
      </span>
      <span aria-hidden className="h-1 overflow-hidden rounded-tiny bg-[color-mix(in_oklab,var(--color-ink)_10%,transparent)]">
        <span className="block h-full rounded-tiny bg-heading" style={{ width: `${Math.max(fraction * 100, 3)}%` }} />
      </span>
    </AppLink>
  );
}
